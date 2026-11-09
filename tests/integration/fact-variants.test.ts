// mw-e27.8: fact-gated spawns and variant groups over the real variant-room scene, the game's scene
// loader, creatures, breakables and level deltas, headless. A fact flip brings a spawn in (waiting
// while it is on screen), a broken board stays broken across a despawn and a respawn, and after a
// save and reload (a fresh world with the saved facts and deltas) the matching variant is the one
// that loads.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { ndcInView, watchSpawnVariants } from '@game/scene/variants';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import {
  applyStimulus,
  CreatureComponent,
  levelDeltasOf,
  registerPersistence,
  sceneAuthoredEntities,
  sceneDormantEntities,
  SceneSpawnComponent,
  WorldPersistence,
  type EntityId,
  type Vec3,
} from '@sim/index';

const LEVEL = 'variant-room';
const content = loadGameContent();

function game(inView?: (position: Vec3) => boolean) {
  const g = createGameWorld<never>(RAPIER, { seed: 5, hz: 60, scene: LEVEL });
  registerPersistence(g.world);
  const store = levelDeltasOf(g.world);
  store.enter(
    g.world,
    new WorldPersistence(),
    LEVEL,
    sceneAuthoredEntities(g.world, g.scene),
    sceneDormantEntities(g.scene),
  );
  const errors: string[] = [];
  const variants =
    watchSpawnVariants({
      world: g.world,
      loader: g.scenes,
      content,
      creatures: g.creatures.spawn,
      ...(inView !== undefined && { inView }),
      onError: (line) => errors.push(line),
    }) ?? expect.fail('the scene has gated spawns');
  const flip = (key: string, value: boolean): void => {
    g.world.facts.set(key, value);
    g.world.step();
    variants.step();
  };
  const spawnEntity = (id: string): EntityId | undefined => {
    const found = g.scenes.entityOfSpawn(id);
    return found !== undefined && g.world.isAlive(found) ? found : undefined;
  };
  const miller = (): EntityId[] =>
    g.world
      .query(CreatureComponent)
      .ids()
      .filter((e) => g.world.get(e, CreatureComponent)?.origin.point === 'miller-rescued');
  return { g, store, variants, errors, flip, spawnEntity, miller };
}

describe('fact variants over a real scene (mw-e27.8)', () => {
  it('loads with the default variant and without the boards', () => {
    const { g, spawnEntity, miller } = game();
    expect(g.scene.layout.spawns.map((s) => s.id)).toEqual(['player-start', 'miller-missing']);
    expect(g.scene.authoredSpawns.map((s) => s.id)).toEqual([
      'player-start',
      'boards',
      'miller-rescued',
      'miller-missing',
    ]);
    expect(spawnEntity('boards')).toBeUndefined();
    expect(spawnEntity('miller-missing')).toBeDefined();
    expect(miller()).toEqual([]);
  });

  it('AC-1: a fact flip brings the boards in, and swaps the miller variants, out of view', () => {
    const { g, flip, spawnEntity, miller, errors } = game();
    flip('variants.cellar.sealed', true);
    const boards = spawnEntity('boards') ?? expect.fail('no boards');
    expect(g.world.get(boards, SceneSpawnComponent)?.id).toBe('boards');
    flip('variants.miller.rescued', true);
    expect(miller()).toHaveLength(1);
    expect(spawnEntity('miller-missing')).toBeUndefined();
    flip('variants.miller.rescued', false);
    expect(miller()).toEqual([]);
    expect(spawnEntity('miller-missing')).toBeDefined();
    expect(errors).toEqual([]);
  });

  it('AC-1: in view the swap waits, and happens once the spawn is out of view', () => {
    let visible = true;
    const { flip, variants, spawnEntity } = game(() => visible);
    flip('variants.cellar.sealed', true);
    expect(spawnEntity('boards')).toBeUndefined();
    expect(variants.pending()).toEqual(['boards']);
    visible = false;
    variants.step();
    expect(spawnEntity('boards')).toBeDefined();
  });

  it('AC-4: boards broken, taken away and brought back are still broken', () => {
    const { g, store, flip, spawnEntity } = game();
    flip('variants.cellar.sealed', true);
    const boards = spawnEntity('boards') ?? expect.fail('no boards');
    applyStimulus(g.world, {
      shape: { kind: 'contact', target: boards },
      element: 'blunt',
      intensity: 500,
    });
    for (let i = 0; i < 30; i++) g.world.step();
    expect(g.world.isAlive(boards)).toBe(false);
    flip('variants.cellar.sealed', false);
    expect(store.capture(g.world)[0]?.entities).toContainEqual({
      id: 'spawn:boards',
      destroyed: true,
    });
    flip('variants.cellar.sealed', true);
    // Back again, the delta applies: the board is gone from the new entity too.
    expect(spawnEntity('boards')).toBeUndefined();
    expect(store.capture(g.world)[0]?.entities).toContainEqual({
      id: 'spawn:boards',
      destroyed: true,
    });
  });

  it('AC-5: after save and reload the variant for the flipped fact is the active one', () => {
    const first = game();
    first.flip('variants.miller.rescued', true);
    first.flip('variants.cellar.sealed', true);
    const facts = first.g.world.facts.snapshot();
    const deltas = first.store.capture(first.g.world);

    // Reload: a fresh world with the saved facts and deltas, the scene loaded fresh from data.
    const second = createGameWorld<never>(RAPIER, { seed: 5, hz: 60, scene: 'testbed' });
    for (const [key, value] of Object.entries(facts)) second.world.facts.set(key, value);
    registerPersistence(second.world);
    const store = levelDeltasOf(second.world);
    store.restore(deltas);
    const loaded = second.scenes.load(LEVEL);
    expect(loaded.layout.spawns.map((s) => s.id)).toEqual([
      'player-start',
      'boards',
      'miller-rescued',
    ]);
    expect(sceneDormantEntities(loaded)).toEqual(['spawn:miller-missing']);
    store.enter(
      second.world,
      new WorldPersistence(),
      LEVEL,
      sceneAuthoredEntities(second.world, loaded),
      sceneDormantEntities(loaded),
    );
    expect(second.world.isAlive(second.scenes.entityOfSpawn('boards') ?? -1)).toBe(true);
  });

  it('unloading the scene removes what facts brought in', () => {
    const { g, flip, spawnEntity } = game();
    flip('variants.cellar.sealed', true);
    const boards = spawnEntity('boards') ?? expect.fail('no boards');
    g.scenes.unload();
    expect(g.world.isAlive(boards)).toBe(false);
    expect(g.scenes.entityOfSpawn('boards')).toBeUndefined();
  });

  it('refuses to add a spawn that is already there or with no scene loaded', () => {
    const { g } = game();
    const [present] = g.scene.layout.spawns;
    if (present === undefined) expect.fail('no spawn');
    expect(() => g.scenes.addSpawn(present)).toThrow('already in scene');
    expect(g.scenes.removeSpawn('nope')).toBe(false);
    g.scenes.unload();
    expect(() => g.scenes.addSpawn(present)).toThrow('no scene is loaded');
  });
});

describe('ndcInView', () => {
  it('is true on screen and a little past its edge, false far off or behind the camera', () => {
    expect(ndcInView({ x: 0, y: 0, z: 0.5 })).toBe(true);
    expect(ndcInView({ x: 1.1, y: -1.1, z: 0.9 })).toBe(true);
    expect(ndcInView({ x: 1.3, y: 0, z: 0.9 })).toBe(false);
    expect(ndcInView({ x: 0, y: 1.3, z: 0.9 })).toBe(false);
    expect(ndcInView({ x: 0, y: 0, z: 1.2 })).toBe(false);
    expect(ndcInView({ x: 1.3, y: 0, z: 0.9 }, 0.5)).toBe(true);
  });
});
