// mw-e09.5: footstep noise with a crowd. 100 creatures walk a street at 1.5 m/s (a step every 0.5 s,
// so about 200 footsteps a second), each a noise listener with the Forgotten's hearing (45 dB, 20 m).
// Every step is emitted and propagated to the listeners in range, and the creature steps system runs
// every tick; one world tick, all of it, is measured: p95 ≤ 0.5 ms. (Perception then drops creatures'
// footsteps for creatures, so nothing else follows from them.)
import {
  buildSoundGraph,
  CREATURE_COMPONENTS,
  CreatureComponent,
  DEFAULT_NOISE_TUNING,
  installFootstepNoise,
  installNoisePropagation,
  noiseEmitted,
  NoiseListenerComponent,
  PlacementComponent,
  placeEntity,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, test } from 'vitest';

const CREATURES = 100;
const HZ = 60;
const SPEED = 1.5;

const world = new World<never>({ seed: 2, hz: HZ });
world.register(...CREATURE_COMPONENTS, PlacementComponent);
installNoisePropagation(world, { graph: buildSoundGraph({ rooms: [], portals: [] }) });
installFootstepNoise(world, {
  tuning: DEFAULT_NOISE_TUNING.footsteps,
  creatureSurface: () => ({
    material: 'stone',
    wet: false,
    frozen: false,
    burning: false,
    surfaceDb: 0,
  }),
});
const walkers: EntityId[] = [];
for (let i = 0; i < CREATURES; i++) {
  const entity = world.spawn();
  world.add(entity, CreatureComponent, {
    origin: { creature: 'x', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
    behaviour: 'b',
    tuning: {},
    needs: {},
  });
  // A street 100 m long and 10 m wide: neighbours are close enough to hear each other.
  placeEntity(world, entity, { x: (i * 1) % 100, y: 0, z: (i % 10) * 1 }, 0.4);
  world.add(entity, NoiseListenerComponent, { thresholdDb: 45, range: 20 });
  walkers.push(entity);
}
world.addSystem({
  name: 'walkers',
  run: ({ world: sim }) => {
    for (const entity of walkers) {
      const at = sim.get(entity, PlacementComponent);
      if (at !== undefined)
        sim.set(entity, PlacementComponent, { ...at, x: (at.x + SPEED / HZ) % 100 });
    }
  },
});

/** The 95th percentile of `samples` (nearest rank). */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Infinity;
}

describe('footstep noise', () => {
  test('100 walking creatures with 100 listeners tick in ≤ 0.5 ms p95', async ({ bench }) => {
    let steps = 0;
    world.events.on(noiseEmitted, () => {
      steps++;
    });
    for (let i = 0; i < 300; i++) world.step();
    const result = await bench('footsteps: 100 walkers, 100 listeners', () => {
      world.step();
    }).run({ warmupIterations: 200, time: 1000, retainSamples: true });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const budget = p95(samples);
    console.info(
      `footsteps: mean ${result.latency.mean.toFixed(4)} ms, p95 ${budget.toFixed(4)} ms per tick (${String(steps)} steps)`,
    );
    expect(budget).toBeLessThanOrEqual(0.5);
  });
});
