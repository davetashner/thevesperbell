import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  CONDITION_MAX_DEPTH,
  conditionSchema,
  namedConditionSchema,
  type Condition,
  type NamedConditionInput,
} from './condition.ts';

const problems = (value: unknown) =>
  (conditionSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** A leaf wrapped in `depth - 1` nots, so `depth` levels deep. */
const nested = (depth: number): unknown => {
  let condition: unknown = { fact: 'a' };
  for (let i = 1; i < depth; i++) condition = { not: condition };
  return condition;
};

describe('condition schema', () => {
  it('accepts every node kind and round-trips', () => {
    const condition = {
      all: [
        { fact: 'minotaur.befriended' },
        { not: { fact: 'cellar.sealed' } },
        {
          any: [
            { fact: 'horn.fate', eq: 'alive' },
            { fact: 'horn.rescues', gte: 3 },
          ],
        },
        { fact: 'bell.rung-by', has: true },
        { fact: 'entity:mine/vault.opened', neq: false },
        { count: 'entity:mine/*.looted', gte: 3 },
        { count: 'entity:*/*.opened', lt: 10 },
      ],
    } satisfies Condition;
    expect(problems(condition)).toEqual([]);
    const named = {
      id: 'test',
      name: 'Test',
      notes: 'Test.',
      when: condition,
    } satisfies NamedConditionInput;
    const parsed = namedConditionSchema.parse(named);
    expect(parsed.when).toEqual(condition);
    expect(namedConditionSchema.parse(JSON.parse(serializeContent(parsed)))).toEqual(parsed);
  });

  it('reports every malformed node with its path', () => {
    expect(
      problems({
        all: [
          7,
          { fact: 'a', any: [] },
          { fact: 'Bad Key', gte: 1.5 },
          { fact: 'a', gte: 1, lte: 2 },
          { fact: 'a', above: 1 },
          { count: 'entity:mine/chest.looted', gte: 1 },
          { count: 'entity:mine/*.looted' },
          { any: [] },
          { not: { fact: 'a' }, why: 'x' },
          { any: 'a' },
        ],
      }),
    ).toEqual(
      [
        'all.0: a condition is an object with exactly one of: fact, count, all, any, not, entities, signal, sustained',
        'all.1: a condition is an object with exactly one of: fact, count, all, any, not, entities, signal, sustained',
        'all.2.fact: must be a fact key',
        'all.2.gte: Invalid input: expected int, received number',
        'all.3: a fact condition takes one operator, got gte, lte',
        'all.4: Unrecognized key: "above"',
        'all.5.count: must be a count pattern',
        'all.6: a count condition needs an operator (eq, gte…)',
        'all.7.any: must be a non-empty list of conditions',
        'all.8: a not condition has no other fields (why)',
        'all.9.any: must be a non-empty list of conditions',
      ].filter((line) => !line.endsWith('ok')),
    );
  });

  it(`AC-4: nesting ${String(CONDITION_MAX_DEPTH)} deep is accepted; deeper is rejected clearly`, () => {
    expect(problems(nested(CONDITION_MAX_DEPTH))).toEqual([]);
    const path = Array.from({ length: CONDITION_MAX_DEPTH }, () => 'not').join('.');
    expect(problems(nested(CONDITION_MAX_DEPTH + 1))).toEqual([
      `${path}: condition nests more than 64 levels deep; split it into smaller conditions`,
    ]);
    // The shape walk never recurses, so an absurd depth fails cleanly instead of overflowing.
    expect(problems(nested(100_000))).toHaveLength(1);
  });
});

describe('live condition leaves (mw-e15.2)', () => {
  const lit = {
    entities: { tag: 'brazier' },
    where: [{ test: 'element', element: 'fire' }],
    match: 'all',
  };

  it('accepts entities, signal and sustained and round-trips them', () => {
    const condition = {
      all: [
        lit,
        {
          entities: {},
          where: [{ test: 'tag', tag: 'player' }],
          inside: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 2 },
          gte: 1,
        },
        { entities: { entity: 'room-lever', tag: 'pull' }, neq: 0 },
        { signal: 'vault/gate-open' },
        { signal: 'vault/plate', port: 'active' },
        {
          sustained: {
            entities: { tag: 'plate' },
            where: [{ test: 'property', property: 'weight', op: 'gte', value: 40 }],
            match: 'any',
          },
          seconds: 3,
        },
      ],
    };
    expect(problems(condition)).toEqual([]);
    expect(conditionSchema.parse(JSON.parse(JSON.stringify(condition)))).toEqual(condition);
  });

  it('reports where each live leaf is wrong, with a path', () => {
    expect(
      problems({
        all: [
          { entities: { tag: 'brazier' } },
          { entities: { tag: 'brazier' }, match: 'all', gte: 1 },
          { entities: { tag: 'brazier' }, match: 'most' },
          { entities: { tag: 'Brazier' }, match: 'all' },
          {
            entities: {},
            match: 'all',
            where: [{ test: 'property', property: 'nope', op: 'eq', value: 1 }],
          },
          { entities: {}, match: 'all', inside: { kind: 'cone' } },
          { signal: 'vault' },
          { count: 'entity:mine/*.looted', gte: 1, lte: 2 },
          { signal: 'vault/gate', gte: 1 },
          { sustained: { fact: 'a' }, seconds: 0 },
          { sustained: { fact: 'a' }, seconds: 5000 },
          { sustained: { fact: 'a' }, seconds: 1, why: 'x' },
          { sustained: { fact: 'Bad Key' }, seconds: 1 },
        ],
      }).map((line) => (line.startsWith('all.4.') ? line.split(':')[0] : line)),
    ).toEqual([
      'all.0: an entities condition needs exactly one of match (all, any, none) or an operator (eq, gte…)',
      'all.1: an entities condition needs exactly one of match (all, any, none) or an operator (eq, gte…)',
      'all.2.match: Invalid option: expected one of "all"|"any"|"none"',
      'all.3.entities.tag: must be lowercase kebab-case, e.g. "forgotten-miner"',
      'all.4.where.0.property',
      "all.5.inside.kind: Invalid discriminator value. Expected 'box' | 'sphere' | 'capsule'",
      'all.6.signal: must be "<graph>/<node>"',
      'all.7: a count condition takes one operator, got gte, lte',
      'all.8: Unrecognized key: "gte"',
      'all.9.seconds: Too small: expected number to be >0',
      'all.10.seconds: Too big: expected number to be <=3600',
      'all.11: a sustained condition has no other fields (why)',
      'all.12.sustained.fact: must be a fact key',
    ]);
  });
});

describe('the shipped named conditions', () => {
  describeContent('condition', 'parses and round-trips', (entry) => {
    expect(namedConditionSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});
