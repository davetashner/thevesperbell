/* eslint-disable @typescript-eslint/no-non-null-assertion */
// A loaded scene's doors, switches and signal graphs (mw-e03.18).
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { at } from '../geom/vec';
import {
  addSceneInteractables,
  InteractableComponent,
  INTERACTION_COMPONENTS,
} from '../interaction/system';
import { LightSourceComponent, lightComponents } from '../light/components';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { readProperty, registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import type { KitLookup, SceneSpec } from '../scene/layout';
import { loadScene, registerSceneComponents } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { installSignals, signalOutput, signalSystem } from '../signals/runtime';
import { PlacementComponent } from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  DoorComponent,
  LockComponent,
  SwitchComponent,
  type DoorProfile,
  type LockSpec,
} from './components';
import { ImpactSwitchComponent, IMPACT_SWITCH_PREFABS } from './impacts';
import { DEFAULT_PLATE, PlateComponent } from './plates';
import { addSceneMechanisms, SWITCH_AFFORDANCES, type SceneMechanismsOptions } from './scene';
import { doorStatus, installMechanisms } from './system';

const kit: KitLookup = (id) =>
  id === 'floor'
    ? {
        id,
        purpose: 'walkable',
        parts: [{ shape: 'box', size: [10, 0.2, 10], offset: [0, -0.1, 0], collider: true }],
      }
    : undefined;

const PORTCULLIS: DoorProfile = {
  id: 'portcullis',
  kind: 'portcullis',
  size: { x: 1.2, y: 2.2, z: 0.1 },
  seconds: 1,
  crush: 0,
  manual: false,
  blocks: { light: false, gas: false, sound: false },
  loudness: 70,
};
const WOODEN: DoorProfile = { ...PORTCULLIS, id: 'wooden-door', kind: 'hinged', manual: true };
const VAULT: LockSpec = {
  id: 'vault',
  tier: 3,
  pickTier: null,
  sealed: false,
  tags: [],
  hint: 'Locked.',
};
const GRAPH: SignalGraphDef = {
  id: 'gate',
  nodes: [
    { id: 'lever', kind: 'lever', entity: 'gate-lever' },
    { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'gate' },
  ],
  wires: [{ from: 'lever', to: 'gate' }],
};
const MATERIALS: MaterialPresets = new Map([['wood', { flammable: true, fuel: 120 }]]);

const SCENE = {
  id: 'doors',
  grid: 1,
  placements: [{ piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] }],
  spawns: [
    { id: 'gate', at: [0, 0, 4], yaw: 0, tags: [], door: { profile: { id: 'portcullis' } } },
    {
      id: 'vault-door',
      at: [-4, 0, 0],
      yaw: 90,
      tags: [],
      properties: { hp: 50 },
      door: {
        profile: { id: 'wooden-door' },
        lock: { id: 'vault' },
        locked: true,
        state: 'closed',
        hinge: 'right',
        swing: 'back',
      },
    },
    { id: 'lever', at: [1, 0, 3], yaw: 0, tags: [], switch: { kind: 'lever', initial: 1 } },
    {
      id: 'bell-pull',
      at: [2, 0, 3],
      yaw: 0,
      tags: [],
      switch: { kind: 'button' },
      interact: { affordances: [{ verb: 'pull', label: 'Ring' }], anchor: [0, 1.5, 0] },
    },
    { id: 'wheel', at: [3, 0, 3], yaw: 0, tags: [], switch: { kind: 'wheel', positions: 4 } },
    { id: 'marker', at: [0, 0, 0], yaw: 0, tags: [] },
    {
      id: 'scale',
      at: [5, 0, 5],
      yaw: 0,
      tags: [],
      plate: {
        minWeight: 40,
        maxWeight: 60,
        hysteresis: 5,
        mode: 'latching',
        armSeconds: 1,
        width: 2,
        depth: 1.5,
        hidden: true,
      },
    },
    { id: 'step', at: [7, 0, 5], yaw: 0, tags: [], plate: { minWeight: 10 } },
    {
      id: 'target',
      at: [0, 2, 8],
      yaw: 0,
      tags: [],
      impactSwitch: { variant: 'bullseye', minEnergy: 30, radius: 0.2, holdSeconds: 5 },
    },
    {
      id: 'chime',
      at: [2, 2, 8],
      yaw: 0,
      tags: [],
      impactSwitch: {
        variant: 'bell',
        damageTypes: ['blunt'],
        elements: [],
        mode: 'latching',
        loudness: null,
      },
    },
    {
      id: 'wall-torch',
      at: [3, 1.5, 8],
      yaw: 0,
      tags: [],
      lightSource: { variant: 'torch', unlit: true },
    },
    {
      id: 'hearth',
      at: [-3, 0.5, 8],
      yaw: 0,
      tags: [],
      lightSource: { variant: 'brazier', infiniteFuel: true },
    },
  ],
  signals: [{ graph: { id: 'gate' }, bindings: { 'gate-lever': 'lever' } }],
} as unknown as SceneSpec;

const OPTIONS: SceneMechanismsOptions = {
  doors: (id) => [PORTCULLIS, WOODEN].find((d) => d.id === id),
  locks: (id) => (id === 'vault' ? VAULT : undefined),
  graphs: (id) => (id === 'gate' ? GRAPH : undefined),
  doorMaterial: (id) => (id === 'wooden-door' ? 'wood' : undefined),
  materials: MATERIALS,
};

function setup(interaction = true) {
  const world = installSignals(
    installStimuli(registerWorldProperties(registerSceneComponents(new World<never>({ seed: 4 })))),
  );
  world.register(...lightComponents);
  if (interaction) world.register(...INTERACTION_COMPONENTS);
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  installMechanisms(world);
  const loaded = loadScene(world, SCENE, kit, new InMemoryColliderSink());
  if (interaction) addSceneInteractables(world, loaded.spawns);
  return { world, loaded };
}

const entityOf = (loaded: ReturnType<typeof setup>['loaded'], index: number) =>
  at(loaded.spawns, index).entity;

describe('scene mechanisms (mw-e03.18)', () => {
  it('makes door spawns doors of their profile, with their lock, material and orientation', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const [gate, vault] = [entityOf(loaded, 0), entityOf(loaded, 1)];
    expect(made.doors).toEqual([gate, vault]);
    expect(world.get(gate, DoorComponent)).toMatchObject({
      profile: 'portcullis',
      origin: { x: 0, y: 0, z: 4 },
      yaw: 0,
      hinge: 'left',
      swing: 'forward',
    });
    expect(world.get(vault, DoorComponent)).toMatchObject({
      yaw: 90,
      hinge: 'right',
      swing: 'back',
    });
    expect(world.get(vault, LockComponent)).toMatchObject({ lock: 'vault', locked: true });
    expect(doorStatus(world, vault)).toBe('locked');
    expect(readProperty(world, vault, 'material')).toBe('wood');
    expect(readProperty(world, vault, 'hp')).toBe(50);
    expect(readProperty(world, vault, 'flammable')).toBe(true);
    // The locked door offers Unlock; the signal-only portcullis offers nothing.
    expect(world.get(vault, InteractableComponent)?.affordances.map((a) => a.verb)).toEqual([
      'unlock',
    ]);
    expect(world.has(gate, InteractableComponent)).toBe(false);
  });

  it('makes switch spawns switches with their kind’s prompt unless the scene gives one', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const [lever, pull, wheel] = [entityOf(loaded, 2), entityOf(loaded, 3), entityOf(loaded, 4)];
    expect(made.switches).toEqual([lever, pull, wheel]);
    expect(world.get(lever, SwitchComponent)).toEqual({ kind: 'lever', positions: 2, position: 1 });
    expect(world.get(wheel, SwitchComponent)).toEqual({ kind: 'wheel', positions: 4, position: 0 });
    expect(world.get(lever, InteractableComponent)?.affordances[0]?.label).toBe(
      SWITCH_AFFORDANCES.lever.label,
    );
    expect(world.get(wheel, InteractableComponent)?.affordances[0]?.label).toBe('Turn wheel');
    // The scene's own prompt stays.
    expect(world.get(pull, InteractableComponent)?.affordances[0]?.label).toBe('Ring');
  });

  it('makes plate spawns plates at the spawn point, with their data or the defaults (mw-e03.19)', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const [scale, step] = [entityOf(loaded, 6), entityOf(loaded, 7)];
    expect(made.plates).toEqual([scale, step]);
    expect(world.get(scale, PlateComponent)).toEqual({
      minWeight: 40,
      maxWeight: 60,
      hysteresis: 5,
      mode: 'latching',
      armSeconds: 1,
      width: 2,
      depth: 1.5,
      hidden: true,
      origin: { x: 5, y: 0, z: 5 },
      active: false,
      weight: 0,
      arming: 0,
    });
    expect(world.get(step, PlateComponent)).toMatchObject({
      ...DEFAULT_PLATE,
      minWeight: 10,
      origin: { x: 7, y: 0, z: 5 },
    });
  });

  it('makes light source spawns from their prefab with the designer flags (mw-e03.16)', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const [torch, hearth] = loaded.spawns
      .filter(({ spawn }) => spawn.lightSource !== undefined)
      .map(({ entity }) => entity);
    expect(made.lights).toEqual([torch, hearth]);
    expect(readProperty(world, torch!, 'burning')).toBe(false);
    expect(world.get(torch!, LightSourceComponent)?.infiniteFuel).toBe(false);
    expect(readProperty(world, hearth!, 'burning')).toBe(true);
    expect(world.get(hearth!, LightSourceComponent)?.infiniteFuel).toBe(true);
    expect(world.get(hearth!, InteractableComponent)?.affordances[0]?.verb).toBe('extinguish');
  });

  it('makes impact switch spawns from their prefab with the scene overrides (mw-e03.20)', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const [target, chime] = [entityOf(loaded, 8), entityOf(loaded, 9)];
    expect(made.impactSwitches).toEqual([target, chime]);
    expect(world.get(target, ImpactSwitchComponent)).toEqual({
      ...IMPACT_SWITCH_PREFABS.bullseye,
      minEnergy: 30,
      radius: 0.2,
      holdSeconds: 5,
      origin: { x: 0, y: 2, z: 8 },
      active: false,
      holdLeft: 0,
      lastHit: -1,
    });
    expect(world.get(chime, ImpactSwitchComponent)).toMatchObject({
      variant: 'bell',
      damageTypes: ['blunt'],
      elements: [],
      mode: 'latching',
      loudness: null,
      minEnergy: IMPACT_SWITCH_PREFABS.bell.minEnergy,
    });
  });

  it('wires placed graphs to the spawns they name, and a lever that starts on opens its gate', () => {
    const { world, loaded } = setup();
    const made = addSceneMechanisms(world, loaded, OPTIONS);
    const graph = at(made.graphs, 0);
    world.step();
    expect(signalOutput(world, graph, 'lever')).toBe(true);
    world.step();
    expect(world.get(entityOf(loaded, 0), DoorComponent)?.target).toBe(1);
  });

  it('places switches without interaction where they spawn', () => {
    const { world, loaded } = setup(false);
    addSceneMechanisms(world, loaded, {
      doors: OPTIONS.doors,
      locks: OPTIONS.locks,
      graphs: OPTIONS.graphs,
    });
    expect(world.get(entityOf(loaded, 2), PlacementComponent)).toEqual({
      x: 1,
      y: 0,
      z: 3,
      radius: 0,
    });
    expect(readProperty(world, entityOf(loaded, 1), 'material')).toBe('generic');
  });

  it('rejects unknown profiles, locks, graphs and bindings', () => {
    const fails = (options: Partial<SceneMechanismsOptions>, message: string) => {
      const { world, loaded } = setup();
      expect(() => addSceneMechanisms(world, loaded, { ...OPTIONS, ...options })).toThrow(message);
    };
    fails({ doors: () => undefined }, 'unknown door profile "portcullis"');
    fails({ locks: () => undefined }, 'unknown lock "vault"');
    fails({ graphs: () => undefined }, 'unknown signal graph "gate"');
    fails(
      {
        graphs: () => ({
          ...GRAPH,
          nodes: [
            ...GRAPH.nodes.slice(0, 1),
            { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'nowhere' },
          ],
        }),
      },
      'scene "doors" signal 0 binds "nowhere" to spawn "nowhere", which it does not have',
    );
  });
});
