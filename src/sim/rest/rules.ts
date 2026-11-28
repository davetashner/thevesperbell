// Resting at a rest point (mw-e27.13): the shared verb behind inn beds, campfires and shrines.
//
// `RestRules` holds the per-kind rules (data: content `rest-point`) and does the rest:
//   request → checks → pass the time → interrupts → restore → events.
// - Checks, in order: the entity is a rest point of a known kind (`not-a-rest-point`), the duration is
//   one the kind offers (`duration-not-offered`), a kind that needs fire burns (`no-fire`: the fire
//   property, so any heat stimulus that lit it counts, and wet or snuffed fires refuse), and nothing
//   objects (`unsafe`, the caller's verdict: the autosave veto registry plus `restHostility`).
//   A refused rest changes nothing and does not move the clock.
// - Time passes with the game clock's `advanceTime` (so the hour, phase and schedule events of the
//   night fire, in order); a world without a game clock moves the bare day clock, as the inn does.
// - Interrupts end the rest early. An interrupt is a scheduled one (a game-clock entry with an id
//   starting `rest-interrupt.` and a `message`, e.g. a quest beat at 02:00) or one the kind's data
//   rolls once per hour of the rest on the seeded `rest` stream. The rest stops at the first, the
//   restoration is pro-rated to the time slept, and `rest.interrupted` fires once.
// - Restoration: the kind's table is a fraction of each pool's maximum for a rest of `fullRestHours`;
//   a shorter rest gives that share of it.
// - `rest.completed` fires once either way (rest-reset persistence policies and the rest autosave
//   listen to it); an interrupted rest carries the interrupt's id.
// - The rest-action registry: other systems add actions to the rest menu (arrow assembly, artifact
//   recharge). `menu` lists them in priority order while the actor is at a rest point; invoking one
//   away from a rest point fails `not-at-rest`. This module owns the hook only.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { HealthComponent } from '../combat/damage/components';
import { StaminaComponent } from '../combat/stamina';
import { gameClockOf, gameDayClock, totalMinutes } from '../gametime/clock';
import {
  restoreHealth,
  restoreStamina,
  type ItemPool,
  type PoolRestorer,
} from '../items/consumables';
import { ManaComponent, manaOf, restoreMana } from '../magic/mana';
import { readProperty } from '../properties/components';
import {
  addMinutes,
  EVENING_MINUTE,
  factDayClock,
  MORNING_MINUTE,
  minutesUntil,
  type DayClock,
  type TimeOfDay,
} from './day-clock';
import { restPointOf } from './points';
import { restCompleted } from './rest';

/** How long a rest is asked to last. */
export type RestDuration =
  | { readonly kind: 'dawn' }
  | { readonly kind: 'dusk' }
  | { readonly kind: 'hours'; readonly hours: number };

/** What can break a kind's rest off, rolled once per hour. */
export interface RestInterruptSpec {
  readonly id: string;
  readonly chancePerHour: number;
  readonly message: string;
}

/** A kind of rest point's rules (content `rest-point`). */
export interface RestKindSpec {
  readonly id: string;
  readonly name: string;
  readonly needsFire: boolean;
  readonly fullRestHours: number;
  readonly restores: Readonly<Record<ItemPool, number>>;
  readonly durations: readonly RestDuration[];
  readonly interrupts: readonly RestInterruptSpec[];
}

/** A rest was broken off. */
export interface RestInterrupted {
  readonly tick: number;
  readonly actor: EntityId;
  readonly kind: string;
  readonly point: string;
  /** Which interruption (a kind's `interrupts` id, or the scheduled entry's id). */
  readonly id: string;
  readonly message: string;
  /** Hours slept before it. */
  readonly hours: number;
  /** When it happened. */
  readonly at: TimeOfDay;
}

export const restInterrupted = defineEvent<RestInterrupted>('rest.interrupted');

/** Id prefix of game-clock entries that interrupt a rest in progress. */
export const REST_INTERRUPT_PREFIX = 'rest-interrupt.';

export type RestRefusal = 'not-a-rest-point' | 'duration-not-offered' | 'no-fire' | 'unsafe';

export type RestOutcome =
  | {
      readonly ok: true;
      /** Hours actually slept (fractional after an interruption that is not on the hour). */
      readonly hours: number;
      readonly wakes: TimeOfDay;
      /** Points each pool gained. */
      readonly restored: Readonly<Partial<Record<ItemPool, number>>>;
      /** Why the rest stopped early, absent for a full rest. */
      readonly interrupted?: { readonly id: string; readonly message: string };
    }
  | { readonly ok: false; readonly reason: RestRefusal; readonly detail: string };

/** One pool: its maximum and how to refill it. */
export interface RestPool {
  readonly max: (world: World<never>, actor: EntityId) => number;
  readonly restore: PoolRestorer;
}

const manaPoolOf = (world: World<never>, actor: EntityId) =>
  world.isRegistered(ManaComponent) ? manaOf(world, actor) : undefined;

/** Health, stamina and mana, for the actors that have them. */
export const DEFAULT_REST_POOLS: Readonly<Record<ItemPool, RestPool>> = Object.freeze({
  health: {
    max: (world, actor) =>
      world.isRegistered(HealthComponent) ? (world.get(actor, HealthComponent)?.max ?? 0) : 0,
    restore: restoreHealth,
  },
  stamina: {
    max: (world, actor) =>
      world.isRegistered(StaminaComponent)
        ? (world.get(actor, StaminaComponent)?.profile.max ?? 0)
        : 0,
    restore: restoreStamina,
  },
  mana: {
    max: (world, actor) => manaPoolOf(world, actor)?.profile.max ?? 0,
    restore: (world, actor, amount) =>
      manaPoolOf(world, actor) === undefined ? 0 : restoreMana(world, actor, amount),
  },
});

const POOLS: readonly ItemPool[] = ['health', 'stamina', 'mana'];

/** What a rest action needs to know and do. */
export interface RestActionContext {
  readonly world: World<never>;
  readonly actor: EntityId;
  /** The rest point the actor is at. */
  readonly point: EntityId;
  readonly kind: string;
}

/** An action another system adds to the rest menu. */
export interface RestAction {
  /** Unique id. */
  readonly id: string;
  readonly label: string;
  /** Menu order: lower first, ties by id. */
  readonly priority: number;
  /** Why it cannot be used right now (menu shows it greyed), or undefined. */
  readonly unavailable?: (context: RestActionContext) => string | undefined;
  /** Does it. */
  readonly perform: (context: RestActionContext) => void;
}

/** One line of the rest menu. */
export interface RestMenuAction {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  readonly reason: string;
}

export type RestActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'not-at-rest' | 'unknown-action' | 'unavailable';
      readonly detail: string;
    };

/** Settings of `RestRules`. */
export interface RestRulesOptions {
  /** Pools to restore; health, stamina and mana by default. */
  readonly pools?: Readonly<Record<ItemPool, RestPool>>;
}

/** The rest request: where, and for how long. */
export interface RestRequest {
  readonly point: EntityId;
  readonly duration: RestDuration;
}

const sameDuration = (a: RestDuration, b: RestDuration): boolean =>
  a.kind === b.kind && (a.kind !== 'hours' || a.hours === (b as { hours: number }).hours);

/** The rules of rest over the kinds of rest point. */
export class RestRules {
  readonly #kinds = new Map<string, RestKindSpec>();
  readonly #pools: Readonly<Record<ItemPool, RestPool>>;
  readonly #actions = new Map<string, RestAction>();
  readonly #at = new Map<EntityId, EntityId>();

  constructor(kinds: Iterable<RestKindSpec>, options: RestRulesOptions = {}) {
    for (const kind of kinds) this.#kinds.set(kind.id, kind);
    this.#pools = options.pools ?? DEFAULT_REST_POOLS;
  }

  /** The rules of kind `id`, or undefined. */
  kind(id: string): RestKindSpec | undefined {
    return this.#kinds.get(id);
  }

  /** The kind rules of the rest point `entity`, or undefined when it is not one. */
  kindOf(world: World<never>, entity: EntityId): RestKindSpec | undefined {
    const point = restPointOf(world, entity);
    return point === undefined ? undefined : this.#kinds.get(point.kind);
  }

  /**
   * Why a rest at `point` cannot start now (`no-fire`, `unsafe`, `not-a-rest-point`), or null: the
   * duration-independent part of the checks, for prompts that grey the verb out.
   */
  blocked(
    world: World<never>,
    point: EntityId,
    safety?: () => string | null,
  ): { readonly reason: RestRefusal; readonly detail: string } | null {
    const spec = this.kindOf(world, point);
    if (spec === undefined) return { reason: 'not-a-rest-point', detail: 'Nowhere to rest' };
    if (spec.needsFire && !readProperty(world, point, 'burning')) {
      return { reason: 'no-fire', detail: 'The fire is out' };
    }
    const unsafe = safety?.() ?? null;
    return unsafe === null ? null : { reason: 'unsafe', detail: unsafe };
  }

  /** Rests `actor` as `request` asks, or says why not (see the file header). */
  rest(
    world: World<never>,
    actor: EntityId,
    request: RestRequest,
    safety?: () => string | null,
  ): RestOutcome {
    const point = restPointOf(world, request.point);
    const spec = point === undefined ? undefined : this.#kinds.get(point.kind);
    if (point === undefined || spec === undefined) {
      return { ok: false, reason: 'not-a-rest-point', detail: 'Nowhere to rest' };
    }
    if (!spec.durations.some((offered) => sameDuration(offered, request.duration))) {
      return {
        ok: false,
        reason: 'duration-not-offered',
        detail: `${spec.name} offers no such rest`,
      };
    }
    const blocked = this.blocked(world, request.point, safety);
    if (blocked !== null) return { ok: false, ...blocked };

    const game = gameClockOf(world);
    const clock: DayClock = game === undefined ? factDayClock(world.facts) : gameDayClock(game);
    const start = clock.now();
    const planned = durationMinutes(request.duration, start);
    const stop = firstInterrupt(world, spec, start, planned);
    const minutes = stop === undefined ? planned : stop.after;
    clock.set(addMinutes(start, minutes));
    const wakes = clock.now();

    const share = Math.min(1, minutes / (spec.fullRestHours * 60));
    const restored: Partial<Record<ItemPool, number>> = {};
    for (const pool of POOLS) {
      const { max, restore } = this.#pools[pool];
      restored[pool] = restore(world, actor, max(world, actor) * spec.restores[pool] * share);
    }
    const hours = Math.round((minutes / 60) * 100) / 100;
    world.events.emit(restCompleted, {
      tick: world.tick,
      actor,
      kind: spec.id,
      hours,
      point: point.id,
      wakes,
      ...(stop !== undefined && { interrupted: stop.id }),
    });
    if (stop !== undefined) {
      world.events.emit(restInterrupted, {
        tick: world.tick,
        actor,
        kind: spec.id,
        point: point.id,
        id: stop.id,
        message: stop.message,
        hours,
        at: wakes,
      });
    }
    return {
      ok: true,
      hours,
      wakes,
      restored,
      ...(stop !== undefined && { interrupted: { id: stop.id, message: stop.message } }),
    };
  }

  // The rest menu hook.

  /** Adds an action to the rest menu. Returns a function that removes it. */
  registerAction(action: RestAction): () => void {
    if (action.id === '') throw new RangeError('a rest action needs an id');
    if (this.#actions.has(action.id)) {
      throw new RangeError(`rest action "${action.id}" is already registered`);
    }
    this.#actions.set(action.id, action);
    return () => {
      if (this.#actions.get(action.id) === action) this.#actions.delete(action.id);
    };
  }

  /** `actor` arrives at rest point `point` (opens the rest menu). Returns the menu. */
  enter(world: World<never>, actor: EntityId, point: EntityId): readonly RestMenuAction[] {
    this.#at.set(actor, point);
    return this.menu(world, actor);
  }

  /** `actor` leaves the rest point. */
  leave(actor: EntityId): void {
    this.#at.delete(actor);
  }

  /** The rest point `actor` is at, or undefined. */
  at(actor: EntityId): EntityId | undefined {
    return this.#at.get(actor);
  }

  /** The registered actions in priority order (empty away from a rest point). */
  menu(world: World<never>, actor: EntityId): readonly RestMenuAction[] {
    const context = this.#context(world, actor);
    if (context === undefined) return [];
    return [...this.#actions.values()]
      .sort((a, b) => a.priority - b.priority || Number(a.id > b.id) - Number(a.id < b.id))
      .map((action) => {
        const reason = action.unavailable?.(context) ?? '';
        return { id: action.id, label: action.label, available: reason === '', reason };
      });
  }

  /** Does action `id` for `actor`; fails `not-at-rest` away from a rest point. */
  invoke(world: World<never>, actor: EntityId, id: string): RestActionResult {
    const context = this.#context(world, actor);
    if (context === undefined) {
      return { ok: false, reason: 'not-at-rest', detail: 'Only at a rest point' };
    }
    const action = this.#actions.get(id);
    if (action === undefined) {
      return { ok: false, reason: 'unknown-action', detail: `No rest action "${id}"` };
    }
    const reason = action.unavailable?.(context);
    if (reason !== undefined) return { ok: false, reason: 'unavailable', detail: reason };
    action.perform(context);
    return { ok: true };
  }

  #context(world: World<never>, actor: EntityId): RestActionContext | undefined {
    const point = this.#at.get(actor);
    const kind = point === undefined ? undefined : restPointOf(world, point)?.kind;
    return point === undefined || kind === undefined ? undefined : { world, actor, point, kind };
  }
}

/** Minutes a rest of `duration` lasts from `now` (at least 1). */
export function durationMinutes(duration: RestDuration, now: TimeOfDay): number {
  if (duration.kind === 'hours') return duration.hours * 60;
  return minutesUntil(now, duration.kind === 'dawn' ? MORNING_MINUTE : EVENING_MINUTE);
}

interface Interrupt {
  readonly id: string;
  readonly message: string;
  /** Minutes into the rest. */
  readonly after: number;
}

/** The first interruption inside a rest of `planned` minutes from `start`, if any. */
function firstInterrupt(
  world: World<never>,
  spec: RestKindSpec,
  start: TimeOfDay,
  planned: number,
): Interrupt | undefined {
  let first: Interrupt | undefined;
  const game = gameClockOf(world);
  if (game !== undefined) {
    const from = totalMinutes(start);
    for (const entry of game.schedule.pending()) {
      const after = entry.at - from;
      if (!entry.id.startsWith(REST_INTERRUPT_PREFIX) || after < 1 || after >= planned) continue;
      first = { id: entry.id, message: String(entry.payload['message'] ?? ''), after };
      break;
    }
  }
  if (spec.interrupts.length === 0) return first;
  const rng = world.random('rest');
  for (let hour = 1; hour * 60 < planned; hour++) {
    if (first !== undefined && first.after <= hour * 60) break;
    for (const interrupt of spec.interrupts) {
      if (rng.float() < interrupt.chancePerHour) {
        return { id: interrupt.id, message: interrupt.message, after: hour * 60 };
      }
    }
  }
  return first;
}
