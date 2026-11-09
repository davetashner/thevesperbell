import { describe, expect, it } from 'vitest';
import { FOOTSTEP_SURFACES } from '@content/index';
import type { SceneSurface } from '@sim/index';
import { PATCH_LIFT, SURFACE_COLOURS, surfacePatches } from './surface-patches';

const floor = {
  purpose: 'walkable' as const,
  shape: 'box' as const,
  min: { x: 0, y: -0.2, z: 0 },
  max: { x: 10, y: 0, z: 10 },
};
const region = (id: string, surface: string, priority = 0, extra: Partial<SceneSurface> = {}) => ({
  id,
  surface,
  priority,
  min: { x: 2, y: -0.5, z: 2 },
  max: { x: 12, y: 1, z: 6 },
  ...extra,
});

describe('surface patches (mw-1jm)', () => {
  it('draws a patch on the floor under a region, clipped to the floor', () => {
    expect(surfacePatches([floor], [region('rug', 'carpet')])).toEqual([
      { region: 'rug', surface: 'carpet', minX: 2, maxX: 10, minZ: 2, maxZ: 6, y: PATCH_LIFT },
    ]);
  });

  it('skips walls, wedges, floors at another height and regions off the floor', () => {
    const parts = [
      { ...floor, purpose: 'blocking' as const },
      { ...floor, shape: 'wedge' as const },
      { ...floor, max: { x: 10, y: 3, z: 10 } },
    ];
    expect(surfacePatches(parts, [region('rug', 'carpet')])).toEqual([]);
    expect(
      surfacePatches(
        [floor],
        [region('far', 'gravel', 0, { min: { x: 20, y: -1, z: 0 }, max: { x: 30, y: 1, z: 5 } })],
      ),
    ).toEqual([]);
  });

  it('draws the winning region of an overlap last, and higher', () => {
    const lowFirst = surfacePatches([floor], [region('a', 'wood'), region('b', 'carpet', 1)]);
    expect(lowFirst.map((p) => p.region)).toEqual(['a', 'b']);
    expect(lowFirst[1]?.y).toBeGreaterThan(lowFirst[0]?.y ?? 0);
    // A tie goes to the first listed, which is drawn last.
    const tie = surfacePatches([floor], [region('a', 'wood'), region('b', 'mud')]);
    expect(tie.map((p) => p.region)).toEqual(['b', 'a']);
  });

  it('every surface has a colour of its own, none the plain floor’s', () => {
    const colours = FOOTSTEP_SURFACES.map((s) => SURFACE_COLOURS[s]);
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours).not.toContain(0x8c8676);
  });
});
