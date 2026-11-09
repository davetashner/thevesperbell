// Bodies in containers (mw-e03.23): a chest, a wardrobe or a barrel with a `loot.stash` component holds
// bodies up to a weight, so a thief can cover their tracks. A stashed body is not an entity any more:
// it is a record of what it was (`kind`, from its `carry.bulky` marker) and what it weighed, so it
// saves with the container (the `stash` aspect of a level delta) and, when the container breaks or
// burns away, comes back as a body on the floor (`spawnStashedBody`). Which actor a body was is not
// kept: nothing in the sim makes a corpse carryable yet (mw-e10.5), so a body here is a bulky,
// liftable physics object of some weight.

import { CarryBulkyComponent } from '../carry/state';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { addPhysicsObject } from '../physics/objects';
import { addProperties } from '../properties/components';
import type { Vec3 } from '../stimulus/shapes';

/** One body inside a container. */
export interface StashedBody {
  /** What it was (its `carry.bulky` kind, e.g. `body`). */
  readonly kind: string;
  /** Its weight, kg. */
  readonly weight: number;
}

/** A container's room for bodies (`loot.stash`; a snapshot and save key, never renamed). */
export interface Stash {
  /** Most the bodies inside may weigh together, kg. */
  readonly capacityKg: number;
  readonly bodies: readonly StashedBody[];
}

export const StashComponent = defineComponent<Stash>('loot.stash');

/** Why a container refused a body. */
export type StashRefusal =
  /** It is locked. */
  | 'locked'
  /** It has no room for bodies. */
  | 'no-stash'
  /** The thing is not a body (it is not `carry.bulky`). */
  | 'not-a-body'
  /** It would not fit under the capacity. */
  | 'too-heavy';

/** A body went into a container. */
export interface ContainerStashed {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
  readonly body: StashedBody;
}

/** A container refused a body. */
export interface ContainerStashRefused {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
  readonly reason: StashRefusal;
}

/** A broken or burnt-out container spilled what it held. */
export interface ContainerSpilled {
  readonly tick: number;
  readonly entity: EntityId;
  /** The pickups it spawned, in order (items, then bodies). */
  readonly spawned: readonly EntityId[];
  readonly bodies: number;
}

export const containerStashed = defineEvent<ContainerStashed>('container.stashed');
export const containerStashRefused = defineEvent<ContainerStashRefused>('container.stashRefused');
export const containerSpilled = defineEvent<ContainerSpilled>('container.spilled');

/** The weight of the bodies in `stash`, kg. */
export function stashedWeight(stash: Stash): number {
  return stash.bodies.reduce((sum, body) => sum + body.weight, 0);
}

/** Room left for bodies in `stash`, kg. */
export function stashRoom(stash: Stash): number {
  return Math.max(0, stash.capacityKg - stashedWeight(stash));
}

/** Half extents of a body on the floor, metres (the carry tests' own). */
export const BODY_HALF_EXTENTS: Vec3 = Object.freeze({ x: 0.3, y: 0.2, z: 0.6 });

/** Puts a stashed body back in the world at `position`: a bulky, liftable physics object. */
export function spawnStashedBody(world: World<never>, body: StashedBody, position: Vec3): EntityId {
  const entity = world.spawn();
  addProperties(world, entity, { liftable: true, weight: body.weight });
  world.add(entity, CarryBulkyComponent, { kind: body.kind });
  addPhysicsObject(world, entity, {
    shape: { kind: 'box', halfExtents: BODY_HALF_EXTENTS },
    position,
    properties: { weight: body.weight, friction: 0.8, impactAbsorb: 0.5 },
  });
  return entity;
}
