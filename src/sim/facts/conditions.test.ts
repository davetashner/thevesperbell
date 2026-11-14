// World-fact conditions (mw-e27.5): compile, evaluate, dependencies, explain and change watching.

import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  compileCondition,
  CompiledCondition,
  CONDITION_MAX_DEPTH,
  ConditionError,
  conditionText,
  formatExplanation,
  onConditionChanged,
  validateCondition,
  type Condition,
  type FactReader,
} from './conditions';
import { FactStore, type FactChange, type FactValue } from './store';

/** A standalone fact store (events discarded). */
const store = (values: Readonly<Record<string, FactValue>> = {}): FactStore => {
  const facts = new FactStore({ emit: () => undefined, tick: () => 0 });
  for (const [key, value] of Object.entries(values)) facts.set(key, value);
  return facts;
};

const holds = (condition: Condition, facts: FactReader): boolean =>
  compileCondition(condition).evaluate(facts);

/** A leaf wrapped in `depth - 1` nots, so `depth` levels deep. */
const nested = (depth: number): Condition => {
  let condition: Condition = { fact: 'a' };
  for (let i = 1; i < depth; i++) condition = { not: condition };
  return condition;
};

const errorOf = (condition: unknown): string => {
  try {
    compileCondition(condition as Condition);
  } catch (error) {
    expect(error).toBeInstanceOf(ConditionError);
    return (error as Error).message;
  }
  return 'compiled';
};

describe('condition evaluation', () => {
  it('AC-1: all(fact(a) = true, fact(b) ≥ 3) is false at b = 2 and fires true once at b = 3', () => {
    const world = new World({ seed: 1 });
    world.facts.set('a', true);
    world.facts.set('b', 2);
    world.events.flush();
    const condition: Condition = {
      all: [
        { fact: 'a', eq: true },
        { fact: 'b', gte: 3 },
      ],
    };
    const calls: [boolean, FactChange | null][] = [];
    const watch = onConditionChanged(world, condition, (value, cause) => {
      calls.push([value, cause]);
    });
    expect(watch.value).toBe(false);
    expect(compileCondition(condition).evaluate(world.facts)).toBe(false);

    world.facts.set('b', 3);
    world.events.flush();
    world.facts.set('b', 4); // still true: no call
    world.facts.set('unrelated', 7);
    world.events.flush();
    expect(calls.map(([value]) => value)).toEqual([true]);
    expect(calls[0]?.[1]).toMatchObject({ key: 'b', old: 2, new: 3 });
    expect(watch.value).toBe(true);
  });

  it('AC-2: count(entity:mine/*.looted) ≥ 3 is true once three matching facts are true', () => {
    const condition: Condition = { count: 'entity:mine/*.looted', gte: 3 };
    const facts = store({
      'entity:mine/chest-1.looted': true,
      'entity:mine/chest-2.looted': true,
      'entity:mine/chest-3.looted': false,
      'entity:crypt/chest-1.looted': true,
      'entity:mine/chest-4.opened': true,
      'entity:mine/chest-4.looted.twice': true,
    });
    expect(holds(condition, facts)).toBe(false);
    facts.set('entity:mine/chest-3.looted', true);
    expect(holds(condition, facts)).toBe(true);
    expect(holds({ count: 'entity:*/*.looted', eq: 4 }, facts)).toBe(true);
    expect(holds({ count: 'entity:mine/*.looted.twice', eq: 1 }, facts)).toBe(true);
    expect(
      formatExplanation(compileCondition({ count: 'entity:crypt/*.looted', lt: 1 }).explain(facts)),
    ).toBe('✗ count(entity:crypt/*.looted) < 1 (count is 1)');
  });

  it('a bare fact test is true only for a true value', () => {
    const facts = store({ yes: true, no: false, three: 3, word: 'x' });
    expect(['yes', 'no', 'three', 'word', 'unset'].map((fact) => holds({ fact }, facts))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('compares with every operator; unset facts never compare numerically', () => {
    const facts = store({ n: 3, fate: 'dead', flag: false });
    const results = (fact: string) =>
      [{ eq: 3 }, { neq: 3 }, { gt: 2 }, { gte: 4 }, { lt: 4 }, { lte: 2 }].map((op) =>
        holds({ fact, ...op }, facts),
      );
    expect(results('n')).toEqual([true, false, true, false, true, false]);
    expect(results('unset')).toEqual([false, true, false, false, false, false]);
    expect(results('fate')).toEqual([false, true, false, false, false, false]);
    expect(holds({ fact: 'fate', eq: 'dead' }, facts)).toBe(true);
    expect(holds({ fact: 'flag', eq: false }, facts)).toBe(true);
  });

  it('has tests whether a fact holds a value, defaults included', () => {
    const facts = store({ set: 1 });
    facts.declare('defaulted', { type: 'int', default: 0 });
    facts.declare('unset', { type: 'id' });
    expect(holds({ fact: 'set', has: true }, facts)).toBe(true);
    expect(holds({ fact: 'defaulted', has: true }, facts)).toBe(true);
    expect(holds({ fact: 'unset', has: true }, facts)).toBe(false);
    expect(holds({ fact: 'unset', has: false }, facts)).toBe(true);
  });

  it('combines with all, any and not', () => {
    const facts = store({ t: true, f: false });
    expect(holds({ all: [{ fact: 't' }, { fact: 'f' }] }, facts)).toBe(false);
    expect(holds({ all: [{ fact: 't' }, { not: { fact: 'f' } }] }, facts)).toBe(true);
    expect(holds({ any: [{ fact: 'f' }, { fact: 't' }] }, facts)).toBe(true);
    expect(holds({ any: [{ fact: 'f' }] }, facts)).toBe(false);
    expect(holds({ not: { fact: 't' } }, facts)).toBe(false);
  });

  it('evaluates against any fact reader', () => {
    const reader: FactReader = { get: (key) => key === 'a', entries: () => [] };
    expect(holds({ fact: 'a' }, reader)).toBe(true);
  });
});

describe('condition compilation', () => {
  it('extracts the facts and count patterns a condition depends on', () => {
    const compiled = compileCondition({
      all: [
        { fact: 'z.last' },
        { any: [{ fact: 'a.first', gte: 1 }, { not: { fact: 'z.last', has: true } }] },
        { count: 'entity:mine/*.looted', gte: 3 },
        { count: 'entity:*/*.opened', eq: 0 },
      ],
    });
    expect(compiled).toBeInstanceOf(CompiledCondition);
    expect(compiled.facts).toEqual(['a.first', 'z.last']);
    expect(compiled.patterns).toEqual(['entity:*/*.opened', 'entity:mine/*.looted']);
    expect(compiled.depth).toBe(4);
    expect(
      [
        'z.last',
        'a.first',
        'entity:mine/chest-1.looted',
        'entity:crypt/chest-1.looted',
        'entity:crypt/door.opened',
        'entity:mine/chest-1.looted.twice',
        'other',
      ].map((key) => compiled.dependsOn(key)),
    ).toEqual([true, true, true, false, true, false, false]);
  });

  it(`AC-4: a condition nested ${String(CONDITION_MAX_DEPTH)} deep compiles; deeper is rejected clearly`, () => {
    const deepest = compileCondition(nested(CONDITION_MAX_DEPTH));
    expect(deepest.depth).toBe(64);
    expect(deepest.evaluate(store({ a: true }))).toBe(false); // 63 nots: odd
    expect(errorOf(nested(CONDITION_MAX_DEPTH + 1))).toBe(
      `invalid condition at ${Array.from({ length: 64 }, () => 'not').join('.')}: nested more than 64 levels deep; split it into smaller conditions`,
    );
    // Validation never recurses, so even an absurd depth fails cleanly instead of overflowing.
    expect(() => validateCondition(nested(200_000))).toThrow(ConditionError);
    const wide: Condition = { all: Array.from({ length: 1000 }, () => ({ fact: 'a' })) };
    expect(compileCondition(wide).depth).toBe(2);
  });

  it('rejects malformed conditions naming where they are', () => {
    expect(
      [
        null,
        [],
        {},
        { fact: 'a', all: [] },
        { fact: 'Bad Key' },
        { fact: 3 },
        { fact: 'a', gte: 1.5 },
        { fact: 'a', eq: '' },
        { fact: 'a', eq: null },
        { fact: 'a', has: 'yes' },
        { fact: 'a', gte: 1, lte: 3 },
        { fact: 'a', above: 1 },
        { count: 'entity:mine/chest.looted', gte: 1 },
        { count: 7, gte: 1 },
        { count: 'entity:mine/*.looted' },
        { count: 'entity:mine/*.looted', has: true },
        { count: 'entity:mine/*.looted', eq: true },
        { all: [] },
        { any: {} },
        { not: { fact: 'a' }, note: 'x' },
        { all: [{ fact: 'a' }, { any: [{ not: 5 }] }] },
      ].map(errorOf),
    ).toEqual([
      'invalid condition: a condition must be an object',
      'invalid condition: a condition must be an object',
      'invalid condition: a condition has exactly one of fact, count, all, any, not, entities, signal, sustained; got {}',
      'invalid condition: a condition has exactly one of fact, count, all, any, not, entities, signal, sustained; got {fact, all}',
      'invalid condition at fact: "Bad Key" is not a fact key',
      'invalid condition at fact: 3 is not a fact key',
      'invalid condition at gte: invalid operand 1.5',
      'invalid condition at eq: invalid operand ""',
      'invalid condition at eq: invalid operand null',
      'invalid condition at has: invalid operand "yes"',
      'invalid condition: a fact condition takes one operator, got gte, lte',
      'invalid condition: "above" is not an operator of a fact condition',
      'invalid condition at count: "entity:mine/chest.looted" is not a count pattern ("entity:<level>/*.<fact>" or "entity:*/*.<fact>")',
      'invalid condition at count: 7 is not a count pattern ("entity:<level>/*.<fact>" or "entity:*/*.<fact>")',
      'invalid condition: a count condition needs an operator (eq, gte…)',
      'invalid condition: "has" is not an operator of a count condition',
      'invalid condition at eq: invalid operand true',
      'invalid condition at all: must be a non-empty list of conditions',
      'invalid condition at any: must be a non-empty list of conditions',
      'invalid condition: a not condition has no other fields',
      'invalid condition at all[1].any[0].not: a condition must be an object',
    ]);
  });
});

describe('condition text and explanations', () => {
  it('renders readable text for every node', () => {
    const condition: Condition = {
      all: [
        { fact: 'minotaur.befriended' },
        { not: { fact: 'cellar.sealed' } },
        {
          any: [
            { fact: 'horn.fate', neq: 'dead' },
            { fact: 'n', lte: 2 },
          ],
        },
        { fact: 'bell.rung-by', has: false },
        { fact: 'bell.rung-by', has: true },
        { count: 'entity:mine/*.looted', gt: 2 },
      ],
    };
    expect(conditionText(condition)).toBe(
      'all(fact(minotaur.befriended), not(fact(cellar.sealed)), any(fact(horn.fate) ≠ "dead", fact(n) ≤ 2), fact(bell.rung-by) is unset, fact(bell.rung-by) is set, count(entity:mine/*.looted) > 2)',
    );
    expect(String(compileCondition({ fact: 'a', eq: true }))).toBe('fact(a) = true');
  });

  it('explains every node with what it read, without short-circuiting', () => {
    const compiled = compileCondition({
      any: [
        {
          all: [
            { fact: 'a', eq: true },
            { fact: 'b', gte: 3 },
          ],
        },
        { not: { fact: 'c' } },
        { fact: 'd', eq: 'x' },
      ],
    });
    const facts = store({ a: true, b: 2, c: true });
    const explanation = compiled.explain(facts);
    expect(explanation.result).toBe(compiled.evaluate(facts));
    expect(formatExplanation(explanation)).toBe(
      [
        '✗ any(all(fact(a) = true, fact(b) ≥ 3), not(fact(c)), fact(d) = "x")',
        '  ✗ all(fact(a) = true, fact(b) ≥ 3)',
        '    ✓ fact(a) = true (a is true)',
        '    ✗ fact(b) ≥ 3 (b is 2)',
        '  ✗ not(fact(c))',
        '    ✓ fact(c) (c is true)',
        '  ✗ fact(d) = "x" (d is unset)',
      ].join('\n'),
    );
    facts.set('b', 3);
    expect(compiled.explain(facts).result).toBe(true);
  });
});

describe('onConditionChanged', () => {
  it('fires once for a transaction that changes several dependencies', () => {
    const world = new World({ seed: 1 });
    const calls: boolean[] = [];
    const compiled = compileCondition({ all: [{ fact: 'a' }, { fact: 'b' }] });
    onConditionChanged(world, compiled, (value) => calls.push(value));
    world.facts.transaction(() => {
      world.facts.set('a', true);
      world.facts.set('b', true);
    });
    world.events.flush();
    world.facts.set('a', false);
    world.events.flush();
    expect(calls).toEqual([true, false]);
  });

  it('fires at the phase boundary of the tick a system changes a fact', () => {
    const world = new World({ seed: 1 });
    const seen: number[] = [];
    onConditionChanged(world, { count: 'entity:*/*.looted', gte: 2 }, (value, cause) => {
      if (value) seen.push(cause?.tick ?? -1);
    });
    world.addSystem({
      name: 'loot',
      run: ({ world: w, tick }) => {
        if (tick === 3) w.facts.set('entity:mine/chest-1.looted', true);
        if (tick === 5) w.facts.set('entity:crypt/chest-9.looted', true);
      },
    });
    for (let i = 0; i < 8; i++) world.step();
    expect(seen).toEqual([5]);
  });

  it('refresh re-baselines after a restore; unsubscribe stops calls', () => {
    const world = new World({ seed: 1 });
    const snapshot = world.snapshot();
    world.facts.set('a', true);
    world.events.flush();
    const calls: [boolean, FactChange | null][] = [];
    const watch = onConditionChanged(world, { fact: 'a' }, (value, cause) => {
      calls.push([value, cause]);
    });
    expect(watch.value).toBe(true);
    expect(watch.condition.facts).toEqual(['a']);
    world.restore(snapshot); // facts cleared without events
    expect(watch.value).toBe(true);
    expect(watch.refresh()).toBe(false);
    expect(watch.refresh()).toBe(false);
    expect(calls).toEqual([[false, null]]);
    watch.unsubscribe();
    world.facts.set('a', true);
    world.events.flush();
    expect(watch.refresh()).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
