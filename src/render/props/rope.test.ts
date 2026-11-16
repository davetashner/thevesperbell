import { describe, expect, it } from 'vitest';
import { lerp, ratlines, ropeGeometry, type Segment } from './rope';

const left = [
  [0, 0, 0],
  [0, 10, 0],
] as const;
const right = [
  [1, 0, 0],
  [1, 10, 0],
] as const;

describe('rope (render only)', () => {
  it('lerp finds the point a fraction of the way along', () => {
    expect(lerp([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });

  it('ratlines are evenly spaced rungs between two ropes, inset by the margin', () => {
    const rungs = ratlines(left, right, 5, 0.1, 0.05, 0xffffff);
    expect(rungs).toHaveLength(5);
    for (const [i, y] of [1, 3, 5, 7, 9].entries()) {
      expect(rungs[i]?.a[1]).toBeCloseTo(y, 9);
    }
    for (const r of rungs) {
      expect(r.a[1]).toBe(r.b[1]);
      expect(r.a[0]).toBe(0);
      expect(r.b[0]).toBe(1);
    }
  });

  it('a single rung sits halfway', () => {
    const [rung] = ratlines(left, right, 1, 0.1, 0.05, 0xffffff);
    expect(rung?.a[1]).toBe(5);
  });

  it('builds one coloured geometry for all segments, bounded by the ropes', () => {
    const segments: Segment[] = [
      { a: [0, 0, 0], b: [0, 10, 0], radius: 0.1, colour: 0xff0000 },
      { a: [0, 5, 0], b: [4, 5, 0], radius: 0.1, colour: 0x00ff00 },
    ];
    const g = ropeGeometry(segments);
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    expect(g.boundingBox?.min.y).toBeCloseTo(0, 5);
    expect(g.boundingBox?.max.y).toBeCloseTo(10, 5);
    expect(g.boundingBox?.max.x).toBeCloseTo(4, 5);
  });
});
