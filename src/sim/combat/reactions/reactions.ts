// Sim-chosen hit reactions (mw-e04.7): every resolved hit on an entity that reacts to hits becomes a
// reaction tier the player can read — none, flinch, stagger, knockback or knockdown — from a side of
// the entity, and the strong ones push it through physics so a shoved creature can fall off a ledge
// or into fire.
//
// Choosing (`chooseReaction`, in order):
//  - invulnerable (wake-up i-frames after a knockdown) → none;
//  - hyperarmor absorbed the hit's poise (the move's window, with cap left), unless the hit is a
//    critical → none, damage applies;
//  - impulse ≥ the profile's knockdownImpulse → knockdown (90 ticks grounded, then 20 invulnerable
//    wake-up ticks);
//  - impulse ≥ knockbackImpulse (300 N·s by default) → knockback (60 ticks, pushed);
//  - the hit broke poise (PoiseBroken) or the hyperarmor's cap, or is a critical (a riposte, which
//    ignores poise and hyperarmor, e04.12) → stagger (45 ticks);
//  - any poise damage → flinch (12 ticks);
//  - otherwise none (a poison tick, a zero-poise graze).
// Then the profile may replace the tier (a troll: knockdown → knockback). A reaction weaker than the
// one playing leaves it be (a flinch never cuts a knockdown short); a stronger one takes over, and an
// equal one restarts it unless that would end it sooner (a guard break's 60-tick stagger is not cut
// to 45 by the stagger its own hit resolves to).
//
// Effect. Stagger, knockback and knockdown interrupt the entity's move (the action timeline's
// `interruptAction`) and lock it for the reaction's length. A flinch interrupts only a move in its
// startup (or holds an idle entity): during active or recovery ticks the move is committed and the
// flinch plays over it (the animation's additive layer). Knockback and knockdown push the entity by
// the hit's impulse through the world's pushers: a character (`pushCharacter`) is launched through
// the controller's impulse API (mw-e02.15) — impulse over mass plus the profile's launchSpeed
// upwards, staggering, blamed on the hit's instigator — so collide-and-slide and gravity carry it,
// walls stop it, ledges drop it and the fall-damage rules (e04.19) price the landing; a physics
// object (`pushPhysicsObject`) gets the impulse on its rigid body.
//
// Direction: the side the hit came from, relative to the entity's facing (its hurtbox frame by
// default): front or back within 45° of the facing axis, else left or right.
//
// Timing: a reaction chosen on world tick T lasts ticks T+1…T+length (the timeline's lock runs out on
// the same tick) and is over from T+length+1, when HitReactionEnded fires. Lengths count the entity's
// local time, as the timeline's lock does: each tick hit-stop freezes it (e04.11) moves the end — and
// a knockdown's wake-up i-frames — one tick later, so a stagger struck with a 5-tick hit-stop ends,
// and its lock runs out, on T+length+6.
//
// Interrupts (mw-e04.14). A hit tagged `interrupt` (the shield bash) on an entity whose move is flagged
// interruptible (a spell windup) cancels that move whatever its phase, and whatever its hyperarmor
// absorbed: the reaction is at least a flinch, it interrupts even a committed move, and a reaction
// already playing does not suppress it. Blocked, parried and invulnerable hits interrupt nothing; on
// a move that is not interruptible the tag does nothing.
//
// Other rules call `applyHitReaction` to force a reaction, which replaces whatever is playing.
//
// Blocks and guard breaks (mw-e04.31). A hit the shield blocked (tagged `blocked`, e04.6) causes no
// reaction: the blocker is behind its shield, so nothing flinches or pushes it (HitReaction none,
// suppressed `blocked`); nor does a parried one (tagged `parried`, e04.12: suppressed `parried`). A guard break (GuardBroken) becomes the guard-break reaction: a stagger of the
// event's `staggerTicks` (60), from the front — a blocked hit always comes from inside the shield's
// frontal arc. The guard rule has already interrupted and locked the blocker's timeline for exactly
// that long, so the reaction does not interrupt or lock it a second time.

import type { MoveTable } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { applyCharacterImpulse } from '../../character/impulse';
import { PhysicsObjectComponent, rigidBodiesOf } from '../../physics/objects';
import type { ColliderHandle } from '../../physics/static-colliders';
import type { Vec3 } from '../../stimulus/shapes';
import { DamageApplied, type DamageResult } from '../damage/events';
import type { DamageModel, DamageModifier } from '../damage/model';
import { DAMAGE_TAGS } from '../damage/packet';
import { isHitStopped } from '../hitstop/components';
import { HurtboxComponent } from '../hits/components';
import { GuardBroken } from '../melee/events';
import { ActionTimelineComponent } from '../timeline/components';
import { interruptAction, phaseAt } from '../timeline/timeline';
import {
  HitReactionComponent,
  hasWakeIframes,
  REACTION_TICKS,
  reactionRank,
  WAKE_IFRAME_TICKS,
  type ActiveReaction,
  type HitDirection,
  type HitReactionKind,
  type HitReactionState,
  type ReactionProfile,
} from './components';
import {
  HitReaction,
  HitReactionEnded,
  type HitReactionInfo,
  type ReactionSuppression,
} from './events';

/** Tags the reaction modifiers add to a hit (DamageResult.tags). */
export const REACTION_TAGS = Object.freeze({
  /** Hyperarmor absorbed the hit's poise damage: no reaction. */
  hyperarmor: 'hyperarmor',
  /** The hit exceeded the hyperarmor's cap: it staggers. */
  hyperarmorBroken: 'hyperarmor-broken',
  /** The target was invulnerable (wake-up i-frames): no damage, poise or reaction. */
  invulnerable: 'invulnerable',
} as const);

/** Default facing of an entity without hurtboxes (the hurtbox frame's own default, +z). */
const FORWARD: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

/**
 * The side of an entity facing `facing` a hit travelling along `travel` came from: front or back
 * within 45° of the facing axis (exactly 45° counts as front or back), else left or right. A hit
 * with no horizontal direction (or a facing without one) counts as front.
 */
export function hitDirection(facing: Vec3, travel: Vec3 | undefined): HitDirection {
  if (travel === undefined) return 'front';
  // Towards the source, in the entity's frame: forward f, right = f × up = (−f.z, 0, f.x).
  const fromX = -travel.x;
  const fromZ = -travel.z;
  const ahead = fromX * facing.x + fromZ * facing.z;
  const side = -fromX * facing.z + fromZ * facing.x;
  if (ahead === 0 && side === 0) return 'front';
  const across = Math.abs(side);
  if (ahead >= across) return 'front';
  if (-ahead >= across) return 'back';
  return side > 0 ? 'right' : 'left';
}

/** What `chooseReaction` weighs. */
export interface ReactionFactors {
  /** Poise damage the hit dealt after modifiers, points. */
  readonly poiseDamage: number;
  /** The hit emptied the poise meter (PoiseBroken). */
  readonly poiseBroken: boolean;
  /** Magnitude of the hit's impulse, N·s. */
  readonly impulse: number;
  /** Hyperarmor absorbed the hit, or it broke the cap; null outside hyperarmor. */
  readonly hyperarmor: 'absorbed' | 'broken' | null;
  /** The entity is invulnerable (wake-up i-frames). */
  readonly invulnerable: boolean;
  /** A critical (riposte): it ignores poise and hyperarmor and always staggers at least. */
  readonly critical?: boolean;
  /** Staggers whatever the poise (a head hit on an unaware humanoid, mw-e05.6). */
  readonly staggering?: boolean;
  /** The hit is raw force (tagged `force`): emptying poise knocks down instead of staggering. */
  readonly forceful?: boolean;
}

/** A chosen reaction and, when it is none although the hit could have caused one, why. */
export interface ReactionChoice {
  readonly kind: HitReactionKind;
  readonly suppressed: ReactionSuppression;
}

/** The reaction a hit causes (see the file header); pure. */
export function chooseReaction(factors: ReactionFactors, profile: ReactionProfile): ReactionChoice {
  if (factors.invulnerable) return { kind: 'none', suppressed: 'invulnerable' };
  const critical = factors.critical === true;
  if (factors.hyperarmor === 'absorbed' && !critical) {
    return { kind: 'none', suppressed: 'hyperarmor' };
  }
  const { impulse } = factors;
  let tier: HitReactionKind = 'none';
  if (impulse >= profile.knockdownImpulse) tier = 'knockdown';
  else if (impulse >= profile.knockbackImpulse) tier = 'knockback';
  else if (factors.forceful === true && factors.poiseBroken) tier = 'knockdown';
  else if (
    factors.poiseBroken ||
    factors.hyperarmor === 'broken' ||
    critical ||
    factors.staggering === true
  )
    tier = 'stagger';
  else if (factors.poiseDamage > 0) tier = 'flinch';
  if (tier === 'none') return { kind: 'none', suppressed: null };
  const kind = profile.replace[tier] ?? tier;
  return { kind, suppressed: kind === 'none' ? 'replaced' : null };
}

/** How to read an entity's facing (unit horizontal, or undefined for the default +z). */
export type FacingReader = (world: World<never>, entity: EntityId) => Vec3 | undefined;

/** Facing from the entity's hurtbox frame (mw-e04.2). */
export const hurtboxFacing: FacingReader = (world, entity) =>
  world.get(entity, HurtboxComponent)?.facing;

/** What the reaction rules need. */
export interface HitReactionOptions {
  /** Every move an entity may perform (the action timeline's table): phases and hyperarmor. */
  readonly moves: MoveTable;
  /**
   * Facing of a struck entity; defaults to its hurtbox frame's (`hurtboxFacing`, which needs the
   * hit-volume components registered).
   */
  readonly facing?: FacingReader;
  /**
   * How knockbacks and knockdowns push, tried in order until one moves the entity: e.g.
   * `[pushCharacter, pushPhysicsObject]` in a world with characters and physics objects. None by
   * default (nothing is displaced).
   */
  readonly pushers?: readonly Pusher[];
}

/** A reaction another rule imposes (e.g. a guard break's stagger). */
export interface ReactionRequest {
  readonly kind: HitReactionKind;
  /** Length in ticks; defaults to REACTION_TICKS for the kind (a guard break passes 60). */
  readonly ticks?: number;
  /** Defaults to front. */
  readonly direction?: HitDirection;
  /** N·s, world space; pushes a knockback or knockdown (none by default). */
  readonly impulse?: Vec3;
  readonly instigator?: EntityId | null;
  readonly source?: EntityId | null;
  /**
   * The caller has already interrupted and locked the entity's timeline for this reaction (a guard
   * break, mw-e04.31): the reaction holds it without interrupting or locking it again.
   */
  readonly locked?: boolean;
}

/** The reaction a guard break (GuardBroken, mw-e04.6) turns into: a stagger (see the file header). */
export const GUARD_BREAK_REACTION = 'stagger' satisfies HitReactionKind;

function stateOf(world: World<never>, entity: EntityId): HitReactionState | undefined {
  return world.get(entity, HitReactionComponent);
}

/** Whether the entity's move is committed (active or recovery), so a flinch cannot interrupt it. */
function committed(world: World<never>, entity: EntityId, moves: MoveTable): boolean {
  const current = world.get(entity, ActionTimelineComponent)?.current ?? null;
  if (current === null) return false;
  const move = moves.get(current.move);
  return move !== undefined && phaseAt(move, current.tick) !== 'startup';
}

/** Whether `entity` is performing a move flagged interruptible (mw-e04.14). */
function interruptible(world: World<never>, entity: EntityId, moves: MoveTable): boolean {
  const current = world.get(entity, ActionTimelineComponent)?.current ?? null;
  return current !== null && moves.get(current.move)?.interruptible === true;
}

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
const isZero = (v: Vec3): boolean => v.x === 0 && v.y === 0 && v.z === 0;

/**
 * Pushes an entity hit by a knockback or knockdown through physics; returns whether it moved it
 * (false when the entity is not the kind it moves). `instigator` is the hit's.
 */
export type Pusher = (
  world: World<never>,
  entity: EntityId,
  impulse: Vec3,
  profile: ReactionProfile,
  instigator: EntityId | null,
) => boolean;

/**
 * Launches a character (CharacterController, which the world must register) through the impulse API:
 * impulse over the profile's mass plus its launchSpeed upwards, staggering, sourced by the hit's
 * instigator (see the file header). A push with no rise leaves a grounded character on the ground.
 */
export const pushCharacter: Pusher = (world, entity, impulse, profile, instigator) => {
  const k = 1 / profile.mass;
  return applyCharacterImpulse(world, entity, {
    velocity: { x: impulse.x * k, y: impulse.y * k + profile.launchSpeed, z: impulse.z * k },
    source: instigator,
    stagger: true,
  });
};

/** Gives a physics object (PhysicsObjectComponent, registered) the impulse on its rigid body. */
export const pushPhysicsObject: Pusher = (world, entity, impulse) => {
  const body = world.get(entity, PhysicsObjectComponent);
  if (body === undefined) return false;
  rigidBodiesOf(world).applyImpulse(body.body as ColliderHandle, impulse);
  return true;
};

interface Start {
  readonly kind: HitReactionKind;
  readonly ticks: number;
  readonly direction: HitDirection;
  readonly impulse: Vec3;
  readonly suppressed: ReactionSuppression;
  readonly instigator: EntityId | null;
  readonly source: EntityId | null;
  /** The timeline is already locked for it (ReactionRequest.locked). */
  readonly locked: boolean;
  /** It interrupts the entity's move even when committed (an interrupt hit, mw-e04.14). */
  readonly interrupts?: boolean;
}

function start(
  world: World<never>,
  entity: EntityId,
  state: HitReactionState,
  options: HitReactionOptions,
  s: Start,
): HitReactionInfo {
  const tick = world.tick;
  const base = {
    tick,
    entity,
    direction: s.direction,
    instigator: s.instigator,
    source: s.source,
  };
  if (s.kind === 'none') {
    const info: HitReactionInfo = {
      ...base,
      reaction: 'none',
      ticks: 0,
      interrupted: false,
      displaced: false,
      suppressed: s.suppressed,
    };
    world.events.emit(HitReaction, info);
    return info;
  }
  const { kind, ticks } = s;
  const hasTimeline = world.get(entity, ActionTimelineComponent) !== undefined;
  const locked =
    hasTimeline &&
    (kind !== 'flinch' || s.interrupts === true || !committed(world, entity, options.moves));
  const interrupted = locked && !s.locked && interruptAction(world, entity, ticks);
  const pushes = (kind === 'knockback' || kind === 'knockdown') && !isZero(s.impulse);
  const displaced =
    pushes &&
    (options.pushers ?? []).some((p) => p(world, entity, s.impulse, state.profile, s.instigator));
  const endsAt = tick + 1 + ticks;
  const current: ActiveReaction = Object.freeze({
    kind,
    direction: s.direction,
    startedAt: tick,
    endsAt,
    interrupted: locked,
  });
  const down = kind === 'knockdown';
  world.set(
    entity,
    HitReactionComponent,
    Object.freeze({
      ...state,
      current,
      iframesFrom: down ? endsAt : 0,
      iframesUntil: down ? endsAt + WAKE_IFRAME_TICKS : 0,
    }),
  );
  const info: HitReactionInfo = {
    ...base,
    reaction: kind,
    ticks,
    interrupted,
    displaced,
    suppressed: null,
  };
  world.events.emit(HitReaction, info);
  return info;
}

function facingOf(world: World<never>, entity: EntityId, options: HitReactionOptions): Vec3 {
  return (options.facing ?? hurtboxFacing)(world, entity) ?? FORWARD;
}

/** Whether a chosen `kind` starting now takes over from `playing` (see the file header). */
function outlasts(
  world: World<never>,
  kind: Exclude<HitReactionKind, 'none'>,
  playing: ActiveReaction,
): boolean {
  const order = reactionRank(kind) - reactionRank(playing.kind);
  if (order !== 0) return order > 0;
  return world.tick + 1 + REACTION_TICKS[kind] >= playing.endsAt;
}

/**
 * Turns a resolved hit into `result.target`'s reaction (see the file header), applies it and emits
 * HitReaction. Returns what happened, or undefined when the target does not react to hits
 * (no HitReactionComponent) or the hit killed it. `installHitReactions` calls this on DamageApplied.
 */
export function resolveHitReaction(
  world: World<never>,
  result: DamageResult,
  options: HitReactionOptions,
): HitReactionInfo | undefined {
  const { target: entity, packet, tags } = result;
  const state = stateOf(world, entity);
  if (state === undefined || result.died) return undefined;
  const { impulse } = packet;
  const factors: ReactionFactors = {
    poiseDamage: result.poiseDamage,
    poiseBroken: result.poiseBroken,
    impulse: Math.sqrt(impulse.x * impulse.x + impulse.y * impulse.y + impulse.z * impulse.z),
    hyperarmor: tags.includes(REACTION_TAGS.hyperarmorBroken)
      ? 'broken'
      : tags.includes(REACTION_TAGS.hyperarmor)
        ? 'absorbed'
        : null,
    invulnerable: tags.includes(REACTION_TAGS.invulnerable) || hasWakeIframes(world, entity),
    critical: tags.includes(DAMAGE_TAGS.critical),
    forceful: tags.includes(DAMAGE_TAGS.force),
    staggering: tags.includes(DAMAGE_TAGS.staggering),
  };
  let { kind, suppressed } = chooseReaction(factors, state.profile);
  const playing = state.current;
  const interrupts =
    tags.includes(DAMAGE_TAGS.interrupt) &&
    !factors.invulnerable &&
    interruptible(world, entity, options.moves);
  if (tags.includes(DAMAGE_TAGS.blocked)) {
    kind = 'none';
    suppressed = 'blocked';
  } else if (tags.includes(DAMAGE_TAGS.parried)) {
    kind = 'none';
    suppressed = 'parried';
  } else if (interrupts) {
    if (kind === 'none') kind = 'flinch';
    suppressed = null;
  } else if (kind !== 'none' && playing !== null && !outlasts(world, kind, playing)) {
    kind = 'none';
    suppressed = 'weaker';
  }
  return start(world, entity, state, options, {
    kind,
    ticks: kind === 'none' ? 0 : REACTION_TICKS[kind],
    direction: hitDirection(facingOf(world, entity, options), packet.direction),
    impulse,
    suppressed,
    instigator: packet.instigator,
    source: packet.source,
    locked: false,
    interrupts,
  });
}

/**
 * Imposes `request` on `entity` whatever it is doing (a guard break's stagger: `{ kind: 'stagger',
 * ticks: 60 }`), replacing any reaction playing, and emits HitReaction. Returns what happened, or
 * undefined when `entity` does not react to hits. Throws a RangeError for a length that is not a
 * whole number of ticks ≥ 1.
 */
export function applyHitReaction(
  world: World<never>,
  entity: EntityId,
  request: ReactionRequest,
  options: HitReactionOptions,
): HitReactionInfo | undefined {
  const { kind } = request;
  const ticks = kind === 'none' ? 0 : (request.ticks ?? REACTION_TICKS[kind]);
  if (kind !== 'none' && !(Number.isSafeInteger(ticks) && ticks >= 1)) {
    throw new RangeError(
      `reaction length must be a whole number of ticks ≥ 1, got ${String(ticks)}`,
    );
  }
  const state = stateOf(world, entity);
  if (state === undefined) return undefined;
  return start(world, entity, state, options, {
    kind,
    ticks,
    direction: request.direction ?? 'front',
    impulse: request.impulse ?? ZERO,
    suppressed: null,
    instigator: request.instigator ?? null,
    source: request.source ?? null,
    locked: request.locked === true,
  });
}

/**
 * The hyperarmor rule, for the damage model's defender stage: while the target's move is inside its
 * `flags.hyperarmor` window, poise damage is absorbed (the hit is tagged `hyperarmor`, its poise
 * damage 0) until the absorbed total would exceed `poiseCap`; that hit breaks the armor (tagged
 * `hyperarmor-broken`, its poise damage passes through, it staggers) and the move has no hyperarmor
 * for the rest of that run. Only entities that react to hits keep a soak.
 */
export function hyperarmorModifier(moves: MoveTable): DamageModifier {
  return {
    name: 'hyperarmor',
    stage: 'defender',
    apply: (hit, { world, target }) => {
      if (hit.poiseDamage <= 0) return undefined;
      const state = stateOf(world, target);
      const current = world.get(target, ActionTimelineComponent)?.current ?? null;
      if (state === undefined || current === null) return undefined;
      const armor = moves.get(current.move)?.hyperarmor ?? null;
      if (armor === null || current.tick < armor.from || current.tick > armor.to) return undefined;
      const { startedAt } = current;
      const soak =
        state.armor?.startedAt === startedAt
          ? state.armor
          : { startedAt, absorbed: 0, broken: false };
      if (soak.broken) return undefined;
      const absorbed = soak.absorbed + hit.poiseDamage;
      const holds = absorbed <= armor.poiseCap;
      world.set(
        target,
        HitReactionComponent,
        Object.freeze({
          ...state,
          armor: Object.freeze(holds ? { ...soak, absorbed } : { ...soak, broken: true }),
        }),
      );
      return holds
        ? { ...hit, poiseDamage: 0, tags: [...hit.tags, REACTION_TAGS.hyperarmor] }
        : { ...hit, tags: [...hit.tags, REACTION_TAGS.hyperarmorBroken] };
    },
  };
}

/**
 * The wake-up invulnerability rule, for the damage model's attacker stage: a hit on an entity in
 * its wake-up i-frames deals no damage, poise or stamina damage and is tagged `invulnerable`. Hits
 * through hit volumes or the attack executor never get here when they are given
 * `invulnerabilityRule` (they become DodgedHit); this catches damage from every other path.
 */
export function wakeIframesModifier(): DamageModifier {
  return {
    name: 'wake-up-iframes',
    stage: 'attacker',
    apply: (hit, { world, target }) =>
      hasWakeIframes(world, target)
        ? {
            amounts: {},
            poiseDamage: 0,
            staminaDamage: 0,
            tags: [...hit.tags, REACTION_TAGS.invulnerable],
          }
        : undefined,
  };
}

/** A reaction (and a knockdown's wake-up i-frames) one frozen tick later: hit-stop held it still. */
function held(state: HitReactionState, current: ActiveReaction): HitReactionState {
  const down = current.kind === 'knockdown';
  return Object.freeze({
    ...state,
    current: Object.freeze({ ...current, endsAt: current.endsAt + 1 }),
    iframesFrom: down ? state.iframesFrom + 1 : state.iframesFrom,
    iframesUntil: down ? state.iframesUntil + 1 : state.iframesUntil,
  });
}

/**
 * Ends reactions whose time is up, emitting HitReactionEnded; a reaction frozen by hit-stop this tick
 * waits a tick longer instead (see the file header).
 */
export function hitReactionSystem<TInput>(): System<TInput> {
  return {
    name: 'hit-reactions',
    run: ({ world }) => {
      const w: World<never> = world;
      w.query(HitReactionComponent).forEach((entity, state) => {
        const { current } = state;
        if (current === null) return;
        if (isHitStopped(w, entity)) {
          w.set(entity, HitReactionComponent, held(state, current));
          return;
        }
        if (w.tick < current.endsAt) return;
        w.set(entity, HitReactionComponent, Object.freeze({ ...state, current: null }));
        w.events.emit(HitReactionEnded, {
          tick: w.tick,
          entity,
          reaction: current.kind,
          iframesUntil: current.kind === 'knockdown' ? state.iframesUntil : null,
        });
      });
    },
  };
}

/** What `installHitReactions` wires. */
export interface InstallHitReactionOptions extends HitReactionOptions {
  /** The damage model hits resolve through: gets the hyperarmor and wake-up i-frame modifiers. */
  readonly damage: DamageModel;
}

/**
 * Wires the reaction rules into `world`: the hit-reaction system (appended), a DamageApplied
 * subscription that resolves each hit's reaction, a GuardBroken subscription that plays the
 * guard-break reaction (see the file header), and the hyperarmor and wake-up i-frame modifiers
 * on `damage`. Register HitReactionComponent (and the damage and action timeline components) first.
 * Returns a function that removes the subscription and the modifiers (the system stays, as systems
 * always do).
 */
export function installHitReactions<TInput>(
  world: World<TInput>,
  options: InstallHitReactionOptions,
): () => void {
  const w: World<never> = world;
  world.addSystem(hitReactionSystem());
  const modifiers = [
    options.damage.register(wakeIframesModifier()),
    options.damage.register(hyperarmorModifier(options.moves)),
  ];
  const offs = [
    world.events.on(GuardBroken, ({ entity, staggerTicks, instigator, source }) => {
      const request = { instigator, source, locked: true };
      applyHitReaction(
        w,
        entity,
        { kind: GUARD_BREAK_REACTION, ticks: staggerTicks, ...request },
        options,
      );
    }),
    world.events.on(DamageApplied, (result) => {
      resolveHitReaction(w, result, options);
    }),
  ];
  return () => {
    for (const off of offs) off();
    for (const id of modifiers) options.damage.unregister(id);
  };
}
