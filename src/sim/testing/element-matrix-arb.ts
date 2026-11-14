// fast-check arbitraries for the interaction matrix harness (mw-e03.26): property bags drawn from
// the world-property schema itself (so a property added to the schema is fuzzed with no change
// here), materials, placements and stimulus programs, plus the property runner that checks every
// invariant of `checkWorld` and reports a failure as a shrunk, replayable world with its seed.

import fc from 'fast-check';
import {
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type AnyPropertySpec,
  type NumberRange,
} from '../properties/spec';
import {
  checkWorld,
  MATRIX_ELEMENTS,
  MATRIX_GASES,
  MAX_FUEL,
  type EntitySpec,
  type MaterialSpec,
  type RunOptions,
  type StimulusSpec,
  type Violation,
  type WorldSpec,
} from './element-matrix';
import type { StimulusShape } from '../stimulus/shapes';

/** Properties the elements act on most directly: the generator picks them more often. */
const CORE_KEYS: readonly string[] = [
  'temperature',
  'flammable',
  'ignitionPoint',
  'fuel',
  'burning',
  'wetness',
  'absorbency',
  'frozen',
  'freezePoint',
  'conductive',
  'charge',
  'weight',
  'hp',
  'pushable',
  'liftable',
  'breakable',
  'liquid',
  'extinguishable',
  'windResistance',
];

/** A number in `range`: mostly uniform, often one of its edges or a given special value. */
export function numberArb(
  range: NumberRange,
  specials: readonly number[] = [],
): fc.Arbitrary<number> {
  const edges = fc.constantFrom(range.min, range.max, ...specials);
  const body =
    range.integer === true
      ? fc.integer({ min: range.min, max: Math.min(range.max, range.min + 1000) })
      : fc.double({ min: range.min, max: range.max, noNaN: true, noDefaultInfinity: true });
  return fc.oneof({ weight: 3, arbitrary: body }, { weight: 2, arbitrary: edges });
}

/** A valid value for the property `key`, from its schema spec. */
export function valueArb(key: string): fc.Arbitrary<unknown> {
  const spec = (WORLD_PROPERTY_SPECS as Readonly<Record<string, AnyPropertySpec>>)[key];
  if (spec === undefined) throw new RangeError(`unknown world property "${key}"`);
  switch (spec.type) {
    case 'number':
      return numberArb(spec, [spec.default]);
    case 'boolean':
      return fc.boolean();
    case 'id':
      return fc.constantFrom('alpha', 'beta', spec.default);
    case 'enum':
      return fc.constantFrom(...spec.values);
    case 'record': {
      const fields = Object.fromEntries(
        Object.entries(spec.fields).map(([name, range]) => [name, numberArb(range)]),
      );
      return fc.record(fields, {
        noNullPrototype: true,
        ...(spec.partial === true && { requiredKeys: [] }),
      });
    }
  }
}

const pair = (key: string): fc.Arbitrary<readonly [string, unknown]> =>
  valueArb(key).map((value) => [key, value] as const);

/** A random property bag: a few properties, mostly the ones the elements act on. */
export function bagArb(maxProperties = 12): fc.Arbitrary<Record<string, unknown>> {
  const core = fc.oneof(...CORE_KEYS.map(pair));
  const rest = fc.oneof(
    ...WORLD_PROPERTY_KEYS.filter((k) => k !== 'material' && !CORE_KEYS.includes(k)).map(pair),
  );
  return fc
    .array(fc.oneof({ weight: 4, arbitrary: core }, { weight: 1, arbitrary: rest }), {
      maxLength: maxProperties,
    })
    .map((pairs) =>
      Object.fromEntries(
        pairs.map(([key, value]) => [
          key,
          key === 'fuel' ? Math.min(Number(value), MAX_FUEL) : value,
        ]),
      ),
    );
}

const coordinate = fc.integer({ min: 0, max: 15 }).map((n) => n / 2);

/** An object: a bag, an optional material, a place in the 8 m field and a radius (0 allowed). */
export function entityArb(materials: number): fc.Arbitrary<EntitySpec> {
  return fc.record({
    bag: bagArb(),
    material: fc.option(fc.integer({ min: 0, max: materials - 1 }), { nil: undefined }),
    placed: fc.oneof(
      { weight: 5, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    x: coordinate,
    y: coordinate,
    z: coordinate,
    radius: fc.oneof(
      fc.constant(0),
      fc.double({ min: 0, max: 1.5, noNaN: true, noDefaultInfinity: true }),
    ),
  }) as fc.Arbitrary<EntitySpec>;
}

/** A material: a preset bag and whether burning leaves a burnt state. */
export const materialArb: fc.Arbitrary<MaterialSpec> = fc.record({
  preset: bagArb(),
  charred: fc.boolean(),
});

const point = fc.record({ x: coordinate, y: coordinate, z: coordinate });
const size = fc.double({ min: 0, max: 4, noNaN: true, noDefaultInfinity: true });
const axis = fc.constantFrom(
  { x: 1, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 1, z: 0 },
);

/** A stimulus shape; contact targets are entity indexes, wrapped by the harness. */
export const shapeArb: fc.Arbitrary<StimulusShape> = fc.oneof(
  point.map((at): StimulusShape => ({ kind: 'point', at })),
  fc.record({ kind: fc.constant('sphere' as const), center: point, radius: size }),
  fc.record({
    kind: fc.constant('cone' as const),
    apex: point,
    direction: axis,
    length: size,
    halfAngle: fc.double({ min: 0, max: Math.PI / 2, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({ kind: fc.constant('capsule' as const), from: point, to: point, radius: size }),
  fc.record({
    kind: fc.constant('box' as const),
    center: point,
    halfExtents: fc.record({ x: size, y: size, z: size }),
  }),
  fc.nat(15).map((target): StimulusShape => ({ kind: 'contact', target: target + 1 })),
);

/** An amount of an element: small, large or the extreme (1e6 heat). */
const intensityArb = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }) },
  { weight: 3, arbitrary: fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 1e-9, 1e6, 1e9) },
);

/** One program step, applied at a tick below `lastTick`. */
export function stimulusArb(lastTick: number): fc.Arbitrary<StimulusSpec> {
  return fc
    .record({
      tick: fc.integer({ min: 0, max: lastTick }),
      element: fc.constantFrom(...MATRIX_ELEMENTS),
      shape: shapeArb,
      intensity: intensityArb,
      duration: fc.oneof(
        fc.constant(0),
        fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
      ),
      falloff: fc.constantFrom('linear' as const, 'none' as const),
      gas: fc.constantFrom(...MATRIX_GASES),
      maxWeight: fc.option(
        fc.double({ min: 0.001, max: 1000, noNaN: true, noDefaultInfinity: true }),
        {
          nil: undefined,
        },
      ),
    })
    .map(({ gas, maxWeight, ...step }): StimulusSpec => ({
      ...step,
      ...(step.element === 'gas' && { gas }),
      ...(step.element === 'force' && maxWeight !== undefined && { maxWeight }),
    }));
}

/** A whole world: one to three materials, up to eight objects and up to twelve stimuli. */
export function worldArb(programTicks = 150): fc.Arbitrary<WorldSpec> {
  return fc.integer({ min: 1, max: 3 }).chain((materials) =>
    fc.record({
      seed: fc.integer({ min: 0, max: 0x7fffffff }),
      materials: fc.array(materialArb, { minLength: materials, maxLength: materials }),
      entities: fc.array(entityArb(materials), { minLength: 1, maxLength: 8 }),
      program: fc.array(stimulusArb(programTicks), { maxLength: 12 }),
    }),
  );
}

/** What a property run found. */
export interface MatrixOutcome {
  readonly ok: boolean;
  readonly seed: number;
  readonly runs: number;
  /** Failure only: the shrunk world and what it broke. */
  readonly counterexample?: WorldSpec;
  readonly violations?: readonly Violation[];
  /** Failure only: a printable report with the seed and the minimal world. */
  readonly report?: string;
}

/** How to run the property. */
export interface MatrixPropertyOptions extends RunOptions {
  readonly seed: number;
  readonly worlds: number;
}

/**
 * Checks every invariant over `worlds` generated worlds from `seed`. A failure shrinks to a minimal
 * world and comes back with a report: the seed, the broken invariants and the world as JSON.
 */
export function runMatrixProperty(options: MatrixPropertyOptions): MatrixOutcome {
  const { seed, worlds, ...run } = options;
  const details = fc.check(
    fc.property(worldArb(), (spec) => checkWorld(spec, run).length === 0),
    { seed, numRuns: worlds },
  );
  if (!details.failed) return { ok: true, seed, runs: details.numRuns };
  const counterexample = (details.counterexample as [WorldSpec])[0];
  const violations = checkWorld(counterexample, run);
  const lines = violations.map((v) => `  ${v.invariant} at tick ${String(v.tick)}: ${v.message}`);
  return {
    ok: false,
    seed,
    runs: details.numRuns,
    counterexample,
    violations,
    report: [
      `Interaction matrix property failed (seed ${String(seed)}, after ${String(details.numRuns)} worlds, ${String(details.numShrinks)} shrinks).`,
      ...lines,
      `Minimal world: ${JSON.stringify(counterexample)}`,
      `Replay: runMatrixProperty({ seed: ${String(seed)}, worlds: ${String(worlds)} })`,
    ].join('\n'),
  };
}
