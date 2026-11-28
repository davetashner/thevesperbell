import { describe, expect, it } from 'vitest';
import { countsReturn, heapGrowth, median } from './leak';

// mw-e32.12 AC-3: the detector fails on a deliberately leaking fixture, so the e2e spec that uses
// it can be trusted to catch a leak, and passes on a steady one.

/** A cycle that leaks `perCycle` bytes each time on top of a noisy base. */
function cycles(count: number, perCycle: number, noise = 0): number[] {
  return Array.from(
    { length: count },
    (_, i) => 40e6 + i * perCycle + (i % 2 === 0 ? noise : -noise),
  );
}

describe('heapGrowth', () => {
  it('AC-3: fails a fixture that leaks 200 kB a cycle', () => {
    const verdict = heapGrowth(cycles(20, 200_000));
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('limit 5%');
  });

  it('passes a steady heap with +-1% noise', () => {
    expect(heapGrowth(cycles(20, 0, 400_000)).ok).toBe(true);
  });

  it('ignores a heap that is still warming up in the first cycles', () => {
    const heap = cycles(20, 0);
    heap[0] = 48e6;
    heap[1] = 50e6;
    heap[2] = 52e6;
    heap[3] = 53e6;
    expect(heapGrowth(heap).ok).toBe(true);
  });

  it('refuses too few cycles', () => {
    expect(() => heapGrowth([1, 2, 3])).toThrow(/at least 10/);
  });
});

describe('countsReturn', () => {
  it('AC-3: fails a fixture that leaks a geometry every cycle', () => {
    const geometries = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(countsReturn('geometries', geometries).ok).toBe(false);
  });

  it('passes counts that wobble within the tolerance, up or down', () => {
    const series = (first: number, last: number): number[] => [
      60,
      55,
      50,
      47,
      first,
      first,
      first,
      47,
      47,
      47,
      47,
      47,
      47,
      47,
      47,
      last,
      last,
      last,
    ];
    expect(countsReturn('textures', series(40, 42)).ok).toBe(true);
    expect(countsReturn('textures', series(40, 38)).ok).toBe(true);
    expect(countsReturn('textures', series(40, 37)).ok).toBe(false);
  });

  it('ignores warm-up cycles and a single unsettled sample', () => {
    // mw-e06.12: cycle 2 read 44 before the arrival props uploaded, the settled count is 47.
    const counts = [56, 44, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 50];
    expect(countsReturn('geometries', counts).ok).toBe(true);
  });

  it('refuses too few cycles', () => {
    expect(() => countsReturn('textures', [1, 2])).toThrow(/at least 10/);
  });
});
