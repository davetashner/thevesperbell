import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  ClimbRopeComponent,
  entitySource,
  aiPorts,
  FakeSightWorld,
  MINUTE_FACT,
  giveBrain,
  NavRouteComponent,
  placeEntity,
  placeRope,
  registerCreatureComponents,
  registerWorldProperties,
  retrieveRope,
  ROPE_ANCHOR_TAG,
  sceneRopeAnchors,
  straightLineNavigation,
  World,
  type EntityId,
} from '@sim/index';
import {
  AiWatch,
  formatPerceptionStats,
  installCreatureAi,
  playerTarget,
  sceneDoors,
  sceneNavMesh,
  SceneNavigation,
  watchCreatureAi,
  type CreatureAi,
} from './ai';

const content = loadGameContent();

function aiWorld(player?: EntityId): { world: World<never>; ai: CreatureAi } {
  const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
  const ai = installCreatureAi(world, new Map(), {
    content,
    player,
    light: { levelAt: () => 1 },
    sight: new FakeSightWorld(),
    navigation: straightLineNavigation,
  });
  return { world, ai };
}

describe('creature AI glue (mw-e11.21, mw-e11.23)', () => {
  it('installs perception and every behaviour in content; without a player, perception targets every character', () => {
    const { world, ai } = aiWorld();
    expect(ai.behaviours.has('forgotten')).toBe(true);
    expect(ai.perception.unitsPerTick).toBeGreaterThan(0);
    world.step();
    expect(ai.perception.lastUnits).toBe(0);
  });

  it('mw-8551: the AI reads the hour of the day from the game clock, none without one', () => {
    const { world } = aiWorld();
    const port = aiPorts(world).hourOfDay;
    expect(port?.(world)).toBeUndefined();
    world.facts.declare(MINUTE_FACT, { type: 'int', default: 13 * 60 + 30 });
    expect(port?.(world)).toBe(13.5);
    world.facts.set(MINUTE_FACT, 22 * 60);
    expect(port?.(world)).toBe(22);
  });

  it('awareness resolves only the player’s source to a target', () => {
    expect(playerTarget(7)(entitySource(7))).toBe(7);
    expect(playerTarget(7)(entitySource(8))).toBeUndefined();
    expect(playerTarget(undefined)(entitySource(7))).toBeUndefined();
  });

  it('finds the navmesh baked for a scene and the door spawns of a loaded scene', () => {
    expect(sceneNavMesh(content, 'testbed')?.doors).toEqual(['closet-door']);
    expect(sceneNavMesh(content, 'mechanism-room')).toBeUndefined();
    const door = { id: 'gate', door: { profile: 'wooden-door' } };
    const loaded = {
      spawns: [
        { entity: 3, spawn: door },
        { entity: 4, spawn: { id: 'start' } },
      ],
    } as unknown as Parameters<typeof sceneDoors>[0];
    expect([...sceneDoors(loaded)]).toEqual([['gate', 3]]);
  });

  it('watches thinking creatures: off-mesh agent-ticks, perception’s peak, and a readout for the e2e', () => {
    const { world, ai } = aiWorld();
    const navigation = new SceneNavigation();
    expect(watchCreatureAi(world, undefined, navigation)).toBeUndefined();
    const watch = watchCreatureAi(world, ai, navigation);
    expect(watch).toBeInstanceOf(AiWatch);
    if (watch === undefined) return;
    const miner = world.spawn();
    placeEntity(world, miner, { x: 100, y: 0, z: 100 }, 0.4);
    giveBrain(world, miner, { behaviour: 'forgotten' });
    // No navmesh: nothing is off it.
    watch.step();
    expect(watch.readout()).toMatchObject({
      navmesh: false,
      offMesh: 0,
      agents: [{ entity: miner, state: 'unaware', at: [100, 0, 100], onMesh: true }],
    });
    // On the testbed's navmesh, 100 m out is off it, once per step.
    const mesh = sceneNavMesh(content, 'testbed');
    if (mesh === undefined) throw new Error('the testbed has a navmesh');
    Object.defineProperty(navigation, 'mesh', { get: () => mesh });
    watch.step();
    watch.step();
    const readout = watch.readout();
    expect(readout).toMatchObject({ navmesh: true, offMesh: 2, agents: [{ onMesh: false }] });
    expect(formatPerceptionStats(readout)).toBe(
      `perception 0/${String(ai.perception.unitsPerTick)} units (peak 0) · 1 thinking`,
    );
  });

  it('travels in straight lines without a navmesh, and by navmesh paths with one', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
    const navigation = new SceneNavigation();
    const walker = world.spawn();
    placeEntity(world, walker, { x: 0, y: 0, z: -1 }, 0.4);
    expect(navigation.distance(world, walker, { x: 3, y: 0, z: 3 })).toBe(5);
    const step = { goal: { x: 3, y: 0, z: 3 }, within: 0.1, speed: 1, dt: 1 };
    expect(navigation.travel(world, walker, step)).toBe('running');
    // Rooted, a straight-line approach cannot get closer: out of reach (mw-e11.13).
    expect(navigation.approach(world, walker, { ...step, speed: 0 })).toBe('unreachable');
    const testbed = { id: 'testbed', spawns: [] } as unknown as Parameters<
      SceneNavigation['load']
    >[2];
    navigation.load(world, content, testbed);
    expect(navigation.navmesh).toBeDefined();
    // Room to arena: round the doorways, longer than the straight line.
    const arena = { x: 0, y: 0, z: 24 };
    expect(navigation.distance(world, walker, arena)).toBeGreaterThan(24);
    expect(navigation.travel(world, walker, { ...step, goal: arena })).toBe('running');
    expect(navigation.approach(world, walker, { ...step, goal: arena })).toBe('running');
  });

  it('follows the ropes that hang: a tied rope adds climb links to the mesh, untying takes them away (mw-e10.9)', () => {
    const world = registerWorldProperties(
      registerCreatureComponents(new World<never>({ seed: 1, hz: 60 })),
    );
    world.register(ClimbRopeComponent);
    const navigation = new SceneNavigation();
    // Without a navmesh there is nothing to sync.
    navigation.syncRopes(world);
    expect(navigation.mesh).toBeUndefined();
    const hook = world.spawn();
    const testbed = {
      id: 'testbed',
      spawns: [
        {
          entity: hook,
          spawn: { id: 'hook', position: { x: -2.2, y: 3, z: 4.5 }, tags: [ROPE_ANCHOR_TAG] },
        },
      ],
    } as unknown as Parameters<SceneNavigation['load']>[2];
    sceneRopeAnchors(world, testbed);
    navigation.load(world, content, testbed);
    const base = navigation.mesh;
    if (base === undefined) throw new Error('the testbed has a navmesh');
    const walker = world.spawn();
    placeEntity(world, walker, { x: 0, y: 0, z: -1 }, 0.4);
    navigation.travel(world, walker, {
      goal: { x: 0, y: 0, z: 10 },
      within: 0.1,
      speed: 1,
      dt: 1,
    });
    expect(world.has(walker, NavRouteComponent)).toBe(true);
    navigation.syncRopes(world);
    expect(navigation.mesh).toBe(base);
    expect(world.has(walker, NavRouteComponent)).toBe(true);

    expect(placeRope(world, hook, { length: 3, item: 'climbing-rope' }).ok).toBe(true);
    navigation.syncRopes(world);
    expect(navigation.mesh?.linkCount).toBe(base.linkCount + 2);
    // Routes planned on the old links are dropped, and an unchanged rope rebuilds nothing.
    expect(world.has(walker, NavRouteComponent)).toBe(false);
    const roped = navigation.mesh;
    navigation.syncRopes(world);
    expect(navigation.mesh).toBe(roped);

    retrieveRope(world, hook);
    navigation.syncRopes(world);
    expect(navigation.mesh?.linkCount).toBe(base.linkCount);
    navigation.unload(world);
    navigation.syncRopes(world);
    expect(navigation.mesh).toBeUndefined();
  });
});
