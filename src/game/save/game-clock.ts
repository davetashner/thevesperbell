// The `game-clock` save section (mw-e27.12): the pending schedule (events scheduled with
// `clock.schedule.at` and `.every`). The time itself, the minute remainder and the phase are world
// facts and travel in the world-facts section, so a save restores the clock exactly. A world without
// a game clock (a bare test world) saves an empty schedule and ignores a loaded one.

import { gameClockOf, type ScheduledEntry } from '@sim/index';
import { z } from 'zod';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the game clock section (never renamed). */
export const GAME_CLOCK_SECTION_ID = 'game-clock';

/** Data version of the section. v1 (mw-e27.12): the pending schedule. */
export const GAME_CLOCK_SECTION_VERSION = 1;

/** `GAME_CLOCK_MIGRATIONS[n]` upgrades the section's data from v`n` to v`n + 1`. Empty until v2. */
export const GAME_CLOCK_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({});

/** The section's data. */
export interface GameClockData {
  readonly schedule: readonly ScheduledEntry[];
}

const entrySchema = z.strictObject({
  id: z.string().min(1),
  at: z.int(),
  priority: z.int(),
  period: z.int().positive().exactOptional(),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

const gameClockSchema = z.strictObject({
  schedule: z.array(entrySchema),
}) satisfies z.ZodType<GameClockData>;

/** The game clock section. */
export function gameClockSaveSection(): SaveSection<GameClockData> {
  return defineSaveSection<GameClockData>({
    id: GAME_CLOCK_SECTION_ID,
    version: GAME_CLOCK_SECTION_VERSION,
    schema: gameClockSchema,
    migrations: GAME_CLOCK_MIGRATIONS,
    serialize: (world) => ({ schedule: gameClockOf(world)?.schedule.pending() ?? [] }),
    deserialize: (world, { schedule }) => {
      gameClockOf(world)?.schedule.restore(schedule);
    },
    // A save from before the clock had no schedule.
    missing: (world) => {
      gameClockOf(world)?.schedule.restore([]);
    },
  });
}
