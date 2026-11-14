import { describe, expect, it } from 'vitest';
import { ringGrowth, ringScale } from './rules.ts';

describe('spell ring growth (mw-e29.10)', () => {
  it('opens from the centre, eases out and never passes the radius', () => {
    expect(ringGrowth(0, 0.5)).toBe(0);
    expect(ringGrowth(0.25, 0.5)).toBeCloseTo(0.75);
    expect(ringGrowth(0.5, 0.5)).toBe(1);
    expect(ringGrowth(9, 0.5)).toBe(1);
    expect(ringGrowth(-1, 0.5)).toBe(0);
  });

  it('a ring with no grow time is at its full radius at once; reduced motion skips the growth', () => {
    expect(ringGrowth(0, 0)).toBe(1);
    expect(ringScale(0, 0.5, true)).toBe(1);
    expect(ringScale(0, 0.5, false)).toBeGreaterThan(0);
    expect(ringScale(1, 0.5, false)).toBe(1);
  });
});
