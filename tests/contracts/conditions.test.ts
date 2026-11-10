// Contract between layers (mw-e27.5): conditions are written and validated as content
// (src/content/types/condition.ts, checked against the fact registry by
// src/content/condition-checks.ts) and compiled and evaluated by the sim (src/sim/facts/conditions.ts).
// Content may import the sim only as types, so this check lives outside src/: both sides share the
// depth limit, the count pattern and the operators, every condition content accepts compiles in the
// sim, and every shipped named condition reads only declared facts.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import { describeContent } from '@content/testing';
import {
  compileCondition,
  CONDITION_MAX_DEPTH,
  CONDITION_OPERATORS,
  COUNT_PATTERN,
  ConditionError,
  declareFacts,
  ENTITY_MATCHES,
  formatExplanation,
  SIGNAL_REF,
  SUSTAINED_MAX_SECONDS,
  World,
  type Condition,
} from '@sim/index';

const game = content.loadGameContent();

/** A leaf wrapped in `depth - 1` nots. */
const nested = (depth: number): content.Condition => {
  let condition: content.Condition = { fact: 'a' };
  for (let i = 1; i < depth; i++) condition = { not: condition };
  return condition;
};

describe('condition contract', () => {
  it('content and sim share the depth limit, the count pattern and the operators', () => {
    expect(content.CONDITION_MAX_DEPTH).toBe(CONDITION_MAX_DEPTH);
    expect(content.COUNT_PATTERN.source).toBe(COUNT_PATTERN.source);
    expect(content.CONDITION_OPERATORS).toEqual(CONDITION_OPERATORS);
  });

  it('AC-4: content and sim agree on the depth limit', () => {
    const deepest: Condition = nested(CONDITION_MAX_DEPTH);
    expect(content.conditionSchema.safeParse(deepest).success).toBe(true);
    expect(compileCondition(deepest).depth).toBe(CONDITION_MAX_DEPTH);
    const tooDeep: Condition = nested(CONDITION_MAX_DEPTH + 1);
    expect(content.conditionSchema.safeParse(tooDeep).success).toBe(false);
    expect(() => compileCondition(tooDeep)).toThrow(ConditionError);
  });

  it('a condition content accepts compiles in the sim', () => {
    const parsed: Condition = content.conditionSchema.parse({
      all: [
        { fact: 'horn.befriended' },
        { not: { fact: 'horn.fate', eq: 'dead' } },
        {
          any: [
            { fact: 'horn.rescues', gte: 3 },
            { fact: 'horn.rescues', has: false },
          ],
        },
        { count: 'entity:*/*.looted', lte: 2 },
      ],
    });
    expect(compileCondition(parsed).facts).toEqual([
      'horn.befriended',
      'horn.fate',
      'horn.rescues',
    ]);
  });

  describeContent(
    'condition',
    'AC-3: compiles in the sim and reads only registry facts',
    (entry) => {
      const world = new World({ seed: 1 });
      declareFacts(world.facts, game.all('fact'), { mode: 'throw' });
      const compiled = compileCondition(entry.when);
      for (const key of compiled.facts) expect(world.facts.isDeclared(key)).toBe(true);
      // Evaluates against registry defaults, with an explanation for every node.
      const explanation = compiled.explain(world.facts);
      expect(explanation.result).toBe(compiled.evaluate(world.facts));
      expect(formatExplanation(explanation)).toContain(String(compiled));
    },
  );

  it('horn-ally holds once Horn is befriended and while he lives', () => {
    const world = new World({ seed: 1 });
    declareFacts(world.facts, game.all('fact'), { mode: 'throw' });
    const compiled = compileCondition(game.get('condition', 'horn-ally').when);
    expect(compiled.evaluate(world.facts)).toBe(false);
    world.facts.set('horn.befriended', true);
    expect(compiled.evaluate(world.facts)).toBe(true);
    world.facts.set('horn.fate', 'dead');
    expect(compiled.evaluate(world.facts)).toBe(false);
  });
});

describe('live condition contract (mw-e15.2)', () => {
  it('content and sim share the signal reference, hold limit and match modes', () => {
    expect(content.SIGNAL_REF.source).toBe(SIGNAL_REF.source);
    expect(content.SUSTAINED_MAX_SECONDS).toBe(SUSTAINED_MAX_SECONDS);
    expect(content.ENTITY_MATCHES).toEqual(ENTITY_MATCHES);
  });

  it('a live condition content accepts compiles in the sim and reads what it says', () => {
    const parsed: Condition = content.conditionSchema.parse({
      all: [
        {
          entities: { tag: 'brazier' },
          where: [{ test: 'element', element: 'fire' }],
          match: 'all',
        },
        { signal: 'vault/gate', port: 'out' },
        {
          sustained: {
            entities: {},
            where: [{ test: 'property', property: 'weight', op: 'gte', value: 40 }],
            inside: {
              kind: 'box',
              center: { x: 0, y: 0, z: 0 },
              halfExtents: { x: 1, y: 1, z: 1 },
            },
            match: 'any',
          },
          seconds: 3,
        },
      ],
    });
    const { live } = compileCondition(parsed);
    expect(live.properties).toEqual(['burning', 'weight']);
    expect(live.signals).toEqual([{ graph: 'vault', node: 'gate', port: 'out' }]);
    expect([live.structure, live.spatial, live.timed, live.tags]).toEqual([true, true, true, true]);
  });
});
