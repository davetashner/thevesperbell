import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  hashWorld,
  installDebugCommands,
  PhysicsObjectComponent,
  RapierPhysics,
  registerSceneComponents,
  World,
  type DebugCommand,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { RenderSync } from '@game/loop/render-sync';
import { installGamePhysics } from '@game/physics-objects';
import { SceneLoader } from '@game/scene/scene-loader';
import { describe, expect, it } from 'vitest';
import { AGITATOR_TAG, DEFAULT_AGITATOR_TUNING, SceneAgitator, sceneAgitator } from './agitator';

const at = (x: number, z: number) => ({ position: { x, y: 0, z }, tags: [AGITATOR_TAG] });

describe('stress scene agitator (mw-e32.1)', () => {
  it('only scenes with perf-agitator markers get one', () => {
    expect(
      sceneAgitator([{ position: { x: 0, y: 0, z: 0 }, tags: ['torch'] }], 60),
    ).toBeUndefined();
    const agitator = sceneAgitator([at(1, 2), { position: { x: 9, y: 9, z: 9 }, tags: [] }], 60);
    expect(agitator?.points).toEqual([{ x: 1, y: 0, z: 2 }]);
  });

  it('blasts at one marker at a time, round-robin, on a fixed tick period', () => {
    const agitator = new SceneAgitator(
      [at(0, 0).position, at(4, 0).position],
      60,
      DEFAULT_AGITATOR_TUNING,
    );
    const blasts = Array.from({ length: 61 }, (_, tick) => agitator.commandFor(tick));
    const fired = blasts.flatMap((command, tick) => (command === undefined ? [] : [tick]));
    expect(fired).toEqual([0, 15, 30, 45, 60]);
    expect(blasts[0]).toMatchObject({ op: 'blast', at: { x: 0, y: 0, z: 0 }, radius: 4 });
    expect(blasts[15]).toMatchObject({ at: { x: 4, y: 0, z: 0 }, intensity: 110 });
    expect(blasts[30]?.at).toEqual({ x: 0, y: 0, z: 0 });
    // A period shorter than a tick still blasts at most once a tick.
    const every = new SceneAgitator([at(0, 0).position], 60, {
      intervalS: 0.001,
      radius: 1,
      intensity: 1,
    });
    expect(every.commandFor(7)).toBeDefined();
    expect(new SceneAgitator([], 60).commandFor(0)).toBeUndefined();
  });

  it('keeps the perf-baseline scene’s 64 crates moving, inside the room, deterministically', () => {
    const run = () => {
      const content = loadGameContent();
      const physics = new RapierPhysics(RAPIER);
      const world = installGamePhysics(
        registerSceneComponents(new World<DebugCommand>({ seed: 1, hz: 60, physics })),
      );
      installDebugCommands(world, { spawners: new Map() });
      const loader = new SceneLoader({
        world,
        sync: new RenderSync(world),
        colliders: physics,
        content,
        objects: { staticGeometry: () => ({}), spawn: () => ({}) },
        binding: (object, read) => ({
          object,
          read,
          apply: () => undefined,
          dispose: () => undefined,
        }),
        physics: {},
      });
      const loaded = loader.load('perf-baseline');
      const agitator = sceneAgitator(loaded.layout.spawns, world.clock.hz);
      const crates: EntityId[] = loaded.spawns
        .filter(({ spawn }) => spawn.prop === 'crate')
        .map(({ entity }) => entity);
      const pose = (entity: EntityId): Vec3 =>
        world.get(entity, PhysicsObjectComponent)?.position ?? { x: NaN, y: NaN, z: NaN };
      const step = () => {
        const command = agitator?.commandFor(world.tick);
        world.step(command === undefined ? [] : [command]);
      };
      // 15 s in: long past the point where dropped props would have settled.
      for (let i = 0; i < 15 * 60; i++) step();
      const before = crates.map(pose);
      for (let i = 0; i < 60; i++) step();
      const after = crates.map(pose);
      return { world, crates, before, after };
    };
    const { world, crates, before, after } = run();
    expect(crates).toHaveLength(64);
    const moved = crates.filter((_, i) => {
      const nowhere = { x: NaN, y: NaN, z: NaN };
      const [a, b] = [before[i] ?? nowhere, after[i] ?? nowhere];
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 0.05;
    });
    expect(moved.length).toBeGreaterThanOrEqual(32); // at least half moved in the last second
    for (const { x, y, z } of after) {
      expect(Math.abs(x)).toBeLessThan(7);
      expect(Math.abs(z)).toBeLessThan(7);
      expect(y).toBeGreaterThan(0);
    }
    expect(hashWorld(run().world)).toBe(hashWorld(world));
  }, 30_000); // loads content and steps Rapier twice; overran the 5 s default on loaded runners
});
