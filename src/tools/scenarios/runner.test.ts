import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { loadScenarios } from './files';
import { runScenario, ScenarioFailure } from './runner';
import type { Scenario, ScenarioOutcome } from './schema';

vi.setConfig({ testTimeout: 120_000 });

const HASH = 'f00dfacef00dface';
const found = loadScenarios().find((s) => s.id === 'burning-straw-releases-plate');
if (found === undefined) throw new Error('no burning-straw-releases-plate scenario');
const bale: Scenario = found;

const outcome = (
  o: Partial<ScenarioOutcome> & Pick<ScenarioOutcome, 'reading' | 'op' | 'value'>,
) => ({
  tick: 400,
  target: { spawn: 'combo-burden-crate' },
  sees: 'whatever the player sees',
  ...o,
});

/** The bale scenario with these outcomes; returns the failure's problems (empty when they hold). */
function problemsOf(outcomes: ScenarioOutcome[], extra: Partial<Scenario> = {}): string[] {
  try {
    runScenario(
      RAPIER,
      { ...bale, outcomes, ticks: 401, ...extra },
      { contentHash: HASH, bless: true },
    );
    return [];
  } catch (error) {
    if (error instanceof ScenarioFailure) return [...error.problems];
    throw error;
  }
}

describe('scenario runner (mw-e03.27)', () => {
  it('reads properties, plates and existence, and every comparison', () => {
    expect(
      problemsOf([
        outcome({ reading: 'alive', op: 'eq', value: false }),
        outcome({ tick: 20, reading: 'alive', op: 'ne', value: false }),
        outcome({ tick: 20, reading: 'material', op: 'eq', value: 'straw' }),
        outcome({ tick: 20, reading: 'weight', op: 'gt', value: 5 }),
        outcome({ tick: 20, reading: 'weight', op: 'gte', value: 12 }),
        outcome({ tick: 20, reading: 'weight', op: 'lt', value: 13 }),
        outcome({ tick: 20, reading: 'weight', op: 'lte', value: 12 }),
        outcome({
          tick: 20,
          target: { spawn: 'combo-plate-burden' },
          reading: 'plate.active',
          op: 'eq',
          value: true,
        }),
        outcome({
          tick: 20,
          target: { spawn: 'combo-plate-burden' },
          reading: 'plate.weight',
          op: 'gte',
          value: 5,
        }),
        outcome({ tick: 20, reading: 'position.y', op: 'lt', value: 1 }),
      ]),
    ).toEqual([]);
  });

  it('reports a gone entity, a missing plate and a missing body in the failure', () => {
    const problems = problemsOf([
      outcome({ reading: 'burning', op: 'eq', value: true }),
      outcome({ tick: 20, reading: 'plate.active', op: 'eq', value: true }),
      outcome({ tick: 20, reading: 'plate.weight', op: 'eq', value: 1 }),
      outcome({
        tick: 20,
        target: { spawn: 'combo-rope' },
        reading: 'position.y',
        op: 'eq',
        value: 1,
      }),
    ]);
    expect(problems).toHaveLength(4);
    expect(problems.filter((p) => p.includes('got "no plate"'))).toHaveLength(2);
    expect(problems.filter((p) => p.includes('got "no body"'))).toHaveLength(1);
    expect(problems.filter((p) => p.includes('got "gone"'))).toHaveLength(1);
  });

  it('judges a tag by any or all of its spawns, and an unknown tag never holds', () => {
    const ident = (which: 'any' | 'all', value: number) =>
      outcome({ tick: 20, target: { tag: 'ident', which }, reading: 'weight', op: 'gt', value });
    expect(problemsOf([ident('any', 5), ident('all', 5)])).toEqual([]);
    expect(problemsOf([ident('all', 1e6)])[0]).toContain('of ident');
    expect(
      problemsOf([{ ...ident('any', 5), target: { tag: 'no-such-tag', which: 'any' } }]),
    ).toHaveLength(1);
  });

  it('runs blasts and property sets as scripted inputs, at a point or at a spawn', () => {
    const problems = problemsOf(
      [
        outcome({
          tick: 60,
          target: { spawn: 'fire-crate-1' },
          reading: 'hp',
          op: 'eq',
          value: 50,
        }),
      ],
      {
        setup: {
          props: 'the fire station',
          properties: [{ target: 'fire-crate-1', property: 'hp', value: 100 }],
        },
        inputs: [
          { tick: 10, blast: { at: [-10, 0.35, 3], radius: 1, intensity: 50 } },
          { tick: 12, blast: { at: 'fire-crate-2', radius: 1, intensity: 50 } },
          { tick: 14, set: { target: 'fire-crate-1', property: 'hp', value: 50 } },
        ],
      },
    );
    expect(problems).toEqual([]);
  });

  it('names an unknown spawn and a spawn with no position', () => {
    const base = { ...bale, outcomes: [outcome({ reading: 'alive', op: 'eq', value: false })] };
    const run = (scenario: Scenario) => () =>
      runScenario(RAPIER, scenario, { contentHash: HASH, bless: true });
    expect(
      run({
        ...base,
        setup: {
          props: 'none',
          properties: [{ target: 'nothing-here', property: 'hp', value: 1 }],
        },
      }),
    ).toThrow(/no spawn "nothing-here"/);
    expect(
      run({
        ...base,
        inputs: [
          { tick: 10, stimulus: { element: 'heat', at: 'player-start', radius: 1, intensity: 5 } },
        ],
      }),
    ).toThrow(/"player-start" has no position/);
  });

  it('AC-1: a golden that no longer matches fails naming the scenario, and bless accepts it', () => {
    const golden = { finalHash: '00000000' };
    expect(() => runScenario(RAPIER, { ...bale, golden }, { contentHash: HASH })).toThrow(
      new RegExp(`"${bale.id}" failed: .*not the golden 00000000`, 's'),
    );
    expect(
      runScenario(RAPIER, { ...bale, golden }, { contentHash: HASH, bless: true }).finalHash,
    ).toBe(bale.golden.finalHash);
    expect(runScenario(RAPIER, bale, { contentHash: HASH }).finalHash).toBe(bale.golden.finalHash);
  });

  it('fails when its own recording does not replay', () => {
    const play = vi.fn(
      () =>
        ({
          status: 'diverged',
          divergence: {
            tick: 7,
            expectedHash: 'aaaaaaaa',
            actualHash: 'bbbbbbbb',
            difference: undefined,
          },
        }) as const,
    );
    expect(() => runScenario(RAPIER, bale, { contentHash: HASH, play })).toThrow(/did not replay/);
  });
});
