import { describe, expect, it, vi } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  CompiledCondition,
  compileCondition,
  ConditionError,
  worldLiveReader,
  type Condition,
} from '../facts/index';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { registerSceneComponents, spawnSceneSpawn } from '../scene/loader';
import { tagEntity } from '../signals/filter';
import type { SignalGraphDef } from '../signals/graph';
import { addSignalGraph, installSignals, setLever, signalSystem } from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import { GoalRuntime, puzzleGoalSystem } from './goals';

const HZ = 10;
const O = { x: 0, y: 0, z: 0 };
const FAR = { x: 100, y: 0, z: 0 };
const plateZone = {
  kind: 'box',
  center: O,
  halfExtents: { x: 1, y: 1, z: 1 },
} as const;

function setup() {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3, hz: HZ }))),
  );
  registerSceneComponents(world);
  world.addSystem(signalSystem());
  const goals = new GoalRuntime(world);
  world.addSystem(puzzleGoalSystem(goals));
  return { world, goals };
}

function brazier(world: World<never>, burning = false): EntityId {
  const id = world.spawn();
  addProperties(world, id, { burning });
  tagEntity(world, id, 'brazier');
  return id;
}

function weight(world: World<never>, kg: number, at = FAR): EntityId {
  const id = world.spawn();
  addProperties(world, id, { weight: kg });
  placeEntity(world, id, at);
  return id;
}

const allBurning: Condition = {
  entities: { tag: 'brazier' },
  where: [{ test: 'element', element: 'fire' }],
  match: 'all',
};

function steps(world: World<never>, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

describe('puzzle goals over live properties', () => {
  it('AC-1: all(tag:brazier, burning) is false at 2 of 3 and true on the tick the third ignites', () => {
    const { world, goals } = setup();
    const [a, b, c] = [brazier(world), brazier(world), brazier(world)];
    const changes: [boolean, number][] = [];
    goals.add('braziers', allBurning, (met, tick) => changes.push([met, tick]));
    expect(goals.met('braziers')).toBe(false);
    setProperty(world, a, 'burning', true);
    setProperty(world, b, 'burning', true);
    steps(world, 3);
    expect(goals.met('braziers')).toBe(false);
    expect(changes).toEqual([]);
    // Any source lights it: a plain property write stands for fire, an arrow or a spell.
    const before = world.tick;
    setProperty(world, c, 'burning', true);
    steps(world, 1);
    expect(goals.met('braziers')).toBe(true);
    expect(changes).toEqual([[true, before]]); // the tick the write was made on
    setProperty(world, a, 'burning', false);
    steps(world, 1);
    expect(goals.met('braziers')).toBe(false);
  });

  it('AC-2: sustained(inVolume(any weight>=40), 3s) stays false when the weight is removed at 2.9 s', () => {
    const { world, goals } = setup();
    const crate = weight(world, 50);
    const goal: Condition = {
      sustained: {
        entities: {},
        where: [{ test: 'property', property: 'weight', op: 'gte', value: 40 }],
        inside: plateZone,
        match: 'any',
      },
      seconds: 3,
    };
    goals.add('plate', goal);
    placeEntity(world, crate, O);
    steps(world, 29); // 2.9 s
    expect(goals.met('plate')).toBe(false);
    placeEntity(world, crate, FAR);
    steps(world, 5);
    expect(goals.met('plate')).toBe(false);
    // Held again for the full 3 s it is met, and not a tick sooner.
    placeEntity(world, crate, O);
    steps(world, 29);
    expect(goals.met('plate')).toBe(false);
    steps(world, 2);
    expect(goals.met('plate')).toBe(true);
    placeEntity(world, crate, FAR);
    steps(world, 1);
    expect(goals.met('plate')).toBe(false);
  });

  it('AC-3: a goal whose dependencies did not change is not re-evaluated', () => {
    const { world, goals } = setup();
    brazier(world);
    const other = world.spawn();
    addProperties(world, other, { wetness: 0 });
    world.facts.declare('testbed.x', { type: 'int', default: 0 });
    const compiled = compileCondition(allBurning);
    const evaluate = vi.spyOn(compiled, 'evaluate');
    goals.add('braziers', compiled);
    expect(evaluate).toHaveBeenCalledTimes(1);
    steps(world, 1);
    evaluate.mockClear();
    // Neither an unrelated property nor an unrelated fact touches what it reads, and no entity
    // appeared or vanished: ticks go by without a single evaluation.
    setProperty(world, other, 'wetness', 0.5);
    world.facts.set('testbed.x', 4);
    steps(world, 5);
    expect(evaluate).not.toHaveBeenCalled();
    // A change it reads evaluates it once.
    const lamp = brazier(world);
    steps(world, 1);
    evaluate.mockClear();
    setProperty(world, lamp, 'burning', true);
    steps(world, 1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('AC-4: a malformed goal fails to compile with the path to the node', () => {
    const { goals } = setup();
    const bad = {
      all: [{ fact: 'a' }, { not: { entities: {}, where: [{ test: 'smell' }], match: 'any' } }],
    };
    expect(() => {
      goals.add('bad', bad as unknown as Condition);
    }).toThrow(
      new ConditionError(
        'all[1].not.where[0].test',
        '"smell" is not a predicate (property, tag or element)',
      ),
    );
    expect(goals.ids).toEqual([]);
  });

  it('AC-5: explain lists each sub-condition with its current truth value', () => {
    const { world, goals } = setup();
    brazier(world, true);
    brazier(world);
    brazier(world, true);
    goals.add('g', {
      all: [allBurning, { fact: 'testbed.flag' }],
    });
    expect(goals.explain('g')).toBe(
      [
        '✗ all(entities(tag:brazier, where fire): all, fact(testbed.flag))',
        '  ✗ entities(tag:brazier, where fire): all (2 of 3 pass)',
        '  ✗ fact(testbed.flag) (testbed.flag is unset)',
      ].join('\n'),
    );
  });
});

describe('GoalRuntime', () => {
  it('watches, reads, explains and removes goals by id', () => {
    const { world, goals } = setup();
    brazier(world, true);
    goals.add('one', allBurning);
    goals.add('two', { fact: 'testbed.flag' });
    expect(goals.ids).toEqual(['one', 'two']);
    expect(goals.met('one')).toBe(true);
    expect(goals.compiled('one')).toBeInstanceOf(CompiledCondition);
    expect(goals.compiled('one').live.properties).toEqual(['burning']);
    expect(() => {
      goals.add('one', allBurning);
    }).toThrow('goal "one" is already watched');
    expect(goals.remove('one')).toBe(true);
    expect(goals.remove('one')).toBe(false);
    expect(() => goals.met('one')).toThrow('goal "one" is not watched');
    goals.dispose();
    expect(goals.ids).toEqual([]);
  });

  it('refresh re-reads every goal, as after a restore', () => {
    const { world, goals } = setup();
    const lamp = brazier(world);
    const seen: boolean[] = [];
    goals.add('g', allBurning, (met) => seen.push(met));
    setProperty(world, lamp, 'burning', true);
    // No step yet, so no event has been delivered; refresh reads the state directly.
    goals.refresh();
    expect(goals.met('g')).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('follows a signal output, however the graph is driven', () => {
    const { world, goals } = setup();
    const def: SignalGraphDef = {
      id: 'vault',
      nodes: [{ id: 'gate-open', kind: 'lever', observed: true }],
      wires: [],
    };
    const graph = addSignalGraph(world, def);
    goals.add('gate', { signal: 'vault/gate-open' });
    steps(world, 2);
    expect(goals.met('gate')).toBe(false);
    setLever(world, graph, 'gate-open', true);
    steps(world, 1);
    expect(goals.met('gate')).toBe(true);
  });

  it('notices entities that appear and tags that are added', () => {
    const { world, goals } = setup();
    const lamp = world.spawn();
    addProperties(world, lamp, { burning: true });
    goals.add('g', allBurning);
    expect(goals.met('g')).toBe(false); // nothing tagged yet: `all` needs at least one entity
    tagEntity(world, lamp, 'brazier');
    steps(world, 1);
    expect(goals.met('g')).toBe(true);
    brazier(world); // a second, unlit brazier appears
    steps(world, 1);
    expect(goals.met('g')).toBe(false);
  });

  it('selects scene spawns by id and by their tags', () => {
    const { world, goals } = setup();
    const at = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const spawn = (id: string, tags: string[]) =>
      spawnSceneSpawn(world, 'testbed', { id, tags, position: at, rotation: rot } as never);
    const lever = spawn('room-lever', ['pull']);
    addProperties(world, lever, { burning: false });
    spawn('other', ['pull']);
    goals.add('by-id', {
      entities: { entity: 'room-lever' },
      where: [{ test: 'property', property: 'burning', op: 'eq', value: true }],
      match: 'any',
    });
    goals.add('by-tag-and-id', {
      entities: { tag: 'pull', entity: 'room-lever' },
      match: 'all',
    });
    expect(goals.met('by-id')).toBe(false);
    expect(goals.met('by-tag-and-id')).toBe(true);
    setProperty(world, lever, 'burning', true);
    steps(world, 1);
    expect(goals.met('by-id')).toBe(true);
  });

  it('counts the entities that pass, read from the same live reader', () => {
    const { world } = setup();
    const live = worldLiveReader(world);
    const lit = brazier(world, true);
    brazier(world);
    expect(live.select({ tag: 'brazier' })).toHaveLength(2);
    expect(live.passes(lit, [{ test: 'element', element: 'fire' }], undefined)).toBe(true);
    expect(
      compileCondition({
        entities: { tag: 'brazier' },
        where: [{ test: 'element', element: 'fire' }],
        gte: 1,
      }).evaluate(world.facts, live),
    ).toBe(true);
  });
});
