import {
  CharacterController,
  DEBUG_SPAWN_TAG,
  installDebugCommands,
  PlayerLook,
  propSpawner,
  registerSceneComponents,
  SceneSpawnComponent,
  SceneTransformComponent,
  spawnCharacter,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameHost, SPAWN_DISTANCE, unboundDebugSpawns } from './host';

function world() {
  const w = registerSceneComponents(new World<never>({ seed: 9 }));
  installDebugCommands(w, { spawners: new Map() });
  w.register(CharacterController, PlayerLook);
  return w;
}

const options = (w: World<never>, player: () => number | undefined) => ({
  world: w,
  submit: () => undefined,
  player,
  spawnables: [],
  bookmarks: () => new Map(),
  scenes: [],
  loadScene: () => undefined,
  loop: { timeScale: 1 },
});

describe('createGameHost', () => {
  it('spawns SPAWN_DISTANCE in front of the player, along its look yaw', () => {
    const w = world();
    const hero = spawnCharacter(w, { x: 1, y: 0.5, z: 1 });
    w.add(hero, PlayerLook, { yaw: Math.PI / 2, pitch: 0 }); // facing −x
    const host = createGameHost(options(w, () => hero));
    expect(host.spawnPoint()).toEqual({ x: 1 - SPAWN_DISTANCE, y: 0.5, z: 1 });
    w.remove(hero, PlayerLook);
    expect(host.spawnPoint()).toEqual({ x: 1, y: 0.5, z: 1 - SPAWN_DISTANCE });
  });

  it('falls back to the origin without a player character', () => {
    const w = world();
    const bare = w.spawn();
    expect(createGameHost(options(w, () => undefined)).spawnPoint()).toEqual({ x: 0, y: 0, z: 0 });
    expect(createGameHost(options(w, () => bare)).spawnPoint()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('mw-e06.15: passes the spells and the selection hook through, or leaves them out', () => {
    const w = world();
    expect(createGameHost(options(w, () => undefined)).spells).toBeUndefined();
    expect(createGameHost(options(w, () => undefined)).selectSpell).toBeUndefined();
    const select = (id: string): boolean => id === 'ember';
    const host = createGameHost({
      ...options(w, () => undefined),
      spells: ['ember'],
      selectSpell: select,
    });
    expect(host.spells).toEqual(['ember']);
    expect(host.selectSpell).toBe(select);
  });

  it('mw-ju8.17: passes the item ids through, or leaves them out', () => {
    const w = world();
    expect(createGameHost(options(w, () => undefined)).items).toBeUndefined();
    const host = createGameHost({ ...options(w, () => undefined), items: ['scroll-of-ember'] });
    expect(host.items).toEqual(['scroll-of-ember']);
  });

  it('reads seed, liveness and cheats from the world', () => {
    const w = world();
    const hero = spawnCharacter(w, { x: 0, y: 0, z: 0 });
    const host = createGameHost(options(w, () => hero));
    expect(host.seed).toBe(9);
    expect(host.isAlive(hero)).toBe(true);
    expect(host.isAlive(99)).toBe(false);
    expect(host.cheat(hero, 'god')).toBe(false);
  });
});

describe('unboundDebugSpawns', () => {
  it('lists debug-spawned props without a render object, as spawn placements', () => {
    const w = world();
    const crate = propSpawner('crate')(w, { x: 2, y: 0, z: -1 }, {});
    const bound = propSpawner('plank')(w, { x: 0, y: 0, z: 0 }, {});
    const sceneProp = w.spawn();
    w.add(sceneProp, SceneTransformComponent, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    w.add(sceneProp, SceneSpawnComponent, { id: 'loose-crate', prop: 'crate', tags: [] });
    expect(unboundDebugSpawns(w, (id) => id === bound)).toEqual([
      {
        entity: crate,
        placement: {
          id: 'debug-spawn-crate',
          position: { x: 2, y: 0, z: -1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          yaw: 0,
          prop: 'crate',
          tags: [DEBUG_SPAWN_TAG],
        },
      },
    ]);
  });
});
