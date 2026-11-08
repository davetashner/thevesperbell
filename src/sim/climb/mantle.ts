// Mantling and ledge hangs (mw-e02.12): the traversal hook that pulls a character up onto crates,
// windowsills and balconies, and lets climbers hang from, shimmy along, pull up from and drop off
// ledges. Deterministic sim: every move is a sim-driven curve (never root motion), animation only
// reads the resulting locomotion state (`mantle`, `hang`) and events (mantleStart, ledgeGrab).
//
// Detection. Candidates come from the scene's ledge markup (the ledge pass, ledges.ts, with its
// per-edge overrides): ledges whose face the character is moving (or, standing still, looking) into,
// close enough ahead, at a height the move allows. Each candidate is then validated with shape
// casts against the collision world: a ray down onto the top (standing room, and a top no steeper
// than maxTopSlope), a capsule check where the character will stand (headroom: standing, else
// crouched, else refused), and capsule sweeps along the whole path (approach, rise, over the lip),
// so a ceiling, an overhang or a clutter of props refuses the move rather than being clipped.
//
// What happens (heights are the ledge top above the feet; the tuning is content, `ledge`):
//   walking into a ledge up to autoMantleHeight      mantle, no jump needed (all classes)
//   jump at a ledge up to mantleHeight               mantle (all classes)
//   jump at a ledge up to hangReach                  grab and hang (LEDGE_HANG_CAPABILITY); a ledge
//                                                    lower than hangDepth is pulled straight up
//   moving into a ledge in the air, within hangReach grab (LEDGE_HANG_CAPABILITY), as above
//   crouch-walking off an edge                       lower into a hang (LEDGE_HANG_CAPABILITY)
// While hanging: sideways input shimmies at shimmySpeed along the ledge and on to ledges in line
// with it across gaps up to shimmyGap (stopping at ends, wider gaps and anything in the way); jump
// pulls up (when the top has room), or jumps back off the wall when pushing away; crouch drops.
//
// Hands need something to hold: a burning ledge, or a frozen one without CLIMB_ICE_CAPABILITY, is
// refused, and one that becomes so while hanging is held for slipGraceMs before the hands let go. A
// ledge whose piece is destroyed drops the character at once; an impulse (a blow, a blast) knocks it
// off, keeping the launch.
//
// The ledge and move in progress are CharacterState.ledge (plain data: snapshotted, hashed,
// replayed). Climbing walls, ladders and ropes is mw-e02.13 (climb.ts): it hands a climber reaching
// the top of its surface over to this hook's pull-up (`climbOut`).

import type { Frozen, LedgeTuning } from '@content/index';
import type { Capsule, CollisionWorld } from '../character/collision-world';
import { SKIN, type CharacterInput, type CharacterState } from '../character/controller';
import { radians } from '../character/greybox';
import type {
  LedgeTraversal,
  TraversalContext,
  TraversalHook,
  TraversalPath,
} from '../character/traversal';
import { add, dot, DOWN, flat, length, scale, sub, UP, vec, ZERO } from '../character/vec';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { at as nth } from '../geom/vec';
import { cos, sin } from '../math';
import { readProperty } from '../properties/components';
import type { Vec3 } from '../stimulus/shapes';
import type { Ledge, LedgeIndex } from './ledges';
import { CLIMB_ICE_CAPABILITY } from './surfaces';

/** Capability that lets an actor grab, hang from and shimmy along ledges (class data, mw-e02.3). */
export const LEDGE_HANG_CAPABILITY = 'verb.climb.ledge';

/**
 * The defaults when a controller profile has no `ledge` block (the shipped player profile states
 * its own, src/content/data/controller): the mw-e02.12 heights and timings.
 */
export const DEFAULT_LEDGE_TUNING: Frozen<LedgeTuning> = Object.freeze({
  autoMantleHeight: 1,
  mantleHeight: 1.6,
  hangReach: 2.2,
  hangDepth: 2,
  reach: 1,
  grabReach: 0.3,
  maxTopSlope: 20,
  autoMantleMs: 400,
  mantleMs: 600,
  pullUpMs: 700,
  grabMs: 250,
  lowerMs: 500,
  shimmySpeed: 1,
  shimmyGap: 0.3,
  slipGraceMs: 1000,
  jumpBack: Object.freeze({ away: 4, up: 6 }),
});

/** Why hands cannot hold a ledge. */
export type LedgeSlip = 'gone' | 'burning' | 'slippery';

/**
 * Whether hands can hold the ledge of piece `entity` right now: undefined when they can, otherwise
 * why not: the piece is gone, burning, or frozen (held only with CLIMB_ICE_CAPABILITY). Read live,
 * so property changes apply on the next tick.
 */
export function ledgeSlip(
  world: World<never>,
  entity: EntityId | undefined,
  capabilities: readonly string[],
): LedgeSlip | undefined {
  if (entity === undefined || !world.isAlive(entity)) return 'gone';
  if (readProperty(world, entity, 'burning')) return 'burning';
  if (readProperty(world, entity, 'frozen') && !capabilities.includes(CLIMB_ICE_CAPABILITY)) {
    return 'slippery';
  }
  return undefined;
}

export interface LedgeTraversalOptions {
  /** The sim world the scene's pieces live in (their properties say whether a ledge holds). */
  readonly world: World<never>;
  /** The scene's ledges (`sceneLedges`). */
  readonly ledges: LedgeIndex;
  /** A character's capabilities (class, tools); none by default. */
  readonly capabilities?: (entity: EntityId | undefined) => readonly string[];
  /**
   * Whether a character may not start a mantle or a hang right now because its hands are full
   * (carrying, ADR-0003); it is asked only when a grab would otherwise start. Never by default.
   */
  readonly handsFull?: (entity: EntityId | undefined) => boolean;
}

/** Gap between the capsule and a wall it hangs or climbs against. */
const WALL_GAP = 2 * SKIN;
/** Distance tolerance for geometry tests, metres. */
const EPS = 1e-6;
/** A ledge counts as ahead when its face is within 45° of the direction of travel. */
const FACING = Math.SQRT1_2;
/** How far outside the face the capsule may be pushed in by a rounded edge and still count. */
const TOUCH = 0.05;

/** A candidate ledge with where the hands would take it. */
interface Spot {
  readonly ledge: Ledge;
  readonly entity: EntityId | undefined;
  /** The point of the ledge the hands take (at its top), in line with the character. */
  readonly grip: Vec3;
  /** The character's centre outside the ledge's face, metres (negative: over its top). */
  readonly out: number;
  /** Ledge top above the feet, metres. */
  readonly height: number;
}

/** A hook call's context with the ledge tuning in force. */
interface LedgeContext extends TraversalContext {
  readonly lt: Frozen<LedgeTuning>;
}

/** `ctx` with its profile's ledge tuning, or the defaults. */
const withTuning = (ctx: TraversalContext): LedgeContext => ({
  ...ctx,
  lt: ctx.tuning.ledge ?? DEFAULT_LEDGE_TUNING,
});

/** A move a hook step starts. */
interface Move {
  readonly mode: 'mantle' | 'hang';
  readonly ledge: number;
  readonly path: TraversalPath;
}

/** Smoothstep: eases a move in and out, so the character starts and stops at rest. */
const smooth = (u: number): number => u * u * (3 - 2 * u);

/** The point `s` metres along the polyline `points`. */
function along(points: readonly Vec3[], s: number): Vec3 {
  let rest = s;
  let from = nth(points, 0);
  for (const to of points.slice(1)) {
    const leg = length(sub(to, from));
    if (rest < leg) return add(from, scale(sub(to, from), rest / leg));
    rest -= leg;
    from = to;
  }
  return from;
}

/** Total length of a polyline. */
function pathLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += length(sub(nth(points, i), nth(points, i - 1)));
  return total;
}

/** Ticks a move of `ms` lasts at the step `dt` (at least one). */
const ticksOf = (ms: number, dt: number): number => Math.max(1, Math.round(ms / 1000 / dt));

/** The move input in world space (camera-relative, length at most 1). */
export function moveVector(input: CharacterInput): Vec3 {
  const { x, y } = input.actions.move;
  const deflection = Math.sqrt(x * x + y * y);
  const k = deflection > 1 ? 1 / deflection : 1;
  const s = sin(input.cameraYaw);
  const c = cos(input.cameraYaw);
  // right = (cos, 0, −sin), forward = (−sin, 0, −cos), as the controller steers.
  return vec((c * x - s * y) * k, 0, (-s * x - c * y) * k);
}

/** The direction the camera looks, flat. */
function cameraForward(input: CharacterInput): Vec3 {
  return vec(-sin(input.cameraYaw), 0, -cos(input.cameraYaw));
}

/** Unit direction along a ledge, start to end. */
function tangent(ledge: Ledge): Vec3 {
  const d = sub(ledge.end, ledge.start);
  return scale(d, 1 / length(d));
}

/** The character's state handed back to locomotion, airborne, at `velocity`. */
function release(state: CharacterState, velocity: Vec3): CharacterState {
  const next: CharacterState = {
    ...state,
    velocity,
    traversal: null,
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    airTicks: state.airTicks + 1,
    jumped: true,
    jumpAge: -1,
  };
  delete (next as { ledge?: LedgeTraversal }).ledge;
  return next;
}

/** The ledge hook, which also pulls climbers up at the top of what they climb (mw-e02.13). */
export interface LedgeTraversalHook extends TraversalHook {
  /**
   * The pull-up a climber facing against `normal` starts onto a ledge of that face within `reach`
   * above its feet (and within the jump reach ahead), when its hands can hold the ledge and there is
   * room on top: the state starting the mantle, or undefined. `ctx.state` must carry no other
   * traversal's data (the climb hook hands over a bare state).
   */
  climbOut(ctx: TraversalContext, normal: Vec3, reach: number): CharacterState | undefined;
}

/**
 * The mantle and ledge-hang traversal hook (see the file header). Put it in the character
 * controller's `hooks`; it owns the `mantle` and `hang` modes.
 */
export function ledgeTraversal(options: LedgeTraversalOptions): LedgeTraversalHook {
  const { world, ledges } = options;
  const capabilitiesOf = options.capabilities ?? (() => []);

  /** Whether `capsule` fits with its feet at `feet` (slimmed and lifted by the skin, like standing up). */
  const fits = (collision: CollisionWorld, capsule: Capsule, feet: Vec3): boolean =>
    !collision.overlapCapsule(
      { radius: capsule.radius - SKIN, height: capsule.height - SKIN },
      add(feet, vec(0, SKIN, 0)),
    );

  /** Whether `capsule` sweeps along `points` without touching anything. */
  const clear = (collision: CollisionWorld, capsule: Capsule, points: readonly Vec3[]): boolean => {
    for (let i = 1; i < points.length; i++) {
      const from = nth(points, i - 1);
      const leg = sub(nth(points, i), from);
      const distance = length(leg);
      if (distance < EPS) continue;
      if (collision.sweepCapsule(capsule, from, scale(leg, 1 / distance), distance)) return false;
    }
    return true;
  };

  /** The ledge's spot for a character at `feet` with radius `radius`, if it is in line with it. */
  const spotOf = (
    ledge: Ledge,
    entity: EntityId | undefined,
    feet: Vec3,
    radius: number,
  ): Spot | undefined => {
    const t = tangent(ledge);
    const span = length(sub(ledge.end, ledge.start));
    const a = dot(flat(sub(feet, ledge.start)), t);
    const lo = Math.min(radius, span / 2);
    const hi = Math.max(span - radius, span / 2);
    const at = Math.min(hi, Math.max(lo, a));
    if (Math.abs(a - at) > radius) return undefined;
    const grip = add(ledge.start, scale(t, at));
    return {
      ledge,
      entity,
      grip,
      out: dot(flat(sub(feet, grip)), ledge.normal),
      height: grip.y - feet.y,
    };
  };

  /** Candidate ledges near the character, nearest face first (ties by id). */
  const spots = (ctx: LedgeContext): Spot[] => {
    const tuning = ctx.lt;
    const { position } = ctx.state;
    const { radius } = ctx.tuning.capsule;
    const across = radius + tuning.reach;
    const hits = ledges.near(
      world,
      position,
      Math.sqrt(across * across + tuning.hangReach * tuning.hangReach),
    );
    const found: Spot[] = [];
    for (const hit of hits) {
      const spot = spotOf(hit.ledge, hit.entity, position, radius);
      if (spot !== undefined) found.push(spot);
    }
    return found.sort((a, b) => a.out - b.out || a.ledge.id - b.ledge.id);
  };

  /**
   * A mantle from `from` onto `spot`'s ledge taking `ms`: the path (approach to the face, rise, over
   * the lip) and how the character ends up, or undefined when the top or the path has no room.
   */
  const mantle = (ctx: LedgeContext, spot: Spot, from: Vec3, ms: number): Move | undefined => {
    const { world: collision, tuning, params } = ctx;
    const ledgeTuning = ctx.lt;
    const { radius, height, crouchHeight } = tuning.capsule;
    const n = spot.ledge.normal;
    const inside = sub(spot.grip, scale(n, radius + WALL_GAP));
    const top = collision.raycast(add(inside, vec(0, 0.1, 0)), DOWN, 0.2);
    if (top === undefined || top.normal.y < cos(radians(ledgeTuning.maxTopSlope))) return undefined;
    const end = vec(inside.x, top.point.y + SKIN, inside.z);
    const standing = { radius, height };
    const crouched = { radius, height: crouchHeight };
    const capsule = fits(collision, standing, end)
      ? standing
      : fits(collision, crouched, end)
        ? crouched
        : undefined;
    if (capsule === undefined) return undefined;
    const face = add(spot.grip, scale(n, radius + WALL_GAP));
    const points = [from, vec(face.x, from.y, face.z), vec(face.x, end.y, face.z), end];
    if (!clear(collision, capsule, points)) return undefined;
    return {
      mode: 'mantle',
      ledge: spot.ledge.id,
      path: {
        points,
        tick: 0,
        ticks: ticksOf(ms, params.dt),
        then: capsule === standing ? 'stand' : 'crouch',
      },
    };
  };

  /**
   * A move from `from` into a hang from `spot`'s ledge taking `ms`: along the flat first when
   * `flatFirst` (an approach, or over the edge when lowering), then up or down to the hang.
   */
  const hang = (ctx: LedgeContext, spot: Spot, from: Vec3, ms: number): Move | undefined => {
    const { world: collision, tuning, params } = ctx;
    const ledgeTuning = ctx.lt;
    const { radius, height } = tuning.capsule;
    const face = add(spot.grip, scale(spot.ledge.normal, radius + WALL_GAP));
    const at = vec(face.x, spot.grip.y - ledgeTuning.hangDepth, face.z);
    const standing = { radius, height };
    if (!fits(collision, standing, at)) return undefined;
    const points = [from, vec(at.x, from.y, at.z), at];
    if (!clear(collision, standing, points)) return undefined;
    return {
      mode: 'hang',
      ledge: spot.ledge.id,
      path: { points, tick: 0, ticks: ticksOf(ms, params.dt), then: 'hang' },
    };
  };

  /** The move a character in ordinary locomotion starts this tick, if any. */
  const plan = (ctx: LedgeContext): Move | undefined => {
    const next = planGrab(ctx);
    return next !== undefined && options.handsFull?.(ctx.entity) === true ? undefined : next;
  };

  const planGrab = (ctx: LedgeContext): Move | undefined => {
    const { state, input, tuning, params } = ctx;
    if (state.launch !== undefined || state.recovery !== undefined || input.motion !== undefined) {
      return undefined;
    }
    const ledgeTuning = ctx.lt;
    const { radius } = tuning.capsule;
    const { stepHeight } = tuning;
    const capabilities = capabilitiesOf(ctx.entity);
    const canHang = capabilities.includes(LEDGE_HANG_CAPABILITY);
    const move = moveVector(input);
    const moving = length(move) > 0;
    const holds = (spot: Spot) => ledgeSlip(world, spot.entity, capabilities) === undefined;
    const ahead = (spot: Spot, dir: Vec3, reach: number) =>
      dot(spot.ledge.normal, dir) <= -FACING &&
      spot.out >= radius - TOUCH &&
      spot.out <= radius + reach &&
      spot.height > stepHeight;
    const { position } = state;
    /** A catch within hands' reach: pull straight up when low, else hang. */
    const grab = (spot: Spot) =>
      spot.height < ledgeTuning.hangDepth
        ? mantle(ctx, spot, position, ledgeTuning.pullUpMs)
        : hang(ctx, spot, position, ledgeTuning.grabMs);

    if (!state.grounded) {
      if (!canHang || !moving) return undefined;
      for (const spot of spots(ctx)) {
        if (!ahead(spot, move, ledgeTuning.grabReach)) continue;
        if (spot.height > ledgeTuning.hangReach || !holds(spot)) continue;
        const next = grab(spot);
        if (next !== undefined) return next;
      }
      return undefined;
    }

    const jump =
      input.actions.jump.pressed || (state.jumpAge >= 0 && state.jumpAge < params.jumpBufferTicks);
    if (jump) {
      const dir = moving ? move : cameraForward(input);
      for (const spot of spots(ctx)) {
        if (!ahead(spot, dir, ledgeTuning.reach) || !holds(spot)) continue;
        let next: Move | undefined;
        if (spot.height <= ledgeTuning.mantleHeight) {
          const ms =
            spot.height <= ledgeTuning.autoMantleHeight
              ? ledgeTuning.autoMantleMs
              : ledgeTuning.mantleMs;
          next = mantle(ctx, spot, position, ms);
        } else if (canHang && spot.height <= ledgeTuning.hangReach) {
          next = grab(spot);
        }
        if (next !== undefined) return next;
      }
      return undefined;
    }

    if (!moving) return undefined;
    for (const spot of spots(ctx)) {
      if (!holds(spot)) continue;
      let next: Move | undefined;
      if (ahead(spot, move, ledgeTuning.grabReach)) {
        if (spot.height <= ledgeTuning.autoMantleHeight) {
          next = mantle(ctx, spot, position, ledgeTuning.autoMantleMs);
        }
      } else if (
        canHang &&
        input.actions.crouch.held &&
        dot(spot.ledge.normal, move) >= FACING &&
        Math.abs(spot.height + SKIN) <= TOUCH &&
        spot.out >= -ledgeTuning.grabReach &&
        spot.out <= radius
      ) {
        next = hang(ctx, spot, position, ledgeTuning.lowerMs);
      }
      if (next !== undefined) return next;
    }
    return undefined;
  };

  /** The character starting `move` (its first tick along the path). */
  const start = (ctx: LedgeContext, move: Move): CharacterState => {
    const { state } = ctx;
    const hold = { ledge: move.ledge, path: move.path, slipping: 0 };
    const begun: CharacterState = {
      ...state,
      traversal: move.mode,
      sprinting: false,
      crouched: state.crouched || move.path.then === 'crouch',
      ledge: hold,
    };
    return advance(ctx, begun, hold, move.path);
  };

  /** One tick along `path`, the move in progress on `hold`. */
  const advance = (
    ctx: LedgeContext,
    state: CharacterState,
    hold: LedgeTraversal,
    path: TraversalPath,
  ): CharacterState => {
    const collision = ctx.world;
    const tick = path.tick + 1;
    const position = along(path.points, smooth(tick / path.ticks) * pathLength(path.points));
    const velocity = scale(sub(position, state.position), 1 / ctx.params.dt);
    const moving: CharacterState = {
      ...state,
      position,
      velocity,
      grounded: false,
      groundNormal: UP,
      groundBody: null,
      airTicks: state.airTicks + 1,
      jumped: true,
      jumpAge: -1,
    };
    if (tick < path.ticks) {
      return { ...moving, ledge: { ...hold, path: { ...path, tick } } };
    }
    if (path.then === 'hang') {
      return {
        ...moving,
        velocity: ZERO,
        traversal: 'hang',
        ledge: { ledge: hold.ledge, slipping: 0 },
      };
    }
    // On top: find the ground under the feet, as the controller would.
    const ground = collision.raycast(add(position, vec(0, 0.1, 0)), DOWN, 0.1 + 2 * SKIN);
    const done: CharacterState = {
      ...moving,
      velocity: ZERO,
      traversal: null,
      grounded: ground !== undefined,
      groundNormal: ground?.normal ?? UP,
      groundBody: ground?.body ?? null,
      airTicks: ground === undefined ? moving.airTicks : 0,
      jumped: ground === undefined,
      crouched: path.then === 'crouch',
    };
    delete (done as { ledge?: LedgeTraversal }).ledge;
    return done;
  };

  /** Chains of ledges in line with `ledge` (same side and top, gaps up to `gap`): [lo, hi] along it. */
  const chain = (ledge: Ledge, gap: number) => {
    const t = tangent(ledge);
    const pieces: { ledge: Ledge; lo: number; hi: number }[] = [];
    for (const other of ledges.ledges) {
      if (other.side !== ledge.side || other.start.y !== ledge.start.y) continue;
      if (Math.abs(dot(sub(other.start, ledge.start), other.normal)) > EPS) continue;
      const entity = ledges.entityOf(other);
      if (other !== ledge && (entity === undefined || !world.isAlive(entity))) continue;
      const lo = dot(sub(other.start, ledge.start), t);
      pieces.push({ ledge: other, lo, hi: lo + length(sub(other.end, other.start)) });
    }
    // Stable: ledges at the same place stay in id order.
    pieces.sort((a, b) => a.lo - b.lo);
    const index = pieces.findIndex((piece) => piece.ledge === ledge);
    let first = index;
    let last = index;
    while (first > 0 && nth(pieces, first).lo - nth(pieces, first - 1).hi <= gap + EPS) first--;
    while (
      last < pieces.length - 1 &&
      nth(pieces, last + 1).lo - nth(pieces, last).hi <= gap + EPS
    ) {
      last++;
    }
    return { t, pieces: pieces.slice(first, last + 1) };
  };

  /** One tick hanging still or shimmying from `ledge` (`hold` has no path). */
  const hanging = (ctx: LedgeContext, hold: LedgeTraversal, ledge: Ledge): CharacterState => {
    const { state, input, tuning, params, world: collision } = ctx;
    const ledgeTuning = ctx.lt;
    const { radius, height } = tuning.capsule;
    const capabilities = capabilitiesOf(ctx.entity);
    const n = ledge.normal;
    const move = moveVector(input);
    const { position } = state;
    const grip = vec(
      position.x - n.x * (radius + WALL_GAP),
      ledge.start.y,
      position.z - n.z * (radius + WALL_GAP),
    );

    // Slipping: a ledge that cannot be held is let go after the grace time; a vanished one at once.
    const slip = ledgeSlip(world, ledges.entityOf(ledge), capabilities);
    if (slip === 'gone') return release(state, ZERO);
    const slipping = slip === undefined ? 0 : hold.slipping + 1;
    if (slip !== undefined && slipping >= ticksOf(ledgeTuning.slipGraceMs, params.dt)) {
      return release(state, ZERO);
    }

    if (input.actions.jump.pressed) {
      if (dot(move, n) > 0.5) {
        const { away, up } = ledgeTuning.jumpBack;
        return release(state, add(scale(n, away), scale(UP, up)));
      }
      const spot: Spot = {
        ledge,
        entity: ledges.entityOf(ledge),
        grip,
        out: radius + WALL_GAP,
        height: ledge.start.y - position.y,
      };
      const up = slip === undefined ? mantle(ctx, spot, position, ledgeTuning.pullUpMs) : undefined;
      if (up !== undefined) return start(ctx, up);
    }
    if (input.actions.crouch.pressed) return release(state, ZERO);

    // Shimmy along the chain of ledges in line with this one.
    const { t, pieces } = chain(ledge, ledgeTuning.shimmyGap);
    const a = dot(sub(grip, ledge.start), t);
    const lo = nth(pieces, 0).lo + radius;
    const hi = nth(pieces, pieces.length - 1).hi - radius;
    const want = ledgeTuning.shimmySpeed * dot(move, t) * params.dt;
    const to = want > 0 ? Math.min(a + want, Math.max(a, hi)) : Math.max(a + want, Math.min(a, lo));
    let next = position;
    let held = ledge;
    if (to !== a) {
      const moved = add(position, scale(t, to - a));
      if (fits(collision, { radius, height }, moved)) {
        next = moved;
        let best = Infinity;
        for (const piece of pieces) {
          const off = Math.max(piece.lo - to, to - piece.hi, 0);
          if (off < best) {
            best = off;
            held = piece.ledge;
          }
        }
      }
    }
    return {
      ...state,
      position: next,
      velocity: scale(sub(next, position), 1 / params.dt),
      airTicks: state.airTicks + 1,
      jumpAge: -1,
      ledge: { ledge: held.id, slipping },
    };
  };

  return {
    modes: ['mantle', 'hang'],
    shouldEnter: (ctx) => plan(withTuning(ctx)) !== undefined,
    climbOut(traversal, normal, reach) {
      const ctx = withTuning(traversal);
      const { radius } = ctx.tuning.capsule;
      const capabilities = capabilitiesOf(ctx.entity);
      for (const spot of spots(ctx)) {
        if (dot(spot.ledge.normal, normal) < FACING) continue;
        if (spot.out < radius - TOUCH || spot.out > radius + ctx.lt.reach) continue;
        if (spot.height <= 0 || spot.height > reach) continue;
        if (ledgeSlip(world, spot.entity, capabilities) !== undefined) continue;
        const up = mantle(ctx, spot, ctx.state.position, ctx.lt.pullUpMs);
        if (up !== undefined) return start(ctx, up);
      }
      return undefined;
    },
    step(traversal) {
      const ctx = withTuning(traversal);
      const { state } = ctx;
      const hold = state.ledge;
      if (hold === undefined) {
        const move = plan(ctx);
        return move === undefined ? { ...state, traversal: null } : start(ctx, move);
      }
      // A blow or a blast knocks the character off, keeping the launch.
      if (state.launch !== undefined) return release(state, state.velocity);
      const ledge = ledges.ledges[hold.ledge];
      if (ledge === undefined) return release(state, ZERO);
      if (hold.path !== undefined) return advance(ctx, state, hold, hold.path);
      return hanging(ctx, hold, ledge);
    },
  };
}
