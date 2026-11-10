// The condition language in content (mw-e27.5): the JSON predicates over world facts that dialogue,
// quests, puzzles, shops, AI and level variants gate on, validated when content loads and evaluated
// by the sim (src/sim/facts/conditions.ts). `conditionSchema` is the schema any content type embeds
// for a condition field; `src/content/data/condition/<id>.json` holds named, reusable conditions.
// The load check (src/content/condition-checks.ts) then checks every condition against the fact
// registry: each fact it names is declared and each operator suits the fact's type.
//
// The shape of a node is checked by a non-recursive walk first (so every problem gets a precise
// message and path, and a pathologically deep file can't overflow the stack), then by the recursive
// zod schema that gives the TypeScript types and the editor JSON Schema. Syntax and constants mirror
// the sim's (content may import the sim only as types; tests/contracts/conditions.test.ts keeps them
// equal). Language guide: docs/design/conditions.md.

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { FACT_KEY_PATTERN } from './fact.ts';
import { predicateSchema, volumeShapeSchema } from './signal-graph.ts';

/** The deepest a condition may nest (mirrors the sim's CONDITION_MAX_DEPTH). */
export const CONDITION_MAX_DEPTH = 64;

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** `entity:<level>/*.<fact>` or `entity:*\/*.<fact>` (mirrors the sim's COUNT_PATTERN). */
export const COUNT_PATTERN = new RegExp(
  `^entity:(${SEGMENT}|\\*)/\\*\\.(${SEGMENT}(?:\\.${SEGMENT})*)$`,
);

/** `<graph>/<node>` of a `signal` condition (mirrors the sim's SIGNAL_REF). */
export const SIGNAL_REF = new RegExp(`^(${SEGMENT})/(${SEGMENT})$`);

/** The most a `sustained` condition may ask for, seconds (mirrors the sim's SUSTAINED_MAX_SECONDS). */
export const SUSTAINED_MAX_SECONDS = 3600;

/** How the entities of an `entities` condition must pass (mirrors the sim's ENTITY_MATCHES). */
export const ENTITY_MATCHES = ['all', 'any', 'none'] as const;

/** Comparison operators (mirrors the sim's CONDITION_OPERATORS). */
export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

const factValue = z
  .union([z.boolean(), z.int(), z.string().min(1)])
  .describe('A bool, a whole number or a string (enum value or content id).');

const bound = (what: string) => z.int().optional().describe(what);

const factConditionSchema = z
  .strictObject({
    fact: z
      .string()
      .regex(FACT_KEY_PATTERN, 'must be a fact key')
      .describe(
        'Fact key to test. Alone: the (bool) fact is true. With one operator: that comparison holds.',
      ),
    eq: factValue.optional().describe('The fact equals this value.'),
    neq: factValue
      .optional()
      .describe('The fact does not equal this value (unset counts as unequal).'),
    gt: bound('The (int or tick) fact is greater than this.'),
    gte: bound('The (int or tick) fact is at least this.'),
    lt: bound('The (int or tick) fact is less than this.'),
    lte: bound('The (int or tick) fact is at most this.'),
    has: z
      .boolean()
      .optional()
      .describe(
        'true: the fact holds a value (set, or declared with a non-null default); false: none.',
      ),
  })
  .describe('Tests one fact, with at most one operator.');

const countConditionSchema = z
  .strictObject({
    count: z
      .string()
      .regex(COUNT_PATTERN, 'must be a count pattern')
      .describe(
        'Entity facts to count: `entity:<level>/*.<fact>` (one level) or `entity:*/*.<fact>` (every level). Counts those holding true.',
      ),
    eq: bound('The count equals this.'),
    neq: bound('The count does not equal this.'),
    gt: bound('The count is greater than this.'),
    gte: bound('The count is at least this.'),
    lt: bound('The count is less than this.'),
    lte: bound('The count is at most this.'),
  })
  .describe('Counts true entity facts matching a pattern, compared with exactly one operator.');

const entitiesConditionSchema = z
  .strictObject({
    entities: z
      .strictObject({
        tag: contentId
          .optional()
          .describe('Entities carrying this tag (an entity tag, or the tag of a scene spawn).'),
        entity: contentId.optional().describe('The entity of the scene spawn with this id.'),
      })
      .describe(
        'Which entities to test. `{ "tag": … }`, `{ "entity": … }` or both; `{}` is every entity with a placement.',
      ),
    where: z
      .array(predicateSchema)
      .optional()
      .describe('Predicates (property, tag, element) an entity must all pass.'),
    inside: volumeShapeSchema
      .optional()
      .describe('The entity must stand in this box, sphere or capsule, in world coordinates.'),
    match: z
      .enum(ENTITY_MATCHES)
      .optional()
      .describe(
        'all: at least one entity is selected and every one passes; any: one passes; none: none passes.',
      ),
    eq: bound('The number of entities that pass equals this.'),
    neq: bound('The number that pass does not equal this.'),
    gt: bound('The number that pass is greater than this.'),
    gte: bound('At least this many pass.'),
    lt: bound('Fewer than this many pass.'),
    lte: bound('At most this many pass.'),
  })
  .describe(
    'Property predicates over live entities: how many of them pass, and where they are. Exactly one of match or an operator.',
  );

const signalConditionSchema = z
  .strictObject({
    signal: z
      .string()
      .regex(SIGNAL_REF, 'must be "<graph>/<node>"')
      .describe(
        'Signal graph id and node id, e.g. "vault/gate-open". Holds while the output is on.',
      ),
    port: contentId.optional().describe('Output port of the node; default: its first.'),
  })
  .describe('True while a signal graph node output is on (mark the node `observed`).');

/** A fact test (mirrors the sim's FactCondition). */
export type FactCondition = z.output<typeof factConditionSchema>;
/** A count of true entity facts (mirrors the sim's CountCondition). */
export type CountCondition = z.output<typeof countConditionSchema>;
/** Property predicates over live entities (mirrors the sim's EntitiesCondition). */
export type EntitiesCondition = z.output<typeof entitiesConditionSchema>;
/** A signal output (mirrors the sim's SignalCondition). */
export type SignalCondition = z.output<typeof signalConditionSchema>;
/** A condition over world facts and live state. */
export type Condition =
  | FactCondition
  | CountCondition
  | EntitiesCondition
  | SignalCondition
  | { readonly sustained: Condition; readonly seconds: number }
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition };

/** The recursive schema: types and the editor JSON Schema (shape errors come from `walk`). */
const conditionNode: z.ZodType<Condition> = z
  .lazy(() =>
    z.union([
      factConditionSchema,
      countConditionSchema,
      entitiesConditionSchema,
      signalConditionSchema,
      z
        .strictObject({
          sustained: z.lazy(() => conditionNode).describe('The condition that must keep holding.'),
          seconds: z
            .number()
            .positive()
            .max(SUSTAINED_MAX_SECONDS)
            .describe('Seconds of sim time it must hold, without a break.'),
        })
        .describe('True once the condition has held, without a break, for that long.'),
      z
        .strictObject({ all: z.array(conditionNode).min(1).describe('Every condition holds.') })
        .describe('True when every condition in the list holds.'),
      z
        .strictObject({ any: z.array(conditionNode).min(1).describe('At least one holds.') })
        .describe('True when at least one condition in the list holds.'),
      z
        .strictObject({
          not: z.lazy(() => conditionNode).describe('The condition that must not hold.'),
        })
        .describe('True when the condition does not hold.'),
    ]),
  )
  .meta({
    id: 'condition',
    description:
      'A condition over world facts and live state: one of fact, count, entities, signal, sustained, all, any, not (docs/design/conditions.md).',
  });

const sustainedSeconds = z.number().positive().max(SUSTAINED_MAX_SECONDS);

const LEAF_SCHEMAS = {
  fact: factConditionSchema,
  count: countConditionSchema,
  entities: entitiesConditionSchema,
  signal: signalConditionSchema,
} as const;

const KINDS = ['fact', 'count', 'all', 'any', 'not', 'entities', 'signal', 'sustained'] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Checks every node of a condition without recursion, adding one issue per problem with its path:
 * nodes that are not exactly one kind, leaf fields (via the leaf schemas), operator counts and
 * nesting deeper than CONDITION_MAX_DEPTH.
 */
function walk(root: unknown, ctx: z.RefinementCtx): void {
  const stack: { node: unknown; path: (string | number)[]; depth: number }[] = [
    { node: root, path: [], depth: 1 },
  ];
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message, input: root });
  };
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, path, depth } = item;
    if (depth > CONDITION_MAX_DEPTH) {
      issue(
        path,
        `condition nests more than ${String(CONDITION_MAX_DEPTH)} levels deep; split it into smaller conditions`,
      );
      continue;
    }
    const kinds = isRecord(node) ? KINDS.filter((kind) => Object.hasOwn(node, kind)) : [];
    const [kind] = kinds;
    if (!isRecord(node) || kind === undefined || kinds.length > 1) {
      issue(path, `a condition is an object with exactly one of: ${KINDS.join(', ')}`);
      continue;
    }
    if (kind === 'sustained') {
      const seconds = sustainedSeconds.safeParse(node['seconds']);
      for (const problem of seconds.error?.issues ?? [])
        issue([...path, 'seconds'], problem.message);
      const extra = Object.keys(node).filter((key) => key !== kind && key !== 'seconds');
      if (extra.length > 0)
        issue(path, `a sustained condition has no other fields (${extra.join(', ')})`);
      stack.push({ node: node[kind], path: [...path, kind], depth: depth + 1 });
      continue;
    }
    if (kind === 'fact' || kind === 'count' || kind === 'entities' || kind === 'signal') {
      const schema = LEAF_SCHEMAS[kind];
      const result = schema.safeParse(node);
      for (const problem of result.error?.issues ?? []) {
        issue([...path, ...(problem.path as (string | number)[])], problem.message);
      }
      const operators = Object.keys(node).filter((key) =>
        (CONDITION_OPERATORS as readonly string[]).includes(key),
      );
      if (result.success && kind === 'fact' && operators.length + ('has' in node ? 1 : 0) > 1) {
        issue(
          path,
          `a fact condition takes one operator, got ${Object.keys(node)
            .filter((key) => key !== kind)
            .join(', ')}`,
        );
      }
      if (result.success && kind === 'count' && operators.length !== 1) {
        issue(
          path,
          operators.length === 0
            ? 'a count condition needs an operator (eq, gte…)'
            : `a count condition takes one operator, got ${operators.join(', ')}`,
        );
      }
      if (
        result.success &&
        kind === 'entities' &&
        operators.length + ('match' in node ? 1 : 0) !== 1
      ) {
        issue(
          path,
          'an entities condition needs exactly one of match (all, any, none) or an operator (eq, gte…)',
        );
      }
      continue;
    }
    const extra = Object.keys(node).filter((key) => key !== kind);
    if (extra.length > 0)
      issue(path, `a ${kind} condition has no other fields (${extra.join(', ')})`);
    const children = node[kind];
    if (kind === 'not') {
      stack.push({ node: children, path: [...path, 'not'], depth: depth + 1 });
    } else if (!Array.isArray(children) || children.length === 0) {
      issue([...path, kind], 'must be a non-empty list of conditions');
    } else {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i] as unknown, path: [...path, kind, i], depth: depth + 1 });
      }
    }
  }
}

/**
 * A condition field: embed this in any content schema that gates on world state. Declare where a
 * type uses it in CONDITION_USAGES (src/content/condition-checks.ts) so its facts are checked.
 */
export const conditionSchema = z.preprocess((value, ctx) => {
  walk(value, ctx);
  return value;
}, conditionNode);

/** A named, reusable condition: `src/content/data/condition/<id>.json`. */
export const namedConditionSchema = z.strictObject({
  id: contentId.describe('Condition id, e.g. "horn-befriended-and-cellar-open".'),
  name: z.string().min(1).describe('Display name (docs and debug tools).'),
  notes: z
    .string()
    .min(1)
    .describe('What the condition means in the story or level and what gates on it, for review.'),
  when: conditionSchema.describe('The condition itself.'),
});

/** A named condition as written in JSON. */
export type NamedConditionInput = z.input<typeof namedConditionSchema>;
/** A validated named condition. */
export type NamedCondition = z.output<typeof namedConditionSchema>;
