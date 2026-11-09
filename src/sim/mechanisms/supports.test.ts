/* eslint-disable @typescript-eslint/no-non-null-assertion */
// Load-bearing supports (mw-e03.13): ropes and chains with hit points, material properties and a
// load rating, on the real deterministic Rapier build with the fire rules and signal graphs running.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { fireBurntOut, fireRules, type BurntMaterials } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import {
  PhysicsObjectComponent,
  addPhysicsObject,
  installPhysicsObjects,
  removePhysicsObject,
  rigidBodiesOf,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { InMemoryColliderSink } from '../physics/static-colliders';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { tagEntity } from '../signals/filter';
import type { SignalGraphDef } from '../signals/graph';
import {
  addSignalGraph,
  installSignals,
  signalOutput,
  signalReceived,
  signalSystem,
  type SignalReceipt,
} from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import type { StimulusElement } from '../stimulus/stimulus';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import type { Vec3 } from '../stimulus/shapes';
import { PINNED_MASS, suspensionReleased, SuspendedComponent, suspendFrom } from './ropes';
import {
  DEFAULT_SUPPORT_RADIUS,
  heldBy,
  linkSpan,
  makeSupport,
  MAX_SUPPORT_REACH,
  releaseSupport,
  SupportComponent,
  supportReleased,
  weighSpan,
  type SupportRelease,
} from './supports';
import { installMechanisms } from './system';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['rope', { flammable: true, ignitionPoint: 260, fuel: 2, hp: 30 }],
  ['cloth', { flammable: true, ignitionPoint: 260, fuel: 3, hp: 12 }],
  ['straw', { flammable: true, ignitionPoint: 200, fuel: 1, hp: 8 }],
  ['iron', { hp: 800 }],
  ['generic', {}],
]);
const BURNT: BurntMaterials = new Map([
  ['rope', null],
  ['cloth', null],
  ['straw', null],
]);

const ROPE_RESISTANCES = { blunt: 1, force: 1, pierce: 0.3 } as const;

function rig() {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installElementField(
      installStimuli(registerWorldProperties(new World<never>({ seed: 5, hz: 60, physics }))),
      { maxChunks: 8 },
    ),
  );
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(new ElementRuleSet(fireRules({ presets: PRESETS, burnt: BURNT }))),
    )
    .addSystem(elementFieldSystem())
    .addSystem(signalSystem());
  const colliders = new InMemoryColliderSink();
  installMechanisms(world, { colliders });
  const releases: SupportRelease[] = [];
  world.events.on(supportReleased, (e) => releases.push(e));
  const dropped: EntityId[] = [];
  world.events.on(suspensionReleased, (e) => dropped.push(e.entity));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const heightOf = (e: EntityId) => world.get(e, PhysicsObjectComponent)?.position.y ?? NaN;
  /** A support from (0, 4) straight down 2 m, of `material`, with a 20 kg weight at its end. */
  const hang = (
    material = 'rope',
    options: Parameters<typeof makeSupport>[4] = { resistances: ROPE_RESISTANCES },
    init: WorldPropertyInit = {},
  ) => {
    const rope = world.spawn();
    addMaterialProperties(world, rope, PRESETS, { material, temperature: 20, ...init });
    makeSupport(world, rope, v(0, 4, 0), v(0, 2, 0), options);
    const weight = world.spawn();
    addProperties(world, weight, { weight: 20 });
    world.step();
    addPhysicsObject(world, weight, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.2, 0.3) },
      position: v(0, 1.8, 0),
    });
    world.step();
    suspendFrom(world, weight, rope);
    world.step();
    return { rope, weight };
  };
  const hit = (
    target: EntityId,
    element: StimulusElement,
    intensity: number,
    source: EntityId | null = null,
  ) => {
    applyStimulus(world, { shape: { kind: 'contact', target }, element, intensity, source });
  };
  /**
   * A rope bridge along x from 0 to 6 m at y = 1: two ropes 1.2 m apart and twelve 2 kg planks,
   * rated `rating`.
   */
  const bridge = (rating: number, hp = [30, 30], z0 = 0) => {
    const ropes = [-0.6 + z0, 0.6 + z0].map((z, i) => {
      const rope = world.spawn();
      addMaterialProperties(world, rope, PRESETS, { material: 'rope', hp: hp[i]! });
      makeSupport(world, rope, v(0, 1, z), v(6, 1, z), { resistances: ROPE_RESISTANCES, rating });
      return rope;
    });
    linkSpan(world, ropes);
    world.step();
    const planks = Array.from({ length: 12 }, (_, i) => {
      const plank = world.spawn();
      addProperties(world, plank, { weight: 2 });
      addPhysicsObject(world, plank, {
        shape: { kind: 'box', halfExtents: v(0.23, 0.05, 0.6) },
        position: v(0.25 + i * 0.5, 1.05, z0),
      });
      return plank;
    });
    world.step();
    for (const plank of planks) suspendFrom(world, plank, ropes[0]!);
    world.step();
    return { ropes, planks };
  };
  /** A body of `kilos` dropped from `y` at (x, y, 0). */
  const drop = (kilos: number, at: Vec3, half = 0.2) => {
    const crate = world.spawn();
    addProperties(world, crate, { weight: kilos });
    addPhysicsObject(world, crate, {
      shape: { kind: 'box', halfExtents: v(half, half, half) },
      position: at,
      properties: { weight: kilos, friction: 0.5, impactAbsorb: 0 },
    });
    world.step();
    return crate;
  };
  return { world, colliders, releases, dropped, steps, heightOf, hang, hit, bridge, drop };
}

const levers = (rope: EntityId, world: World<never>) => {
  const graph: SignalGraphDef = {
    id: 'rope-drop',
    nodes: [
      { id: 'rope', kind: 'lever', entity: 'rope' },
      // A button bound to the same rope is not driven by it: only levers are.
      { id: 'tap', kind: 'button', entity: 'rope' },
      { id: 'drop', kind: 'receiver', receiver: 'audio-cue', key: 'sfx-thud' },
    ],
    wires: [{ from: 'rope.out', to: 'drop.in' }],
  };
  const received: SignalReceipt[] = [];
  world.events.on(signalReceived, (e) => received.push(e));
  return { graph: addSignalGraph(world, graph, { bindings: { rope } }), received };
};

describe('supports (mw-e03.13)', () => {
  it.each(['rope', 'cloth', 'straw'])(
    'AC-1: a flammable %s support that burns out releases, and what it held is dynamic that tick',
    (material) => {
      const r = rig();
      const { rope, weight } = r.hang(material, { resistances: ROPE_RESISTANCES }, {});
      const burnt: number[] = [];
      r.world.events.on(fireBurntOut, () => burnt.push(r.world.tick));
      expect(readProperty(r.world, weight, 'suspended')).toBe(true);
      setProperty(r.world, rope, 'temperature', 400); // a flame touches it
      let guard = 0;
      while (burnt.length === 0 && guard++ < 600) r.world.step();
      expect(burnt).toHaveLength(1);
      // The tick the fire burns out: the support lets go, and the body is free at its end.
      expect(r.releases).toMatchObject([
        { entity: rope, cause: 'burnt', source: null, held: [weight] },
      ]);
      expect(r.releases[0]?.tick).toBe(burnt[0]);
      expect(readProperty(r.world, weight, 'suspended')).toBe(false);
      expect(r.world.has(weight, SuspendedComponent)).toBe(false);
      r.steps(60);
      expect(r.heightOf(weight)).toBeLessThan(1);
    },
  );

  it('a support whose hp the fire wears to 0 before its fuel is spent lets go as burnt, once', () => {
    const r = rig();
    const { rope, weight } = r.hang('rope', { resistances: ROPE_RESISTANCES }, { hp: 0.2 });
    setProperty(r.world, rope, 'temperature', 400);
    r.steps(600);
    expect(r.releases).toMatchObject([{ entity: rope, cause: 'burnt', held: [weight] }]);
    expect(r.dropped).toEqual([weight]);
  });

  it('a charred, not burnt-away, support stays up', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.world.events.emit(fireBurntOut, { entity: rope, becomes: 'charred' });
    r.steps(5);
    expect(r.releases).toEqual([]);
    expect(readProperty(r.world, weight, 'suspended')).toBe(true);
  });

  it('AC-2: a rope with pierce resistance 0.3 releases at pierce damage hp/0.7, not below', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.hit(rope, 'pierce', 42); // 29.4 through: 0.6 hp left
    r.steps(2);
    expect(r.releases).toEqual([]);
    expect(readProperty(r.world, rope, 'hp')).toBeCloseTo(0.6, 5);
    expect(readProperty(r.world, weight, 'suspended')).toBe(true);
    r.hit(rope, 'pierce', 1, 9);
    r.steps(1);
    expect(r.releases).toMatchObject([
      { entity: rope, cause: 'damage', source: 9, held: [weight] },
    ]);
    expect(readProperty(r.world, weight, 'suspended')).toBe(false);
    r.steps(60);
    expect(r.heightOf(weight)).toBeLessThan(1);
  });

  it.each([0, 0.3, 0.5, 0.9])(
    'AC-2: for pierce resistance %f, damage of hp/(1 - resistance) releases and a hair under does not',
    (resistance) => {
      const hp = 30;
      const over = hp / (1 - resistance) + 0.5;
      const under = hp / (1 - resistance) - 0.5;
      const held = rig();
      const a = held.hang('rope', { resistances: { pierce: resistance } });
      held.hit(a.rope, 'pierce', under);
      held.steps(2);
      expect(held.releases).toEqual([]);
      const gone = rig();
      const b = gone.hang('rope', { resistances: { pierce: resistance } });
      gone.hit(b.rope, 'pierce', over);
      gone.steps(2);
      expect(gone.releases).toHaveLength(1);
    },
  );

  it('AC-2: a chain with pierce immunity does not release, whatever the damage', () => {
    const r = rig();
    const { rope, weight } = r.hang('iron', { resistances: { pierce: 1 } });
    r.hit(rope, 'pierce', 1_000_000);
    r.hit(rope, 'pierce', 1_000_000);
    r.steps(30);
    expect(r.releases).toEqual([]);
    expect(readProperty(r.world, rope, 'hp')).toBe(800);
    expect(readProperty(r.world, weight, 'suspended')).toBe(true);
    // Chain is not immune to everything: a slash it has no resistance to wears it down.
    r.hit(rope, 'slash', 800, 3);
    r.steps(2);
    expect(r.releases).toMatchObject([{ entity: rope, cause: 'damage', source: 3 }]);
  });

  it('ignores blunt it resists, other elements and entities that are not supports', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.hit(rope, 'blunt', 500);
    r.hit(rope, 'force', 500);
    r.hit(rope, 'heat', 5);
    r.hit(weight, 'pierce', 500);
    r.steps(5);
    expect(r.releases).toEqual([]);
    expect(readProperty(r.world, rope, 'hp')).toBe(30);
  });

  it('two hits in one tick release once, and a released support takes no more', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.hit(rope, 'pierce', 100, 1);
    r.hit(rope, 'slash', 100, 2);
    r.steps(3);
    expect(r.releases).toHaveLength(1);
    expect(r.dropped).toEqual([weight]);
    expect(r.world.isAlive(rope)).toBe(false);
    expect(releaseSupport(r.world, rope, 'damage')).toBe(false);
  });

  it('a released support is destroyed with its collider; one that is no support is not released', () => {
    const r = rig();
    const rope = r.world.spawn();
    addMaterialProperties(r.world, rope, PRESETS, { material: 'rope' });
    makeSupport(r.world, rope, v(0, 4, 0), v(0, 2, 0), { colliders: r.colliders });
    r.steps(1);
    expect(r.colliders.count()).toBe(1);
    expect(r.world.get(rope, SupportComponent)?.collider).not.toBeNull();
    expect(releaseSupport(r.world, r.world.spawn(), 'damage')).toBe(false);
    expect(releaseSupport(r.world, rope, 'damage')).toBe(true);
    r.steps(2);
    expect(r.colliders.count()).toBe(0);
  });

  it('AC-3: a released support linked to a mechanism signals it exactly once', () => {
    const r = rig();
    const { rope } = r.hang();
    const { graph, received } = levers(rope, r.world);
    r.steps(2);
    expect(signalOutput(r.world, graph, 'rope')).toBe(false);
    r.hit(rope, 'pierce', 100);
    r.steps(5);
    expect(signalOutput(r.world, graph, 'rope')).toBe(true);
    expect(signalOutput(r.world, graph, 'tap')).toBe(false);
    // More hits, more ticks, and a second release attempt: no second signal.
    r.hit(rope, 'pierce', 100);
    r.steps(5);
    expect(releaseSupport(r.world, rope, 'overload')).toBe(false);
    expect(received.filter((e) => e.node === 'drop' && e.value)).toHaveLength(1);
    expect(r.releases).toHaveLength(1);
  });

  it('a support linked to a mechanism signals it when burnt away too', () => {
    const r = rig();
    const { rope } = r.hang('straw');
    const { graph } = levers(rope, r.world);
    setProperty(r.world, rope, 'temperature', 400);
    r.steps(300);
    expect(r.releases[0]?.cause).toBe('burnt');
    expect(signalOutput(r.world, graph, 'rope')).toBe(true);
  });

  it('a counterweight hung from a support is tripped as it falls, blamed on the cutter', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.hit(rope, 'slash', 100, 7);
    r.steps(2);
    expect(r.dropped).toEqual([weight]);
    expect(readProperty(r.world, weight, 'suspended')).toBe(false);
  });

  it('validates the anchors, radius and rating', () => {
    const r = rig();
    const e = r.world.spawn();
    expect(() => {
      makeSupport(r.world, e, v(0, 1, 0), v(0, 1, 0));
    }).toThrow(RangeError);
    expect(() => {
      makeSupport(r.world, e, v(0, 1, 0), v(0, 0, 0), { radius: 0 });
    }).toThrow(RangeError);
    expect(() => {
      makeSupport(r.world, e, v(0, 1, 0), v(0, 0, 0), { rating: 0 });
    }).toThrow(RangeError);
    expect(() => {
      linkSpan(r.world, [e]);
    }).toThrow(/not a support/);
  });

  it('places a support at its middle, its reach no wider than MAX_SUPPORT_REACH, with the default radius', () => {
    const r = rig();
    const long = r.world.spawn();
    makeSupport(r.world, long, v(0, 1, 0), v(10, 1, 0));
    const short = r.world.spawn();
    makeSupport(r.world, short, v(0, 4, 0), v(0, 3.5, 0));
    r.steps(1);
    expect(r.world.get(long, SupportComponent)?.radius).toBe(DEFAULT_SUPPORT_RADIUS);
    expect(readProperty(r.world, long, 'hp')).toBe(100); // the generic default, set as its own
    r.hit(long, 'pierce', 1);
    // A spatial strike 3 m along the rope does not reach its middle's placement.
    applyStimulus(r.world, {
      shape: { kind: 'sphere', center: v(8, 1, 0), radius: 0.3 },
      element: 'pierce',
      intensity: 1000,
    });
    r.steps(2);
    expect(r.releases).toEqual([]);
    expect(MAX_SUPPORT_REACH).toBeLessThan(5);
  });

  describe('rope bridge', () => {
    it('AC-4: over its 150 kg rating the weakest rope snaps and the planks fall', () => {
      const r = rig();
      const { ropes, planks } = r.bridge(150, [30, 12]);
      r.steps(60);
      expect(planks.every((p) => Math.abs(r.heightOf(p) - 1.05) < 0.01)).toBe(true);
      expect(r.releases).toEqual([]);
      // 24 kg of planks and a 120 kg crate: 144 kg, under the rating.
      const light = r.drop(120, v(3, 1.4, 0));
      r.steps(120);
      expect(r.releases).toEqual([]);
      expect(r.heightOf(light)).toBeGreaterThan(1.1);
      // A 10 kg sack more: 154 kg.
      r.drop(10, v(2, 1.4, 0), 0.1);
      r.steps(120);
      expect(r.releases).toHaveLength(1);
      expect(r.releases[0]).toMatchObject({ entity: ropes[1], cause: 'overload', source: null });
      expect(r.releases[0]?.held).toEqual(planks);
      expect(r.releases[0]?.load).toBeCloseTo(154, 5);
      // The whole span goes: both ropes, every plank, and the crate that rested on them.
      expect(ropes.every((rope) => !r.world.isAlive(rope))).toBe(true);
      expect(r.dropped).toEqual(planks);
      expect(planks.every((p) => r.heightOf(p) < 0.5)).toBe(true);
      expect(r.heightOf(light)).toBeLessThan(0.6);
    });

    it('AC-4: a bridge under its rating stands, and a lighter rope does not decide it', () => {
      const r = rig();
      const { planks } = r.bridge(150);
      r.drop(100, v(3, 1.4, 0));
      r.steps(240);
      expect(r.releases).toEqual([]);
      expect(planks.every((p) => Math.abs(r.heightOf(p) - 1.05) < 0.01)).toBe(true);
    });

    it('snaps the lowest-id rope when both are as weak', () => {
      const r = rig();
      const { ropes } = r.bridge(100);
      r.drop(140, v(3, 1.4, 0));
      r.steps(60);
      expect(r.releases[0]?.entity).toBe(ropes[0]);
    });

    it('cutting one rope takes the span down: the other rope goes, the planks fall', () => {
      const r = rig();
      const { ropes, planks } = r.bridge(150);
      r.hit(ropes[1]!, 'pierce', 100, 4);
      r.steps(120);
      expect(r.releases).toMatchObject([{ entity: ropes[1], cause: 'damage', source: 4 }]);
      expect(r.world.isAlive(ropes[0]!)).toBe(false);
      expect(planks.every((p) => r.heightOf(p) < 0.5)).toBe(true);
    });

    it('a rope worn to 0 hp in the same tick as an overload releases once', () => {
      const r = rig();
      const { ropes } = r.bridge(150);
      r.drop(200, v(3, 1.4, 0));
      setProperty(r.world, ropes[1]!, 'hp', 0);
      r.steps(5);
      expect(r.releases).toHaveLength(1);
      expect(r.releases[0]?.cause).toBe('damage');
    });

    it('wakes and counts an actor on a plank, and an actor without a body falls with the bridge', () => {
      const r = rig();
      const { planks, ropes } = r.bridge(150);
      const knight = r.world.spawn();
      tagEntity(r.world, knight, 'player');
      addProperties(r.world, knight, { weight: 90 });
      placeEntity(r.world, knight, v(2, 1.1 + 0.9, 0), 0.9);
      r.steps(2);
      const load = weighSpan(r.world, heldBy(r.world, ropes[0]!));
      expect(load.resting).toEqual([knight]);
      expect(load.weight).toBe(24 + 90);
      expect(r.releases).toEqual([]);
      // A rotated plank still counts its footprint.
      expect(heldBy(r.world, ropes[1]!)).toEqual(planks);
    });
  });

  it('a span with one rated rope is rated by that rope, and an actor on it falls with it', () => {
    const r = rig();
    const loose = r.world.spawn();
    const rated = r.world.spawn();
    for (const [rope, z] of [
      [loose, -0.6],
      [rated, 0.6],
    ] as const) {
      addMaterialProperties(r.world, rope, PRESETS, { material: 'rope' });
      makeSupport(r.world, rope, v(0, 1, z), v(6, 1, z), rope === rated ? { rating: 50 } : {});
    }
    linkSpan(r.world, [loose, rated]);
    r.steps(1);
    const plank = r.world.spawn();
    addProperties(r.world, plank, { weight: 2 });
    addPhysicsObject(r.world, plank, {
      shape: { kind: 'box', halfExtents: v(0.5, 0.05, 0.6) },
      position: v(3, 1.05, 0),
    });
    r.steps(1);
    suspendFrom(r.world, plank, loose);
    const knight = r.world.spawn();
    tagEntity(r.world, knight, 'player');
    addProperties(r.world, knight, { weight: 90 });
    placeEntity(r.world, knight, v(3, 1.1 + 0.9, 0), 0.9);
    r.steps(5);
    expect(r.releases).toMatchObject([
      { entity: loose, cause: 'overload', held: [plank], load: 92 },
    ]);
    expect(r.world.isAlive(rated)).toBe(false);
  });

  it('two overloaded spans in the same tick both snap, the lower first', () => {
    const r = rig();
    const near = r.bridge(150);
    const far = r.bridge(150, [30, 30], 5);
    r.world.step();
    for (const z of [5, 0]) {
      const crate = r.world.spawn();
      addProperties(r.world, crate, { weight: 200 });
      addPhysicsObject(r.world, crate, {
        shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
        position: v(3, 1.3, z),
        properties: { weight: 200, friction: 0.5, impactAbsorb: 0 },
      });
    }
    r.steps(3);
    expect(r.releases.map((e) => e.entity)).toEqual([near.ropes[0], far.ropes[0]]);
  });

  it('lets go of a body whose physics object is already gone', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    removePhysicsObject(r.world, weight);
    r.steps(1);
    expect(releaseSupport(r.world, rope, 'damage')).toBe(true);
    r.steps(1);
    expect(r.dropped).toEqual([weight]);
  });

  it('does not count what is beside what hangs, even inside its bounds', () => {
    const r = rig();
    const rope = r.world.spawn();
    makeSupport(r.world, rope, v(0, 1, 0), v(6, 1, 0), { rating: 1000 });
    r.steps(1);
    const ends = [0.5, 5.5].map((x) => {
      const plank = r.world.spawn();
      addProperties(r.world, plank, { weight: 2 });
      addPhysicsObject(r.world, plank, {
        shape: { kind: 'box', halfExtents: v(0.25, 0.05, 0.6) },
        position: v(x, 1.05, 0),
      });
      return plank;
    });
    r.steps(1);
    for (const plank of ends) suspendFrom(r.world, plank, rope);
    // A crate level with the planks' tops, in the gap between them.
    r.drop(50, v(3, 1.3, 0));
    r.steps(1);
    expect(weighSpan(r.world, ends)).toEqual({ resting: [], weight: 4 });
    expect(r.releases).toEqual([]);
  });

  it('counts a body resting across a gap, centred over it, on what it touches', () => {
    const r = rig();
    const { planks } = r.bridge(150);
    // 4 cm gaps between planks would let a point-like test miss a body centred on one.
    const gap = r.drop(30, v(0.5, 1.3, 0), 0.2);
    r.steps(1);
    expect(weighSpan(r.world, planks).resting).toEqual([gap]);
  });

  it('keeps a held body at its pinned mass when its weight changes', () => {
    const r = rig();
    const { weight } = r.hang();
    const body = (r.world.get(weight, PhysicsObjectComponent) as { body: number }).body;
    const port = rigidBodiesOf(r.world);
    expect(port.motionOf(body as never).mass).toBe(PINNED_MASS);
    setProperty(r.world, weight, 'weight', 40); // soaked through
    r.steps(2);
    expect(port.motionOf(body as never).mass).toBe(PINNED_MASS);
  });

  it('gives a body back its own mass when it is let go', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    r.hit(rope, 'slash', 100);
    r.steps(2);
    const body = (r.world.get(weight, PhysicsObjectComponent) as { body: number }).body;
    expect(rigidBodiesOf(r.world).motionOf(body as never).mass).toBe(20);
  });

  it('weighs what hangs, and nothing resting when the hanging bodies have no body left', () => {
    const r = rig();
    const { rope, weight } = r.hang();
    const rock = r.drop(30, v(0, 1.8 + 0.2 + 0.4, 0), 0.2);
    r.steps(30);
    expect(heldBy(r.world, rope)).toEqual([weight]);
    expect(weighSpan(r.world, [weight])).toMatchObject({ resting: [rock], weight: 50 });
    removePhysicsObject(r.world, weight);
    r.steps(1);
    expect(weighSpan(r.world, [weight])).toEqual({ resting: [], weight: 20 });
    expect(heldBy(r.world, r.world.spawn())).toEqual([]);
  });

  it('measures a hanging sphere or capsule by its own extent', () => {
    const r = rig();
    const rope = r.world.spawn();
    makeSupport(r.world, rope, v(0, 4, 0), v(0, 3, 0));
    const ball = r.world.spawn();
    const pill = r.world.spawn();
    r.steps(1);
    addPhysicsObject(r.world, ball, {
      shape: { kind: 'sphere', radius: 0.3 },
      position: v(0, 2.7, 0),
    });
    addPhysicsObject(r.world, pill, {
      shape: { kind: 'capsule', halfHeight: 0.3, radius: 0.2 },
      position: v(3, 2.5, 0),
    });
    r.steps(1);
    suspendFrom(r.world, ball, rope);
    suspendFrom(r.world, pill, rope);
    r.steps(1);
    const rider = r.drop(5, v(0, 3.1, 0), 0.1);
    expect(weighSpan(r.world, [ball, pill]).resting).toEqual([rider]);
  });

  it('replays to the same state', () => {
    const run = () => {
      const r = rig();
      r.bridge(150, [30, 12]);
      r.drop(160, v(3, 1.4, 0));
      r.steps(180);
      return r.world.snapshot();
    };
    expect(run()).toEqual(run());
  });
});
