// Per-component persistence declarations (mw-e27.3): which parts of an entity's state outlive a level
// visit, how to read them, when a change is worth keeping and how to put it back. A level's deltas
// (persistence.ts) are made only of what these declarations capture, so a system whose state must
// persist adds one declaration rather than teaching the delta code about itself (mw-e11 supplies its
// AI state this way). Each declaration's `key` names its part of a delta; keys are save keys and
// never change once shipped.
//
// The defaults, applied in this order:
// - `properties`: every stored world property except the transient ones (`wetness` by default:
//   a soaked crate dries; e27 persistence policies decide the rest), as key → value, with null for a
//   property the entity no longer has. A burnt-out crate keeps its charred material this way.
//   Properties go back silently (no `propertyChanged`: loading is spawning from data), and the
//   entity's body and bound colliders take its new weight, friction and bounciness.
// - `transform`: a physics object's pose, kept only when it moved more than TRANSFORM_EPSILON metres
//   (or turned more than about 1°) from where the level put it and is at rest: a crate nudged 1 mm or
//   still tumbling records nothing. It goes back as a teleport: in place, stopped and awake.
// - `door`, `lock`, `switch`: a door's openness, heading, jam and broken state; a lock's state (on a
//   door or a chest, whose prompt follows it); a switch's position. A door's collider and light occluder follow on the first tick (the
//   mechanisms system syncs them); a switch's bound lever nodes follow at once.
// - `container`: an entity's whole pack (`inventory.pack`): a looted chest stays empty, and what was
//   put in one stays inside (mw-e18.3; that its loot table was rolled is a world fact, saved apart).
// - `stash`: the bodies stashed in a container (mw-e03.23), by kind and weight.
// - `actor.life`, `actor.disposition`: an actor's current hit points (0: dead, and it stays dead)
//   and its faction membership, the hooks actor persistence builds on (AI state is mw-e11's).
//
// Being destroyed (broken, burnt away, picked up, killed and removed) is not a declaration: the
// delta records it for any baseline entity that is gone.

import { HealthComponent } from '../combat/damage/components';
import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import { FactionMemberComponent } from '../factions/runtime';
import { InventoryComponent } from '../inventory/inventory';
import { refreshContainerAffordances } from '../loot/containers';
import { StashComponent } from '../loot/stash';
import { hypot } from '../math';
import { DoorComponent, LockComponent, SwitchComponent } from '../mechanisms/components';
import { refreshAffordances, syncSwitchNodes } from '../mechanisms/system';
import {
  bodyMaterialOf,
  MIN_BODY_MASS,
  PhysicsColliderComponent,
  PhysicsObjectComponent,
  REST_ANGULAR_SPEED,
  REST_LINEAR_SPEED,
  rigidBodiesOf,
  teleportPhysicsObject,
  type PhysicsObject,
} from '../physics/objects';
import {
  addProperties,
  getProperty,
  hasProperty,
  readProperty,
  removeProperty,
  WorldProperties,
} from '../properties/components';
import { isWorldPropertyKey, WORLD_PROPERTY_KEYS, type WorldPropertyKey } from '../properties/spec';
import type { ColliderHandle } from '../physics/static-colliders';
import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';

/**
 * How long a declaration's recorded state lasts (mw-e27.7):
 * - `permanent` (default): kept in deltas and saves until something changes it.
 * - `rest-reset`: back to its baseline when the player rests (herbs regrow, a camp restocks).
 * - `transient`: never captured; a level loads with it as authored.
 */
export type EntityPolicy = 'permanent' | 'rest-reset' | 'transient';

/**
 * One persisted part of an entity's state. `S` is what `capture` reads (for the baseline and now),
 * `D` what a delta records. Values must be plain, canonically encodable data (saves carry them).
 */
export interface PersistenceDeclaration<S = unknown, D = unknown> {
  /** Its key in a delta's `aspects` (a save key, never renamed). */
  readonly key: string;
  /** How long its state lasts (EntityPolicy); permanent when absent. */
  readonly policy?: EntityPolicy;
  /** The entity's state now, or undefined when this declaration does not cover the entity. */
  capture(world: World<never>, entity: EntityId): S | undefined;
  /** What to record going from `baseline` to `current`, or undefined when nothing worth keeping. */
  diff(baseline: S | undefined, current: S | undefined): D | undefined;
  /**
   * Puts a recorded delta back onto `entity` (between steps). Returns false when it no longer applies
   * (the entity lacks what it changes); may throw a RangeError for data it cannot accept.
   */
  apply(world: World<never>, entity: EntityId, delta: D): boolean;
}

/** Equality of plain data: primitives by Object.is, arrays and objects field by field. */
export function samePlain(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && samePlain(left[key], right[key]))
  );
}

/** What `componentPersistence` needs besides the component. */
export interface ComponentPersistenceSpec<T, S> {
  /** How long the picked fields last (EntityPolicy); permanent when absent. */
  readonly policy?: EntityPolicy;
  /** The persisted fields of a value (detached plain data). */
  readonly pick: (value: T) => S;
  /** Writes `delta` over `value`, the entity's current component (between steps). */
  readonly restore: (world: World<never>, entity: EntityId, value: T, delta: S) => void;
}

/**
 * A declaration over one component: it records the picked fields whenever they differ from the
 * baseline's, and applies only to an entity that still has the component.
 */
export function componentPersistence<T, S>(
  key: string,
  type: ComponentType<T>,
  spec: ComponentPersistenceSpec<T, S>,
): PersistenceDeclaration<S, S> {
  const valueOf = (world: World<never>, entity: EntityId): T | undefined =>
    world.isRegistered(type) ? world.get(entity, type) : undefined;
  return Object.freeze({
    key,
    ...(spec.policy !== undefined && { policy: spec.policy }),
    capture: (world: World<never>, entity: EntityId) => {
      const value = valueOf(world, entity);
      return value === undefined ? undefined : spec.pick(value);
    },
    diff: (baseline: S | undefined, current: S | undefined) =>
      current === undefined || samePlain(baseline, current) ? undefined : current,
    apply: (world: World<never>, entity: EntityId, delta: S) => {
      const value = valueOf(world, entity);
      if (value === undefined) return false;
      spec.restore(world, entity, value, delta);
      return true;
    },
  });
}

/** World properties that are never persisted by default: they lapse on their own. */
export const TRANSIENT_PROPERTIES: readonly WorldPropertyKey[] = Object.freeze(['wetness']);

/** Stored property → value; null in a delta: the entity no longer has that property. */
export type PropertyDelta = Readonly<Record<string, unknown>>;

/** Gives a physics object's body, and an entity's bound colliders, its current body properties (call after changing material or weight). */
export function refreshBody(world: World<never>, entity: EntityId): void {
  if (!world.isRegistered(PhysicsObjectComponent)) return; // installed with physics.collider
  const object = world.get(entity, PhysicsObjectComponent);
  const bound = world.get(entity, PhysicsColliderComponent);
  if (object === undefined && bound === undefined) return;
  const port = rigidBodiesOf(world);
  const material = bodyMaterialOf(world, entity);
  if (object !== undefined) {
    const body = object.body as ColliderHandle;
    port.setMass(body, Math.max(MIN_BODY_MASS, readProperty(world, entity, 'weight')));
    port.setMaterial(body, material);
  }
  for (const collider of bound?.colliders ?? []) {
    port.setMaterial(collider as ColliderHandle, material);
  }
}

/**
 * The world-property declaration (see the file header): every stored property but `transient`
 * ones (TRANSIENT_PROPERTIES by default).
 */
export function propertyPersistence(
  transient: readonly WorldPropertyKey[] = TRANSIENT_PROPERTIES,
): PersistenceDeclaration<PropertyDelta, PropertyDelta> {
  const keys = WORLD_PROPERTY_KEYS.filter((key) => !transient.includes(key));
  return Object.freeze({
    key: 'properties',
    capture: (world: World<never>, entity: EntityId) => {
      if (!world.isRegistered(WorldProperties.material)) return undefined;
      const stored: Record<string, unknown> = {};
      for (const key of keys) {
        const value = getProperty(world, entity, key);
        if (value !== undefined) stored[key] = typeof value === 'object' ? { ...value } : value;
      }
      return stored;
    },
    diff: (baseline: PropertyDelta | undefined, current: PropertyDelta | undefined) => {
      if (current === undefined) return undefined;
      const before = baseline ?? {};
      const delta: Record<string, unknown> = {};
      for (const key of keys) {
        const now = current[key];
        if (now === undefined) {
          if (before[key] !== undefined) delta[key] = null;
        } else if (!samePlain(before[key], now)) {
          delta[key] = now;
        }
      }
      return Object.keys(delta).length === 0 ? undefined : delta;
    },
    apply: (world: World<never>, entity: EntityId, delta: PropertyDelta) => {
      const set: Record<string, unknown> = {};
      const removed: WorldPropertyKey[] = [];
      for (const [key, value] of Object.entries(delta)) {
        if (!isWorldPropertyKey(key)) throw new RangeError(`unknown world property "${key}"`);
        if (value === null) removed.push(key);
        else set[key] = value;
      }
      addProperties(world, entity, set); // validates every value before adding any
      for (const key of removed) {
        if (hasProperty(world, entity, key)) removeProperty(world, entity, key);
      }
      refreshBody(world, entity);
      return true;
    },
  });
}

/** Least distance a physics object must have moved for its pose to persist, m (AC-1). */
export const TRANSFORM_EPSILON = 0.01;
/** |q·q′| at or above this is the same rotation (within about 1°). */
export const ROTATION_EPSILON_DOT = 0.99996;

/** A physics object's pose, and whether it was at rest when read. */
export interface TransformState {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly resting: boolean;
}

/** A persisted pose. */
export interface TransformDelta {
  readonly position: Vec3;
  readonly rotation: Quat;
}

const speed = ({ x, y, z }: Vec3): number => hypot(x, y, z);

function resting(world: World<never>, object: PhysicsObject): boolean {
  if (object.sleeping) return true;
  const motion = rigidBodiesOf(world).motionOf(object.body as ColliderHandle);
  return speed(motion.linvel) < REST_LINEAR_SPEED && speed(motion.angvel) < REST_ANGULAR_SPEED;
}

function moved(a: TransformDelta, b: TransformDelta): boolean {
  const d = {
    x: a.position.x - b.position.x,
    y: a.position.y - b.position.y,
    z: a.position.z - b.position.z,
  };
  const r = a.rotation;
  const q = b.rotation;
  const dot = Math.abs(r.x * q.x + r.y * q.y + r.z * q.z + r.w * q.w);
  return speed(d) > TRANSFORM_EPSILON || dot < ROTATION_EPSILON_DOT;
}

/** The physics-object pose declaration (see the file header). */
export const transformPersistence: PersistenceDeclaration<TransformState, TransformDelta> =
  Object.freeze({
    key: 'transform',
    capture: (world: World<never>, entity: EntityId) => {
      const object = world.isRegistered(PhysicsObjectComponent)
        ? world.get(entity, PhysicsObjectComponent)
        : undefined;
      if (object === undefined) return undefined;
      return {
        position: { ...object.position },
        rotation: { ...object.rotation },
        resting: resting(world, object),
      };
    },
    diff: (baseline: TransformState | undefined, current: TransformState | undefined) => {
      if (baseline === undefined || current?.resting !== true) return undefined;
      if (!moved(baseline, current)) return undefined;
      return { position: current.position, rotation: current.rotation };
    },
    apply: (world: World<never>, entity: EntityId, delta: TransformDelta) => {
      if (
        !world.isRegistered(PhysicsObjectComponent) ||
        !world.has(entity, PhysicsObjectComponent)
      ) {
        return false;
      }
      teleportPhysicsObject(world, entity, delta.position, delta.rotation);
      return true;
    },
  });

/** A door's persisted state. */
export interface DoorDelta {
  readonly openness: number;
  readonly target: 0 | 1;
  readonly jammed: boolean;
  readonly broken: boolean;
}

export const doorPersistence = componentPersistence('door', DoorComponent, {
  pick: ({ openness, target, jammed, broken }): DoorDelta => ({ openness, target, jammed, broken }),
  restore: (world, entity, door, delta) => {
    world.set(entity, DoorComponent, { ...door, ...delta, blockedBy: null });
    refreshAffordances(world, entity);
  },
});

export const lockPersistence = componentPersistence('lock', LockComponent, {
  pick: ({ locked }) => ({ locked }),
  restore: (world, entity, lock, delta) => {
    world.set(entity, LockComponent, { ...lock, locked: delta.locked });
    refreshAffordances(world, entity);
    refreshContainerAffordances(world, entity);
  },
});

export const switchPersistence = componentPersistence('switch', SwitchComponent, {
  pick: ({ position }) => ({ position }),
  restore: (world, entity, own, delta) => {
    world.set(entity, SwitchComponent, { ...own, position: delta.position });
    syncSwitchNodes(world, entity);
  },
});

export const containerPersistence = componentPersistence('container', InventoryComponent, {
  pick: (pack) => structuredClone(pack),
  restore: (world, entity, _pack, delta) => {
    world.set(entity, InventoryComponent, structuredClone(delta));
  },
});

/** What a container's stash holds (mw-e03.23): its bodies, by kind and weight. */
export const stashPersistence = componentPersistence('stash', StashComponent, {
  pick: ({ bodies }) => ({ bodies: bodies.map((body) => ({ ...body })) }),
  restore: (world, entity, stash, delta) => {
    world.set(entity, StashComponent, { ...stash, bodies: delta.bodies.map((b) => ({ ...b })) });
  },
});

export const actorLifePersistence = componentPersistence('actor.life', HealthComponent, {
  pick: ({ current }) => ({ current }),
  restore: (world, entity, health, delta) => {
    world.set(entity, HealthComponent, Object.freeze({ ...health, current: delta.current }));
  },
});

export const actorDispositionPersistence = componentPersistence(
  'actor.disposition',
  FactionMemberComponent,
  {
    pick: ({ faction, toward }) => ({ faction, toward: { ...toward } }),
    restore: (world, entity, _member, delta) => {
      world.set(entity, FactionMemberComponent, FactionMemberComponent.deserialize(delta));
    },
  },
);

/** The default declarations, in apply order (properties before the pose: a body is rebuilt from them). */
export const DEFAULT_PERSISTENCE: readonly PersistenceDeclaration[] = Object.freeze([
  propertyPersistence(),
  transformPersistence,
  doorPersistence,
  lockPersistence,
  switchPersistence,
  containerPersistence,
  stashPersistence,
  actorLifePersistence,
  actorDispositionPersistence,
] as readonly PersistenceDeclaration[]);
