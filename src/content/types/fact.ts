// The world-fact registry (mw-e27.2): every world fact the game may read or write, declared once in
// `src/content/data/fact/<group>.json`. Unregistered fact strings are typos waiting to break a quest,
// so each fact has a key, a type, a default, a description, the system that writes it and a
// persistence policy; the sim declares them all on the world's fact store (src/sim/facts/registry.ts)
// and, in dev and test builds, throws on a write of anything undeclared. Entity-scoped facts are
// declared once as templates: `entity:*.looted` covers `entity:<level>/<entity>.looted` for every
// entity. A file groups related facts (a quest, a level's mechanisms, the endings); keys are unique
// across the whole registry, and content that names a fact (signal graphs today; dialogue, quests
// and conditions later) is checked against it at load (src/content/fact-checks.ts).
//
// Key syntax mirrors the sim's FACT_KEY_PATTERN (content may import the sim only as types; the
// contract test tests/contracts/facts.test.ts keeps the two equal).

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Fact value types (mirrors the sim's FACT_TYPES). */
export const FACT_VALUE_TYPES = ['bool', 'int', 'enum', 'id', 'tick'] as const;

/**
 * Persistence policies (mirrors the sim's FACT_PERSISTENCE_KINDS; mw-e27.7): `permanent` keeps a
 * value in saves forever; `reset-on-rest` returns it to its default when the player rests;
 * `reset-after` returns it `resetAfter` ticks after it was last written; `transient` is never saved
 * (a loaded game starts at the default); `decays-to` saves it but loads a value in `decaysTo.from`
 * as `decaysTo.to`.
 */
export const FACT_PERSISTENCE = [
  'permanent',
  'reset-on-rest',
  'reset-after',
  'transient',
  'decays-to',
] as const;

const scalar = z.union([z.boolean(), z.int(), contentId]);

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** A fact key: kebab-case segments joined by `.`, optionally `entity:<level>/<entity>.`-prefixed. */
export const FACT_KEY_PATTERN = new RegExp(
  `^(?:entity:${SEGMENT}/${SEGMENT}\\.)?${SEGMENT}(?:\\.${SEGMENT})*$`,
);

/** A fact template: `entity:*.<fact>` declares `<fact>` for every entity of every level. */
export const FACT_TEMPLATE_PATTERN = new RegExp(`^entity:\\*\\.${SEGMENT}(?:\\.${SEGMENT})*$`);

const ENTITY_FACT = new RegExp(`^entity:${SEGMENT}/${SEGMENT}\\.(.+)$`);

/**
 * The template governing an entity-scoped key (`entity:mine/chest-3.looted` → `entity:*.looted`),
 * or undefined for any other string (mirrors the sim's `factTemplateOf`).
 */
export function factTemplateOf(key: string): string | undefined {
  const name = ENTITY_FACT.exec(key)?.[1];
  return name === undefined ? undefined : `entity:*.${name}`;
}

const common = {
  key: z
    .string()
    .refine(
      (key) => FACT_KEY_PATTERN.test(key) || FACT_TEMPLATE_PATTERN.test(key),
      'must be a fact key ("horn.befriended", "entity:<level>/<entity>.opened") or an entity template ("entity:*.looted")',
    )
    .describe('Fact key, or an `entity:*.<fact>` template for a fact every entity can hold.'),
  description: z
    .string()
    .min(1)
    .describe(
      'What the fact records, when it changes and what reads it (designers, owner review).',
    ),
  owner: contentId.describe('System that writes the fact, e.g. "signals", "quest", "interaction".'),
  renamedFrom: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      'Keys this fact was saved under before (any older spelling; for a template, older templates). A save holding one loads into this key with its value (mw-e27.4); never remove an entry once a build shipped it.',
    ),
  persistence: z
    .enum(FACT_PERSISTENCE)
    .default('permanent')
    .describe(
      'How long a written value lasts: `permanent` (default) keeps it in saves forever; `reset-on-rest` returns it to its default when the player rests; `reset-after` (with `resetAfter`) returns it that many sim ticks after it was last written, loaded or not; `transient` is never saved; `decays-to` (with `decaysTo`) loads one of its values as another (a burning thing as burnt).',
    ),
  resetAfter: z
    .int()
    .positive()
    .optional()
    .describe(
      'Sim ticks after the last write at which the fact returns to its default; only with persistence `reset-after`, where it is required.',
    ),
  decaysTo: z
    .strictObject({
      from: z.array(scalar).min(1).describe('Saved values that decay (e.g. ["burning"]).'),
      to: scalar.describe('The value a loaded game holds instead (e.g. "burnt").'),
    })
    .optional()
    .describe('Only with persistence `decays-to`, where it is required.'),
};

/** One declared fact. The `default` is required: `null` (id and tick only) means "unset". */
const factDefSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      ...common,
      type: z.literal('bool').describe('A true/false flag.'),
      default: z.boolean().describe('Value read before the fact is first written.'),
    }),
    z.strictObject({
      ...common,
      type: z.literal('int').describe('A whole number (a count, a stage).'),
      default: z.int().describe('Value read before the fact is first written.'),
    }),
    z.strictObject({
      ...common,
      type: z.literal('enum').describe('One of a fixed list of `values`.'),
      values: z.array(contentId).min(1).describe('The allowed values, unique.'),
      default: contentId.describe('Value read before the fact is first written; one of `values`.'),
    }),
    z.strictObject({
      ...common,
      type: z.literal('id').describe('A content id (who rang the bell, which item).'),
      default: contentId.nullable().describe('Content id read before the first write, or null.'),
    }),
    z.strictObject({
      ...common,
      type: z.literal('tick').describe('A sim tick (when something happened), never wall time.'),
      default: z.int().min(0).nullable().describe('Sim tick read before the first write, or null.'),
    }),
  ])
  .describe('One fact: bool, int, enum (with `values`), id (a content id) or tick (a sim tick).');

type Scalar = boolean | number | string;

function fits(fact: FactDef, value: Scalar): boolean {
  switch (fact.type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'int':
      return typeof value === 'number';
    case 'tick':
      return typeof value === 'number' && value >= 0;
    case 'id':
      return typeof value === 'string';
    case 'enum':
      return typeof value === 'string' && fact.values.includes(value);
  }
}

/** What is wrong with a fact's persistence policy: path within the fact and message. */
function policyIssues(fact: FactDef): [(string | number)[], string][] {
  const found: [(string | number)[], string][] = [];
  const { persistence, resetAfter, decaysTo } = fact;
  if (resetAfter !== undefined && persistence !== 'reset-after') {
    found.push([
      ['resetAfter'],
      `resetAfter needs persistence "reset-after", not "${persistence}"`,
    ]);
  }
  if (decaysTo !== undefined && persistence !== 'decays-to') {
    found.push([['decaysTo'], `decaysTo needs persistence "decays-to", not "${persistence}"`]);
  }
  if (persistence === 'reset-after' && resetAfter === undefined) {
    found.push([['resetAfter'], 'reset-after needs resetAfter (sim ticks)']);
  }
  if (persistence === 'decays-to') {
    if (decaysTo === undefined) found.push([['decaysTo'], 'decays-to needs decaysTo']);
    else {
      [
        ...decaysTo.from.map((value, i) => ['from', i, value] as const),
        ['to', -1, decaysTo.to] as const,
      ]
        .filter(([, , value]) => !fits(fact, value))
        .forEach(([part, i]) => {
          found.push([
            i < 0 ? ['decaysTo', part] : ['decaysTo', part, i],
            `is not a value of type ${fact.type}`,
          ]);
        });
    }
  }
  if ((persistence === 'reset-on-rest' || persistence === 'reset-after') && fact.default === null) {
    found.push([['default'], `${persistence} needs a default to return to`]);
  }
  return found;
}

/** One file of the fact registry: `src/content/data/fact/<id>.json`. */
export const factSchema = z
  .strictObject({
    id: contentId.describe('Group id, e.g. "endings". Facts are keyed by `key`, not by this.'),
    name: z.string().min(1).describe('Display name (docs and debug tools).'),
    notes: z
      .string()
      .min(1)
      .describe('What these facts cover and where they come from (canon section), for review.'),
    facts: z.array(factDefSchema).min(1).describe('The facts this group declares.'),
  })
  .superRefine((group, ctx) => {
    const seen = new Set<string>();
    group.facts.forEach((fact, index) => {
      const issue = (path: (string | number)[], message: string) => {
        ctx.addIssue({ code: 'custom', path: ['facts', index, ...path], message });
      };
      if (seen.has(fact.key)) issue(['key'], `"${fact.key}" is declared twice in this file`);
      seen.add(fact.key);
      for (const [path, message] of policyIssues(fact)) issue(path, message);
      const template = FACT_TEMPLATE_PATTERN.test(fact.key);
      fact.renamedFrom?.forEach((old, i) => {
        if (old === fact.key) issue(['renamedFrom', i], 'a fact cannot be renamed from itself');
        else if (FACT_TEMPLATE_PATTERN.test(old) !== template) {
          issue(
            ['renamedFrom', i],
            template ? `"${old}" must be a template, as the key is` : `"${old}" is a template`,
          );
        }
      });
      if (fact.type !== 'enum') return;
      fact.values.forEach((value, i) => {
        if (fact.values.indexOf(value) !== i) issue(['values', i], `duplicate value "${value}"`);
      });
      if (!fact.values.includes(fact.default)) {
        issue(['default'], `"${fact.default}" is not one of the values`);
      }
    });
  });

/** A fact group as written in JSON (optional fields may be omitted). */
export type FactGroupInput = z.input<typeof factSchema>;
/** A validated fact group. */
export type FactGroup = z.output<typeof factSchema>;
/** One validated fact declaration. */
export type FactDef = z.output<typeof factDefSchema>;
