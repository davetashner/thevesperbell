// Puzzle recovery primitives (mw-e15.7): what the runtime (runtime.ts) uses to bring a puzzle back
// from a loss. Everything is deterministic and property-based: nothing here names a puzzle or an
// object kind.
//
// - `puzzle.critical`: a marker component on an entity a puzzle cannot do without (the runtime puts it
//   on the entities its puzzles list as critical; anything may carry it). A marked physics object that
//   ends up below the kill plane is put back at its home, at rest, within the tick (`returnLost`).
// - `footprintClear`: whether a body of a given size fits at a point without touching any physics
//   object, so a respawner never drops a crate into another.
// - `resetMechanisms`: puts doors and switches back to the state their scene authored.
//
// The component is registered when the first entity is marked, so worlds without puzzles in play
// hash exactly as before.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import { restHeight } from '../carry/recovery';
import { DoorComponent, LockComponent } from '../mechanisms/components';
import { moveDoor, setSwitch } from '../mechanisms/system';
import {
  PhysicsObjectComponent,
  setPhysicsObjectVelocity,
  teleportPhysicsObject,
  type PhysicsObject,
} from '../physics/objects';
import type { BodyShape } from '../physics/bodies';
import type { Vec3 } from '../stimulus/shapes';
import { puzzleRecovered } from './events';

/** A value known to be present by construction. */
const known = <T>(value: T | undefined): T => value as T;

/** A puzzle-critical entity (`puzzle.critical`; a snapshot and save key, never renamed). */
export interface PuzzleCritical {
  readonly puzzle: string;
  /** The scene spawn it is (empty when nothing named it). */
  readonly spawn: string;
  /** Where it returns to: the middle of its base, metres. */
  readonly home: Vec3;
}

export const PuzzleCriticalComponent = defineComponent<PuzzleCritical>('puzzle.critical');

/** Marks `entity` as critical to `puzzle` (registers the component on first use). */
export function markPuzzleCritical(
  world: World<never>,
  entity: EntityId,
  mark: PuzzleCritical,
): void {
  if (!world.isRegistered(PuzzleCriticalComponent)) world.register(PuzzleCriticalComponent);
  world.add(
    entity,
    PuzzleCriticalComponent,
    Object.freeze({ ...mark, home: Object.freeze({ ...mark.home }) }),
  );
}

/**
 * Puts every marked physics object below `killY` back at its home, at rest and with no speed (so the
 * fall does not break it on landing), and says so with `puzzleRecovered`. Run once per tick after the
 * physics step; returns how many it returned.
 */
export function returnLost(world: World<never>, killY: number): number {
  if (!world.isRegistered(PuzzleCriticalComponent) || !world.isRegistered(PhysicsObjectComponent)) {
    return 0;
  }
  const lost: [EntityId, PuzzleCritical, PhysicsObject][] = [];
  world.query(PuzzleCriticalComponent, PhysicsObjectComponent).forEach((entity, mark, body) => {
    if (body.position.y < killY) lost.push([entity, mark, body]);
  });
  for (const [entity, mark, body] of lost) {
    const { home } = mark;
    teleportPhysicsObject(world, entity, { ...home, y: home.y + restHeight(body.shape) });
    setPhysicsObjectVelocity(world, entity, { x: 0, y: 0, z: 0 });
    world.events.emit(puzzleRecovered, {
      puzzle: mark.puzzle,
      tick: world.tick,
      kind: 'out-of-bounds',
      entity: mark.spawn,
    });
  }
  return lost.length;
}

/** Half extents of the box around a body of `shape`, metres (a turned body counts at its widest). */
export function halfExtentsOf(shape: BodyShape): Vec3 {
  switch (shape.kind) {
    case 'box': {
      const wide = Math.max(shape.halfExtents.x, shape.halfExtents.z);
      return { x: wide, y: shape.halfExtents.y, z: wide };
    }
    case 'sphere':
      return { x: shape.radius, y: shape.radius, z: shape.radius };
    case 'capsule':
      return { x: shape.radius, y: shape.halfHeight + shape.radius, z: shape.radius };
  }
}

/** Whether a box of `halfExtents` centred on `centre` overlaps no physics object (touching is clear). */
export function footprintClear(world: World<never>, centre: Vec3, halfExtents: Vec3): boolean {
  if (!world.isRegistered(PhysicsObjectComponent)) return true;
  let clear = true;
  world.query(PhysicsObjectComponent).forEach((_entity, body) => {
    const other = halfExtentsOf(body.shape);
    if (
      Math.abs(body.position.x - centre.x) < other.x + halfExtents.x &&
      Math.abs(body.position.y - centre.y) < other.y + halfExtents.y &&
      Math.abs(body.position.z - centre.z) < other.z + halfExtents.z
    ) {
      clear = false;
    }
  });
  return clear;
}

/** A door or switch as its scene authored it. */
export type MechanismDefault =
  | {
      readonly kind: 'door';
      readonly entity: EntityId;
      readonly open: boolean;
      readonly jammed: boolean;
      /** Locked as authored; undefined: the door has no lock to restore. */
      readonly locked: boolean | undefined;
    }
  | { readonly kind: 'switch'; readonly entity: EntityId; readonly position: number };

/**
 * Returns doors and switches to their authored state: a door's lock, jam and which way it stands
 * (it swings there, noisily, like any door); a lever, crank or wheel to its authored position (the
 * signal nodes bound to it follow). A broken door stays broken (it is gone). Buttons spring back on
 * their own. Entities that are no longer doors or switches are skipped.
 */
export function resetMechanisms(world: World<never>, defaults: readonly MechanismDefault[]): void {
  for (const one of defaults) {
    if (one.kind === 'switch') {
      setSwitch(world, one.entity, one.position);
      continue;
    }
    const door = world.get(one.entity, DoorComponent);
    if (door === undefined) continue;
    // Unlocked and unjammed it can swing to its authored side; then lock and jam are put back.
    const lock = world.get(one.entity, LockComponent);
    if (lock !== undefined) world.set(one.entity, LockComponent, { ...lock, locked: false });
    world.set(one.entity, DoorComponent, { ...door, jammed: false });
    moveDoor(world, one.entity, one.open ? 1 : 0);
    const moved = known(world.get(one.entity, DoorComponent));
    world.set(one.entity, DoorComponent, { ...moved, jammed: one.jammed });
    if (lock !== undefined)
      world.set(one.entity, LockComponent, { ...lock, locked: one.locked === true });
  }
}
