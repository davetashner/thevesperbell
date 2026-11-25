// Door interlocks and the fill valve (mw-e25.14): the gates of a canal lock follow the chamber's
// measured water, and a signal keyed `fill` works a volume's sluice. Built from scene data like the
// puzzle prefabs, so the same path the game loads is the one under test.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { at } from '../geom/vec';
import { LiquidVolumeComponent } from '../liquids/components';
import { installLiquids, totalDepth } from '../liquids/volumes';
import { liquidRules } from '../liquids/rules';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import { registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { InMemoryColliderSink } from '../physics/static-colliders';
import type { KitLookup, SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { installSignals, setLever, signalSystem } from '../signals/runtime';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { DoorComponent, type DoorProfile } from './components';
import { mechanismJammed, type MechanismJammed } from './events';
import { InterlockComponent, interlockAllows, makeInterlock } from './interlocks';
import { addSceneMechanisms, type SceneMechanismsOptions } from './scene';
import { doorState, installMechanisms, moveDoor } from './system';

const kit: KitLookup = () => undefined;
const MATERIALS: MaterialPresets = new Map([
  ['water', { wetness: 1, liquid: true, density: 1000 }],
]);
const GATE: DoorProfile = {
  id: 'gate',
  kind: 'hinged',
  size: { x: 2, y: 2, z: 0.2 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: false, gas: false, sound: false },
  loudness: 0,
};
const PADDLES: SignalGraphDef = {
  id: 'paddles',
  nodes: [
    { id: 'head', kind: 'lever', entity: 'head-paddle' },
    { id: 'tail', kind: 'lever', entity: 'tail-paddle' },
    { id: 'sluice', kind: 'receiver', receiver: 'mechanism', entity: 'chamber', key: 'fill' },
    { id: 'drain', kind: 'receiver', receiver: 'mechanism', entity: 'chamber' },
    { id: 'fill-dry', kind: 'receiver', receiver: 'mechanism', entity: 'dry', key: 'fill' },
  ],
  wires: [
    { from: 'head', to: 'sluice' },
    { from: 'head', to: 'fill-dry' },
    { from: 'tail', to: 'drain' },
  ],
};
const door = (id: string, interlock: object) => ({
  id,
  at: [0, 0, 0],
  yaw: 0,
  tags: [],
  door: { profile: { id: 'gate' }, interlock },
});
const SCENE = {
  id: 'lock-parts',
  grid: 1,
  placements: [],
  spawns: [
    {
      id: 'chamber',
      at: [0, 0, 5],
      yaw: 0,
      tags: [],
      liquid: {
        size: [2, 1.8, 3],
        liquid: { id: 'water' },
        depth: 1.8,
        drain: { rate: 0.5, open: false },
        fill: { rate: 0.5, open: false },
      },
    },
    {
      id: 'dry',
      at: [8, 0, 5],
      yaw: 0,
      tags: [],
      liquid: { size: [2, 1, 2], liquid: { id: 'water' }, depth: 0.25 },
    },
    door('upper-gate', { volume: 'chamber', minDepth: 1.5 }),
    door('lower-gate', { volume: 'chamber', maxDepth: 0.2 }),
    { id: 'head-paddle', at: [2, 0, 5], yaw: 0, tags: [], switch: { kind: 'lever' } },
    { id: 'tail-paddle', at: [3, 0, 5], yaw: 0, tags: [], switch: { kind: 'lever' } },
    { id: 'plain-door', at: [5, 0, 0], yaw: 0, tags: [], door: { profile: { id: 'gate' } } },
  ],
  signals: [{ graph: { id: 'paddles' }, bindings: {} }],
} as unknown as SceneSpec;
const OPTIONS: SceneMechanismsOptions = {
  doors: (id) => (id === 'gate' ? GATE : undefined),
  locks: () => undefined,
  graphs: (id) => (id === 'paddles' ? PADDLES : undefined),
  materials: MATERIALS,
};

function setup() {
  const world = installLiquids(
    installSignals(
      installElementField(
        installStimuli(
          registerWorldProperties(registerSceneComponents(new World<never>({ seed: 4, hz: 60 }))),
        ),
        { maxChunks: 8 },
      ),
    ),
  );
  world
    .addSystem(stimulusSystem())
    .addSystem(signalSystem())
    .addSystem(elementRulesSystem(new ElementRuleSet(liquidRules({ presets: MATERIALS }))))
    .addSystem(elementFieldSystem());
  installMechanisms(world);
  const loaded = loadScene(world, SCENE, kit, new InMemoryColliderSink());
  const made = addSceneMechanisms(world, loaded, OPTIONS);
  const entity = (id: string) => {
    const found = loaded.spawns.find((s) => s.spawn.id === id)?.entity;
    if (found === undefined) throw new Error(`no spawn ${id}`);
    return found;
  };
  const jams: MechanismJammed[] = [];
  world.events.on(mechanismJammed, (e) => jams.push(e));
  return { world, loaded, made, entity, jams };
}

describe('door interlocks (mw-e25.14)', () => {
  it('jams a closed gate while the chamber is outside its window, and the attempt strains', () => {
    const { world, entity, jams } = setup();
    world.step();
    expect(totalDepth(world.get(entity('chamber'), LiquidVolumeComponent) as never)).toBeCloseTo(
      1.8,
      5,
    );
    // Full: the upper gate is free, the lower one is held shut by the water.
    expect(world.get(entity('upper-gate'), DoorComponent)?.jammed).toBe(false);
    expect(world.get(entity('lower-gate'), DoorComponent)?.jammed).toBe(true);
    expect(moveDoor(world, entity('lower-gate'), 1)).toBe(false);
    world.step();
    expect(jams).toHaveLength(1);
    expect(jams[0]?.entity).toBe(entity('lower-gate'));
    expect(doorState(world.get(entity('lower-gate'), DoorComponent) as never)).toBe('closed');
    expect(moveDoor(world, entity('upper-gate'), 1)).toBe(true);
  });

  it('frees a gate when the chamber reaches its window, and the other one jams', () => {
    const { world, made, entity } = setup();
    const graph = at(made.graphs, 0);
    setLever(world, graph, 'tail', true); // the tail drain opens
    for (let i = 0; i < 60 * 5; i++) world.step();
    const chamber = world.get(entity('chamber'), LiquidVolumeComponent) as never;
    expect(totalDepth(chamber)).toBeLessThanOrEqual(0.2);
    expect(interlockAllows(world, entity('lower-gate'))).toBe(true);
    expect(world.get(entity('lower-gate'), DoorComponent)?.jammed).toBe(false);
    expect(world.get(entity('upper-gate'), DoorComponent)?.jammed).toBe(true);
    // And back up through the head sluice (the fill key), the tail shut.
    setLever(world, graph, 'tail', false);
    setLever(world, graph, 'head', true);
    for (let i = 0; i < 60 * 5; i++) world.step();
    expect(totalDepth(world.get(entity('chamber'), LiquidVolumeComponent) as never)).toBeCloseTo(
      1.8,
      5,
    );
    expect(world.get(entity('upper-gate'), DoorComponent)?.jammed).toBe(false);
    expect(world.get(entity('lower-gate'), DoorComponent)?.jammed).toBe(true);
  });

  it('leaves an open gate alone when the level moves, and jams it again once it is shut', () => {
    const { world, made, entity } = setup();
    expect(moveDoor(world, entity('upper-gate'), 1)).toBe(true);
    for (let i = 0; i < 90; i++) world.step();
    setLever(world, at(made.graphs, 0), 'tail', true);
    for (let i = 0; i < 60 * 5; i++) world.step();
    // Drained: the upper gate is outside its window but stands open, unjammed, and can be closed.
    expect(world.get(entity('upper-gate'), DoorComponent)?.jammed).toBe(false);
    expect(moveDoor(world, entity('upper-gate'), 0)).toBe(true);
    for (let i = 0; i < 90; i++) world.step();
    expect(world.get(entity('upper-gate'), DoorComponent)?.jammed).toBe(true);
  });

  it('allows anything without an interlock, or whose volume is gone', () => {
    const { world, entity } = setup();
    expect(interlockAllows(world, entity('plain-door'))).toBe(true);
    expect(world.has(entity('plain-door'), InterlockComponent)).toBe(false);
    const ghost = world.spawn();
    makeInterlock(world, ghost, 999);
    expect(interlockAllows(world, ghost)).toBe(true);
    // An interlock on something that is not a door is skipped without a fault.
    world.step();
    expect(world.get(ghost, InterlockComponent)).toEqual({
      volume: 999,
      minDepth: 0,
      maxDepth: null,
    });
  });

  it('costs a world with no interlocks nothing: no component registered, every door allowed', () => {
    const bare = installMechanisms(new World<never>({ seed: 1 }));
    expect(bare).toBeTypeOf('function');
    const world = new World<never>({ seed: 1 });
    installMechanisms(world);
    world.step();
    expect(world.isRegistered(InterlockComponent)).toBe(false);
    expect(interlockAllows(world, world.spawn())).toBe(true);
  });

  it('a fill-keyed receiver on a volume with no sluice changes nothing', () => {
    const { world, made, entity } = setup();
    setLever(world, at(made.graphs, 0), 'head', true);
    world.step();
    world.step();
    expect(world.get(entity('dry'), LiquidVolumeComponent)?.fill).toBeUndefined();
  });

  it('names the spawn a door answers to when the scene lacks it', () => {
    const world = installLiquids(
      installSignals(
        installStimuli(
          registerWorldProperties(registerSceneComponents(new World<never>({ seed: 4, hz: 60 }))),
        ),
      ),
    );
    installMechanisms(world);
    const scene = {
      id: 'broken',
      grid: 1,
      placements: [],
      spawns: [door('gate-alone', { volume: 'nowhere' })],
      signals: [],
    } as unknown as SceneSpec;
    const loaded = loadScene(world, scene, kit, new InMemoryColliderSink());
    expect(() => addSceneMechanisms(world, loaded, OPTIONS)).toThrow(
      'door "gate-alone" answers to "nowhere", which the scene does not have',
    );
  });
});
