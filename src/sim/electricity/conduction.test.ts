/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Electrical conduction (mw-e03.8): graph, flood, falloff, shock, ignition, discharge, receivers.
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { fireRules, fireIgnited } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import { LiquidLayerComponent } from '../liquids/components';
import { liquidRules } from '../liquids/rules';
import { createVolume, installLiquids, volumeOf } from '../liquids/volumes';
import {
  ChargeReceiverComponent,
  chargeReceiverChanged,
  stepChargeReceivers,
  makeChargeReceiver,
  resetChargeReceiver,
  syncChargeReceiverNodes,
  type ChargeReceiverChange,
} from '../mechanisms/charge-receivers';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import {
  addSignalGraph,
  installSignals,
  pressButton,
  signalOutput,
  signalSystem,
} from '../signals/runtime';
import { installMechanisms } from '../mechanisms/system';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { placeEntity } from '../stimulus/placement';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  DEFAULT_CONDUCTION_CONFIG,
  resolveConductionConfig,
  type ConductionConfig,
} from './config';
import { ConductionGraphCache } from './network';
import { conductionCapped, conductionRules, shocked, type Shock } from './rules';

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['water', { wetness: 1, liquid: true, density: 1000, conductive: true }],
  ['oil', { flammable: true, ignitionPoint: 210, fuel: 3, liquid: true, density: 900 }],
  ['iron', { conductive: true, absorbency: 0.1 }],
  ['flesh', { conductive: true }],
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, hp: 100 }],
]);

interface RigOptions {
  readonly conduction?: Partial<ConductionConfig>;
  readonly warn?: (message: string) => void;
}

function rig(options: RigOptions = {}) {
  const world = new World<never>({ seed: 8, hz: 60 });
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 8 });
  installLiquids(world);
  installSignals(world);
  installMechanisms(world);
  const cache = new ConductionGraphCache();
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([
          ...fireRules({ presets: PRESETS, burnt: new Map() }),
          ...liquidRules({ presets: PRESETS }),
          ...conductionRules({ ...options, cache }),
        ]),
      ),
    )
    .addSystem(elementFieldSystem())
    .addSystem(signalSystem());
  const shocks: Shock[] = [];
  world.events.on(shocked, (s) => shocks.push(s));
  const ignited: EntityId[] = [];
  world.events.on(fireIgnited, ({ entity }) => ignited.push(entity));
  const spawn = (material: string, x: number, radius = 0.5, init: WorldPropertyInit = {}) => {
    const entity = world.spawn();
    addMaterialProperties(world, entity, PRESETS, { material, ...init });
    placeEntity(world, entity, { x, y: 0, z: 0 }, radius);
    return entity;
  };
  const zap = (x: number, intensity: number) =>
    applyStimulus(world, {
      shape: { kind: 'sphere', center: { x, y: 0, z: 0 }, radius: 0.1 },
      element: 'charge',
      intensity,
      falloff: 'none',
    });
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const charge = (e: EntityId) => readProperty(world, e, 'charge');
  return { world, cache, shocks, ignited, spawn, zap, step, charge };
}

describe('conduction (mw-e03.8)', () => {
  it('AC-1: a charge stimulus on a water volume shocks all three actors, one falloff hop down', () => {
    const r = rig();
    const volume = createVolume(r.world, PRESETS, {
      min: { x: -2, y: -1, z: -2 },
      max: { x: 2, y: 0.5, z: 2 },
      layers: [{ liquid: 'water', depth: 1 }],
    });
    r.step(); // the layer entity is placed
    const goblins = [-1, 0, 1].map((x) => {
      const goblin = r.spawn('flesh', x, 0.3);
      placeEntity(r.world, goblin, { x, y: -0.5, z: 0 }, 0.3);
      return goblin;
    });
    r.step();
    const layer = volumeOf(r.world, volume).layers[0]!.entity;
    applyStimulus(r.world, {
      shape: { kind: 'contact', target: layer },
      element: 'charge',
      intensity: 1000,
    });
    r.step();
    const falloff = DEFAULT_CONDUCTION_CONFIG.falloffPerHop;
    expect(r.shocks.map((s) => s.entity).sort()).toEqual([...goblins].sort());
    for (const shock of r.shocks) {
      expect(shock.intensity).toBeCloseTo(1000 * falloff, 6);
      expect(shock.hops).toBe(1);
      expect(shock.origin).toBe(layer);
    }
    expect(r.shocks.every((s) => s.tick === r.shocks[0]!.tick)).toBe(true);
  });

  it('AC-2: a chain of touching conductors carries charge to the far end in the same tick; a gap stops it', () => {
    const r = rig({ conduction: { falloffPerHop: 0.9, halfLifeSeconds: 1e9 } });
    const bars = [0, 1, 2, 3, 4].map((x) => r.spawn('iron', x, 0.5));
    const beyond = r.spawn('iron', 6, 0.5); // 1 m gap after the last bar
    r.zap(0, 1000);
    r.step();
    expect(r.charge(bars[4]!)).toBeCloseTo(1000 * 0.9 ** 4, 6);
    expect(r.charge(beyond)).toBe(0);
    expect(r.shocks.some((s) => s.entity === beyond)).toBe(false);
    // The far bar is hop 4 away from the strike.
    expect(r.shocks.find((s) => s.entity === bars[4])?.hops).toBe(4);
  });

  it('AC-3: dry wood beside charged metal takes no charge; soaked wood conducts', () => {
    const r = rig();
    const iron = r.spawn('iron', 0);
    const wood = r.spawn('wood', 0.8, 0.5, { wetness: 0 });
    r.zap(0, 1000);
    r.step();
    expect(r.charge(iron)).toBeGreaterThan(0);
    expect(r.charge(wood)).toBe(0);
    r.step(240); // drains
    setProperty(r.world, wood, 'wetness', 0.6); // drying takes it under 0.5 within minutes, not a tick
    r.zap(0, 1000);
    r.step(2); // the graph picks the wood up, the charge reaches it (an add lands at tick end)
    expect(r.charge(wood)).toBeGreaterThan(0);
  });

  it('AC-4: a charge receiver turns on at its threshold, not below, and drives its lever node', () => {
    const r = rig({ conduction: { falloffPerHop: 1 } });
    const changes: ChargeReceiverChange[] = [];
    r.world.events.on(chargeReceiverChanged, (c) => changes.push(c));
    const rail = r.spawn('iron', 0);
    const conduit = r.spawn('iron', 1);
    makeChargeReceiver(r.world, conduit, { threshold: 50 });
    const graph = addSignalGraph(
      r.world,
      { id: 'lift', nodes: [{ id: 'conduit', kind: 'lever', entity: 'c' }], wires: [] },
      { bindings: { c: conduit } },
    );
    r.step();
    r.zap(0, 49);
    r.step();
    expect(r.world.get(conduit, ChargeReceiverComponent)!.active).toBe(false);
    expect(changes).toEqual([]);
    r.step(240);
    r.zap(0, 50);
    r.step();
    expect(r.world.get(conduit, ChargeReceiverComponent)!.active).toBe(true);
    expect(changes).toMatchObject([{ active: true, entity: conduit, source: null }]);
    expect(signalOutput(r.world, graph, 'conduit')).toBe(true);
    expect(r.charge(rail)).toBeGreaterThan(0);
    r.step(240); // momentary: the charge is gone, so is the signal
    expect(r.world.get(conduit, ChargeReceiverComponent)!.active).toBe(false);
    expect(signalOutput(r.world, graph, 'conduit')).toBe(false);
  });

  it('AC-5: a network over the node cap is charged only up to it, deterministically, with a warning', () => {
    const run = () => {
      const warnings: string[] = [];
      const r = rig({
        conduction: { maxNodes: 10, falloffPerHop: 1 },
        warn: (m) => warnings.push(m),
      });
      const capped: unknown[] = [];
      r.world.events.on(conductionCapped, (c) => capped.push(c));
      const chain = Array.from({ length: 30 }, (_, x) => r.spawn('iron', x));
      r.zap(0, 1000);
      r.step();
      return { charged: chain.map((e) => r.charge(e) > 0), warnings, capped };
    };
    const first = run();
    expect(first.charged.filter(Boolean)).toHaveLength(10);
    expect(first.charged.slice(0, 10).every(Boolean)).toBe(true);
    expect(first.warnings).toHaveLength(1);
    expect(first.capped).toHaveLength(1);
    expect(run()).toEqual(first);
  });

  it('charge does not creep past the cap on later ticks', () => {
    const r = rig({ conduction: { maxNodes: 10, falloffPerHop: 1, halfLifeSeconds: 100 } });
    const chain = Array.from({ length: 30 }, (_, x) => r.spawn('iron', x));
    r.zap(0, 1000);
    r.step(5);
    expect(chain.filter((e) => r.charge(e) > 0)).toHaveLength(10);
  });

  it('a strike on a conductor without a stored charge is charged by the tick after (a wet crate)', () => {
    const r = rig();
    const crate = r.world.spawn();
    addMaterialProperties(r.world, crate, PRESETS, { material: 'wood', wetness: 0.8 });
    placeEntity(r.world, crate, { x: 0, y: 0, z: 0 }, 0.5);
    r.step();
    r.zap(0, 100);
    r.step(2);
    expect(r.charge(crate)).toBeGreaterThan(0);
  });

  it('charge at the ignition threshold lights what can burn; less does not', () => {
    const r = rig();
    const brazier = r.spawn('wood', 0, 0.5, { conductive: true });
    const cold = r.spawn('wood', 5, 0.5, { conductive: true });
    const soaked = r.spawn('wood', 10, 0.5, { conductive: true, wetness: 0.9 });
    const iron = r.spawn('iron', 15, 0.5);
    r.zap(0, 500);
    r.zap(5, 499);
    r.zap(10, 900);
    r.zap(15, 900);
    r.step(3);
    expect(r.ignited).toEqual([brazier]);
    expect(readProperty(r.world, cold, 'burning')).toBe(false);
    expect(readProperty(r.world, soaked, 'burning')).toBe(false);
    expect(readProperty(r.world, iron, 'burning')).toBe(false);
  });

  it('held charge halves every half-life and is gone below the minimum', () => {
    const r = rig({ conduction: { halfLifeSeconds: 0.5, minCharge: 0.6 } });
    const bar = r.spawn('iron', 0);
    setProperty(r.world, bar, 'charge', 8);
    r.step(30); // half a second at 60 Hz
    expect(r.charge(bar)).toBeCloseTo(4, 6);
    r.step(60);
    expect(r.charge(bar)).toBeCloseTo(1, 6);
    r.step(30);
    expect(r.charge(bar)).toBe(0);
  });

  it('a sustained stimulus keeps shocking while it lasts', () => {
    const r = rig();
    const goblin = r.spawn('flesh', 0);
    applyStimulus(r.world, {
      shape: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1 },
      element: 'charge',
      intensity: 6000,
      duration: 1,
      falloff: 'none',
    });
    r.step(30);
    expect(r.shocks.filter((s) => s.entity === goblin).length).toBeGreaterThanOrEqual(30);
  });

  it('the shock below the threshold is not reported, and a struck entity outside a network is its own origin', () => {
    const r = rig();
    const goblin = r.spawn('flesh', 0);
    const lone = r.spawn('wood', 20, 0.5, { charge: 0 });
    r.zap(0, 9);
    r.zap(20, 40);
    r.step();
    expect(r.shocks.filter((s) => s.entity === goblin)).toEqual([]);
    expect(r.shocks).toMatchObject([{ entity: lone, intensity: 40, hops: 0, origin: lone }]);
  });

  it('boxes and spheres connect by overlap: a pool, a stack of layers, a lone wire', () => {
    const r = rig({ conduction: { falloffPerHop: 0.5, halfLifeSeconds: 1e9 } });
    const near = createVolume(r.world, PRESETS, {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 4, y: 2, z: 4 },
      layers: [
        { liquid: 'water', depth: 0.5 },
        { liquid: 'oil', depth: 0.3 },
      ],
    });
    const next = createVolume(r.world, PRESETS, {
      min: { x: 4, y: 0, z: 0 },
      max: { x: 8, y: 2, z: 4 },
      layers: [{ liquid: 'water', depth: 0.5 }],
    });
    const far = createVolume(r.world, PRESETS, {
      min: { x: 20, y: 0, z: 0 },
      max: { x: 24, y: 2, z: 4 },
      layers: [{ liquid: 'water', depth: 0.5 }],
    });
    const layerOf = (v: EntityId, i = 0) => volumeOf(r.world, v).layers[i]!.entity;
    r.step();
    const wire = r.world.spawn();
    addMaterialProperties(r.world, wire, PRESETS, { material: 'iron' });
    placeEntity(r.world, wire, { x: 0, y: 0.6, z: 2 }, 0.2); // touches the water surface from above
    const oilOnly = r.world.spawn();
    addMaterialProperties(r.world, oilOnly, PRESETS, { material: 'iron' });
    placeEntity(r.world, oilOnly, { x: 2, y: 1.5, z: 2 }, 0.2); // above the oil: touches nothing
    r.step();
    r.zap(1, 1000); // not on a layer: nothing there to hit, so strike the layer directly
    applyStimulus(r.world, {
      shape: { kind: 'contact', target: layerOf(near) },
      element: 'charge',
      intensity: 800,
    });
    r.step();
    expect(r.charge(layerOf(near))).toBeCloseTo(800, 6);
    expect(r.charge(layerOf(next))).toBeCloseTo(400, 6); // pools side by side touch
    expect(r.charge(wire)).toBeCloseTo(400, 6);
    expect(r.charge(layerOf(far))).toBe(0);
    expect(r.charge(oilOnly)).toBe(0);
    expect(r.charge(layerOf(near, 1))).toBe(0); // oil does not conduct
  });

  it('the graph is cached and rebuilt when something moves, soaks or freezes; not while charge is absent', () => {
    const r = rig();
    const a = r.spawn('iron', 0, 0.5, { frozen: false });
    const b = r.spawn('iron', 1);
    const wood = r.spawn('wood', 2, 0.5, { wetness: 0 });
    r.step(5);
    expect(r.cache.builds).toBe(0); // no charge: the graph is never touched
    r.zap(0, 1000);
    r.step();
    expect(r.cache.builds).toBe(1);
    expect(r.charge(b)).toBeGreaterThan(0);
    r.zap(0, 1000);
    r.step(5);
    expect(r.cache.builds).toBe(1); // nothing changed: reused
    placeEntity(r.world, b, { x: 5, y: 0, z: 0 }, 0.5); // moved away
    r.step(240);
    r.zap(0, 1000);
    r.step();
    expect(r.cache.builds).toBe(2);
    expect(r.charge(b)).toBe(0);
    setProperty(r.world, wood, 'wetness', 0.6); // soaked: conducts
    r.step(240);
    r.zap(0, 1000);
    r.step();
    expect(r.cache.builds).toBe(3);
    setProperty(r.world, a, 'frozen', true);
    r.step(240);
    r.zap(2, 1000);
    r.step();
    expect(r.cache.builds).toBe(4);
  });

  it('a stale layer entity and an unplaced conductor are not nodes', () => {
    const r = rig();
    const unplaced = r.world.spawn();
    addMaterialProperties(r.world, unplaced, PRESETS, { material: 'iron' });
    const iron = r.spawn('iron', 0);
    r.zap(0, 100);
    r.step();
    expect(r.charge(unplaced)).toBe(0);
    expect(r.charge(iron)).toBeGreaterThan(0);
  });

  it('config: defaults, overrides and every rejected value', () => {
    expect(resolveConductionConfig()).toEqual(DEFAULT_CONDUCTION_CONFIG);
    expect(resolveConductionConfig({ maxNodes: 4 }).maxNodes).toBe(4);
    for (const bad of [
      { falloffPerHop: 0 },
      { falloffPerHop: 1.1 },
      { maxNodes: 0 },
      { maxNodes: 2.5 },
      { contactGap: -1 },
      { contactGap: Infinity },
      { minCharge: 0 },
      { halfLifeSeconds: -1 },
      { shockCharge: NaN },
      { ignitionCharge: 0 },
    ]) {
      expect(() => resolveConductionConfig(bad)).toThrow(RangeError);
    }
    expect(resolveConductionConfig({ contactGap: 0 }).contactGap).toBe(0);
  });
});

describe('conduction edges (mw-e03.8)', () => {
  it('a conductor that is not, a forgotten layer entity, and pools offset sideways are not joined', () => {
    const r = rig({ conduction: { halfLifeSeconds: 1e9 } });
    const dry = r.spawn('iron', 0, 0.5, { conductive: false });
    const orphan = r.spawn('water', 0.2);
    r.world.add(orphan, LiquidLayerComponent, { volume: dry });
    const pool = (z: number) =>
      createVolume(r.world, PRESETS, {
        min: { x: 0, y: 0, z },
        max: { x: 4, y: 2, z: z + 4 },
        layers: [{ liquid: 'water', depth: 0.5 }],
      });
    const [north, middle, south, beyond] = [pool(10), pool(0), pool(-10), pool(20)]; // both orders
    const layer = (v: EntityId) => volumeOf(r.world, v).layers[0]!.entity;
    r.step();
    applyStimulus(r.world, {
      shape: { kind: 'contact', target: layer(middle) },
      element: 'charge',
      intensity: 100,
    });
    r.step();
    expect(r.charge(layer(middle))).toBeGreaterThan(0);
    expect(r.charge(layer(south))).toBe(0);
    expect(r.charge(layer(north))).toBe(0);
    expect(r.charge(layer(beyond))).toBe(0);
    expect(r.charge(dry)).toBe(0);
    expect(r.charge(orphan)).toBe(0);
  });

  it('a flammable conductor with no temperature is not heated; a hot one is left as it is', () => {
    const r = rig();
    const bare = r.world.spawn();
    addProperties(r.world, bare, {
      flammable: true,
      ignitionPoint: 300,
      fuel: 5,
      conductive: true,
      charge: 0,
    });
    placeEntity(r.world, bare, { x: 0, y: 0, z: 0 }, 0.5);
    const hot = r.spawn('wood', 5, 0.5, { conductive: true, temperature: 400 });
    r.step();
    r.zap(0, 900);
    r.zap(5, 900);
    r.step();
    expect(readProperty(r.world, bare, 'temperature')).toBe(
      WORLD_PROPERTY_SPECS.temperature.default,
    );
    expect(readProperty(r.world, hot, 'temperature')).toBeGreaterThanOrEqual(400);
  });

  it('the rules build with no options, and a world without mechanisms has no receivers to step', () => {
    expect(conductionRules().map((rule) => rule.id)).toEqual([
      'conduction.flood',
      'conduction.shock',
      'conduction.receivers',
      'conduction.discharge',
    ]);
    const world = new World<never>({ seed: 1 });
    registerWorldProperties(world);
    expect(() => {
      stepChargeReceivers(world);
    }).not.toThrow();
  });
});

describe('charge receivers (mw-e03.8)', () => {
  it('only lever nodes follow a receiver, buttons bound to it do not', () => {
    const r = rig({ conduction: { falloffPerHop: 1 } });
    const bar = r.spawn('iron', 0);
    makeChargeReceiver(r.world, bar, { threshold: 5 });
    const graph = addSignalGraph(
      r.world,
      {
        id: 'both',
        nodes: [
          { id: 'level', kind: 'lever', entity: 'b', observed: true },
          { id: 'tap', kind: 'button', entity: 'b', observed: true },
        ],
        wires: [],
      },
      { bindings: { b: bar } },
    );
    syncChargeReceiverNodes(r.world, bar);
    r.step();
    r.zap(0, 100);
    r.step();
    expect(signalOutput(r.world, graph, 'level')).toBe(true);
    expect(signalOutput(r.world, graph, 'tap')).toBe(false);
  });

  it('a latching receiver stays on until a signal resets it', () => {
    const r = rig({ conduction: { falloffPerHop: 1 } });
    const rail = r.spawn('iron', 0);
    const lift = r.spawn('iron', 1);
    makeChargeReceiver(r.world, lift, { threshold: 10, mode: 'latching' });
    const graph = addSignalGraph(
      r.world,
      {
        id: 'lift',
        nodes: [
          { id: 'lift', kind: 'lever', entity: 'l' },
          { id: 'reset-button', kind: 'button' },
          { id: 'reset', kind: 'receiver', receiver: 'mechanism', entity: 'l' },
        ],
        wires: [{ from: 'reset-button.out', to: 'reset.in' }],
      },
      { bindings: { l: lift } },
    );
    syncChargeReceiverNodes(r.world, lift);
    syncChargeReceiverNodes(r.world, rail); // not a receiver: nothing
    r.zap(0, 100);
    r.step(2);
    r.step(300);
    expect(r.world.get(lift, ChargeReceiverComponent)!.active).toBe(true);
    expect(signalOutput(r.world, graph, 'lift')).toBe(true);
    pressButton(r.world, graph, 'reset-button');
    r.step(3);
    expect(r.world.get(lift, ChargeReceiverComponent)!.active).toBe(false);
    expect(signalOutput(r.world, graph, 'lift')).toBe(false);
    expect(resetChargeReceiver(r.world, lift)).toBe(false);
    expect(resetChargeReceiver(r.world, rail)).toBe(false);
  });

  it('a threshold of 0 or less is rejected', () => {
    const r = rig();
    const e = r.world.spawn();
    for (const threshold of [0, -1, NaN]) {
      expect(() => {
        makeChargeReceiver(r.world, e, { threshold });
      }).toThrow(RangeError);
    }
  });
});
