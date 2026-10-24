// The mana pool (mw-e06.3): the casting resource. It plugs into the spell pipeline as a CastGate, so
// the pipeline core knows nothing about mana (ADR-0007); `installMana` registers the component, the
// gate and the regen system. Conventions mirror stamina (src/sim/combat/stamina.ts): a profile
// carried by each pool, arithmetic in whole quanta of 1/6000 point, regen paused until an absolute
// tick, values replaced and never mutated.
//
// - Check: a learned-spell cast needs `cost` mana available (current − reserved). Short on mana, a
//   spell with `flags.allowOvercast` still casts; any other is refused "insufficient-mana". A cost
//   of 0 needs no pool. A caster with no pool and a real cost is refused "no-mana-pool".
// - Spend: runs once the delivery started (so a fizzle costs nothing). An over-cast spends whatever
//   is available (mana goes to 0) and emits MiscastRequested; severity is deficit / cost in (0, 1]
//   and the miscast system (mw-e06.13) rolls the outcome. Free (scroll) casts never reach the gate.
// - Regen: starts `regenDelayTicks` after the last spend (the spend tick does not count), then runs
//   at `regenPerSecond`. 5/s after 90 ticks is the sorcerer's (ADR-0004); stat growth changes `max`,
//   never the rates.
// - Reservation: a channeled spell holds its cost with `reserveMana` while it runs; held mana can
//   neither be spent nor counted as available, and `releaseMana` frees it or pays it.
// - Interruption: `refundInterrupted` returns `interruptRefund` (default 50 %) of what a cast spent.
//
// ManaChanged is the one event the HUD needs; it is emitted on every change (regen included).

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import type { CastGate, GateContext, SpellPipeline } from './pipeline';

/** Tunable mana numbers. Rates are per second of sim time; the delay is in sim ticks (60 Hz). */
export interface ManaProfile {
  /** Full pool. */
  readonly max: number;
  /** Refill rate once the regen pause is over. */
  readonly regenPerSecond: number;
  /** Ticks after the last spend before regen starts. */
  readonly regenDelayTicks: number;
  /** Fraction (0–1) of a cast's spend returned when it is interrupted during its cast phase. */
  readonly interruptRefund: number;
}

/** The sorcerer's mana (ADR-0004): 100 max, 5/s after 1.5 s (90 ticks), half refunded on interrupt. */
export const DEFAULT_MANA_PROFILE: ManaProfile = Object.freeze({
  max: 100,
  regenPerSecond: 5,
  regenDelayTicks: 90,
  interruptRefund: 0.5,
});

/** Mana arithmetic runs in whole quanta of 1/6000 point so per-tick regen never drifts. */
export const MANA_QUANTA_PER_POINT = 6000;
const toQuanta = (points: number): number => Math.round(points * MANA_QUANTA_PER_POINT);
const fromQuanta = (quanta: number): number => quanta / MANA_QUANTA_PER_POINT;

/** One entity's mana pool. */
export interface Mana {
  readonly profile: ManaProfile;
  /** Current mana in [0, profile.max]; fractional while regenerating. */
  readonly current: number;
  /** Mana held by running channels; part of `current` but not available. */
  readonly reserved: number;
  /** First tick on which regen may run. */
  readonly regenResumesAt: number;
}

/** Why `value` is not a valid ManaProfile, or undefined when it is. Accepts untyped input. */
export function validateManaProfile(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'mana profile must be an object';
  const f = value as Record<string, unknown>;
  for (const key of ['max', 'regenPerSecond', 'regenDelayTicks', 'interruptRefund'] as const) {
    const n = f[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return `mana profile ${key} must be a finite number ≥ 0`;
    }
  }
  const profile = value as ManaProfile;
  if (profile.max === 0) return 'mana profile max must be > 0';
  if (!Number.isSafeInteger(profile.regenDelayTicks)) {
    return 'mana profile regenDelayTicks must be whole ticks';
  }
  if (profile.interruptRefund > 1) return 'mana profile interruptRefund must be ≤ 1';
  return undefined;
}

function frozenProfile(value: unknown): ManaProfile {
  const problem = validateManaProfile(value);
  if (problem !== undefined) throw new RangeError(problem);
  const { max, regenPerSecond, regenDelayTicks, interruptRefund } = value as ManaProfile;
  return Object.freeze({ max, regenPerSecond, regenDelayTicks, interruptRefund });
}

function deserializeMana(data: unknown): Mana {
  if (typeof data !== 'object' || data === null) throw new RangeError('mana must be an object');
  const f = data as Record<string, unknown>;
  const profile = frozenProfile(f['profile']);
  const { current, reserved, regenResumesAt } = f;
  if (typeof current !== 'number' || !(current >= 0 && current <= profile.max)) {
    throw new RangeError('mana.current must be a number in [0, max]');
  }
  if (typeof reserved !== 'number' || !(reserved >= 0 && reserved <= current)) {
    throw new RangeError('mana.reserved must be a number in [0, current]');
  }
  if (typeof regenResumesAt !== 'number' || !Number.isSafeInteger(regenResumesAt)) {
    throw new RangeError('mana.regenResumesAt must be an integer tick');
  }
  return Object.freeze({ profile, current, reserved, regenResumesAt });
}

/** The mana component (`magic.mana`; a snapshot and save key, never renamed). */
export const ManaComponent = defineComponent<Mana>('magic.mana', { deserialize: deserializeMana });

/** Why a pool changed. */
export type ManaChangeReason = 'spend' | 'overcast' | 'regen' | 'refund' | 'release' | 'restore';

/** Payload of ManaChanged: the HUD's cue to redraw the bar. */
export interface ManaChangedInfo {
  readonly entity: EntityId;
  readonly tick: number;
  readonly current: number;
  readonly max: number;
  /** New − old current; negative when mana was spent. */
  readonly delta: number;
  readonly reason: ManaChangeReason;
}
export const ManaChanged = defineEvent<ManaChangedInfo>('ManaChanged');

/** A cast went past the available mana: the miscast system (mw-e06.13) rolls what goes wrong. */
export interface MiscastRequestedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly spell: string;
  /** Mana the cast was short by. */
  readonly deficit: number;
  /** deficit / cost, in (0, 1]. */
  readonly severity: number;
}
export const MiscastRequested = defineEvent<MiscastRequestedInfo>('MiscastRequested');

/** Reason a gate refuses a cast for lack of mana. */
export const INSUFFICIENT_MANA = 'insufficient-mana';
/** Reason a gate refuses a costed cast by a caster who has no pool. */
export const NO_MANA_POOL = 'no-mana-pool';

/** Gives `entity` a full pool with `profile` (validated; RangeError if invalid). */
export function giveMana(
  world: World<never>,
  entity: EntityId,
  profile: ManaProfile = DEFAULT_MANA_PROFILE,
): void {
  const frozen = frozenProfile(profile);
  world.add(
    entity,
    ManaComponent,
    Object.freeze({ profile: frozen, current: frozen.max, reserved: 0, regenResumesAt: 0 }),
  );
}

/** `entity`'s pool, or undefined when it has none. */
export function manaOf(world: World<never>, entity: EntityId): Mana | undefined {
  return world.get(entity, ManaComponent);
}

/** Mana `entity` can spend now: current minus what channels hold (0 with no pool). */
export function availableMana(world: World<never>, entity: EntityId): number {
  const pool = manaOf(world, entity);
  return pool === undefined ? 0 : fromQuanta(toQuanta(pool.current) - toQuanta(pool.reserved));
}

function poolOf(world: World<never>, entity: EntityId): Mana {
  const pool = manaOf(world, entity);
  if (pool === undefined) throw new Error(`entity ${String(entity)} has no mana pool`);
  return pool;
}

function requireAmount(what: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`${what} must be a finite number ≥ 0, got ${String(amount)}`);
  }
}

function commit(
  world: World<never>,
  entity: EntityId,
  pool: Mana,
  next: Mana,
  reason: ManaChangeReason,
): void {
  world.set(entity, ManaComponent, Object.freeze(next));
  if (next.current === pool.current) return;
  world.events.emit(ManaChanged, {
    entity,
    tick: world.tick,
    current: next.current,
    max: next.profile.max,
    delta: fromQuanta(toQuanta(next.current) - toQuanta(pool.current)),
    reason,
  });
}

/** Takes up to `amount` of the available mana and restarts the regen pause; returns what was taken. */
function take(world: World<never>, entity: EntityId, amount: number, reason: ManaChangeReason) {
  const pool = poolOf(world, entity);
  const taken = Math.min(toQuanta(amount), toQuanta(availableMana(world, entity)));
  commit(
    world,
    entity,
    pool,
    {
      ...pool,
      current: fromQuanta(toQuanta(pool.current) - taken),
      regenResumesAt: world.tick + pool.profile.regenDelayTicks + 1,
    },
    reason,
  );
  return fromQuanta(taken);
}

/**
 * Spends `cost` (at most what is available) and returns the amount actually spent. Throws without a
 * pool or for an invalid cost. This is what the gate calls; it is public for non-spell costs.
 */
export function spendMana(world: World<never>, entity: EntityId, cost: number): number {
  requireAmount('mana cost', cost);
  poolOf(world, entity);
  return cost === 0 ? 0 : take(world, entity, cost, 'spend');
}

/** Adds `amount` (clamped at max) without touching the regen pause; returns what was added. */
function addMana(
  world: World<never>,
  entity: EntityId,
  amount: number,
  reason: ManaChangeReason = 'restore',
): number {
  requireAmount('mana restore', amount);
  const pool = poolOf(world, entity);
  const next = Math.min(toQuanta(pool.profile.max), toQuanta(pool.current) + toQuanta(amount));
  commit(world, entity, pool, { ...pool, current: fromQuanta(next) }, reason);
  return fromQuanta(next - toQuanta(pool.current));
}

/** Gives back `amount` (a potion, a shrine's refill, the inn bed): clamped at max. Returns the gain. */
export function restoreMana(world: World<never>, entity: EntityId, amount: number): number {
  return addMana(world, entity, amount);
}

/**
 * A cast was interrupted in its cast phase: returns `profile.interruptRefund` of the `spent` mana
 * (default half; configurable per pool). Returns the amount refunded.
 */
export function refundInterrupted(world: World<never>, entity: EntityId, spent: number): number {
  requireAmount('mana spent', spent);
  const pool = poolOf(world, entity);
  return addMana(world, entity, spent * pool.profile.interruptRefund, 'refund');
}

/** Holds `amount` of the available mana for a channel. False (nothing held) when not enough is free. */
export function reserveMana(world: World<never>, entity: EntityId, amount: number): boolean {
  requireAmount('mana reservation', amount);
  const pool = poolOf(world, entity);
  if (toQuanta(amount) > toQuanta(availableMana(world, entity))) return false;
  commit(
    world,
    entity,
    pool,
    { ...pool, reserved: fromQuanta(toQuanta(pool.reserved) + toQuanta(amount)) },
    'spend',
  );
  return true;
}

/**
 * Ends a reservation of `amount` (at most what is held): `pay` spends it (the channel ran) and
 * restarts the regen pause, otherwise it is simply freed. Returns the amount released.
 */
export function releaseMana(
  world: World<never>,
  entity: EntityId,
  amount: number,
  pay: boolean,
): number {
  requireAmount('mana release', amount);
  const pool = poolOf(world, entity);
  const released = Math.min(toQuanta(amount), toQuanta(pool.reserved));
  const reserved = fromQuanta(toQuanta(pool.reserved) - released);
  commit(
    world,
    entity,
    pool,
    pay
      ? {
          ...pool,
          reserved,
          current: fromQuanta(toQuanta(pool.current) - released),
          regenResumesAt: world.tick + pool.profile.regenDelayTicks + 1,
        }
      : { ...pool, reserved },
    'release',
  );
  return fromQuanta(released);
}

/** The mana gate for the spell pipeline: see the file header. Neither hook runs for a free cast. */
export function manaGate(): CastGate {
  return {
    name: 'mana',
    check: ({ world, request, spell }: GateContext) => {
      const cost = spell.cost.mana;
      if (cost === 0) return undefined;
      if (manaOf(world, request.caster) === undefined) return NO_MANA_POOL;
      if (availableMana(world, request.caster) >= cost) return undefined;
      return spell.flags.allowOvercast ? undefined : INSUFFICIENT_MANA;
    },
    spend: ({ world, request, spell }: GateContext) => {
      const cost = spell.cost.mana;
      if (cost === 0) return;
      const available = availableMana(world, request.caster);
      if (available >= cost) {
        take(world, request.caster, cost, 'spend');
        return;
      }
      take(world, request.caster, available, 'overcast');
      const deficit = fromQuanta(toQuanta(cost) - toQuanta(available));
      world.events.emit(MiscastRequested, {
        tick: world.tick,
        caster: request.caster,
        spell: spell.id,
        deficit,
        severity: deficit / cost,
      });
    },
  };
}

/** Regenerates every pool once the regen pause is over. Add after the spells system. */
export function manaSystem<TInput>(): System<TInput> {
  return {
    name: 'mana',
    run: ({ world, tick, clock }) => {
      world.query(ManaComponent).forEach((entity, pool) => {
        const { profile } = pool;
        if (tick < pool.regenResumesAt || pool.current >= profile.max) return;
        const regen = toQuanta(pool.current) + toQuanta(profile.regenPerSecond / clock.hz);
        const current = fromQuanta(Math.min(toQuanta(profile.max), regen));
        commit(world, entity, pool, { ...pool, current }, 'regen');
      });
    },
  };
}

/**
 * Makes `world` track mana: registers the component, adds the regen system and registers the mana
 * gate on `pipeline`. Call once at setup, after `installSpells`, outside a step.
 */
export function installMana<TInput>(world: World<TInput>, pipeline: SpellPipeline): void {
  world.register(ManaComponent);
  world.addSystem(manaSystem<TInput>());
  pipeline.addGate(manaGate());
}
