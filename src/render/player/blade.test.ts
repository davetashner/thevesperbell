import { describe, expect, it } from 'vitest';
import { readBlade, segmentGap } from './blade';

describe('readBlade (mw-a6t)', () => {
  const leg = [
    [0.15, 0.9, 0],
    [0.18, 0.48, 0],
    [0.26, 0.04, 0],
  ] as const;

  it('reads a hanging blade as 0° off vertical, touching nothing but the leg beside it', () => {
    const r = readBlade([0.4, 0.8, 0], [0.4, 0, 0], leg);
    expect(r.offVertical).toBeCloseTo(0, 6);
    expect(r.tipY).toBe(0);
    expect(r.legGap).toBeCloseTo(0.14, 1);
  });

  it('reads a level blade as 90° and an upward one past it', () => {
    expect(readBlade([0.4, 0.8, 0], [1.2, 0.8, 0], leg).offVertical).toBeCloseTo(90, 6);
    expect(readBlade([0.4, 0.8, 0], [0.4, 1.4, 0], leg).offVertical).toBeCloseTo(180, 6);
  });

  it('measures the gap to the leg of a blade swung out, and 0 where it crosses', () => {
    const out = readBlade([0.4, 0.8, 0], [1.0, 0.4, -0.3], leg);
    expect(out.offVertical).toBeGreaterThan(40);
    expect(out.legGap).toBeGreaterThan(0.2);
    expect(readBlade([0.4, 0.5, 0], [0, 0.5, 0], leg).legGap).toBeLessThan(0.01);
  });

  it('clamps the closest point to a segment end', () => {
    expect(segmentGap([0, 0, 0], [0, 1, 0], [1, 2, 0], [1, 3, 0])).toBeCloseTo(Math.hypot(1, 1), 6);
  });
});
