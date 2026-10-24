// The deterministic in-game clock (mw-e27.12; design: docs/design/game-clock.md). One clock for
// restocks, deadlines, NPC schedules, study time and night-only secrets, so they all agree on the
// time and a save restores it.
//
// State is world facts (`time.day`, `time.minute`, `time.minute-ticks`, `time.phase`), so it is part
// of every snapshot, state hash and world-facts save with no section of its own; only the pending
// schedule is saved separately (src/game/save/game-clock.ts). Game time advances in exactly two ways:
// the `game-clock` system counts sim ticks (`ticksPerMinute` of them make a game minute; it never
// reads a wall clock), and `advanceTime(minutes, reason)` jumps (rest, study, jail, travel). A world
// whose sim does not step has a clock that does not move, which is how pausing menus hold it;
// screens that leave the sim running hold the clock with `hold` (a data flag per screen).
//
// An advance finds every boundary it crosses in game-time order (day starts, then phase changes,
// then hours, then scheduled events by priority and id), writes the new time, and then delivers them:
// as `time.*` events on the world bus, and to clock subscribers, who choose `each` (a callback per
// crossing, in order) or `latest` (one callback with the last crossing, the count and the minutes
// advanced; for lazy consumers such as shop restock).

import { defineEvent, type EventType } from '../core/events';
import type { System, World } from '../core/world';
import {
  DAY_FACT,
  MINUTE_FACT,
  MINUTES_PER_DAY,
  HELD_AT_FACT,
  MINUTE_ORIGIN_FACT,
  PHASE_FACT,
  type DayClock,
  type TimeOfDay,
} from '../rest/day-clock';
import { clockConfigProblems, dayPhaseAt, type GameClockConfig } from './config';

/** Flat, JSON-safe data a scheduled event carries. */
export type SchedulePayload = Readonly<Record<string, string | number | boolean>>;

/** An hour began (every whole game hour; `hour` is 0-23). */
export interface HourChanged {
  readonly at: number;
  readonly day: number;
  readonly hour: number;
}
/** The phase of the day changed. */
export interface PhaseChanged {
  readonly at: number;
  readonly day: number;
  readonly from: string;
  readonly to: string;
}
/** A new day began (midnight). */
export interface DayStarted {
  readonly at: number;
  readonly day: number;
}
/** A scheduled event came due. */
export interface Scheduled {
  readonly id: string;
  /** The game minute it was due. */
  readonly at: number;
  readonly payload: SchedulePayload;
}

export const hourChanged = defineEvent<HourChanged>('time.hourChanged');
export const phaseChanged = defineEvent<PhaseChanged>('time.phaseChanged');
export const dayStarted = defineEvent<DayStarted>('time.dayStarted');
export const scheduledEvent = defineEvent<Scheduled>('time.scheduled');

/** A scheduled event waiting for its time. */
export interface ScheduledEntry {
  readonly id: string;
  /** Absolute game minute (minutes since day 1, 00:00) it is next due. */
  readonly at: number;
  /** Lower fires first among events due the same minute. */
  readonly priority: number;
  /** Minutes between occurrences, for a repeating event. */
  readonly period?: number;
  readonly payload: SchedulePayload;
}

export type ScheduleResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'duplicate-id' | 'invalid-id' | 'invalid-time' | 'invalid-period';
    };

export type AdvanceResult =
  | { readonly ok: true; readonly from: number; readonly to: number; readonly minutes: number }
  | { readonly ok: false; readonly reason: 'invalid-duration' };

/** What a subscriber can listen to. */
export interface ClockTopics {
  readonly hourChanged: HourChanged;
  readonly phaseChanged: PhaseChanged;
  readonly dayStarted: DayStarted;
  readonly scheduled: Scheduled;
}
export type ClockTopic = keyof ClockTopics;

/** How a subscriber wants to hear about the crossings of one advance. */
export type DeliveryMode = 'each' | 'latest';

/** Context of a delivery. */
export interface DeliveryInfo {
  /** Crossings this delivery stands for: 1 for `each`, all of them for `latest`. */
  readonly count: number;
  /** Game minutes the whole advance moved. */
  readonly elapsed: number;
  /** Why time moved: `tick` for the running clock, else the `advanceTime` reason. */
  readonly reason: string;
}

export interface SubscribeOptions {
  readonly mode?: DeliveryMode;
  /** For the `scheduled` topic: only events with this id. */
  readonly id?: string;
}

interface Subscription {
  readonly topic: ClockTopic;
  readonly mode: DeliveryMode;
  readonly id: string | undefined;
  readonly handler: (event: never, info: DeliveryInfo) => void;
}

interface Crossing {
  readonly at: number;
  /** Order within one minute: day start, phase change, hour, scheduled. */
  readonly rank: number;
  readonly priority: number;
  readonly key: string;
  readonly topic: ClockTopic;
  readonly event: ClockTopics[ClockTopic];
}

const ID = /^[a-z0-9]+(?:[-.:][a-z0-9]+)*$/;

/** Absolute game minutes (since day 1, 00:00) of a day and minute. */
export function totalMinutes(time: TimeOfDay): number {
  return (time.day - 1) * MINUTES_PER_DAY + time.minute;
}

/** The day and minute of absolute game minute `total`. */
export function timeOf(total: number): TimeOfDay {
  return { day: Math.floor(total / MINUTES_PER_DAY) + 1, minute: total % MINUTES_PER_DAY };
}

const byOrder = (a: Crossing, b: Crossing): number =>
  a.at - b.at ||
  a.rank - b.rank ||
  a.priority - b.priority ||
  Number(a.key > b.key) - Number(a.key < b.key);

/** The pending schedule of a clock. */
export class ClockSchedule {
  private readonly entries = new Map<string, ScheduledEntry>();

  constructor(private readonly nowTotal: () => number) {}

  /** Schedules `id` once at absolute game minute `at` (must be in the future). */
  at(at: number, id: string, payload: SchedulePayload = {}, priority = 0): ScheduleResult {
    if (!ID.test(id)) return { ok: false, reason: 'invalid-id' };
    if (this.entries.has(id)) return { ok: false, reason: 'duplicate-id' };
    if (!Number.isSafeInteger(at) || at <= this.nowTotal() || !Number.isSafeInteger(priority)) {
      return { ok: false, reason: 'invalid-time' };
    }
    this.entries.set(id, { id, at, priority, payload });
    return { ok: true };
  }

  /** Schedules `id` every `period` game minutes, first due one period from now. */
  every(period: number, id: string, payload: SchedulePayload = {}, priority = 0): ScheduleResult {
    if (!Number.isSafeInteger(period) || period < 1) return { ok: false, reason: 'invalid-period' };
    const result = this.at(this.nowTotal() + period, id, payload, priority);
    if (result.ok)
      this.entries.set(id, { id, at: this.nowTotal() + period, priority, period, payload });
    return result;
  }

  /** Removes `id`; false when it was not scheduled. */
  cancel(id: string): boolean {
    return this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Pending entries in firing order: (time, priority, id). */
  pending(): ScheduledEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.at - b.at || a.priority - b.priority || Number(a.id > b.id) - Number(a.id < b.id),
    );
  }

  /** Replaces the schedule with `entries` (a load). */
  restore(entries: readonly ScheduledEntry[]): void {
    this.entries.clear();
    for (const entry of entries) this.entries.set(entry.id, entry);
  }

  /** Takes every occurrence due by `to`, advancing repeating entries past it. */
  collect(to: number): Crossing[] {
    const due: Crossing[] = [];
    for (const entry of [...this.entries.values()]) {
      if (entry.at > to) continue;
      let at = entry.at;
      for (;;) {
        due.push({
          at,
          rank: 3,
          priority: entry.priority,
          key: entry.id,
          topic: 'scheduled',
          event: { id: entry.id, at, payload: entry.payload },
        });
        if (entry.period === undefined) {
          this.entries.delete(entry.id);
          break;
        }
        at += entry.period;
        if (at > to) {
          this.entries.set(entry.id, { ...entry, at });
          break;
        }
      }
    }
    return due;
  }
}

export class GameClock {
  readonly schedule: ClockSchedule;
  readonly ticksPerMinute: number;
  private readonly held = new Map<string, number>();
  private subscriptions: Subscription[] = [];

  constructor(
    private readonly world: World<never>,
    readonly config: GameClockConfig,
  ) {
    const problems = clockConfigProblems(config, world.clock.hz);
    if (problems.length > 0) throw new RangeError(`bad clock config: ${problems.join('; ')}`);
    this.ticksPerMinute = (world.clock.hz * config.dayLengthRealMinutes * 60) / MINUTES_PER_DAY; // whole: checked above
    this.schedule = new ClockSchedule(() => this.total());
    this.syncPhase();
  }

  /** The day and minute of the day. */
  time(): TimeOfDay {
    const { facts } = this.world;
    const { start } = this.config;
    return {
      day: Number(facts.get(DAY_FACT) ?? start.day),
      minute: Number(facts.get(MINUTE_FACT) ?? start.minute),
    };
  }

  /** Game minutes since day 1, 00:00. */
  total(): number {
    return totalMinutes(this.time());
  }

  /** Minute of the day, 0-1439. */
  timeOfDay(): number {
    return this.time().minute;
  }

  /** The id of the current phase of the day. */
  phase(): string {
    return dayPhaseAt(this.config.phases, this.time().minute);
  }

  /** Game minutes since absolute game minute `total`. */
  elapsedSince(total: number): number {
    return this.total() - total;
  }

  /** True while a screen that holds the clock is open. */
  get paused(): boolean {
    return this.held.size > 0;
  }

  /** A screen opened; it holds the clock when the data says so. Pair with `release`. */
  hold(screen: string): void {
    if (this.config.pauseScreens[screen] !== true) return;
    if (!this.paused) this.world.facts.set(HELD_AT_FACT, this.world.tick);
    this.held.set(screen, (this.held.get(screen) ?? 0) + 1);
  }

  /** A screen closed. */
  release(screen: string): void {
    const count = this.held.get(screen);
    if (count === undefined) return;
    if (count <= 1) this.held.delete(screen);
    else this.held.set(screen, count - 1);
    if (!this.paused) this.settleHold();
  }

  /**
   * Listens to a topic. Returns the unsubscribe function. Handlers run when an advance delivers its
   * crossings, in subscription order.
   */
  subscribe<T extends ClockTopic>(
    topic: T,
    handler: (event: ClockTopics[T], info: DeliveryInfo) => void,
    options: SubscribeOptions = {},
  ): () => void {
    const subscription: Subscription = {
      topic,
      mode: options.mode ?? 'each',
      id: options.id,
      handler: handler,
    };
    this.subscriptions = [...this.subscriptions, subscription];
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== subscription);
    };
  }

  /**
   * Jumps time forward by `minutes` game minutes (rest, study, jail, travel): the only way time
   * jumps. Rejects a zero, negative, fractional or non-finite duration with `invalid-duration`,
   * firing nothing.
   */
  advanceTime(minutes: number, reason: string): AdvanceResult {
    if (!Number.isSafeInteger(minutes) || minutes < 1) {
      return { ok: false, reason: 'invalid-duration' };
    }
    return this.move(minutes, reason);
  }

  /**
   * Debug: puts the clock at `time`. Forward is an ordinary advance (so events fire); backward
   * rewrites the time without firing anything and leaves the schedule as it was.
   */
  setTime(time: TimeOfDay, reason = 'debug'): void {
    const delta = totalMinutes(time) - this.total();
    if (delta > 0) this.move(delta, reason);
    else if (delta < 0) this.write(totalMinutes(time));
    this.world.facts.set(MINUTE_ORIGIN_FACT, this.world.tick);
    this.world.facts.set(HELD_AT_FACT, this.paused ? this.world.tick : -1);
  }

  /** One sim tick (the `game-clock` system's job). */
  tick(): void {
    if (this.paused) return;
    this.settleHold(); // a held clock restored from a save has no screen open any more
    const now = this.world.tick;
    const origin = Number(this.world.facts.get(MINUTE_ORIGIN_FACT) ?? 0);
    if (now - origin + 1 < this.ticksPerMinute) return;
    this.world.facts.set(MINUTE_ORIGIN_FACT, now + 1);
    this.move(1, 'tick');
  }

  /** Takes the ticks spent held out of the minute being counted. */
  private settleHold(): void {
    const { facts } = this.world;
    const heldAt = Number(facts.get(HELD_AT_FACT) ?? -1);
    if (heldAt < 0) return;
    const origin = Number(facts.get(MINUTE_ORIGIN_FACT) ?? 0);
    facts.set(MINUTE_ORIGIN_FACT, origin + this.world.tick - heldAt);
    facts.set(HELD_AT_FACT, -1);
  }

  private write(total: number): void {
    const { day, minute } = timeOf(total);
    this.world.facts.set(DAY_FACT, day);
    this.world.facts.set(MINUTE_FACT, minute);
    this.syncPhase();
  }

  private syncPhase(): void {
    const phase = this.phase();
    if (this.world.facts.get(PHASE_FACT) !== phase) this.world.facts.set(PHASE_FACT, phase);
  }

  private crossings(from: number, to: number): Crossing[] {
    const found: Crossing[] = [];
    for (let at = (Math.floor(from / 60) + 1) * 60; at <= to; at += 60) {
      const { day, minute } = timeOf(at);
      if (minute === 0) {
        found.push({ at, rank: 0, priority: 0, key: '', topic: 'dayStarted', event: { at, day } });
      }
      const hour = minute / 60;
      found.push({
        at,
        rank: 2,
        priority: 0,
        key: '',
        topic: 'hourChanged',
        event: { at, day, hour },
      });
    }
    const { phases } = this.config;
    for (
      let base = Math.floor(from / MINUTES_PER_DAY) * MINUTES_PER_DAY;
      base <= to;
      base += MINUTES_PER_DAY
    ) {
      for (const phase of phases) {
        const at = base + phase.startMinute;
        if (at <= from || at > to) continue;
        const before = dayPhaseAt(phases, timeOf(at - 1).minute);
        if (before === phase.id) continue;
        const { day } = timeOf(at);
        found.push({
          at,
          rank: 1,
          priority: 0,
          key: phase.id,
          topic: 'phaseChanged',
          event: { at, day, from: before, to: phase.id },
        });
      }
    }
    return found;
  }

  private move(minutes: number, reason: string): AdvanceResult {
    const from = this.total();
    const to = from + minutes;
    const due = [...this.crossings(from, to), ...this.schedule.collect(to)].sort(byOrder);
    this.write(to);
    this.deliver(due, minutes, reason);
    return { ok: true, from, to, minutes };
  }

  private deliver(due: readonly Crossing[], elapsed: number, reason: string): void {
    const latest = new Map<Subscription, { event: ClockTopics[ClockTopic]; count: number }>();
    const subscribers = this.subscriptions;
    for (const crossing of due) {
      this.world.events.emit(BUS[crossing.topic] as EventType<unknown>, crossing.event);
      for (const subscription of subscribers) {
        if (subscription.topic !== crossing.topic) continue;
        if (subscription.id !== undefined && subscription.id !== crossing.key) continue;
        if (subscription.mode === 'each') {
          subscription.handler(crossing.event as never, { count: 1, elapsed, reason });
        } else {
          const seen = latest.get(subscription);
          latest.set(subscription, { event: crossing.event, count: (seen?.count ?? 0) + 1 });
        }
      }
    }
    for (const subscription of subscribers) {
      const seen = latest.get(subscription);
      if (seen !== undefined) {
        subscription.handler(seen.event as never, { count: seen.count, elapsed, reason });
      }
    }
  }
}

const BUS = {
  hourChanged,
  phaseChanged,
  dayStarted,
  scheduled: scheduledEvent,
} as const;

const clocks = new WeakMap<object, GameClock>();

/** The game clock installed on `world`, if any. */
export function gameClockOf(world: World<never>): GameClock | undefined {
  return clocks.get(world);
}

/** The `game-clock` system: counts one sim tick. */
export function gameClockSystem<TInput>(clock: GameClock): System<TInput> {
  return {
    name: 'game-clock',
    run: () => {
      clock.tick();
    },
  };
}

/**
 * Installs the game clock on `world`: creates it and adds the `game-clock` system, which should be
 * the first system added so every later system sees this tick's time. Once per world, at setup.
 * @throws RangeError for a config that is unusable at the world's tick rate, or a second install.
 */
export function installGameClock<TInput>(world: World<TInput>, config: GameClockConfig): GameClock {
  const sim = world as unknown as World<never>;
  if (clocks.has(sim)) throw new RangeError('the game clock is already installed on this world');
  const clock = new GameClock(sim, config);
  clocks.set(sim, clock);
  world.addSystem(gameClockSystem<TInput>(clock));
  return clock;
}

/** The world's day clock for rest: the game clock when installed, else the bare facts clock. */
export function gameDayClock(clock: GameClock): DayClock {
  return {
    now: () => clock.time(),
    set: (time) => {
      const delta = totalMinutes(time) - clock.total();
      if (delta > 0) clock.advanceTime(delta, 'rest');
    },
  };
}
