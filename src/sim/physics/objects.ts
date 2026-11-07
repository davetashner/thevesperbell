// Physics objects (mw-e03.10): crates, barrels, bottles, statues and debris as dynamic rigid bodies on
// the sim-owned physics port, stepped inside the sim's fixed tick. The sim is the authority: the
// World steps the port first every tick, then `physicsObjectsSystem` copies each moving body's pose
// into its `physics.object` component (and its `spatial.placement`, so stimuli and queries find it
// where it is). The renderer only reads that pose: render sync (src/game/loop/render-sync.ts) keeps
// the previous and latest tick's transform and interpolates between them, never simulating anything.
//
// Everything comes from world properties (mw-e03.1), never from object types:
// - `weight` is the body's mass (kg; at least MIN_BODY_MASS);
// - `friction` is its friction coefficient;
// - `impactAbsorb` sets its bounciness: restitution = MAX_RESTITUTION × (1 − impactAbsorb);
// - `material` names each side of an impact for sound, noise and breaking.
// A `propertyChanged` of weight, friction or impactAbsorb (a soaked cloth gets heavier, a frozen
// floor slippery) reaches the body before the next physics step. Level colliders take part through
// `bindCollider`, which gives a static collider its entity's friction, bounciness and material; from
// then on the entity owns them: when it goes (fire burns an ivy wall away), they leave the physics
// world with it at the end of that tick (mw-e03.42), so no invisible wall stays behind.
// Pushes come through the one stimulus API: a force stimulus's `impulseApplied` is applied to the
// body, so no caller ever scripts a pair of objects.
//
// Impacts: each contact that starts with a closing speed of at least `minImpactSpeed` (1 m/s by
// default: settling and resting contacts stay quiet) emits one `physicsImpact` with its energy (J),
// impulse (N·s) and the two materials, for breakables, noise, damage and sound. Buoyancy (density) is
// e03 liquids' (mw-e03.14); carrying, pushing and levitation drive bodies through this layer later.
//
// Budget: at most `budget` bodies (300 by default) stay awake. When more are awake, the oldest
// resting bodies (awake longest, at rest, and at least `restDistance` from the focus, e.g. the
// player) are forced to sleep until the count is back within budget, and `physicsBudgetExceeded`
// reports it for the log. A forced sleeper wakes again as soon as anything touches or pushes it.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, TickContext, World } from '../core/world';
import { hypot } from '../math';
import { propertyChanged, readProperty } from '../properties/components';
import { WORLD_PROPERTY_SPECS, type WorldPropertyValues } from '../properties/spec';
import type { Quat } from '../scene/layout';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { impulseApplied } from '../stimulus/stimulus';
import {
  boundingRadius,
  type BodyMaterial,
  type BodyShape,
  type ContactImpact,
  type RigidBodyPort,
} from './bodies';
import type { ColliderHandle, StaticColliderSink } from './static-colliders';

/** Default most awake bodies (AC-5). */
export const DEFAULT_BODY_BUDGET = 300;
/** Default slowest contact that counts as an impact, m/s. */
export const DEFAULT_MIN_IMPACT_SPEED = 1;
/** Default distance from the focus beyond which a resting body may be forced to sleep, m. */
export const DEFAULT_REST_DISTANCE = 10;
/** Restitution of a body that absorbs nothing (impactAbsorb 0); crates and stone barely bounce. */
export const MAX_RESTITUTION = 0.2;
/** Mass given to a body whose weight is below this, kg (the engine needs a positive mass). */
export const MIN_BODY_MASS = 0.01;
/** Below these speeds (m/s, rad/s) an awake body counts as resting for the budget. */
export const REST_LINEAR_SPEED = 0.05;
export const REST_ANGULAR_SPEED = 0.1;

/** A physics object's body and its pose as of the last tick (`physics.object`; never renamed). */
export interface PhysicsObject {
  /** The body's handle in the world's physics port. */
  readonly body: number;
  readonly shape: BodyShape;
  /** Centre, metres. */
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly sleeping: boolean;
  /** Tick it was added or last woke up (the budget sleeps the oldest first). */
  readonly awakeSince: number;
}

/** Static colliders that belong to an entity (`physics.collider`; never renamed). */
export interface PhysicsCollider {
  /** In the order they were bound (a kit piece may have several solid parts). */
  readonly colliders: readonly number[];
}

export const PhysicsObjectComponent = defineComponent<PhysicsObject>('physics.object');
export const PhysicsColliderComponent = defineComponent<PhysicsCollider>('physics.collider');

/** A contact between a physics object and something else that started hard enough to count. */
export interface PhysicsImpact {
  /** The physics object (for two objects, the one whose contact the engine reported first). */
  readonly entity: EntityId;
  /** What it hit: another physics object, a bound collider's entity, or null (unbound geometry). */
  readonly other: EntityId | null;
  /** Materials of `entity` and `other` (unbound geometry reads the default material). */
  readonly materials: readonly [string, string];
  /** Kinetic energy of the closing motion, J. */
  readonly energy: number;
  /** N·s. */
  readonly impulse: number;
  /** Closing speed, m/s. */
  readonly speed: number;
  /** Contact normal from `entity` towards `other`. */
  readonly normal: Vec3;
  /** Where `entity` is after the step, metres. */
  readonly position: Vec3;
}

/** Fired once per impact, the tick it happens. */
export const physicsImpact = defineEvent<PhysicsImpact>('physicsImpact');

/** The budget forced bodies to sleep (or could not). */
export interface PhysicsBudgetExceeded {
  readonly tick: number;
  /** Awake bodies before enforcing. */
  readonly active: number;
  readonly budget: number;
  /** Bodies forced to sleep, in the order chosen (may be empty: none were resting and distant). */
  readonly slept: readonly EntityId[];
}

/** Fired when the awake-body budget is exceeded (at most once a second when nothing can sleep). */
export const physicsBudgetExceeded = defineEvent<PhysicsBudgetExceeded>('physicsBudgetExceeded');

export interface PhysicsObjectsOptions {
  /** Most awake bodies; defaults to DEFAULT_BODY_BUDGET. */
  readonly budget?: number;
  /** Slowest contact that counts as an impact, m/s; defaults to DEFAULT_MIN_IMPACT_SPEED. */
  readonly minImpactSpeed?: number;
  /** Where attention is (the player); bodies near it are never forced to sleep. None: no focus. */
  readonly focus?: (world: World<never>) => Vec3 | undefined;
  /** Distance from the focus a body must have to be forced to sleep, m; DEFAULT_REST_DISTANCE. */
  readonly restDistance?: number;
  /**
   * Where bound level colliders are removed from when their entity goes: the sink the scene was
   * loaded into (a `ColliderFanOut` that also feeds the light model's occluders). Defaults to the
   * world's physics port.
   */
  readonly levelColliders?: StaticColliderSink;
}

/** How a new physics object is placed. */
export interface PhysicsObjectSpec {
  readonly shape: BodyShape;
  readonly position: Vec3;
  /** Defaults to identity. */
  readonly rotation?: Quat;
  /** Initial velocity (a thrown object), m/s; defaults to zero. */
  readonly velocity?: Vec3;
  /**
   * The entity's body properties, for an entity whose properties were added this tick and so are
   * not readable yet (e.g. spawned during a step); defaults to reading them from the entity.
   */
  readonly properties?: BodyProperties;
}

/** The world properties a body is made from. */
export type BodyProperties = Pick<WorldPropertyValues, 'weight' | 'friction' | 'impactAbsorb'>;

const IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** The world's physics port as a rigid-body port; throws when it has none or it has no bodies. */
export function rigidBodiesOf(world: World<never>): RigidBodyPort {
  const port = world.physics as Partial<RigidBodyPort> | undefined;
  if (port?.addBody === undefined) throw new Error('this world has no rigid-body physics');
  return port as RigidBodyPort;
}

const massFrom = (weight: number): number => Math.max(MIN_BODY_MASS, weight);

const massOf = (world: World<never>, entity: EntityId): number =>
  massFrom(readProperty(world, entity, 'weight'));

const materialFrom = (friction: number, impactAbsorb: number): BodyMaterial => ({
  friction,
  restitution: MAX_RESTITUTION * (1 - impactAbsorb),
});

/** Friction and restitution of `entity` from its properties (see the file header). */
export function bodyMaterialOf(world: World<never>, entity: EntityId): BodyMaterial {
  return materialFrom(
    readProperty(world, entity, 'friction'),
    readProperty(world, entity, 'impactAbsorb'),
  );
}

const frozenObject = (value: PhysicsObject): PhysicsObject => Object.freeze(value);

/**
 * Gives `entity` a dynamic body from its properties (weight, friction, impactAbsorb) at `spec`'s
 * pose. The body exists at once; the component is a structural change (end of tick during a step),
 * so give the entity its properties first, or, when they were added in the same step, pass their
 * values as `spec.properties`. Returns the body's handle.
 * @throws Error when the world has no rigid-body physics or `entity` already is a physics object.
 */
export function addPhysicsObject(
  world: World<never>,
  entity: EntityId,
  spec: PhysicsObjectSpec,
): ColliderHandle {
  const port = rigidBodiesOf(world);
  if (world.has(entity, PhysicsObjectComponent)) {
    throw new Error(`entity ${String(entity)} already is a physics object`);
  }
  const rotation = spec.rotation ?? IDENTITY;
  const given = spec.properties;
  const body = port.addBody({
    shape: spec.shape,
    position: spec.position,
    rotation,
    ...(spec.velocity !== undefined && { velocity: spec.velocity }),
    mass: given === undefined ? massOf(world, entity) : massFrom(given.weight),
    ...(given === undefined
      ? bodyMaterialOf(world, entity)
      : materialFrom(given.friction, given.impactAbsorb)),
  });
  const { x, y, z } = spec.position;
  world.add(
    entity,
    PhysicsObjectComponent,
    frozenObject({
      body,
      shape: structuredClone(spec.shape), // never aliased with the caller's object
      position: Object.freeze({ x, y, z }),
      rotation: Object.freeze({ ...rotation }),
      sleeping: false,
      awakeSince: world.tick,
    }),
  );
  placeEntity(world, entity, spec.position, boundingRadius(spec.shape));
  return body;
}

/**
 * Makes `entity` an ordinary entity again: its `physics.object` component goes and, with it, its
 * body (a structural change: end of tick during a step). Destroying a physics object needs no call
 * to this: its body leaves the physics world with the entity (mw-e03.41).
 * @throws Error when `entity` is not a physics object.
 */
export function removePhysicsObject(world: World<never>, entity: EntityId): void {
  if (!world.has(entity, PhysicsObjectComponent)) {
    throw new Error(`entity ${String(entity)} is not a physics object`);
  }
  world.remove(entity, PhysicsObjectComponent);
}

/**
 * Teleports physics object `entity`: its body's centre goes to `position` at once, stopped and awake
 * (turned to `rotation` when given, else keeping its rotation), and its `physics.object` pose and
 * placement follow in the same tick, so every later system of the tick sees it there (the debug
 * console's `tp`, mw-e33.17; a saved pose, mw-e27.3).
 * @throws Error when `entity` is not a physics object; RangeError for a non-finite pose.
 */
export function teleportPhysicsObject(
  world: World<never>,
  entity: EntityId,
  position: Vec3,
  rotation?: Quat,
): void {
  const object = world.get(entity, PhysicsObjectComponent);
  if (object === undefined) throw new Error(`entity ${String(entity)} is not a physics object`);
  rigidBodiesOf(world).moveBody(object.body as ColliderHandle, position, rotation);
  const { x, y, z } = position;
  world.set(
    entity,
    PhysicsObjectComponent,
    frozenObject({
      ...object,
      position: Object.freeze({ x, y, z }),
      ...(rotation !== undefined && { rotation: Object.freeze({ ...rotation }) }),
      sleeping: false,
      awakeSince: object.sleeping ? world.tick : object.awakeSince,
    }),
  );
  placeEntity(world, entity, position, boundingRadius(object.shape));
}

/**
 * Gives physics object `entity` the linear velocity `velocity` (m/s) at once, keeping its spin: the
 * impulse that changes its current velocity into it, so a thrown crate leaves at exactly the throw's
 * speed whatever its mass. The body wakes.
 * @throws Error when `entity` is not a physics object.
 */
export function setPhysicsObjectVelocity(
  world: World<never>,
  entity: EntityId,
  velocity: Vec3,
): void {
  const object = world.get(entity, PhysicsObjectComponent);
  if (object === undefined) throw new Error(`entity ${String(entity)} is not a physics object`);
  const port = rigidBodiesOf(world);
  const body = object.body as ColliderHandle;
  const { linvel, mass } = port.motionOf(body);
  port.applyImpulse(body, {
    x: (velocity.x - linvel.x) * mass,
    y: (velocity.y - linvel.y) * mass,
    z: (velocity.z - linvel.z) * mass,
  });
}

/**
 * Makes static collider `collider` (e.g. from `loadScene`) part of `entity`: impacts name the entity
 * and its material, and the collider takes the entity's friction and bounciness, now and whenever
 * they change. An entity may own several colliders; bind them between steps (during a step the
 * component change waits for the end of the tick, so a second bind in the same tick replaces the
 * first). The entity owns the collider from then on: destroying the entity, or removing its
 * `physics.collider` component, removes the collider from the level collider sink (mw-e03.42;
 * `unloadScene` skips colliders already gone).
 */
export function bindCollider(
  world: World<never>,
  entity: EntityId,
  collider: ColliderHandle,
): void {
  rigidBodiesOf(world).setMaterial(collider, bodyMaterialOf(world, entity));
  const bound = world.get(entity, PhysicsColliderComponent)?.colliders ?? [];
  world.add(
    entity,
    PhysicsColliderComponent,
    Object.freeze({ colliders: Object.freeze([...bound, collider]) }),
  );
}

interface Owned {
  readonly entity: EntityId;
  readonly object: PhysicsObject;
}

const materialOf = (world: World<never>, entity: EntityId | null): string =>
  entity === null ? WORLD_PROPERTY_SPECS.material.default : readProperty(world, entity, 'material');

/** Emits `physicsImpact` for each of the last step's impacts at or above `minSpeed`. */
function emitImpacts(
  world: World<never>,
  impacts: readonly ContactImpact[],
  minSpeed: number,
): void {
  const hard = impacts.filter((impact) => impact.speed >= minSpeed);
  if (hard.length === 0) return;
  // Body and bound-collider handles → the entities they belong to.
  const objects = new Map<number, Owned>();
  world.query(PhysicsObjectComponent).forEach((entity, object) => {
    objects.set(object.body, { entity, object });
  });
  const bound = new Map<number, EntityId>();
  world.query(PhysicsColliderComponent).forEach((entity, { colliders }) => {
    for (const collider of colliders) bound.set(collider, entity);
  });
  for (const impact of hard) {
    const a = objects.get(impact.a);
    const self = a ?? objects.get(impact.b);
    if (self === undefined) continue; // a body added straight to the port, not a physics object
    const otherHandle = self === a ? impact.b : impact.a;
    const other = objects.get(otherHandle)?.entity ?? bound.get(otherHandle) ?? null;
    const n = impact.normal;
    world.events.emit(physicsImpact, {
      entity: self.entity,
      other,
      materials: [materialOf(world, self.entity), materialOf(world, other)],
      energy: impact.energy,
      impulse: impact.impulse,
      speed: impact.speed,
      normal: self === a ? { ...n } : { x: -n.x, y: -n.y, z: -n.z },
      position: self.object.position,
    });
  }
}

interface Awake {
  readonly entity: EntityId;
  readonly object: PhysicsObject;
}

const speed = ({ x, y, z }: Vec3): number => hypot(x, y, z);

/**
 * The physics-object system: emits the last physics step's impacts, copies every moving body's pose
 * into its component and placement, and enforces the awake-body budget. Installed by
 * `installPhysicsObjects`; place it right after anything that must run before physics results are
 * read (it reads the step the World took at the start of this tick).
 */
export function physicsObjectsSystem(options: PhysicsObjectsOptions = {}): System<never> {
  const budget = options.budget ?? DEFAULT_BODY_BUDGET;
  const minImpactSpeed = options.minImpactSpeed ?? DEFAULT_MIN_IMPACT_SPEED;
  const restDistance = options.restDistance ?? DEFAULT_REST_DISTANCE;
  return {
    name: 'physicsObjects',
    run(ctx: TickContext<never>): void {
      const { world, tick } = ctx;
      const port = rigidBodiesOf(world);
      emitImpacts(world, port.impacts(), minImpactSpeed);
      const awake: Awake[] = [];
      world.query(PhysicsObjectComponent).forEach((entity, object) => {
        const body = object.body as ColliderHandle;
        if (object.sleeping && port.isSleeping(body)) return; // unchanged since it fell asleep
        const pose = port.poseOf(body);
        const next = frozenObject({
          ...object,
          position: Object.freeze(pose.position),
          rotation: Object.freeze(pose.rotation),
          sleeping: pose.sleeping,
          awakeSince: object.sleeping ? tick : object.awakeSince,
        });
        world.set(entity, PhysicsObjectComponent, next);
        placeEntity(world, entity, pose.position, boundingRadius(object.shape));
        if (!pose.sleeping) awake.push({ entity, object: next });
      });
      if (awake.length > budget) {
        enforceBudget(world, port, awake, { budget, restDistance, tick, focus: options.focus });
      }
    },
  };
}

function enforceBudget(
  world: World<never>,
  port: RigidBodyPort,
  awake: readonly Awake[],
  limits: {
    readonly budget: number;
    readonly restDistance: number;
    readonly tick: number;
    readonly focus: PhysicsObjectsOptions['focus'];
  },
): void {
  const focus = limits.focus?.(world);
  const distanceOf = (p: Vec3): number =>
    focus === undefined ? Infinity : hypot(p.x - focus.x, p.y - focus.y, p.z - focus.z);
  const resting = ({ object }: Awake): boolean => {
    const { linvel, angvel } = port.motionOf(object.body as ColliderHandle);
    return speed(linvel) < REST_LINEAR_SPEED && speed(angvel) < REST_ANGULAR_SPEED;
  };
  const candidates = awake
    .filter((a) => distanceOf(a.object.position) >= limits.restDistance && resting(a))
    .sort(
      (a, b) =>
        a.object.awakeSince - b.object.awakeSince ||
        distanceOf(b.object.position) - distanceOf(a.object.position) ||
        a.entity - b.entity,
    )
    .slice(0, awake.length - limits.budget);
  for (const { entity, object } of candidates) {
    port.sleep(object.body as ColliderHandle);
    world.set(entity, PhysicsObjectComponent, frozenObject({ ...object, sleeping: true }));
  }
  if (candidates.length > 0 || limits.tick % world.clock.hz === 0) {
    world.events.emit(physicsBudgetExceeded, {
      tick: limits.tick,
      active: awake.length,
      budget: limits.budget,
      slept: candidates.map((c) => c.entity),
    });
  }
}

/**
 * Sets up physics objects in `world`, whose physics must be a rigid-body port: registers the
 * `physics.object` and `physics.collider` components, adds `physicsObjectsSystem`, applies force
 * stimuli's impulses to bodies and keeps bodies in step with weight, friction and impactAbsorb
 * changes. Call once at setup, after `registerWorldProperties` and `installStimuli` (placements).
 */
export function installPhysicsObjects<W extends World<never>>(
  world: W,
  options: PhysicsObjectsOptions = {},
): W {
  const port = rigidBodiesOf(world);
  world.register(PhysicsObjectComponent, PhysicsColliderComponent);
  world.addSystem(physicsObjectsSystem(options));
  // A physics object's body goes with its component: removed, or destroyed with the entity.
  world.onRemove(PhysicsObjectComponent, (_entity, object) => {
    port.remove(object.body as ColliderHandle);
  });
  // Bound level colliders go with their entity too (mw-e03.42): skipped when already removed.
  const level = options.levelColliders ?? port;
  world.onRemove(PhysicsColliderComponent, (_entity, { colliders }) => {
    for (const collider of colliders) {
      if (level.has(collider as ColliderHandle)) level.remove(collider as ColliderHandle);
    }
  });
  world.events.on(impulseApplied, ({ entity, impulse }) => {
    const object = world.get(entity, PhysicsObjectComponent);
    if (object !== undefined) port.applyImpulse(object.body as ColliderHandle, impulse);
  });
  world.events.on(propertyChanged, ({ entity, key }) => {
    if (key !== 'weight' && key !== 'friction' && key !== 'impactAbsorb') return;
    const object = world.get(entity, PhysicsObjectComponent);
    if (object !== undefined) {
      const body = object.body as ColliderHandle;
      if (key === 'weight') port.setMass(body, massOf(world, entity));
      else port.setMaterial(body, bodyMaterialOf(world, entity));
      return;
    }
    const bound = world.get(entity, PhysicsColliderComponent);
    if (bound === undefined || key === 'weight') return;
    const material = bodyMaterialOf(world, entity);
    for (const collider of bound.colliders) port.setMaterial(collider as ColliderHandle, material);
  });
  return world;
}
