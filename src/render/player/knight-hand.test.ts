// mw-a6t: which body-mesh vertices follow the knight's sword bone (the wrist).
import { describe, expect, it } from 'vitest';
import { KNIGHT_FIST_FLOOR, knightHandShare } from './knight-model';

describe('knightHandShare (mw-a6t)', () => {
  it('binds the fist wholly and blends out up the forearm', () => {
    expect(knightHandShare(0.45, 0.85, -0.07)).toBe(1);
    expect(knightHandShare(0.45, 0.94, -0.07)).toBeCloseTo(0.5);
    expect(knightHandShare(0.45, 1.0, -0.07)).toBe(0);
  });

  it('leaves out vertices off the grip axis', () => {
    expect(knightHandShare(0.3, 0.85, -0.07)).toBe(0);
    expect(knightHandShare(0.45, 0.85, 0.2)).toBe(0);
  });

  it('never binds the right boot, which lies in the same column below the fist', () => {
    // Real vertices of the boot's outer edge (model-char-knight-01, rig space).
    expect(knightHandShare(0.374, 0.027, -0.089)).toBe(0);
    expect(knightHandShare(0.365, 0.011, -0.148)).toBe(0);
    expect(knightHandShare(0.45, KNIGHT_FIST_FLOOR - 0.01, -0.07)).toBe(0);
    expect(knightHandShare(0.45, 0.75, -0.07)).toBe(1);
  });
});
