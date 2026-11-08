// Creature senses, noise and AI in the running game, headless (mw-e09.22, mw-e11.21, mw-e11.23):
// createGameWorld wires them as src/main.ts does — noise propagation through the loaded scene's sound
// graph, perception over the sim's Rapier sight world and the light field with the player as its
// target, awareness, and AI walking the scene's committed navmesh — on the debug-build content (the
// game's plus the frozen fixture creatures), with creatures spawned by the debug console's commands.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { markExercised } from '@content/testing';
import {
  AI_NOISE_KIND,
  brainOf,
  creatureEntities,
  emitNoise,
  entitySource,
  hashWorld,
  NavRouteComponent,
  NoiseListenerComponent,
  noiseHeard,
  perceived,
  placeEntity,
  PlacementComponent,
  spawnCommand,
  teleportCommand,
  type EntityId,
  type NoiseHeard,
  type Percept,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();

function game(scene: string, seed = 1) {
  return createGameWorld<unknown>(RAPIER, { seed, hz: 60, scene, content });
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1)
    throw new Error(`expected one, got ${String(items.length)}`);
  return item;
}

const at = (world: World, entity: EntityId) => {
  const place = world.get(entity, PlacementComponent);
  if (place === undefined) throw new Error(`entity ${String(entity)} has no placement`);
  return place;
};

describe('noise propagation at scene load (mw-e09.22)', () => {
  it('AC-1: in the mechanism room, a pot breaking in the west closet behind its shut door reaches a listener in the hall via west-doorway', ({
    task,
  }) => {
    markExercised(task, 'scene', 'mechanism-room');
    const { world, noise } = game('mechanism-room');
    expect(noise.propagation.graph.rooms.map((room) => room.id)).toContain('west-closet');
    const listener = world.spawn();
    placeEntity(world, listener, { x: 0, y: 1, z: -2 }, 0.4);
    world.add(listener, NoiseListenerComponent, { thresholdDb: 0, range: 40 });
    world.step();
    const heard: NoiseHeard[] = [];
    world.events.on(noiseHeard, (event) => {
      if (event.listener === listener) heard.push(event);
    });
    emitNoise(world, { position: { x: -6, y: 1, z: 0 }, loudness: 60, kind: 'pot' });
    world.events.flush();
    expect(only(heard)).toMatchObject({
      via: 'west-doorway',
      perceived: { x: -5, y: 1, z: 0 },
      occlusion: 20, // the shut wooden door's material
    });
  });

  it('a level change swaps the sound graph; unloaded, noises fall off with distance alone', () => {
    const { noise, scene } = game('mechanism-room');
    const rooms = noise.propagation.graph.rooms.map((room) => room.id);
    noise.unload();
    expect(noise.propagation.graph.rooms.map((room) => room.id)).toEqual(['outside']);
    noise.load(scene);
    expect(noise.propagation.graph.rooms.map((room) => room.id)).toEqual(rooms);
  });
});

describe('creature AI on the scene navmesh in the game loop (mw-e11.21)', () => {
  it('AC-1: a fixture guard patrolling across the arena doorway passes through it in 30 s and never leaves the navmesh', ({
    task,
  }) => {
    markExercised(task, 'navmesh', 'testbed');
    markExercised(task, 'behaviour', 'fixture-guard');
    const g = game('testbed');
    const { world, navigation, player } = g;
    const mesh = navigation.mesh;
    if (mesh === undefined) throw new Error('the testbed has a navmesh');
    // The player waits in the room's east corner, out of sight of the corridor.
    world.step([
      teleportCommand(player, { x: 4, y: 0, z: 2 }),
      spawnCommand('fixture-guard', 1, { x: 0, y: 0, z: 0 }, { patrol: '0,0,12;0,0,20' }),
    ]);
    const guard = only(creatureEntities(world));
    expect(brainOf(world, guard)?.behaviour).toBe('fixture-guard');
    const sides = new Set<'corridor' | 'arena'>();
    let crossings = 0;
    let side: 'corridor' | 'arena' = 'corridor';
    let offMesh = 0;
    for (let tick = 0; tick < 30 * 60; tick++) {
      world.step();
      g.aiWatch?.step();
      const feet = at(world, guard);
      if (mesh.locate(feet, 0.45, 0.45) < 0) offMesh++;
      const now = feet.z > 15 ? 'arena' : 'corridor';
      sides.add(now);
      if (now !== side) crossings++;
      side = now;
    }
    expect(brainOf(world, guard)?.state).toBe('unaware');
    expect(sides).toEqual(new Set(['corridor', 'arena']));
    expect(crossings).toBeGreaterThanOrEqual(2); // through the doorway and back
    expect(offMesh).toBe(0);
    expect(g.aiWatch?.readout()).toMatchObject({ navmesh: true, offMesh: 0 });
  });

  it('two runs with the same seed step to the same state hash (routes are plain data)', () => {
    const run = () => {
      const { world, player } = game('testbed', 3);
      world.step([
        teleportCommand(player, { x: 4, y: 0, z: 2 }),
        spawnCommand('fixture-guard', 2, { x: 0, y: 0, z: 0 }, { patrol: '0,0,12;0,0,20' }),
      ]);
      for (let tick = 0; tick < 600; tick++) world.step();
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });

  it('a scene without a navmesh walks in straight lines; unloading the navmesh drops every route', () => {
    const pen = game('creature-pen');
    expect(pen.navigation.mesh).toBeUndefined();
    expect(pen.navigation.navmesh).toBeUndefined();
    const { world, player, navigation } = game('testbed');
    world.step([
      teleportCommand(player, { x: 4, y: 0, z: 2 }),
      spawnCommand('fixture-guard', 1, { x: 0, y: 0, z: 0 }, { patrol: '0,0,12;0,0,20' }),
    ]);
    for (let tick = 0; tick < 240; tick++) world.step(); // its dwell at the first waypoint, then off
    expect(world.query(NavRouteComponent).ids()).toHaveLength(1);
    navigation.unload(world);
    expect(navigation.mesh).toBeUndefined();
    expect(world.query(NavRouteComponent).ids()).toEqual([]);
  });
});

describe('creature perception in the game loop (mw-e11.23)', () => {
  it('AC-1: a fixture guard spawned facing the lit player 10 m away perceives a seen-target percept for the player within 6 ticks', ({
    task,
  }) => {
    markExercised(task, 'creature', 'fixture-guard');
    markExercised(task, 'sense', 'humanoid');
    const g = game('testbed');
    const { world, player, ai } = g;
    if (ai === undefined) throw new Error('content has creatures, so AI is installed');
    const percepts: Percept[] = [];
    world.events.on(perceived, (report) => percepts.push(...report.percepts));
    // The player stands at (0, 0, −1); the guard spawns 10 m down the corridor, facing it.
    world.step([spawnCommand('fixture-guard', 1, { x: 0, y: 0, z: 9 })]);
    const guard = only(creatureEntities(world));
    expect(at(world, guard).z - at(world, player).z).toBeCloseTo(10, 1);
    for (let tick = 0; tick < 6; tick++) {
      world.step();
      expect(ai.perception.lastUnits).toBeLessThanOrEqual(ai.perception.unitsPerTick);
    }
    expect(percepts).toContainEqual(
      expect.objectContaining({ kind: 'seen-target', source: entitySource(player) }),
    );
    // Awareness turned it into what the brain reads.
    expect(brainOf(world, guard)?.awareness.length).toBeGreaterThan(0);
  });

  it('a guard engaging the player shouts through noise propagation, and a second guard hears it', () => {
    const { world } = game('testbed');
    world.step([spawnCommand('fixture-guard', 1, { x: 0, y: 0, z: 2 })]);
    const heard: NoiseHeard[] = [];
    world.events.on(noiseHeard, (event) => {
      if (event.noise.kind === AI_NOISE_KIND) heard.push(event);
    });
    world.step([spawnCommand('fixture-guard', 1, { x: -3, y: 0, z: 3 })]);
    for (let tick = 0; tick < 240 && heard.length === 0; tick++) world.step();
    // Either guard may shout first (the race is decided by entity order); the other one hears it.
    const guards = creatureEntities(world);
    const first = heard[0];
    expect(guards).toContain(first?.listener);
    expect(guards).toContain(first?.noise.source);
    expect(first?.listener).not.toBe(first?.noise.source);
  });
});
