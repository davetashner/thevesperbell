// Aiming a spell (mw-e06.15): from the camera's reticle ray to the `aim` point and `target` the sim's
// cast command carries. Which of four targeting modes a spell uses follows from its delivery, never
// from its id:
//
//   reticle   projectile, beam      the first thing the reticle ray meets within the spell's range
//                                   (level geometry or a creature's hurtbox), else the point at max
//                                   range straight ahead. Always valid: a bolt fired into the sky is
//                                   still fired.
//   ground    aoe at the aim point, the floor under the reticle, clamped to the spell's range from the
//             summonPoint           caster. Invalid (a red marker, nothing sent) when there is no floor
//                                   there, or, for `summonPoint` with lineOfSight, when something
//                                   blocks the view from the caster.
//   self      self, aoe at caster   the caster; nothing to aim.
//   target    touch                 the locked target, else the creature under the reticle. Invalid
//                                   with none, or beyond reach.
//
// The ray starts where it passes the caster's head, not at the camera: a wall behind the player, or
// the player's own shoulder, never takes the shot. Pure: reads the world and the collision queries,
// changes nothing. The same function draws the preview marker each frame and builds the command when
// the cast button goes down, so what the player sees is what is sent.

import type { SpellEntry } from '@content/index';
import {
  hurtboxTargets,
  placementOf,
  segmentHurtboxHits,
  type CollisionWorld,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';

/** A view ray: where the camera is and the unit direction it looks. */
export interface AimRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export type TargetingMode = 'reticle' | 'ground' | 'self' | 'target';

/** Why an aim is not valid (the marker turns red; the cast is not sent). */
export type AimInvalid = 'no-floor' | 'blocked' | 'no-target' | 'out-of-reach' | 'no-caster';

interface AimBase {
  readonly mode: TargetingMode;
  /** The creature the reticle (or the lock) names, for `target` spells and the HUD. */
  readonly target: EntityId | null;
  /** The aim ran past the spell's range and was brought back to it. */
  readonly clamped: boolean;
  /** The spell's reach in metres (0 for self). */
  readonly range: number;
}

/** Where a spell would go if cast now: valid with the aim point to send, or why it is not. */
export type AimResult =
  | (AimBase & { readonly valid: true; readonly point: Vec3; readonly reason: null })
  | (AimBase & {
      readonly valid: false;
      /** Where the marker sits anyway; null only when there is no caster to measure from. */
      readonly point: Vec3 | null;
      readonly reason: AimInvalid;
    });

/** Eye height above the caster's feet that the reticle ray is measured from, metres. */
export const AIM_HEAD_HEIGHT = 1.5;
/** Chest height a ground point's view is checked from, metres. */
export const AIM_CHEST_HEIGHT = 1.2;
/** How far the ray looks for a floor or wall when the spell has no range of its own, metres. */
export const AIM_FAR = 60;
/** How far above the aimed floor the ground search starts, and how far below it ends, metres. */
const FLOOR_ABOVE = 1;
const FLOOR_BELOW = 12;
/** Radius of the ray when it tests creatures, metres. */
const RAY_RADIUS = 0.05;
/** Slack on a blocked view test: contact within this of the point is the floor itself, metres. */
const SIGHT_SLACK = 0.15;

/** How `spell` is aimed. */
export function targetingMode(spell: SpellEntry): TargetingMode {
  const { delivery } = spell;
  switch (delivery.kind) {
    case 'projectile':
    case 'beam':
      return 'reticle';
    case 'summonPoint':
      return 'ground';
    case 'aoe':
      return delivery.origin === 'aim' ? 'ground' : 'self';
    case 'touch':
      return 'target';
    case 'self':
      return 'self';
  }
}

/** The farthest `spell` reaches from the caster, metres (0 when it has no reach). */
export function spellRange(spell: SpellEntry): number {
  const { delivery } = spell;
  switch (delivery.kind) {
    case 'projectile':
      return delivery.maxRange;
    case 'beam':
      return delivery.length;
    case 'aoe':
    case 'summonPoint':
      return delivery.range;
    case 'touch':
      return delivery.reach;
    case 'self':
      return 0;
  }
}

/** What aiming needs of the world. */
export interface AimContext {
  readonly world: World<never>;
  readonly collision: Pick<CollisionWorld, 'raycast'>;
  readonly caster: EntityId;
  /** The creature the player is locked on to, if any. */
  readonly locked?: () => EntityId | null | undefined;
}

const add = (a: Vec3, b: Vec3, k: number): Vec3 => ({
  x: a.x + b.x * k,
  y: a.y + b.y * k,
  z: a.z + b.z * k,
});
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

/** Where the ray first meets something solid or alive within `reach` of `from`. */
function firstContact(
  ctx: AimContext,
  from: Vec3,
  direction: Vec3,
  reach: number,
): { point: Vec3; creature: EntityId | null } | undefined {
  const wall = ctx.collision.raycast(from, direction, reach);
  const end = add(from, direction, wall === undefined ? reach : wall.distance);
  const creature = segmentHurtboxHits(
    hurtboxTargets(ctx.world),
    { from, to: end, radius: RAY_RADIUS },
    (entity) => entity === ctx.caster,
  )[0];
  if (creature !== undefined) {
    const length = wall === undefined ? reach : wall.distance;
    return { point: add(from, direction, length * creature.fraction), creature: creature.entity };
  }
  return wall === undefined ? undefined : { point: wall.point, creature: null };
}

/** Where `spell` would go if the player cast it along `ray` now. */
export function resolveAim(spell: SpellEntry, ray: AimRay, ctx: AimContext): AimResult {
  const mode = targetingMode(spell);
  const range = spellRange(spell);
  const at = placementOf(ctx.world, ctx.caster);
  const base = { mode, range, target: null, clamped: false };
  if (at === undefined) {
    return { ...base, point: null, valid: false, reason: 'no-caster' };
  }
  const feet: Vec3 = { x: at.x, y: at.y, z: at.z };
  if (mode === 'self') return { ...base, point: feet, valid: true, reason: null };

  // The ray starts where it passes the caster's head.
  const head = add(feet, { x: 0, y: 1, z: 0 }, AIM_HEAD_HEIGHT);
  const along = Math.max(
    0,
    dot(
      { x: head.x - ray.origin.x, y: head.y - ray.origin.y, z: head.z - ray.origin.z },
      ray.direction,
    ),
  );
  const start = add(ray.origin, ray.direction, along);

  if (mode === 'reticle') {
    const contact = firstContact(ctx, start, ray.direction, range);
    return contact === undefined
      ? {
          ...base,
          point: add(start, ray.direction, range),
          clamped: true,
          valid: true,
          reason: null,
        }
      : { ...base, point: contact.point, target: contact.creature, valid: true, reason: null };
  }

  if (mode === 'target') return resolveTarget(spell, ray, ctx, { start, feet, base });
  return resolveGround(spell, ray, ctx, { start, feet, base });
}

interface Frame {
  readonly start: Vec3;
  readonly feet: Vec3;
  readonly base: Pick<AimResult, 'mode' | 'range' | 'target' | 'clamped'>;
}

function resolveTarget(spell: SpellEntry, ray: AimRay, ctx: AimContext, frame: Frame): AimResult {
  const { base, feet } = frame;
  const locked = ctx.locked?.() ?? null;
  const target =
    locked !== null && ctx.world.isAlive(locked)
      ? locked
      : (firstContact(ctx, frame.start, ray.direction, AIM_FAR)?.creature ?? null);
  const there = target === null ? undefined : placementOf(ctx.world, target);
  if (target === null || there === undefined) {
    return { ...base, point: null, valid: false, reason: 'no-target' };
  }
  const gap = Math.hypot(there.x - feet.x, there.y - feet.y, there.z - feet.z);
  const point = { x: there.x, y: there.y, z: there.z };
  return gap <= spellRange(spell) + there.radius
    ? { ...base, point, target, valid: true, reason: null }
    : { ...base, point, target, valid: false, reason: 'out-of-reach' };
}

function resolveGround(spell: SpellEntry, ray: AimRay, ctx: AimContext, frame: Frame): AimResult {
  const { base, feet, start } = frame;
  const range = base.range;
  // The surface the reticle looks at; with none (sky) the point far along the ray.
  const seen = ctx.collision.raycast(start, ray.direction, AIM_FAR);
  const looked = seen === undefined ? add(start, ray.direction, AIM_FAR) : seen.point;
  const dx = looked.x - feet.x;
  const dz = looked.z - feet.z;
  const flat = Math.hypot(dx, dz);
  const clamped = flat > range;
  const k = clamped && flat > 0 ? range / flat : 1;
  const x = feet.x + dx * k;
  const z = feet.z + dz * k;
  // The floor there: from just above what the ray hit (or above the caster's feet when it was
  // brought back), down.
  const top = (clamped || seen === undefined ? feet.y : looked.y) + FLOOR_ABOVE;
  const floor = ctx.collision.raycast({ x, y: top, z }, DOWN, FLOOR_ABOVE + FLOOR_BELOW);
  if (floor === undefined) {
    return { ...base, point: { x, y: feet.y, z }, clamped, valid: false, reason: 'no-floor' };
  }
  const point = floor.point;
  if (spell.delivery.kind === 'summonPoint' && spell.delivery.lineOfSight) {
    const eye = add(feet, { x: 0, y: 1, z: 0 }, AIM_CHEST_HEIGHT);
    const to = { x: point.x - eye.x, y: point.y + SIGHT_SLACK - eye.y, z: point.z - eye.z };
    const length = Math.hypot(to.x, to.y, to.z);
    const direction = { x: to.x / length, y: to.y / length, z: to.z / length };
    const blocker = ctx.collision.raycast(eye, direction, length - SIGHT_SLACK);
    if (blocker !== undefined) return { ...base, point, clamped, valid: false, reason: 'blocked' };
  }
  return { ...base, point, clamped, valid: true, reason: null };
}

/** Radius of the ground preview for `spell`, metres: its area's reach, else a small ring. */
export function previewRadius(spell: SpellEntry): number {
  const { delivery } = spell;
  if (delivery.kind !== 'aoe') return 0.5;
  const { shape } = delivery;
  return shape.kind === 'sphere' || shape.kind === 'decal' ? shape.radius : shape.length / 2;
}
