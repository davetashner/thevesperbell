// The stamina pool (mw-e04.5): attacks, dodges, blocked hits and sprinting all draw from one bar, which
// is what gives souls-like fights their rhythm — commit, breathe, defend. The rules:
//
// - Spending: an action with a cost is allowed whenever stamina > 0 and may drive it to 0, never below
//   (the "last action" rule: a desperate roll on 5 stamina still happens). At exactly 0 it is refused
//   with one ActionRejected{reason:"stamina"} per request.
// - Regen pauses for `regenDelayTicks` after the last spend, then refills at `regenPerSecond`, scaled
//   by `blockingRegenMultiplier` while the shield is up.
// - Reaching 0 makes the entity Exhausted: the regen pause lengthens to `exhaustedRegenDelayTicks` and
//   sprint is refused until stamina climbs back to `sprintRecoverThreshold`. Exhaustion is announced
//   with StaminaExhausted / StaminaRecovered so audio and animation can make "out of breath" readable
//   without the HUD.
//
// Tuning lives in a StaminaProfile carried by each pool (so armor weight or a creature can change it
// per entity and snapshots keep it); DEFAULT_STAMINA_PROFILE holds the bead's knight numbers. Time is
// ticks: the regen pause is an absolute "resumes at" tick, so it does not matter whether the spending
// system runs before or after the stamina system within a tick.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { ActionRejected } from './actions';

/** Tunable stamina numbers. Rates are per second of sim time; delays are sim ticks (60 Hz). */
export interface StaminaProfile {
  /** Full bar. */
  readonly max: number;
  /** Refill rate once the regen pause is over. */
  readonly regenPerSecond: number;
  /** Ticks after the last spend before regen starts. */
  readonly regenDelayTicks: number;
  /** The regen pause while Exhausted. */
  readonly exhaustedRegenDelayTicks: number;
  /** Regen scale while blocking (0–1). */
  readonly blockingRegenMultiplier: number;
  /** Drain while sprinting. */
  readonly sprintDrainPerSecond: number;
  /** Stamina at which Exhausted ends and sprint is allowed again (0 < threshold ≤ max). */
  readonly sprintRecoverThreshold: number;
  /**
   * Sprint is never allowed (an Overloaded armor load, mw-e04.16). Absent = allowed; only ever set
   * to true, so profiles that never carried it keep their snapshots.
   */
  readonly noSprint?: true;
}

/**
 * The knight's stamina (mw-e04.5): 100 max, 40/s regen after 30 ticks (500 ms), ×0.35 while blocking,
 * 72-tick (1.2 s) pause and no sprint below 20 when Exhausted, sprint drains 10/s.
 */
export const DEFAULT_STAMINA_PROFILE: StaminaProfile = Object.freeze({
  max: 100,
  regenPerSecond: 40,
  regenDelayTicks: 30,
  exhaustedRegenDelayTicks: 72,
  blockingRegenMultiplier: 0.35,
  sprintDrainPerSecond: 10,
  sprintRecoverThreshold: 20,
});

/**
 * Stamina arithmetic runs in whole quanta of 1/6000 point, so per-tick regen and drain never drift
 * (six ticks of 1/6 must reach exactly 0, not 1e-16). At 60 Hz any rate with at most one decimal per
 * second (40/s, 40 × 0.35 = 14/s, 10/s) is a whole number of quanta per tick, so the bead's numbers
 * are exact. Values are stored as points (quanta / 6000) so readers never see the unit.
 */
export const STAMINA_QUANTA_PER_POINT = 6000;

const toQuanta = (points: number): number => Math.round(points * STAMINA_QUANTA_PER_POINT);
const fromQuanta = (quanta: number): number => quanta / STAMINA_QUANTA_PER_POINT;

/** One entity's stamina pool. Values are replaced, never mutated. */
export interface Stamina {
  readonly profile: StaminaProfile;
  /** Current stamina in [0, profile.max]; fractional while regenerating. */
  readonly current: number;
  /** Set on reaching 0; cleared when stamina reaches `sprintRecoverThreshold`. */
  readonly exhausted: boolean;
  /** First tick on which regen may run. */
  readonly regenResumesAt: number;
  /** Shield raised (slows regen). Set by the block rule via `setBlocking`. */
  readonly blocking: boolean;
  /** Sprint input held. Set by the controller via `setSprintHeld`. */
  readonly sprintHeld: boolean;
  /** Whether the entity sprinted on the last stamina tick (held and allowed); movement reads this. */
  readonly sprinting: boolean;
}

const PROFILE_KEYS = [
  'max',
  'regenPerSecond',
  'regenDelayTicks',
  'exhaustedRegenDelayTicks',
  'blockingRegenMultiplier',
  'sprintDrainPerSecond',
  'sprintRecoverThreshold',
] as const;

/** Why `value` is not a valid StaminaProfile, or undefined when it is. Accepts untyped input. */
export function validateStaminaProfile(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'stamina profile must be an object';
  const fields = value as Record<string, unknown>;
  for (const key of PROFILE_KEYS) {
    const n = fields[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return `stamina profile ${key} must be a finite number ≥ 0`;
    }
  }
  const profile = value as StaminaProfile;
  if (profile.max === 0) return 'stamina profile max must be > 0';
  if (
    !Number.isSafeInteger(profile.regenDelayTicks) ||
    !Number.isSafeInteger(profile.exhaustedRegenDelayTicks)
  ) {
    return 'stamina profile delays must be whole ticks';
  }
  if (fields['noSprint'] !== undefined && fields['noSprint'] !== true) {
    return 'stamina profile noSprint must be true or absent';
  }
  if (profile.blockingRegenMultiplier > 1) {
    return 'stamina profile blockingRegenMultiplier must be ≤ 1';
  }
  if (profile.sprintRecoverThreshold === 0 || profile.sprintRecoverThreshold > profile.max) {
    return 'stamina profile sprintRecoverThreshold must be in (0, max]';
  }
  return undefined;
}

function frozenProfile(value: unknown): StaminaProfile {
  const problem = validateStaminaProfile(value);
  if (problem !== undefined) throw new RangeError(problem);
  const fields = value as StaminaProfile;
  const profile: Record<string, number> = {};
  for (const key of PROFILE_KEYS) profile[key] = fields[key];
  return Object.freeze(
    fields.noSprint === true ? { ...profile, noSprint: true } : profile,
  ) as StaminaProfile;
}

function restoreStamina(data: unknown): Stamina {
  if (typeof data !== 'object' || data === null) throw new RangeError('stamina must be an object');
  const fields = data as Record<string, unknown>;
  const profile = frozenProfile(fields['profile']);
  const { current, regenResumesAt } = fields;
  if (typeof current !== 'number' || !(current >= 0 && current <= profile.max)) {
    throw new RangeError('stamina.current must be a number in [0, max]');
  }
  if (typeof regenResumesAt !== 'number' || !Number.isSafeInteger(regenResumesAt)) {
    throw new RangeError('stamina.regenResumesAt must be an integer tick');
  }
  for (const flag of ['exhausted', 'blocking', 'sprintHeld', 'sprinting'] as const) {
    if (typeof fields[flag] !== 'boolean')
      throw new RangeError(`stamina.${flag} must be a boolean`);
  }
  const flags = data as Stamina;
  return Object.freeze({
    profile,
    current,
    exhausted: flags.exhausted,
    regenResumesAt,
    blocking: flags.blocking,
    sprintHeld: flags.sprintHeld,
    sprinting: flags.sprinting,
  });
}

/** The stamina component (`combat.stamina`; a snapshot and save key, never renamed). */
export const StaminaComponent = defineComponent<Stamina>('combat.stamina', {
  deserialize: restoreStamina,
});

/** Payload of StaminaExhausted and StaminaRecovered. */
export interface StaminaChange {
  readonly entity: EntityId;
  readonly tick: number;
}

/** Stamina hit 0: cue heavy breathing / a stagger-to-catch-breath animation. */
export const StaminaExhausted = defineEvent<StaminaChange>('StaminaExhausted');

/** Exhaustion ended (stamina reached the recovery threshold). */
export const StaminaRecovered = defineEvent<StaminaChange>('StaminaRecovered');

/**
 * Gives `entity` a full stamina pool with `profile` (validated; RangeError if invalid). Adding a
 * component is structural, so during a step the pool exists from the end of the tick.
 */
export function giveStamina(
  world: World<never>,
  entity: EntityId,
  profile: StaminaProfile = DEFAULT_STAMINA_PROFILE,
): void {
  const frozen = frozenProfile(profile);
  world.add(
    entity,
    StaminaComponent,
    Object.freeze({
      profile: frozen,
      current: frozen.max,
      exhausted: false,
      regenResumesAt: 0,
      blocking: false,
      sprintHeld: false,
      sprinting: false,
    }),
  );
}

/** `entity`'s stamina pool, or undefined when it has none. */
export function staminaOf(world: World<never>, entity: EntityId): Stamina | undefined {
  return world.get(entity, StaminaComponent);
}

function poolOf(world: World<never>, entity: EntityId): Stamina {
  const pool = world.get(entity, StaminaComponent);
  if (pool === undefined) throw new Error(`entity ${String(entity)} has no stamina pool`);
  return pool;
}

function update(world: World<never>, entity: EntityId, pool: Stamina, changes: Partial<Stamina>) {
  world.set(entity, StaminaComponent, Object.freeze({ ...pool, ...changes }));
}

/**
 * `pool` after losing `amount` (clamped at 0) on `tick`: the regen pause restarts, and reaching 0 makes
 * the pool Exhausted. Shared by action costs, blocked hits and sprint drain.
 */
function drained(pool: Stamina, amount: number, tick: number): Stamina {
  const current = fromQuanta(Math.max(0, toQuanta(pool.current) - toQuanta(amount)));
  const exhausted = pool.exhausted || current === 0;
  const { regenDelayTicks, exhaustedRegenDelayTicks } = pool.profile;
  return Object.freeze({
    ...pool,
    current,
    exhausted,
    regenResumesAt: tick + (exhausted ? exhaustedRegenDelayTicks : regenDelayTicks),
  });
}

/** Stores `next` for `entity`, announcing exhaustion if it just began. Returns the amount drained. */
function commitDrain(
  world: World<never>,
  entity: EntityId,
  pool: Stamina,
  next: Stamina,
  tick: number,
) {
  world.set(entity, StaminaComponent, next);
  if (next.exhausted && !pool.exhausted) world.events.emit(StaminaExhausted, { entity, tick });
  return fromQuanta(toQuanta(pool.current) - toQuanta(next.current));
}

function requireAmount(what: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`${what} must be a finite number ≥ 0, got ${String(amount)}`);
  }
}

/**
 * Pays `cost` for `action` (an abstract action id such as "attack" or "dodge"). Allowed whenever
 * stamina > 0, and may drive it to 0 but never below; a cost of 0 is always allowed and changes
 * nothing. When refused (stamina is 0), emits one ActionRejected{reason:"stamina"} and returns false;
 * call it once per request so a held button is not re-rejected every tick. Stamina is spent when the
 * action starts and is never refunded. Throws if `entity` has no stamina pool or `cost` is invalid.
 */
export function spendStamina(
  world: World<never>,
  entity: EntityId,
  action: string,
  cost: number,
): boolean {
  requireAmount('stamina cost', cost);
  const pool = poolOf(world, entity);
  if (cost === 0) return true;
  const tick = world.tick;
  if (pool.current === 0) {
    world.events.emit(ActionRejected, { entity, action, reason: 'stamina', tick });
    return false;
  }
  commitDrain(world, entity, pool, drained(pool, cost, tick), tick);
  return true;
}

/**
 * Takes `amount` of stamina without gating (e.g. a blocked hit's stamina damage) and returns how much
 * was actually drained; `amount − drained` is the shortfall the block rule turns into a guard break.
 * Restarts the regen pause and can exhaust the pool like a spend.
 */
export function drainStamina(world: World<never>, entity: EntityId, amount: number): number {
  requireAmount('stamina drain', amount);
  const pool = poolOf(world, entity);
  if (amount === 0) return 0;
  const tick = world.tick;
  return commitDrain(world, entity, pool, drained(pool, amount, tick), tick);
}

/** Whether `pool` may start or keep sprinting: not Exhausted, not empty and not forbidden. */
export function canSprint(pool: Stamina): boolean {
  return !pool.exhausted && pool.current > 0 && pool.profile.noSprint !== true;
}

/** Records whether the shield is raised; regen runs at `blockingRegenMultiplier` while it is. */
export function setBlocking(world: World<never>, entity: EntityId, blocking: boolean): void {
  const pool = poolOf(world, entity);
  if (pool.blocking !== blocking) update(world, entity, pool, { blocking });
}

/**
 * Records whether sprint is held; the stamina system decides each tick whether the entity actually
 * sprints (see `Stamina.sprinting`). Pressing sprint while it is not allowed emits one
 * ActionRejected{action:"sprint", reason:"stamina"}; if still held, sprint starts by itself once the
 * pool recovers. Returns whether sprint is held and currently allowed.
 */
export function setSprintHeld(world: World<never>, entity: EntityId, held: boolean): boolean {
  const pool = poolOf(world, entity);
  const allowed = canSprint(pool);
  if (held && !pool.sprintHeld && !allowed) {
    world.events.emit(ActionRejected, {
      entity,
      action: 'sprint',
      reason: pool.profile.noSprint === true ? 'overloaded' : 'stamina',
      tick: world.tick,
    });
  }
  if (pool.sprintHeld !== held) update(world, entity, pool, { sprintHeld: held });
  return held && allowed;
}

/**
 * Runs sprint drain, regen and exhaustion recovery for every pool, once per tick. Add it before the
 * movement system (which reads `sprinting`); action systems may run before or after it.
 */
export function staminaSystem<TInput>(): System<TInput> {
  return {
    name: 'stamina',
    run: ({ world, tick, clock }) => {
      world.query(StaminaComponent).forEach((entity, pool) => {
        const { profile } = pool;
        if (pool.sprintHeld && canSprint(pool)) {
          const next = drained(pool, profile.sprintDrainPerSecond / clock.hz, tick);
          commitDrain(world, entity, pool, Object.freeze({ ...next, sprinting: true }), tick);
          return;
        }
        let { current, exhausted } = pool;
        if (tick >= pool.regenResumesAt && current < profile.max) {
          const rate =
            profile.regenPerSecond * (pool.blocking ? profile.blockingRegenMultiplier : 1);
          const regen = toQuanta(current) + toQuanta(rate / clock.hz);
          current = fromQuanta(Math.min(toQuanta(profile.max), regen));
        }
        const recovers = exhausted && current >= profile.sprintRecoverThreshold;
        if (recovers) exhausted = false;
        if (current !== pool.current || recovers || pool.sprinting) {
          update(world, entity, pool, { current, exhausted, sprinting: false });
        }
        if (recovers) world.events.emit(StaminaRecovered, { entity, tick });
      });
    },
  };
}
