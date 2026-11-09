// mw-1jm: the tagged surface regions of the shipped scenes. Each names a surface the surface table has,
// lies inside its scene, and covers a walkable floor a player can see (the greybox draws it there), so a
// region never changes the sound of ground that looks like something else. Also: a material that names a
// footstep surface agrees with that surface's table offset, so one floor has one number.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import { surfacePatches } from '../../src/render/greybox/surface-patches';

const content = loadGameContent();
const table = content.get('surface-table', 'surfaces');
const scenes = content.all('scene').filter((s) => s.surfaces.length > 0);

describe('tagged surface regions (mw-1jm)', () => {
  it('some scenes are tagged, and the slice is not', () => {
    expect(scenes.map((s) => s.id).sort()).toEqual([
      'marsh-store',
      'sleeping-ox',
      'under-the-bridge',
    ]);
  });

  for (const scene of scenes) {
    it(`${scene.id}: every region uses a known surface, lies inside the scene and shows on a floor`, () => {
      const layout = layoutScene(scene, (id) => content.get('kit', id));
      const known = new Set<string>(table.surfaces.map((row) => row.id));
      const floors = layout.parts.filter((p) => p.purpose === 'walkable');
      const lo = {
        x: Math.min(...floors.map((p) => p.min.x)),
        z: Math.min(...floors.map((p) => p.min.z)),
      };
      const hi = {
        x: Math.max(...floors.map((p) => p.max.x)),
        z: Math.max(...floors.map((p) => p.max.z)),
      };
      for (const region of layout.surfaces) {
        expect(known.has(region.surface), `${region.id} surface`).toBe(true);
        expect(region.min.x, `${region.id} min x`).toBeGreaterThanOrEqual(lo.x);
        expect(region.min.z, `${region.id} min z`).toBeGreaterThanOrEqual(lo.z);
        expect(region.max.x, `${region.id} max x`).toBeLessThanOrEqual(hi.x);
        expect(region.max.z, `${region.id} max z`).toBeLessThanOrEqual(hi.z);
        const patches = surfacePatches(layout.parts, [region]);
        expect(patches.length, `${region.id} covers a visible floor`).toBeGreaterThan(0);
      }
    });
  }

  it('a material that names a footstep surface has that surface’s table offset', () => {
    const offsets = new Map<string, number>(table.surfaces.map((row) => [row.id, row.offsetDb]));
    for (const material of content.all('material')) {
      if (material.footstepSurface === undefined) continue;
      expect(material.footstepLoudness, material.id).toBe(offsets.get(material.footstepSurface));
    }
  });
});
