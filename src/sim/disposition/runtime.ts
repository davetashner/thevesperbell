// Per-creature disposition toward the player (mw-e12.9). One component, `disposition.value`, on each
// creature whose attitude has been touched (a snapshot, state-hash and save key, never renamed). It
// is registered on first use (`ON_DEMAND_COMPONENTS` in src/game/save/sections.ts), so a world that
// never changes anyone's disposition hashes as before. A creature without the component reads as its
// baseline: the definition's, else the middle of its faction stance toward the player.
//
// The record is { score, baseline, decayPerMinute, at }. Decay is lazy: nothing runs each tick.
// Reading computes the score as of "now" (game minutes, so rest and `advanceTime` decay it too);
// writing stores that settled score at `at = now` before adding the change. Reads never write, so a
// quiet world's hash does not move however long it runs. The score drifts toward `baseline` by
// `decayPerMinute` and never overshoots.
//
// Changes come from three places, all through `adjust`: modifier rules (content type
// `disposition-rule`: an event type id → a delta) fired by a `DispositionTrigger` event or by the
// built-in `attacked` rule on the player's hits; direct calls (a dialogue effect, a gift); and the
// logic DSL adapter below. Every change emits `DispositionChanged`; one that crosses a stance
// threshold also emits `DispositionStanceChanged`.
//
// Extension points for mw-e22.4: `adjust` is the single write path (add faction propagation,
// witness scaling and `disposition.bandChanged` by listening to `DispositionChanged`, or by wrapping
// `adjust`); `DispositionConfig.defaultsOf` lets class affinity set a baseline; new event kinds are
// rule files plus `trigger`; `dispositionLogicHost` is the adapter the logic DSL's `disposition`
// condition and effect call.

import type { GameEntry } from '@content/index';
import { DamageApplied } from '../combat/damage/events';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { factionOf, stanceTowardPlayer } from '../factions/runtime';
import { PLAYER_FACTION, type FactionTable } from '../factions/table';
import { gameClockOf } from '../gametime/clock';
import { clampDisposition, dispositionStance, STANCE_SEED, type DispositionStance } from './bands';

/** Rule id of the one built-in source: the player hit a creature (mirrors content `ATTACKED_EVENT`). */
export const ATTACKED = 'attacked';

/** What the world stores for one creature. */
export interface DispositionRecord {
  /** Disposition as of game minute `at` (before decay since). */
  readonly score: number;
  /** What it drifts back toward. */
  readonly baseline: number;
  /** Points per game minute it drifts toward `baseline`; 0 = never. */
  readonly decayPerMinute: number;
  /** Absolute game minute `score` was settled. */
  readonly at: number;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function restoreRecord(data: unknown): DispositionRecord {
  const r = data as Partial<Record<keyof DispositionRecord, unknown>> | null;
  if (
    !isNumber(r?.score) ||
    !isNumber(r.baseline) ||
    !isNumber(r.decayPerMinute) ||
    !isNumber(r.at) ||
    r.decayPerMinute < 0 ||
    r.score !== clampDisposition(r.score) ||
    r.baseline !== clampDisposition(r.baseline)
  ) {
    throw new RangeError(
      'disposition must be { score, baseline (-100..100), decayPerMinute (>= 0), at }',
    );
  }
  return Object.freeze({
    score: r.score,
    baseline: r.baseline,
    decayPerMinute: r.decayPerMinute,
    at: r.at,
  });
}

/** Per-creature disposition (`disposition.value`; a snapshot and save key, never renamed). */
export const DispositionComponent = defineComponent<DispositionRecord>('disposition.value', {
  deserialize: restoreRecord,
});

/** Payload of DispositionChanged. */
export interface DispositionChange {
  readonly tick: number;
  readonly entity: EntityId;
  /** Score before and after (decay since the last change is folded into `before`). */
  readonly before: number;
  readonly after: number;
  /** The change asked for, before the clamp; `after - before` may be smaller. */
  readonly delta: number;
  /** Why: a rule's event type (`fed`), or the caller's reason (`dialogue:miller-greeting`). */
  readonly cause: string;
  readonly stanceBefore: DispositionStance;
  readonly stanceAfter: DispositionStance;
}

/** A creature's disposition toward the player changed (UI, dialogue, AI and quests can react). */
export const DispositionChanged = defineEvent<DispositionChange>('DispositionChanged');

/** A change moved a creature across a stance threshold (same payload as DispositionChanged). */
export const DispositionStanceChanged = defineEvent<DispositionChange>('DispositionStanceChanged');

/** Payload of DispositionTrigger. */
export interface DispositionTriggerEvent {
  /** Event type, matching a `disposition-rule` id (`fed`, `witnessed-theft`, `helped-ally`). */
  readonly type: string;
  /** Whose disposition toward the player it moves. */
  readonly target: EntityId;
}

/**
 * Anything that happened to or in front of a creature that rules may answer. Emit it from any
 * system; a type with no rule is ignored, so emitters need not know the rules.
 */
export const DispositionTrigger = defineEvent<DispositionTriggerEvent>('DispositionTrigger');

/** Modifier rules by event type → delta. */
export type DispositionRules = ReadonlyMap<string, number>;

/** The rules of the loaded `disposition-rule` content entries. */
export function compileDispositionRules(
  entries: readonly Pick<GameEntry<'disposition-rule'>, 'id' | 'delta'>[],
): DispositionRules {
  return new Map(entries.map(({ id, delta }) => [id, delta]));
}

/** Per-creature overrides of the seed (from its definition; class affinity in mw-e22.4). */
export interface DispositionDefaults {
  readonly baseline?: number;
  readonly decayPerMinute?: number;
}

/** What the disposition system needs. */
export interface DispositionConfig {
  readonly factions: FactionTable;
  readonly rules: DispositionRules;
  /** Absolute game minute now; default: the world's game clock, else 0. */
  readonly now?: (world: World<never>) => number;
  /** A creature's baseline and decay when it has no record yet (e.g. from its definition). */
  readonly defaultsOf?: (world: World<never>, entity: EntityId) => DispositionDefaults | undefined;
}

/** Game minutes on the world's clock; 0 in a world without one. */
export function gameMinutesNow(world: World<never>): number {
  return gameClockOf(world)?.total() ?? 0;
}

/** `record`'s score at game minute `now`: drifted toward its baseline, never past it. */
export function decayedScore(record: DispositionRecord, now: number): number {
  const drift = record.decayPerMinute * Math.max(0, now - record.at);
  if (drift === 0 || record.score === record.baseline) return record.score;
  return record.score > record.baseline
    ? Math.max(record.baseline, record.score - drift)
    : Math.min(record.baseline, record.score + drift);
}

/** Disposition of creatures toward the player in one world. */
export class Dispositions {
  readonly #world: World<never>;
  readonly #config: DispositionConfig;

  constructor(world: World<never>, config: DispositionConfig) {
    this.#world = world;
    this.#config = config;
  }

  #now(): number {
    return (this.#config.now ?? gameMinutesNow)(this.#world);
  }

  /** The record `entity` would have if nothing had happened to it yet. */
  #seed(entity: EntityId, now: number): DispositionRecord {
    const defaults = this.#config.defaultsOf?.(this.#world, entity);
    const stance = stanceTowardPlayer(this.#world, this.#config.factions, entity) ?? 'neutral';
    const baseline = clampDisposition(defaults?.baseline ?? STANCE_SEED[stance]);
    return { score: baseline, baseline, decayPerMinute: defaults?.decayPerMinute ?? 0, at: now };
  }

  #record(entity: EntityId, now: number): DispositionRecord {
    const stored = this.#world.isRegistered(DispositionComponent)
      ? this.#world.get(entity, DispositionComponent)
      : undefined;
    return stored ?? this.#seed(entity, now);
  }

  /** `entity`'s disposition toward the player now, -100..100 (its baseline if never touched). */
  get(entity: EntityId): number {
    const now = this.#now();
    return decayedScore(this.#record(entity, now), now);
  }

  /** `entity`'s stance toward the player now. */
  stance(entity: EntityId): DispositionStance {
    return dispositionStance(this.get(entity));
  }

  /**
   * Changes `entity`'s disposition by `delta`, clamped to -100..100, and emits DispositionChanged
   * (and DispositionStanceChanged on a threshold crossing). A change that moves nothing (a zero
   * delta, or already at the limit) emits nothing and stores nothing. Returns the new score.
   */
  adjust(entity: EntityId, delta: number, cause: string): number {
    if (!Number.isFinite(delta))
      throw new RangeError('a disposition change must be a finite number');
    const now = this.#now();
    const record = this.#record(entity, now);
    const before = decayedScore(record, now);
    const after = clampDisposition(before + delta);
    if (after === before) return after;
    const next: DispositionRecord = Object.freeze({ ...record, score: after, at: now });
    if (
      this.#world.isRegistered(DispositionComponent) &&
      this.#world.has(entity, DispositionComponent)
    ) {
      this.#world.set(entity, DispositionComponent, next);
    } else {
      if (!this.#world.isRegistered(DispositionComponent))
        this.#world.register(DispositionComponent);
      this.#world.add(entity, DispositionComponent, next);
    }
    const stanceBefore = dispositionStance(before);
    const stanceAfter = dispositionStance(after);
    const change: DispositionChange = {
      tick: this.#world.tick,
      entity,
      before,
      after,
      delta,
      cause,
      stanceBefore,
      stanceAfter,
    };
    this.#world.events.emit(DispositionChanged, change);
    if (stanceBefore !== stanceAfter) this.#world.events.emit(DispositionStanceChanged, change);
    return after;
  }

  /**
   * Applies the rule for event type `type` to `entity`; no rule, no change. Returns whether a rule
   * applied (not whether the score moved).
   */
  trigger(entity: EntityId, type: string): boolean {
    const delta = this.#config.rules.get(type);
    if (delta === undefined) return false;
    this.adjust(entity, delta, type);
    return true;
  }

  /**
   * Listens on the world's bus: `DispositionTrigger` events run their rules, and a hit by the
   * player on a creature runs the `attacked` rule. Call once per world, at setup. Returns the
   * unsubscribe function.
   */
  listen(): () => void {
    const { events } = this.#world;
    const offTrigger = events.on(DispositionTrigger, ({ type, target }) => {
      this.trigger(target, type);
    });
    const offHit = events.on(DamageApplied, ({ target, packet }) => {
      const attacker = packet.instigator;
      if (attacker === null || attacker === target) return;
      if (factionOf(this.#world, attacker) !== PLAYER_FACTION) return;
      if (factionOf(this.#world, target) === undefined) return;
      this.trigger(target, ATTACKED);
    });
    return () => {
      offTrigger();
      offHit();
    };
  }
}

/**
 * The parts of the logic DSL's host (src/sim/logic) that disposition backs. NPCs are named by string
 * in dialogue and quests; `resolve` maps that name to the creature entity (the game's NPC registry,
 * mw-e22.4/e22.5). An unknown name reads 0 and refuses changes with `unknown-npc:<name>`, as the DSL
 * documents. Spread it into the game's host: `{ ...base, ...dispositionLogicHost(d, resolve) }`.
 */
export function dispositionLogicHost(
  dispositions: Dispositions,
  resolve: (npc: string) => EntityId | undefined,
): {
  disposition(npc: string): number;
  adjustDisposition(npc: string, delta: number): string | undefined;
} {
  return {
    disposition(npc) {
      const entity = resolve(npc);
      return entity === undefined ? 0 : dispositions.get(entity);
    },
    adjustDisposition(npc, delta) {
      const entity = resolve(npc);
      if (entity === undefined) return `unknown-npc:${npc}`;
      dispositions.adjust(entity, delta, `logic:${npc}`);
      return undefined;
    },
  };
}
