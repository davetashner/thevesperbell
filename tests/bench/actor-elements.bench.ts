// mw-e03.24: creatures are actors in the element rules, so heat exchange, freezing, soaking and
// recovery run over every creature each tick. Worst case here: 200 creatures walking about a room
// with the game's fire rules installed. The figure is what being an actor adds to a tick: the mean
// of timed World.step() calls with the 200 as actors minus the mean with the same 200 placed and
// moving but not actors (no creature component, so none is adopted). Budget: ≤ 0.5 ms per tick.
// Run with `pnpm bench`.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import { installGameFire } from '@game/fire';
import {
  CreatureComponent,
  placeEntity,
  registerWorldProperties,
  installStimuli,
  stimulusSystem,
  World,
  DAMAGE_COMPONENTS,
} from '@sim/index';

const CREATURES = 200;
const BUDGET_MS = 0.5;
const WARMUP_TICKS = 200;
const TIMED_TICKS = 1500;

function room(actors: boolean) {
  const content = loadGameContent();
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1, hz: 60 })));
  world.register(CreatureComponent, ...DAMAGE_COMPONENTS);
  world.addSystem(stimulusSystem());
  installGameFire(world, content);
  const entities = Array.from({ length: CREATURES }, () => {
    const entity = world.spawn();
    if (actors) {
      world.add(entity, CreatureComponent, {
        origin: {
          creature: 'forgotten-miner',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
        },
        behaviour: 'forgotten',
        tuning: {},
        needs: {},
      });
    }
    return entity;
  });
  const walk = (tick: number): void => {
    entities.forEach((entity, i) => {
      const a = i * 0.7 + tick * 0.01;
      placeEntity(
        world,
        entity,
        { x: 3 * Math.cos(a) + (i % 10), y: 0, z: 3 * Math.sin(a) + Math.floor(i / 10) },
        0.4,
      );
    });
  };
  return { world, walk };
}

function meanStep(actors: boolean): number {
  const { world, walk } = room(actors);
  let total = 0;
  for (let i = 0; i < WARMUP_TICKS + TIMED_TICKS; i++) {
    walk(i);
    const start = performance.now();
    world.step();
    if (i >= WARMUP_TICKS) total += performance.now() - start;
  }
  return total / TIMED_TICKS;
}

describe('actors in the element rules', () => {
  test('mw-e03.24: 200 walking creatures cost ≤ 0.5 ms per tick as actors', () => {
    meanStep(true); // JIT warm-up
    const without = meanStep(false);
    const withActors = meanStep(true);
    const added = withActors - without;
    console.info(
      `actors ×${String(CREATURES)}: ${without.toFixed(4)} ms without, ${withActors.toFixed(4)} ms with, +${added.toFixed(4)} ms per tick`,
    );
    expect(added).toBeLessThanOrEqual(BUDGET_MS);
  }, 120_000);
});
