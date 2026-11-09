import { describe, expect, it, vi } from 'vitest';
import { WORLD_PROPERTY_KEYS } from '../properties/spec';
import { MATRIX_ELEMENTS } from './element-matrix';
import {
  buildMatrix,
  caused,
  cellFor,
  describeCell,
  labelOf,
  PROBE_BASES,
  netOutcome,
  probe,
  probeStimulus,
  renderMatrix,
  UNPROBED_KEYS,
  variantsOf,
  type Matrix,
} from './element-matrix-report';

// Property runs are CPU heavy: under a loaded coverage run they need more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

// One matrix for the whole file: building it is the expensive part.
const matrix: Matrix = buildMatrix();
const cell = (element: (typeof MATRIX_ELEMENTS)[number], key: string) => {
  const found = matrix.get(element)?.get(key);
  if (found === undefined) throw new Error(`no cell ${element} × ${key}`);
  return found;
};

describe('the matrix', () => {
  it('AC-3: every element × property in the schema is populated, with transitions or "no effect"', () => {
    expect([...matrix.keys()]).toEqual([...MATRIX_ELEMENTS]);
    for (const element of MATRIX_ELEMENTS) {
      const cells = matrix.get(element);
      expect([...(cells?.keys() ?? [])]).toEqual([...WORLD_PROPERTY_KEYS]);
      for (const key of WORLD_PROPERTY_KEYS) {
        expect(describeCell(cell(element, key)), `${element} × ${key}`).toMatch(
          /^(no effect|becomes|changes the reaction)/,
        );
      }
    }
  });

  it('records the transitions the element rules make', () => {
    expect(cell('heat', 'burning').own).toContain('false→true');
    expect(cell('heat', 'flammable').gates).toContain('burning');
    expect(cell('heat', 'temperature').own).toContain('↑');
    expect(cell('cold', 'frozen').own).toContain('false→true');
    expect(cell('cold', 'temperature').own).toContain('↓');
    expect(cell('water', 'wetness').own).toContain('↑');
    expect(cell('water', 'absorbency').gates).toContain('wetness');
    expect(cell('charge', 'charge').own).toContain('↑');
    expect(cell('force', 'weight').gates).toContain('(impulse)');
    expect(cell('force', 'pushable').gates).toContain('(impulse)');
  });

  it('says "no effect" for what an element does not touch, and why a property was not probed', () => {
    expect(describeCell(cell('gas', 'burning'))).toBe('no effect');
    expect(describeCell(cell('light', 'burning'))).toBe('no effect');
    expect(describeCell(cell('light', 'hp'))).toBe('no effect');
    for (const key of UNPROBED_KEYS) {
      expect(cell('heat', key).unprobed).toBe(true);
      expect(describeCell(cell('heat', key))).toMatch(/^no effect \(not probed/);
    }
  });

  it('renders deterministic Markdown with a section per element and a row per property', () => {
    const text = renderMatrix(matrix);
    expect(renderMatrix(buildMatrix())).toBe(text);
    for (const element of MATRIX_ELEMENTS) expect(text).toContain(`\n## ${element}\n`);
    for (const key of WORLD_PROPERTY_KEYS) expect(text).toContain(`| \`${key}\` |`);
    expect(text).toContain('Regenerate with `pnpm content:matrix`');
    expect(renderMatrix(matrix, 'other command')).toContain('Regenerate with `other command`');
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('probes', () => {
  it('reads what changed on the object, and that it was destroyed', () => {
    const dry = probe('heat', PROBE_BASES[0] ?? {});
    expect(dry.get('burning')).toEqual(new Set(['false→true', 'true→false']));
    expect(dry.get('(object)')).toEqual(new Set(['destroyed']));
    const pushed = probe('force', { weight: 10, pushable: true });
    expect(pushed.get('(impulse)')).toEqual(new Set(['pushed']));
    const heavy = probe('force', { weight: 10, pushable: true, hp: 5 });
    expect(heavy.get('(impulse)')).toEqual(new Set(['pushed']));
  });

  it('reads only what the element caused, not what the object does by itself', () => {
    const burning = { ...PROBE_BASES[0], burning: true };
    expect(probe(undefined, burning).get('burning')).toEqual(new Set(['true→false']));
    expect(caused('light', burning).has('burning')).toBe(false);
    expect(
      netOutcome(new Map([['a', new Set(['x', 'y'])]]), new Map([['a', new Set(['x'])]])),
    ).toEqual(new Map([['a', new Set(['y'])]]));
    expect(netOutcome(new Map([['a', new Set(['x'])]]), new Map())).toEqual(
      new Map([['a', new Set(['x'])]]),
    );
    expect(
      netOutcome(new Map([['a', new Set(['x'])]]), new Map([['a', new Set(['x'])]])).size,
    ).toBe(0);
  });

  it('labels changes', () => {
    const change = (old: unknown, next: unknown) =>
      labelOf({ entity: 1, key: 'x', old, new: next, source: null } as never);
    expect(change(1, 2)).toBe('↑');
    expect(change(2, 1)).toBe('↓');
    expect(change(false, true)).toBe('false→true');
    expect(change('a', 'b')).toBe('"a"→"b"');
    expect(change({ a: 1 }, { a: 2 })).toBe('changed');
  });

  it('labels a record that changed', () => {
    // Freezing rewrites friction (a number); a structured change is labelled "changed".
    expect(cell('cold', 'friction').own).toEqual(['↓']);
  });

  it('has a stimulus for every element and values for every kind of property', () => {
    for (const element of MATRIX_ELEMENTS) {
      expect(probeStimulus(element).element).toBe(element);
    }
    expect(variantsOf('burning')).toEqual([true, false]);
    expect(variantsOf('climbable')).toContain('sheer');
    expect(variantsOf('owner')).toEqual(['unowned', 'alpha']);
    expect(variantsOf('weight')).toEqual([0, 1, 1_000_000]);
    expect(variantsOf('lightEmitter')).toEqual([
      { intensity: 0, radius: 0 },
      { intensity: 100_000, radius: 100 },
    ]);
    expect(() => variantsOf('nope')).toThrow(/unknown world property/);
  });

  it('cellFor reports a property it cannot probe', () => {
    expect(cellFor('heat', 'support', [])).toEqual({ own: [], gates: [], unprobed: true });
  });
});
