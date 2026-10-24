import { describe, expect, it } from 'vitest';
import {
  leftHandPoint,
  MINER_VARIANTS,
  pickVariant,
  randomSalt,
  rightHandPoint,
  variantFromSearch,
} from './variant';

describe('pickVariant', () => {
  it('AC-1: is stable for a salt and a key, and always in range', () => {
    for (let key = 0; key < 200; key++) {
      const first = pickVariant(12345, key);
      expect(pickVariant(12345, key)).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(MINER_VARIANTS);
    }
  });

  it('AC-1: covers every variant across keys, roughly evenly', () => {
    const counts = new Array<number>(MINER_VARIANTS).fill(0);
    for (let key = 0; key < 4000; key++) {
      const variant = pickVariant(0xdead_beef, key);
      counts[variant] = (counts[variant] ?? 0) + 1;
    }
    for (const count of counts) expect(count).toBeGreaterThan(800);
  });

  it('draws differently under different salts for the same miner', () => {
    const draws = new Set<number>();
    for (let salt = 1; salt <= 64; salt++) draws.add(pickVariant(salt, 7));
    expect(draws.size).toBe(MINER_VARIANTS);
  });

  it('honours another count', () => {
    for (let key = 0; key < 50; key++) expect(pickVariant(9, key, 2)).toBeLessThan(2);
  });
});

describe('randomSalt', () => {
  it('is a 32-bit unsigned integer', () => {
    const salt = randomSalt();
    expect(Number.isInteger(salt)).toBe(true);
    expect(salt).toBeGreaterThanOrEqual(0);
    expect(salt).toBeLessThan(2 ** 32);
  });
});

describe('variantFromSearch', () => {
  it('AC-2: ?miner=N pins the Nth look as a zero-based index', () => {
    expect(variantFromSearch('?scene=slice&miner=1')).toBe(0);
    expect(variantFromSearch('?miner=4')).toBe(3);
  });

  it('ignores a missing, out-of-range or non-numeric value', () => {
    for (const search of [
      '',
      '?scene=slice',
      '?miner=',
      '?miner=0',
      '?miner=5',
      '?miner=x',
      '?miner=1.5',
    ]) {
      expect(variantFromSearch(search)).toBeUndefined();
    }
  });
});

describe('rightHandPoint', () => {
  // A 2 m tall figure: a torso column, and a right arm reaching out to x = −0.6 at hand height.
  const points: number[] = [];
  const add = (x: number, y: number, z: number): void => {
    points.push(x, y, z);
  };
  add(0, 1.8, 0); // head, above the band
  add(0.1, 1.0, 0); // torso, left side
  add(-0.1, 1.0, 0); // torso, right side, not outermost
  add(-0.6, 0.9, 0.05); // fingertip: outermost
  add(-0.55, 0.95, -0.05); // wrist, within reach
  add(-0.3, 0.95, 0); // elbow, beyond reach of the outermost
  add(-0.9, 0.2, 0); // a foot out to the side, below the band

  it('finds the mean of the outermost right-side vertices in the hand band, inset toward the body', () => {
    const hand = rightHandPoint(points, 2);
    expect(hand).toBeDefined();
    expect(hand?.x).toBeCloseTo((-0.6 + -0.55) / 2 + 0.04, 6);
    expect(hand?.y).toBeCloseTo((0.9 + 0.95) / 2, 6);
    expect(hand?.z).toBeCloseTo(0, 6);
  });

  it('is undefined when nothing sits on the right side in the band', () => {
    expect(rightHandPoint([0.3, 1.0, 0, 0.5, 0.9, 0], 2)).toBeUndefined();
    expect(rightHandPoint([], 2)).toBeUndefined();
  });
});

describe('leftHandPoint', () => {
  it('AC-1: is the right-hand finder on the mirror image (a left arm out to x = +0.6)', () => {
    const points = [0, 1.8, 0, 0.1, 1.0, 0, 0.6, 0.9, 0.05, 0.55, 0.95, -0.05, 0.9, 0.2, 0];
    const hand = leftHandPoint(points, 2);
    expect(hand?.x).toBeCloseTo((0.6 + 0.55) / 2 - 0.04, 6);
    expect(hand?.y).toBeCloseTo((0.9 + 0.95) / 2, 6);
  });

  it('is undefined when nothing sits on the left side in the band', () => {
    expect(leftHandPoint([-0.3, 1.0, 0], 2)).toBeUndefined();
  });
});
