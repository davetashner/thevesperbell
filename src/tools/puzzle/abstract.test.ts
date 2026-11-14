import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  abstractPuzzle,
  capabilityElementsOf,
  checkSolution,
  findShortcut,
  searchGoal,
} from './abstract';
import { lamp, puzzleWith, spawns } from './fixtures';

const content = loadGameContent();
const elements = capabilityElementsOf(content.all('spell'));
const abstractOf = (puzzle = puzzleWith(), scene = spawns(lamp)) =>
  abstractPuzzle(puzzle, scene, elements);
const solutionOf = (puzzle: Parameters<typeof abstractPuzzle>[0], id: string) => {
  const solution = puzzle.solutions.find((s) => s.id === id);
  if (solution === undefined) throw new Error(id);
  return solution;
};

const barrel = { id: 'barrel', prop: 'barrel', properties: { burning: true, fuel: 900 } };
const crate = (id: string) => ({ id, prop: 'crate', push: {} });
const plate = { id: 'plate', plate: { minWeight: 5 } };

describe('capability elements', () => {
  it('reads the elements a spell emits and counts a tether as force', () => {
    expect(elements.get('spell.ember')).toEqual(['heat']);
    expect(elements.get('spell.mage-hand')).toEqual(['force']);
  });
});

describe('the abstract search (mw-e15.6)', () => {
  it('AC-1: a brazier puzzle whose solution needs a fire spell is reachable, with its minimum step count', () => {
    const braziers = content.all('puzzle').find((p) => p.id === 'brazier-hall');
    const hall = content.all('scene').find((s) => s.id === 'brazier-hall');
    if (braziers === undefined || hall === undefined) throw new Error('brazier-hall');
    const abstract = abstractPuzzle(braziers, hall, elements);
    const cast = checkSolution(abstract, solutionOf(braziers, 'fire-from-range'));
    expect(cast).toEqual({
      status: 'reachable',
      steps: 3,
      path: ['heat brazier-west', 'heat brazier-north', 'heat brazier-east'],
    });
    const carry = checkSolution(abstract, solutionOf(braziers, 'carry-flame'));
    expect(carry).toMatchObject({ status: 'reachable', steps: 3 });
  });

  it('a goal already true needs no actions, and a fire spell cannot light what is not lit-able', () => {
    const abstract = abstractOf(
      puzzleWith({
        goal: {
          entities: { entity: 'lamp' },
          where: [{ test: 'element', element: 'fire' }],
          match: 'any',
        },
      }),
      spawns({ ...lamp, lightSource: { variant: 'brazier' } }),
    );
    expect(searchGoal(abstract, [])).toEqual({ status: 'reachable', steps: 0, path: [] });
    const stone = abstractOf(puzzleWith(), spawns({ id: 'lamp' }));
    expect(searchGoal(stone, ['spell.ember'])).toMatchObject({ status: 'unreachable' });
  });

  it('AC-2: a solution that needs a crate the level does not contain is unreachable, naming what is missing', () => {
    const puzzle = puzzleWith({
      entities: [
        { id: 'plate', role: 'plate to weigh down' },
        { id: 'crate', role: 'crate' },
      ],
      goal: {
        entities: { entity: 'crate' },
        inside: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 1 },
        match: 'all',
      },
      solutions: [
        {
          id: 'push-crate',
          name: 'Push the crate onto the plate',
          steps: [{ do: 'move', target: 'crate', to: 'plate' }],
        },
        { id: 'wait', name: 'Wait', steps: [{ do: 'wait', seconds: 1 }] },
      ],
    });
    const abstract = abstractOf(puzzle, spawns(plate));
    const result = checkSolution(abstract, solutionOf(puzzle, 'push-crate'));
    expect(result).toEqual({
      status: 'unreachable',
      missing: ['step 1 (move): the level has no entity "crate"'],
      explored: 0,
    });
  });

  it('a thing that cannot be moved, and a missing destination, are reported as missing', () => {
    const puzzle = puzzleWith({
      entities: [
        { id: 'statue', role: 'statue' },
        { id: 'plate', role: 'plate' },
        { id: 'ledge', role: 'ledge' },
      ],
      solutions: [
        {
          id: 'shove',
          name: 'Shove',
          steps: [
            { do: 'move', target: 'statue', to: 'plate' },
            { do: 'move', target: 'player', to: 'ledge' },
            { do: 'reach', target: 'plate' },
          ],
        },
      ],
    });
    const result = checkSolution(
      abstractOf(puzzle, spawns(plate, { id: 'statue' })),
      puzzle.solutions[0] as never,
    );
    expect(result).toMatchObject({ status: 'unreachable' });
    expect(result.status === 'unreachable' ? result.missing : []).toEqual([
      'step 1 (move): "statue" cannot be moved (no prop, push rule or pushable property)',
      'step 2 (move): the level has no entity "ledge"',
    ]);
  });

  it('AC-3: a goal that needs no capability is a shortcut around a class-specific solution', () => {
    const puzzle = puzzleWith();
    const scene = spawns(lamp, barrel);
    const abstract = abstractOf(puzzle, scene);
    expect(findShortcut(abstract, solutionOf(puzzle, 'cast'))).toEqual({
      capabilities: [],
      steps: 1,
    });
    // Without a flame to carry, only the spell lights the lamp: no shortcut.
    expect(
      findShortcut(abstractOf(puzzle, spawns(lamp)), solutionOf(puzzle, 'cast')),
    ).toBeUndefined();
  });

  it('a solution of two capabilities may be a shortcut with one, and one that needs none has no shortcut', () => {
    const puzzle = puzzleWith({
      solutions: [
        {
          id: 'both',
          name: 'Both',
          capabilities: ['spell.mage-hand', 'spell.ember'],
          steps: [{ do: 'stimulus', element: 'heat', target: 'lamp', using: 'spell.ember' }],
        },
        { id: 'free', name: 'Free', steps: [{ do: 'wait', seconds: 1 }] },
      ],
    });
    const abstract = abstractOf(puzzle, spawns(lamp));
    expect(findShortcut(abstract, solutionOf(puzzle, 'both'))).toEqual({
      capabilities: ['spell.ember'],
      steps: 1,
    });
    expect(findShortcut(abstract, solutionOf(puzzle, 'free'))).toBeUndefined();
  });

  it('a crate put on a plate is where the goal sees it', () => {
    const crates = puzzleWith({
      entities: [
        { id: 'plate', role: 'plate' },
        { id: 'crate-a', role: 'crate' },
      ],
      goal: {
        all: [
          {
            entities: { entity: 'crate-a' },
            inside: {
              kind: 'box',
              center: { x: 4, y: 0, z: 0 },
              halfExtents: { x: 1, y: 1, z: 1 },
            },
            match: 'all',
          },
          { entities: { tag: 'crate' }, where: [{ test: 'tag', tag: 'crate' }], gte: 1 },
          {
            not: {
              entities: { entity: 'crate-a' },
              where: [{ test: 'tag', tag: 'other' }],
              match: 'any',
            },
          },
        ],
      },
      solutions: [
        { id: 'push', name: 'Push', steps: [{ do: 'move', target: 'crate-a', to: 'plate' }] },
      ],
    });
    const far = spawns({ ...plate, at: [4, 0, 0] }, { ...crate('crate-a'), tags: ['crate'] });
    expect(searchGoal(abstractOf(crates, far), [])).toMatchObject({
      status: 'reachable',
      steps: 1,
      path: ['move crate-a to plate'],
    });
  });

  it('counts: operators compare how many entities pass', () => {
    const puzzle = puzzleWith({
      goal: {
        entities: { tag: 'lit-lamp' },
        where: [{ test: 'element', element: 'fire' }],
        gte: 2,
      },
    });
    const two = spawns(
      { ...lamp, tags: ['lit-lamp'] },
      { ...lamp, id: 'lamp-2', tags: ['lit-lamp'] },
    );
    expect(searchGoal(abstractOf(puzzle, two), ['spell.ember'])).toMatchObject({ steps: 2 });
    const none = puzzleWith({
      goal: { entities: { tag: 'lit-lamp' }, lt: 1, where: [{ test: 'element', element: 'fire' }] },
    });
    expect(searchGoal(abstractOf(none, two), [])).toMatchObject({ steps: 0 });
    const noOperator = puzzleWith({ goal: { entities: { tag: 'lit-lamp' }, match: 'any' } });
    expect(searchGoal(abstractOf(noOperator, two), [])).toMatchObject({ steps: 0 });
  });

  it.each([
    ['eq', 1, 1],
    ['neq', 0, 1],
    ['gt', 0, 1],
    ['gte', 1, 1],
    ['lt', 1, 0],
    ['lte', 0, 0],
  ])('a count with %s %i is reached after %i action(s)', (op, bound, steps) => {
    const puzzle = puzzleWith({
      goal: {
        entities: { tag: 'lit-lamp' },
        [op]: bound,
        where: [{ test: 'element', element: 'fire' }],
      },
    });
    const scene = spawns(
      { ...lamp, tags: ['lit-lamp'] },
      { ...lamp, id: 'second', tags: ['lit-lamp'] },
    );
    expect(searchGoal(abstractOf(puzzle, scene), ['spell.ember'])).toMatchObject({ steps });
  });

  it('a lit property is read like the fire element, and a placed thing is where it was put', () => {
    const burning = puzzleWith({
      goal: {
        entities: { entity: 'lamp' },
        where: [{ test: 'property', property: 'burning', op: 'eq', value: false }],
        match: 'all',
      },
    });
    expect(searchGoal(abstractOf(burning, spawns(lamp)), [])).toMatchObject({ steps: 0 });
    const facing = puzzleWith({
      goal: {
        entities: { entity: 'lamp' },
        where: [{ test: 'facing', facing: 'north' }],
        match: 'all',
      },
    });
    expect(searchGoal(abstractOf(facing, spawns(lamp)), [])).toMatchObject({
      status: 'inconclusive',
      reason: expect.stringContaining('"facing" predicate') as string,
    });
  });

  it('a sphere volume, and any / none matches, are read from the goal', () => {
    const sphere = (match: string, x: number) =>
      puzzleWith({
        entities: [{ id: 'spot', role: 'spot' }],
        goal: {
          entities: { entity: 'lamp' },
          inside: { kind: 'sphere', center: { x, y: 0, z: 0 }, radius: 1 },
          match,
        },
      });
    const scene = spawns(lamp, { id: 'spot', at: [5, 0, 0] });
    expect(searchGoal(abstractOf(sphere('any', 0), scene), [])).toMatchObject({ steps: 0 });
    expect(searchGoal(abstractOf(sphere('none', 5), scene), [])).toMatchObject({ steps: 0 });
    expect(searchGoal(abstractOf(sphere('any', 5), scene), [])).toMatchObject({
      status: 'unreachable', // the lamp cannot be carried to the spot
    });
    const either = puzzleWith({
      goal: {
        any: [
          {
            entities: { entity: 'lamp' },
            where: [{ test: 'element', element: 'fire' }],
            match: 'all',
          },
          { entities: { entity: 'lamp' }, where: [{ test: 'tag', tag: 'nope' }], match: 'none' },
        ],
      },
    });
    expect(searchGoal(abstractOf(either, spawns(lamp)), [])).toMatchObject({ steps: 0 });
    const sustained = puzzleWith({
      goal: { sustained: { entities: { entity: 'lamp' }, match: 'any' }, seconds: 2 },
    });
    expect(searchGoal(abstractOf(sustained, spawns(lamp)), [])).toMatchObject({ steps: 0 });
  });

  it('unmodelled goals and capabilities are inconclusive, not unreachable', () => {
    expect(searchGoal(abstractOf(puzzleWith({ goal: { fact: 'x.y' } })), [])).toMatchObject({
      status: 'inconclusive',
      reason: expect.stringContaining('fact, count and signal') as string,
    });
    const wet = puzzleWith({
      goal: {
        entities: { entity: 'lamp' },
        where: [{ test: 'element', element: 'water' }],
        match: 'all',
      },
    });
    expect(searchGoal(abstractOf(wet), [])).toMatchObject({ status: 'inconclusive' });
    const capsule = puzzleWith({
      goal: {
        entities: { entity: 'lamp' },
        inside: {
          kind: 'capsule',
          from: { x: 0, y: 0, z: 0 },
          to: { x: 0, y: 1, z: 0 },
          radius: 1,
        },
        match: 'all',
      },
    });
    expect(searchGoal(abstractOf(capsule), [])).toMatchObject({ status: 'inconclusive' });
    expect(searchGoal(abstractOf(), ['verb.climb.ledge'])).toMatchObject({
      status: 'inconclusive',
      reason: 'capability "verb.climb.ledge" has no abstract model',
    });
    const cold = capabilityElementsOf([
      {
        id: 'frost',
        delivery: { kind: 'projectile' },
        effects: [{ op: 'stimulus', element: 'cold' }, { op: 'noise' }],
      },
    ]);
    expect(
      searchGoal(abstractPuzzle(puzzleWith(), spawns(lamp), cold), ['spell.frost']),
    ).toMatchObject({ status: 'inconclusive' });
  });

  it('AC-5: a state space past the node bound stops there and reports inconclusive', () => {
    const things = Array.from({ length: 8 }, (_, i) => `crate-${String(i)}`);
    const puzzle = puzzleWith({
      entities: [
        { id: 'plate', role: 'plate' },
        { id: 'spot', role: 'spot' },
        ...things.map((id) => ({ id, role: 'crate' })),
      ],
      goal: {
        entities: { entity: 'lamp' },
        where: [{ test: 'element', element: 'fire' }],
        match: 'all',
      },
      solutions: [
        { id: 'push', name: 'Push', steps: [{ do: 'move', target: 'crate-0', to: 'plate' }] },
      ],
    });
    const scene = spawns(
      plate,
      { id: 'spot' },
      { ...lamp, lightSource: { variant: 'brazier', unlit: true } },
      ...things.map(crate),
    );
    const abstract = abstractOf(puzzle, scene);
    const started = Date.now();
    const result = searchGoal(abstract, [], { maxNodes: 5000, maxDepth: 40 });
    expect(result).toMatchObject({ status: 'inconclusive', explored: 5000 });
    expect(result.status === 'inconclusive' ? result.reason : '').toContain('5000');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('AC-5: the time budget stops a search by the clock it is given, and the depth bound stops a deep one', () => {
    const things = Array.from({ length: 6 }, (_, i) => crate(`crate-${String(i)}`));
    const scene = spawns(plate, { id: 'spot' }, { ...lamp }, ...things);
    const puzzle = puzzleWith({
      entities: [
        { id: 'plate', role: 'plate' },
        { id: 'spot', role: 'spot' },
        ...things.map(({ id }) => ({ id, role: 'crate' })),
      ],
    });
    const abstract = abstractOf(puzzle, scene);
    let clock = 0;
    const timed = searchGoal(abstract, [], {
      maxNodes: 1_000_000,
      maxDepth: 40,
      timeBudgetMs: 10,
      now: () => (clock += 4),
    });
    expect(timed).toMatchObject({ status: 'inconclusive', reason: 'time budget of 10 ms used up' });
    const shallow = searchGoal(abstract, [], { maxNodes: 1_000_000, maxDepth: 2 });
    expect(shallow).toMatchObject({
      status: 'inconclusive',
      reason: 'depth bound of 2 actions reached',
    });
  });

  it('a clock with no budget never stops the search, and an exhausted space is unreachable', () => {
    const abstract = abstractOf(puzzleWith(), spawns(lamp));
    const result = searchGoal(abstract, [], { maxNodes: 100, maxDepth: 5, now: () => 0 });
    expect(result).toMatchObject({ status: 'unreachable', missing: [] });
  });
});
