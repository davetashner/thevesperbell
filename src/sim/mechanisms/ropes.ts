// Cuttable ropes and what hangs from them (mw-e05.13). A rope is anything with the `cuttable` world
// property and a body in the world: a cord hanging straight down from a point, a thin collider an arrow
// can hit. Slash or pierce damage that lands on it severs it, and whatever it supports is free.
// Nothing here names a source of damage: a cutting packet is a stimulus of the `slash` or `pierce`
// element, whether an arrow's contact echo (`arrowImpact` follows its hit with a `pierce` or `blunt`
// one on what it struck), a thrown dagger, a sword arc or a spell. A contact stimulus severs the rope
// it names; any other shape severs a rope it reaches along its length. Blunt, force and every other
// element never cut. A rope that is not `cuttable` right now (the property is false) cannot be cut.
//
// What hangs: an entity with the `suspended` property and a `support` naming the rope's entity (the
// properties the world already has for this: `supportOf`). `suspendFrom` hangs a physics object. The
// physics port has no joints, so the rope is a pin: each tick the suspended body is put back at the
// pose it hangs at, still and awake, which is exactly what a rigid rope does. The moment its support
// goes (severed, burnt away, unloaded: `supportOf` finds none) or `suspended` turns false by any
// other means, the pin lets go, the body is an ordinary physics object and gravity takes it. A
// counterweight (an impact switch) is tripped as it is released (`releaseImpactSwitch`), whatever
// its filter says. Burning needs nothing more: a burnt rope is destroyed (mw-e03.5) and releases
// what it held the next tick, with no one to blame.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import {
  PhysicsObjectComponent,
  bindCollider,
  MIN_BODY_MASS,
  rigidBodiesOf,
  teleportPhysicsObject,
} from '../physics/objects';
import {
  assignProperty,
  hasProperty,
  propertyChanged,
  readProperty,
  setProperty,
} from '../properties/components';
import { supportOf } from '../properties/derived';
import type { ColliderHandle, StaticColliderSink } from '../physics/static-colliders';
import { placeEntity } from '../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../stimulus/shapes';
import { stimulusResolved } from '../stimulus/stimulus';
import { releaseImpactSwitch, ImpactSwitchComponent } from './impacts';

/** A cuttable cord (`mechanisms.cuttable`; a snapshot and save key, never renamed). */
export interface Cuttable {
  /** Where it hangs from, metres. */
  readonly top: Vec3;
  /** How far it hangs straight down, metres. */
  readonly length: number;
  /** Half its thickness, metres: the collider an arrow hits, and how close a strike must come. */
  readonly radius: number;
  /** Its collider's handle in the sink it was added to; null: it has none. */
  readonly collider: number | null;
  /** Cut already (it goes at the end of the tick). */
  readonly severed: boolean;
}

export const CuttableComponent = defineComponent<Cuttable>('mechanisms.cuttable');

/** The pose a suspended body hangs at (`mechanisms.suspended`; a snapshot and save key, never renamed). */
export interface Suspended {
  /** Let go already (the component goes at the end of the tick). */
  readonly released: boolean;
  readonly position: Vec3;
  readonly rotation: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
}

export const SuspendedComponent = defineComponent<Suspended>('mechanisms.suspended');

/** A suspended body was let go. */
export interface SuspensionReleased {
  readonly tick: number;
  readonly entity: EntityId;
  /** The rope or support it hung from (0: none left). */
  readonly support: number;
  /** Who cut or burnt it, else null. */
  readonly source: EntityId | null;
}

export const suspensionReleased = defineEvent<SuspensionReleased>('suspensionReleased');

/**
 * Mass a held body is given while it hangs, kg (mw-e03.13): the pin teleports it back each tick, which
 * keeps a light plank from bearing a crate that would push it aside; at this mass nothing resting on
 * or hitting a hanging body moves it. Its own mass (its `weight`) is restored the tick it is let go.
 */
export const PINNED_MASS = 1_000_000;

/** Default half thickness of a cord, metres. */
export const DEFAULT_ROPE_RADIUS = 0.05;

/** Spacing of the points along a cord that a spatial strike is tested at, metres. */
const SAMPLE_SPACING = 0.25;

/** Options of `makeCuttable`. */
export interface CuttableOptions {
  /** Half thickness, metres; DEFAULT_ROPE_RADIUS. */
  readonly radius?: number;
  /**
   * Where its collider goes (the world's physics port in the game): a thin box arrows hit, bound to
   * the rope so impacts name it. None: the rope has no body, only strikes that reach it cut it.
   */
  readonly colliders?: StaticColliderSink;
}

/**
 * Makes `entity` a cuttable cord hanging `length` metres straight down from `top`. It gets the
 * `cuttable` property unless the entity already says either way, and a placement over the cord when it
 * has none. Call between steps.
 * @throws RangeError for a length or radius that is not above 0.
 */
export function makeCuttable(
  world: World<never>,
  entity: EntityId,
  top: Vec3,
  length: number,
  options: CuttableOptions = {},
): void {
  const radius = options.radius ?? DEFAULT_ROPE_RADIUS;
  if (!(Number.isFinite(length) && length > 0)) {
    throw new RangeError('a cuttable rope needs a length above 0 m');
  }
  if (!(Number.isFinite(radius) && radius > 0)) {
    throw new RangeError('a cuttable rope needs a radius above 0 m');
  }
  if (!hasProperty(world, entity, 'cuttable')) assignProperty(world, entity, 'cuttable', true);
  const { colliders } = options;
  let collider: ColliderHandle | null = null;
  if (colliders !== undefined) {
    collider = colliders.add({
      kind: 'box',
      min: { x: top.x - radius, y: top.y - length, z: top.z - radius },
      max: { x: top.x + radius, y: top.y, z: top.z + radius },
    });
    bindCollider(world, entity, collider);
  }
  world.add(entity, CuttableComponent, {
    top: { x: top.x, y: top.y, z: top.z },
    length,
    radius,
    collider,
    severed: false,
  });
  placeEntity(world, entity, { x: top.x, y: top.y - length / 2, z: top.z }, length / 2);
}

/**
 * Hangs physics object `entity` from `support` (a cuttable rope, or anything that can go): it gets
 * `suspended` and `support`, and is held at the pose it has now until the support goes.
 * @throws Error when `entity` is not a physics object.
 */
export function suspendFrom(world: World<never>, entity: EntityId, support: EntityId): void {
  const object = world.get(entity, PhysicsObjectComponent);
  if (object === undefined) throw new Error(`entity ${String(entity)} is not a physics object`);
  rigidBodiesOf(world).setMass(object.body as ColliderHandle, PINNED_MASS);
  assignProperty(world, entity, 'suspended', true);
  assignProperty(world, entity, 'support', support);
  world.add(entity, SuspendedComponent, {
    released: false,
    position: { ...object.position },
    rotation: { ...object.rotation },
  });
}

/**
 * Lets go of `entity` (see the file header): `suspended` turns false (blamed on `source`), the pin is
 * removed and a counterweight switch trips. Returns whether it was held.
 */
export function releaseSuspended(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const held = world.get(entity, SuspendedComponent);
  if (held === undefined || held.released) return false;
  const support = readProperty(world, entity, 'support');
  world.set(entity, SuspendedComponent, { ...held, released: true });
  if (readProperty(world, entity, 'suspended')) {
    setProperty(world, entity, 'suspended', false, source === null ? {} : { source });
  }
  world.remove(entity, SuspendedComponent);
  const object = world.get(entity, PhysicsObjectComponent);
  if (object !== undefined) {
    const kilos = Math.max(MIN_BODY_MASS, readProperty(world, entity, 'weight'));
    rigidBodiesOf(world).setMass(object.body as ColliderHandle, kilos);
  }
  if (world.has(entity, ImpactSwitchComponent)) releaseImpactSwitch(world, entity, source);
  world.events.emit(suspensionReleased, {
    tick: world.tick,
    entity,
    support,
    source,
  });
  return true;
}

/**
 * Severs cuttable `entity`: everything it supports is released and the rope goes at the end of the
 * tick (its collider with it). Returns whether it was cut: false for something that is not a cuttable
 * rope, one whose `cuttable` property is false, or one already cut.
 */
export function severCuttable(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const rope = world.get(entity, CuttableComponent);
  if (rope === undefined || rope.severed || !readProperty(world, entity, 'cuttable')) return false;
  world.set(entity, CuttableComponent, { ...rope, severed: true });
  for (const held of [...world.query(SuspendedComponent).ids()]) {
    if (supportOf(world, held) === entity) releaseSuspended(world, held, source);
  }
  world.destroy(entity);
  return true;
}

const known = <T>(value: T | undefined): T => value as T;

/** Whether a spatial strike reaches the cord (sampled along its length). */
function reaches(rope: Cuttable, hit: (point: Vec3, radius: number) => boolean): boolean {
  const steps = Math.ceil(rope.length / SAMPLE_SPACING);
  for (let i = 0; i <= steps; i++) {
    const y = rope.top.y - (rope.length * i) / steps;
    if (hit({ x: rope.top.x, y, z: rope.top.z }, rope.radius)) return true;
  }
  return false;
}

/**
 * The rope system: pins what hangs, and lets go of what lost its support some other way (a burnt
 * rope, an unloaded one, `suspended` turned off). Installed with the mechanisms.
 */
export function ropesSystem<TInput>(): System<TInput> {
  return {
    name: 'ropes',
    run: ({ world: w }) => {
      const world: World<never> = w;
      for (const entity of [...world.query(SuspendedComponent).ids()]) {
        if (supportOf(world, entity) === undefined) {
          releaseSuspended(world, entity);
          continue;
        }
        const held = known(world.get(entity, SuspendedComponent));
        const object = world.get(entity, PhysicsObjectComponent);
        if (object !== undefined) {
          teleportPhysicsObject(world, entity, held.position, held.rotation);
        }
      }
    },
  };
}

/**
 * Severs ropes struck by cutting stimuli (see the file header). Returns a function that removes the
 * subscription.
 */
export function ropeFeeds<TInput>(world: World<TInput>): () => void {
  const w: World<never> = world;
  const offs = [
    world.events.on(stimulusResolved, ({ stimulus, amount }) => {
      const { element, shape, source } = stimulus;
      if ((element !== 'slash' && element !== 'pierce') || !(amount > 0)) return;
      if (shape.kind === 'contact') {
        severCuttable(w, shape.target, source);
        return;
      }
      for (const entity of [...w.query(CuttableComponent).ids()]) {
        const rope = known(w.get(entity, CuttableComponent));
        if (
          reaches(
            rope,
            (point, radius) => shapeFalloff(shape, stimulus.falloff, point, radius) !== undefined,
          )
        ) {
          severCuttable(w, entity, source);
        }
      }
    }),
    // A change of a hanging body's weight (a soaked bridge) must not make it light again: the
    // physics layer sets its mass from the property, so it is pinned again straight after.
    world.events.on(propertyChanged, ({ entity, key }) => {
      const object = key === 'weight' && w.has(entity, SuspendedComponent);
      const body = object ? w.get(entity, PhysicsObjectComponent)?.body : undefined;
      if (body !== undefined) rigidBodiesOf(w).setMass(body as ColliderHandle, PINNED_MASS);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
