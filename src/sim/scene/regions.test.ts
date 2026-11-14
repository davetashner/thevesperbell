import { describe, expect, it } from 'vitest';
import type { SceneRegion } from './layout';
import { regionsAt } from './regions';

const region = (id: string, min: [number, number, number], max: [number, number, number]) =>
  ({
    id,
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
    tags: [],
  }) as SceneRegion;

describe('regionsAt', () => {
  const regions = [region('wood', [0, 0, 0], [10, 5, 10]), region('pond', [4, 0, 4], [6, 2, 6])];

  it('names every region holding the point, in scene order', () => {
    expect(regionsAt(regions, { x: 5, y: 1, z: 5 })).toEqual(['wood', 'pond']);
    expect(regionsAt(regions, { x: 1, y: 1, z: 1 })).toEqual(['wood']);
  });

  it('counts the box edges as inside and finds nothing outside on any axis', () => {
    expect(regionsAt(regions, { x: 10, y: 5, z: 10 })).toEqual(['wood']);
    for (const p of [
      { x: -0.1, y: 1, z: 1 },
      { x: 10.1, y: 1, z: 1 },
      { x: 1, y: -0.1, z: 1 },
      { x: 1, y: 5.1, z: 1 },
      { x: 1, y: 1, z: -0.1 },
      { x: 1, y: 1, z: 10.1 },
    ]) {
      expect(regionsAt(regions, p)).toEqual([]);
    }
  });
});
