import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  RapierPhysics,
  registerSceneComponents,
  setProperty,
  World,
  type EntityId,
  type LightEmitterView,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync } from '../loop/render-sync';
import { installGamePhysics } from '../physics-objects';
import { SceneLoader } from '../scene/scene-loader';
import {
  createGameLight,
  installGameLight,
  isFire,
  lightProbe,
  lightReadout,
  lightSpawns,
  lightTints,
  probeGrid,
  selectLights,
} from './index';

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The game's wiring (src/main.ts) with the lighting room loaded and stand-in render objects. */
function lightingRoom(scene = 'lighting-room') {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const light = createGameLight(physics);
  const world = registerSceneComponents(new World({ seed: 3, physics }));
  installGamePhysics(world, { levelColliders: light.colliders });
  installGameLight(world, light.field);
  const loader = new SceneLoader({
    world,
    sync: new RenderSync(world),
    colliders: light.colliders,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({
      object,
      read,
      apply: () => undefined,
      dispose: () => undefined,
    }),
    physics: {},
    light: light.field,
  });
  const loaded = loader.load(scene);
  world.step();
  const spawn = (id: string): EntityId =>
    loaded.spawns.find((s) => s.spawn.id === id)?.entity ?? -1;
  return { world, physics, field: light.field, colliders: light.colliders, loader, loaded, spawn };
}

describe('game light wiring (mw-e03.37)', () => {
  it('AC-2: loading a scene puts its ambient level and directional lights in the light field', () => {
    const { field } = lightingRoom();
    expect(field.environment.ambient).toBe(0.04);
    expect(field.environment.directional.map((d) => d.id)).toEqual(['moon']);
    // Moonlight falls through the north doorway onto the floor inside it…
    expect(
      field.sample(at(2, 0.05, 4)).contributions.some((c) => c.source.kind === 'directional'),
    ).toBe(true);
    // …but the wall beside the doorway shadows the floor behind it.
    expect(
      field.sample(at(-2, 0.05, 4)).contributions.some((c) => c.source.kind === 'directional'),
    ).toBe(false);
  });

  it('AC-2: its static geometry blocks light: nothing of the torches reaches outside the walls', () => {
    const { field, spawn } = lightingRoom();
    const torch = spawn('torch-west');
    expect(field.lights().map((l) => l.entity)).toContain(torch);
    const fromTorch = (p: Vec3): number =>
      field
        .sample(p)
        .contributions.filter((c) => c.source.kind === 'emitter' && c.source.entity === torch)
        .length;
    expect(fromTorch(at(-4, 1, -2))).toBe(1); // in the room
    expect(fromTorch(at(-6, 1, -2))).toBe(0); // just outside the west wall, within its reach
  });

  it('feeds the level to physics and light together, and unloading empties both', () => {
    const { physics, field, colliders, loader } = lightingRoom();
    expect(field.statics.count()).toBe(colliders.count());
    expect(physics.count()).toBeGreaterThan(colliders.count()); // plus the crate's body
    loader.unload();
    expect(field.statics.count()).toBe(0);
    expect(field.environment.directional).toEqual([]);
  });

  it('mw-e32.1: only light sources are watched, not other spawns with world properties', () => {
    const { loaded, field } = lightingRoom('perf-baseline');
    // 64 pushable crates set world properties too; only the eight lamps are light sources.
    expect(lightSpawns(loaded).map((s) => s.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `lamp-${String(i)}`),
    );
    expect(field.lights().length).toBe(8);
  });

  it('mw-ju8.43 AC-3: a light source may declare a colour tint, which the rig is given', () => {
    const { loaded, spawn } = lightingRoom('briar-glen-lane');
    const tints = lightTints(loaded);
    expect([...tints.keys()]).toEqual([spawn('lantern-riverbank-path')]);
    expect(tints.get(spawn('lantern-riverbank-path'))).toEqual([1, 0.82, 0.45]);
    expect(lightTints(lightingRoom().loaded).size).toBe(0); // no tint: flame or lamp colour
  });

  it('AC-3: a torch that stops burning goes out in the sim on the same tick', () => {
    const { world, field, loaded, spawn } = lightingRoom();
    const spawns = lightSpawns(loaded);
    expect(spawns.map((s) => s.id)).toEqual(['torch-west', 'torch-east', 'burning-crate']);
    const torch = spawn('torch-west');
    const rendered = new Map([[torch, 2.5]]);
    const before = lightReadout(world, field, spawns, rendered);
    expect(before.spawns['torch-west']).toEqual({ entity: torch, sim: 1, rendered: 2.5 });
    expect(before.spawns['torch-east']?.rendered).toBe(0);
    setProperty(world as World<never>, torch, 'burning', false);
    world.step();
    const after = lightReadout(world, field, spawns, new Map());
    expect(after.tick).toBe(before.tick + 1);
    expect(after.spawns['torch-west']?.sim).toBeLessThan(0.2);
    world.destroy(spawn('burning-crate'));
    expect(Object.keys(lightReadout(world, field, spawns, new Map()).spawns)).toEqual([
      'torch-west',
      'torch-east',
    ]);
  });

  it('tells fires from lamps', () => {
    const { world, field, spawn } = lightingRoom();
    const [first] = field.lights();
    if (first === undefined) throw new Error('the room is lit');
    expect(isFire(world, first)).toBe(true);
    setProperty(world as World<never>, spawn('torch-west'), 'burning', false);
    expect(isFire(world, first)).toBe(false);
    expect(isFire(world, { ...first, entity: null })).toBe(false);
  });
});

describe('light selection (mw-e03.37)', () => {
  const light = (x: number, radius: number, spot = false): LightEmitterView => ({
    source: { kind: 'emitter', entity: x },
    entity: x,
    position: at(x, 0, 0),
    radius,
    level: 1,
    cone: spot ? { direction: at(0, -1, 0), cosHalfAngle: 0.5 } : null,
  });

  it('keeps the lights whose reach is nearest the camera, capped per kind, ties in field order', () => {
    const lights = [
      light(40, 8),
      light(10, 8),
      light(20, 20),
      light(-10, 8),
      light(5, 4, true),
      light(30, 4, true),
    ];
    const chosen = selectLights(lights, at(0, 0, 0), { points: 3, spots: 1 });
    // The camera is inside the big light's reach; ±10 tie and keep the field's order.
    expect(chosen.points.map((l) => l.position.x)).toEqual([20, 10, -10]);
    expect(chosen.spots.map((l) => l.position.x)).toEqual([5]);
    expect(selectLights(lights, at(0, 0, 0), { points: 0, spots: 0 })).toEqual({
      points: [],
      spots: [],
    });
  });
});

describe('light probe (mw-e03.37 AC-1)', () => {
  it('lays points on 1 m cell centres inside the box', () => {
    expect(probeGrid(at(-1, -0.2, -1), at(1, 0, 0.5), 0.02)).toEqual([
      at(-0.5, 0.02, -0.5),
      at(0.5, 0.02, -0.5),
    ]);
    expect(probeGrid(at(-0.75, 0, 0), at(0.25, 1, 1), 0)).toEqual([at(-0.5, 1, 0.5)]);
    expect(probeGrid(at(0, 0, 0.75), at(1, 0, 2), 0)).toEqual([at(0.5, 0, 1.5)]);
  });

  it('keeps the visible, on-screen points with their sim level and screen position', () => {
    const { field } = lightingRoom();
    const points = [at(-4.5, 0.02, -2), at(6, 0.02, 4.5), at(0, 0.02, 0), at(1, 0.02, 1)];
    const samples = lightProbe(
      field,
      points,
      (p) => ({ x: p.x / 5, y: p.z / 5, z: p === points[2] ? 2 : 0.5 }),
      (p) => p !== points[3],
    );
    expect(samples.map((s) => s.at)).toEqual([points[0]]);
    expect(samples[0]?.ndc).toEqual({ x: -0.9, y: -0.4 });
    expect(samples[0]?.level).toBeGreaterThan(0.3);
  });
});
