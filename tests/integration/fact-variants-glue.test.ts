// mw-e27.8: the glue of fact-gated spawns, branch by branch, on the variant room headless. The whole
// flow over real facts is tests/integration/fact-variants.test.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '@content/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import {
  InteractableComponent,
  levelDeltasOf,
  registerPersistence,
  sceneAuthoredEntities,
  sceneDormantEntities,
  World,
  WorldPersistence,
  type SceneSpawnPlacement,
} from '@sim/index';
import { watchSpawnVariants, type SpawnLoader } from '@game/scene/variants';

const content = loadGameContent();

function game() {
  const g = createGameWorld<never>(RAPIER, { seed: 3, hz: 60, scene: 'variant-room' });
  const base = g.scene.authoredSpawns.find((s) => s.id === 'boards') ?? expect.fail('no boards');
  return { g, base };
}

/** A loader that adds bare entities, so the glue's own branches can be driven alone. */
function fakeLoader(g: ReturnType<typeof game>['g'], spawns: SceneSpawnPlacement[]) {
  const current = { ...g.scene, authoredSpawns: spawns, layout: { ...g.scene.layout, spawns: [] } };
  const loader: SpawnLoader = {
    current: current,
    addSpawn: () => g.world.spawn(),
    removeSpawn: () => true,
  };
  return loader;
}

/** The spawn without its gate. */
const ungated = (spawn: SceneSpawnPlacement): SceneSpawnPlacement =>
  Object.fromEntries(
    Object.entries(spawn).filter(([key]) => key !== 'gate'),
  ) as unknown as SceneSpawnPlacement;

const gated = (spawn: SceneSpawnPlacement, extra: Partial<SceneSpawnPlacement>) =>
  ({
    ...spawn,
    gate: { spawnIf: { fact: 'variants.cellar.sealed' } },
    ...extra,
  }) as SceneSpawnPlacement;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watchSpawnVariants glue (mw-e27.8)', () => {
  it('does nothing for a scene with no gated spawn or no scene', () => {
    const { g, base } = game();
    const loader = fakeLoader(g, [ungated(base)]);
    expect(watchSpawnVariants({ world: g.world, loader, content })).toBeUndefined();
    const none: SpawnLoader = { ...loader, current: undefined };
    expect(watchSpawnVariants({ world: g.world, loader: none, content })).toBeUndefined();
  });

  it('brings in an interactable spawn with no level loaded, with no view test', () => {
    const { g, base } = game();
    const spawn = gated(base, {
      interact: { affordances: [{ verb: 'talk', label: 'Talk' }] },
    });
    const watch = watchSpawnVariants({ world: g.world, loader: fakeLoader(g, [spawn]), content });
    g.world.facts.set('variants.cellar.sealed', true);
    g.world.step();
    expect(watch?.step()).toEqual(['boards']);
    g.world.step();
    const talkers = [...g.world.query(InteractableComponent).ids()];
    expect(talkers.length).toBeGreaterThan(0);
    g.world.facts.set('variants.cellar.sealed', false);
    g.world.step();
    expect(watch?.step()).toEqual(['boards']);
  });

  it('reports a creature that cannot be spawned, to the console by default', () => {
    const { g, base } = game();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spawn = gated(base, { creature: 'no-such-creature' });
    const loader = fakeLoader(g, [spawn]);
    registerPersistence(g.world);
    levelDeltasOf(g.world).enter(g.world, new WorldPersistence(), 'variant-room', []);
    const watch = watchSpawnVariants({
      world: g.world,
      loader,
      content,
      creatures: g.creatures.spawn,
    });
    g.world.facts.set('variants.cellar.sealed', true);
    g.world.step();
    watch?.step();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('variant spawn "boards"'));
  });

  it('with a level entered, a brought spawn joins the baseline and a taken one is retired', () => {
    const { g, base } = game();
    registerPersistence(g.world);
    const store = levelDeltasOf(g.world);
    store.enter(
      g.world,
      new WorldPersistence(),
      'variant-room',
      sceneAuthoredEntities(g.world, g.scene),
      sceneDormantEntities(g.scene),
    );
    const watch = watchSpawnVariants({
      world: g.world,
      loader: fakeLoader(g, [gated(base, {})]),
      content,
      onError: () => undefined,
    });
    g.world.facts.set('variants.cellar.sealed', true);
    g.world.step();
    expect(watch?.step()).toEqual(['boards']);
    g.world.facts.set('variants.cellar.sealed', false);
    g.world.step();
    expect(watch?.step()).toEqual(['boards']);
  });
});

describe('SceneLoader.addSpawn for a prop with only properties (mw-e27.8)', () => {
  it('gives it its properties and places it', () => {
    const { g, base } = game();
    const entity = g.scenes.addSpawn({
      ...ungated(base),
      id: 'lit',
      prop: undefined,
      properties: { hp: 10 },
    });
    expect(g.world.isAlive(entity)).toBe(true);
  });
});

describe('more glue branches (mw-e27.8)', () => {
  it('takes a spawn away in a world with no creatures installed', () => {
    const { g, base } = game();
    const world = new World<never>({ seed: 1 });
    const loader = { ...fakeLoader(g, [gated(base, {})]), addSpawn: () => world.spawn() };
    const watch = watchSpawnVariants({ world, loader, content });
    world.facts.set('variants.cellar.sealed', true);
    world.step();
    expect(watch?.step()).toEqual(['boards']);
    world.facts.set('variants.cellar.sealed', false);
    world.step();
    expect(watch?.step()).toEqual(['boards']);
  });

  it('unloading the scene copes with a live spawn that was destroyed meanwhile', () => {
    const { g, base } = game();
    const entity = g.scenes.addSpawn({ ...base, id: 'extra' });
    g.world.destroy(entity);
    g.world.step();
    g.scenes.unload();
    expect(g.scenes.entityOfSpawn('extra')).toBeUndefined();
  });
});
