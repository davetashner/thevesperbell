// Rope anchors, placing and retrieving ropes (mw-e10.9): a rope is tied from an item to an anchor point the level
// marks, and hangs there as a climbable line until it is untied.
//
// Level content marks an anchor by tagging a spawn `rope-anchor` (ROPE_ANCHOR_TAG) at the point the
// rope is tied, normally on the ledge, rooftop or rafter above the climb (so the player can reach it
// from the top), and gives it two affordances through its `interact`: `climb` ("Tie rope", needing
// the rope item) and `release` ("Untie rope"). `sceneRopeAnchors` makes those spawns anchors; the
// rules below do the rest, so a level needs no code to offer a rope route.
//
// Tying spends one rope item and spawns the rope entity (the same line as an authored rope, so it
// climbs alike) with the `rope` material's grade; the climbable volume is the line itself
// (`ropeVolume`). Untying destroys the rope and gives the item back. A rope that is destroyed some
// other way (burnt, cut) leaves its anchor free again. While a rope hangs, the navmesh gains an
// off-mesh climb link for climbers between its foot and its top (src/sim/nav/rope-links.ts).
//
// Registered lazily: nothing here exists in a world until `installRopePlacement` runs, so scenes
// without anchors change no hash.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import type { WorldPropertyInit } from '../properties/components';
import type { LoadedScene } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import { ClimbRopeComponent, spawnRope, type ClimbRope } from './ropes';

/** The spawn tag that marks a rope anchor. */
export const ROPE_ANCHOR_TAG = 'rope-anchor';

/** Half the width of a rope's climbable volume, metres (the climber hangs off the line). */
export const ROPE_VOLUME_RADIUS = 0.5;

/** A rope anchor (`climb.rope-anchor`; a snapshot and save key, never renamed). */
export interface RopeAnchor {
  /** The spawn id the level gave it. */
  readonly id: string;
  /** Where a rope is tied, world metres (the rope's top). */
  readonly point: Vec3;
  /** The rope hanging from it, or null when it is free. */
  readonly rope: EntityId | null;
}

export const RopeAnchorComponent = defineComponent<RopeAnchor>('climb.rope-anchor');

/** A rope tied from an item (`climb.rope-placed`; a snapshot and save key, never renamed). */
export interface PlacedRope {
  /** The anchor entity it hangs from. */
  readonly anchor: EntityId;
  /** The rope item it was tied from (given back when untied). */
  readonly item: string;
}

export const PlacedRopeComponent = defineComponent<PlacedRope>('climb.rope-placed');

/** A rope was tied (`climb.rope-placed`). */
export interface RopePlaced {
  readonly tick: number;
  readonly actor: EntityId | null;
  readonly anchor: EntityId;
  readonly rope: EntityId;
}

/** A rope was untied and its item returned (`climb.rope-retrieved`). */
export interface RopeRetrieved {
  readonly tick: number;
  readonly actor: EntityId | null;
  readonly anchor: EntityId;
}

export const ropePlaced = defineEvent<RopePlaced>('climb.rope-placed');
export const ropeRetrieved = defineEvent<RopeRetrieved>('climb.rope-retrieved');

/** Why a rope could not be tied. */
export type RopePlacementRefusal = 'not-an-anchor' | 'occupied';

/** The box a rope's line lets climbers hold: from its foot to its anchor, `ROPE_VOLUME_RADIUS` wide. */
export function ropeVolume(rope: ClimbRope): { readonly min: Vec3; readonly max: Vec3 } {
  const { anchor, length } = rope;
  const r = ROPE_VOLUME_RADIUS;
  return {
    min: { x: anchor.x - r, y: anchor.y - length, z: anchor.z - r },
    max: { x: anchor.x + r, y: anchor.y, z: anchor.z + r },
  };
}

/**
 * Makes every spawn of `loaded` tagged `rope-anchor` an anchor (registering the components first).
 * Returns the anchor entities in scene order.
 */
export function sceneRopeAnchors(world: World<never>, loaded: LoadedScene): EntityId[] {
  if (!world.isRegistered(RopeAnchorComponent)) world.register(RopeAnchorComponent);
  if (!world.isRegistered(PlacedRopeComponent)) world.register(PlacedRopeComponent);
  const anchors: EntityId[] = [];
  for (const { entity, spawn } of loaded.spawns) {
    if (!spawn.tags.includes(ROPE_ANCHOR_TAG)) continue;
    world.add(
      entity,
      RopeAnchorComponent,
      Object.freeze({ id: spawn.id, point: spawn.position, rope: null }),
    );
    anchors.push(entity);
  }
  return anchors;
}

/** The rope hanging from `anchor` right now, or undefined when it is free (or not an anchor). */
export function ropeAt(world: World<never>, anchor: EntityId): EntityId | undefined {
  const rope = world.isRegistered(RopeAnchorComponent)
    ? world.get(anchor, RopeAnchorComponent)?.rope
    : undefined;
  return rope !== null && rope !== undefined && world.isAlive(rope) ? rope : undefined;
}

/**
 * Ties a rope of `length` metres from `anchor` (an entity `sceneRopeAnchors` made): a rope entity
 * with the rope material's properties, hanging straight down, that stays until `retrieveRope` (or
 * whatever destroys it). Structural: the rope exists from the end of the tick.
 */
export function placeRope(
  world: World<never>,
  anchor: EntityId,
  options: {
    readonly length: number;
    readonly item: string;
    readonly actor?: EntityId;
    readonly properties?: WorldPropertyInit;
  },
):
  | { readonly ok: true; readonly rope: EntityId }
  | { readonly ok: false; readonly reason: RopePlacementRefusal } {
  const state = world.isRegistered(RopeAnchorComponent)
    ? world.get(anchor, RopeAnchorComponent)
    : undefined;
  if (state === undefined) return { ok: false, reason: 'not-an-anchor' };
  if (ropeAt(world, anchor) !== undefined) return { ok: false, reason: 'occupied' };
  const rope = spawnRope(
    world,
    { anchor: state.point, length: options.length },
    options.properties ?? {},
  );
  world.add(rope, PlacedRopeComponent, Object.freeze({ anchor, item: options.item }));
  world.set(anchor, RopeAnchorComponent, Object.freeze({ ...state, rope }));
  world.events.emit(ropePlaced, {
    tick: world.tick,
    actor: options.actor ?? null,
    anchor,
    rope,
  });
  return { ok: true, rope };
}

/**
 * Unties the rope hanging from `anchor`: the rope and its climbable volume and links go. Returns the
 * item it was tied from, or undefined when nothing hung there.
 */
export function retrieveRope(
  world: World<never>,
  anchor: EntityId,
  actor?: EntityId,
): string | undefined {
  const rope = ropeAt(world, anchor);
  if (rope === undefined) return undefined;
  const item = world.get(rope, PlacedRopeComponent)?.item;
  world.destroy(rope);
  const state = world.get(anchor, RopeAnchorComponent);
  if (state !== undefined)
    world.set(anchor, RopeAnchorComponent, Object.freeze({ ...state, rope: null }));
  world.events.emit(ropeRetrieved, { tick: world.tick, actor: actor ?? null, anchor });
  return item;
}

/** The placed ropes in the world, by anchor spawn id (their line, for navigation and tools). */
export function placedRopes(
  world: World<never>,
): readonly { readonly id: string; readonly rope: ClimbRope }[] {
  const found: { id: string; rope: ClimbRope }[] = [];
  if (!world.isRegistered(RopeAnchorComponent) || !world.isRegistered(ClimbRopeComponent)) {
    return found;
  }
  world.query(RopeAnchorComponent).forEach((anchor, state) => {
    const rope = ropeAt(world, anchor);
    const line = rope === undefined ? undefined : world.get(rope, ClimbRopeComponent);
    if (line !== undefined) found.push({ id: state.id, rope: line });
  });
  return found.sort((a, b) => (a.id < b.id ? -1 : 1));
}
