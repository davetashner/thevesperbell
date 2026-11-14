// The `level-deltas` save section (mw-e27.4): how every visited level differs from its authored
// baseline (src/sim/deltas), from the world's level delta store (`levelDeltasOf`). Saving captures
// the loaded level's deltas now and writes them with the stored deltas of every other level. Loading
// puts the saved deltas back in the store, where each level's wait until the level is next entered
// (the loaded level itself comes back exactly from the world section).
//
// Corruption stays local: each level's deltas are checked on their own, and a damaged level is
// dropped with a recoverable warning, so it starts as authored next time while every other level
// and section loads. A damaged section as a whole drops every level's deltas the same way.

import { levelDeltasOf, type EntityDelta, type LevelDeltas, type SpawnedRecord } from '@sim/index';
import { z } from 'zod';
import { defineSaveSection, type SaveSection, type SectionMigration } from './format';

/** Id of the level deltas section (never renamed). */
export const LEVEL_DELTAS_SECTION_ID = 'level-deltas';

/**
 * Data version of the level deltas section. v1 (mw-e27.4): level id → changed authored entities and
 * persistent runtime entities. Aspect data belongs to its persistence declaration, which checks it
 * when it applies (a declaration that changes shape rejects old data, or adds a version here).
 */
export const LEVEL_DELTAS_SECTION_VERSION = 1;

/**
 * `LEVEL_DELTAS_MIGRATIONS[n]` upgrades the section's data from v`n` to v`n + 1`. Empty until the
 * shape changes.
 */
export const LEVEL_DELTAS_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze(
  {},
);

/** One level's deltas as saved: a LevelDeltas without its level id (the key). */
export interface SavedLevelDeltas {
  readonly entities: readonly EntityDelta[];
  readonly spawned: readonly SpawnedRecord[];
}

/** The section's data: level id → its deltas. */
export interface LevelDeltasData {
  readonly levels: Readonly<Record<string, SavedLevelDeltas>>;
}

const stableId = z.string().min(1);

const levelSchema = z.strictObject({
  entities: z.array(
    z.strictObject({
      id: stableId,
      destroyed: z.literal(true).exactOptional(),
      aspects: z.record(z.string().min(1), z.unknown()).exactOptional(),
    }),
  ),
  spawned: z.array(z.strictObject({ id: stableId, kind: z.string().min(1), data: z.unknown() })),
}) satisfies z.ZodType<SavedLevelDeltas>;

const dataSchema = z.strictObject({
  levels: z.record(stableId, z.union([levelSchema, z.unknown()])),
});

// Anything else validates too: a damaged level (or section) is dropped when it loads, not refused,
// and the unions keep the real shape in the save-schema fingerprint.
const sectionSchema = z.union([dataSchema, z.unknown()]);

export interface LevelDeltasSectionOptions {
  /** Receives one message per damaged level a load dropped. */
  readonly warn?: (message: string) => void;
}

/** Issues of a zod failure, one line. */
const issuesOf = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

/** The level deltas section; register it after the sections that restore entities. */
export function levelDeltasSaveSection(options: LevelDeltasSectionOptions = {}): SaveSection {
  return defineSaveSection<unknown>({
    id: LEVEL_DELTAS_SECTION_ID,
    version: LEVEL_DELTAS_SECTION_VERSION,
    schema: sectionSchema,
    migrations: LEVEL_DELTAS_MIGRATIONS,
    serialize: (world): LevelDeltasData => {
      const levels: Record<string, SavedLevelDeltas> = {};
      for (const { level, entities, spawned } of levelDeltasOf(world).capture(world)) {
        levels[level] = { entities, spawned };
      }
      return { levels };
    },
    deserialize: (world, data, context) => {
      const report = (message: string): void => {
        context.warn(message);
        options.warn?.(message);
      };
      const levels: LevelDeltas[] = [];
      const section = dataSchema.safeParse(data);
      if (!section.success) {
        report(
          `save: level changes are damaged (${issuesOf(section.error)}); every level starts as built`,
        );
      } else {
        for (const [level, saved] of Object.entries(section.data.levels)) {
          const parsed = levelSchema.safeParse(saved);
          if (parsed.success) levels.push({ level, ...parsed.data });
          else {
            report(
              `save: changes to level "${level}" are damaged (${issuesOf(parsed.error)}); it starts as built`,
            );
          }
        }
      }
      levelDeltasOf(world).restore(levels);
      // The loaded level came back exactly from the world section; its fires and wetness settle (mw-e27.7).
      levelDeltasOf(world).settle(world);
    },
    missing: (world) => {
      levelDeltasOf(world).restore([]);
      levelDeltasOf(world).settle(world);
    },
  });
}
