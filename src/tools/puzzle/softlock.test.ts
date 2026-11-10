// mw-e15.7 AC-1: the softlock search (abstract.ts findSoftlock) over synthetic levels.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { abstractPuzzle, capabilityElementsOf, findSoftlock } from './abstract';
import { puzzleWith, spawns } from './fixtures';
import { formatReport, validatePuzzle } from './validate';

const content = loadGameContent();
const elements = capabilityElementsOf(content.all('spell'));

const plate = { id: 'plate', plate: { minWeight: 5 } };
const crateAt = (extra: Record<string, unknown> = {}) => ({
  id: 'crate',
  prop: 'crate',
  push: {},
  tags: ['crate'],
  ...extra,
});

/** A weighted-plate puzzle: the crate must end up on the plate. */
function plateAndCrate(options: { critical?: boolean; recovery?: object[]; goal?: object } = {}) {
  return puzzleWith({
    entities: [
      { id: 'plate', role: 'plate to weigh down' },
      { id: 'crate', role: 'the only crate', critical: options.critical ?? false },
    ],
    goal: options.goal ?? {
      entities: { entity: 'crate' },
      inside: { kind: 'sphere', center: { x: 4, y: 0, z: 0 }, radius: 1 },
      match: 'all',
    },
    solutions: [
      {
        id: 'push',
        name: 'Push the crate onto the plate',
        steps: [{ do: 'move', target: 'crate', to: 'plate' }],
      },
    ],
    policy: { repeatable: false, recovery: options.recovery ?? [] },
  });
}

const level = (crate: Record<string, unknown>) =>
  spawns({ ...plate, at: [4, 0, 0] }, crateAt(crate), {
    id: 'lamp',
    lightSource: { variant: 'brazier', unlit: true },
  });
const searchWith = (
  puzzle: ReturnType<typeof plateAndCrate>,
  crate: Record<string, unknown>,
  caps: string[] = [],
) => findSoftlock(abstractPuzzle(puzzle, level(crate), elements), caps);

describe('softlock search (mw-e15.7)', () => {
  it('AC-1: a weighted-plate puzzle whose only crate is flammable softlocks when the crate burns, unless a recovery policy exists', () => {
    const flammable = { properties: { flammable: true } };
    const result = searchWith(plateAndCrate({ critical: true }), flammable, ['spell.ember']);
    expect(result).toMatchObject({ status: 'softlock', lost: ['crate'] });
    expect(result.status === 'softlock' && result.path).toEqual(['heat crate', 'burn crate']);

    const respawned = plateAndCrate({
      critical: true,
      recovery: [{ kind: 'respawn', entity: 'crate', seconds: 10 }],
    });
    expect(searchWith(respawned, flammable, ['spell.ember'])).toMatchObject({
      status: 'covered',
      by: ['burn of crate', 'fall of crate'],
    });
  });

  it('a crate nothing can light cannot burn, and a critical one is returned if it falls', () => {
    const flammable = { properties: { flammable: true } };
    expect(searchWith(plateAndCrate({ critical: true }), flammable)).toMatchObject({
      status: 'covered',
      by: ['fall of crate'],
    });
  });

  it('a movable the puzzle needs that is not marked critical softlocks by falling out of the level', () => {
    const result = searchWith(plateAndCrate(), {});
    expect(result).toMatchObject({ status: 'softlock', lost: ['crate'], path: ['fall crate'] });
  });

  it('a recovery anchor covers a fall and a break, but not a burn', () => {
    const anchored = { recovery: [4, 0, 1], breakable: { profile: 'crate' } };
    expect(searchWith(plateAndCrate(), anchored)).toMatchObject({
      status: 'covered',
      by: ['break of crate', 'fall of crate'],
    });
    expect(
      searchWith(plateAndCrate(), { ...anchored, properties: { flammable: true } }, [
        'spell.ember',
      ]),
    ).toMatchObject({ status: 'softlock', path: ['heat crate', 'burn crate'] });
  });

  it('a breakable crate can be smashed, a frozen one melts under a flame', () => {
    const critical = plateAndCrate({ critical: true });
    expect(searchWith(critical, { breakable: { profile: 'crate' } })).toMatchObject({
      status: 'softlock',
      path: ['break crate'],
    });
    expect(searchWith(critical, { properties: { frozen: true } }, ['spell.ember'])).toMatchObject({
      status: 'softlock',
      path: ['melt crate'],
    });
    expect(searchWith(critical, { properties: { frozen: true } })).toMatchObject({
      status: 'covered',
    });
  });

  it('no loss of the entities a goal does not need softlocks it', () => {
    const lampGoal = puzzleWith({
      entities: [{ id: 'crate', role: 'a crate in the way' }],
    });
    expect(
      findSoftlock(abstractPuzzle(lampGoal, level({}), elements), ['spell.ember']),
    ).toMatchObject({ status: 'none' });
  });

  it('a goal out of reach from the start is the goal search’s finding, not a softlock', () => {
    const never = plateAndCrate({
      critical: true,
      goal: {
        entities: { entity: 'crate' },
        inside: { kind: 'sphere', center: { x: 40, y: 0, z: 0 }, radius: 1 },
        match: 'all',
      },
    });
    const moved = level({});
    const result = findSoftlock(abstractPuzzle(never, moved, elements), []);
    // The crate can be put on the plate (4, 0, 0) but never at x = 40.
    expect(result.status).not.toBe('softlock');
  });

  it('is inconclusive for an unmodelled capability or goal, and at its bounds', () => {
    const puzzle = plateAndCrate();
    const abstract = abstractPuzzle(puzzle, level({}), elements);
    expect(findSoftlock(abstract, ['spell.nope'])).toMatchObject({ status: 'inconclusive' });
    const facty = abstractPuzzle(
      plateAndCrate({ goal: { fact: 'a.b', eq: true } }),
      level({}),
      elements,
    );
    const factual = findSoftlock(facty, []);
    expect(factual.status).toBe('inconclusive');
    expect(factual.status === 'inconclusive' && factual.reason).toContain('fact, count and signal');
    expect(findSoftlock(abstract, [], { maxNodes: 2, maxDepth: 40 })).toMatchObject({
      status: 'inconclusive',
      reason: 'search bound of 2 states reached',
    });
    expect(findSoftlock(abstract, [], { maxNodes: 1000, maxDepth: 0 })).toMatchObject({
      status: 'inconclusive',
      reason: 'depth bound of 0 actions reached',
    });
    let clock = 0;
    expect(
      findSoftlock(abstract, [], {
        maxNodes: 1000,
        maxDepth: 40,
        timeBudgetMs: 5,
        now: () => (clock += 10),
      }),
    ).toMatchObject({ status: 'inconclusive', reason: 'time budget of 5 ms used up' });
  });

  it('the search with recovery declared can run out of room after the protected one passes', () => {
    const abstract = abstractPuzzle(plateAndCrate({ critical: true }), level({}), elements);
    const statuses = new Set<string>();
    for (let maxNodes = 2; maxNodes < 60; maxNodes++) {
      statuses.add(findSoftlock(abstract, [], { maxNodes, maxDepth: 40 }).status);
    }
    expect([...statuses].sort()).toEqual(['covered', 'inconclusive']);
  });

  it('a reset policy covers no loss of an entity', () => {
    const reset = plateAndCrate({
      recovery: [{ kind: 'reset', trigger: 'plate' }],
    });
    expect(searchWith(reset, {})).toMatchObject({ status: 'softlock', path: ['fall crate'] });
  });

  it('the validator fails a puzzle with a softlock and says how to fix it, and passes it once recovery is declared', () => {
    const bare = validatePuzzle(plateAndCrate(), level({}), { capabilityElements: elements });
    expect(bare.failed).toBe(true);
    expect(formatReport(bare).join('\n')).toContain(
      'SOFTLOCK: after fall crate (crate lost for good)',
    );
    const safe = validatePuzzle(plateAndCrate({ critical: true }), level({}), {
      capabilityElements: elements,
    });
    expect(safe.failed).toBe(false);
    expect(formatReport(safe).join('\n')).toContain('softlock avoided by recovery: fall of crate');
  });
});
