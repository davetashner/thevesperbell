// The `contests` save section (mw-opf6): the contest runner's state (src/sim/contest), so a save
// taken mid-match (or a carry across an area transition) resumes it: the contests in progress with
// their scores, bets and cheats, how each finished contest ended and the runner's rng stream. A
// world without a runner (a bare test world) saves nothing and ignores a loaded section. A contest
// this build no longer defines is dropped from a load with one warning: losing it is better than
// losing the save.

import { CONTEST_OUTCOMES, type ContestSnapshot } from '@sim/index';
import { z } from 'zod';
import { contestsOf } from '../contest/install';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the contests section (never renamed). */
export const CONTESTS_SECTION_ID = 'contests';

/** Data version of the section. v1 (mw-opf6): contests in progress, results and the rng stream. */
export const CONTESTS_SECTION_VERSION = 1;

/** `CONTESTS_MIGRATIONS[n]` upgrades the section's data from v`n` to v`n + 1`. Empty until v2. */
export const CONTESTS_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({});

/** The section's data: the runner's snapshot (a world without a runner saves it empty). */
export interface ContestsData {
  readonly active: ContestSnapshot['active'];
  readonly results: ContestSnapshot['results'];
  readonly rng?: ContestSnapshot['rng'];
}

const id = z.string().min(1);
const score = z.strictObject({
  id,
  score: z.int(),
  reachedAt: z.int().nullable(),
});
const nodes = z.array(z.looseObject({ kind: id }));

const activeSchema = z.strictObject({
  startedAt: z.int(),
  player: score,
  rivals: z.array(
    score.extend({
      pace: z
        .strictObject({
          everyTicks: z.int().positive(),
          points: z.int().positive(),
          spread: z.int().nonnegative(),
        })
        .nullable(),
      next: z.int(),
    }),
  ),
  cheats: z.record(id, z.strictObject({ caught: z.boolean() })),
  bet: z.strictObject({ onWin: nodes, onLoss: nodes, onDisqualified: nodes }).exactOptional(),
  scored: z.boolean(),
});

const contestsSchema = z.strictObject({
  active: z.record(id, activeSchema),
  results: z.record(id, z.enum(CONTEST_OUTCOMES)),
  rng: z.strictObject({ seed: z.int(), state: z.array(z.int()).length(4) }).exactOptional(),
}) as unknown as z.ZodType<ContestsData>;

/** The contests section. */
export function contestsSaveSection(): SaveSection<ContestsData> {
  return defineSaveSection<ContestsData>({
    id: CONTESTS_SECTION_ID,
    version: CONTESTS_SECTION_VERSION,
    schema: contestsSchema,
    migrations: CONTESTS_MIGRATIONS,
    serialize: (world) => {
      const runner = contestsOf(world);
      return runner === undefined ? { active: {}, results: {} } : runner.serialize();
    },
    deserialize: (world, saved, context) => {
      const runner = contestsOf(world);
      if (runner === undefined) return;
      const known = (contest: string): boolean => {
        try {
          runner.isActive(contest);
          return true;
        } catch {
          context.warn(`save: dropped contest "${contest}": the contest is no longer defined`);
          return false;
        }
      };
      runner.restore({
        active: Object.fromEntries(Object.entries(saved.active).filter(([key]) => known(key))),
        results: Object.fromEntries(Object.entries(saved.results).filter(([key]) => known(key))),
        rng: saved.rng ?? runner.serialize().rng,
      });
    },
    // A save from before contests: nothing is in progress.
    missing: (world) => {
      const runner = contestsOf(world);
      runner?.restore({ active: {}, results: {}, rng: runner.serialize().rng });
    },
  });
}
