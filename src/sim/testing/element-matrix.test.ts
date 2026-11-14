import { describe, expect, it, vi } from 'vitest';
import type { EntityId } from '../core/component';
import { elementFieldOf } from '../index';
import { WorldProperties, getProperty } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import {
  applyProgram,
  buildWorld,
  checkBurnouts,
  checkConsistent,
  checkDiffusion,
  checkFinite,
  checkNothingCreated,
  checkWorld,
  consistentBag,
  deviationOf,
  digestOf,
  fixedGasChannels,
  fieldTotals,
  MATRIX_ELEMENTS,
  MAX_FUEL,
  measure,
  runWorld,
  settleProblem,
  type EntitySpec,
  type Measure,
  type RunReport,
  type StimulusSpec,
  type WorldSpec,
} from './element-matrix';

// Property runs are CPU heavy: under a loaded coverage run they need more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const first = <T>(items: readonly T[]): T => items[0] as T;
const entity = (bag: Record<string, unknown> = {}, rest: Partial<EntitySpec> = {}): EntitySpec => ({
  bag,
  placed: true,
  x: 4,
  y: 4,
  z: 4,
  radius: 0.5,
  ...rest,
});
const world = (
  entities: EntitySpec[],
  program: StimulusSpec[] = [],
  materials: WorldSpec['materials'] = [{ preset: {}, charred: false }],
): WorldSpec => ({ seed: 1, materials, entities, program });
const blast = (
  element: StimulusSpec['element'],
  extra: Partial<StimulusSpec> = {},
): StimulusSpec => ({
  tick: 0,
  element,
  shape: { kind: 'sphere', center: { x: 4, y: 4, z: 4 }, radius: 3 },
  intensity: 500,
  duration: 0,
  falloff: 'linear',
  ...extra,
});

const measured = (over: Partial<Measure> = {}): Measure => ({
  fields: new Map(),
  hottest: 20,
  coldest: 20,
  wetness: new Map(),
  charge: new Map(),
  burning: 0,
  charged: 0,
  ...over,
});

describe('consistentBag', () => {
  it('drops properties the sandbox cannot back and contradictions', () => {
    expect(consistentBag({ support: 3, suspended: true, trap: 'x', trapped: true, hp: 5 })).toEqual(
      {
        hp: 5,
      },
    );
    expect(consistentBag({ waterSurface: true })).toEqual({});
    expect(consistentBag({ waterSurface: true, liquid: true })).toEqual({
      waterSurface: true,
      liquid: true,
    });
    expect(consistentBag({ transparent: true, opaque: true })).toEqual({ transparent: true });
  });

  it('caps fuel and makes burning and frozen objects consistent', () => {
    expect(consistentBag({ fuel: 86_400 })).toEqual({ fuel: MAX_FUEL });
    expect(consistentBag({ burning: true })).toEqual({ burning: true, flammable: true, fuel: 0.5 });
    expect(consistentBag({ burning: true, fuel: 3 })).toMatchObject({ fuel: 3 });
    expect(consistentBag({ burning: true, frozen: true })).not.toHaveProperty('burning');
    expect(consistentBag({ frozen: true })).toEqual({ frozen: true, temperature: 0 });
    expect(consistentBag({ frozen: true, temperature: -5, freezePoint: 10 })).toMatchObject({
      temperature: -5,
    });
    expect(consistentBag({ frozen: true, temperature: 50, freezePoint: 10 })).toMatchObject({
      temperature: 10,
    });
  });
});

describe('buildWorld and applyProgram', () => {
  it('builds objects with materials, burnt states, unplaced objects and a relabelled run', () => {
    const spec = world(
      [entity({}, { material: 0 }), entity({}, { material: 1, placed: false }), entity()],
      [],
      [
        { preset: { hp: 7 }, charred: true },
        { preset: {}, charred: false },
      ],
    );
    for (const relabel of [false, true]) {
      const mw = buildWorld(spec, { relabel });
      expect(mw.ids).toHaveLength(3);
      const [first, second] = mw.ids as [EntityId, EntityId];
      expect(getProperty(mw.world, first, 'hp')).toBe(7);
      expect(getProperty(mw.world, second, 'material')).toBeDefined();
      expect(mw.world.has(second, PlacementComponent)).toBe(false);
    }
  });

  it('applies contact stimuli to an entity by wrapped index, and skips them with no entities', () => {
    const contact = blast('heat', { shape: { kind: 'contact', target: 9 } });
    const withOne = buildWorld(world([entity({ temperature: 20 })], [contact]));
    applyProgram(withOne, world([entity()], [contact]), 0);
    withOne.world.step();
    expect(getProperty(withOne.world, first(withOne.ids), 'temperature')).toBeGreaterThan(20);
    const none = world([], [contact]);
    expect(() => {
      applyProgram(buildWorld(none), none, 0);
    }).not.toThrow();
  });

  it('passes gas, force and the duration through to the stimulus', () => {
    const spec = world(
      [entity({ pushable: true })],
      [blast('gas', { gas: 'smoke', duration: 0.1 }), blast('force', { maxWeight: 5 })],
    );
    expect(runWorld(spec, { ticks: 20 }).violations).toEqual([]);
  });

  it('skips program steps that are not due', () => {
    const spec = world([entity({ temperature: 20 })], [blast('heat', { tick: 5 })]);
    const mw = buildWorld(spec);
    applyProgram(mw, spec, 0);
    mw.world.step();
    expect(getProperty(mw.world, first(mw.ids), 'temperature')).toBe(20);
  });
});

describe('the checks', () => {
  it('checkFinite finds a bad property, placement and field value', () => {
    const mw = buildWorld(world([entity({ temperature: 20 })]));
    const id = first(mw.ids);
    expect(checkFinite(mw.world, mw.field)).toBeUndefined();
    mw.world.set(id, PlacementComponent, { x: Number.NaN, y: 0, z: 0, radius: 0 });
    expect(checkFinite(mw.world, mw.field)).toMatch(/entity \d+ .*finite/);
    mw.world.set(id, PlacementComponent, { x: 1, y: 1, z: 1, radius: 0 });
    mw.world.set(id, WorldProperties.temperature, Number.NaN);
    expect(checkFinite(mw.world, mw.field)).toMatch(/entity \d+: temperature/);
    mw.world.set(id, WorldProperties.temperature, 20);
    mw.field.add('charge', { x: 1, y: 1, z: 1 }, 5);
    const chunk = mw.field.chunkList()[0];
    if (chunk === undefined) throw new Error('no chunk');
    mw.field.layerOf(chunk, 'charge')[0] = Number.POSITIVE_INFINITY;
    expect(checkFinite(mw.world, mw.field)).toBe('field charge is not finite');
  });

  it('checkConsistent finds frozen and burning at once, and burning with no fuel', () => {
    const mw = buildWorld(
      world([entity({ temperature: 20, flammable: true, burning: false, frozen: false })]),
    );
    const id = first(mw.ids);
    expect(checkConsistent(mw.world)).toBeUndefined();
    mw.world.set(id, WorldProperties.burning, true);
    expect(checkConsistent(mw.world)).toMatch(/burning with no fuel/);
    mw.world.set(id, WorldProperties.frozen, true);
    expect(checkConsistent(mw.world)).toMatch(/frozen/);
  });

  it('checkBurnouts accepts a burnt-away object gone and a burnt state with no fuel', () => {
    const mw = buildWorld(world([entity({ fuel: 1, burning: false })]));
    const id = first(mw.ids);
    expect(checkBurnouts(mw)).toBeUndefined();
    mw.burnouts.push({ entity: id, becomes: null });
    expect(checkBurnouts(mw)).toMatch(/burnt away but still exists/);
    mw.burnouts.length = 0;
    mw.burnouts.push({ entity: id, becomes: 'mat-0-burnt' });
    expect(checkBurnouts(mw)).toMatch(/has fuel/);
    mw.world.set(id, WorldProperties.fuel, 0);
    expect(checkBurnouts(mw)).toBeUndefined();
    mw.world.set(id, WorldProperties.burning, true);
    expect(checkBurnouts(mw)).toMatch(/has fuel or is burning/);
    mw.world.destroy(id);
    mw.burnouts.length = 0;
    mw.burnouts.push({ entity: id, becomes: null });
    expect(checkBurnouts(mw)).toBeUndefined();
  });

  it('checkNothingCreated flags heat, cold, water, charge and gas made from nothing', () => {
    const none = new Set<string>();
    const check = (before: Measure, now: Measure, sources = none) =>
      checkNothingCreated(before, now, sources, ['gas:marsh-gas'], 20);
    expect(check(measured(), measured())).toBeUndefined();
    expect(check(measured(), measured({ hottest: 300 }))).toMatch(/heat grew/);
    expect(check(measured(), measured({ coldest: -50 }))).toMatch(/cold grew/);
    expect(check(measured({ hottest: 300 }), measured({ hottest: 300 }))).toBeUndefined();
    // Sources, fire and charge excuse heat.
    for (const excuse of [
      { sources: new Set(['heat']) },
      { sources: new Set(['cold']) },
      { sources: new Set(['fire']) },
    ]) {
      expect(check(measured(), measured({ hottest: 300 }), excuse.sources)).toBeUndefined();
    }
    expect(check(measured({ burning: 1 }), measured({ hottest: 300 }))).toBeUndefined();
    expect(check(measured({ charged: 1 }), measured({ hottest: 300 }))).toBeUndefined();
    expect(
      check(measured({ wetness: new Map([[1, 0.1]]) }), measured({ wetness: new Map([[1, 0.5]]) })),
    ).toMatch(/water grew/);
    expect(
      check(measured(), measured({ fields: new Map([['moisture', 2]]) }), new Set(['water'])),
    ).toBeUndefined();
    expect(
      check(measured({ charge: new Map([[1, 1]]) }), measured({ charge: new Map([[1, 2]]) })),
    ).toMatch(/charge grew/);
    expect(
      check(measured(), measured({ fields: new Map([['charge', 1]]) }), new Set(['charge'])),
    ).toBeUndefined();
    // Entities that exist on one side only are ignored.
    expect(check(measured(), measured({ wetness: new Map([[7, 1]]) }))).toBeUndefined();
    const gas = (total: number) => measured({ fields: new Map([['gas:marsh-gas', total]]) });
    expect(check(gas(1), gas(1))).toBeUndefined();
    expect(check(gas(1), gas(2))).toMatch(/gas:marsh-gas was not conserved/);
    expect(check(gas(1), gas(0.5))).toMatch(/not conserved/);
    expect(check(gas(1), gas(2), new Set(['gas:marsh-gas']))).toBeUndefined();
  });

  it('checkDiffusion compares the totals with what the step says it lost', () => {
    const before = new Map([['temperature', 10]]);
    expect(
      checkDiffusion(before, new Map([['temperature', 8]]), { temperature: 2 }),
    ).toBeUndefined();
    expect(checkDiffusion(before, new Map([['temperature', 8]]), {})).toMatch(
      /temperature changed by -2/,
    );
    expect(checkDiffusion(new Map(), new Map([['gas:smoke', 1]]), {})).toMatch(/gas:smoke/);
    expect(checkDiffusion(before, new Map(), { temperature: 10 })).toBeUndefined();
  });

  it('measures totals, extremes, wetness, charge and burning', () => {
    const mw = buildWorld(
      world([entity({ temperature: 80, wetness: 0.5, charge: 3, burning: true, flammable: true })]),
    );
    mw.field.add('temperature', { x: 1, y: 1, z: 1 }, -30);
    const m = measure(mw.world, mw.field);
    expect(m.hottest).toBe(80);
    expect(m.coldest).toBe(-10);
    expect(m.burning).toBe(1);
    expect(m.charged).toBe(1);
    expect([...m.wetness.values()]).toEqual([0.5]);
    expect(m.fields.get('temperature')).toBe(-30);
    expect(fieldTotals(mw.field).get('temperature')).toBe(-30);
  });

  it('finds fixed gases and the deviation of a channel', () => {
    const mw = buildWorld(world([]));
    const field = elementFieldOf(mw.world);
    expect(deviationOf(field, 'temperature')).toBe(0);
    field.add('gas:marsh-gas', { x: 1, y: 1, z: 1 }, 0.5);
    field.add('gas:smoke', { x: 1, y: 1, z: 1 }, 0.5);
    field.add('temperature', { x: 1, y: 1, z: 1 }, -4);
    expect(fixedGasChannels(field)).toEqual(['gas:marsh-gas']);
    expect(deviationOf(field, 'gas:marsh-gas')).toBe(0.5);
    expect(deviationOf(field, 'temperature')).toBe(4);
    expect(deviationOf(field, 'moisture')).toBe(0);
  });

  it('settleProblem says what has not settled', () => {
    const mw = buildWorld(world([entity({ burning: true, flammable: true, fuel: 1 })]));
    expect(settleProblem(mw)).toBe('something is still burning');
    const quiet = buildWorld(world([]));
    expect(settleProblem(quiet)).toBeUndefined();
    quiet.field.add('gas:smoke', { x: 1, y: 1, z: 1 }, 0.9);
    expect(settleProblem(quiet)).toMatch(/gas:smoke is still 0\.8999/);
    // A channel that never decays is not expected to return to ambient.
    const fixed = buildWorld(world([]));
    fixed.field.add('gas:marsh-gas', { x: 1, y: 1, z: 1 }, 0.9);
    expect(settleProblem(fixed)).toBeUndefined();
  });
});

describe('runWorld and checkWorld', () => {
  it('runs a quiet world clean, and the digest is the same under any material names', () => {
    const spec = world(
      [entity({ temperature: 20, flammable: true, fuel: 1 }, { material: 0 })],
      [blast('heat', { intensity: 2000 }), blast('gas', { gas: 'smoke', intensity: 1 })],
      [{ preset: { hp: 10 }, charred: true }],
    );
    const a = runWorld(spec);
    const b = runWorld(spec, { relabel: true });
    expect(a.violations).toEqual([]);
    expect(a.digest).toBe(b.digest);
    expect(a.ticks).toBeGreaterThan(300);
    expect(runWorld(spec, { check: false, settleTicks: 0 }).ticks).toBe(300);
    expect(digestOf(buildWorld(spec), false)).toContain('mat-0'.length > 0 ? '0' : '');
  });

  it('digest marks a destroyed object', () => {
    const spec = world([entity({ burning: true, flammable: true, fuel: 0.1 })]);
    const mw = buildWorld(spec);
    mw.world.destroy(first(mw.ids));
    expect(digestOf(mw, false)).toContain('[[null],');
  });

  it('reports a world that has not settled as a termination failure', () => {
    const spec = world([entity({ burning: true, flammable: true, fuel: MAX_FUEL })]);
    const report = runWorld(spec, { ticks: 10, settleTicks: 1 });
    expect(report.violations).toEqual([
      { invariant: 'termination', tick: 70, message: 'something is still burning' },
    ]);
  });

  it('notices burning allowed while frozen (the injected bug)', () => {
    const spec = world([entity({ frozen: true, flammable: true, temperature: -10 })]);
    expect(runWorld(spec).violations).toEqual([]);
    const [violation] = runWorld(spec, { bug: 'burn-while-frozen' }).violations;
    expect(violation?.invariant).toBe('consistent');
    expect(violation?.message).toMatch(/burning-while-frozen/);
  });

  it('checkWorld runs the checks, a repeat run and a relabelled run', () => {
    expect(checkWorld(world([entity()]), { ticks: 20, settleTicks: 0 })).toEqual([]);
    const broken = world([entity({ frozen: true, flammable: true })]);
    expect(checkWorld(broken, { bug: 'burn-while-frozen', ticks: 5 })[0]?.invariant).toBe(
      'consistent',
    );
  });

  it('checkWorld names a determinism or label failure from the runs that disagree', () => {
    const report = (hash: string, digest: string): RunReport => ({
      violations: [],
      hash,
      digest,
      ticks: 300,
    });
    const spec = world([]);
    const runs = (second: RunReport, third: RunReport) => {
      const queue = [report('a', 'x'), second, third];
      return (): RunReport => {
        const next = queue.shift();
        if (next === undefined) throw new Error('ran out of runs');
        return next;
      };
    };
    expect(checkWorld(spec, {}, runs(report('b', 'x'), report('a', 'x')))[0]?.invariant).toBe(
      'determinism',
    );
    expect(checkWorld(spec, {}, runs(report('a', 'x'), report('a', 'y')))[0]?.invariant).toBe(
      'label-independence',
    );
    expect(checkWorld(spec, {}, runs(report('a', 'x'), report('a', 'x')))).toEqual([]);
  });
});

describe('AC-5: extreme values', () => {
  const edges = (pick: 'min' | 'max'): Record<string, unknown> => ({
    temperature: pick === 'min' ? -273.15 : 10_000,
    weight: pick === 'min' ? 0 : 1_000_000,
    hp: pick === 'min' ? 0 : 1_000_000,
    fuel: pick === 'min' ? 0 : MAX_FUEL,
    wetness: pick === 'min' ? 0 : 1,
    absorbency: pick === 'min' ? 0 : 1,
    charge: pick === 'min' ? 0 : 1_000_000,
    ignitionPoint: pick === 'min' ? -273.15 : 10_000,
    freezePoint: pick === 'min' ? -273.15 : 10_000,
    density: pick === 'min' ? 0.01 : 100_000,
    flammable: pick === 'max',
    conductive: pick === 'max',
    pushable: pick === 'max',
    liftable: pick === 'max',
  });

  it('AC-5: no NaN or Infinity at temperature 1e6, weight 0 and radius 0', () => {
    for (const pick of ['min', 'max'] as const) {
      const spec = world(
        [entity(edges(pick), { radius: 0 }), entity(edges(pick), { radius: 0, x: 4.5 })],
        MATRIX_ELEMENTS.flatMap((element) =>
          [1e6, 1e9].map((intensity) =>
            blast(element, {
              intensity,
              ...(element === 'gas' && { gas: 'smoke' }),
              shape: { kind: 'sphere', center: { x: 4, y: 4, z: 4 }, radius: 4 },
            }),
          ),
        ),
      );
      expect(checkWorld(spec)).toEqual([]);
      const mw = buildWorld(spec);
      for (let tick = 0; tick < 5; tick++) {
        applyProgram(mw, spec, tick);
        mw.world.step();
      }
      expect(checkFinite(mw.world, mw.field)).toBeUndefined();
    }
  });
});
