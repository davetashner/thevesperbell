// Impact switches (mw-e03.20): filters, hit zones, prefabs, edges and outputs. Thrown objects run on
// the real deterministic Rapier build; arrows, strikes and spells arrive as their own events.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { arrowImpact, type ArrowImpactInfo } from '../combat/arrows/events';
import { blame, BlameComponent } from '../combat/environment/environment';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { addPhysicsObject, installPhysicsObjects, physicsImpact } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, registerWorldProperties } from '../properties/components';
import type { SignalGraphDef } from '../signals/graph';
import {
  addSignalGraph,
  installSignals,
  pressButton,
  signalOutput,
  signalSystem,
} from '../signals/runtime';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import type { StimulusShape, Vec3 } from '../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  BELL_LOUDNESS,
  deliverImpact,
  IMPACT_SWITCH_PREFABS,
  ImpactSwitchComponent,
  impactSwitchChanged,
  makeImpactSwitch,
  passesFilter,
  releaseImpactSwitch,
  resetImpactSwitch,
  syncImpactSwitchNodes,
  type Impact,
  type ImpactSwitchChange,
  type ImpactSwitchSpec,
  type ImpactSwitchVariant,
} from './impacts';
import { installMechanisms } from './system';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const ORIGIN = v(0, 2, 0);

function rig() {
  const physics = new RapierPhysics(RAPIER);
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 5, hz: 60, physics }))),
  );
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  world.addSystem(stimulusSystem()).addSystem(signalSystem());
  installMechanisms(world);
  const changes: ImpactSwitchChange[] = [];
  const noises: NoiseEvent[] = [];
  world.events.on(impactSwitchChanged, (e) => changes.push(e));
  world.events.on(noiseEmitted, (e) => noises.push(e));
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  const make = (
    variant: ImpactSwitchVariant,
    spec: Partial<Omit<ImpactSwitchSpec, 'variant'>> = {},
    at: Vec3 = ORIGIN,
  ): EntityId => {
    const entity = world.spawn();
    makeImpactSwitch(world, entity, at, variant, spec);
    world.step();
    return entity;
  };
  const on = (entity: EntityId): boolean =>
    world.get(entity, ImpactSwitchComponent)?.active ?? false;
  const stimulate = (
    element: 'heat' | 'charge' | 'light' | 'force' | 'slash' | 'gas',
    shape: StimulusShape,
    intensity = 10,
    source: EntityId | null = null,
  ): void => {
    applyStimulus(world, {
      shape,
      element,
      intensity,
      source,
      ...(element === 'gas' && { gas: 'smoke' }),
    });
    world.step();
  };
  return { world, changes, noises, steps, make, on, stimulate };
}

const impact = (over: Partial<Impact> = {}): Impact => ({
  position: ORIGIN,
  energy: 25,
  damageType: 'pierce',
  element: null,
  source: null,
  ...over,
});

const arrow = (position: Vec3, energy: number, outcome: ArrowImpactInfo['outcome'] = 'stick') =>
  ({
    tick: 0,
    entity: 1,
    arrow: 'broadhead',
    shooter: null,
    other: null,
    material: 'generic',
    hardness: 'soft',
    outcome,
    speed: 40,
    energy,
    impulse: 0,
    normal: v(0, 0, 1),
    position,
  }) as unknown as ArrowImpactInfo;

describe('impact switches (mw-e03.20)', () => {
  it('AC-1: a bullseye with a pierce filter and min 20 J activates on a 25 J pierce hit inside its zone, and not 5 cm outside', () => {
    const r = rig();
    const target = r.make('bullseye', { minEnergy: 20, radius: 0.1 });
    r.world.events.emit(arrowImpact, arrow(v(0.15, 2, 0), 25)); // 5 cm outside the zone
    r.steps(2);
    expect(r.on(target)).toBe(false);
    r.world.events.emit(arrowImpact, arrow(v(0.05, 2, 0), 25));
    r.steps(1);
    expect(r.on(target)).toBe(true);
    expect(r.changes).toMatchObject([{ entity: target, variant: 'bullseye', active: true }]);
  });

  it('a bullseye ignores a hit that is too weak, a blunt one and a spell', () => {
    const r = rig();
    const target = r.make('bullseye');
    r.world.events.emit(arrowImpact, arrow(ORIGIN, 15));
    r.world.events.emit(arrowImpact, arrow(ORIGIN, 30, 'drop')); // a blunt glance
    r.stimulate('heat', { kind: 'sphere', center: ORIGIN, radius: 1 }, 50);
    expect(r.on(target)).toBe(false);
  });

  it('AC-2: a bell set to any impact activates on a thrown object of 5 J or more and emits a noise event with loudness 1.0', () => {
    const r = rig();
    const bell = r.make('bell', { loudness: 1 }, v(0, 0.3, 0));
    const stone = r.world.spawn();
    addProperties(r.world, stone, { weight: 2, liftable: true });
    addPhysicsObject(r.world, stone, {
      shape: { kind: 'sphere', radius: 0.1 },
      position: v(0, 1.5, 0),
    });
    r.steps(60);
    expect(r.on(bell)).toBe(true);
    expect(r.noises).toHaveLength(1);
    expect(r.noises[0]).toMatchObject({ loudness: 1.0, kind: 'bell', entity: bell });
  });

  it('a bell rings at its prefab loudness, but a feather does not move it', () => {
    const r = rig();
    const bell = r.make('bell');
    r.world.events.emit(physicsImpact, {
      entity: 99,
      other: null,
      materials: ['generic', 'generic'],
      energy: 1,
      impulse: 1,
      speed: 1,
      normal: v(0, 1, 0),
      position: ORIGIN,
    });
    expect(r.on(bell)).toBe(false);
    expect(r.noises).toHaveLength(0);
    deliverImpact(r.world, impact({ damageType: 'blunt', energy: 8 }));
    r.steps(1);
    expect(r.noises).toMatchObject([{ loudness: BELL_LOUDNESS, position: ORIGIN }]);
  });

  it('a thrown body and a shove are blamed on whoever threw them', () => {
    const r = rig();
    const bell = r.make('bell');
    const thrower = r.world.spawn();
    const dagger = r.world.spawn();
    r.world.register(BlameComponent);
    blame(r.world, dagger, thrower);
    r.world.step();
    r.world.events.emit(physicsImpact, {
      entity: dagger,
      other: null,
      materials: ['generic', 'generic'],
      energy: 9,
      impulse: 1,
      speed: 5,
      normal: v(0, 1, 0),
      position: ORIGIN,
    });
    r.steps(1);
    expect(r.changes).toMatchObject([{ entity: bell, source: thrower }]);
    resetImpactSwitch(r.world, bell);
    r.stimulate('force', { kind: 'sphere', center: ORIGIN, radius: 0.5 }, 9, thrower);
    expect(r.on(bell)).toBe(true);
    expect(r.changes.at(-1)?.source).toBe(thrower);
  });

  it('AC-3: a crystal with a charge filter ignores a heat stimulus and activates on a charge stimulus', () => {
    const r = rig();
    const crystal = r.make('crystal', { elements: ['charge'] });
    r.stimulate('heat', { kind: 'sphere', center: ORIGIN, radius: 1 }, 100);
    expect(r.on(crystal)).toBe(false);
    r.stimulate('charge', { kind: 'sphere', center: ORIGIN, radius: 1 }, 5);
    expect(r.on(crystal)).toBe(true);
  });

  it('the crystal prefab takes light too, and nothing out of reach or off-element hits it', () => {
    const r = rig();
    const crystal = r.make('crystal');
    r.stimulate('light', { kind: 'sphere', center: v(10, 2, 0), radius: 1 }); // too far
    r.stimulate('slash', { kind: 'sphere', center: ORIGIN, radius: 1 }); // a blow, not light
    r.stimulate('gas', { kind: 'sphere', center: ORIGIN, radius: 1 }); // acts on the gas field
    r.stimulate('light', { kind: 'contact', target: crystal }); // the echo of another hit
    expect(r.on(crystal)).toBe(false);
    r.stimulate('light', { kind: 'point', at: ORIGIN });
    expect(r.on(crystal)).toBe(true);
  });

  it('AC-4: several hits in one tick on a momentary switch produce exactly one activation event', () => {
    const r = rig();
    const bell = r.make('bell');
    for (let i = 0; i < 4; i++) deliverImpact(r.world, impact({ damageType: 'blunt' }));
    r.stimulate('force', { kind: 'sphere', center: ORIGIN, radius: 1 }, 20);
    r.steps(1);
    expect(r.changes.filter((c) => c.active)).toHaveLength(1);
    expect(r.on(bell)).toBe(true);
  });

  it('a bell rings once for the hits of one tick, but again on the next', () => {
    const r = rig();
    r.make('bell');
    deliverImpact(r.world, impact({ damageType: 'blunt' }));
    deliverImpact(r.world, impact({ damageType: 'blunt' }));
    r.steps(1);
    expect(r.noises).toHaveLength(1);
    deliverImpact(r.world, impact({ damageType: 'blunt' }));
    r.steps(1);
    expect(r.noises).toHaveLength(2);
  });

  it('a momentary switch lets go holdSeconds after the last hit, and a new hit holds it longer', () => {
    const r = rig();
    const target = r.make('bullseye', { holdSeconds: 0.5 });
    deliverImpact(r.world, impact());
    r.steps(20);
    expect(r.on(target)).toBe(true);
    deliverImpact(r.world, impact()); // renews the hold without a second edge
    r.steps(20);
    expect(r.on(target)).toBe(true);
    r.steps(15);
    expect(r.on(target)).toBe(false);
    expect(r.changes.map((c) => c.active)).toEqual([true, false]);
  });

  it('a latching switch stays on until a signal resets it', () => {
    const r = rig();
    const graph: SignalGraphDef = {
      id: 'bridge',
      nodes: [
        { id: 'target', kind: 'lever', entity: 'target', observed: true },
        { id: 'reset-button', kind: 'button' },
        { id: 'reset', kind: 'receiver', receiver: 'mechanism', entity: 'target' },
        { id: 'also', kind: 'button', entity: 'target', observed: true },
      ],
      wires: [{ from: 'reset-button.out', to: 'reset.in' }],
    };
    const sw = r.make('counterweight');
    const g = addSignalGraph(r.world, graph, { bindings: { target: sw } });
    syncImpactSwitchNodes(r.world, sw);
    expect(signalOutput(r.world, g, 'target')).toBe(false);
    deliverImpact(r.world, impact({ damageType: 'slash', energy: 5 }));
    r.steps(120);
    expect(r.on(sw)).toBe(true);
    expect(signalOutput(r.world, g, 'target')).toBe(true);
    expect(signalOutput(r.world, g, 'also')).toBe(false); // buttons are not its outputs
    syncImpactSwitchNodes(r.world, r.world.spawn()); // not a switch: nothing
    pressButton(r.world, g, 'reset-button');
    r.steps(3);
    expect(r.on(sw)).toBe(false);
    expect(signalOutput(r.world, g, 'target')).toBe(false);
    expect(r.changes.at(-1)).toMatchObject({ active: false, source: g });
    expect(resetImpactSwitch(r.world, sw)).toBe(false);
  });

  it('a counterweight is released by its rope whatever the filter says', () => {
    const r = rig();
    const weight = r.make('counterweight');
    deliverImpact(r.world, impact({ damageType: 'blunt', energy: 50 }));
    expect(r.on(weight)).toBe(false); // a thrown rock does not cut the rope
    expect(releaseImpactSwitch(r.world, weight, 7)).toBe(true);
    expect(r.on(weight)).toBe(true);
    r.steps(1);
    expect(r.changes).toMatchObject([{ active: true, source: 7 }]);
    expect(releaseImpactSwitch(r.world, weight)).toBe(false); // already down
    expect(releaseImpactSwitch(r.world, r.world.spawn())).toBe(false); // not a switch
  });

  it('a filter passes an impact by its damage type or its element, above the minimum energy', () => {
    const filter = { minEnergy: 5, damageTypes: ['blunt'], elements: ['heat'] } as const;
    expect(passesFilter(filter, impact({ damageType: 'blunt', energy: 5 }))).toBe(true);
    expect(passesFilter(filter, impact({ damageType: null, element: 'heat' }))).toBe(true);
    expect(passesFilter(filter, impact({ damageType: 'blunt', energy: 4 }))).toBe(false);
    expect(passesFilter(filter, impact({ damageType: 'slash' }))).toBe(false);
    expect(passesFilter(filter, impact({ damageType: null, element: 'cold' }))).toBe(false);
  });

  it('a designer may open a bullseye to anything: a thrown shield or a Mage Hand shove counts', () => {
    const r = rig();
    const target = r.make('bullseye', {
      minEnergy: 0,
      damageTypes: ['blunt', 'slash', 'pierce'],
      elements: ['force'],
      radius: 1,
    });
    r.stimulate('force', { kind: 'sphere', center: v(0.5, 2, 0), radius: 0.2 }, 0.5);
    expect(r.on(target)).toBe(true);
  });

  it('refuses a switch that accepts nothing or has a zone, energy, hold or noise that makes no sense', () => {
    const r = rig();
    const bad = (spec: Partial<Omit<ImpactSwitchSpec, 'variant'>>) => () => {
      makeImpactSwitch(r.world, r.world.spawn(), ORIGIN, 'bullseye', spec);
    };
    expect(bad({ damageTypes: [] })).toThrow(/some damage type or element/);
    expect(bad({ minEnergy: -1 })).toThrow(/minimum energy/);
    expect(bad({ radius: 0 })).toThrow(/hit zone/);
    expect(bad({ holdSeconds: -1 })).toThrow(/hold/);
    expect(bad({ loudness: -3 })).toThrow(/loudness/);
    expect(() => {
      makeImpactSwitch(r.world, r.world.spawn(), ORIGIN, 'gong' as ImpactSwitchVariant);
    }).toThrow(/unknown impact switch variant/);
  });

  it('keeps the placement it already has, and the prefabs are frozen', () => {
    const r = rig();
    const entity = r.world.spawn();
    placeEntity(r.world, entity, ORIGIN, 0.5);
    makeImpactSwitch(r.world, entity, ORIGIN, 'crystal');
    r.world.step();
    expect(r.world.get(entity, PlacementComponent)?.radius).toBe(0.5);
    expect(Object.isFrozen(IMPACT_SWITCH_PREFABS.bell.damageTypes)).toBe(true);
  });
});
