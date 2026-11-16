import { describe, expect, it } from 'vitest';
import { readBlade, segmentGap } from './blade';

describe('readBlade (mw-a6t)', () => {
  const leg = [
    [0.15, 0.9, 0],
    [0.18, 0.48, 0],
    [0.26, 0.04, 0],
  ] as const;
  // A forearm hanging straight down from the elbow.
  const down = [
    [0.4, 1.2, 0],
    [0.4, 0.92, 0],
  ] as const;

  it('reads a hanging blade as 0° off vertical and in line with the forearm', () => {
    const r = readBlade([0.4, 0.8, 0], [0.4, 0, 0], leg, down);
    expect(r.offVertical).toBeCloseTo(0, 6);
    expect(r.forearmAngle).toBeCloseTo(0, 6);
    expect(r.tipForward).toBeCloseTo(0, 6);
    expect(r.tipY).toBe(0);
    expect(r.legGap).toBeCloseTo(0.14, 1);
  });

  it('reads a blade held across the fist: 90° to the forearm, the tip in front of the grip', () => {
    // Facing −z: the blade runs from the grip forward (−z), level.
    const r = readBlade([0.4, 0.8, 0], [0.4, 0.8, -0.85], leg, down);
    expect(r.offVertical).toBeCloseTo(90, 6);
    expect(r.forearmAngle).toBeCloseTo(90, 6);
    expect(r.tipForward).toBeCloseTo(0.85, 6);
    expect(readBlade([0.4, 0.8, 0], [0.4, 0.8, 0.5], leg, down).tipForward).toBeCloseTo(-0.5, 6);
  });

  it('reads a blade pointing up as past 90° off vertical', () => {
    expect(readBlade([0.4, 0.8, 0], [0.4, 1.4, 0], leg, down).offVertical).toBeCloseTo(180, 6);
  });

  it('measures the gap to the leg, and about 0 where the blade crosses it', () => {
    const out = readBlade([0.4, 0.8, 0], [1.0, 0.4, -0.3], leg, down);
    expect(out.legGap).toBeGreaterThan(0.2);
    expect(readBlade([0.4, 0.5, 0], [0, 0.5, 0], leg, down).legGap).toBeLessThan(0.01);
  });

  it('clamps the closest point to a segment end', () => {
    expect(segmentGap([0, 0, 0], [0, 1, 0], [1, 2, 0], [1, 3, 0])).toBeCloseTo(Math.hypot(1, 1), 6);
  });
});
