import { describe, expect, it } from 'vitest';
import type { SceneDressing } from '@sim/index';
import {
  CHAIN_PLATE_X,
  CHAIN_PLATE_Y,
  CLIMB_MAST,
  HOLD_LADDER_FOOT,
  HOLD_LADDER_TOP,
  HULL_LADDER_FOOT,
  HULL_LADDER_TOP,
  LADDER_TOP,
  RIGGED_MODEL,
  climbLadder,
  hullLadders,
  ladder,
  loadRigging,
  mastRope,
  shrouds,
  stay,
} from './tern-rigging';

const mast = (id: string, z: number, fades = true): SceneDressing => ({
  id,
  model: RIGGED_MODEL,
  at: { x: 35, y: 2, z },
  yaw: 0,
  turn: 90,
  size: { x: 1, y: 14, z: 1 },
  fit: 'height',
  fadesNearCamera: fades,
  hides: undefined,
});
const hull: SceneDressing = {
  ...mast('tern-hull', 124),
  model: 'model-ship-gilded-tern-hull-01',
  at: { x: 35, y: -3.25, z: 124 },
  fadesNearCamera: false,
};

describe('Gilded Tern rigging (render only)', () => {
  it('a mast has three shrouds a side, each ending in a deadeye on the bulwark', () => {
    const segments = shrouds([35, 2, 124], 14);
    const deadeyes = segments.filter((s) => s.radius > 0.1);
    expect(deadeyes).toHaveLength(6);
    for (const d of deadeyes) {
      expect(Math.abs(d.a[0] - 35)).toBeCloseTo(CHAIN_PLATE_X);
      expect(d.a[1]).toBeCloseTo(CHAIN_PLATE_Y);
    }
  });

  it('the ratlines are evenly spaced: nine rungs between each pair of shrouds, both sides', () => {
    const rungs = shrouds([35, 2, 124], 14).filter((s) => s.radius === 0.05);
    expect(rungs).toHaveLength(9 * 2 * 2);
    const heights = rungs.slice(0, 9).map((r) => r.a[1]);
    const gaps = heights.slice(1).map((h, i) => h - (heights[i] ?? 0));
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] ?? 0, 5);
  });

  it('shrouds start above the deck and below the mast head', () => {
    for (const s of shrouds([35, 2, 124], 14)) {
      expect(s.a[1]).toBeGreaterThanOrEqual(CHAIN_PLATE_Y);
      expect(s.a[1]).toBeLessThan(2 + 14);
    }
  });

  it('a stay runs from the aft mast head to the foremast', () => {
    const s = stay([35, 2, 136], 13, [35, 2, 124], 14);
    expect(s.a[2]).toBe(136);
    expect(s.b[2]).toBe(124);
    expect(s.a[1]).toBeGreaterThan(s.b[1] - 3);
  });

  it('the climb ladder rises from the deck to the crow’s nest beside the board', () => {
    const segments = climbLadder([35, 2, 124]);
    const rails = segments.filter((s) => s.radius === 0.07);
    expect(rails).toHaveLength(2);
    expect(rails[0]?.b[1]).toBe(LADDER_TOP);
    expect(segments.length).toBeGreaterThan(10);
    expect(rails[0]?.a[0]).toBeCloseTo(38.05);
  });

  it('only the mainmast carries the ladder, and only a mast with one before it has a stay', () => {
    const plain = mastRope(mast('tern-foremast', 112), undefined);
    const main = mastRope(mast(CLIMB_MAST, 124), mast('tern-foremast', 112));
    expect(plain).toHaveLength(shrouds([35, 2, 112], 14).length);
    expect(main.length).toBe(
      shrouds([35, 2, 124], 14).length + 1 + climbLadder([35, 2, 124]).length,
    );
  });

  it('draws one rope mesh a mast, fading only where its mast does', () => {
    const meshes = loadRigging([
      mast('tern-mizzenmast', 136, false),
      mast('tern-foremast', 112),
      hull,
    ]);
    expect(meshes.map((m) => m.name)).toEqual([
      'rigging:tern-foremast',
      'rigging:tern-mizzenmast',
      'rigging:tern-hull-ladders',
    ]);
    // The foremast fades (its mesh has a fade hook of its own), the mizzenmast here does not.
    expect(Object.hasOwn(meshes[0] ?? {}, 'onBeforeRender')).toBe(true);
    expect(Object.hasOwn(meshes[1] ?? {}, 'onBeforeRender')).toBe(false);
    expect(meshes[0]?.geometry.getAttribute('color')).toBeDefined();
  });

  it('hangs a ladder of two rails and hemp rungs, wide along the axis it is asked for', () => {
    const across = (axis: 'x' | 'z') => ladder(10, 20, 0, 3, axis);
    for (const axis of ['x', 'z'] as const) {
      const segments = across(axis);
      const rails = segments.filter((s) => s.radius === 0.07);
      expect(rails).toHaveLength(2);
      expect(rails[0]?.a[1]).toBe(0);
      expect(rails[0]?.b[1]).toBe(3);
      expect(segments).toHaveLength(2 + 6);
    }
    const [west, east] = across('x').filter((s) => s.radius === 0.07);
    expect([west?.a[0], east?.a[0], west?.a[2]]).toEqual([9.7, 10.3, 20]);
    const [north, south] = across('z').filter((s) => s.radius === 0.07);
    expect([north?.a[2], south?.a[2], north?.a[0]]).toEqual([19.7, 20.3, 10]);
  });

  it('the hull carries a boarding ladder down to the pool and a ladder up out of the hold', () => {
    const segments = hullLadders(hull);
    const rails = segments.filter((s) => s.radius === 0.07);
    expect(rails).toHaveLength(4);
    expect(rails.map((r) => [r.a[1], r.b[1]])).toEqual([
      [HULL_LADDER_FOOT, HULL_LADDER_TOP],
      [HULL_LADDER_FOOT, HULL_LADDER_TOP],
      [HOLD_LADDER_FOOT, HOLD_LADDER_TOP],
      [HOLD_LADDER_FOOT, HOLD_LADDER_TOP],
    ]);
    expect(rails[0]?.a[0]).toBeCloseTo(29.75);
    expect(rails[2]?.a[2]).toBeCloseTo(129.25);
  });
});
