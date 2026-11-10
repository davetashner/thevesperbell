import { describe, expect, it } from 'vitest';
import {
  CONDITION_USAGES,
  conditionEntityRefs,
  conditionProblems,
  signalIndex,
} from './condition-checks.ts';
import { factIndex } from './fact-checks.ts';
import { loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import type { Condition } from './types/condition.ts';
import type { FactGroup } from './types/fact.ts';

const fact = { description: 'Test fact.', owner: 'quest', persistence: 'permanent' } as const;

const group: FactGroup = {
  id: 'test',
  name: 'Test',
  notes: 'Test.',
  facts: [
    { ...fact, key: 'minotaur.befriended', type: 'bool', default: false },
    { ...fact, key: 'cellar.sealed', type: 'bool', default: true },
    { ...fact, key: 'miller.stage', type: 'int', default: 0 },
    { ...fact, key: 'bell.rung-at', type: 'tick', default: null },
    { ...fact, key: 'bell.rung-by', type: 'id', default: null },
    { ...fact, key: 'horn.fate', type: 'enum', values: ['alive', 'dead'], default: 'alive' },
    { ...fact, key: 'entity:*.looted', type: 'bool', default: false },
    { ...fact, key: 'entity:*.charges', type: 'int', default: 0 },
  ],
};

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const registry = source('data/fact/test.json', group);

const named = (id: string, when: Condition): ContentSource =>
  source(`data/condition/${id}.json`, { id, name: 'Test', notes: 'Test.', when });

const issuesOf = (sources: readonly ContentSource[]) => {
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
  return [];
};

const problemsOf = (condition: Condition) =>
  conditionProblems(condition, factIndex([group])).map((p) => `${p.pointer}: ${p.message}`);

describe('condition checks', () => {
  it('AC-3: a condition referencing an undeclared fact fails validation via the registry', () => {
    const when: Condition = {
      all: [{ fact: 'minotaur.befriended' }, { not: { fact: 'cellar.seald' } }],
    };
    expect(issuesOf([registry, named('cellar', when)])).toEqual([
      {
        file: 'data/condition/cellar.json',
        pointer: '/when/all/1/not/fact',
        message:
          'condition:cellar names undeclared fact "cellar.seald": declare it in src/content/data/fact/',
      },
    ]);
  });

  it('accepts declared facts, entity keys covered by a template and fitting operators', () => {
    const when: Condition = {
      any: [
        { fact: 'minotaur.befriended' },
        { fact: 'cellar.sealed', eq: false },
        { fact: 'miller.stage', gte: -1 },
        { fact: 'miller.stage', neq: -1 },
        { fact: 'bell.rung-at', lt: 100 },
        { fact: 'bell.rung-at', eq: 0 },
        { fact: 'bell.rung-by', eq: 'tansy' },
        { fact: 'bell.rung-by', has: false },
        { fact: 'horn.fate', eq: 'dead' },
        { fact: 'entity:mine/chest-1.looted' },
        { count: 'entity:mine/*.looted', gte: 3 },
      ],
    };
    expect(issuesOf([registry, named('ok', when)])).toEqual([]);
  });

  it('reports operators that do not suit the fact type', () => {
    expect(
      problemsOf({
        all: [
          { fact: 'miller.stage' },
          { fact: 'horn.fate', gte: 1 },
          { fact: 'minotaur.befriended', eq: 1 },
          { fact: 'miller.stage', eq: true },
          { fact: 'bell.rung-at', eq: -1 },
          { fact: 'horn.fate', neq: 'undead' },
          { fact: 'bell.rung-by', eq: 'Tansy Cole' },
          { fact: 'entity:mine/chest-1.opened' },
          { count: 'entity:mine/*.opened', gte: 1 },
          { count: 'entity:*/*.charges', gte: 1 },
        ],
      }),
    ).toEqual([
      '/all/0/fact: a bare fact test needs a bool fact; "miller.stage" is int: add an operator',
      '/all/1/fact: "gte" needs an int or tick fact; "horn.fate" is enum',
      '/all/2/fact: "minotaur.befriended" is bool: 1 is not a bool',
      '/all/3/fact: "miller.stage" is int: true is not a int',
      '/all/4/fact: "bell.rung-at" is tick: -1 is not a tick',
      '/all/5/fact: "horn.fate" is enum: "undead" is not one of alive, dead',
      '/all/6/fact: "bell.rung-by" is id: "Tansy Cole" is not a id',
      '/all/7/fact: names undeclared fact "entity:mine/chest-1.opened": declare it in src/content/data/fact/',
      '/all/8/count: counts undeclared fact template "entity:*.opened": declare it in src/content/data/fact/',
      '/all/9/count: counts "entity:*.charges", which is int, not bool',
    ]);
  });

  it('checks signal leaves against the signal graphs, when given them (mw-e15.2)', () => {
    const signals = signalIndex(loadGameContent().all('signal-graph'));
    const check = (condition: Condition) =>
      conditionProblems(condition, factIndex([group]), signals).map(
        (p) => `${p.pointer}: ${p.message}`,
      );
    expect(
      check({
        all: [
          { signal: 'greybox-rune-plates/west-plate', port: 'active' },
          { signal: 'greybox-rune-plates/west-plate' },
          { signal: 'greybox-rune-plates/nope' },
          { signal: 'greybox-rune-plates/west-plate', port: 'out' },
          { signal: 'nowhere/west-plate' },
          { sustained: { signal: 'nowhere/x' }, seconds: 1 },
          { entities: { tag: 'brazier' }, match: 'any' },
        ],
      }),
    ).toEqual([
      '/all/2/signal: reads node "nope", which signal graph "greybox-rune-plates" does not have',
      '/all/3/signal: reads port "out", which node "greybox-rune-plates/west-plate" does not have (active, stay, enter, exit)',
      '/all/4/signal: reads signal graph "nowhere", which does not exist: add it to src/content/data/signal-graph/',
      '/all/5/sustained/signal: reads signal graph "nowhere", which does not exist: add it to src/content/data/signal-graph/',
    ]);
    // Without the graphs, signals are not checked (callers that only know facts).
    expect(problemsOf({ signal: 'nowhere/x' })).toEqual([]);
  });

  it('finds the scene spawns a condition names', () => {
    expect(
      conditionEntityRefs({
        all: [
          { entities: { entity: 'room-lever' }, match: 'any' },
          { not: { entities: { entity: 'loose-crate', tag: 'x' }, gte: 1 } },
          { any: [{ sustained: { entities: { entity: 'plate' }, match: 'any' }, seconds: 1 }] },
          { entities: { tag: 'brazier' }, match: 'any' },
          { fact: 'a' },
        ],
      }),
    ).toEqual([
      { pointer: '/all/0/entities/entity', entity: 'room-lever' },
      { pointer: '/all/1/not/entities/entity', entity: 'loose-crate' },
      { pointer: '/all/2/any/0/sustained/entities/entity', entity: 'plate' },
    ]);
  });

  it('finds the conditions of the shipped named conditions', () => {
    const content = loadGameContent();
    const usages = content
      .all('condition')
      .flatMap((c) => CONDITION_USAGES['condition']?.(c as never) ?? []);
    expect(usages.length).toBe(content.all('condition').length);
    expect(usages.every((u) => u.pointer === '/when')).toBe(true);
  });
});
