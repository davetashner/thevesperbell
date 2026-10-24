// The game clock's configuration (mw-e27.12): how fast game time runs, when a new world starts, the
// day's phases and which screens hold the clock. It is data (the `clock` block of
// src/content/data/game/game.json, docs/design/game-clock.md); this file is the sim-side shape and
// the checks that make a config safe to run: game time must be derived from whole sim ticks, so the
// day length and tick rate have to divide into a whole number of ticks per game minute.

import { MINUTES_PER_DAY, type TimeOfDay } from '../rest/day-clock';

/** One phase of the day: it begins at `startMinute` and lasts until the next phase begins. */
export interface PhaseSpec {
  readonly id: string;
  /** Minute of the day it begins, 0-1439. */
  readonly startMinute: number;
}

/** The clock's data. */
export interface GameClockConfig {
  /** Real minutes (of sim time) in one game day; 60 by default. */
  readonly dayLengthRealMinutes: number;
  /** Where a new world starts. */
  readonly start: TimeOfDay;
  /** The day's phases, ascending by `startMinute`; the last one wraps past midnight. */
  readonly phases: readonly PhaseSpec[];
  /** Screen id → whether it holds the clock while open (see `GameClock.hold`). */
  readonly pauseScreens: Readonly<Record<string, boolean>>;
}

/**
 * The default clock: a 60-minute day starting at 06:00 on day 1; dawn 05:00, day 08:00, dusk 18:00,
 * night 21:00. Dialogue, shop and inventory screens hold the clock, the map does not.
 */
export const DEFAULT_CLOCK_CONFIG: GameClockConfig = Object.freeze({
  dayLengthRealMinutes: 60,
  start: Object.freeze({ day: 1, minute: 6 * 60 }),
  phases: Object.freeze([
    Object.freeze({ id: 'dawn', startMinute: 5 * 60 }),
    Object.freeze({ id: 'day', startMinute: 8 * 60 }),
    Object.freeze({ id: 'dusk', startMinute: 18 * 60 }),
    Object.freeze({ id: 'night', startMinute: 21 * 60 }),
  ]),
  pauseScreens: Object.freeze({ dialogue: true, shop: true, inventory: true, map: false }),
});

/** Sim ticks in one game minute, or undefined when the day length does not divide into whole ticks. */
export function ticksPerMinute(config: GameClockConfig, hz: number): number | undefined {
  const ticks = (hz * config.dayLengthRealMinutes * 60) / MINUTES_PER_DAY;
  return Number.isInteger(ticks) && ticks >= 1 ? ticks : undefined;
}

/**
 * Problems that make `config` unusable at `hz`, as messages (empty when it is fine): a day length
 * that is not whole ticks per game minute, a start outside the day, phases that are empty, repeated,
 * out of order or outside the day.
 */
export function clockConfigProblems(config: GameClockConfig, hz: number): string[] {
  const problems: string[] = [];
  if (!(config.dayLengthRealMinutes > 0) || ticksPerMinute(config, hz) === undefined) {
    problems.push(
      `a ${String(config.dayLengthRealMinutes)}-minute day at ${String(hz)} Hz is not a whole number of ticks per game minute`,
    );
  }
  const { day, minute } = config.start;
  if (!Number.isInteger(day) || day < 1)
    problems.push(`start day must be 1 or more, got ${String(day)}`);
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    problems.push(`start minute must be 0-1439, got ${String(minute)}`);
  }
  if (config.phases.length === 0) problems.push('there must be at least one phase');
  const ids = new Set<string>();
  let previous = -1;
  for (const phase of config.phases) {
    if (ids.has(phase.id)) problems.push(`phase "${phase.id}" is listed twice`);
    ids.add(phase.id);
    if (
      !Number.isInteger(phase.startMinute) ||
      phase.startMinute < 0 ||
      phase.startMinute >= MINUTES_PER_DAY
    ) {
      problems.push(`phase "${phase.id}" starts outside the day (${String(phase.startMinute)})`);
    } else if (phase.startMinute <= previous) {
      problems.push(`phase "${phase.id}" does not start after the phase before it`);
    }
    previous = phase.startMinute;
  }
  return problems;
}

/** The phase that is active at `minute` of the day. */
export function dayPhaseAt(phases: readonly PhaseSpec[], minute: number): string {
  // Before the first start, the last phase is still running (it wraps past midnight).
  const last = phases.reduce((_, phase) => phase);
  return phases.reduce((active, phase) => (phase.startMinute <= minute ? phase : active), last).id;
}
