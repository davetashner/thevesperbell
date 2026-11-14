// The interaction matrix harness (mw-e03.26): builds a sandbox world from a plain, serialisable
// `WorldSpec` (random property bags, materials, placements and a stimulus program), runs it
// headless and checks the invariants that make emergence safe: nothing crashes, nothing loops
// forever, nothing is created from nothing, and no combination nobody designed breaks a rule.
//
// What is checked (every name is an `Invariant`):
// - `finite`: no property, placement or field value is NaN or infinite, and every stored property
//   is inside its schema range (`validateProperty`).
// - `consistent`: `findPropertyViolations` is empty after every tick (frozen implies not burning,
//   frozen implies at or below the freeze point, burning implies flammable…), a burning object has
//   fuel left, and an object that burnt out is gone or is its inert burnt state with no fuel.
// - `conservation`: measured from tick to tick, without modelling any one rule. Diffusion creates
//   and destroys nothing: what a field loses in its step is exactly what the step reports as lost.
//   And nothing is made from nothing: on a tick with no source of an element, the heat, water,
//   charge and non-decaying gas in the world cannot grow. Heat counts the field plus every placed
//   object that exists on both ticks (the heat rules move heat one for one between them; a source
//   is a heat or cold stimulus or a burning object); water counts object wetness and field
//   moisture; charge counts object charge and field charge; a gas that never decays is conserved
//   exactly.
// - `termination`: after the program ends the world settles. Nothing is burning, and every field
//   channel that decays is back within its sleep epsilon of ambient, inside `settleTicks`.
// - `determinism`: two runs of one spec end in the same state hash.
// - `label-independence`: renaming every material id changes nothing but the names. Interactions
//   come from properties, never from what an object is called (no type-pair logic reachable).
//
// This is test-support code: it lives beside the sim's other harnesses, is covered like them and is
// not exported from `@sim/index`.

import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  conductionRules,
  elementFieldOf,
  elementFieldSystem,
  ElementRuleSet,
  elementRulesSystem,
  fireBurntOut,
  fireIgnited,
  fireRules,
  freezeRules,
  installElementField,
  installIce,
  installLiquids,
  liquidRules,
  type ElementRule,
} from '../index';
import type { ElementField } from '../field/grid';
import type { FieldConfigInput } from '../field/config';
import { toUnits } from '../field/config';
import {
  addProperties,
  assignProperty,
  entitiesWithProperty,
  forEachWithProperty,
  getProperty,
  propertyChanged,
  readProperty,
  registerWorldProperties,
  type PropertyChange,
  type WorldPropertyInit,
} from '../properties/components';
import { findPropertyViolations } from '../properties/derived';
import { applyMaterial } from '../properties/materials';
import { WORLD_PROPERTY_KEYS, WORLD_PROPERTY_SPECS, validateProperty } from '../properties/spec';
import { PlacementComponent, placeEntity, validatePlacement } from '../stimulus/placement';
import type { StimulusElement, StimulusInput } from '../stimulus/stimulus';
import {
  applyStimulus,
  installStimuli,
  stimulusResolved,
  stimulusSystem,
} from '../stimulus/stimulus';
import type { StimulusShape } from '../stimulus/shapes';
import { hashWorld } from '../snapshot';

/** The seven elements the matrix covers (the blunt, slash and pierce hits act on breakables only). */
export const MATRIX_ELEMENTS = [
  'heat',
  'cold',
  'water',
  'charge',
  'force',
  'gas',
  'light',
] as const satisfies readonly StimulusElement[];

/** One matrix element. */
export type MatrixElement = (typeof MATRIX_ELEMENTS)[number];

/** Gases the generator uses: two that decay and one that never does (so conservation is exact). */
export const MATRIX_GASES = ['smoke', 'steam', 'marsh-gas'] as const;

/** The longest an object may burn in a generated world, s (a bounded fire is what ends). */
export const MAX_FUEL = 4;

/**
 * A small field keeps a world cheap: one chunk of 8 × 8 × 8 one-metre cells, the cube from the origin
 * to (8, 8, 8). Anything the chunk cap refuses acts as a wall, which the generator exercises too.
 */
export const MATRIX_FIELD: FieldConfigInput = { cellSize: 1, maxChunks: 1 };

/** One object in a generated world. */
export interface EntitySpec {
  /** Its own property values, over its material's preset. Raw: `buildWorld` makes them consistent. */
  readonly bag: Readonly<Record<string, unknown>>;
  /** Index into `WorldSpec.materials`, or absent for no material. */
  readonly material?: number;
  /** Placed in the world (unplaced objects are reachable only by contact stimuli). */
  readonly placed: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** A material of a generated world: a preset and whether burning leaves an inert burnt state. */
export interface MaterialSpec {
  readonly preset: Readonly<Record<string, unknown>>;
  readonly charred: boolean;
}

/** A stimulus the program applies; `contact` shapes name an entity by index. */
export interface StimulusSpec {
  readonly tick: number;
  readonly element: StimulusElement;
  readonly shape: StimulusShape;
  readonly intensity: number;
  readonly duration: number;
  readonly falloff: 'linear' | 'none';
  readonly gas?: string;
  readonly maxWeight?: number;
}

/** A whole generated world: plain data, so a failing one prints and replays. */
export interface WorldSpec {
  readonly seed: number;
  readonly materials: readonly MaterialSpec[];
  readonly entities: readonly EntitySpec[];
  readonly program: readonly StimulusSpec[];
}

/** The invariants (see the file header). */
export type Invariant =
  'finite' | 'consistent' | 'conservation' | 'termination' | 'determinism' | 'label-independence';

/** One broken invariant. */
export interface Violation {
  readonly invariant: Invariant;
  /** Tick it was seen on (the settle ticks count on from the program's). */
  readonly tick: number;
  readonly message: string;
}

/** Bugs the harness can inject into the rules, to prove it notices them. */
export const INJECTABLE_BUGS = ['burn-while-frozen'] as const;

/** One injectable bug. */
export type InjectableBug = (typeof INJECTABLE_BUGS)[number];

/** How a world is built and run. */
export interface RunOptions {
  /** Ticks the program runs for (default 300). */
  readonly ticks?: number;
  /** Most ticks to wait for the world to settle after them (default 6000; 0 skips the check). */
  readonly settleTicks?: number;
  /** A bug to put into the rules (default none). */
  readonly bug?: InjectableBug;
  /** Rename every material id (the label independence run). */
  readonly relabel?: boolean;
  /** Check invariants as it runs (default true); off for the repeat runs. */
  readonly check?: boolean;
  /** Called with every property change, for the matrix report. */
  readonly onChange?: (change: PropertyChange) => void;
}

/** Ticks a world runs by default. */
export const DEFAULT_TICKS = 300;
/** Ticks to wait at most for a world to settle. */
export const DEFAULT_SETTLE_TICKS = 6000;
/** Tolerance on a sum of field units (the field is fixed point; this is far above its rounding). */
const TOLERANCE = 1e-6;
/** Tolerance on a temperature extreme, °C: the field is fixed point and exchanges round. */
const EXTREME_TOLERANCE = 0.01;

const materialId = (index: number, relabel: boolean): string =>
  relabel ? `zz-${String((index * 7 + 3) % 11)}-${String(index)}` : `mat-${String(index)}`;
const charredId = (index: number, relabel: boolean): string =>
  `${materialId(index, relabel)}-burnt`;

/** The keys the generator never sets: they name other entities or need a definition elsewhere. */
const UNSAFE_KEYS = new Set<string>(['support', 'suspended', 'trap', 'trapped']);

/**
 * `bag` made consistent the way content would be: no property the world cannot back (support,
 * trap), and none of the contradictions `findPropertyViolations` names. The generator's raw bags
 * contradict themselves on purpose; a start that is already broken is a data bug, not a sim bug.
 */
export function consistentBag(raw: Readonly<Record<string, unknown>>): WorldPropertyInit {
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!UNSAFE_KEYS.has(key)) bag[key] = value;
  if (bag['waterSurface'] === true && bag['liquid'] !== true) delete bag['waterSurface'];
  if (bag['transparent'] === true && bag['opaque'] === true) delete bag['opaque'];
  if (typeof bag['fuel'] === 'number') bag['fuel'] = Math.min(bag['fuel'], MAX_FUEL);
  if (bag['burning'] === true) {
    if (bag['frozen'] === true) delete bag['burning'];
    else {
      bag['flammable'] = true;
      bag['fuel'] = Math.max(Number(bag['fuel'] ?? 0), 0.5);
    }
  }
  if (bag['frozen'] === true) {
    const point = Number(bag['freezePoint'] ?? WORLD_PROPERTY_SPECS.freezePoint.default);
    const now = Number(bag['temperature'] ?? WORLD_PROPERTY_SPECS.temperature.default);
    bag['temperature'] = Math.min(now, point);
  }
  return bag; // validated by addProperties; the generator stays in range
}

/** What a built world is: the world, its field and its entities by spec index. */
export interface MatrixWorld {
  readonly world: World<never>;
  readonly field: ElementField;
  /** Entity of each `WorldSpec.entities` item, in order. */
  readonly ids: readonly EntityId[];
  /** Entities that burnt out, with what they became (null: burnt away), as the world ran. */
  readonly burnouts: { readonly entity: EntityId; readonly becomes: string | null }[];
  /** Elements (and gas channels) whose stimuli resolved on the tick being run. */
  readonly sources: Set<string>;
}

function bugRules(bug: InjectableBug | undefined): ElementRule[] {
  if (bug === undefined) return [];
  return [
    {
      // Burning allowed while frozen: lights anything flammable that is frozen solid.
      id: 'bug.burn-while-frozen',
      phase: 'settle',
      run: ({ world }) => {
        for (const entity of entitiesWithProperty(world, 'frozen')) {
          if (readProperty(world, entity, 'frozen') && readProperty(world, entity, 'flammable')) {
            assignProperty(world, entity, 'burning', true);
          }
        }
      },
    },
  ];
}

/** Builds the sandbox world for `spec`: properties, stimuli, field, ice, liquids and every rule. */
export function buildWorld(spec: WorldSpec, options: RunOptions = {}): MatrixWorld {
  const relabel = options.relabel === true;
  const presets = new Map<string, WorldPropertyInit>();
  const burnt = new Map<string, string | null>();
  spec.materials.forEach((material, index) => {
    const id = materialId(index, relabel);
    presets.set(id, consistentBag(material.preset));
    if (material.charred) {
      presets.set(charredId(index, relabel), { flammable: false, fuel: 0, burning: false });
      burnt.set(id, charredId(index, relabel));
    } else {
      burnt.set(id, null);
    }
  });
  const world = installIce(
    installLiquids(
      installElementField(installStimuli(registerWorldProperties(new World<never>(spec))), {
        ...MATRIX_FIELD,
      }),
    ),
  );
  const field = elementFieldOf(world);
  const rules = new ElementRuleSet([
    ...fireRules({ presets, burnt }),
    ...freezeRules(),
    ...liquidRules({ presets }),
    ...conductionRules(),
    ...bugRules(options.bug),
  ]);
  const sources = new Set<string>();
  world.events.on(stimulusResolved, ({ stimulus }) => {
    sources.add(stimulus.element === 'gas' ? `gas:${String(stimulus.gas)}` : stimulus.element);
  });
  world.events.on(fireIgnited, () => sources.add('fire'));
  const burnouts: { entity: EntityId; becomes: string | null }[] = [];
  world.events.on(fireBurntOut, (e) => burnouts.push({ entity: e.entity, becomes: e.becomes }));
  if (options.onChange !== undefined) world.events.on(propertyChanged, options.onChange);
  world.addSystem(stimulusSystem()).addSystem(elementRulesSystem(rules));
  const ids = spec.entities.map((entity) => {
    const id = world.spawn();
    const material = entity.material;
    const init: Record<string, unknown> = { ...entity.bag };
    if (material !== undefined) init['material'] = materialId(material, relabel);
    // The preset under the bag, then made consistent (a merge can contradict itself).
    const merged = consistentBag(applyMaterial(presets, init));
    addProperties(world, id, merged);
    if (entity.placed)
      placeEntity(world, id, { x: entity.x, y: entity.y, z: entity.z }, entity.radius);
    return id;
  });
  return { world, field, ids, burnouts, sources };
}

/** Applies the stimuli of `spec.program` that fall on `tick`. */
export function applyProgram(mw: MatrixWorld, spec: WorldSpec, tick: number): void {
  for (const step of spec.program) {
    if (step.tick !== tick) continue;
    const { shape } = step;
    if (shape.kind === 'contact') {
      const target = mw.ids[shape.target % Math.max(1, mw.ids.length)];
      if (target === undefined) continue;
      applyStimulus(mw.world, input(step, { kind: 'contact', target }));
    } else {
      applyStimulus(mw.world, input(step, shape));
    }
  }
}

function input(step: StimulusSpec, shape: StimulusShape): StimulusInput {
  return {
    shape,
    element: step.element,
    intensity: step.intensity,
    duration: step.duration,
    falloff: step.falloff,
    ...(step.gas !== undefined && { gas: step.gas }),
    ...(step.maxWeight !== undefined && { maxWeight: step.maxWeight }),
  };
}

/** Every number in the world is finite and in range, or a message naming the first that is not. */
export function checkFinite(world: World<never>, field: ElementField): string | undefined {
  for (const key of WORLD_PROPERTY_KEYS) {
    let problem: string | undefined;
    forEachWithProperty(world, key, (entity, value) => {
      const found = validateProperty(key, value);
      if (found !== undefined) problem ??= `entity ${String(entity)}: ${found}`;
    });
    if (problem !== undefined) return problem;
  }
  let bad: string | undefined;
  world.query(PlacementComponent).forEach((entity, placement) => {
    const problem = validatePlacement(placement);
    if (problem !== undefined) bad ??= `entity ${String(entity)} ${problem}`;
  });
  if (bad !== undefined) return bad;
  for (const channel of field.channels()) {
    if (!Number.isFinite(field.total(channel))) return `field ${channel} is not finite`;
  }
  return undefined;
}

/** Property violations, and burning objects with no fuel, as one message. */
export function checkConsistent(world: World<never>): string | undefined {
  const [first] = findPropertyViolations(world);
  if (first !== undefined) return `${first.rule}: ${first.message}`;
  for (const entity of entitiesWithProperty(world, 'burning')) {
    if (readProperty(world, entity, 'burning') && readProperty(world, entity, 'fuel') <= 0) {
      return `entity ${String(entity)} is burning with no fuel left`;
    }
  }
  return undefined;
}

/** Objects that burnt out this run must be gone, or be an inert burnt state with no fuel. */
export function checkBurnouts(mw: MatrixWorld): string | undefined {
  for (const { entity, becomes } of mw.burnouts) {
    if (becomes === null) {
      if (mw.world.isAlive(entity)) return `entity ${String(entity)} burnt away but still exists`;
    } else if (
      readProperty(mw.world, entity, 'fuel') !== 0 ||
      readProperty(mw.world, entity, 'burning')
    ) {
      return `entity ${String(entity)} is burnt (${becomes}) but has fuel or is burning`;
    }
  }
  return undefined;
}

/** What is in the world at one moment, for the conservation checks. */
export interface Measure {
  readonly fields: ReadonlyMap<string, number>;
  /** The hottest and coldest temperature anywhere: any cell or any object with a temperature. */
  readonly hottest: number;
  readonly coldest: number;
  readonly wetness: ReadonlyMap<EntityId, number>;
  readonly charge: ReadonlyMap<EntityId, number>;
  readonly burning: number;
  /** Objects holding charge: a charged flammable object heats itself to its ignition point. */
  readonly charged: number;
}

/** Every channel's total deviation from ambient, units × cells. */
export function fieldTotals(field: ElementField): Map<string, number> {
  const totals = new Map<string, number>();
  for (const channel of field.channels()) totals.set(channel, field.total(channel));
  return totals;
}

/** Measures `world` and `field`. */
export function measure(world: World<never>, field: ElementField): Measure {
  const fields = fieldTotals(field);
  const { ambient } = field.config.temperature;
  let hottest = ambient + largest(field, 'temperature', Math.max);
  let coldest = ambient + largest(field, 'temperature', Math.min);
  forEachWithProperty(world, 'temperature', (_entity, t) => {
    hottest = Math.max(hottest, t);
    coldest = Math.min(coldest, t);
  });
  const wetness = new Map<EntityId, number>();
  forEachWithProperty(world, 'wetness', (entity, value) => wetness.set(entity, value));
  let charged = 0;
  const charge = new Map<EntityId, number>();
  forEachWithProperty(world, 'charge', (entity, value) => {
    charge.set(entity, value);
    if (value > 0) charged++;
  });
  let burning = 0;
  forEachWithProperty(world, 'burning', (_entity, value) => {
    if (value) burning++;
  });
  return { fields, hottest, coldest, wetness, charge, burning, charged };
}

/** The sum of `now` over the entities that exist in both maps, and the same entities' `before`. */
function shared(
  before: ReadonlyMap<EntityId, number>,
  now: ReadonlyMap<EntityId, number>,
): readonly [number, number] {
  let was = 0;
  let is = 0;
  for (const [entity, value] of now) {
    const old = before.get(entity);
    if (old === undefined) continue;
    was += old;
    is += value;
  }
  return [was, is];
}

const fieldOf = (m: Measure, channel: string): number => m.fields.get(channel) ?? 0;
const grew = (before: number, now: number): boolean =>
  now > before + TOLERANCE * Math.max(1, Math.abs(before));

/**
 * Nothing is made from nothing between two measures: on a tick without a source of an element, the
 * element's total in the world cannot grow (see the file header). `sources` holds the elements and
 * gas channels whose stimuli resolved on the tick; `fixedGases` the gas channels that never decay.
 */
export function checkNothingCreated(
  before: Measure,
  now: Measure,
  sources: ReadonlySet<string>,
  fixedGases: readonly string[],
  ambient: number,
): string | undefined {
  if (
    !sources.has('heat') &&
    !sources.has('cold') &&
    before.burning + now.burning + before.charged + now.charged === 0 &&
    !sources.has('fire')
  ) {
    // Heat only moves: no object or cell gets hotter than the hottest there was, or colder than the
    // coldest (ambient is always allowed: the field and objects lose heat to their surroundings).
    if (now.hottest > Math.max(before.hottest, ambient) + EXTREME_TOLERANCE) {
      return `heat grew: something reached ${String(now.hottest)} °C, above ${String(before.hottest)} °C, with no source`;
    }
    if (now.coldest < Math.min(before.coldest, ambient) - EXTREME_TOLERANCE) {
      return `cold grew: something reached ${String(now.coldest)} °C, below ${String(before.coldest)} °C, with no source`;
    }
  }
  if (!sources.has('water')) {
    const [was, is] = shared(before.wetness, now.wetness);
    if (grew(fieldOf(before, 'moisture') + was, fieldOf(now, 'moisture') + is)) {
      return 'water grew with no source';
    }
  }
  if (!sources.has('charge')) {
    const [was, is] = shared(before.charge, now.charge);
    if (grew(fieldOf(before, 'charge') + was, fieldOf(now, 'charge') + is)) {
      return 'charge grew with no source';
    }
  }
  for (const gas of fixedGases) {
    const was = fieldOf(before, gas);
    const is = fieldOf(now, gas);
    if (!sources.has(gas) && Math.abs(is - was) > TOLERANCE * Math.max(1, Math.abs(was))) {
      return `${gas} was not conserved: ${String(was)} became ${String(is)} with no source`;
    }
  }
  return undefined;
}

/**
 * Diffusion creates and destroys nothing: per channel, the total before the field's step minus the
 * total after it is exactly what the step reports it removed.
 */
export function checkDiffusion(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  lost: Readonly<Record<string, number>>,
): string | undefined {
  for (const channel of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(channel) ?? 0;
    const is = after.get(channel) ?? 0;
    const reported = lost[channel] ?? 0;
    if (Math.abs(was - is - reported) > TOLERANCE * Math.max(1, Math.abs(was))) {
      return `${channel} changed by ${String(is - was)} in diffusion but ${String(-reported)} was reported`;
    }
  }
  return undefined;
}

/** The most extreme deviation (by `pick`: max or min) of any cell of `channel`, units, from 0. */
function largest(
  field: ElementField,
  channel: string,
  pick: (a: number, b: number) => number,
): number {
  let extreme = 0;
  for (const chunk of field.chunkList()) {
    const layer = chunk.layers.get(channel as never);
    if (layer !== undefined) for (const value of layer) extreme = pick(extreme, value);
  }
  return toUnits(extreme);
}

/** The largest distance of any cell of `channel` from ambient, units. */
export function deviationOf(field: ElementField, channel: string): number {
  let largest = 0;
  for (const chunk of field.chunkList()) {
    const layer = chunk.layers.get(channel as never);
    if (layer !== undefined)
      for (const value of layer) largest = Math.max(largest, Math.abs(value));
  }
  return toUnits(largest);
}

/** Gas channels a stimulus program puts in that never decay (so they are conserved exactly). */
export function fixedGasChannels(field: ElementField): string[] {
  return field
    .channels()
    .filter((channel) => channel.startsWith('gas:') && field.channel(channel).decay === 0);
}

/** Whether the world has settled: nothing burns and every decaying channel is back near ambient. */
export function settleProblem(mw: MatrixWorld): string | undefined {
  if (measure(mw.world, mw.field).burning > 0) return 'something is still burning';
  for (const channel of mw.field.channels()) {
    const fixed = mw.field.channel(channel);
    if (fixed.decay === 0) continue;
    const away = deviationOf(mw.field, channel);
    if (away > fixed.spec.epsilon) {
      return `${channel} is still ${String(away)} from ambient`;
    }
  }
  return undefined;
}

/** What a run found. */
export interface RunReport {
  readonly violations: readonly Violation[];
  /** Hash of the world state when the program's ticks ended (before it settled). */
  readonly hash: string;
  /** That state with material ids replaced by their index (equal across relabelled runs). */
  readonly digest: string;
  /** Ticks run, settling included. */
  readonly ticks: number;
}

/** Ticks between the conservation checks while the program runs, and while the world settles. */
export const CHECK_EVERY = 5;
const SETTLE_CHECK_EVERY = 60;

/** The world's state with material names replaced by indexes, as one comparable string. */
export function digestOf(mw: MatrixWorld, relabel: boolean): string {
  const names = new Map<string, number>();
  for (let i = 0; i < 16; i++) {
    names.set(materialId(i, relabel), i);
    names.set(charredId(i, relabel), 100 + i);
  }
  const rows = mw.ids.map((id) =>
    mw.world.isAlive(id)
      ? WORLD_PROPERTY_KEYS.map((key) => {
          const value = getProperty(mw.world, id, key);
          return key === 'material' ? names.get(value as string) : value;
        })
      : null,
  );
  return JSON.stringify([rows, mw.field.serialize()]);
}

/**
 * Runs `spec` for `ticks`, then until it settles, and reports what it found (see the file header).
 * The cheap checks run every tick; the ones that measure the whole world every `CHECK_EVERY` ticks,
 * over a window whose sources are the union of the window's ticks.
 */
export function runWorld(spec: WorldSpec, options: RunOptions = {}): RunReport {
  const ticks = options.ticks ?? DEFAULT_TICKS;
  const settle = options.settleTicks ?? DEFAULT_SETTLE_TICKS;
  const check = options.check !== false;
  const mw = buildWorld(spec, options);
  const violations: Violation[] = [];
  const fail = (invariant: Invariant, tick: number, message: string | undefined): void => {
    if (message !== undefined && violations.length === 0) {
      violations.push({ invariant, tick, message });
    }
  };
  let tick = 0;
  let every = CHECK_EVERY;
  let since = 0;
  let before = measure(mw.world, mw.field);
  let pre = before.fields;
  let lost: Readonly<Record<string, number>> = {};
  // Totals just before and after the field's own step, which runs last in the tick.
  mw.world.addSystem({
    name: 'matrix-before-diffusion',
    run: () => {
      if (check && since + 1 >= every) pre = fieldTotals(mw.field);
    },
  });
  mw.world.addSystem(
    elementFieldSystem((report) => {
      lost = report.lost;
    }),
  );
  const step = (): void => {
    applyProgram(mw, spec, tick);
    mw.world.step();
    since++;
    if (check) {
      fail('consistent', tick, checkConsistent(mw.world));
      if (since >= every) {
        const now = measure(mw.world, mw.field);
        fail('finite', tick, tick % 20 === 19 ? checkFinite(mw.world, mw.field) : undefined);
        fail('conservation', tick, checkDiffusion(pre, now.fields, lost));
        fail(
          'conservation',
          tick,
          checkNothingCreated(
            before,
            now,
            mw.sources,
            fixedGasChannels(mw.field),
            mw.field.config.temperature.ambient,
          ),
        );
        before = now;
        since = 0;
        mw.sources.clear();
      }
    }
    tick++;
  };
  while (tick < ticks && violations.length === 0) step();
  const programEnd = tick;
  const hash = hashWorld(mw.world);
  const digest = digestOf(mw, options.relabel === true);
  if (check) {
    fail('finite', tick, checkFinite(mw.world, mw.field));
    fail('consistent', tick, checkBurnouts(mw));
    every = SETTLE_CHECK_EVERY;
    since = 0;
    before = measure(mw.world, mw.field);
    mw.sources.clear();
  }
  while (tick - programEnd < settle && violations.length === 0 && settleProblem(mw) !== undefined) {
    for (let i = 0; i < SETTLE_CHECK_EVERY; i++) step();
  }
  if (check && settle > 0) fail('termination', tick, settleProblem(mw));
  return { violations, hash, digest, ticks: tick };
}

/**
 * Runs `spec` three ways and returns the violations of all of them: checked, again for the same
 * hash (determinism), and with every material id renamed for the same state (label independence).
 */
export function checkWorld(
  spec: WorldSpec,
  options: RunOptions = {},
  run: typeof runWorld = runWorld,
): readonly Violation[] {
  const first = run(spec, options);
  if (first.violations.length > 0) return first.violations;
  const again = run(spec, { ...options, check: false, settleTicks: 0 });
  if (again.hash !== first.hash) {
    return [
      {
        invariant: 'determinism',
        tick: first.ticks,
        message: 'two runs ended in different states',
      },
    ];
  }
  const renamed = run(spec, { ...options, check: false, relabel: true, settleTicks: 0 });
  if (renamed.digest !== first.digest) {
    return [
      {
        invariant: 'label-independence',
        tick: first.ticks,
        message: 'renaming the materials changed the outcome',
      },
    ];
  }
  return [];
}
