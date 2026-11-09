// mw-e02.8 AC-2, the sim half: character controller cost per sim tick over 60 s of scripted
// traversal. The e2e budget (e2e/perf/latency.perf.ts, `pnpm perf:ref`, by hand on the reference
// machine) times the same system inside the real game; this bench times it in Node on the sim's
// Rapier physics every night, so a regression in the controller shows without anyone running the
// reference machine. The traversal is the greybox course of mw-e02.2 (steps, ramp, ledge, jump,
// moving platform) driven by its input log, replayed in fresh worlds until 60 s of ticks are timed
// after one untimed warm-up lap (JIT tier-up). Only the character controller system's run is timed,
// through its `measure` hook; the Rapier world step is not. Budget: p95 ≤ 0.3 ms per tick, the
// reference machine's limit and a ceiling on any CI runner (the controller costs a few hundredths of
// a millisecond on the M1 Pro), like the other sim benches. Run with `pnpm bench`.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import {
  CharacterController,
  characterControllerSystem,
  RapierCollisionWorld,
  RapierPhysics,
  spawnCharacter,
  World,
  type CharacterInput,
} from '@sim/index';
import {
  playerTuning,
  TRAVERSAL_COURSE as COURSE,
  TRAVERSAL_LOG as LOG,
} from '@tools/replay/character-scenarios';

const BUDGET_MS = 0.3;
const SECONDS = 60;
const HZ = 60;

/** One lap of the course in a fresh world; `record` gets each controller run's wall time, ms. */
function lap(record: (ms: number) => void): void {
  const physics = new RapierPhysics(RAPIER);
  for (const shape of COURSE) physics.add(shape);
  const world = new World<CharacterInput>({ seed: 2, hz: HZ, physics }).register(
    CharacterController,
  );
  world.addSystem(
    characterControllerSystem({
      collision: new RapierCollisionWorld(physics),
      tuning: playerTuning(),
      input: (inputs) => inputs[0],
      measure: (run) => {
        const start = performance.now();
        run();
        record(performance.now() - start);
      },
    }),
  );
  spawnCharacter(world, { x: 0, y: 0, z: 0 });
  for (const input of LOG) world.step([input]);
}

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

describe('character controller cost', () => {
  test('AC-2: 60 s of scripted traversal costs the controller ≤ 0.3 ms per tick p95', () => {
    lap(() => undefined); // warm-up, untimed
    const samples: number[] = [];
    while (samples.length < SECONDS * HZ) lap((ms) => samples.push(ms));
    const tickP95 = p95(samples);
    console.info(
      `character controller: p95 ${tickP95.toFixed(4)} ms per tick over ${String(samples.length)} ticks of the traversal course`,
    );
    expect(samples.length).toBeGreaterThanOrEqual(SECONDS * HZ);
    expect(tickP95).toBeLessThanOrEqual(BUDGET_MS); // milliseconds
  });
});
