import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { WORLD_PROPERTY_KEYS, validateProperty } from '../properties/spec';
import {
  bagArb,
  entityArb,
  numberArb,
  runMatrixProperty,
  stimulusArb,
  valueArb,
  worldArb,
} from './element-matrix-arb';
import { buildWorld, MAX_FUEL } from './element-matrix';

// Property runs are CPU heavy: under a loaded coverage run they need more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

/** The fixed seed of the sample run: a red run replays from the report. */
const SEED = 20_260_609;
/** Worlds in the sample; the CI job runs 500 (tests/integration/element-matrix-run.test.ts). */
const WORLDS = 20;

describe('arbitraries', () => {
  it('draw valid values for every property in the schema', () => {
    for (const key of WORLD_PROPERTY_KEYS.filter((k) => k !== 'material')) {
      for (const value of fc.sample(valueArb(key), { seed: 1, numRuns: 20 })) {
        expect(validateProperty(key, value)).toBeUndefined();
      }
    }
    expect(() => valueArb('nope')).toThrow(/unknown world property/);
  });

  it('draw integers for integer ranges and keep fuel bounded', () => {
    for (const n of fc.sample(numberArb({ min: 0, max: 5000, integer: true, unit: '' }), 30)) {
      expect(Number.isInteger(n)).toBe(true);
    }
    for (const bag of fc.sample(bagArb(), { seed: 2, numRuns: 100 })) {
      expect(Number(bag['fuel'] ?? 0)).toBeLessThanOrEqual(MAX_FUEL);
      expect(bag).not.toHaveProperty('material');
    }
  });

  it('draw worlds that build, with stimuli inside the program window', () => {
    for (const spec of fc.sample(worldArb(100), { seed: 3, numRuns: 40 })) {
      expect(() => buildWorld(spec)).not.toThrow();
      for (const step of spec.program) expect(step.tick).toBeLessThanOrEqual(100);
    }
    const [entity] = fc.sample(entityArb(1), { seed: 4, numRuns: 1 });
    expect(entity?.material === undefined || entity.material === 0).toBe(true);
    const steps = fc.sample(stimulusArb(10), { seed: 5, numRuns: 200 });
    expect(steps.some((s) => s.element === 'gas' && s.gas !== undefined)).toBe(true);
    expect(steps.some((s) => s.element === 'force' && s.maxWeight !== undefined)).toBe(true);
    expect(steps.every((s) => s.element === 'gas' || s.gas === undefined)).toBe(true);
  });
});

describe('the property run', () => {
  it('AC-1: every invariant holds for a fixed-seed sample of worlds of 300 ticks', () => {
    const outcome = runMatrixProperty({ seed: SEED, worlds: WORLDS });
    expect(outcome.report).toBeUndefined();
    expect(outcome.ok).toBe(true);
    expect(outcome.runs).toBe(WORLDS);
    expect(outcome.seed).toBe(SEED);
  });

  it('AC-2: an injected bug (burning allowed while frozen) fails with a shrunk world and the seed', () => {
    const outcome = runMatrixProperty({
      seed: 7,
      worlds: 200,
      ticks: 20,
      settleTicks: 0,
      bug: 'burn-while-frozen',
    });
    expect(outcome.ok).toBe(false);
    const world = outcome.counterexample;
    // Shrunk: no program, and a frozen object (its own bag or its material's) is all it
    // takes; the counterexample is a handful of objects at most, not the eight that were generated.
    expect(world?.program).toEqual([]);
    expect(world?.entities.length).toBeLessThanOrEqual(2);
    const frozen = [...(world?.entities ?? []), ...(world?.materials ?? [])].some(
      (item) => ('bag' in item ? item.bag : item.preset)['frozen'] === true,
    );
    expect(frozen).toBe(true);
    expect(outcome.violations?.[0]?.message).toMatch(/burning-while-frozen/);
    expect(outcome.report).toContain('seed 7');
    expect(outcome.report).toContain('Minimal world: {');
    expect(outcome.report).toContain('burning-while-frozen');
    expect(outcome.report).toContain('Replay: runMatrixProperty({ seed: 7, worlds: 200 })');
  });
});
