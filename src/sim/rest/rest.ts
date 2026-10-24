// Resting (mw-ju8.6, the thin slice of mw-e27.13): sleep at an inn until morning. It passes the world
// day clock (./day-clock.ts) to 06:00, fully restores health, stamina and mana, and announces
// `rest.completed { kind, hours, point }`, the shape mw-e27.13 names for rest-reset persistence
// policies. Paying is the shop's job (src/sim/economy/shop.ts `buyService`); this only rests.
//
// Safety: the caller passes the autosave "unsafe" veto registry's verdict as `safety` (null = fine,
// else the reason), so no one sleeps with hostiles alerted nearby; the registry itself lives in the
// game layer (src/game/save/autosave/vetoes.ts). The autosave after a rest is requested by the game
// when it hears `rest.completed`.
//
// Out of scope until mw-e27.13: campfire and shrine rest, durations other than "until morning",
// interrupts and prorated restoration, the rest-action registry.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { gameClockOf, gameDayClock } from '../gametime/clock';
import { DEFAULT_POOLS, type ItemPool, type PoolRestorer } from '../items/consumables';
import {
  addMinutes,
  factDayClock,
  minutesUntilMorning,
  type DayClock,
  type TimeOfDay,
} from './day-clock';

/** Kinds of rest point. Only `inn` exists in the slice; mw-e27.13 adds `campfire` and `shrine`. */
export type RestKind = 'inn';

/** An actor finished resting. */
export interface RestCompleted {
  readonly tick: number;
  readonly actor: EntityId;
  readonly kind: RestKind;
  /** Hours slept (fractional when the sleep does not start on the hour). */
  readonly hours: number;
  /** The rest point: the innkeeper's merchant id until rest points are entities (mw-e27.13). */
  readonly point: string;
  /** The time on waking. */
  readonly wakes: TimeOfDay;
}

export const restCompleted = defineEvent<RestCompleted>('rest.completed');

/** Points added to a pool when restoring "fully": more than any pool holds. */
const FULL = 1_000_000;

/** What to rest with. */
export interface RestOptions {
  readonly kind: RestKind;
  readonly point: string;
  /** The day clock; the world's game clock (else its facts) when omitted. */
  readonly clock?: DayClock;
  /** The safety verdict: null when it is safe to rest, else why not (the autosave veto registry's). */
  readonly safety?: () => string | null;
  /** Pool restorers; health and stamina by default. Mana joins when actors have a mana pool (e06). */
  readonly pools?: Readonly<Partial<Record<ItemPool, PoolRestorer>>>;
}

export type RestResult =
  | {
      readonly ok: true;
      readonly hours: number;
      readonly wakes: TimeOfDay;
      /** Points each pool actually gained. */
      readonly restored: Readonly<Partial<Record<ItemPool, number>>>;
    }
  | { readonly ok: false; readonly reason: 'unsafe'; readonly detail: string };

/** Why resting is unsafe right now, or null. */
export function restBlocked(options: Pick<RestOptions, 'safety'>): string | null {
  return options.safety?.() ?? null;
}

/**
 * Sleeps `actor` until the next morning. Refused (`unsafe`, nothing changed) when the safety verdict
 * objects. Otherwise advances the clock, restores every pool, emits `rest.completed` and returns what
 * happened.
 */
export function restUntilMorning(
  world: World<never>,
  actor: EntityId,
  options: RestOptions,
): RestResult {
  const detail = restBlocked(options);
  if (detail !== null) return { ok: false, reason: 'unsafe', detail };
  const game = gameClockOf(world);
  const clock =
    options.clock ?? (game === undefined ? factDayClock(world.facts) : gameDayClock(game));
  const minutes = minutesUntilMorning(clock.now());
  const wakes = addMinutes(clock.now(), minutes);
  clock.set(wakes);
  const restored: Partial<Record<ItemPool, number>> = {};
  for (const [pool, restore] of Object.entries({ ...DEFAULT_POOLS, ...options.pools })) {
    restored[pool as ItemPool] = restore(world, actor, FULL);
  }
  const hours = Math.round((minutes / 60) * 100) / 100;
  world.events.emit(restCompleted, {
    tick: world.tick,
    actor,
    kind: options.kind,
    hours,
    point: options.point,
    wakes,
  });
  return { ok: true, hours, wakes, restored };
}
