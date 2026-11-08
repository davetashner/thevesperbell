import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { fireRules, type BurntMaterials } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import type { FieldConfigInput } from '../field/config';
import { elementFieldSystem, installElementField } from '../field/install';
import {
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { placeEntity, type Placement } from '../stimulus/placement';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { LiquidLayerComponent, LiquidVolumeComponent, SubmergedComponent } from './components';
import {
  DEFAULT_DRYING_CONFIG,
  dryingMultiple,
  liquidRules,
  resolveDryingConfig,
  type LiquidRulesOptions,
} from './rules';
import {
  addDepth,
  containsPoint,
  createRainZone,
  createVolume,
  installLiquids,
  layerSlabs,
  levelOf,
  liquidDensity,
  liquidEmerged,
  liquidEntered,
  resolveLiquidConfig,
  setDrainOpen,
  setFillOpen,
  setRaining,
  spillLiquid,
  volumeOf,
  type LiquidEntry,
} from './volumes';

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['water', { wetness: 1, liquid: true, density: 1000, conductive: true }],
  ['oil', { flammable: true, ignitionPoint: 210, fuel: 3, liquid: true, density: 900 }],
  ['brine', { wetness: 1, liquid: true, density: 1000 }],
  ['tar', { liquid: true, density: 1200 }],
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, hp: 100 }],
  ['iron', { absorbency: 0.1, density: 7870 }],
  ['generic', {}],
]);
const BURNT: BurntMaterials = new Map([['wood', null]]);
const TEST_FIELD: FieldConfigInput = { maxChunks: 8 };

function liquidWorld(options: Partial<LiquidRulesOptions> = {}) {
  const world = installLiquids(
    installElementField(
      installStimuli(registerWorldProperties(new World<never>({ seed: 5 }))),
      TEST_FIELD,
    ),
  );
  const rules = new ElementRuleSet([
    ...fireRules({ presets: PRESETS, burnt: BURNT }),
    ...liquidRules({ presets: PRESETS, ...options }),
  ]);
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(rules))
    .addSystem(elementFieldSystem());
  const entered: LiquidEntry[] = [];
  const emerged: LiquidEntry[] = [];
  world.events.on(liquidEntered, (e) => entered.push(e));
  world.events.on(liquidEmerged, (e) => emerged.push(e));
  return { world, entered, emerged };
}

function spawn(
  world: World<never>,
  material: string,
  at: Placement,
  init: WorldPropertyInit = {},
): EntityId {
  const entity = world.spawn();
  addMaterialProperties(world, entity, PRESETS, { material, temperature: 20, ...init });
  placeEntity(world, entity, at, at.radius);
  return entity;
}

const BASIN = { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 2, z: 2 } };
const steps = (world: World<never>, n: number): void => {
  for (let i = 0; i < n; i++) world.step();
};
const seconds = (world: World<never>, s: number): number => Math.round(s * world.clock.hz);
const wetness = (world: World<never>, e: EntityId): number => readProperty(world, e, 'wetness');

describe('water volumes, wetness and drying (mw-e03.6)', () => {
  it('AC-1: an entity fully inside a water volume becomes fully wet on a tick', () => {
    const { world, entered } = liquidWorld();
    createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'water', depth: 1 }] });
    const under = spawn(world, 'generic', { x: 0, y: 0.5, z: 0, radius: 0.25 });
    const partly = spawn(world, 'generic', { x: 0, y: 0.95, z: 0, radius: 0.25 });
    const above = spawn(world, 'generic', { x: 0, y: 1.6, z: 0, radius: 0.25 });
    const beside = spawn(world, 'generic', { x: 2, y: 0.5, z: 0, radius: 0.25 });
    world.step();
    expect(wetness(world, under)).toBe(1);
    expect(wetness(world, partly)).toBe(0);
    expect(wetness(world, above)).toBe(0);
    expect(wetness(world, beside)).toBe(0);
    world.step();
    expect(entered.map((e) => e.entity)).toEqual([under]);
    expect(world.has(under, SubmergedComponent)).toBe(true);
  });

  it('AC-1: an entity with no wetness property yet gains it, but a bare placement is ignored', () => {
    const { world } = liquidWorld();
    createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'water', depth: 1 }] });
    const bare = world.spawn();
    placeEntity(world, bare, { x: 0, y: 0.5, z: 0 }, 0.1);
    const crate = spawn(world, 'wood', { x: 0.5, y: 0.5, z: 0, radius: 0.1 });
    world.step();
    expect(wetness(world, crate)).toBe(1);
    expect(world.has(bare, SubmergedComponent)).toBe(false);
  });

  it('AC-1: only wetting liquids soak: oil alone leaves a submerged entity dry', () => {
    const { world } = liquidWorld();
    createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'oil', depth: 1 }] });
    const crate = spawn(world, 'generic', { x: 0, y: 0.5, z: 0, radius: 0.1 });
    steps(world, 2);
    expect(wetness(world, crate)).toBe(0);
    expect(world.has(crate, SubmergedComponent)).toBe(true);
  });

  it('AC-2: a wet entity at ambient dries to 0.1 or less within the documented drying time', () => {
    const { world } = liquidWorld();
    const crate = spawn(world, 'generic', { x: 3, y: 0, z: 3, radius: 0.25 }, { wetness: 1 });
    const { dryingSeconds } = DEFAULT_DRYING_CONFIG;
    expect(dryingSeconds).toBe(120);
    steps(world, seconds(world, dryingSeconds * 0.5));
    expect(wetness(world, crate)).toBeCloseTo(0.5, 2);
    steps(world, seconds(world, dryingSeconds * 0.4));
    expect(wetness(world, crate)).toBeLessThanOrEqual(0.1 + 1e-9);
    steps(world, seconds(world, dryingSeconds * 0.1));
    expect(wetness(world, crate)).toBe(0);
  });

  it('AC-2: beside a burning entity it dries at least 3x faster', () => {
    const ticksToDry = (nearFire: boolean): number => {
      const { world } = liquidWorld();
      const crate = spawn(world, 'generic', { x: 0.9, y: 0.5, z: 0, radius: 0.25 }, { wetness: 1 });
      if (nearFire) {
        spawn(
          world,
          'wood',
          { x: 0, y: 0.5, z: 0, radius: 0.5 },
          { burning: true, temperature: 600 },
        );
      }
      for (let tick = 1; tick <= 4000; tick++) {
        world.step();
        if (wetness(world, crate) <= 0.1) return tick;
      }
      return 4001;
    };
    const slow = ticksToDry(false);
    const fast = ticksToDry(true);
    expect(slow).toBeLessThanOrEqual(seconds(liquidWorld().world, 120));
    expect(fast * 3).toBeLessThanOrEqual(slow);
  });

  it('AC-2: an object with no temperature of its own dries by the air around it', () => {
    const { world } = liquidWorld();
    const cold = world.spawn();
    addMaterialProperties(world, cold, PRESETS, { material: 'generic', wetness: 1 });
    placeEntity(world, cold, { x: 3, y: 0, z: 3 }, 0.1);
    const hot = world.spawn();
    addMaterialProperties(world, hot, PRESETS, { material: 'generic', wetness: 1 });
    placeEntity(world, hot, { x: 0.9, y: 0.5, z: 0 }, 0.1);
    const unplaced = world.spawn();
    addMaterialProperties(world, unplaced, PRESETS, { material: 'generic', wetness: 1 });
    spawn(world, 'wood', { x: 0, y: 0.5, z: 0, radius: 0.5 }, { burning: true, temperature: 600 });
    steps(world, 100);
    expect(wetness(world, cold)).toBeGreaterThan(0.9);
    expect(wetness(world, hot)).toBeLessThan(0.7);
    expect(wetness(world, unplaced)).toBeGreaterThan(0.9);
  });

  it('AC-2: frozen things and liquids do not dry; a dry multiple is 1 at or below ambient', () => {
    const { world } = liquidWorld();
    const ice = spawn(
      world,
      'generic',
      { x: 3, y: 0, z: 3, radius: 0.1 },
      { wetness: 1, frozen: true },
    );
    const pool = spawn(world, 'water', { x: -3, y: 0, z: 3, radius: 0.1 });
    steps(world, 200);
    expect(wetness(world, ice)).toBe(1);
    expect(wetness(world, pool)).toBe(1);
    expect(dryingMultiple(DEFAULT_DRYING_CONFIG, -10, 20)).toBe(1);
    expect(dryingMultiple(DEFAULT_DRYING_CONFIG, 60, 20)).toBe(3);
  });

  it('AC-3: an opened drain lowers the level at the drain rate and submerged entities emerge', () => {
    const { world, emerged } = liquidWorld();
    const basin = createVolume(world, PRESETS, {
      ...BASIN,
      layers: [{ liquid: 'water', depth: 1 }],
      drain: { open: false, rate: 0.25 },
    });
    const low = spawn(world, 'generic', { x: -1, y: 0.2, z: 0, radius: 0.1 });
    const high = spawn(world, 'generic', { x: 1, y: 0.6, z: 0, radius: 0.1 });
    steps(world, 20);
    expect(levelOf(volumeOf(world, basin))).toBe(1);
    expect(world.has(high, SubmergedComponent)).toBe(true);
    setDrainOpen(world, basin, true);
    steps(world, seconds(world, 1));
    expect(levelOf(volumeOf(world, basin))).toBeCloseTo(0.75, 6);
    expect(emerged).toEqual([]);
    steps(world, seconds(world, 1));
    expect(levelOf(volumeOf(world, basin))).toBeCloseTo(0.5, 6);
    steps(world, 2);
    expect(emerged).toEqual([{ entity: high, volume: basin }]);
    expect(world.has(high, SubmergedComponent)).toBe(false);
    expect(world.has(low, SubmergedComponent)).toBe(true);
    steps(world, seconds(world, 3));
    expect(levelOf(volumeOf(world, basin))).toBe(0);
    expect(emerged.map((e) => e.entity)).toEqual([high, low]);
    expect(volumeOf(world, basin).layers).toEqual([]);
    // Out of the water they start to dry.
    const before = wetness(world, low);
    steps(world, 20);
    expect(wetness(world, low)).toBeLessThan(before);
  });

  it('AC-3: a drain takes the bottom layer first and a fill refills to the brim only', () => {
    const { world } = liquidWorld();
    const basin = createVolume(world, PRESETS, {
      ...BASIN,
      layers: [
        { liquid: 'oil', depth: 0.1 },
        { liquid: 'water', depth: 0.5 },
      ],
      drain: { open: true, rate: 1 },
      fill: { open: false, liquid: 'water', rate: 2 },
    });
    steps(world, seconds(world, 0.5));
    expect(volumeOf(world, basin).layers.map((l) => l.liquid)).toEqual(['oil']);
    expect(levelOf(volumeOf(world, basin))).toBeCloseTo(0.1, 6);
    setDrainOpen(world, basin, false);
    setFillOpen(world, basin, true);
    steps(world, seconds(world, 5));
    const full = volumeOf(world, basin);
    expect(levelOf(full)).toBe(2);
    expect(full.layers.map((l) => l.liquid)).toEqual(['water', 'oil']);
    expect(() => {
      setDrainOpen(world, 999, true);
    }).toThrow('not a liquid volume');
    const bare = createVolume(world, PRESETS, { ...BASIN });
    expect(() => {
      setDrainOpen(world, bare, true);
    }).toThrow('no drain');
    expect(() => {
      setFillOpen(world, bare, true);
    }).toThrow('no fill');
  });

  it('AC-4: oil spilled on water floats as a layer on the surface and burns alone', () => {
    const { world } = liquidWorld();
    const basin = createVolume(world, PRESETS, {
      ...BASIN,
      layers: [{ liquid: 'water', depth: 1 }],
    });
    const crate = spawn(world, 'generic', { x: 1, y: 0.4, z: 1, radius: 0.1 });
    const spill = spillLiquid(world, PRESETS, {
      liquid: 'oil',
      amount: 0.8,
      at: { x: 0, y: 2, z: 0 },
    });
    expect(spill).toEqual({ volume: basin, puddle: false });
    steps(world, 2);
    const volume = volumeOf(world, basin);
    expect(volume.layers.map((l) => l.liquid)).toEqual(['water', 'oil']);
    const slabs = layerSlabs(volume);
    expect(slabs[0]).toEqual({ bottom: 0, top: 1 });
    expect(slabs[1]?.bottom).toBe(1);
    expect(slabs[1]?.top).toBeCloseTo(1.05, 9);
    const [water, oil] = volume.layers.map((l) => l.entity) as [EntityId, EntityId];
    expect(world.has(oil, LiquidLayerComponent)).toBe(true);
    expect(readProperty(world, oil, 'flammable')).toBe(true);
    expect(readProperty(world, water, 'flammable')).toBe(false);
    // Ignite the oil with heat; the water layer under it does not burn.
    applyStimulus(world, {
      shape: { kind: 'contact', target: oil },
      element: 'heat',
      intensity: 300,
    });
    steps(world, 5);
    expect(readProperty(world, oil, 'burning')).toBe(true);
    expect(readProperty(world, water, 'burning')).toBe(false);
    expect(readProperty(world, crate, 'burning')).toBe(false);
    expect(volumeOf(world, basin).layers[0]?.depth).toBe(1);
    // It burns for its fuel and then is gone: the water is left as it was.
    steps(world, seconds(world, 3));
    steps(world, 3);
    const after = volumeOf(world, basin);
    expect(after.layers.map((l) => l.liquid)).toEqual(['water']);
    expect(levelOf(after)).toBe(1);
    expect(world.isAlive(oil)).toBe(false);
    expect(world.isAlive(water)).toBe(true);
  });

  it('AC-4: a liquid denser than water settles under it, whatever order they arrive in', () => {
    const { world } = liquidWorld();
    const basin = createVolume(world, PRESETS, {
      ...BASIN,
      layers: [
        { liquid: 'water', depth: 0.2 },
        { liquid: 'oil', depth: 0.1 },
        { liquid: 'water', depth: 0.1 },
      ],
    });
    expect(volumeOf(world, basin).layers.map((l) => [l.liquid, l.depth])).toEqual([
      ['water', 0.30000000000000004],
      ['oil', 0.1],
    ]);
    spillLiquid(world, PRESETS, { liquid: 'tar', amount: 1.6, at: { x: 0, y: 1, z: 0 } });
    expect(volumeOf(world, basin).layers.map((l) => l.liquid)).toEqual(['tar', 'water', 'oil']);
  });

  it('AC-4: liquids of equal density stack in a fixed order', () => {
    const { world } = liquidWorld();
    for (const order of [
      ['water', 'brine'],
      ['brine', 'water'],
    ]) {
      const volume = createVolume(world, PRESETS, {
        ...BASIN,
        layers: order.map((liquid) => ({ liquid, depth: 0.1 })),
      });
      expect(volumeOf(world, volume).layers.map((l) => l.liquid)).toEqual(['brine', 'water']);
    }
  });

  it('AC-1: moving from one volume to another updates the volume it is in, with no new splash', () => {
    const { world, entered, emerged } = liquidWorld();
    const left = createVolume(world, PRESETS, {
      min: { x: -2, y: 0, z: -2 },
      max: { x: 0, y: 2, z: 2 },
      layers: [{ liquid: 'water', depth: 1 }],
    });
    const right = createVolume(world, PRESETS, {
      min: { x: 0.5, y: 0, z: -2 },
      max: { x: 2, y: 2, z: 2 },
      layers: [{ liquid: 'water', depth: 1 }],
    });
    const swimmer = spawn(world, 'generic', { x: -1, y: 0.5, z: 0, radius: 0.1 });
    steps(world, 2);
    placeEntity(world, swimmer, { x: 1, y: 0.5, z: 0 }, 0.1);
    steps(world, 2);
    expect(world.get(swimmer, SubmergedComponent)).toEqual({ volume: right });
    expect(entered).toEqual([{ entity: swimmer, volume: left }]);
    expect(emerged).toEqual([]);
  });

  it('AC-5: water on a non-absorbent material raises wetness but caps at its absorbency', () => {
    const { world } = liquidWorld();
    const bar = spawn(world, 'iron', { x: 0, y: 0.5, z: 0, radius: 0.25 }, { wetness: 0 });
    const sponge = spawn(world, 'generic', { x: 1, y: 0.5, z: 0, radius: 0.25 }, { wetness: 0 });
    const splash = (target: EntityId, intensity: number) =>
      applyStimulus(world, { shape: { kind: 'contact', target }, element: 'water', intensity });
    splash(bar, 0.06);
    splash(sponge, 0.06);
    world.step();
    expect(wetness(world, bar)).toBeCloseTo(0.06, 2);
    splash(bar, 0.5);
    splash(sponge, 0.5);
    world.step();
    // Capped at the absorbency (less a tick's drying); the absorbent one takes all of it.
    expect(wetness(world, bar)).toBeLessThanOrEqual(0.1);
    expect(wetness(world, bar)).toBeGreaterThan(0.098);
    expect(wetness(world, sponge)).toBeCloseTo(0.56, 2);
    // Wetness set above the cap is not pushed down by a splash.
    setProperty(world, bar, 'wetness', 0.4);
    splash(bar, 0.3);
    world.step();
    expect(wetness(world, bar)).toBeLessThanOrEqual(0.4);
    expect(wetness(world, bar)).toBeGreaterThan(0.398);
  });

  it('AC-5: a submerged non-absorbent object takes only its absorbency', () => {
    const { world } = liquidWorld();
    createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'water', depth: 1 }] });
    const bar = spawn(world, 'iron', { x: 0, y: 0.5, z: 0, radius: 0.25 });
    world.step();
    expect(wetness(world, bar)).toBe(0.1);
  });

  it('spills: bare ground makes a puddle, a second spill on it deepens it', () => {
    const { world } = liquidWorld();
    createVolume(world, PRESETS, {
      ...BASIN,
      min: { x: 5, y: 0, z: 5 },
      max: { x: 6, y: 1, z: 6 },
    });
    const first = spillLiquid(world, PRESETS, {
      liquid: 'water',
      amount: 0.08,
      at: { x: 0, y: 0, z: 0 },
    });
    expect(first.puddle).toBe(true);
    const puddle = volumeOf(world, first.volume);
    expect(puddle.max.x - puddle.min.x).toBeCloseTo(2, 9);
    expect(levelOf(puddle)).toBeCloseTo(0.02, 9);
    const second = spillLiquid(world, PRESETS, {
      liquid: 'water',
      amount: 0.04,
      at: { x: 0.5, y: 0, z: 0.5 },
    });
    expect(second).toEqual({ volume: first.volume, puddle: false });
    expect(levelOf(volumeOf(world, first.volume))).toBeCloseTo(0.03, 9);
    // Overflow past the brim is lost.
    spillLiquid(world, PRESETS, { liquid: 'water', amount: 100, at: { x: 0, y: 0, z: 0 } });
    expect(levelOf(volumeOf(world, first.volume))).toBeCloseTo(0.1, 9);
    expect(containsPoint(volumeOf(world, first.volume), { x: 5, y: 0, z: 0 })).toBe(false);
    expect(containsPoint(volumeOf(world, first.volume), { x: 0, y: -1, z: 0 })).toBe(false);
    expect(addDepth(world, PRESETS, first.volume, volumeOf(world, first.volume), 'water', 1)).toBe(
      volumeOf(world, first.volume),
    );
  });

  it('rain: a rain zone wets what is under it through water stimuli, up to absorbency', () => {
    const { world } = liquidWorld();
    const zone = createRainZone(world, {
      min: { x: -2, y: 0, z: -2 },
      max: { x: 2, y: 3, z: 2 },
      rate: 0.1,
    });
    const crate = spawn(world, 'generic', { x: 0, y: 1, z: 0, radius: 0.2 }, { wetness: 0 });
    const bar = spawn(world, 'iron', { x: 1, y: 1, z: 0, radius: 0.2 }, { wetness: 0 });
    const shelter = spawn(world, 'generic', { x: 3.5, y: 1, z: 0, radius: 0.2 }, { wetness: 0 });
    steps(world, seconds(world, 5));
    expect(wetness(world, crate)).toBeGreaterThan(0.3);
    expect(wetness(world, bar)).toBeLessThanOrEqual(0.1);
    expect(wetness(world, bar)).toBeGreaterThan(0.09);
    expect(wetness(world, shelter)).toBe(0);
    setRaining(world, zone, false);
    steps(world, 2);
    const damp = wetness(world, crate);
    steps(world, 20);
    expect(wetness(world, crate)).toBeLessThan(damp);
    expect(() => {
      setRaining(world, 999, true);
    }).toThrow('not a rain zone');
  });

  it('validates liquids, volumes, rain and configs', () => {
    const { world } = liquidWorld();
    expect(() => liquidDensity(PRESETS, 'dirt')).toThrow('unknown liquid');
    expect(() => liquidDensity(PRESETS, 'wood')).toThrow('not a liquid');
    expect(liquidDensity(new Map([['water', { liquid: true }]]), 'water')).toBe(1000);
    expect(() => createVolume(world, PRESETS, { min: BASIN.max, max: BASIN.min })).toThrow(
      'corners',
    );
    expect(() =>
      createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'water', depth: 0 }] }),
    ).toThrow('depth');
    expect(() =>
      createVolume(world, PRESETS, { ...BASIN, layers: [{ liquid: 'water', depth: 3 }] }),
    ).toThrow('brim');
    expect(() =>
      spillLiquid(world, PRESETS, { liquid: 'water', amount: 0, at: { x: 0, y: 0, z: 0 } }),
    ).toThrow('amount');
    expect(() => createRainZone(world, { ...BASIN, rate: 0 })).toThrow('rain rate');
    expect(() => volumeOf(world, 12345)).toThrow('not a liquid volume');
    expect(() => resolveLiquidConfig({ puddleDepth: 0 })).toThrow('puddleDepth');
    expect(() => resolveLiquidConfig({ maxLayerRadius: 0 })).toThrow('maxLayerRadius');
    expect(() => resolveLiquidConfig({ puddleBrim: 0.001 })).toThrow('puddleBrim');
    expect(() => resolveDryingConfig({ dryingSeconds: 0 })).toThrow('dryingSeconds');
    expect(() => resolveDryingConfig({ warmthScale: Infinity })).toThrow('warmthScale');
    expect(() => liquidRules({ presets: PRESETS, drying: { dryingSeconds: -1 } })).toThrow(
      RangeError,
    );
  });

  it('volumes survive a snapshot and keep working after a restore', () => {
    const { world } = liquidWorld();
    const basin = createVolume(world, PRESETS, {
      ...BASIN,
      layers: [{ liquid: 'water', depth: 1 }],
      drain: { open: true, rate: 0.5 },
    });
    steps(world, seconds(world, 0.5));
    const snapshot = world.snapshot();
    steps(world, seconds(world, 0.5));
    const expected = levelOf(volumeOf(world, basin));
    world.restore(snapshot);
    steps(world, seconds(world, 0.5));
    expect(levelOf(volumeOf(world, basin))).toBe(expected);
    expect(world.has(basin, LiquidVolumeComponent)).toBe(true);
  });
});
