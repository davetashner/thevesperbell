// Climbing (mw-e02.13): the traversal hook that attaches a character to anything the world marks
// climbable (ladders, ivy, rough stone and timber, ropes), moves it in surface space, hands it over
// to the ledge hook's pull-up at the top, and lets go on a jump, a crouch, the ground, a blow, an
// empty stamina bar or a surface that can no longer be held. Deterministic sim: the climber is placed
// by the sim every tick (never root motion); animation reads the `climb` locomotion state.
//
// Climbability comes only from world properties, through surfaces.ts: the grade (the `climbable`
// property) says whether the actor needs a capability (rough walls: CLIMB_ROUGH_CAPABILITY), and a
// frozen surface needs CLIMB_ICE_CAPABILITY. They are read live every tick, so every rule that
// changes them changes climbing with no special case: ivy that burns away (destroyed) or wood that
// burns out (climbable none) drops its climber at once; a surface that catches fire or freezes is
// held for slipGraceMs, then let go.
//
// Surfaces. A wall is found with a ray from the hands (handHeight above the feet) along the move
// input: the collider it hits names its piece (`ownerOfCollider`), whose properties decide. A rope
// has no collider; it is an entity with a ClimbRope line (ropes.ts), found by distance to its line.
// Authored and runtime-spawned ropes are the same data, so they climb alike.
//
// Attaching. Pressing into a surface within `reach` of the capsule attaches: by walking into it for
// the grades in `walkOn` (ladders, ropes, ivy), otherwise by a jump at it or a catch in the air, so
// bumping a stone wall never starts a climb. The hands must reach the surface and the capsule fit
// where it will hang; a character with an empty stamina bar cannot attach.
//
// Moving. Input is mapped onto the surface as the camera sees it: pushing into the surface climbs
// up, pulling away climbs down, sideways moves along it (ropes only go up and down), at the grade's
// speed. Every step keeps the hands on something the climber can hold: the ray from the hands at the
// new place must hit a holdable surface, whose normal may turn up to maxCornerAngle from the old one
// (corners are followed, sharper turns stop the climber). Anything else in the way stops it, and a
// climber moving down onto walkable ground stands on it. A rope's climber hangs off its line and
// follows its anchor, and climbs between the hands at the anchor and the hands at the rope's end.
//
// Leaving. Pushing up with a ledge of the climbed face within the hands' reach pulls up onto it: the
// ledge hook's own mantle (`LedgeTraversalHook.climbOut`), so its headroom and path checks apply.
// Jump jumps off (jumpOff), crouch lets go, an impulse knocks the climber off keeping the launch.
// Stamina: the hook reads the pool through `stamina`; at 0 the climber slips and falls. The drain
// itself is the player's climbing stamina system (staminaPerSecond, progression: mw-e10.9).
//
// The surface held is CharacterState.climb (plain data: snapshotted, hashed, replayed).

import type { ClimbTuning, Frozen } from '@content/index';
import type { CollisionHit, CollisionWorld } from '../character/collision-world';
import { SKIN, type CharacterState } from '../character/controller';
import { radians } from '../character/greybox';
import type { ClimbTraversal, TraversalContext, TraversalHook } from '../character/traversal';
import { add, dot, flat, length, normalize, scale, sub, UP, vec, ZERO } from '../character/vec';
import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { at } from '../geom/vec';
import { cos } from '../math';
import { readProperty } from '../properties/components';
import type { Vec3 } from '../stimulus/shapes';
import { moveVector, type LedgeTraversalHook } from './mantle';
import { ClimbRopeComponent, type ClimbRope } from './ropes';
import {
  canAttachClimb,
  climbabilityOf,
  climbDifficulty,
  CLIMB_REFUSAL_TEXT,
  ownerOfCollider,
  type ClimbableGrade,
  type ClimbRefusal,
} from './surfaces';

/**
 * A character pressed into a surface it may not climb (mw-e10.9): the knight at a rough wall, a
 * climber at a face harder than its best. Fired once as the refusal begins, not on every tick of a
 * held press; `text` is the prompt to show.
 */
export interface ClimbRefused {
  readonly tick: number;
  readonly actor: EntityId;
  readonly surface: EntityId;
  readonly refusal: ClimbRefusal;
  readonly text: string;
}

/** Fired once as a character presses into a surface it may not climb (`climb.refused`). */
export const climbRefused = defineEvent<ClimbRefused>('climb.refused');

/** The last tick each actor's climb was refused, per world: a held press is one refusal. */
const lastRefusal = new WeakMap<object, Map<EntityId, number>>();

/**
 * The defaults when a controller profile has no `climb` block (the shipped player profile states its
 * own, src/content/data/controller): the mw-e02.13 speeds and rules.
 */
export const DEFAULT_CLIMB_TUNING: Frozen<ClimbTuning> = Object.freeze({
  speeds: Object.freeze({ ladder: 1.2, rope: 1, ivy: 0.8, rough: 0.8, sheer: 0.6 }),
  walkOn: Object.freeze(['ladder', 'rope', 'ivy'] as const),
  reach: 0.3,
  handHeight: 2,
  maxCornerAngle: 45,
  slipGraceMs: 1000,
  staminaPerSecond: 5,
  jumpOff: Object.freeze({ away: 4, up: 5 }),
});

/** Stamina drain multipliers by climb difficulty 1, 2, 3 when the tuning states none (mw-e10.9). */
export const DEFAULT_STAMINA_BY_DIFFICULTY: readonly [number, number, number] = Object.freeze<
  [number, number, number]
>([1, 1.5, 2]);

/**
 * Stamina drained per second climbing `surface` (mw-e10.9): the tuning's base rate times the
 * multiplier of the surface's difficulty (a rope or ladder 1, rough stone 2, a sheer face 3). A
 * surface that stopped being climbable (burnt away) drains the base rate.
 */
export function climbDrainPerSecond(
  world: World<never>,
  surface: EntityId,
  tuning: Frozen<ClimbTuning>,
): number {
  const difficulty = climbDifficulty(climbabilityOf(world, surface)) || 1;
  const scale = tuning.staminaByDifficulty ?? DEFAULT_STAMINA_BY_DIFFICULTY;
  return tuning.staminaPerSecond * at(scale, difficulty - 1);
}

export interface ClimbTraversalOptions {
  /** The sim world the climbable pieces and ropes live in (their properties decide). */
  readonly world: World<never>;
  /** A character's capabilities (class, tools); none by default. */
  readonly capabilities?: (entity: EntityId | undefined) => readonly string[];
  /**
   * The hardest climb difficulty (1-3) a character attempts (`maxClimbDifficulty` over its
   * capabilities); unlimited by default. A harder surface is refused with a `climb.refused` prompt.
   */
  readonly maxDifficulty?: (entity: EntityId | undefined) => number;
  /** A character's stamina left, or undefined without a pool (never tires); none by default. */
  readonly stamina?: (entity: EntityId | undefined) => number | undefined;
  /** The ledge hook whose pull-up takes climbers over the top; absent = climbers stop at the top. */
  readonly ledges?: Pick<LedgeTraversalHook, 'climbOut'>;
  /**
   * Whether a character may not start a climb right now because its hands are full (carrying,
   * ADR-0003); it is asked only when a climb would otherwise start. Never by default.
   */
  readonly handsFull?: (entity: EntityId | undefined) => boolean;
}

/** Gap between the capsule and the surface it climbs (as it hangs from a ledge). */
const WALL_GAP = 2 * SKIN;
/** A surface counts as pressed into when the move is within 45° of straight at it. */
const FACING = Math.SQRT1_2;
/** Surfaces leaning more than 30° from vertical (|normal.y| above this) are not climbed. */
const MAX_LEAN = 0.5;
/** Distance tolerance, metres. */
const EPS = 1e-9;

/** Whether hands can hold a surface: yes, only for the slip grace (frozen, burning), or not at all. */
type Grip = 'hold' | 'slip' | 'gone';

/** A climbable surface a ray from the hands found. */
interface Touch {
  readonly entity: EntityId;
  /** Unit horizontal normal out of the surface. */
  readonly normal: Vec3;
  /** Distance along the ray. */
  readonly distance: number;
  /** Where the ray met the surface. */
  readonly point: Vec3;
}

/** A climb tick's context with the climb tuning in force. */
interface ClimbContext extends TraversalContext {
  readonly ct: Frozen<ClimbTuning>;
}

const withTuning = (ctx: TraversalContext): ClimbContext => ({
  ...ctx,
  ct: ctx.tuning.climb ?? DEFAULT_CLIMB_TUNING,
});

/** Ticks `ms` lasts at the step `dt` (at least one). */
const ticksOf = (ms: number, dt: number): number => Math.max(1, Math.round(ms / 1000 / dt));

/** `state` without the climb's data. */
function bare(state: CharacterState): CharacterState {
  const copy = { ...state };
  delete copy.climb;
  return copy;
}

/** The character let go, airborne at `velocity`, back to locomotion. */
function release(state: CharacterState, velocity: Vec3): CharacterState {
  return bare({
    ...state,
    velocity,
    traversal: null,
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    airTicks: state.airTicks + 1,
    jumped: true,
    jumpAge: -1,
  });
}

/**
 * The climbing traversal hook (see the file header). Put it in the character controller's `hooks`
 * after the ledge hook (mantles and ledge grabs win over climbing); it owns the `climb` mode.
 */
export function climbTraversal(options: ClimbTraversalOptions): TraversalHook {
  const { world, ledges } = options;
  const capabilitiesOf = options.capabilities ?? (() => []);
  const staminaOf = options.stamina ?? (() => undefined);
  const maxDifficultyOf = options.maxDifficulty ?? (() => Infinity);
  const hasRopes = world.isRegistered(ClimbRopeComponent);

  /** Whether hands can hold `entity` right now (see Grip). */
  const gripOf = (entity: EntityId, capabilities: readonly string[], actor?: EntityId): Grip => {
    const attach = canAttachClimb(world, entity, capabilities, maxDifficultyOf(actor));
    if (!attach.ok) return attach.reason === 'slippery' ? 'slip' : 'gone';
    return readProperty(world, entity, 'burning') ? 'slip' : 'hold';
  };

  /** Tells the player once, as it begins, that `actor` may not climb `surface` (see ClimbRefused). */
  const refuse = (
    actor: EntityId | undefined,
    surface: EntityId,
    capabilities: readonly string[],
  ) => {
    if (actor === undefined) return;
    const refusal = canAttachClimb(world, surface, capabilities, maxDifficultyOf(actor));
    if (refusal.ok || refusal.reason === 'not-climbable') return;
    let ticks = lastRefusal.get(world);
    if (ticks === undefined) lastRefusal.set(world, (ticks = new Map<EntityId, number>()));
    const last = ticks.get(actor);
    ticks.set(actor, world.tick);
    if (last !== undefined && world.tick - last <= 1) return;
    world.events.emit(climbRefused, {
      tick: world.tick,
      actor,
      surface,
      refusal,
      text: CLIMB_REFUSAL_TEXT[refusal.reason],
    });
  };

  /** The climbable surface a ray from `origin` along `direction` meets within `distance`. */
  const touch = (
    collision: CollisionWorld,
    origin: Vec3,
    direction: Vec3,
    distance: number,
  ): Touch | undefined => {
    const hit: CollisionHit | undefined = collision.raycast(origin, direction, distance);
    if (hit === undefined || Math.abs(hit.normal.y) > MAX_LEAN) return undefined;
    const entity = ownerOfCollider(world, hit.body);
    if (entity === undefined) return undefined;
    return {
      entity,
      normal: normalize(flat(hit.normal)),
      distance: hit.distance,
      point: hit.point,
    };
  };

  /** Whether the standing capsule fits with its feet at `feet`. */
  const fits = (ctx: ClimbContext, feet: Vec3): boolean => {
    const { radius, height } = ctx.tuning.capsule;
    return !ctx.world.overlapCapsule(
      { radius: radius - SKIN, height: height - SKIN },
      add(feet, vec(0, SKIN, 0)),
    );
  };

  /** The rope line of `entity`, when it is a rope. */
  const ropeOf = (entity: EntityId): ClimbRope | undefined =>
    hasRopes ? world.get(entity, ClimbRopeComponent) : undefined;

  /** Where a climber with feet at height `y` hangs off `rope`, on the `normal` side of its line. */
  const onRope = (ctx: ClimbContext, rope: ClimbRope, normal: Vec3, y: number): Vec3 => {
    const off = ctx.tuning.capsule.radius + WALL_GAP;
    return vec(rope.anchor.x + normal.x * off, y, rope.anchor.z + normal.z * off);
  };

  /** Feet heights at which the hands are on `rope`: [lowest, highest]. */
  const ropeSpan = (ctx: ClimbContext, rope: ClimbRope): readonly [number, number] => [
    rope.anchor.y - rope.length - ctx.ct.handHeight,
    rope.anchor.y - ctx.ct.handHeight,
  ];

  /** The character starting to climb `surface` at `position`, facing against `normal`. */
  const attach = (
    state: CharacterState,
    surface: EntityId,
    normal: Vec3,
    position: Vec3,
  ): CharacterState => ({
    ...bare(state),
    position,
    velocity: ZERO,
    traversal: 'climb',
    grounded: false,
    groundNormal: UP,
    groundBody: null,
    crouched: false,
    sprinting: false,
    airTicks: state.airTicks + 1,
    jumped: false,
    jumpAge: -1,
    climb: { surface, normal, slipping: 0 },
  });

  /** Whether a character pressing along `move` may attach to a surface of `grade` this tick. */
  const may = (ctx: ClimbContext, grade: ClimbableGrade): boolean =>
    !ctx.state.grounded || ctx.input.actions.jump.pressed || ctx.ct.walkOn.includes(grade);

  /** The attach to a wall pressed into along `move`, if any. */
  const attachWall = (ctx: ClimbContext, move: Vec3, capabilities: readonly string[]) => {
    const { state, ct } = ctx;
    const { radius } = ctx.tuning.capsule;
    const hands = add(state.position, vec(0, ct.handHeight, 0));
    const found = touch(ctx.world, hands, move, radius + ct.reach);
    if (found === undefined || dot(move, found.normal) > -FACING) return undefined;
    if (!may(ctx, readProperty(world, found.entity, 'climbable') as ClimbableGrade)) {
      return undefined;
    }
    if (gripOf(found.entity, capabilities, ctx.entity) !== 'hold') {
      refuse(ctx.entity, found.entity, capabilities);
      return undefined;
    }
    // Hang the capsule WALL_GAP off the surface, measured along its normal.
    const off = radius + WALL_GAP + found.distance * dot(move, found.normal);
    const position = add(state.position, scale(found.normal, off));
    if (!fits(ctx, position)) return undefined;
    return attach(state, found.entity, found.normal, position);
  };

  /** The attach to a rope pressed towards along `move`, if any (nearest first, ties by id). */
  const attachRope = (ctx: ClimbContext, move: Vec3, capabilities: readonly string[]) => {
    if (!hasRopes) return undefined;
    const { state, ct } = ctx;
    const { radius } = ctx.tuning.capsule;
    const candidates: { entity: EntityId; rope: ClimbRope; distance: number; away: Vec3 }[] = [];
    world.query(ClimbRopeComponent).forEach((entity, rope) => {
      const away = flat(sub(state.position, rope.anchor));
      const distance = length(away);
      if (distance > radius + WALL_GAP + ct.reach) return;
      // Pressing towards the line (from right under it, any press will do).
      if (distance > EPS && dot(move, scale(away, -1 / distance)) < FACING) return;
      const [lowest, highest] = ropeSpan(ctx, rope);
      if (state.position.y < lowest || state.position.y > highest) return;
      candidates.push({ entity, rope, distance, away });
    });
    candidates.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
    for (const { entity, rope, distance, away } of candidates) {
      if (!may(ctx, 'rope')) continue;
      if (gripOf(entity, capabilities, ctx.entity) !== 'hold') {
        refuse(ctx.entity, entity, capabilities);
        continue;
      }
      const normal = distance > EPS ? scale(away, 1 / distance) : scale(move, -1);
      const position = onRope(ctx, rope, normal, state.position.y);
      if (!fits(ctx, position)) continue;
      return attach(state, entity, normal, position);
    }
    return undefined;
  };

  /** The climb a character in ordinary locomotion starts this tick, if any. */
  const plan = (ctx: ClimbContext): CharacterState | undefined => {
    const { state, input } = ctx;
    if (state.launch !== undefined || state.recovery !== undefined || input.motion !== undefined) {
      return undefined;
    }
    const move = moveVector(input);
    const deflection = length(move);
    if (deflection === 0 || staminaOf(ctx.entity) === 0) return undefined;
    const dir = scale(move, 1 / deflection);
    const capabilities = capabilitiesOf(ctx.entity);
    const next = attachWall(ctx, dir, capabilities) ?? attachRope(ctx, dir, capabilities);
    return next !== undefined && options.handsFull?.(ctx.entity) === true ? undefined : next;
  };

  /** The climber standing on the ground it met moving along `dir` (`hit`, a sweep's contact). */
  const land = (state: CharacterState, dir: Vec3, hit: CollisionHit): CharacterState =>
    bare({
      ...state,
      position: add(state.position, scale(dir, Math.max(0, hit.distance - SKIN))),
      velocity: ZERO,
      traversal: null,
      grounded: true,
      groundNormal: hit.normal,
      groundBody: hit.body,
      airTicks: 0,
      jumped: false,
      jumpAge: -1,
    });

  /** One tick holding still (or slipping), kept at `position`. */
  const hold = (
    ctx: ClimbContext,
    climb: ClimbTraversal,
    position: Vec3,
    changes: Partial<ClimbTraversal> = {},
  ): CharacterState => ({
    ...ctx.state,
    position,
    velocity: scale(sub(position, ctx.state.position), 1 / ctx.params.dt),
    airTicks: ctx.state.airTicks + 1,
    jumpAge: -1,
    climb: { ...climb, ...changes },
  });

  /**
   * The move `d` from the climber's place, stopped by anything in the way: the contact when it is
   * walkable ground being climbed down onto, otherwise whether the path is clear.
   */
  const sweep = (ctx: ClimbContext, d: Vec3) => {
    const distance = length(d);
    const dir = scale(d, 1 / distance);
    const { radius, height } = ctx.tuning.capsule;
    const hit = ctx.world.sweepCapsule({ radius, height }, ctx.state.position, dir, distance);
    return { dir, hit };
  };

  /** One tick on a rope: up and down its line, following its anchor. */
  const climbRope = (
    ctx: ClimbContext,
    climb: ClimbTraversal,
    rope: ClimbRope,
    up: number,
    speed: number,
  ): CharacterState => {
    const { state, params } = ctx;
    const [lowest, highest] = ropeSpan(ctx, rope);
    const y = Math.min(highest, Math.max(lowest, state.position.y + up * speed * params.dt));
    const target = onRope(ctx, rope, climb.normal, y);
    const d = sub(target, state.position);
    if (length(d) < EPS) return hold(ctx, climb, state.position);
    const { dir, hit } = sweep(ctx, d);
    if (hit === undefined) return hold(ctx, climb, target);
    if (dir.y < 0 && hit.normal.y >= params.minGroundY) return land(state, dir, hit);
    return hold(ctx, climb, state.position);
  };

  /** One tick on a wall: along its surface, round shallow corners, stopping where hands can't hold. */
  const climbWall = (
    ctx: ClimbContext,
    climb: ClimbTraversal,
    up: number,
    side: number,
    speed: number,
    capabilities: readonly string[],
  ): CharacterState => {
    const { state, params, ct } = ctx;
    const { radius } = ctx.tuning.capsule;
    const n = climb.normal;
    const along = vec(n.z, 0, -n.x); // right, facing the wall
    const d = scale(add(scale(UP, up), scale(along, side)), speed * params.dt);
    if (length(d) < EPS) return hold(ctx, climb, state.position);
    const corner = cos(radians(ct.maxCornerAngle));
    const { dir, hit } = sweep(ctx, d);
    let to = add(state.position, d);
    let normal = n;
    if (hit !== undefined) {
      if (dir.y < 0 && hit.normal.y >= params.minGroundY) return land(state, dir, hit);
      // An inside corner: a holdable face turned by no more than the corner angle is climbed onto.
      const turned = normalize(flat(hit.normal));
      const owner = ownerOfCollider(world, hit.body);
      if (
        Math.abs(hit.normal.y) > MAX_LEAN ||
        dot(turned, n) < corner - EPS ||
        owner === undefined ||
        gripOf(owner, capabilities, ctx.entity) !== 'hold'
      ) {
        return hold(ctx, climb, state.position);
      }
      to = add(state.position, scale(dir, Math.max(0, hit.distance - SKIN)));
      normal = turned;
    }
    // The hands must be on something holdable at the new place (an outside corner turns with it).
    const hands = add(to, vec(0, ct.handHeight, 0));
    const reach = radius + WALL_GAP + ct.reach;
    const found = touch(ctx.world, hands, scale(normal, -1), reach);
    if (
      found === undefined ||
      dot(found.normal, n) < corner - EPS ||
      gripOf(found.entity, capabilities, ctx.entity) !== 'hold'
    ) {
      return hold(ctx, climb, state.position);
    }
    // Square on to the face where the hands took it (round an outside corner, on to the new face).
    const off = radius + WALL_GAP;
    const pulled = vec(
      found.point.x + found.normal.x * off,
      to.y,
      found.point.z + found.normal.z * off,
    );
    // A face set back behind a step (ivy proud of the stone): hang off where the climber is (the
    // sweep found the way there clear) until the capsule clears the step, then close in.
    const position = fits(ctx, pulled) ? pulled : to;
    return hold(ctx, climb, position, { surface: found.entity, normal: found.normal });
  };

  /** One tick of a climber holding `climb`. */
  const climbing = (ctx: ClimbContext, climb: ClimbTraversal): CharacterState => {
    const { state, input, params, ct } = ctx;
    // A blow or a blast knocks the climber off, keeping the launch.
    if (state.launch !== undefined) return release(state, state.velocity);
    const capabilities = capabilitiesOf(ctx.entity);
    const grip = gripOf(climb.surface, capabilities, ctx.entity);
    if (grip === 'gone') return release(state, ZERO);
    const slipping = grip === 'slip' ? climb.slipping + 1 : 0;
    if (slipping >= ticksOf(ct.slipGraceMs, params.dt)) return release(state, ZERO);
    // Out of breath: the grip gives.
    if (staminaOf(ctx.entity) === 0) return release(state, ZERO);
    const n = climb.normal;
    if (input.actions.jump.pressed) {
      const { away, up } = ct.jumpOff;
      return release(state, add(scale(n, away), scale(UP, up)));
    }
    if (input.actions.crouch.pressed) return release(state, ZERO);
    const held = { ...climb, slipping };
    // Losing grip: no climbing until it holds again.
    if (slipping > 0) return hold(ctx, held, state.position);

    // Into the surface is up, away is down, sideways is along it (as the camera sees it).
    const move = moveVector(input);
    const up = -dot(move, n);
    const side = dot(move, vec(n.z, 0, -n.x));
    const speed = ct.speeds[readProperty(world, climb.surface, 'climbable') as ClimbableGrade];
    if (up > 0 && ledges !== undefined) {
      // The hands stop within a step of the top, so they reach a step higher for the ledge.
      const reach = ct.handHeight + speed * params.dt;
      const over = ledges.climbOut({ ...ctx, state: bare(state) }, n, reach);
      if (over !== undefined) return over;
    }
    const rope = ropeOf(climb.surface);
    return rope === undefined
      ? climbWall(ctx, held, up, side, speed, capabilities)
      : climbRope(ctx, held, rope, up, speed);
  };

  return {
    modes: ['climb'],
    shouldEnter: (ctx) => plan(withTuning(ctx)) !== undefined,
    step(traversal) {
      const ctx = withTuning(traversal);
      const { climb } = ctx.state;
      if (climb === undefined) return plan(ctx) ?? { ...ctx.state, traversal: null };
      return climbing(ctx, climb);
    },
  };
}
