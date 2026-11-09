// The `world-facts` save section (mw-e27.4): the world's fact store, versioned on its own instead of
// inside the world snapshot. Every load runs the facts through the migrations the fact registry
// generates (src/sim/facts/migrate.ts): a fact saved under a key the registry lists in `renamedFrom`
// loads under its current key with its value; a fact the registry no longer declares, or whose value
// its declaration no longer accepts, is dropped with a warning and the rest load. Persistence policies
// (mw-e27.7) apply on both sides: a save leaves out transient facts, a load resets what ran out and
// decays what decays (src/sim/facts/policy.ts). Saves from before
// this section kept their facts in the world section; they get the same migrations.

import {
  migrateFacts,
  settleSavedFacts,
  type DroppedFact,
  type FactSnapshot,
  type World,
} from '@sim/index';
import { z } from 'zod';
import {
  defineSaveSection,
  type SaveSection,
  type SectionLoadContext,
  type SectionMigration,
} from './format';

/** Id of the world facts section (never renamed). */
export const WORLD_FACTS_SECTION_ID = 'world-facts';

/** Data version of the world facts section. v1 (mw-e27.4): every set fact, key → value. */
export const WORLD_FACTS_SECTION_VERSION = 1;

/**
 * `WORLD_FACTS_MIGRATIONS[n]` upgrades the section's data from v`n` to v`n + 1`. Renamed and removed
 * facts need no entry: the registry's declarations migrate them on every load. Empty until the
 * section's own shape changes.
 */
export const WORLD_FACTS_MIGRATIONS: Readonly<Record<number, SectionMigration>> = Object.freeze({});

/** The section's data: set facts in code-unit key order. */
export interface WorldFactsData {
  readonly facts: FactSnapshot;
}

// Keys are any string: a former key may predate today's key syntax. The store checks current keys.
const worldFactsSchema = z.strictObject({
  facts: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
}) satisfies z.ZodType<WorldFactsData>;

export interface WorldFactsSectionOptions {
  /** Receives one message per fact a load renamed or dropped. */
  readonly warn?: (message: string) => void;
}

/** The warning a load logs for a dropped fact. */
export function droppedFactMessage(fact: DroppedFact): string {
  const why =
    fact.reason === 'undeclared'
      ? 'the fact is no longer declared'
      : fact.reason === 'superseded'
        ? 'the save also holds the fact under its current key'
        : 'its value no longer fits the fact';
  return `save: dropped fact "${fact.key}" = ${JSON.stringify(fact.value)}: ${why}`;
}

/** The world facts section; it owns the world's facts, so the world section leaves them out. */
export function worldFactsSaveSection(
  options: WorldFactsSectionOptions = {},
): SaveSection<WorldFactsData> {
  const restore = (world: World, saved: FactSnapshot, context: SectionLoadContext): void => {
    const { facts, renamed, dropped } = migrateFacts(world.facts, saved);
    for (const { from, to } of renamed) {
      options.warn?.(`save: fact "${from}" loaded as "${to}" (renamed)`);
    }
    for (const fact of dropped) {
      const message = droppedFactMessage(fact);
      context.warn(message);
      options.warn?.(message);
    }
    // Persistence policies (mw-e27.7): transient facts start over, expired ones reset, decayed ones decay.
    const settled = settleSavedFacts(world.facts, facts, world.tick);
    world.facts.prepareRestore(settled.facts)();
  };
  return defineSaveSection<WorldFactsData>({
    id: WORLD_FACTS_SECTION_ID,
    version: WORLD_FACTS_SECTION_VERSION,
    schema: worldFactsSchema,
    ownsFacts: true,
    migrations: WORLD_FACTS_MIGRATIONS,
    // Transient facts are never saved (mw-e27.7).
    serialize: (world) => ({ facts: world.facts.persistentSnapshot() }),
    // The world section of a save that has this section holds no facts; were it to, these win.
    deserialize: (world, { facts }, context) => {
      restore(world, { ...context.worldFacts, ...facts }, context);
    },
    missing: (world, context) => {
      restore(world, context.worldFacts ?? {}, context);
    },
  });
}
