// What puzzle prefabs (mw-e15.4) needed of the systemic layer, as scene data: push rules on a prop,
// liquid volumes with a drain, and a signal valve that opens the drain.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { at } from '../geom/vec';
import { LiquidVolumeComponent } from '../liquids/components';
import { installLiquids, levelOf } from '../liquids/volumes';
import { PushConfigComponent } from '../push/state';
import { registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { InMemoryColliderSink } from '../physics/static-colliders';
import type { KitLookup, SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { installSignals, setLever, signalSystem } from '../signals/runtime';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { addSceneMechanisms, type SceneMechanismsOptions } from './scene';
import { installMechanisms } from './system';

const kit: KitLookup = () => undefined;
const MATERIALS: MaterialPresets = new Map([
  ['water', { wetness: 1, liquid: true, density: 1000 }],
]);
const VALVE: SignalGraphDef = {
  id: 'valve',
  nodes: [
    { id: 'wheel', kind: 'lever', entity: 'valve' },
    { id: 'tap', kind: 'receiver', receiver: 'mechanism', entity: 'basin' },
    { id: 'dry-wheel', kind: 'lever', entity: 'dry-valve' },
    { id: 'dry-tap', kind: 'receiver', receiver: 'mechanism', entity: 'dry' },
  ],
  wires: [
    { from: 'wheel', to: 'tap' },
    { from: 'dry-wheel', to: 'dry-tap' },
  ],
};
const SCENE = {
  id: 'prefab-parts',
  grid: 1,
  placements: [],
  spawns: [
    {
      id: 'statue',
      at: [0, 0, 0],
      yaw: 0,
      tags: [],
      push: { axis: [0, 1], grid: 0.5, rotateStep: 90 },
    },
    { id: 'block', at: [3, 0, 0], yaw: 0, tags: [], push: { grid: 1 } },
    {
      id: 'basin',
      at: [0, 0, 5],
      yaw: 0,
      tags: [],
      liquid: {
        size: [2, 1, 3],
        liquid: { id: 'water' },
        depth: 0.5,
        drain: { rate: 0.25, open: false },
      },
    },
    { id: 'valve', at: [2, 0, 5], yaw: 0, tags: [], switch: { kind: 'lever' } },
    {
      id: 'dry',
      at: [8, 0, 5],
      yaw: 0,
      tags: [],
      liquid: { size: [2, 1, 2], liquid: { id: 'water' }, depth: 0.25 },
    },
    { id: 'dry-valve', at: [10, 0, 5], yaw: 0, tags: [], switch: { kind: 'lever', initial: 1 } },
  ],
  signals: [{ graph: { id: 'valve' }, bindings: {} }],
} as unknown as SceneSpec;
const OPTIONS: SceneMechanismsOptions = {
  doors: () => undefined,
  locks: () => undefined,
  graphs: (id) => (id === 'valve' ? VALVE : undefined),
  materials: MATERIALS,
};

function setup() {
  const world = installLiquids(
    installSignals(
      installStimuli(
        registerWorldProperties(registerSceneComponents(new World<never>({ seed: 4, hz: 60 }))),
      ),
    ),
  );
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  installMechanisms(world);
  const loaded = loadScene(world, SCENE, kit, new InMemoryColliderSink());
  return { world, loaded };
}

describe('scene data for puzzle prefabs (mw-e15.4)', () => {
  it('gives a prop its push rules: a rail, a grid, a rotation step', () => {
    const { world, loaded } = setup();
    addSceneMechanisms(world, loaded, OPTIONS);
    expect(world.get(at(loaded.spawns, 0).entity, PushConfigComponent)).toEqual({
      axis: [0, 1],
      grid: 0.5,
      rotateStep: 90,
      angle: 0,
    });
    expect(world.get(at(loaded.spawns, 1).entity, PushConfigComponent)).toEqual({
      axis: null,
      grid: 1,
      rotateStep: 0,
      angle: 0,
    });
  });

  it('makes a liquid spawn a volume standing on the spawn point, with its drain', () => {
    const { world, loaded } = setup();
    addSceneMechanisms(world, loaded, OPTIONS);
    const basin = at(loaded.spawns, 2).entity;
    const volume = world.get(basin, LiquidVolumeComponent);
    expect(volume?.min).toEqual({ x: -1, y: 0, z: 3.5 });
    expect(volume?.max).toEqual({ x: 1, y: 1, z: 6.5 });
    expect(volume?.drain).toEqual({ rate: 0.25, open: false });
    expect(levelOf(volume as never)).toBe(0.5);
    const dry = world.get(at(loaded.spawns, 4).entity, LiquidVolumeComponent);
    expect(dry?.drain).toBeUndefined();
  });

  it('needs the material presets to make a liquid', () => {
    const { world, loaded } = setup();
    expect(() => {
      addSceneMechanisms(world, loaded, { ...OPTIONS, materials: undefined as never });
    }).toThrow('liquid "basin" needs the material presets');
  });

  it('a signal into a mechanism receiver on a volume opens and closes its drain (the valve)', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    expect(made.switches).toHaveLength(2);
    const basin = at(loaded.spawns, 2).entity;
    const open = () => world.get(basin, LiquidVolumeComponent)?.drain?.open;
    const graph = at(made.graphs, 0);
    const settle = () => {
      world.step();
      world.step();
    };
    settle();
    expect(open()).toBe(false);
    setLever(world, graph, 'wheel', true);
    settle();
    expect(open()).toBe(true);
    setLever(world, graph, 'wheel', false);
    settle();
    expect(open()).toBe(false);
    // The dry basin's valve started on: a signal to a volume with no drain changes nothing.
    expect(world.get(at(loaded.spawns, 4).entity, LiquidVolumeComponent)?.drain).toBeUndefined();
  });
});
