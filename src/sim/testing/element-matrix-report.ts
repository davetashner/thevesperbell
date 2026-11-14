// The interaction matrix report (mw-e03.26): for every element and every world property in the
// schema, what the sim actually does, observed by running it. Designers read it to see emergent
// behaviour ("heat on a soaked object no longer lights it") and a PR that changes an element rule
// shows up as a diff of docs/design/interaction-matrix.md.
//
// A cell is built from probes: one object stands in the sandbox world, one element hits it at full
// strength, and the world runs 40 ticks. The object is probed with the property at each of a few
// values (its schema range's edges and its default, both booleans, every enum value) over two
// bases, a dry flammable conductor and a soaked one (the second shows freezing, drying and
// conduction that the first cannot). Two things are read off the runs:
// - the property's own transitions: every change of this property the element caused;
// - the properties whose reaction the property changes: the other properties that react
//   differently when this one is given a different value (heat on a flammable object sets it
//   burning; `flammable` therefore gates `burning`).
// A transition the object makes by itself (a burning object burns out) is not credited to the
// element, so the report never says an element does what happens anyway.
// Properties the sandbox cannot give an object (a support entity, a trap definition) are probed with
// no value and read "no effect (not probed)". The text is deterministic: no times, no seeds.

import type { EntityId } from '../core/component';
import { impulseApplied } from '../stimulus/stimulus';
import {
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
  type AnyPropertySpec,
} from '../properties/spec';
import {
  buildWorld,
  applyProgram,
  MATRIX_ELEMENTS,
  type EntitySpec,
  type MatrixElement,
  type StimulusSpec,
  type WorldSpec,
} from './element-matrix';
import type { PropertyChange } from '../properties/components';

/** Ticks a probe runs after the stimulus. */
export const PROBE_TICKS = 40;

/** Properties the sandbox cannot give an object: they name another entity or a definition. */
export const UNPROBED_KEYS: readonly string[] = [
  'material',
  'support',
  'suspended',
  'trap',
  'trapped',
];

/** The two bases every probe starts from: a dry flammable conductor, and the same soaked. */
export const PROBE_BASES: readonly Readonly<Record<string, unknown>>[] = [
  {
    temperature: 20,
    flammable: true,
    ignitionPoint: 300,
    fuel: 0.3,
    conductive: true,
    weight: 10,
    pushable: true,
    hp: 100,
    freezePoint: 0,
    wetness: 0,
  },
  {
    temperature: 20,
    flammable: true,
    ignitionPoint: 300,
    fuel: 0.3,
    conductive: true,
    weight: 10,
    pushable: true,
    hp: 100,
    freezePoint: 0,
    wetness: 0.8,
  },
];

const AT = { x: 4, y: 4, z: 4 };

/** The one stimulus each element probes with, aimed at the probe object. */
export function probeStimulus(element: MatrixElement): StimulusSpec {
  const shape = { kind: 'sphere', center: AT, radius: 2 } as const;
  const base = { tick: 0, shape, duration: 0, falloff: 'linear' } as const;
  switch (element) {
    case 'heat':
      return { ...base, element, intensity: 2000 };
    case 'cold':
      return { ...base, element, intensity: 1000 };
    case 'water':
      return { ...base, element, intensity: 1 };
    case 'charge':
      return { ...base, element, intensity: 5000 };
    case 'force':
      // Centred a metre to the side, so the sphere pushes the object along +x.
      return {
        ...base,
        element,
        intensity: 50,
        shape: { ...shape, center: { ...AT, x: AT.x - 1 } },
      };
    case 'gas':
      return { ...base, element, intensity: 0.5, gas: 'marsh-gas' };
    case 'light':
      return { ...base, element, intensity: 500 };
  }
}

/** The values a property is probed with, from its schema spec. */
export function variantsOf(key: string): readonly unknown[] {
  const spec = (WORLD_PROPERTY_SPECS as Readonly<Record<string, AnyPropertySpec>>)[key];
  if (spec === undefined) throw new RangeError(`unknown world property "${key}"`);
  switch (spec.type) {
    case 'number':
      return [...new Set([spec.min, spec.default, spec.max])];
    case 'boolean':
      return [true, false];
    case 'id':
      return [spec.default, 'alpha'];
    case 'enum':
      return spec.values;
    case 'record': {
      const full = Object.fromEntries(Object.entries(spec.fields).map(([f, r]) => [f, r.max]));
      return [spec.default, full];
    }
  }
}

/** One probe's outcome: per property, the labels of every change the run made to it. */
export type Outcome = ReadonlyMap<string, ReadonlySet<string>>;

/** A property change as a short label: `↑`, `↓`, `false→true`, or `changed` for a record. */
export function labelOf(change: PropertyChange): string {
  const { old, new: next } = change;
  if (typeof next === 'number') return next > (old as number) ? '↑' : '↓';
  if (typeof next === 'object') return 'changed';
  return `${JSON.stringify(old)}→${JSON.stringify(next)}`;
}

/**
 * Runs one probe: `element` hits an object with `bag` (no element at all: the control run), and what
 * changed is read back.
 */
export function probe(
  element: MatrixElement | undefined,
  bag: Readonly<Record<string, unknown>>,
): Outcome {
  const entity: EntitySpec = { bag, placed: true, ...AT, radius: 0.5 };
  const spec: WorldSpec = {
    seed: 0,
    materials: [{ preset: {}, charred: false }],
    entities: [entity],
    program: element === undefined ? [] : [probeStimulus(element)],
  };
  const found = new Map<string, Set<string>>();
  const note = (key: string, text: string): void => {
    const labels = found.get(key) ?? new Set<string>();
    labels.add(text);
    found.set(key, labels);
  };
  const mw = buildWorld(spec, {
    onChange: (change) => {
      note(change.key, labelOf(change));
    },
  });
  const [id] = mw.ids as [EntityId];
  mw.world.events.on(impulseApplied, () => {
    note('(impulse)', 'pushed');
  });
  for (let tick = 0; tick < PROBE_TICKS; tick++) {
    applyProgram(mw, spec, tick);
    mw.world.step();
  }
  if (!mw.world.isAlive(id)) note('(object)', 'destroyed');
  return found;
}

/** What one element does to one property (see the file header). */
export interface MatrixCell {
  /** The property's own transitions, e.g. `false→true`, `↑`. */
  readonly own: readonly string[];
  /** Other properties that react differently when this one changes value. */
  readonly gates: readonly string[];
  /** The property cannot be given to a sandbox object. */
  readonly unprobed: boolean;
}

/** What `outcome` changed that `control` (the same object, left alone) did not. */
export function netOutcome(outcome: Outcome, control: Outcome): Outcome {
  const net = new Map<string, ReadonlySet<string>>();
  for (const [key, labels] of outcome) {
    const left = [...labels].filter((text) => !control.get(key)?.has(text));
    if (left.length > 0) net.set(key, new Set(left));
  }
  return net;
}

/** The outcome of `element` on `bag`, net of what the object does by itself. */
export function caused(element: MatrixElement, bag: Readonly<Record<string, unknown>>): Outcome {
  return netOutcome(probe(element, bag), probe(undefined, bag));
}

const same = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean =>
  [...(a ?? [])].sort().join('|') === [...(b ?? [])].sort().join('|');

/** A base object and what the element does to it unmodified. */
export interface Baseline {
  readonly base: Readonly<Record<string, unknown>>;
  readonly reference: Outcome;
}

/** The baselines of `element`: what it does to each probe base. */
export function baselinesFor(element: MatrixElement): Baseline[] {
  return PROBE_BASES.map((base) => ({ base, reference: caused(element, base) }));
}

/** The cell for `element` × `key`. */
export function cellFor(
  element: MatrixElement,
  key: string,
  baselines: readonly Baseline[],
): MatrixCell {
  if (UNPROBED_KEYS.includes(key)) return { own: [], gates: [], unprobed: true };
  const own = new Set<string>();
  const gates = new Set<string>();
  for (const { base, reference } of baselines) {
    for (const value of variantsOf(key)) {
      const outcome = caused(element, { ...base, [key]: value });
      for (const text of outcome.get(key) ?? []) own.add(text);
      for (const other of new Set([...outcome.keys(), ...reference.keys()])) {
        if (other !== key && !same(outcome.get(other), reference.get(other))) gates.add(other);
      }
    }
  }
  return { own: [...own].sort(), gates: [...gates].sort(), unprobed: false };
}

/** The whole matrix: per element, per property in schema order, a cell. */
export type Matrix = ReadonlyMap<MatrixElement, ReadonlyMap<string, MatrixCell>>;

/** Probes every element × property cell. */
export function buildMatrix(): Matrix {
  const matrix = new Map<MatrixElement, ReadonlyMap<string, MatrixCell>>();
  for (const element of MATRIX_ELEMENTS) {
    const baselines = baselinesFor(element);
    matrix.set(
      element,
      new Map(WORLD_PROPERTY_KEYS.map((key) => [key, cellFor(element, key, baselines)] as const)),
    );
  }
  return matrix;
}

/** A cell as one line of the report. */
export function describeCell(cell: MatrixCell): string {
  if (cell.unprobed) return 'no effect (not probed: needs another entity or a definition)';
  const parts = [
    ...(cell.own.length > 0 ? [`becomes ${cell.own.join(', ')}`] : []),
    ...(cell.gates.length > 0 ? [`changes the reaction of ${cell.gates.join(', ')}`] : []),
  ];
  return parts.length > 0 ? parts.join('; ') : 'no effect';
}

const ELEMENT_NOTES: Readonly<Record<MatrixElement, string>> = {
  heat: 'A 2000 point heat burst in a 2 m sphere around the object.',
  cold: 'A 1000 point cold burst in a 2 m sphere around the object.',
  water: 'One unit of water in a 2 m sphere around the object.',
  charge: 'A 5000 point charge in a 2 m sphere around the object.',
  force:
    'A 50 N·s push in a 2 m sphere centred 1 m to the -x side of the object, so it pushes along +x.',
  gas: 'Half a unit of marsh gas in a 2 m sphere around the object. Gas acts on the element field, not on objects.',
  light:
    'A 500 unit light in a 2 m sphere around the object. Light acts on the light field, not on objects.',
};

const escape = (text: string): string => text.replaceAll('|', '\\|');

/** The report as Markdown (see the file header; deterministic). */
export function renderMatrix(matrix: Matrix, regenerate = 'pnpm content:matrix'): string {
  const lines = [
    '# Interaction matrix',
    '',
    `<!-- Generated by \`${regenerate}\` from the sim (src/sim/testing/element-matrix-report.ts). Do not edit by hand. -->`,
    '',
    'What each element does to each world property, observed by running the sim. Interactions come from',
    'properties, never from object types, so this table is the whole of what the element rules do.',
    'A pull request that changes an element rule changes this file; review the diff as a design change.',
    '',
    `Regenerate with \`${regenerate}\`; a test fails when this file is stale.`,
    '',
    'The property run that keeps these combinations safe (determinism, termination, conservation, no NaN or Infinity, consistent state, no object-type logic) is `tests/integration/element-matrix-run.test.ts`; `ELEMENT_MATRIX_WORLDS` and `ELEMENT_MATRIX_SEED` set its size and seed, and a failure prints the seed and the shrunk world.',
    '',
    '## How to read it',
    '',
    `Each probe puts one object in a sandbox world, hits it with one element at full strength and runs ${String(PROBE_TICKS)} ticks.`,
    'The object is a flammable conductor (dry, and again soaked) with the property set to each of a few values:',
    'its schema range edges and default, both booleans, every enum value.',
    '',
    '- **becomes**: this property changed in the probe: `false→true` for a flag, `↑` or `↓` for a number, `changed` for a record.',
    '- **changes the reaction of X**: giving this property a different value changed how X reacted (`flammable` changes the reaction of `burning` to heat).',
    '- **no effect**: the element did nothing to this property and the property changed nothing about the reaction.',
    '- A change the object would make anyway (a burning object burns out) is not credited to the element.',
    '- `(impulse)` is a push handed to the physics layer; `(object)` is the object being destroyed.',
    '',
    'Properties that name another entity or a definition (`material`, `support`, `suspended`, `trap`, `trapped`) cannot be given to a sandbox object, so they are not probed.',
    '',
  ];
  for (const [element, cells] of matrix) {
    lines.push(
      `## ${element}`,
      '',
      ELEMENT_NOTES[element],
      '',
      '| Property | Observed |',
      '|---|---|',
    );
    for (const [key, cell] of cells) lines.push(`| \`${key}\` | ${escape(describeCell(cell))} |`);
    lines.push('');
  }
  return lines.join('\n');
}
