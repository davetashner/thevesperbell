import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { installBreakables, breakThreshold } from '../breakables/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { fireRules } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import type { FieldConfigInput } from '../field/config';
import { elementFieldSystem, installElementField } from '../field/install';
import { DoorComponent, type DoorProfile } from '../mechanisms/components';
import { mechanismJammed, type MechanismJammed } from '../mechanisms/events';
import { installMechanisms, makeDoor, openDoor, refreshAffordances } from '../mechanisms/system';
import type { RigidBodyPort } from '../physics/bodies';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../physics/objects';
import { RapierCollisionWorld } from '../physics/rapier-collision-world';
import { RapierPhysics } from '../physics/rapier';
import type { PhysicsPort } from '../physics/port';
import { InMemoryColliderSink, type ColliderHandle } from '../physics/static-colliders';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import { breaksUnder } from '../properties/derived';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { placeEntity, type Placement } from '../stimulus/placement';
import type { StimulusShape } from '../stimulus/shapes';
import {
  applyStimulus,
  installStimuli,
  stimulusSystem,
  temperatureSign,
  STIMULUS_ELEMENTS,
} from '../stimulus/stimulus';
import {
  FreezeStateComponent,
  LiquidIceComponent,
  LiquidVolumeComponent,
  type LiquidIce,
} from './components';
import {
  DEFAULT_FREEZE_CONFIG,
  freezeRules,
  iceCellAt,
  installIce,
  resolveFreezeConfig,
  solidThickness,
  thickestIce,
  type FreezeConfig,
} from './ice';
import { liquidRules } from './rules';
import { createVolume, installLiquids, setDrainOpen, setFillOpen } from './volumes';

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['water', { wetness: 1, liquid: true, density: 1000, freezePoint: 0 }],
  [
    'oil',
    { flammable: true, ignitionPoint: 210, fuel: 3, liquid: true, density: 900, freezePoint: -20 },
  ],
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, hp: 100 }],
  ['generic', {}],
]);
const FIELD: FieldConfigInput = { maxChunks: 8 };
const DOWN = { x: 0, y: -1, z: 0 };
const UP = { x: 0, y: 1, z: 0 };

interface Options {
  readonly physics?: boolean;
  readonly freeze?: Partial<FreezeConfig>;
  readonly hz?: number;
}

function iceWorld({ physics = true, freeze, hz = 60 }: Options = {}) {
  const rapier = physics ? new RapierPhysics(RAPIER) : undefined;
  const world = new World<never>({
    seed: 3,
    hz,
    ...(rapier === undefined ? {} : { physics: rapier }),
  });
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, FIELD);
  installLiquids(world);
  installIce(world);
  if (rapier !== undefined) installPhysicsObjects(world);
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([
          ...fireRules({ presets: PRESETS, burnt: new Map() }),
          ...freezeRules(freeze),
          ...liquidRules({ presets: PRESETS }),
        ]),
      ),
    )
    .addSystem(elementFieldSystem());
  return { world, rapier };
}

/** `value`, failing the test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};

/** A river 6 m by 2 m, floor at y -2, brim and water surface at y 0. */
const RIVER = { min: { x: 0, y: -2, z: 0 }, max: { x: 6, y: 0, z: 2 } };
const RIVER_BOX: StimulusShape = {
  kind: 'box',
  center: { x: 3, y: 0, z: 1 },
  halfExtents: { x: 4, y: 1, z: 2 },
};

function river(options: Options = {}, layers = [{ liquid: 'water', depth: 2 }]) {
  const rig = iceWorld(options);
  const volume = createVolume(rig.world, PRESETS, { ...RIVER, layers });
  return { ...rig, volume };
}

const iceOf = (world: World<never>, volume: EntityId): LiquidIce => {
  const ice = world.get(volume, LiquidIceComponent);
  if (ice === undefined) throw new Error('no ice component');
  return ice;
};

function cold(world: World<never>, intensity: number, shape: StimulusShape = RIVER_BOX): void {
  applyStimulus(world, { shape, element: 'cold', intensity });
}
function heat(world: World<never>, intensity: number, shape: StimulusShape = RIVER_BOX): void {
  applyStimulus(world, { shape, element: 'heat', intensity });
}

function thing(
  world: World<never>,
  at: Placement,
  init: WorldPropertyInit = {},
  material = 'generic',
): EntityId {
  const entity = world.spawn();
  addMaterialProperties(world, entity, PRESETS, { material, temperature: 20, ...init });
  placeEntity(world, entity, at, at.radius);
  return entity;
}

describe('freeze config (mw-e03.7)', () => {
  it('accepts the defaults and overrides, and rejects nonsense', () => {
    expect(resolveFreezeConfig()).toEqual(DEFAULT_FREEZE_CONFIG);
    expect(resolveFreezeConfig({ cellSize: 2 }).cellSize).toBe(2);
    for (const bad of [
      { cellSize: 0 },
      { minSolid: -1 },
      { step: Number.NaN },
      { epsilon: 0 },
      { fusionHeat: Infinity },
      { growthPerDegree: -1 },
      { meltPerDegree: Number.NaN },
      { relaxPerSecond: 2 },
      { iceFriction: 3 },
      { wetThreshold: 0 },
      { wetThreshold: 1.5 },
      { maxThickness: 0.05 },
      { maxThickness: Infinity },
    ]) {
      expect(() => resolveFreezeConfig(bad)).toThrow(RangeError);
    }
    expect(() => freezeRules({ step: 0 })).toThrow(RangeError);
  });

  it('keeps the collider thickness in whole steps and none below the solid minimum', () => {
    const c = DEFAULT_FREEZE_CONFIG;
    expect(solidThickness(c, 0.09)).toBe(0);
    expect(solidThickness(c, 0.1)).toBe(0.1);
    expect(solidThickness(c, 0.12)).toBe(0.1);
    expect(solidThickness(c, 0.5)).toBeCloseTo(0.5, 9);
    const odd = resolveFreezeConfig({ minSolid: 0.12, step: 0.05 });
    expect(solidThickness(odd, 0.13)).toBe(0.12);
  });

  it('temperatureSign: heat raises, cold lowers, nothing else moves a temperature', () => {
    expect(STIMULUS_ELEMENTS.map(temperatureSign)).toEqual([1, -1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('frozen water surfaces (mw-e03.7)', () => {
  it('AC-1: cold on a surface cell grows ice of at least 0.1 m as a collider, up to 0.5 m', () => {
    const { world, rapier, volume } = river();
    const physics = must(rapier);
    const collision = new RapierCollisionWorld(physics);
    const probe = { x: 2.5, y: -1, z: 0.5 }; // under the ice, looking up at its underside
    const depthOfIce = (): number => {
      physics.step(0);
      const hit = collision.raycast(probe, UP, 10);
      return hit === undefined ? 0 : 1 - hit.distance;
    };
    expect(depthOfIce()).toBe(0);
    world.step();
    cold(world, 40);
    // One burst: the cells chill below 0 °C, ice grows as long as the cold lasts.
    const seen: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      world.step();
      seen.push(thickestIce(iceOf(world, volume)));
      if (must(seen.at(-1)) >= 0.1) break;
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(must(seen.at(-2))).toBeLessThan(0.1);
    const cell = iceCellAt(iceOf(world, volume), 2, 0);
    expect(cell?.solid).toBeGreaterThanOrEqual(0.1);
    expect(cell?.collider).toBeGreaterThan(0);
    expect(depthOfIce()).toBeGreaterThan(0.09);
    // It keeps growing while the cold lasts, never past 0.5 m.
    const more: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      world.step();
      more.push(thickestIce(iceOf(world, volume)));
    }
    expect(Math.max(...more)).toBeGreaterThan(must(seen.at(-1)));
    expect(Math.max(...more)).toBeLessThanOrEqual(0.5);
  });

  it('AC-1: continued cold keeps thickening the ice to the 0.5 m cap, and the collider tops the surface', () => {
    const { world, rapier, volume } = river();
    const physics = must(rapier);
    const collision = new RapierCollisionWorld(physics);
    let last = 0;
    for (let tick = 0; tick < 300; tick++) {
      cold(world, 5);
      world.step();
      const now = thickestIce(iceOf(world, volume));
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(0.5);
    const cell = iceCellAt(iceOf(world, volume), 5, 1);
    expect(cell?.solid).toBeCloseTo(0.5, 9);
    expect(cell?.top).toBe(0);
    physics.step(0);
    const hit = collision.raycast({ x: 5.5, y: 3, z: 1.5 }, DOWN, 10);
    expect(hit?.distance).toBeCloseTo(3, 5);
    // Slick: the ice collider takes the ice friction.
    expect(physics.count()).toBe(12);
  });

  it('cold that misses the volume, and elements that are not temperature, leave it alone', () => {
    const { world, volume } = river();
    cold(world, 50, { kind: 'sphere', center: { x: 50, y: 0, z: 50 }, radius: 1 });
    cold(world, 50, { kind: 'sphere', center: { x: 3, y: 10, z: 1 }, radius: 1 });
    applyStimulus(world, { shape: RIVER_BOX, element: 'water', intensity: 1 });
    steps(world, 3);
    expect(iceOf(world, volume).cells).toEqual([]);
  });

  it('cold from a sphere freezes only the cells it reaches', () => {
    const { world, volume } = river();
    cold(world, 400, { kind: 'sphere', center: { x: 0.5, y: 0, z: 0.5 }, radius: 0.7 });
    steps(world, 120);
    const ice = iceOf(world, volume);
    expect(ice.cells.length).toBeGreaterThan(0);
    expect(ice.cells.every((cell) => cell.ix <= 1 && cell.iz <= 1)).toBe(true);
    expect(iceCellAt(ice, 5, 1)).toBeUndefined();
  });

  it('a contact on the volume or on its top layer chills every cell; a contact elsewhere does nothing', () => {
    const { world, volume } = river();
    const crate = thing(world, { x: 10, y: 0, z: 10, radius: 0.1 });
    const contact = (target: EntityId) =>
      applyStimulus(world, { shape: { kind: 'contact', target }, element: 'cold', intensity: 100 });
    contact(crate);
    steps(world, 2);
    expect(iceOf(world, volume).cells).toEqual([]);
    contact(volume);
    steps(world, 2);
    expect(iceOf(world, volume).cells).toHaveLength(12);
    const other = river();
    const layer = must(other.world.get(other.volume, LiquidVolumeComponent)?.layers[0]).entity;
    applyStimulus(other.world, {
      shape: { kind: 'contact', target: layer },
      element: 'cold',
      intensity: 100,
    });
    steps(other.world, 2);
    expect(iceOf(other.world, other.volume).cells).toHaveLength(12);
  });

  it('works without physics: the ice grows but no collider exists', () => {
    const { world, volume } = river({ physics: false });
    cold(world, 40);
    steps(world, 300);
    const ice = iceOf(world, volume);
    expect(thickestIce(ice)).toBeGreaterThan(0.1);
    expect(ice.cells.every((cell) => cell.collider === 0 && cell.solid === 0)).toBe(true);
  });

  it('clips the last row and column of a box that is not a whole number of cells', () => {
    const rig = iceWorld();
    const volume = createVolume(rig.world, PRESETS, {
      min: { x: 0, y: -2, z: 0 },
      max: { x: 2.5, y: 0, z: 1 },
      layers: [{ liquid: 'water', depth: 2 }],
    });
    for (let tick = 0; tick < 200; tick++) {
      cold(rig.world, 5, {
        kind: 'box',
        center: { x: 1, y: 0, z: 0.5 },
        halfExtents: { x: 3, y: 1, z: 2 },
      });
      rig.world.step();
    }
    const ice = iceOf(rig.world, volume);
    expect(ice.cells.map((cell) => cell.ix)).toEqual([0, 1, 2]);
    expect(ice.cells.every((cell) => cell.solid > 0)).toBe(true);
  });

  it('a puddle is too shallow to carry ice', () => {
    const rig = iceWorld();
    const volume = createVolume(rig.world, PRESETS, {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 0.5, z: 2 },
      layers: [{ liquid: 'water', depth: 0.05 }],
    });
    for (let tick = 0; tick < 200; tick++) {
      cold(rig.world, 5, RIVER_BOX);
      rig.world.step();
    }
    expect(thickestIce(iceOf(rig.world, volume))).toBe(0.05);
    expect(iceOf(rig.world, volume).cells.every((cell) => cell.solid === 0)).toBe(true);
  });

  it('only the top layer freezes, at its own freeze point: oil on water stays liquid until -20', () => {
    const chill = (layers: { liquid: string; depth: number }[]) => {
      const { world, volume } = river({}, layers);
      cold(world, 20); // 0 °C or a little under: freezes water, nowhere near oil's -20 °C
      steps(world, 60);
      return thickestIce(iceOf(world, volume));
    };
    expect(chill([{ liquid: 'water', depth: 2 }])).toBeGreaterThan(0);
    expect(
      chill([
        { liquid: 'water', depth: 1.5 },
        { liquid: 'oil', depth: 0.5 },
      ]),
    ).toBe(0);
    // A hard enough cold does freeze the oil.
    const { world, volume } = river({}, [
      { liquid: 'water', depth: 1.5 },
      { liquid: 'oil', depth: 0.5 },
    ]);
    for (let tick = 0; tick < 120; tick++) {
      cold(world, 2);
      world.step();
    }
    expect(thickestIce(iceOf(world, volume))).toBeGreaterThan(0);
  });

  it('forgets a chilled cell that never froze once it warms back to the air', () => {
    const { world, volume } = river();
    cold(world, 15); // 5 °C: above freezing
    steps(world, 2);
    expect(iceOf(world, volume).cells).toHaveLength(12);
    steps(world, 60 * 40);
    expect(iceOf(world, volume).cells).toEqual([]);
    heat(world, 15);
    steps(world, 2);
    expect(iceOf(world, volume).cells.length).toBe(12);
  });
});

describe('thawing surfaces (mw-e03.7)', () => {
  it(
    'AC-4: heat melts the ice, the collider goes and what rested on it falls that tick',
    { timeout: 30_000 },
    () => {
      const { world, rapier, volume } = river();
      const physics = must(rapier);
      for (let tick = 0; tick < 240; tick++) {
        cold(world, 5);
        world.step();
      }
      expect(thickestIce(iceOf(world, volume))).toBe(0.5);
      // A crate settles on the ice and goes to sleep.
      const crate = world.spawn();
      addProperties(world, crate, { weight: 10, friction: 0.5, impactAbsorb: 0.1 });
      addPhysicsObject(world, crate, {
        shape: { kind: 'box', halfExtents: { x: 0.2, y: 0.2, z: 0.2 } },
        position: { x: 2.5, y: 0.5, z: 1 },
      });
      steps(world, 400);
      const body = must(world.get(crate, PhysicsObjectComponent)).body as ColliderHandle;
      const port = physics as unknown as RigidBodyPort;
      expect(port.poseOf(body).position.y).toBeCloseTo(0.2, 1);
      expect(port.isSleeping(body)).toBe(true);
      const colliders = physics.count();
      // Melt it: heat the cells until the thickness crosses below the solid minimum.
      let melted = -1;
      for (let tick = 0; tick < 1200 && melted < 0; tick++) {
        heat(world, 3);
        world.step();
        if (iceCellAt(iceOf(world, volume), 2, 0)?.solid === 0) melted = tick;
      }
      expect(melted).toBeGreaterThanOrEqual(0);
      expect(physics.count()).toBeLessThan(colliders);
      // The same tick: the collider is gone and the crate is awake over open water.
      expect(port.isSleeping(body)).toBe(false);
      steps(world, 120);
      expect(port.poseOf(body).position.y).toBeLessThan(-0.5);
    },
  );

  it('melts at the air temperature alone, slowly, and leaves no cells behind', () => {
    const { world, volume } = river();
    for (let tick = 0; tick < 240; tick++) {
      cold(world, 5);
      world.step();
    }
    expect(thickestIce(iceOf(world, volume))).toBe(0.5);
    steps(world, 60 * 100);
    expect(iceOf(world, volume).cells).toEqual([]);
  });

  it('draining the volume dry takes the ice and its colliders with it', () => {
    const rig = iceWorld();
    const volume = createVolume(rig.world, PRESETS, {
      ...RIVER,
      layers: [{ liquid: 'water', depth: 2 }],
      drain: { open: false, rate: 1 },
      fill: { open: false, liquid: 'water', rate: 0.5 },
    });
    for (let tick = 0; tick < 240; tick++) {
      cold(rig.world, 5);
      rig.world.step();
    }
    const physics = must(rig.rapier);
    expect(physics.count()).toBe(12);
    // Draining lowers the surface: the ice goes with it, rebuilt at the new top.
    setDrainOpen(rig.world, volume, true);
    steps(rig.world, 30);
    const lowered = iceCellAt(iceOf(rig.world, volume), 0, 0);
    expect(lowered?.top).toBeLessThan(0);
    expect(physics.count()).toBe(12);
    steps(rig.world, 120);
    expect(iceOf(rig.world, volume).cells).toEqual([]);
    expect(physics.count()).toBe(0);
    // Refill over a remaining cold spell: level rises and nothing breaks.
    setDrainOpen(rig.world, volume, false);
    setFillOpen(rig.world, volume, true);
    steps(rig.world, 10);
  });

  it('destroying a volume removes its ice colliders; without physics nothing happens', () => {
    const { world, rapier, volume } = river();
    for (let tick = 0; tick < 240; tick++) {
      cold(world, 5);
      world.step();
    }
    const physics = must(rapier);
    expect(physics.count()).toBe(12);
    world.destroy(volume);
    world.step();
    expect(physics.count()).toBe(0);
    const bare = river({ physics: false });
    cold(bare.world, 40);
    steps(bare.world, 10);
    bare.world.destroy(bare.volume);
    bare.world.step();
    expect(bare.world.isAlive(bare.volume)).toBe(false);
  });
});

describe('freezing and thawing things (mw-e03.7)', () => {
  it('AC-2: a wet entity cooled below its freeze point is frozen and breaks at a third of the energy', () => {
    const { world } = iceWorld({ physics: false });
    installBreakables(world);
    const jar = thing(world, { x: 20, y: 0, z: 20, radius: 0.2 }, { wetness: 0.3, fragile: 30 });
    cold(world, 25, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    world.step();
    expect(readProperty(world, jar, 'temperature')).toBeLessThanOrEqual(0);
    world.step();
    world.step();
    expect(readProperty(world, jar, 'frozen')).toBe(true);
    expect(breakThreshold(world, jar)).toBe(10);
    expect(breaksUnder(world, jar, 'blunt', 11)).toBe(true);
    expect(breaksUnder(world, jar, 'blunt', 9)).toBe(false);
    expect(readProperty(world, jar, 'friction')).toBe(DEFAULT_FREEZE_CONFIG.iceFriction);
  });

  it('AC-5: a dry entity cooled far below freezing is cold but not frozen', () => {
    const { world } = iceWorld({ physics: false });
    const dry = thing(world, { x: 20, y: 0, z: 20, radius: 0.2 }, { wetness: 0 });
    const damp = thing(world, { x: 21, y: 0, z: 20, radius: 0.2 }, { wetness: 0.29 });
    cold(world, 200, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 3 });
    steps(world, 5);
    expect(readProperty(world, dry, 'temperature')).toBeLessThan(-100);
    expect(readProperty(world, dry, 'frozen')).toBe(false);
    expect(readProperty(world, damp, 'frozen')).toBe(false);
  });

  it('does not freeze liquids or things on fire', () => {
    const { world } = iceWorld({ physics: false });
    const pond = thing(world, { x: 20, y: 0, z: 20, radius: 0.2 }, {}, 'water');
    const torch = thing(
      world,
      { x: 21, y: 0, z: 20, radius: 0.2 },
      { wetness: 0.4, burning: true, temperature: -5 },
      'wood',
    );
    world.step();
    expect(readProperty(world, pond, 'frozen')).toBe(false);
    // Still burning in the tick it was chilled: the fire rules put it out first.
    expect(readProperty(world, torch, 'frozen')).toBe(false);
    steps(world, 2);
    expect(readProperty(world, torch, 'burning')).toBe(false);
    expect(readProperty(world, torch, 'frozen')).toBe(true);
  });

  it('a thing that already slips (friction at or under ice) keeps its friction through freeze and thaw', () => {
    const { world } = iceWorld({ physics: false });
    const slick = thing(
      world,
      { x: 20, y: 0, z: 20, radius: 0.2 },
      { wetness: 1, friction: 0.02, temperature: -3 },
    );
    steps(world, 3);
    expect(readProperty(world, slick, 'frozen')).toBe(true);
    expect(readProperty(world, slick, 'friction')).toBe(0.02);
    expect(world.get(slick, FreezeStateComponent)?.friction).toBe(-1);
    heat(world, 3000, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    steps(world, 40);
    expect(readProperty(world, slick, 'frozen')).toBe(false);
    expect(readProperty(world, slick, 'friction')).toBe(0.02);
  });

  it('heat melts a frozen thing after latent time: it holds at the freeze point, then thaws and slips back', () => {
    const { world } = iceWorld({ physics: false });
    const crate = thing(
      world,
      { x: 20, y: 0, z: 20, radius: 0.2 },
      { wetness: 1, friction: 0.5, temperature: -5 },
    );
    steps(world, 3);
    expect(readProperty(world, crate, 'frozen')).toBe(true);
    expect(readProperty(world, crate, 'friction')).toBe(DEFAULT_FREEZE_CONFIG.iceFriction);
    // A little heat is spent melting: it stays frozen, held at the freeze point.
    heat(world, 300, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    steps(world, 3);
    expect(readProperty(world, crate, 'frozen')).toBe(true);
    expect(readProperty(world, crate, 'temperature')).toBe(0);
    expect(world.get(crate, FreezeStateComponent)?.absorbed).toBeGreaterThan(0);
    // It chills again: the melt starts over.
    cold(world, 100, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    steps(world, 3);
    expect(world.get(crate, FreezeStateComponent)?.absorbed).toBe(0);
    expect(readProperty(world, crate, 'frozen')).toBe(true);
    // Enough heat: it thaws, with its old friction and the leftover heat.
    heat(world, 3000, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    steps(world, 4);
    expect(readProperty(world, crate, 'frozen')).toBe(false);
    expect(readProperty(world, crate, 'friction')).toBe(0.5);
    expect(world.has(crate, FreezeStateComponent)).toBe(false);
  });

  it('an authored frozen thing without a state thaws in the warm, taking time', () => {
    const { world } = iceWorld({ physics: false });
    const block = thing(
      world,
      { x: 20, y: 0, z: 20, radius: 0.2 },
      { frozen: true, temperature: 20 },
    );
    steps(world, 2);
    expect(readProperty(world, block, 'frozen')).toBe(true);
    expect(world.has(block, FreezeStateComponent)).toBe(true);
    steps(world, 60 * 60);
    expect(readProperty(world, block, 'frozen')).toBe(false);
  });
});

describe('authored ice (mw-e03.7)', () => {
  it('an authored frozen thing that is cold stays frozen, and one hit by a great heat thaws at once', () => {
    const { world } = iceWorld({ physics: false });
    const block = thing(
      world,
      { x: 20, y: 0, z: 20, radius: 0.2 },
      { frozen: true, temperature: -5 },
    );
    steps(world, 2);
    expect(readProperty(world, block, 'frozen')).toBe(true);
    expect(world.has(block, FreezeStateComponent)).toBe(false);
    heat(world, 5000, { kind: 'sphere', center: { x: 20, y: 0, z: 20 }, radius: 1 });
    steps(world, 2);
    expect(readProperty(world, block, 'frozen')).toBe(false);
    expect(readProperty(world, block, 'temperature')).toBeGreaterThan(0);
  });

  it('a stimulus with no falloff chills every cell it reaches equally', () => {
    const { world, volume } = river();
    applyStimulus(world, { shape: RIVER_BOX, element: 'cold', intensity: 50, falloff: 'none' });
    steps(world, 2);
    const offsets = new Set(iceOf(world, volume).cells.map((cell) => cell.offset));
    expect(offsets.size).toBe(1);
  });

  it('destroying a volume copes with cells that never got a collider or whose collider is already gone', () => {
    const { world, rapier, volume } = river();
    const physics = must(rapier);
    cold(world, 40);
    steps(world, 1);
    expect(iceOf(world, volume).cells.every((cell) => cell.collider === 0)).toBe(true);
    for (let tick = 0; tick < 240; tick++) {
      cold(world, 5);
      world.step();
    }
    const handle = must(iceCellAt(iceOf(world, volume), 0, 0)).collider;
    physics.remove(handle as ColliderHandle);
    world.destroy(volume);
    world.step();
    expect(physics.count()).toBe(0);
  });
});

describe('mechanisms in the cold (mw-e03.7)', () => {
  const GATE: DoorProfile = {
    id: 'portcullis',
    kind: 'portcullis',
    size: { x: 1.2, y: 2.2, z: 0.1 },
    seconds: 2,
    crush: 0,
    manual: false,
    blocks: { light: false, gas: false, sound: false },
    loudness: 70,
  };

  it('AC-3: a portcullis winch frozen by the cold refuses a signal and reports jammed until it thaws', () => {
    const { world } = iceWorld({ physics: false });
    installMechanisms(world, {});
    const jammed: MechanismJammed[] = [];
    world.events.on(mechanismJammed, (e) => jammed.push(e));
    const gate = world.spawn();
    addProperties(world, gate, { wetness: 1, temperature: 20, friction: 0.6 });
    makeDoor(world, gate, GATE, { origin: { x: 20, y: 0, z: 20 } });
    refreshAffordances(world, gate);
    placeEntity(world, gate, { x: 20, y: 1, z: 20 }, 1);
    cold(world, 40, { kind: 'sphere', center: { x: 20, y: 1, z: 20 }, radius: 3 });
    steps(world, 4);
    expect(readProperty(world, gate, 'frozen')).toBe(true);
    expect(openDoor(world, gate, null)).toBe(false);
    world.step();
    expect(jammed.at(-1)).toMatchObject({ entity: gate, frozen: true });
    expect(world.get(gate, DoorComponent)?.openness).toBe(0);
    // Thawed, it moves.
    heat(world, 4000, { kind: 'sphere', center: { x: 20, y: 1, z: 20 }, radius: 3 });
    steps(world, 8);
    expect(readProperty(world, gate, 'frozen')).toBe(false);
    expect(openDoor(world, gate, null)).toBe(true);
  });
});

describe('ice on a physics port that only holds static colliders (mw-e03.7)', () => {
  it('adds and removes its colliders and never tries to wake bodies', () => {
    const sink = new InMemoryColliderSink();
    const port: PhysicsPort = {
      add: (desc) => sink.add(desc),
      remove: (handle) => {
        sink.remove(handle);
      },
      has: (handle) => sink.has(handle),
      count: () => sink.count(),
      step: () => undefined,
      snapshot: () => ({ engine: 'in-memory', data: null }),
      restore: () => undefined,
    };
    const world = new World<never>({ seed: 3, physics: port });
    registerWorldProperties(world);
    installStimuli(world);
    installElementField(world, FIELD);
    installLiquids(world);
    installIce(world);
    world
      .addSystem(stimulusSystem())
      .addSystem(elementRulesSystem(new ElementRuleSet(freezeRules())))
      .addSystem(elementFieldSystem());
    const volume = createVolume(world, PRESETS, {
      ...RIVER,
      layers: [{ liquid: 'water', depth: 2 }],
    });
    // Without the water rules the layer entity still carries its freeze point.
    for (let tick = 0; tick < 240; tick++) {
      cold(world, 5);
      world.step();
    }
    expect(sink.count()).toBe(12);
    for (let tick = 0; tick < 60 * 80; tick++) world.step();
    expect(sink.count()).toBe(0);
    expect(iceOf(world, volume).cells).toEqual([]);
  });

  it('wakes a sleeping rigid body', () => {
    const physics = new RapierPhysics(RAPIER);
    const port = physics as RigidBodyPort;
    const body = port.addBody({
      shape: { kind: 'sphere', radius: 0.5 },
      position: { x: 0, y: 5, z: 0 },
      mass: 1,
      friction: 0.5,
      restitution: 0,
    });
    port.sleep(body);
    expect(port.isSleeping(body)).toBe(true);
    port.wake(body);
    expect(port.isSleeping(body)).toBe(false);
  });
});
