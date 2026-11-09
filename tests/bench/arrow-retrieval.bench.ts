// mw-e05.7: keeping 64 arrows at rest (the cap) stays ≤ 0.2 ms per tick p95. Measured in Node as a
// whole World.step() with the arrow system and the retrieval rules attached: 64 resting arrows, half
// stuck in 20 moving bodies that shift every tick (so each of those arrows follows), the rest in the
// level, a player looking around (the view stand-in runs when the cap is hit, which the bench forces
// every tick by landing one more arrow than the cap and clearing the oldest). p95 is read from the
// retained samples, as in the other sim benches.
import { describe, expect, test } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addInteractor,
  ArrowRestComponent,
  ArrowRested,
  arrowLookup,
  BOW_COMPONENTS,
  CharacterController,
  DAMAGE_COMPONENTS,
  DamageModel,
  HIT_VOLUME_COMPONENTS,
  initialCharacterState,
  installArrowRetrieval,
  installArrows,
  installInteraction,
  PlacementComponent,
  placeEntity,
  PlayerLook,
  playerViewRule,
  registerWorldProperties,
  World,
  type EntityId,
} from '@sim/index';

const RESTING = 64;
const HOSTS = 20;

function buildWorld() {
  const arrows = arrowLookup(loadGameContent().all('arrow'));
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(
    PlacementComponent,
    CharacterController,
    PlayerLook,
    ...BOW_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
  );
  installInteraction(world);
  installArrows(world, { arrows, damage: new DamageModel() });
  installArrowRetrieval(world, { arrows, inView: playerViewRule() });
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player);
  const hosts: EntityId[] = [];
  for (let i = 0; i < HOSTS; i++) {
    const host = world.spawn();
    placeEntity(world, host, { x: (i % 5) * 3 - 6, y: 0, z: -10 - Math.floor(i / 5) * 3 }, 0.5);
    hosts.push(host);
  }
  let landed = 0;
  const land = (): void => {
    const n = landed++;
    const host = n % 2 === 0 ? (hosts[(n / 2) % HOSTS] ?? null) : null;
    const position = { x: (n % 17) - 8, y: 1, z: -(n % 23) - 2 };
    const entity = world.spawn();
    const at = host === null ? undefined : world.get(host, PlacementComponent);
    world.add(entity, ArrowRestComponent, {
      arrow: 'standard',
      shooter: null,
      state: 'stuck',
      position,
      direction: { x: 0, y: 0, z: -1 },
      in: host,
      tick: world.tick,
      intact: true,
      ...(at !== undefined && {
        local: { x: position.x - at.x, y: position.y - at.y, z: position.z - at.z },
      }),
    });
    world.events.emit(ArrowRested, {
      tick: world.tick,
      entity,
      arrow: 'standard',
      state: 'stuck',
      intact: true,
      in: host,
      position,
    });
  };
  for (let i = 0; i < RESTING; i++) land();
  world.step();
  let t = 0;
  /** One tick: the bodies move, one more arrow lands (over the cap), the world steps. */
  const tick = (): void => {
    t++;
    for (const host of hosts) {
      const at = world.get(host, PlacementComponent);
      if (at !== undefined)
        placeEntity(world, host, { x: at.x + 0.01, y: at.y, z: at.z }, at.radius);
    }
    land();
    world.step();
    if (t % 600 === 0) {
      for (const host of hosts) placeEntity(world, host, { x: 0, y: 0, z: -10 }, 0.5);
    }
  };
  return { tick, world };
}

describe('arrow retrieval', () => {
  test('64 resting arrows, 32 following moving bodies, a cap check every tick: ≤ 0.2 ms per tick p95', async ({
    bench,
  }) => {
    const { tick, world } = buildWorld();
    for (let i = 0; i < 2000; i++) tick();
    const result = await bench('arrow rest rules: 64 at rest, cap hit every tick', tick).run({
      warmupIterations: 1000,
      time: 1000,
      retainSamples: true,
    });
    const { samples } = result.latency;
    if (samples === undefined) throw new Error('bench samples were not retained');
    const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Infinity;
    console.info(
      `arrow retrieval: mean ${result.latency.mean.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms per tick over ${String(samples.length)} ticks`,
    );
    expect(world.query(ArrowRestComponent).ids().length).toBeLessThanOrEqual(RESTING + 2);
    expect(p95).toBeLessThanOrEqual(0.2); // milliseconds
  });
});
