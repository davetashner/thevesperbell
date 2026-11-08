// Recovery anchors (mw-e17.14, ADR-0003): a quest-critical world object (a statue part, a counterweight)
// is carried physically, so it can be dropped, thrown or lost. Content gives each one a recovery
// anchor (`recovery` on its scene spawn; the content check fails one without it); when the object
// ends up below the scene's kill plane or outside its bounds, it goes back to the anchor at rest and
// `object.recovered` is emitted once (it is back in bounds afterwards). A carrier is let go of it
// first (carry's own lost rule), so nothing is left holding an object that has been sent away.
//
// Out of scope: an object that is destroyed (broken) outright has no entity left to return; quest
// content keeps such objects unbreakable (no `fragile`, no breakable profile).

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import type { BodyShape } from '../physics/bodies';
import {
  PhysicsObjectComponent,
  type PhysicsObject,
  setPhysicsObjectVelocity,
  teleportPhysicsObject,
} from '../physics/objects';
import type { Vec3 } from '../stimulus/shapes';

/** Where a quest-critical object returns to (`object.recovery`): its base rests at `at`, metres. */
export interface RecoveryAnchor {
  readonly at: Vec3;
}

export const RecoveryAnchorComponent = defineComponent<RecoveryAnchor>('object.recovery');

/** Gives `entity` its recovery anchor (registers the component on first use). */
export function addRecoveryAnchor(world: World<never>, entity: EntityId, at: Vec3): void {
  if (!world.isRegistered(RecoveryAnchorComponent)) world.register(RecoveryAnchorComponent);
  world.add(entity, RecoveryAnchorComponent, Object.freeze({ at: Object.freeze({ ...at }) }));
}

/** An axis-aligned box of the scene an object may be in, metres. */
export interface RecoveryBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface ObjectRecoveryOptions {
  /** Below this height (the scene's kill plane), metres, an object is lost. */
  readonly killY: number;
  /** An object outside this box is lost too; none by default (only the kill plane). */
  readonly bounds?: RecoveryBounds;
}

/** An object came back to its anchor. */
export interface ObjectRecovered {
  readonly tick: number;
  readonly entity: EntityId;
  /** Where it was lost, metres. */
  readonly from: Vec3;
  /** Where it was put, metres (its anchor). */
  readonly to: Vec3;
  readonly reason: 'below-kill-plane' | 'out-of-bounds';
}

/** Fired once as an object returns to its recovery anchor (`object.recovered`; never renamed). */
export const objectRecovered = defineEvent<ObjectRecovered>('object.recovered');

/** Height of the centre of a body of `shape` resting on its base above that base, metres. */
export function restHeight(shape: BodyShape): number {
  switch (shape.kind) {
    case 'box':
      return shape.halfExtents.y;
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.halfHeight + shape.radius;
  }
}

/** Why `at` is out of the scene, or undefined when it is in. */
function lostReason(
  at: Vec3,
  options: ObjectRecoveryOptions,
): ObjectRecovered['reason'] | undefined {
  if (at.y < options.killY) return 'below-kill-plane';
  const box = options.bounds;
  if (box === undefined) return undefined;
  const inside =
    at.x >= box.min.x &&
    at.x <= box.max.x &&
    at.y >= box.min.y &&
    at.y <= box.max.y &&
    at.z >= box.min.z &&
    at.z <= box.max.z;
  return inside ? undefined : 'out-of-bounds';
}

/**
 * Installs the system that returns lost quest-critical objects to their anchors. The world needs
 * physics objects (installPhysicsObjects). Once at setup, between steps; add it after the physics
 * system. `scene` may be a function, read each tick, for a world that loads one scene after another.
 */
export function installObjectRecovery<TInput>(
  world: World<TInput>,
  scene: ObjectRecoveryOptions | (() => ObjectRecoveryOptions),
): void {
  const w: World<never> = world;
  const optionsNow = typeof scene === 'function' ? scene : () => scene;
  if (!w.isRegistered(RecoveryAnchorComponent)) w.register(RecoveryAnchorComponent);
  const system: System<TInput> = {
    name: 'object-recovery',
    run({ tick }) {
      const anchored: [EntityId, RecoveryAnchor, PhysicsObject][] = [];
      w.query(RecoveryAnchorComponent, PhysicsObjectComponent).forEach((entity, anchor, body) => {
        anchored.push([entity, anchor, body]);
      });
      for (const [entity, anchor, body] of anchored) {
        const { x, y, z } = body.position;
        const from = { x, y, z };
        const reason = lostReason(from, optionsNow());
        if (reason === undefined) continue;
        const to = { x: anchor.at.x, y: anchor.at.y, z: anchor.at.z };
        teleportPhysicsObject(w, entity, { ...to, y: to.y + restHeight(body.shape) });
        setPhysicsObjectVelocity(w, entity, { x: 0, y: 0, z: 0 });
        w.events.emit(objectRecovered, { tick, entity, from, to, reason });
      }
    },
  };
  world.addSystem(system);
}
