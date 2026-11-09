// mw-e03.13: support budget. A level with 50 rope bridges (100 rated ropes, 600 planks, a crate
// resting on each) must not make the support system a cost: it runs every tick, weighing each span's
// load, and its mean must stay ≤ 1 ms on the Node baseline. A scene with no supports costs nothing
// (the system finds an empty query). Only the system is timed, not the physics around it.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, test } from 'vitest';
import {
  addPhysicsObject,
  addProperties,
  installMechanisms,
  installPhysicsObjects,
  installSignals,
  installStimuli,
  linkSpan,
  makeSupport,
  RapierPhysics,
  registerWorldProperties,
  supportsSystem,
  suspendFrom,
  World,
} from '@sim/index';

const v = (x: number, y: number, z: number) => ({ x, y, z });

function level(bridges: number) {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 1, hz: 60, physics }))),
  );
  installPhysicsObjects(world, { budget: 4000 });
  installMechanisms(world);
  for (let b = 0; b < bridges; b++) {
    const z = b * 3;
    const ropes: number[] = [-0.6, 0.6].map((side) => {
      const rope = world.spawn();
      makeSupport(world, rope, v(0, 1, z + side), v(6, 1, z + side), {
        rating: 150,
        resistances: { pierce: 0.3 },
      });
      return rope;
    });
    linkSpan(world, ropes);
    const [lead = 0] = ropes;
    world.step();
    const planks = Array.from({ length: 12 }, (_, i) => {
      const plank = world.spawn();
      addProperties(world, plank, { weight: 2 });
      addPhysicsObject(world, plank, {
        shape: { kind: 'box', halfExtents: v(0.23, 0.05, 0.6) },
        position: v(0.25 + i * 0.5, 1.05, z),
      });
      return plank;
    });
    const crate = world.spawn();
    addProperties(world, crate, { weight: 20 });
    addPhysicsObject(world, crate, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(3, 1.3, z),
    });
    world.step();
    for (const plank of planks) suspendFrom(world, plank, lead);
    world.step();
  }
  return world;
}

describe('supports', () => {
  test('50 loaded rope bridges: the support system averages ≤ 1 ms', async ({ bench }) => {
    const world = level(50);
    const system = supportsSystem<never>();
    const run = () => {
      system.run({ world } as never);
    };
    const result = await bench('supports, 50 bridges', run).run();
    expect(result.latency.mean).toBeLessThanOrEqual(1);
  });

  test('a world with no supports: the system averages ≤ 0.01 ms', async ({ bench }) => {
    const world = level(0);
    const system = supportsSystem<never>();
    const result = await bench('supports, none', () => {
      system.run({ world } as never);
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(0.01);
  });
});
