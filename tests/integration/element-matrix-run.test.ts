// The long interaction matrix property run (mw-e03.26). The coverage run keeps to a small sample
// (src/sim/testing/element-matrix-arb.test.ts); the `interaction-matrix` CI job sets
// ELEMENT_MATRIX_WORLDS=500 and runs this file, and the nightly run sets many more worlds and a daily
// ELEMENT_MATRIX_SEED. A failure prints the seed and the shrunk world, and replays from them.
import { describe, expect, it } from 'vitest';
import { runMatrixProperty } from '@sim/testing/element-matrix-arb';

const WORLDS = Number(process.env['ELEMENT_MATRIX_WORLDS'] ?? 0);
const SEED = Number(process.env['ELEMENT_MATRIX_SEED'] ?? 20_260_609);

describe.skipIf(WORLDS === 0)('interaction matrix property run', () => {
  it(
    'AC-1: every invariant holds for the generated worlds of 300 ticks within 60 s (500 worlds, fixed seed, in CI)',
    () => {
      const started = Date.now();
      const outcome = runMatrixProperty({ seed: SEED, worlds: WORLDS });
      expect(outcome.report).toBeUndefined();
      expect(outcome.ok).toBe(true);
      expect(outcome.runs).toBe(WORLDS);
      // The 60 s budget applies to the 500-world PR run; the nightly run is allowed 100 ms a world.
      expect(Date.now() - started).toBeLessThan(Math.max(60_000, WORLDS * 100));
    },
    Math.max(120_000, WORLDS * 150),
  );
});
