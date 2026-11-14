import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { capabilityElementsOf } from './abstract';
import type { ConcreteResult } from './concrete';
import {
  CLASS_IDS,
  countDistinct,
  coverageOf,
  gateFailures,
  isValidated,
  profilesOf,
  puzzleSection,
  renderReport,
  renderSummary,
  solutionKey,
  solvers,
  type Profiles,
  type PuzzleCoverage,
} from './coverage';
import { lamp, puzzleWith, spawns } from './fixtures';
import { validatePuzzle } from './validate';

const content = loadGameContent();
const capabilityElements = capabilityElementsOf(content.all('spell'));
const confirmed: ConcreteResult = { status: 'confirmed', ticks: 10 };
const diverged: ConcreteResult = { status: 'diverged', reason: 'it did not burn' };

const cast = {
  id: 'cast',
  name: 'Cast',
  capabilities: ['spell.ember'],
  steps: [{ do: 'stimulus', element: 'heat', target: 'lamp', using: 'spell.ember' }],
};
const rope = {
  id: 'rope',
  name: 'Rope',
  capabilities: ['arrow.rope'],
  steps: [{ do: 'reach', target: 'lamp' }],
};
const plain = { id: 'plain', name: 'Plain', steps: [{ do: 'wait', seconds: 1 }] };

const profiles: Profiles = {
  knight: ['spell.ember'],
  archer: ['arrow.rope'],
  sorcerer: [],
  thief: ['tool.lockpick'],
};

/** Coverage of a fixture puzzle whose solutions all validate (the headless run is faked). */
function coverage(solutions: unknown[], tags: string[] = ['mvp'], prof = profiles) {
  const puzzle = puzzleWith({ tags, solutions });
  const report = validatePuzzle(puzzle, spawns(lamp), {
    capabilityElements,
    concrete: () => confirmed,
  });
  return coverageOf(puzzle, spawns(lamp), report, prof, capabilityElements);
}

describe('distinct solutions', () => {
  it('AC-3: two solutions with the same capability set and step list count as one', () => {
    const twin = { ...cast, id: 'twin', name: 'Twin' };
    const reordered = { ...cast, id: 'reordered', capabilities: ['spell.ember'] };
    const { solutions } = puzzleWith({ solutions: [cast, twin, reordered] });
    expect(new Set(solutions.map(solutionKey)).size).toBe(1);
    expect(countDistinct(solutions)).toBe(1);
    // A different step list, or a different capability set, is a different solution.
    const other = puzzleWith({ solutions: [cast, { ...cast, id: 'x', steps: plain.steps }] });
    expect(countDistinct(other.solutions)).toBe(2);
    const fewer = puzzleWith({
      solutions: [plain, { ...plain, id: 'y', capabilities: ['arrow.rope'] }],
    });
    expect(countDistinct(fewer.solutions)).toBe(2);
  });

  it('AC-3: counts them once when validating too, and ignores solutions that did not validate', () => {
    const twin = { ...cast, id: 'twin' };
    expect(coverage([cast, twin]).validated).toBe(1);
    expect(coverage([cast, twin]).declared).toBe(1);
    const puzzle = puzzleWith({ solutions: [cast, rope] });
    const report = validatePuzzle(puzzle, spawns(lamp), {
      capabilityElements,
      concrete: (solution) => (solution.id === 'rope' ? diverged : confirmed),
    });
    const result = coverageOf(puzzle, spawns(lamp), report, profiles, capabilityElements);
    expect([result.declared, result.validated]).toEqual([2, 1]);
  });

  it('accepts an ok verdict or an abstraction gap, not the rest', () => {
    expect(isValidated({ verdict: 'ok' })).toBe(true);
    expect(isValidated({ verdict: 'abstraction-gap' })).toBe(true);
    for (const verdict of ['unreachable', 'diverged', 'inconclusive'] as const) {
      expect(isValidated({ verdict })).toBe(false);
    }
  });
});

describe('per-class cells', () => {
  it('AC-1: decides yes, no and inconclusive for every class and for anyone', () => {
    const result = coverage([cast, rope]);
    expect(result.cells.knight).toEqual({
      solvable: 'yes',
      solution: 'cast',
      capabilities: ['spell.ember'],
      steps: 1,
      routes: 1,
    });
    expect(result.cells.archer).toMatchObject({ solvable: 'yes', solution: 'rope' });
    // Nothing fits and the search proves the lamp cannot be lit with no capability at all.
    expect(result.cells.sorcerer.solvable).toBe('no');
    expect(result.cells.any.solvable).toBe('no');
    // An unmodelled capability keeps the search from proving anything.
    expect(result.cells.thief).toEqual({ solvable: 'inconclusive' });
    expect(solvers(result)).toEqual(['knight', 'archer']);
  });

  it('picks the cheapest solution that fits: fewest capabilities, then fewest steps', () => {
    const longer = { ...plain, id: 'long', steps: [...plain.steps, ...plain.steps] };
    const both = { ...cast, id: 'both', capabilities: ['spell.ember', 'arrow.rope'] };
    const result = coverage([both, longer, plain, cast], ['mvp'], {
      ...profiles,
      knight: ['spell.ember', 'arrow.rope'],
    });
    expect(result.cells.knight).toMatchObject({ solution: 'plain', steps: 1, routes: 4 });
    const noPlain = coverage([both, cast], ['mvp'], {
      ...profiles,
      knight: ['spell.ember', 'arrow.rope'],
    });
    expect(noPlain.cells.knight).toMatchObject({ solution: 'cast', routes: 2 });
  });

  it('reads the profiles from the class content', () => {
    const shipped = profilesOf(content);
    expect(Object.keys(shipped)).toEqual([...CLASS_IDS]);
    expect(shipped.sorcerer).toContain('spell.mage-hand');
    expect(shipped.knight).not.toContain('spell.ember');
    expect(profilesOf({ all: () => [] }).thief).toEqual([]);
  });
});

describe('the gate', () => {
  it('AC-2: fails an mvp puzzle solvable by only 2 classes, naming it and the missing classes', () => {
    const result = coverage([cast, rope]);
    expect(gateFailures([result])).toEqual([
      'puzzle fixture: solvable by 2 of 4 classes at MVP capability levels, needs 3; missing: sorcerer, thief',
    ]);
  });

  it('fails an mvp puzzle with fewer than 2 distinct validated solutions', () => {
    const all = {
      knight: ['spell.ember'],
      archer: ['spell.ember'],
      sorcerer: ['spell.ember'],
      thief: ['spell.ember'],
    };
    const one = coverage([cast, { ...cast, id: 'twin' }], ['mvp'], all);
    expect(gateFailures([one])).toEqual([
      'puzzle fixture: 1 distinct validated solution(s), needs 2',
    ]);
    expect(
      gateFailures([coverage([cast, rope], ['mvp'], { ...all, archer: ['spell.ember'] })]),
    ).toEqual([]);
  });

  it('ignores puzzles that are not mvp', () => {
    expect(gateFailures([coverage([cast], [])])).toEqual([]);
  });
});

describe('the report', () => {
  const failing = coverage([cast, rope]);
  const passing: PuzzleCoverage = {
    ...coverage([plain, cast], ['mvp'], { ...profiles, sorcerer: [], thief: [] }),
    id: 'ok',
  };
  const everyone: Profiles = { knight: [], archer: [], sorcerer: [], thief: [] };

  it('lists the profiles, an overview row and a section per puzzle, with the gate result', () => {
    const text = renderReport([failing, passing], profiles);
    expect(text).toContain('Gate: FAILING.');
    expect(text).toContain('- puzzle fixture: solvable by 2 of 4 classes');
    expect(text).toContain('| knight | `spell.ember` |');
    expect(text).toContain('| sorcerer | none |');
    expect(text).toContain('| `fixture` | yes | 2 | 2 | yes | yes | no | inconclusive | no |');
    expect(text).toContain('## `fixture` (mvp)');
    expect(text).toContain('| knight | yes (cast) | `spell.ember` | 1 | 1 |');
    expect(text).toContain('| sorcerer | no | — | — | — |');
    expect(text.endsWith('\n')).toBe(true);
    expect(renderReport([passing], everyone)).toContain('Gate: passing.');
    expect(puzzleSection({ ...passing, mvp: false })).toContain('## `ok`\n');
  });

  it('summarises the gate and what changed from the committed report', () => {
    const before = renderReport([failing, passing], profiles);
    const same = renderSummary([failing, passing], before, before);
    expect(same).toContain('Gate FAILING:');
    expect(same).toContain('| `fixture` (mvp) | 2 | knight, archer |');
    expect(same).toContain('No change from the committed report.');
    const next = renderReport(
      [
        { ...passing, id: 'fresh' },
        { ...failing, declared: 5 },
      ],
      profiles,
    );
    const changed = renderSummary([failing], next, before);
    expect(changed).toContain('- `fixture`: changed');
    expect(changed).toContain('- `ok`: removed');
    const nobody = coverage([cast, rope], ['mvp'], everyone);
    const first = renderSummary([nobody], renderReport([nobody], everyone), undefined);
    expect(first).toContain('| `fixture` (mvp) | 2 | none |');
    expect(first).toContain('- `fixture`: new');
    expect(renderSummary([passing], renderReport([passing], everyone), undefined)).toContain(
      'Gate passing.',
    );
  });
});
