// The displace op (mw-e06.12): teleport to a point, swap places with a creature, and dash. Blink-like
// spells open routes (CONSTITUTION: classes change possibilities), so a displacement must never put
// anyone inside a wall. Placement is a pure function of the collision queries (`planTeleport`):
//
// 1. Reach: the destination is clamped to the op's `distance` along the line from the feet.
// 2. Line of sight (`lineOfSight`): eye to the destination must cross no solid collider, else
//    `no-line-of-sight` (a closed door is a collider, an open one is not).
// 3. Path: the capsule, lifted DISPLACE_LIFT so a floor under it never scrapes, is swept along the
//    line. A wall stops it SKIN short: the caster lands at the nearest point before the wall.
// 4. Fit: from there back towards the caster in STEP-metre steps, the first point whose capsule
//    overlaps nothing wins, snapped to the floor under it (up to STEP_UP above, FLOOR_REACH below).
//    Nothing fits, or the winner is under MIN_TRAVEL from the start: `no-space`.
// 5. No floor within FLOOR_REACH: the caster arrives at the unsnapped point and falls (a chasm
//    crossing that is too long drops the caster; failure makes stories).
//
// A swap puts each party in the other's spot: the creature must fit at the caster's feet (and the
// caster at the creature's) or the swap is refused `no-space`. A refused cast is a gate failure, so
// nothing is spent (the mana is never taken; a wind-up's reservation is freed). A `free` cast (a
// scroll) skips gates, so there the op itself refuses and emits `DisplaceRefused`.
//
// Deterministic: capsule queries and the sim's own math only; no clock and no randomness.

import type { SpellEntry } from '@content/index';
import type { Capsule, CollisionWorld } from '../character/collision-world';
import { CharacterController } from '../character/system';
import { initialCharacterState } from '../character/controller';
import { defineEvent } from '../core/events';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { hypot } from '../math';
import type { SightWorld } from '../sight/sight-world';
import { PlacementComponent, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import type { CastGate, SpellPipeline } from './pipeline';
import type { DeliveryContext, DeliveryResult, OpContext, OpOf } from './registry';

/** Height the swept capsule is lifted so a floor, or knee-high clutter like a plank bridge, is not a wall, metres. */
export const DISPLACE_LIFT = 0.5;
/** Gap left between the caster and a wall it stopped at, metres. */
export const DISPLACE_SKIN = 0.05;
/** Spacing of the fit search back towards the start, metres. */
export const DISPLACE_STEP = 0.25;
/** How far above a candidate the floor search starts (a kerb it can step onto), metres. */
export const DISPLACE_STEP_UP = 0.5;
/** How far below a candidate a floor still catches the arrival; past it the caster falls, metres. */
export const DISPLACE_FLOOR_REACH = 1;
/** Gap between arrived feet and the floor, metres. */
export const DISPLACE_FLOOR_GAP = 0.02;
/** A landing closer than this to where it started is no teleport (`no-space`), metres. */
export const DISPLACE_MIN_TRAVEL = 0.5;
/** Eye height of the sight line from the start, metres. */
export const DISPLACE_EYE_HEIGHT = 1.5;
/** Height above the destination's feet the sight line ends at, metres. */
export const DISPLACE_TARGET_HEIGHT = 0.5;
/** The capsule a character without a placement radius is assumed to fill. */
export const DISPLACE_DEFAULT_CAPSULE: Capsule = Object.freeze({ radius: 0.35, height: 1.8 });

/** Why a displacement is refused. */
export type DisplaceRefusal =
  | 'no-line-of-sight'
  | 'no-space'
  | 'no-position'
  | 'no-target'
  | 'out-of-reach'
  | 'not-displaceable';

/** What placement reads of the world. */
export interface DisplaceWorld {
  readonly collision: Pick<CollisionWorld, 'sweepCapsule' | 'overlapCapsule' | 'raycast'>;
  /** Solid colliders that block sight; omitted: nothing blocks. */
  readonly sight?: SightWorld;
}

/** The result of planning a teleport. */
export type TeleportPlan =
  | {
      readonly ok: true;
      /** Where the feet arrive. */
      readonly landing: Vec3;
      /** No floor within reach: the caster arrives in the air and falls. */
      readonly falling: boolean;
    }
  | { readonly ok: false; readonly reason: 'no-line-of-sight' | 'no-space' };

export interface TeleportRequest {
  readonly capsule: Capsule;
  /** Feet now. */
  readonly from: Vec3;
  /** Feet asked for. */
  readonly to: Vec3;
  /** Farthest the feet may move, metres. */
  readonly distance: number;
  readonly lineOfSight: boolean;
}

const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const along = (a: Vec3, d: Vec3, k: number): Vec3 => ({
  x: a.x + d.x * k,
  y: a.y + d.y * k,
  z: a.z + d.z * k,
});
const lifted = (a: Vec3, h: number): Vec3 => ({ x: a.x, y: a.y + h, z: a.z });
const DOWN: Vec3 = Object.freeze({ x: 0, y: -1, z: 0 });

/** Whether a collider crosses the segment between two points. */
function sightBlocked(sight: SightWorld | undefined, from: Vec3, to: Vec3): boolean {
  if (sight === undefined) return false;
  return sight.firstCrossing(from, to) !== undefined;
}

/** Whether `at` can be seen from `from`'s eye. */
function visible(world: DisplaceWorld, from: Vec3, at: Vec3): boolean {
  return !sightBlocked(
    world.sight,
    lifted(from, DISPLACE_EYE_HEIGHT),
    lifted(at, DISPLACE_TARGET_HEIGHT),
  );
}

/** The feet position a candidate settles on: floor-snapped, or the point itself with `falling`. */
function settle(
  world: DisplaceWorld,
  candidate: Vec3,
): { readonly feet: Vec3; readonly falling: boolean } {
  const floor = world.collision.raycast(
    lifted(candidate, DISPLACE_STEP_UP),
    DOWN,
    DISPLACE_STEP_UP + DISPLACE_FLOOR_REACH,
  );
  if (floor === undefined) return { feet: candidate, falling: true };
  return {
    feet: { x: candidate.x, y: floor.point.y + DISPLACE_FLOOR_GAP, z: candidate.z },
    falling: false,
  };
}

/**
 * Plans a teleport of `request.capsule` (see the file header). Never lands inside geometry: a plan
 * that succeeds has a landing whose capsule overlaps nothing.
 */
export function planTeleport(world: DisplaceWorld, request: TeleportRequest): TeleportPlan {
  const { capsule, from } = request;
  const offset = minus(request.to, from);
  const wanted = hypot(offset.x, offset.y, offset.z);
  const reach = Math.min(wanted, request.distance);
  const direction =
    wanted > 0 ? { x: offset.x / wanted, y: offset.y / wanted, z: offset.z / wanted } : offset;
  const aimed = along(from, direction, reach);
  if (request.lineOfSight && !visible(world, from, aimed)) {
    return { ok: false, reason: 'no-line-of-sight' };
  }
  // The lifted capsule is shorter by the lift, so its crown stays where the standing one is.
  const swept: Capsule = {
    radius: capsule.radius,
    height: Math.max(2 * capsule.radius, capsule.height - DISPLACE_LIFT),
  };
  const hit =
    reach > 0
      ? world.collision.sweepCapsule(swept, lifted(from, DISPLACE_LIFT), direction, reach)
      : undefined;
  const travel = hit === undefined ? reach : Math.max(0, hit.distance - DISPLACE_SKIN);
  for (let d = travel; d >= DISPLACE_MIN_TRAVEL; d -= DISPLACE_STEP) {
    const settled = settle(world, along(from, direction, d));
    if (!world.collision.overlapCapsule(capsule, settled.feet)) {
      return { ok: true, landing: settled.feet, falling: settled.falling };
    }
  }
  return { ok: false, reason: 'no-space' };
}

/** Whether `capsule` fits with its feet at `feet`. */
export function fitsAt(world: DisplaceWorld, capsule: Capsule, feet: Vec3): boolean {
  return !world.collision.overlapCapsule(capsule, lifted(feet, DISPLACE_FLOOR_GAP));
}

/** A creature or the caster moved (`Displaced`). */
export interface DisplacedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  /** Who moved (the caster, or the creature a swap exchanged it with). */
  readonly entity: EntityId;
  readonly mode: DisplaceOp['mode'];
  readonly from: Vec3;
  readonly to: Vec3;
  /** Arrived with no floor beneath, falling. */
  readonly falling: boolean;
}
export const Displaced = defineEvent<DisplacedInfo>('Displaced');

/** A displacement was refused after the cast was paid for (a free cast; paid casts fail at the gate). */
export interface DisplaceRefusedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly mode: DisplaceOp['mode'];
  readonly reason: DisplaceRefusal;
}
export const DisplaceRefused = defineEvent<DisplaceRefusedInfo>('DisplaceRefused');

export type DisplaceOp = OpOf<'displace'>;

export interface SpellDisplaceOptions {
  readonly collision: Pick<CollisionWorld, 'sweepCapsule' | 'overlapCapsule' | 'raycast'>;
  readonly sight?: SightWorld;
}

/** What a displacement will do, or why not. */
type Plan =
  | {
      readonly ok: true;
      readonly moves: readonly {
        readonly entity: EntityId;
        readonly from: Vec3;
        readonly to: Vec3;
        readonly falling: boolean;
      }[];
    }
  | { readonly ok: false; readonly reason: DisplaceRefusal };

/** Where a character's feet are, and the radius it fills; undefined without a placement. */
const stand = (world: World<never>, entity: EntityId) => {
  const at = placementOf(world, entity);
  return at === undefined ? undefined : { feet: { x: at.x, y: at.y, z: at.z }, radius: at.radius };
};

/**
 * Wires displacement into a world that has `installSpells`: the `displace` op, the `summonPoint`
 * delivery (a point chosen within range, the aim a displacement goes to) and the gate that refuses
 * an impossible displacement before anything is spent. Once at setup, outside a step.
 */
export function installSpellDisplace(
  world: World<never>,
  pipeline: SpellPipeline,
  options: SpellDisplaceOptions,
): void {
  const placement: DisplaceWorld = {
    collision: options.collision,
    ...(options.sight === undefined ? {} : { sight: options.sight }),
  };
  /** The capsule a character of placement radius `radius` fills (0.35 m when it has none). */
  const capsuleFor = (radius: number): Capsule =>
    radius > 0
      ? { radius, height: Math.max(DISPLACE_DEFAULT_CAPSULE.height, 2 * radius) }
      : DISPLACE_DEFAULT_CAPSULE;

  const plan = (
    caster: EntityId,
    op: DisplaceOp,
    aim: Vec3 | undefined,
    target: EntityId | null | undefined,
  ): Plan => {
    const here = stand(world, caster);
    if (here === undefined) return { ok: false, reason: 'no-position' };
    const start = here.feet;
    if (op.mode === 'swap') {
      if (target === undefined || target === null || target === caster || !world.isAlive(target)) {
        return { ok: false, reason: 'no-target' };
      }
      const there = stand(world, target);
      if (there === undefined) return { ok: false, reason: 'no-position' };
      const other = there.feet;
      if (!world.has(target, CharacterController) || !world.has(caster, CharacterController)) {
        return { ok: false, reason: 'not-displaceable' };
      }
      const apart = hypot(other.x - start.x, other.y - start.y, other.z - start.z);
      if (apart > op.distance) return { ok: false, reason: 'out-of-reach' };
      if (op.lineOfSight && !visible(placement, start, other)) {
        return { ok: false, reason: 'no-line-of-sight' };
      }
      // The caster's spot is the creature's to fit, and the creature's the caster's.
      if (
        !fitsAt(placement, capsuleFor(there.radius), start) ||
        !fitsAt(placement, capsuleFor(here.radius), other)
      ) {
        return { ok: false, reason: 'no-space' };
      }
      return {
        ok: true,
        moves: [
          { entity: caster, from: start, to: other, falling: false },
          { entity: target, from: other, to: start, falling: false },
        ],
      };
    }
    if (aim === undefined) return { ok: false, reason: 'no-target' };
    if (!world.has(caster, CharacterController)) return { ok: false, reason: 'not-displaceable' };
    // A dash runs the full distance along the aimed heading, level; a teleport goes to the point.
    let to = aim;
    if (op.mode === 'dash') {
      const dx = aim.x - start.x;
      const dz = aim.z - start.z;
      const run = hypot(dx, dz);
      to =
        run > 0
          ? {
              x: start.x + (dx / run) * op.distance,
              y: start.y,
              z: start.z + (dz / run) * op.distance,
            }
          : start;
    }
    const planned = planTeleport(placement, {
      capsule: capsuleFor(here.radius),
      from: start,
      to,
      distance: op.distance,
      lineOfSight: op.lineOfSight,
    });
    return planned.ok
      ? {
          ok: true,
          moves: [{ entity: caster, from: start, to: planned.landing, falling: planned.falling }],
        }
      : { ok: false, reason: planned.reason };
  };

  /** Puts `entity` at rest on `to` (placement follows at once; the controller does its own next tick). */
  const move = (entity: EntityId, to: Vec3): void => {
    world.set(entity, CharacterController, initialCharacterState(to));
    const at = placementOf(world, entity);
    if (at !== undefined && world.has(entity, PlacementComponent)) {
      world.set(entity, PlacementComponent, { ...to, radius: at.radius });
    }
  };

  pipeline.ops.register('displace', (ctx: OpContext, op: DisplaceOp) => {
    const planned = plan(ctx.caster, op, ctx.point, ctx.target);
    if (!planned.ok) {
      world.events.emit(DisplaceRefused, {
        tick: world.tick,
        caster: ctx.caster,
        mode: op.mode,
        reason: planned.reason,
      });
      return undefined;
    }
    const falling = planned.moves.some((m) => m.falling);
    for (const m of planned.moves) {
      move(m.entity, m.to);
      world.events.emit(Displaced, {
        tick: world.tick,
        caster: ctx.caster,
        entity: m.entity,
        mode: op.mode,
        from: m.from,
        to: m.to,
        falling: m.falling,
      });
    }
    return { mode: op.mode, falling };
  });

  pipeline.deliveries.register(
    'summonPoint',
    (ctx: DeliveryContext<'summonPoint'>): DeliveryResult => {
      const { request, delivery } = ctx;
      if (request.aim === undefined) return { kind: 'fizzle', reason: 'no-target' };
      const start = stand(world, request.caster)?.feet;
      if (start === undefined) return { kind: 'fizzle', reason: 'no-position' };
      const apart = hypot(
        request.aim.x - start.x,
        request.aim.y - start.y,
        request.aim.z - start.z,
      );
      if (apart > delivery.range) return { kind: 'fizzle', reason: 'out-of-reach' };
      if (delivery.lineOfSight && !visible(placement, start, request.aim)) {
        return { kind: 'fizzle', reason: 'no-line-of-sight' };
      }
      return { kind: 'hits', hits: [{ target: null, point: request.aim }] };
    },
  );

  const gate: CastGate = {
    name: 'displace',
    check: ({
      request,
      spell,
    }: {
      request: { caster: EntityId; aim?: Vec3; target?: EntityId };
      spell: SpellEntry;
    }) => {
      for (const effect of spell.effects) {
        if (effect.op !== 'displace') continue;
        const planned = plan(request.caster, effect, request.aim, request.target);
        if (!planned.ok) return planned.reason;
      }
      return undefined;
    },
  };
  pipeline.addGate(gate);
}
