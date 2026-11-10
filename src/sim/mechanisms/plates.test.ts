// Pressure plates (mw-e03.19): weight from everything resting on them, windows, hysteresis, arming,
// latching, carried and levitated weight, on the real deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { CarryLedgerComponent, type Hold } from '../carry/state';
import { box } from '../character/greybox';
import { CreatureComponent } from '../creatures/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addGravityZone,
  gravityScaleOf,
  holdRemotely,
  installRemoteHold,
} from '../magic/remote-hold';
import { addPhysicsObject, installPhysicsObjects, removePhysicsObject } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, registerWorldProperties } from '../properties/components';
import { tagEntity } from '../signals/filter';
import type { SignalGraphDef } from '../signals/graph';
import {
  addSignalGraph,
  installSignals,
  pressButton,
  signalOutput,
  signalSystem,
} from '../signals/runtime';
import { PlacementComponent, placeEntity, setPlacementCentre } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  makePlate,
  plateChanged,
  PlateComponent,
  resetPlate,
  syncPlateNodes,
  weighPlate,
  type PlateChange,
  type PlateOptions,
  type PlateSpec,
} from './plates';
import { installMechanisms } from './system';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function rig(options: PlateOptions = {}) {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 4, hz: 60, physics }))),
  );
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  installRemoteHold(world);
  installMechanisms(world, { plates: options });
  const changes: PlateChange[] = [];
  world.events.on(plateChanged, (e) => changes.push(e));
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  /** A plate whose top is the floor, 1 m square, centred on the origin. */
  const plate = (spec: Partial<PlateSpec> = {}): EntityId => {
    const entity = world.spawn();
    makePlate(world, entity, v(0, 0, 0), spec);
    world.step();
    return entity;
  };
  /** A body of `weight` kg that settles on the floor at x, z. */
  const body = (weight: number, x = 0, z = 0, props: Record<string, unknown> = {}): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { weight, liftable: true, ...props });
    addPhysicsObject(world, entity, {
      shape: { kind: 'sphere', radius: 0.25 },
      position: v(x, 0.26, z),
    });
    return entity;
  };
  const on = (entity: EntityId): boolean => world.get(entity, PlateComponent)?.active ?? false;
  return { world, physics, changes, steps, plate, body, on };
}

describe('pressure plates (mw-e03.19)', () => {
  it('AC-1: with min 40 kg a 25 kg and a 20 kg object together turn it on; removing the 20 kg one turns it off after hysteresis', () => {
    const r = rig();
    const p = r.plate({ minWeight: 40, hysteresis: 5 });
    const crate = r.body(25, -0.3, 0);
    const barrel = r.body(20, 0.3, 0);
    r.steps(30);
    expect(weighPlate(r.world, p).weight).toBe(45);
    expect(weighPlate(r.world, p).resting).toEqual([crate, barrel]);
    expect(r.on(p)).toBe(true);
    removePhysicsObject(r.world, barrel);
    r.steps(3);
    expect(r.on(p)).toBe(false);
    expect(r.changes.map((c) => [c.active, c.weight])).toEqual([
      [true, 45],
      [false, 25],
    ]);
  });

  it('hysteresis: a load just under the minimum keeps a plate that is on, but cannot turn one on', () => {
    const r = rig();
    const p = r.plate({ minWeight: 40, hysteresis: 5 });
    const light = r.body(38, 0.3, 0);
    r.steps(40);
    expect(r.on(p)).toBe(false); // 38 < 40: not on, and the margin does not turn it on
    const extra = r.body(5, -0.3, 0);
    r.steps(40);
    expect(r.on(p)).toBe(true); // 43
    removePhysicsObject(r.world, extra);
    r.steps(3);
    expect(r.on(p)).toBe(true); // 38 ≥ 40 − 5: held by the margin
    removePhysicsObject(r.world, light);
    r.steps(3);
    expect(r.on(p)).toBe(false);
  });

  it('mw-e15.4: a box or a capsule resting on a floor plate counts by its body, not its bounding sphere', () => {
    const r = rig();
    const p = r.plate({ minWeight: 30 });
    const crate = r.world.spawn();
    addProperties(r.world, crate, { weight: 40, liftable: true });
    addPhysicsObject(r.world, crate, {
      shape: { kind: 'box', halfExtents: { x: 0.35, y: 0.35, z: 0.35 } },
      position: v(0, 0.36, 0),
    });
    r.steps(40);
    // The crate's bounding sphere reaches well under the floor; its underside is on it.
    expect(weighPlate(r.world, p).resting).toEqual([crate]);
    expect(r.on(p)).toBe(true);
    removePhysicsObject(r.world, crate);
    const post = r.world.spawn();
    addProperties(r.world, post, { weight: 50, liftable: true });
    addPhysicsObject(r.world, post, {
      shape: { kind: 'capsule', halfHeight: 0.4, radius: 0.3 },
      position: v(0, 0.71, 0),
    });
    r.steps(40);
    expect(weighPlate(r.world, p).resting).toEqual([post]);
  });

  it('AC-2: with a 40–60 kg window 70 kg does not turn it on; too heavy also turns a plate off', () => {
    const r = rig();
    const p = r.plate({ minWeight: 40, maxWeight: 60 });
    const heavy = r.body(70);
    r.steps(40);
    expect(weighPlate(r.world, p).weight).toBe(70);
    expect(r.on(p)).toBe(false);
    removePhysicsObject(r.world, heavy);
    const fine = r.body(50);
    r.steps(40);
    expect(r.on(p)).toBe(true);
    const more = r.body(20, 0.3, 0.3);
    r.steps(40);
    expect(weighPlate(r.world, p).weight).toBe(70);
    expect(r.on(p)).toBe(false);
    removePhysicsObject(r.world, more);
    removePhysicsObject(r.world, fine);
  });

  it('AC-3: an actor carrying a 10 kg object counts actor weight plus 10 kg', () => {
    const r = rig();
    const p = r.plate({ minWeight: 1 });
    const actor = r.world.spawn();
    addProperties(r.world, actor, { weight: 70 });
    placeEntity(r.world, actor, v(0, 0, 0), 0);
    tagEntity(r.world, actor, 'actor');
    const bundle = r.body(10, 0.2, 0.2); // in the actor's hands
    const crate = r.body(5, -0.3, -0.3); // beside the actor, not carried
    r.world.register(CarryLedgerComponent);
    const ledger = r.world.spawn();
    const hold: Hold = {
      actor,
      target: bundle,
      mode: 'hand',
      since: 0,
      speedScale: 1,
      noJump: false,
      charge: -1,
      burning: 0,
    };
    r.world.add(ledger, CarryLedgerComponent, { holds: [hold] });
    r.steps(30);
    // The carried object also touches the plate but is counted once, with its carrier.
    expect(weighPlate(r.world, p)).toEqual({ resting: [actor, crate], weight: 85 });
    expect(weighPlate(r.world, p, { gear: (_w, a) => (a === actor ? 12 : 0) }).weight).toBe(97);
    expect(r.on(p)).toBe(true);
  });

  it("AC-3: what an actor wears counts too, at the actor's gravity", () => {
    const r = rig({ gear: () => 30, gravityScale: () => 0.5 });
    const p = r.plate({ minWeight: 1 });
    const actor = r.world.spawn();
    addProperties(r.world, actor, { weight: 70 });
    placeEntity(r.world, actor, v(0.1, 0, 0), 0.9);
    setPlacementCentre(r.world, actor, v(0, 0.9, 0), 0.9);
    tagEntity(r.world, actor, 'player');
    r.steps(2);
    expect(weighPlate(r.world, p, { gear: () => 30, gravityScale: () => 0.5 }).weight).toBe(50);
    expect(r.world.get(p, PlateComponent)?.weight).toBe(50);
  });

  it('AC-4: an object under gravity scale 0 touching the plate counts 0 kg; held remotely it does too', () => {
    const r = rig({ gravityScale: gravityScaleOf });
    const p = r.plate({ minWeight: 10 });
    const floater = r.body(50);
    r.steps(30);
    expect(r.on(p)).toBe(true);
    const zone = addGravityZone(r.world, {
      min: v(-3, -1, -3),
      max: v(3, 3, 3),
      scale: 0,
    });
    r.steps(3);
    expect(gravityScaleOf(r.world, floater)).toBe(0);
    expect(weighPlate(r.world, p, { gravityScale: gravityScaleOf }).weight).toBe(0);
    expect(r.on(p)).toBe(false);
    expect(zone).toBeGreaterThanOrEqual(0);
  });

  it('AC-4: a body held by a spell at the plate counts 0 kg', () => {
    const r = rig({ gravityScale: gravityScaleOf });
    const p = r.plate({ minWeight: 10 });
    const held = r.body(50);
    r.steps(30);
    expect(r.on(p)).toBe(true);
    const caster = r.world.spawn();
    expect(holdRemotely(r.world, caster, held, v(0, 0.26, 0), 100)).toEqual({ ok: true });
    r.steps(2);
    expect(r.on(p)).toBe(false);
  });

  it('AC-4: a doubled gravity zone doubles the weight', () => {
    const r = rig({ gravityScale: gravityScaleOf });
    const p = r.plate({ minWeight: 10 });
    r.body(30);
    addGravityZone(r.world, { min: v(-3, -1, -3), max: v(3, 3, 3), scale: 2 });
    r.steps(30);
    expect(weighPlate(r.world, p, { gravityScale: gravityScaleOf }).weight).toBeCloseTo(60, 6);
  });

  it('AC-5: a latching plate stays on after the weight is removed until a signal resets it', () => {
    const r = rig();
    const graph: SignalGraphDef = {
      id: 'trap',
      nodes: [
        { id: 'plate', kind: 'lever', entity: 'floor-plate' },
        { id: 'reset-button', kind: 'button' },
        { id: 'reset', kind: 'receiver', receiver: 'mechanism', entity: 'floor-plate' },
      ],
      wires: [{ from: 'reset-button.out', to: 'reset.in' }],
    };
    const p = r.plate({ minWeight: 10, mode: 'latching' });
    const g = addSignalGraph(r.world, graph, {
      bindings: { 'floor-plate': p },
    });
    syncPlateNodes(r.world, p);
    const crate = r.body(20);
    r.steps(30);
    expect(r.on(p)).toBe(true);
    removePhysicsObject(r.world, crate);
    r.steps(30);
    expect(r.on(p)).toBe(true); // no weight, still on
    expect(signalOutput(r.world, g, 'plate')).toBe(true);
    expect(r.world.get(p, PlateComponent)?.weight).toBe(0);
    pressButton(r.world, g, 'reset-button');
    r.steps(3);
    expect(r.on(p)).toBe(false);
    expect(signalOutput(r.world, g, 'plate')).toBe(false);
    expect(r.changes.at(-1)?.source).toBe(g);
    expect(resetPlate(r.world, p)).toBe(false); // already off
    expect(resetPlate(r.world, r.world.spawn())).toBe(false); // not a plate
  });

  it('an arming delay needs the load to stay in the window without a break', () => {
    const r = rig();
    const p = r.plate({ minWeight: 10, armSeconds: 0.5 });
    const crate = r.body(20);
    r.steps(20);
    expect(r.on(p)).toBe(false);
    expect(r.world.get(p, PlateComponent)?.arming).toBeGreaterThan(0);
    removePhysicsObject(r.world, crate); // a bounce: the delay starts over
    r.steps(3);
    expect(r.world.get(p, PlateComponent)?.arming).toBe(0);
    r.body(20);
    r.steps(25);
    expect(r.on(p)).toBe(false);
    r.steps(15);
    expect(r.on(p)).toBe(true);
  });

  it('ignores what does not rest on the footprint, and things that are not bodies or actors', () => {
    const r = rig();
    const p = r.plate({ minWeight: 1, width: 1, depth: 2 });
    r.body(5, 0.8, 0); // beside it
    r.body(5, 0, 1.2); // beyond its depth
    r.body(5, 0, 0.9); // on its long edge
    r.body(5, 0, 0);
    const marker = r.world.spawn(); // placed, has a weight, but is neither a body nor an actor
    addProperties(r.world, marker, { weight: 99 });
    placeEntity(r.world, marker, v(0, 0, 0), 0);
    const high = r.world.spawn(); // an actor standing on a ledge a metre up
    addProperties(r.world, high, { weight: 70 });
    placeEntity(r.world, high, v(0, 1, 0), 0);
    tagEntity(r.world, high, 'actor');
    r.steps(30);
    expect(weighPlate(r.world, p).weight).toBe(10);
    expect(r.world.get(p, PlateComponent)?.hidden).toBe(false);
  });

  it('a hidden plate is the trap variant: it reports itself hidden and still drives its signals', () => {
    const r = rig();
    const graph: SignalGraphDef = {
      id: 'dart-trap',
      nodes: [{ id: 'tripped', kind: 'lever', entity: 'trap-plate', observed: true }],
      wires: [],
    };
    const p = r.plate({ minWeight: 20, hidden: true });
    const g = addSignalGraph(r.world, graph, { bindings: { 'trap-plate': p } });
    r.body(30);
    r.steps(30);
    expect(r.changes).toMatchObject([{ active: true, hidden: true, mode: 'momentary' }]);
    expect(signalOutput(r.world, g, 'tripped')).toBe(true);
  });

  it('refuses a plate with a window, margin, delay or footprint that makes no sense', () => {
    const r = rig();
    const bad = (spec: Partial<PlateSpec>) => () => {
      makePlate(r.world, r.world.spawn(), v(0, 0, 0), spec);
    };
    expect(bad({ minWeight: 0 })).toThrow(/minimum weight/);
    expect(bad({ minWeight: 10, maxWeight: 5 })).toThrow(/at most/);
    expect(bad({ hysteresis: -1 })).toThrow(/hysteresis/);
    expect(bad({ armSeconds: -1 })).toThrow(/arming/);
    expect(bad({ width: 0 })).toThrow(/footprint/);
    expect(bad({ depth: Number.NaN })).toThrow(/footprint/);
  });

  it('a plate keeps the placement it already has, and drives only the lever nodes bound to it', () => {
    const r = rig();
    const entity = r.world.spawn();
    placeEntity(r.world, entity, v(0, 0, 0), 0.5);
    makePlate(r.world, entity, v(0, 0, 0), { minWeight: 10 });
    r.world.step();
    expect(r.world.get(entity, PlacementComponent)?.radius).toBe(0.5);
    const graph: SignalGraphDef = {
      id: 'both',
      nodes: [
        { id: 'level', kind: 'lever', entity: 'p', observed: true },
        { id: 'tap', kind: 'button', entity: 'p', observed: true },
      ],
      wires: [],
    };
    const g = addSignalGraph(r.world, graph, { bindings: { p: entity } });
    syncPlateNodes(r.world, entity);
    r.body(20);
    r.steps(30);
    expect(signalOutput(r.world, g, 'level')).toBe(true);
    expect(signalOutput(r.world, g, 'tap')).toBe(false);
  });

  it('a creature on a plate is weighed like any actor', () => {
    const r = rig();
    const p = r.plate({ minWeight: 1 });
    r.world.register(CreatureComponent);
    const wolf = r.world.spawn();
    r.world.add(wolf, CreatureComponent, {} as never);
    addProperties(r.world, wolf, { weight: 35 });
    placeEntity(r.world, wolf, v(0, 0, 0), 0);
    r.steps(2);
    expect(weighPlate(r.world, p)).toEqual({ resting: [wolf], weight: 35 });
  });

  it('mw-e15.4: in a world with no physics objects an actor on a plate is weighed by its bounding sphere', () => {
    const world = installSignals(
      installStimuli(registerWorldProperties(new World<never>({ seed: 4, hz: 60 }))),
    );
    world.addSystem(stimulusSystem()).addSystem(signalSystem());
    installMechanisms(world);
    const plate = world.spawn();
    makePlate(world, plate, v(0, 0, 0), { minWeight: 10 });
    const hero = world.spawn();
    addProperties(world, hero, { weight: 70 });
    tagEntity(world, hero, 'player');
    placeEntity(world, hero, v(0, 0, 0), 0);
    world.step();
    expect(weighPlate(world, plate)).toEqual({ resting: [hero], weight: 70 });
  });

  it('syncPlateNodes does nothing for what is not a plate', () => {
    const r = rig();
    expect(() => {
      syncPlateNodes(r.world, r.world.spawn());
    }).not.toThrow();
  });
});
