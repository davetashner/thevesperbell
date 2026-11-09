// What a save holds of the world's state (mw-e27.6): its facts and level deltas, read without a
// world. The bytes are checked and migrated like a load (SaveRegistry.check), then the two sections
// are read through their own migrations. A section the save lacks reads as empty, and a damaged
// level is left out, as a load would drop it.

import type { LevelDeltas } from '@sim/index';
import {
  migrateSection,
  validateSection,
  type SaveRegistry,
  type SaveSection,
  type SectionRecord,
} from '@game/save/format';
import { LEVEL_DELTAS_SECTION_ID, levelDeltasSaveSection } from '@game/save/level-deltas';
import { WORLD_FACTS_SECTION_ID, worldFactsSaveSection } from '@game/save/world-facts';
import { z } from 'zod';
import type { StateView } from './diff';

export type SaveStateResult =
  | { readonly ok: true; readonly state: StateView }
  | { readonly ok: false; readonly reason: string };

const levelsSchema = z.object({
  levels: z.record(
    z.string(),
    z.object({
      entities: z.array(z.looseObject({ id: z.string() })),
      spawned: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
    }),
  ),
});

/**
 * A section's data at its current version. `SaveRegistry.check` has already migrated and validated
 * every record it accepts, so this only fails for a record that check would have refused.
 * @throws the migration or validation error.
 */
export function sectionData(section: SaveSection, record: SectionRecord): unknown {
  const migrated = migrateSection(section, record);
  if (!migrated.ok) throw migrated.error;
  const valid = validateSection(section, migrated.data);
  if (!valid.ok) throw valid.error;
  return valid.data;
}

/** The facts and level deltas of the save in `bytes`. */
export function readSaveState(registry: SaveRegistry, bytes: Uint8Array): SaveStateResult {
  const checked = registry.check(bytes);
  if (!checked.ok) return { ok: false, reason: checked.error.message };
  const { sections } = checked.envelope;
  const factsRecord = sections[WORLD_FACTS_SECTION_ID];
  const levelsRecord = sections[LEVEL_DELTAS_SECTION_ID];
  const facts =
    factsRecord === undefined
      ? {}
      : (sectionData(worldFactsSaveSection(), factsRecord) as { facts: StateView['facts'] }).facts;
  const saved =
    levelsRecord === undefined
      ? undefined
      : levelsSchema.safeParse(sectionData(levelDeltasSaveSection(), levelsRecord));
  const levels: LevelDeltas[] = [];
  for (const [level, deltas] of Object.entries(saved?.data?.levels ?? {})) {
    // Shape-checked above; aspect and spawn data stay opaque, as the section keeps them.
    levels.push({ level, ...(deltas as unknown as Omit<LevelDeltas, 'level'>) });
  }
  return { ok: true, state: { facts, levels } };
}
