// Game-level configuration (mw-e01.15): one file, `src/content/data/game/game.json`, holding the
// settings that shape a build rather than any one scene, class or item. m1 ships Knight only
// (docs/design/vertical-slice.md §3, beat B1), so the file starts with:
//
// - `playableClasses`: the class ids the class select screen lets the player confirm, refs into
//   src/content/data/class/. Every other class still shows its card, locked with the reason "Not
//   playable in this build yet". m2 unlocks classes by editing this list, with no code change. A build
//   must offer at least one class, and a listed id with no class file fails the load's reference check.
//
// - `startScene` (mw-e01.2): the scene a new game starts in, and the scene the title screen shows behind
//   it, a ref into src/content/data/scene/. m1 starts in the slice; E24 switches the start to the
//   mountain road at m3 by editing this field, with no code change. An id with no scene file fails the
//   load's reference check, naming the missing id.
//
// - `clock` (mw-e27.12): the in-game clock's data (docs/design/game-clock.md): the length of a game day
//   in real minutes, where a new world starts, the phases of the day and which screens hold the clock
//   while open. The sim's `GameClockConfig` has the same shape; the validity checks that need the tick
//   rate (a whole number of ticks per game minute) run when the clock is installed.
//
// Debug builds can widen the class list with `?allclasses` (src/game/classes.ts) so per-class tests
// still run.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { ref } from '../schema.ts';

/** The id (and file name) of the one game configuration entry. */
export const GAME_CONFIG_ID = 'game';

const minuteOfDay = z.int().min(0).max(1439);

/** Schema of the clock block. */
export const clockSchema = z
  .strictObject({
    dayLengthRealMinutes: z
      .number()
      .positive()
      .describe('Real minutes of sim time in one game day; 60 means a day passes in an hour.'),
    start: z
      .strictObject({
        day: z.int().min(1).describe('Day number a new world starts on.'),
        minute: minuteOfDay.describe('Minute of that day a new world starts at (360 = 06:00).'),
      })
      .describe('Where a new world starts.'),
    phases: z
      .array(
        z.strictObject({
          id: z
            .string()
            .regex(/^[a-z][a-z0-9-]*$/)
            .describe('Phase id, e.g. "dawn".'),
          startMinute: minuteOfDay.describe('Minute of the day the phase begins.'),
        }),
      )
      .min(1)
      .describe(
        'Phases of the day, ascending by startMinute; the last runs past midnight into the first.',
      ),
    pauseScreens: z
      .record(z.string().min(1), z.boolean())
      .describe(
        'Screen id -> whether it holds the clock while open (the sim already stops while a menu pauses it; this is for screens that leave it running).',
      ),
  })
  .describe('The in-game clock (mw-e27.12).');

/** Schema of the game configuration, `src/content/data/game/game.json`. */
export const gameSchema = z.strictObject({
  id: z.literal(GAME_CONFIG_ID).describe('Always "game": there is one game configuration.'),
  notes: z.string().min(1).describe('What this build offers and why.'),
  playableClasses: z
    .array(ref('class').describe('A class from src/content/data/class/.'))
    .min(1, 'a build must offer at least one playable class')
    .superRefine((classes, ctx) => {
      const seen = new Set<string>();
      classes.forEach(({ id }, index) => {
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: [index], message: `"${id}" is listed twice` });
        }
        seen.add(id);
      });
    })
    .describe(
      'The classes the class select screen lets the player confirm; the rest show locked (mw-e01.15).',
    ),
  startScene: ref('scene').describe(
    'The scene a new game starts in and the title screen shows behind it (mw-e01.2).',
  ),
  clock: clockSchema,
});

/** The game configuration as written in JSON. */
export type GameConfigInput = z.input<typeof gameSchema>;
/** The validated game configuration. */
export type GameConfig = z.output<typeof gameSchema>;
/** The loaded (deeply frozen) game configuration. */
export type GameConfigEntry = Frozen<GameConfig>;
