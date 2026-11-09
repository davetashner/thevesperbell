import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { contentJsonSchema } from '../src/content/json-schema.ts';
import { contentId, ref } from '../src/content/schema.ts';
import { loadGameContent } from '../src/content/game-content.ts';
import { materialSchema } from '../src/content/types/material.ts';
import { puzzleSchema } from '../src/content/types/puzzle.ts';
import { WORLD_PROPERTY_KEYS, WORLD_PROPERTY_SPECS } from '../src/sim/properties/spec.ts';
import {
  expectedDocs,
  fieldRows,
  main,
  MATERIALS_DOC,
  renderDoc,
  renderMaterialsDoc,
  renderWorldPropertiesDoc,
  typeOf,
  WORLD_PROPERTIES_DOC,
  type JsonSchemaNode,
} from './content-docs.ts';

const docPath = 'docs/content/creature-schema.md';
const jsonSchema = (schema: z.ZodType): JsonSchemaNode => contentJsonSchema(schema);

describe('content-docs', () => {
  const cwd = process.cwd();
  const argv = process.argv;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'content-docs-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('AC-6: the committed field references are up to date (run pnpm content:docs if this fails)', () => {
    expect(main(['--check'], cwd)).toBe(0);
  });

  it('AC-6: the creature reference lists every field with its type and default', () => {
    const doc = expectedDocs().get(docPath) ?? '';
    for (const row of [
      '| `id` | id | required |',
      '| `stats.health` | integer > 0 | required |',
      '| `senses` | ref → sense or object | required |',
      '| `senses.base` | ref → sense | — |',
      '| `senses.sight.farRange` | number ≥ 0 | — |',
      '| `locomotion` | ref → locomotion or object | required |',
      '| `locomotion.modes.climb.maxGrade` | integer 1–3 | — |',
      '| `attacks` | list of ref → attack | `[]` |',
      '| `faction` | ref → faction | — |',
      '| `personality.greed` | number 0–1 | `0.5` |',
      '| `needs.<key>.threshold` | number 0–100 | required |',
      '| `reactions.knockbackImpulse` | number > 0 | `300` |',
      '| `loot` | id | — |',
      '| `presentation.mesh` | id | `"placeholder-capsule"` |',
    ]) {
      expect(doc).toContain(row);
    }
    const documented = [...doc.matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
    expect(documented).toHaveLength(194);
  });

  it('AC-1 (mw-e15.1): every puzzle field, and every field the example puzzle uses, is documented', () => {
    const rows = fieldRows(jsonSchema(puzzleSchema));
    expect(rows.filter((r) => r.description === '').map((r) => r.field)).toEqual([]);
    const documented = new Set(rows.map((r) => r.field));
    /** Dotted field paths of a JSON value, lists as `[]` (the goal is its own `condition` section). */
    const paths = (value: unknown, prefix: string): string[] => {
      if (Array.isArray(value)) return value.flatMap((item) => paths(item, `${prefix}[]`));
      if (typeof value !== 'object' || value === null || prefix === 'goal') return [];
      return Object.entries(value).flatMap(([key, child]) => {
        const field = prefix === '' ? key : `${prefix}.${key}`;
        return key === '$schema' ? [] : [field, ...paths(child, field)];
      });
    };
    const example = readFileSync('src/content/data/puzzle/testbed-room-lever.json', 'utf8');
    const used = paths(JSON.parse(example), '');
    expect(used.filter((field) => !documented.has(field))).toEqual([]);
    expect(used.length).toBeGreaterThan(30);
  });

  it('writes one doc per content type, creating docs/content, then --check passes', () => {
    expect(main([], dir)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(`wrote ${docPath}`);
    expect(readFileSync(join(dir, docPath), 'utf8')).toBe(expectedDocs().get(docPath));
    expect(main(['--check'], dir)).toBe(0);
  });

  it('--check fails listing missing or stale docs without writing them', () => {
    expect(main(['--check'], dir)).toBe(1);
    main([], dir);
    writeFileSync(join(dir, docPath), 'old\n');
    expect(main(['--check'], dir)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      `::error title=Content docs::${docPath} is stale; run pnpm content:docs.`,
    );
    expect(readFileSync(join(dir, docPath), 'utf8')).toBe('old\n');
  });

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'content-docs-cli.ts', '--check'];
    await import('./content-docs-cli.ts');
    expect(process.exitCode).toBe(1);
  });
});

describe('typeOf', () => {
  it('names refs, unions, enums, constants, bounded numbers, ids, lists and maps', () => {
    const t = (schema: z.ZodType) => typeOf(jsonSchema(schema));
    expect(t(ref('attack'))).toBe('ref → attack');
    expect(t(z.union([z.string(), z.boolean()]))).toBe('string or boolean');
    expect(t(z.enum(['a', 'b']))).toBe('`"a"` \\| `"b"`');
    expect(t(z.literal(2))).toBe('`2`');
    expect(t(z.int())).toBe('integer');
    expect(t(z.number())).toBe('number');
    expect(t(z.number().positive().max(5))).toBe('number > 0 ≤ 5');
    expect(t(z.number().max(5))).toBe('number ≤ 5');
    expect(t(z.number().gt(0).lt(90))).toBe('number > 0 < 90');
    expect(t(z.int().min(1).max(3))).toBe('integer 1–3');
    expect(t(contentId)).toBe('id');
    expect(t(z.string().regex(/x/))).toBe('string');
    expect(t(z.array(z.string()).min(2))).toBe('list of string (at least 2)');
    expect(t(z.record(z.string(), z.number()))).toBe('map of string → number');
    expect(t(z.object({}))).toBe('object');
    expect(t(z.any())).toBe('any');
  });

  it('names a discriminated union (oneOf) like a union, listing each option type once', () => {
    const t = (schema: z.ZodType) => typeOf(jsonSchema(schema));
    const tagged = z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('a') }),
      z.strictObject({ kind: z.literal('b') }),
    ]);
    expect(t(tagged)).toBe('object');
    expect(t(z.union([z.string(), z.string().min(2), z.boolean()]))).toBe('string or boolean');
  });
});

describe('fieldRows / renderDoc', () => {
  const schema = jsonSchema(
    z.strictObject({
      id: contentId,
      plain: z.string().optional(),
      list: z.array(z.strictObject({ a: z.number().describe('multi\nline') })),
      either: z.union([ref('x'), z.strictObject({ b: z.boolean() })]),
    }),
  );

  it('skips $schema, recurses into lists, maps and union options, and marks required fields', () => {
    expect(fieldRows(schema).map((r) => [r.field, r.default])).toEqual([
      ['id', 'required'],
      ['plain', '—'],
      ['list', 'required'],
      ['list[].a', 'required'],
      ['either', 'required'],
      ['either.b', 'required'],
    ]);
  });

  it('recurses into discriminated union options, rendering shared fields once', () => {
    const tagged = jsonSchema(
      z.strictObject({
        node: z.discriminatedUnion('kind', [
          z.strictObject({ id: contentId, kind: z.literal('a'), x: z.number() }),
          z.strictObject({ id: contentId, kind: z.literal('b') }),
        ]),
      }),
    );
    expect(fieldRows(tagged).map((r) => r.field)).toEqual([
      'node',
      'node.id',
      'node.kind',
      'node.x',
      'node.id',
      'node.kind',
    ]);
    const lines = renderDoc('thing', tagged)
      .split('\n')
      .filter((l) => l.startsWith('| `node.id`'));
    expect(lines).toEqual(['| `node.id` | id | required |  |']);
  });

  it('documents a top-level discriminated union: shared fields once, then each option (mw-e17.2)', () => {
    const union = jsonSchema(
      z.discriminatedUnion('kind', [
        z.strictObject({ id: contentId, kind: z.literal('a'), x: z.number() }).describe('An a.'),
        z.strictObject({ id: contentId, kind: z.literal('b') }),
      ]),
    );
    expect(renderDoc('thing', union).split('\n').slice(7)).toEqual([
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `id` | id | required |  |',
      '',
      'An entry is exactly one of the objects below: the fields above, plus those of its option.',
      '',
      '## 1. An a.',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `kind` | `"a"` | required |  |',
      '| `x` | number | required |  |',
      '',
      '## 2. Option',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `kind` | `"b"` | required |  |',
      '',
    ]);
  });

  it('documents the nested objects a top-level union shares in place, not as $defs sections', () => {
    const meta = z.strictObject({ a: z.number().describe('An a.') }).describe('Shared.');
    const union = jsonSchema(
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('a'), meta }),
        z.strictObject({ kind: z.literal('b'), meta }),
      ]),
    );
    const doc = renderDoc('thing', union);
    expect(doc).toContain(
      '| `meta` | object | required | Shared. |\n| `meta.a` | number | required | An a. |',
    );
    expect(doc).not.toContain('## `meta`');
    const lines = renderDoc('thing', {
      ...union,
      $defs: { ...union.$defs, other: { type: 'string' } },
    });
    expect(lines).toContain('## `other`');
  });

  it('documents a top-level union option without fields, and a $ref it cannot inline by name', () => {
    const doc = renderDoc('thing', {
      oneOf: [{ description: 'Bare.' }, { properties: { r: { $ref: '#/$defs/missing' } } }],
    });
    expect(doc).toContain('## 1. Bare.');
    expect(doc).toContain('| `r` | `missing` | — |  |');
  });

  it('documents an empty top-level union without shared fields', () => {
    expect(renderDoc('thing', { oneOf: [] })).toContain('| --- | --- | --- | --- |\n\nAn entry');
  });

  it('has no rows for a schema without properties', () => {
    expect(fieldRows({ type: 'string' })).toEqual([]);
  });

  it('renders a Markdown table with one line per field', () => {
    const doc = renderDoc('thing', schema);
    expect(doc).toMatch(/^# `thing` content schema\n/);
    expect(doc).toContain('| `list[].a` | number | required | multi line |');
    expect(doc.endsWith('|\n')).toBe(true);
  });

  it('names $ref fields by their definition and documents each $defs entry by option (mw-e27.5)', () => {
    const recursive: JsonSchemaNode = {
      type: 'object',
      properties: { when: { $ref: '#/$defs/node', description: 'Root.' } },
      required: ['when'],
      $defs: {
        node: {
          description: 'A node.',
          anyOf: [
            {
              type: 'object',
              description: 'A leaf.',
              properties: { leaf: { type: 'string' } },
            },
            {
              type: 'object',
              properties: { kids: { type: 'array', items: { $ref: '#/$defs/node' } } },
            },
          ],
        },
        tagged: {
          oneOf: [{ type: 'object', properties: { tag: { const: 'x' } } }],
        },
        plain: { type: 'object', properties: { n: { type: 'integer' } } },
      },
    };
    expect(renderDoc('thing', recursive).split('\n').slice(9)).toEqual([
      '| `when` | `node` | required | Root. |',
      '',
      '## `node`',
      '',
      'A node.',
      '',
      'A `node` is exactly one of these objects:',
      '',
      '### 1. A leaf.',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `leaf` | string | — |  |',
      '',
      '### 2. node',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `kids` | list of `node` | — |  |',
      '',
      '## `tagged`',
      '',
      'A `tagged` is exactly one of these objects:',
      '',
      '### 1. tagged',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `tag` | `"x"` | — |  |',
      '',
      '## `plain`',
      '',
      'A `plain` is exactly one of these objects:',
      '',
      '### 1. plain',
      '',
      '| Field | Type | Default | Description |',
      '| --- | --- | --- | --- |',
      '| `n` | integer | — |  |',
      '',
    ]);
  });
});

describe('renderMaterialsDoc', () => {
  it('AC-4: docs/design/materials.md lists every material and every property value', () => {
    const doc = expectedDocs().get(MATERIALS_DOC) ?? '';
    const materials = loadGameContent().all('material');
    expect(materials.length).toBeGreaterThan(0);
    const lines = doc.split('\n');
    const header = lines.find((line) => line.startsWith('| Material |')) ?? '';
    const columns = header.split(' | ').map((c) => c.replace(/^\| |`| \|$/g, ''));
    const missing = materials.flatMap((m) => {
      const row = lines.find((line) => line.startsWith(`| \`${m.id}\` |`));
      if (row === undefined) return [`${m.id}: no row`];
      const cells = row.replace(/ \|$/, '').split(' | ');
      return [
        ...Object.entries(m.properties)
          .filter(
            ([key, value]) =>
              cells[columns.indexOf(key)] !==
              (typeof value === 'string' ? value : JSON.stringify(value)),
          )
          .map(([key]) => `${m.id}.${key}`),
        ...(doc.includes(m.notes) ? [] : [`${m.id}: notes`]),
      ];
    });
    expect(missing).toEqual([]);
  });

  it('shows record values as JSON and unset ones as —', () => {
    const material = (id: string, properties: object) =>
      materialSchema.parse({
        id,
        name: id,
        notes: `${id} notes`,
        footstepLoudness: -1,
        impactSound: 'sfx-impact-glass',
        properties: { surfaceHardness: 'hard', softAnchor: false, ...properties },
      });
    const doc = renderMaterialsDoc([
      material('lamp-glass', { lightEmitter: { intensity: 10, radius: 2 } }),
      material('plain', {}),
    ]);
    expect(doc).toContain(
      '| Material | Footsteps (dB) | Impact sound | Burns to | `lightEmitter` | `softAnchor` | `surfaceHardness` |',
    );
    expect(doc).toContain(
      '| `lamp-glass` | -1 | `sfx-impact-glass` | — | `{"intensity":10,"radius":2}` | false | hard |',
    );
    expect(doc).toContain('| `plain` | -1 | `sfx-impact-glass` | — | — | false | hard |');
    expect(doc).toContain('- **plain** (`plain`): plain notes');
  });

  it('shows what flammable materials burn to (mw-e03.5)', () => {
    const doc = expectedDocs().get(MATERIALS_DOC) ?? '';
    expect(doc).toContain('| `wood` | 2 | `sfx-impact-wood` | `charred` |');
    expect(doc).toContain('| `straw` | -4 | `sfx-impact-straw` | `destroyed` |');
    expect(doc).toContain('| `stone` | 0 | `sfx-impact-stone` | — |');
  });
});

describe('renderWorldPropertiesDoc (mw-e03.31)', () => {
  /** Every property the bead asks for, besides the v1 set. */
  const BEAD_PROPERTIES = [
    'flammable',
    'flammableGas',
    'extinguishable',
    'reflective',
    'waterSurface',
    'unstable',
    'suspended',
    'breakable',
    'toughness',
    'fragile',
    'bashable',
    'cuttable',
    'shootable',
    'softAnchor',
    'surfaceHardness',
    'chargeActivated',
    'lightActivated',
    'hidden',
    'trapped',
    'container',
    'remains',
    'noiseMultiplier',
  ];

  it('AC-1: every bead property exists with a type, values, default and doc, and the table lists each one', () => {
    const doc = expectedDocs().get(WORLD_PROPERTIES_DOC) ?? '';
    expect(BEAD_PROPERTIES.filter((key) => !WORLD_PROPERTY_KEYS.includes(key as never))).toEqual(
      [],
    );
    const rows = WORLD_PROPERTY_KEYS.map(
      (key) =>
        doc.split('\n').find((line) => line.startsWith(`| \`${key}\` |`)) ?? `${key}: no row`,
    );
    const incomplete = rows.filter((row) => {
      const cells = row.split(' | ');
      return cells.length !== 5 || cells.some((cell) => cell.trim() === '');
    });
    expect(incomplete).toEqual([]);
    expect(
      rows.every((row, i) =>
        row.includes(WORLD_PROPERTY_SPECS[WORLD_PROPERTY_KEYS[i] ?? 'hp'].doc),
      ),
    ).toBe(true);
    expect(doc).toContain('| `surfaceHardness` | one of | `soft`, `medium`, `hard` | medium | ');
    expect(doc).toContain('| `toughness` | record (any fields) | `blunt` 0–1,000,000,000 J;');
    expect(doc).toContain(
      '| `lightEmitter` | record | `intensity` 0–100,000 light; `radius` 0–100 m |',
    );
    expect(doc).toContain('| `support` | number | whole 0–9,007,199,254,740,991 entity | 0 |');
    expect(doc).toContain(
      '| `climbable` | one of | `none`, `ladder`, `rope`, `ivy`, `rough`, `sheer` | none | ',
    );
    expect(doc).toContain('| `wetness` | number | 0–1 | 0 |');
    expect(doc).toContain('| `material` | id | kebab-case id | generic |');
    expect(doc).toContain('| `hidden` | flag | true, false | false |');
    expect(doc).toContain('| `wet` | `wetness` |');
    expect(doc).toContain('| buoyant, floats |');
    expect(renderWorldPropertiesDoc()).toBe(doc);
  });
});
