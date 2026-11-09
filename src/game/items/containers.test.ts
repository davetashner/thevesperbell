// Containers in the game (mw-e18.3): content's loot tables, items and locks behind the sim's
// containers, the testbed's supply chest, and the readout the e2e reads.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  addInventory,
  ContainerComponent,
  installInteraction,
  installMechanisms,
  LockComponent,
  RapierPhysics,
  registerSceneComponents,
  World,
  type LoadedScene,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync } from '../loop/render-sync';
import { installGamePhysics } from '../physics-objects';
import { SceneLoader } from '../scene/scene-loader';
import { ContainerWatch, hasContainers, prepareContainers, startContainers } from './containers';
import { prepareWorldItems } from './index';

const content = loadGameContent();

/** The testbed loaded headless, with interaction, mechanisms and an actor with an inventory. */
function testbed() {
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(registerSceneComponents(new World<never>({ seed: 5, physics })));
  installInteraction(world);
  installMechanisms(world);
  const loader = new SceneLoader({
    world,
    sync: new RenderSync(world),
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  });
  const loaded = loader.load('testbed');
  const containers = prepareContainers(content, prepareWorldItems(content).inventory);
  const actor = world.spawn();
  addInventory(world, actor);
  return { world, loaded, containers, actor };
}

describe('containers in the game (mw-e18.3)', () => {
  it('knows which scenes have containers', () => {
    const { loaded } = testbed();
    expect(hasContainers(loaded.layout)).toBe(true);
    const bare: LoadedScene = {
      ...loaded,
      layout: { ...loaded.layout, spawns: loaded.layout.spawns.filter((s) => !s.container) },
    };
    expect(hasContainers(bare.layout)).toBe(false);
  });

  it('places the testbed’s supply chest, which rolls content’s supply-crate table into the readout', () => {
    const { world, loaded, containers, actor } = testbed();
    const made = startContainers(world, containers, loaded, content);
    expect(made).toHaveLength(1);
    const [chest] = made as [number];
    expect(world.get(chest, ContainerComponent)).toEqual({
      loot: 'testbed-supply-crate',
      level: 'testbed',
      id: 'supply-chest',
    });
    expect(world.has(chest, LockComponent)).toBe(false);
    const watch = new ContainerWatch(world, made);
    expect(watch.readout()).toEqual({ 'supply-chest': { opened: false, items: [], gold: 0 } });

    containers.open(world, chest, actor);
    const opened = watch.readout()['supply-chest'];
    expect(opened?.opened).toBe(true);
    // The table always gives a healing draught, then one or two picks.
    expect(opened?.items[0]).toEqual({ item: 'healing-draught', count: 1 });
    expect(opened?.items.length).toBeGreaterThan(1);

    containers.takeAll(world, chest, actor);
    expect(watch.readout()).toEqual({ 'supply-chest': { opened: true, items: [], gold: 0 } });
  });

  it('names containers that are not scene spawns by entity, and leaves out what is gone', () => {
    const { world, loaded, containers, actor } = testbed();
    startContainers(world, containers, loaded, content);
    const crate = world.spawn();
    containers.make(world, crate, {
      level: 'testbed',
      id: 'crate',
      position: { x: 0, y: 0, z: 0 },
      contents: [{ item: 'lockpicks', count: 1 }],
    });
    const gone = world.spawn();
    const watch = new ContainerWatch(world, [crate, gone]);
    expect(watch.readout()).toEqual({
      [String(crate)]: { opened: false, items: [{ item: 'lockpicks', count: 1 }], gold: 0 },
    });
    expect(containers.open(world, crate, actor).ok).toBe(true);
  });
});
