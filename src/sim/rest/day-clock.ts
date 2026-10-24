// The world day clock's facts and time arithmetic (mw-ju8.6). The day and the minute of the day are
// world facts (`time.day`, `time.minute`; declared in src/content/data/fact/time.json), which makes
// them deterministic, snapshot-hashed and saved with the world-facts section. The writer is the game
// clock (../gametime, mw-e27.12), which advances them with sim ticks and `advanceTime`; a world
// without it keeps this bare facts clock, which only `rest` moves.

import type { FactSpec, FactStore } from '../facts/store';

/** Minutes in a day. */
export const MINUTES_PER_DAY = 24 * 60;
/** The minute of the day a rested player wakes: 06:00. */
export const MORNING_MINUTE = 6 * 60;
/** The minute of the day a new world starts: 06:00 (the game clock's default start). */
export const START_MINUTE = 6 * 60;

/** Fact key of the day number (1 on the first day). */
export const DAY_FACT = 'time.day';
/** Fact key of the minute of the day, 0-1439. */
export const MINUTE_FACT = 'time.minute';

/**
 * Fact key of the sim tick the current game minute is counted from: the running clock's remainder is
 * `tick - origin`. Written once per game minute, not per tick.
 */
export const MINUTE_ORIGIN_FACT = 'time.minute-origin';
/** Fact key of the sim tick a screen first held the clock at, or -1 while it runs. */
export const HELD_AT_FACT = 'time.held-at';
/** Fact key of the current phase of the day (`dawn`, `day`, `dusk`, `night` by default). */
export const PHASE_FACT = 'time.phase';

/** The facts the clock keeps, as the fact registry declares them (src/content/data/fact/time.json). */
export const DAY_CLOCK_FACTS: Readonly<Record<string, FactSpec>> = Object.freeze({
  [DAY_FACT]: { type: 'int', default: 1 },
  [MINUTE_FACT]: { type: 'int', default: START_MINUTE },
  [MINUTE_ORIGIN_FACT]: { type: 'int', default: 0 },
  [HELD_AT_FACT]: { type: 'int', default: -1 },
  [PHASE_FACT]: { type: 'id', default: 'dawn' },
});

/** A moment: the day number and the minute of that day. */
export interface TimeOfDay {
  readonly day: number;
  readonly minute: number;
}

/** Where rest reads and writes the time. */
export interface DayClock {
  now(): TimeOfDay;
  set(time: TimeOfDay): void;
}

/** The day clock kept in a world's facts (the declarations must be on the store). */
export function factDayClock(facts: FactStore): DayClock {
  return {
    now: () => ({
      day: Number(facts.get(DAY_FACT) ?? 1),
      minute: Number(facts.get(MINUTE_FACT) ?? START_MINUTE),
    }),
    set: (time) => {
      facts.set(DAY_FACT, time.day);
      facts.set(MINUTE_FACT, time.minute);
    },
  };
}

/** `time` moved on by a whole number of `minutes` (day rolls over at midnight). */
export function addMinutes(time: TimeOfDay, minutes: number): TimeOfDay {
  const total = time.minute + minutes;
  return {
    day: time.day + Math.floor(total / MINUTES_PER_DAY),
    minute: total % MINUTES_PER_DAY,
  };
}

/**
 * Minutes from `time` to the next morning (06:00). Before 06:00 it is this day's morning; at or after
 * it, tomorrow's, so it is always between 1 and 1440.
 */
export function minutesUntilMorning(time: TimeOfDay): number {
  const wait = (MORNING_MINUTE - time.minute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return wait === 0 ? MINUTES_PER_DAY : wait;
}

/** "07:05": a time of day for display. */
export function clockText(time: TimeOfDay): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(Math.floor(time.minute / 60))}:${two(time.minute % 60)}`;
}
