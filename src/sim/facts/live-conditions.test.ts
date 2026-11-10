// The live leaves of the condition language (mw-e15.2): entities, signal and sustained. Validation,
// text, explanations and dependencies here; behaviour against real worlds is in puzzle/goals.test.ts.

import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { registerSceneComponents, SceneTransformComponent } from '../scene/loader';
import { tagEntity } from '../signals/filter';
import type { SignalPredicate } from '../signals/graph';
import { addSignalGraph, installSignals } from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import {
  compileCondition,
  createConditionMemory,
  formatExplanation,
  onConditionChanged,
  type Condition,
  type ConditionHost,
  type EntitySelector,
  type LiveReader,
} from './conditions';
import { conditionHost, worldLiveReader } from './live';

const errorOf = (condition: unknown): string => {
  try {
    compileCondition(condition as Condition);
  } catch (error) {
    return (error as Error).message;
  }
  return 'compiled';
};

const box = { kind: 'box', center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } };
const burning: SignalPredicate = { test: 'element', element: 'fire' };

describe('live condition validation', () => {
  it('accepts the live leaves and reports where a malformed one is wrong', () => {
    const lit = { entities: { tag: 'brazier' }, where: [burning], match: 'all' };
    expect(errorOf(lit)).toBe('compiled');
    expect(errorOf({ entities: {}, inside: box, gte: 2 })).toBe('compiled');
    expect(errorOf({ signal: 'vault/gate', port: 'out' })).toBe('compiled');
    expect(
      errorOf({
        entities: {},
        where: [{ test: 'property', property: 'material', op: 'eq', value: 'oak' }],
        match: 'any',
      }),
    ).toBe('compiled');
    expect(errorOf({ sustained: lit, seconds: 3 })).toBe('compiled');
    const cases: [unknown, string][] = [
      [{ entities: 3, match: 'all' }, 'at entities: must be an object: { tag }, { entity } or {}'],
      [
        { entities: { tag: 'Bad' }, match: 'all' },
        'at entities.tag: "Bad" is not a tag (a kebab-case id)',
      ],
      [
        { entities: { id: 'x' }, match: 'all' },
        'at entities: "id" is not a field of an entity selector',
      ],
      [{ entities: {}, match: 'most' }, 'at match: "most" is not one of all, any, none'],
      [
        { entities: {} },
        'an entities condition needs exactly one of match (all, any, none) or an operator (eq, gte…)',
      ],
      [{ entities: {}, match: 'all', gte: 1 }, 'an entities condition needs exactly one of match'],
      [{ entities: {}, gte: 1.5 }, 'at gte: invalid operand 1.5'],
      [{ entities: {}, match: 'all', nope: 1 }, '"nope" is not a field of an entities condition'],
      [{ entities: {}, match: 'all', where: 3 }, 'at where: must be a list of predicates'],
      [{ entities: {}, match: 'all', where: [3] }, 'at where[0]: a predicate must be an object'],
      [
        { entities: {}, match: 'all', where: [{ test: 'smell' }] },
        'at where[0].test: "smell" is not a predicate (property, tag or element)',
      ],
      [
        {
          entities: {},
          match: 'all',
          where: [{ test: 'property', property: 'nope', op: 'eq', value: 1 }],
        },
        'at where[0].property: "nope" is not a world property',
      ],
      [
        {
          entities: {},
          match: 'all',
          where: [{ test: 'property', property: 'weight', op: 'near', value: 1 }],
        },
        'at where[0].op: "near" is not one of eq, ne, lt, lte, gt, gte',
      ],
      [
        {
          entities: {},
          match: 'all',
          where: [{ test: 'property', property: 'weight', op: 'gt', value: true }],
        },
        'at where[0].value: invalid operand true',
      ],
      [
        {
          entities: {},
          match: 'all',
          where: [{ test: 'property', property: 'weight', op: 'gt', value: 1, x: 1 }],
        },
        '"x" is not a field of a property predicate',
      ],
      [
        { entities: {}, match: 'all', where: [{ test: 'tag', tag: 'A' }] },
        'at where[0].tag: "A" is not a tag',
      ],
      [
        { entities: {}, match: 'all', where: [{ test: 'element', element: 'mud' }] },
        'at where[0].element: "mud" is not one of fire, water, ice, charge',
      ],
      [{ entities: {}, match: 'all', inside: 3 }, 'at inside: a volume is an object with a kind'],
      [
        { entities: {}, match: 'all', inside: { kind: 'cone' } },
        'at inside.kind: a volume is a box, sphere or capsule, not "cone"',
      ],
      [
        { entities: {}, match: 'all', inside: { kind: 'sphere', center: box.center, radius: -1 } },
        'at inside.radius: must be a finite number ≥ 0',
      ],
      [
        { entities: {}, match: 'all', inside: { kind: 'sphere', center: 3, radius: 1 } },
        'at inside.center: must be an object with x, y, z',
      ],
      [
        { entities: {}, match: 'all', inside: { ...box, halfExtents: { x: -1, y: 1, z: 1 } } },
        'at inside.halfExtents.x: must be a finite number ≥ 0, got -1',
      ],
      [
        { entities: {}, match: 'all', inside: { ...box, center: { x: 'a', y: 0, z: 0 } } },
        'at inside.center.x: must be a finite number, got "a"',
      ],
      [
        { entities: {}, match: 'all', inside: { ...box, extra: 1 } },
        '"extra" is not a field of a box volume',
      ],
      [{ signal: 'nope' }, 'at signal: "nope" is not a signal reference ("<graph>/<node>")'],
      [{ signal: 'a/b', port: 'Out' }, 'at port: "Out" is not a port'],
      [{ signal: 'a/b', gte: 1 }, '"gte" is not a field of a signal condition'],
      [
        { sustained: { fact: 'a' }, seconds: 0 },
        'at seconds: must be a number of seconds above 0 and at most 3600, got 0',
      ],
      [
        { sustained: { fact: 'a' }, seconds: 3601 },
        'at seconds: must be a number of seconds above 0',
      ],
      [{ sustained: { fact: 'a' } }, 'at seconds: must be a number'],
      [
        { sustained: { fact: 'a' }, seconds: 1, x: 1 },
        '"x" is not a field of a sustained condition',
      ],
      [{ sustained: { fact: 3 }, seconds: 1 }, 'at sustained.fact: 3 is not a fact key'],
    ];
    for (const [condition, message] of cases) {
      expect(errorOf(condition), JSON.stringify(condition)).toContain(message);
    }
  });
});

describe('live condition text, dependencies and explanations', () => {
  const live = (over: Partial<LiveReader> = {}): LiveReader => ({
    tick: 0,
    hz: 10,
    structure: 0,
    select: () => [],
    passes: () => true,
    signal: () => false,
    ...over,
  });

  it('writes each leaf as readable text', () => {
    const text = (c: Condition) => compileCondition(c).toString();
    expect(
      text({
        entities: { tag: 'brazier', entity: 'b-1' },
        where: [
          burning,
          { test: 'tag', tag: 'lit' },
          { test: 'property', property: 'weight', op: 'gte', value: 40 },
        ],
        match: 'all',
      }),
    ).toBe('entities(tag:brazier entity:b-1, where fire and tag lit and weight ≥ 40): all');
    expect(text({ entities: {}, gte: 2 })).toBe('entities(any entity): count ≥ 2');
    expect(text({ entities: {}, inside: box, match: 'any' } as Condition)).toBe(
      'entities(any entity, inside box(0,0,0 ±1,1,1)): any',
    );
    expect(
      text({
        entities: {},
        inside: { kind: 'sphere', center: box.center, radius: 2 },
        match: 'none',
      }),
    ).toBe('entities(any entity, inside sphere(0,0,0 r2)): none');
    expect(
      text({
        entities: {},
        inside: { kind: 'capsule', from: box.center, to: { x: 0, y: 1, z: 0 }, radius: 1 },
        match: 'none',
      }),
    ).toBe('entities(any entity, inside capsule(0,0,0 → 0,1,0 r1)): none');
    expect(text({ signal: 'vault/gate' })).toBe('signal(vault/gate)');
    expect(text({ signal: 'vault/gate', port: 'out' })).toBe('signal(vault/gate.out)');
    expect(text({ sustained: { fact: 'a' }, seconds: 2.5 })).toBe('sustained(fact(a), 2.5s)');
    expect(
      text({
        entities: {},
        where: [
          { test: 'property', property: 'wetness', op: 'ne', value: 0 },
          { test: 'property', property: 'wetness', op: 'lt', value: 1 },
          { test: 'property', property: 'wetness', op: 'lte', value: 1 },
          { test: 'property', property: 'wetness', op: 'gt', value: 0 },
          { test: 'property', property: 'wetness', op: 'eq', value: 0 },
        ],
        match: 'any',
      }),
    ).toContain('wetness ≠ 0 and wetness < 1 and wetness ≤ 1 and wetness > 0 and wetness = 0');
  });

  it('lists what a condition reads of the world', () => {
    const none = compileCondition({ fact: 'a' });
    expect(none.isLive).toBe(false);
    const all = compileCondition({
      all: [
        {
          entities: { tag: 'x' },
          where: [burning, { test: 'tag', tag: 'y' }],
          inside: box,
          match: 'any',
        } as Condition,
        { signal: 'g/n' },
        { signal: 'g/n' },
        { signal: 'g/n', port: 'out' },
        { sustained: { entities: { entity: 'e' }, match: 'any' }, seconds: 1 },
      ],
    });
    expect(all.isLive).toBe(true);
    expect(all.live).toEqual({
      properties: ['burning'],
      signals: [
        { graph: 'g', node: 'n', port: undefined },
        { graph: 'g', node: 'n', port: 'out' },
      ],
      tags: true,
      structure: true,
      spatial: true,
      timed: true,
    });
    for (const [condition, flag] of [
      [{ signal: 'g/n' }, 'signals'],
      [{ sustained: { fact: 'a' }, seconds: 1 }, 'timed'],
      [{ entities: {}, match: 'any' }, 'structure'],
    ] as [Condition, string][]) {
      expect(compileCondition(condition).isLive, flag).toBe(true);
    }
  });

  it('is false without a live world, and says so', () => {
    const facts = new World({ seed: 1 }).facts;
    const goal = compileCondition({
      all: [
        { entities: {}, match: 'none' },
        { signal: 'a/b' },
        { sustained: { fact: 'a' }, seconds: 1 },
      ],
    });
    expect(goal.evaluate(facts)).toBe(false);
    expect(formatExplanation(goal.explain(facts))).toBe(
      [
        '✗ all(entities(any entity): none, signal(a/b), sustained(fact(a), 1s))',
        '  ✗ entities(any entity): none (no live world to read)',
        '  ✗ signal(a/b) (no live world to read)',
        '  ✗ sustained(fact(a), 1s) (no live world to read)',
        '    ✗ fact(a) (a is unset)',
      ].join('\n'),
    );
  });

  it('a sustained without memory is false even when its condition holds', () => {
    const facts = new World({ seed: 1 }).facts;
    facts.set('a', true);
    const goal = compileCondition({ sustained: { fact: 'a' }, seconds: 1 });
    expect(goal.evaluate(facts, live())).toBe(false);
    expect(goal.explain(facts, live()).result).toBe(false);
  });

  it('explains how long a hold has lasted and tracks it in memory', () => {
    const facts = new World({ seed: 1 }).facts;
    facts.set('a', true);
    const goal = compileCondition({ sustained: { fact: 'a' }, seconds: 1 });
    const memory = createConditionMemory();
    const reader = { ...live(), tick: 0 };
    expect(goal.evaluate(facts, reader, memory)).toBe(false);
    expect(memory.due).toBe(10);
    reader.tick = 4;
    expect(goal.explain(facts, reader, memory).actual).toBe('held 0.4s of 1s');
    reader.tick = 10;
    expect(goal.evaluate(facts, reader, memory)).toBe(true);
    expect(goal.explain(facts, reader, memory).result).toBe(true);
    facts.set('a', false);
    expect(goal.evaluate(facts, reader, memory)).toBe(false);
    expect(goal.explain(facts, reader, memory).actual).toBe('held 0s of 1s');
    // A condition that has not been evaluated yet has not been held at all.
    expect(goal.explain(facts, reader, createConditionMemory()).actual).toBe('held 0s of 1s');
  });

  it('counts entities with the operators and explains the tally', () => {
    const facts = new World({ seed: 1 }).facts;
    const reader = live({ select: () => [1, 2, 3] as EntityId[], passes: (e) => e !== 3 });
    const check = (c: Condition) => compileCondition(c).evaluate(facts, reader);
    expect(check({ entities: {}, match: 'all' })).toBe(false);
    expect(check({ entities: {}, match: 'any' })).toBe(true);
    expect(check({ entities: {}, match: 'none' })).toBe(false);
    expect(check({ entities: {}, eq: 2 })).toBe(true);
    expect(check({ entities: {}, neq: 2 })).toBe(false);
    expect(check({ entities: {}, gt: 1 })).toBe(true);
    expect(check({ entities: {}, lt: 2 })).toBe(false);
    expect(check({ entities: {}, lte: 2 })).toBe(true);
    expect(compileCondition({ entities: {}, gte: 3 }).explain(facts, reader).actual).toBe(
      '2 of 3 pass',
    );
    expect(check({ entities: { tag: 'x' }, match: 'all' })).toBe(false);
    const empty = live();
    expect(compileCondition({ entities: {}, match: 'all' }).evaluate(facts, empty)).toBe(false);
    expect(compileCondition({ entities: {}, match: 'none' }).evaluate(facts, empty)).toBe(true);
  });

  it('explains signal state', () => {
    const facts = new World({ seed: 1 }).facts;
    const on = live({ signal: (g, n, p) => g === 'a' && n === 'b' && p === 'out' });
    expect(compileCondition({ signal: 'a/b', port: 'out' }).explain(facts, on).actual).toBe(
      'signal is on',
    );
    expect(compileCondition({ signal: 'a/b' }).explain(facts, on).actual).toBe('signal is off');
  });
});

describe('watching live conditions', () => {
  function world() {
    const w = installSignals(
      installStimuli(registerWorldProperties(new World<never>({ seed: 2, hz: 10 }))),
    );
    registerSceneComponents(w);
    return w;
  }

  it('without a live reader the live leaves stay false and poll does nothing', () => {
    const w = world();
    const calls: boolean[] = [];
    const watch = onConditionChanged(
      { facts: w.facts, events: w.events },
      { sustained: { entities: {}, match: 'none' }, seconds: 1 },
      (v) => calls.push(v),
    );
    expect(watch.poll()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('registers events only for what the condition reads', () => {
    const w = world();
    const registered: string[] = [];
    const host: ConditionHost = {
      facts: w.facts,
      events: {
        on: (type, handler) => {
          registered.push(type.name);
          return w.events.on(type, handler);
        },
      },
    };
    onConditionChanged(host, { fact: 'a' }, () => undefined);
    onConditionChanged(host, { entities: {}, where: [burning], match: 'any' }, () => undefined);
    onConditionChanged(host, { entities: { tag: 'x' }, match: 'any' }, () => undefined);
    expect(registered).toEqual([
      'factChanged',
      'factChanged',
      'propertyChanged',
      'factChanged',
      'tagsChanged',
    ]);
  });

  it('unsubscribe stops property, tag and fact callbacks', () => {
    const w = world();
    const e = w.spawn();
    addProperties(w, e, { burning: false });
    tagEntity(w, e, 'lamp');
    const calls: boolean[] = [];
    const watch = onConditionChanged(
      conditionHost(w),
      { entities: { tag: 'lamp' }, where: [burning], match: 'all' },
      (v) => calls.push(v),
    );
    setProperty(w, e, 'burning', true);
    w.step();
    expect(calls).toEqual([true]);
    watch.unsubscribe();
    setProperty(w, e, 'burning', false);
    w.step();
    expect(calls).toEqual([true]);
  });

  it('polls signal outputs, structure, volumes and due holds, and nothing else', () => {
    const w = world();
    const thing = w.spawn();
    addProperties(w, thing, { weight: 50 });
    placeEntity(w, thing, { x: 50, y: 0, z: 0 });
    let evaluations = 0;
    const base = worldLiveReader(w);
    const counting: ConditionHost = {
      facts: w.facts,
      events: w.events,
      // Inherits the reader's live getters (tick, structure); only `select` is counted.
      live: Object.create(base, {
        select: {
          value: (selector: EntitySelector) => {
            evaluations++;
            return base.select(selector);
          },
        },
      }) as LiveReader,
    };
    const watch = onConditionChanged(
      counting,
      { entities: { entity: 'nothing' }, match: 'any' },
      () => undefined,
    );
    const start = evaluations;
    expect(watch.poll()).toBe(false); // nothing moved: no evaluation
    expect(evaluations).toBe(start);
    const other = w.spawn();
    addProperties(w, other, { weight: 1 }); // an entity gained a component: the structure changed
    expect(watch.poll()).toBe(false);
    expect(evaluations).toBe(start + 1);
    expect(watch.poll()).toBe(false);
    expect(evaluations).toBe(start + 1);
  });

  it('polls a due hold only once it is due', () => {
    const w = world();
    w.facts.declare('lamp.lit', { type: 'bool', default: false });
    const calls: boolean[] = [];
    const watch = onConditionChanged(
      conditionHost(w),
      { sustained: { fact: 'lamp.lit' }, seconds: 1 },
      (v) => calls.push(v),
    );
    w.facts.set('lamp.lit', true);
    for (let i = 0; i < 9; i++) {
      w.step();
      expect(watch.poll()).toBe(false);
    }
    w.step();
    expect(watch.poll()).toBe(true);
    expect(calls).toEqual([true]);
  });

  it('selects by tag only the entities that carry it', () => {
    const w = world();
    const lamp = w.spawn();
    tagEntity(w, lamp, 'lamp');
    const brazier = w.spawn();
    tagEntity(w, brazier, 'brazier');
    const reader = worldLiveReader(w);
    expect(reader.select({ tag: 'brazier' })).toEqual([brazier]);
    expect(reader.select({ tag: 'lamp' })).toEqual([lamp]);
  });

  it('reads a scene transform when an entity has no placement', () => {
    const w = world();
    const reader = worldLiveReader(w);
    const marker = w.spawn();
    w.add(marker, SceneTransformComponent, {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    const bare = w.spawn();
    expect(reader.passes(marker, [], box as never)).toBe(true);
    expect(reader.passes(bare, [], box as never)).toBe(false);
    expect(reader.passes(bare, [], undefined)).toBe(true);
  });

  it('reads signals by graph id, node and port, and false for what does not exist', () => {
    const w = world();
    addSignalGraph(w, {
      id: 'vault',
      nodes: [{ id: 'gate', kind: 'lever', initial: true, observed: true }],
      wires: [],
    } as never);
    w.step();
    const reader = worldLiveReader(w);
    expect(reader.signal('vault', 'gate', undefined)).toBe(false); // no evaluation system installed
    expect(reader.signal('vault', 'gate', 'nope')).toBe(false);
    expect(reader.signal('vault', 'missing', undefined)).toBe(false);
    expect(reader.signal('other', 'gate', undefined)).toBe(false);
    const bare = worldLiveReader(new World<never>({ seed: 1 }));
    expect(bare.signal('vault', 'gate', undefined)).toBe(false);
    expect(bare.select({ tag: 'x' })).toEqual([]);
    expect(bare.select({})).toEqual([]);
    expect(bare.select({ entity: 'x' })).toEqual([]);
    expect(bare.passes(1, [], box as never)).toBe(false);
    expect(bare.tick).toBe(0);
    expect(bare.hz).toBe(60);
    expect(bare.structure).toBeGreaterThanOrEqual(0);
  });
});
