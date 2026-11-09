import type { AcousticSurface } from '@content/index';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOTSTEP_SURFACES } from '../character/footsteps';
import { createSurfaceMap, regionAt, surfaceAt, type SurfaceRegion } from './surfaces';

// The game table's numbers that matter here (src/content/data/surface-table/surfaces.json).
const DB: Record<string, number> = {
  stone: 0,
  wood: 2,
  carpet: -10,
  grass: -5,
  gravel: 8,
  mud: -4,
  leaves: 7,
};
const table = new Map<string, AcousticSurface>(
  Object.entries(DB).map(([id, offsetDb]) => [
    id,
    { id, offsetDb, varianceDb: 1, sfx: `sfx-foot-${id}` },
  ]),
);
const box = (id: string, surface: string, priority = 0, y = 0): SurfaceRegion => ({
  id,
  surface,
  priority,
  min: { x: 0, y: y - 1, z: 0 },
  max: { x: 10, y: y + 1, z: 10 },
});
const at = { x: 5, y: 0, z: 5 };
const tuning = DEFAULT_FOOTSTEP_SURFACES;
const WOOD_FLOOR = { material: 'wood', wetness: 0, frozen: false, burning: false };

describe('surfaceAt (mw-e09.4)', () => {
  it('AC-1: a position on a carpet region is carpet at −10 dB, even over a wooden floor', () => {
    const map = createSurfaceMap({ table, regions: [box('rug', 'carpet')] });
    const bare = surfaceAt(map, at, tuning);
    expect(bare).toMatchObject({
      material: 'carpet',
      surfaceDb: -10,
      source: 'region',
      region: 'rug',
    });
    expect(bare.acoustics?.sfx).toBe('sfx-foot-carpet');
    const onWood = surfaceAt(map, at, tuning, WOOD_FLOOR, () => 2);
    expect(onWood).toMatchObject({ material: 'carpet', surfaceDb: -10, source: 'region' });
    expect(surfaceAt(map, { x: 20, y: 0, z: 5 }, tuning, WOOD_FLOOR, () => 2)).toMatchObject({
      material: 'wood',
      surfaceDb: 2,
      source: 'ground',
    });
  });

  it('AC-2: a wood surface that gains the frozen property gets the frozen modifier', () => {
    const map = createSurfaceMap({ table });
    const offsetOf = (m: string) => table.get(m)?.offsetDb;
    const dry = surfaceAt(map, at, tuning, WOOD_FLOOR, offsetOf);
    const frozen = surfaceAt(map, at, tuning, { ...WOOD_FLOOR, frozen: true }, offsetOf);
    expect(dry).toMatchObject({ material: 'wood', frozen: false, surfaceDb: 2 });
    expect(frozen).toMatchObject({ material: 'wood', frozen: true });
    expect(frozen.surfaceDb).toBe(2 + tuning.frozenDb);
    expect(frozen.acoustics?.id).toBe('wood');
    // Wet, too, and the state belongs to the floor under a region.
    const rug = createSurfaceMap({ table, regions: [box('rug', 'carpet')] });
    const wetRug = surfaceAt(rug, at, tuning, { ...WOOD_FLOOR, wetness: 1 });
    expect(wetRug).toMatchObject({ material: 'carpet', wet: true, surfaceDb: -10 + tuning.wetDb });
  });

  it('AC-3: overlapping regions: the higher priority wins; a tie goes to the first listed', () => {
    const grass = box('lawn', 'grass', 0);
    const gravel = box('path', 'gravel', 5);
    const a = createSurfaceMap({ table, regions: [grass, gravel] });
    const b = createSurfaceMap({ table, regions: [gravel, grass] });
    expect(surfaceAt(a, at, tuning).material).toBe('gravel');
    expect(surfaceAt(b, at, tuning).material).toBe('gravel');
    const tie = createSurfaceMap({ table, regions: [box('x', 'mud'), box('y', 'leaves')] });
    expect(regionAt(tie, at)?.id).toBe('x');
    // Same answer every time.
    expect(surfaceAt(tie, at, tuning)).toEqual(surfaceAt(tie, at, tuning));
    // Vertical extent matters: another floor's carpet does not reach.
    const upstairs = createSurfaceMap({ table, regions: [box('up', 'carpet', 0, 6)] });
    expect(regionAt(upstairs, at)).toBeUndefined();
  });

  it('AC-4: an untagged position is stone, and the dev warning is logged once', () => {
    const warnings: string[] = [];
    const map = createSurfaceMap({ table, warn: (m) => warnings.push(m) });
    const first = surfaceAt(map, at, tuning);
    expect(first).toMatchObject({ material: 'stone', surfaceDb: 0, source: 'default' });
    surfaceAt(map, { x: 9, y: 0, z: 9 }, tuning);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('defaulting to stone');
    // Tagged and grounded positions never warn; a map without a sink stays quiet.
    surfaceAt(createSurfaceMap({ table, warn: (m) => warnings.push(m) }), at, tuning, WOOD_FLOOR);
    expect(warnings).toHaveLength(1);
    expect(() => surfaceAt(createSurfaceMap({ table }), at, tuning)).not.toThrow();
  });

  it('rejects a region or fallback the table does not have', () => {
    expect(() => createSurfaceMap({ table, regions: [box('r', 'marble')] })).toThrow(RangeError);
    expect(() => createSurfaceMap({ table, fallback: 'marble' })).toThrow(RangeError);
  });

  it('a ground material with no table row has no acoustics and uses its own offset', () => {
    const map = createSurfaceMap({ table });
    const reading = surfaceAt(map, at, tuning, { ...WOOD_FLOOR, material: 'iron' });
    expect(reading.acoustics).toBeUndefined();
    expect(reading.surfaceDb).toBe(0);
  });
});
