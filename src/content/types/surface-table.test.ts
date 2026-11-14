import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { FOOTSTEP_LOUDNESS_RANGE, FOOTSTEP_SURFACES } from './material.ts';
import {
  compileSurfaceTable,
  FOOTSTEP_SOUND_PATTERN,
  surfaceTableSchema,
  SURFACE_TABLE_ID,
  type SurfaceTableDefInput,
} from './surface-table.ts';

const row = (id: (typeof FOOTSTEP_SURFACES)[number]) => ({
  id,
  offsetDb: 0,
  varianceDb: 1,
  sfx: `sfx-foot-${id}`,
});
const valid: SurfaceTableDefInput = {
  id: 'test-surfaces',
  notes: 'A table for tests.',
  surfaces: FOOTSTEP_SURFACES.map((id) => row(id)),
};
const problems = (value: unknown) =>
  (surfaceTableSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** The surface ids audio bible §7.3 lists: the backticked ids of its "Surfaces" paragraph. */
function bibleSurfaces(): string[] {
  const text = readFileSync(new URL('../../../docs/audio/audio-bible.md', import.meta.url), 'utf8');
  const section = text.slice(text.indexOf('### 7.3 Footstep surface set'));
  const paragraph = section.slice(0, section.indexOf('River and harbour reuse'));
  return [...paragraph.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1] ?? '');
}

describe('surface table schema (mw-e09.4)', () => {
  it('AC-5: accepts a table of every surface and compiles it to a frozen lookup', () => {
    expect(problems(valid)).toEqual([]);
    const map = compileSurfaceTable(surfaceTableSchema.parse(valid));
    expect([...map.keys()]).toEqual([...FOOTSTEP_SURFACES]);
    expect(Object.isFrozen(map.get('stone'))).toBe(true);
  });

  it('AC-5: rejects an offset outside −20..+20 dB, a bad sound set id or too much variance', () => {
    const with0 = (patch: object) => ({
      ...valid,
      surfaces: [{ ...row('stone'), ...patch }, ...valid.surfaces.slice(1)],
    });
    expect(problems(with0({ offsetDb: FOOTSTEP_LOUDNESS_RANGE.max + 1 }))).toHaveLength(1);
    expect(problems(with0({ offsetDb: FOOTSTEP_LOUDNESS_RANGE.min - 1 }))).toHaveLength(1);
    expect(problems(with0({ sfx: 'footstep-stone' }))).toHaveLength(1);
    expect(problems(with0({ sfx: undefined }))).toHaveLength(1);
    expect(problems(with0({ varianceDb: 7 }))).toHaveLength(1);
    expect(problems(with0({ creak: { chance: 0, db: 12 } }))).toHaveLength(1);
    expect(problems(with0({ creak: { chance: 0.1, db: 12 } }))).toEqual([]);
  });

  it('AC-6: a surface missing, listed twice or unknown fails', () => {
    expect(problems({ ...valid, surfaces: valid.surfaces.slice(1) })).toEqual([
      'surfaces: surface "stone" (audio bible §7.3) has no row',
    ]);
    expect(problems({ ...valid, surfaces: [...valid.surfaces, row('stone')] })).toEqual([
      `surfaces.${String(valid.surfaces.length)}.id: surface "stone" is listed twice`,
    ]);
    expect(
      problems({ ...valid, surfaces: [...valid.surfaces, { ...row('stone'), id: 'marble' }] }),
    ).toHaveLength(1);
  });
});

describeContent(
  'surface-table',
  'AC-5: every surface has an offset in −20..+20 dB and a sfx set',
  (table) => {
    expect(surfaceTableSchema.parse(JSON.parse(JSON.stringify(table)))).toEqual(table);
    for (const surface of table.surfaces) {
      expect(surface.offsetDb).toBeGreaterThanOrEqual(-20);
      expect(surface.offsetDb).toBeLessThanOrEqual(20);
      expect(surface.sfx).toMatch(FOOTSTEP_SOUND_PATTERN);
      expect(surface.sfx).toBe(`sfx-foot-${surface.id}`);
    }
  },
);

describeContent(
  'surface-table',
  'AC-1: the game table has carpet at −10 dB and stone at 0',
  (table) => {
    if (table.id !== SURFACE_TABLE_ID) return;
    const map = compileSurfaceTable(table);
    expect(map.get('carpet')?.offsetDb).toBe(-10);
    expect(map.get('stone')?.offsetDb).toBe(0);
  },
);

describeContent(
  'surface-table',
  'AC-6: the table ids match audio bible §7.3 exactly (a test fails on any id in only one list)',
  (table) => {
    const inTable: string[] = table.surfaces.map((s) => s.id).sort();
    const inBible = bibleSurfaces().sort();
    expect(inBible.length).toBeGreaterThan(10);
    expect(inTable.filter((id) => !inBible.includes(id))).toEqual([]);
    expect(inBible.filter((id) => !inTable.includes(id))).toEqual([]);
    expect(inTable).toEqual([...FOOTSTEP_SURFACES].sort());
  },
);

describeContent('surface-table', 'orders loudness as the audio bible requires', (table) => {
  const db = (id: string) => table.surfaces.find((s) => s.id === id)?.offsetDb ?? NaN;
  const chain = ['carpet', 'grass', 'dirt', 'stone', 'wood-hollow'];
  for (let i = 1; i < chain.length; i++) {
    expect(db(chain[i] ?? '')).toBeGreaterThan(db(chain[i - 1] ?? ''));
  }
  for (const loud of ['gravel', 'water-shallow', 'metal-grate', 'bone-litter']) {
    expect(db(loud)).toBeGreaterThan(db('wood-hollow'));
    expect(db('glass-shards')).toBeGreaterThan(db(loud));
  }
});
