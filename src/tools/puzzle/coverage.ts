// The per-class solution coverage audit (mw-e15.8): "problems support multiple solutions" and "classes
// change possibilities" (CONSTITUTION §2) made measurable. For every puzzle and for each of the four
// classes (plus "any": no capability at all) it says whether the puzzle is solvable, from the validator's
// verdicts (validate.ts) and the classes' capability profiles at the MVP progression milestone
// (`mvpCapabilities` in src/content/data/class/).
//
// How a cell is decided:
//   yes           some declared solution that validated (verdict ok, or abstraction-gap: the headless run
//                 confirmed it) needs only capabilities the profile holds. The cell names the cheapest
//                 such solution (fewest capabilities, then fewest steps): the minimum capability set.
//   no            no validated solution fits and the abstract search (abstract.ts) proves the goal
//                 unreachable for exactly the profile's capabilities.
//   inconclusive  neither: the search stopped at its bound, or the goal or a capability has no abstract
//                 model (most goals read signals, and techniques, arrows and tools are unmodelled).
// Two declared solutions with the same capability set and the same step list count as one (AC-3).
//
// The gate (`gateFailures`): every mvp puzzle needs at least MIN_DISTINCT_SOLUTIONS distinct validated
// solutions and must be solvable ("yes") by at least MIN_CLASSES of the four classes. Encounter-level
// route audits are mw-e16.

import type { Frozen, GameContent, Puzzle as PuzzleDef, SceneDef } from '@content/index';
import {
  abstractPuzzle,
  DEFAULT_BOUNDS,
  searchGoal,
  type CapabilityElements,
  type SearchBounds,
} from './abstract';
import type { PuzzleReport, SolutionReport } from './validate';

type Puzzle = Frozen<PuzzleDef>;
type Solution = Puzzle['solutions'][number];

/** The four classes, in the order the report lists them. */
export const CLASS_IDS = ['knight', 'archer', 'sorcerer', 'thief'] as const;
export type ClassId = (typeof CLASS_IDS)[number];
/** The report's columns: the classes, then anyone (no capabilities). */
export const COLUMNS = [...CLASS_IDS, 'any'] as const;
export type Column = (typeof COLUMNS)[number];

/** Distinct validated solutions an mvp puzzle needs. */
export const MIN_DISTINCT_SOLUTIONS = 2;
/** Classes of four that must solve an mvp puzzle. */
export const MIN_CLASSES = 3;

export type Solvable = 'yes' | 'no' | 'inconclusive';

export type Cell =
  | { readonly solvable: 'no' | 'inconclusive' }
  | {
      readonly solvable: 'yes';
      /** The cheapest validated solution that fits. */
      readonly solution: string;
      /** Its capability set: the minimum the cell needs. */
      readonly capabilities: readonly string[];
      /** Its declared step count. */
      readonly steps: number;
      /** How many distinct validated solutions the profile can use. */
      readonly routes: number;
    };

export interface PuzzleCoverage {
  readonly id: string;
  readonly mvp: boolean;
  /** Distinct declared solutions (capability set + step list). */
  readonly declared: number;
  /** Distinct declared solutions that validated. */
  readonly validated: number;
  readonly cells: Readonly<Record<Column, Cell>>;
}

/** A class's capability profile at the MVP milestone. */
export type Profiles = Readonly<Record<ClassId, readonly string[]>>;

/** The solutions' identity for counting: capability set and step list (AC-3). */
export function solutionKey(solution: Pick<Solution, 'capabilities' | 'steps'>): string {
  return JSON.stringify([[...solution.capabilities].sort(), solution.steps]);
}

/** How many of `solutions` are distinct. */
export function countDistinct(solutions: readonly Pick<Solution, 'capabilities' | 'steps'>[]) {
  return new Set(solutions.map(solutionKey)).size;
}

/** A solution counts as validated when its verdict is ok, or the headless run confirmed it. */
export function isValidated(report: Pick<SolutionReport, 'verdict'>): boolean {
  return report.verdict === 'ok' || report.verdict === 'abstraction-gap';
}

/** The class profiles from the loaded content. */
export function profilesOf(content: Pick<GameContent, 'all'>): Profiles {
  const classes = content.all('class');
  const of = (id: ClassId) => classes.find((c) => c.id === id)?.mvpCapabilities ?? [];
  return {
    knight: of('knight'),
    archer: of('archer'),
    sorcerer: of('sorcerer'),
    thief: of('thief'),
  };
}

/** The coverage of one puzzle from its validation `report`. */
export function coverageOf(
  puzzle: Puzzle,
  scene: Frozen<Pick<SceneDef, 'spawns'>>,
  report: PuzzleReport,
  profiles: Profiles,
  capabilityElements: CapabilityElements,
  bounds: SearchBounds = DEFAULT_BOUNDS,
): PuzzleCoverage {
  const abstract = abstractPuzzle(puzzle, scene, capabilityElements);
  const passed = puzzle.solutions.filter((_, i) => {
    const solution = report.solutions[i];
    return solution !== undefined && isValidated(solution);
  });
  const cell = (profile: readonly string[]): Cell => {
    const fits = passed
      .filter((s) => s.capabilities.every((c) => profile.includes(c)))
      .sort(
        (a, b) => a.capabilities.length - b.capabilities.length || a.steps.length - b.steps.length,
      );
    const [best] = fits;
    if (best !== undefined) {
      return {
        solvable: 'yes',
        solution: best.id,
        capabilities: best.capabilities,
        steps: best.steps.length,
        routes: countDistinct(fits),
      };
    }
    const found = searchGoal(abstract, profile, bounds);
    return { solvable: found.status === 'unreachable' ? 'no' : 'inconclusive' };
  };
  return {
    id: puzzle.id,
    mvp: report.mvp,
    declared: countDistinct(puzzle.solutions),
    validated: countDistinct(passed),
    cells: {
      knight: cell(profiles.knight),
      archer: cell(profiles.archer),
      sorcerer: cell(profiles.sorcerer),
      thief: cell(profiles.thief),
      any: cell([]),
    },
  };
}

/** The classes that solve the puzzle. */
export function solvers(coverage: PuzzleCoverage): ClassId[] {
  return CLASS_IDS.filter((id) => coverage.cells[id].solvable === 'yes');
}

/** One line per mvp puzzle that breaks the rule, naming the puzzle and what is missing (AC-2). */
export function gateFailures(coverages: readonly PuzzleCoverage[]): string[] {
  const failures: string[] = [];
  for (const coverage of coverages.filter((c) => c.mvp)) {
    if (coverage.validated < MIN_DISTINCT_SOLUTIONS) {
      failures.push(
        `puzzle ${coverage.id}: ${String(coverage.validated)} distinct validated solution(s), needs ${String(MIN_DISTINCT_SOLUTIONS)}`,
      );
    }
    const solving = solvers(coverage);
    if (solving.length < MIN_CLASSES) {
      const missing = CLASS_IDS.filter((id) => !solving.includes(id));
      failures.push(
        `puzzle ${coverage.id}: solvable by ${String(solving.length)} of ${String(CLASS_IDS.length)} classes at MVP capability levels, needs ${String(MIN_CLASSES)}; missing: ${missing.join(', ')}`,
      );
    }
  }
  return failures;
}

/** The table row of one column: who, solvable, minimum capability set, steps, routes. */
function cellRow(column: Column, cell: Cell): string {
  if (cell.solvable !== 'yes') return `| ${column} | ${cell.solvable} | — | — | — |`;
  const capabilities =
    cell.capabilities.length === 0 ? 'none' : `\`${cell.capabilities.join('`, `')}\``;
  return `| ${column} | yes (${cell.solution}) | ${capabilities} | ${String(cell.steps)} | ${String(cell.routes)} |`;
}

/** One puzzle's section of the report; also the unit the PR summary diffs. */
export function puzzleSection(coverage: PuzzleCoverage): string {
  const rows = COLUMNS.map((column) => cellRow(column, coverage.cells[column]));
  return [
    `## \`${coverage.id}\`${coverage.mvp ? ' (mvp)' : ''}`,
    '',
    `Distinct declared solutions: ${String(coverage.declared)}; validated: ${String(coverage.validated)}; solvable by ${String(solvers(coverage).length)} of 4 classes.`,
    '',
    '| Who | Solvable | Minimum capability set | Steps | Routes |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** The generated report, docs/design/puzzle-coverage.md. */
export function renderReport(coverages: readonly PuzzleCoverage[], profiles: Profiles): string {
  const failures = gateFailures(coverages);
  const list = (ids: readonly string[]) => (ids.length === 0 ? 'none' : `\`${ids.join('`, `')}\``);
  return [
    '# Puzzle solution coverage',
    '',
    '<!-- Generated by `pnpm puzzle:coverage --write` (mw-e15.8); CI checks it is current. Do not edit. -->',
    '',
    `"Problems support multiple solutions" and "classes change possibilities" (CONSTITUTION §2), measured. For every puzzle, whether each class can solve it with the capabilities it has at the MVP progression milestone, and \`any\`: with none at all. The rule, enforced in CI for puzzles tagged \`mvp\`: at least ${String(MIN_DISTINCT_SOLUTIONS)} distinct validated solutions, and solvable by at least ${String(MIN_CLASSES)} of the 4 classes.`,
    '',
    "- **yes**: a declared solution that validated (the solver's abstract search and the headless run of its steps, see [puzzles](puzzles.md)) needs only capabilities the class holds. The minimum capability set is the cheapest such solution (fewest capabilities, then fewest steps); routes is how many distinct validated solutions the class can use.",
    '- **no**: no validated solution fits and the abstract search proves the goal unreachable with exactly those capabilities.',
    '- **inconclusive**: neither. Most goals read signals and techniques, arrows and tools have no abstract model, so the search cannot prove a "no".',
    '- Two solutions with the same capability set and step list count as one. A solution that did not validate does not count.',
    '- Encounter-level route audits are out of scope (mw-e16).',
    '',
    `Gate: ${failures.length === 0 ? 'passing' : 'FAILING'}.`,
    ...failures.map((f) => `- ${f}`),
    '',
    '## Class capability profiles at the MVP milestone',
    '',
    'From `mvpCapabilities` in `src/content/data/class/<class>.json`: what the class starts with plus the first trainer, book and tool unlocks the slice offers.',
    '',
    '| Class | Capabilities |',
    '| --- | --- |',
    ...CLASS_IDS.map((id) => `| ${id} | ${list(profiles[id])} |`),
    '',
    '## Overview',
    '',
    `| Puzzle | mvp | Distinct solutions | Validated | ${COLUMNS.join(' | ')} |`,
    `| --- | --- | --- | --- | ${COLUMNS.map(() => '---').join(' | ')} |`,
    ...coverages.map(
      (c) =>
        `| \`${c.id}\` | ${c.mvp ? 'yes' : 'no'} | ${String(c.declared)} | ${String(c.validated)} | ${COLUMNS.map((column) => c.cells[column].solvable).join(' | ')} |`,
    ),
    '',
    ...coverages.flatMap((c) => [puzzleSection(c), '']),
  ]
    .join('\n')
    .replace(/\n+$/, '\n');
}

/** The sections of a rendered report by puzzle id (for the summary's diff). */
function sectionsOf(report: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of report.split(/^(?=## `)/m)) {
    const id = /^## `([^`]+)`/.exec(part)?.[1];
    if (id !== undefined) sections.set(id, part.trim());
  }
  return sections;
}

/**
 * The PR summary (GitHub step summary): the gate, then which puzzles' coverage differs from the
 * committed report `before` (undefined: none committed).
 */
export function renderSummary(
  coverages: readonly PuzzleCoverage[],
  after: string,
  before: string | undefined,
): string {
  const failures = gateFailures(coverages);
  const next = sectionsOf(after);
  const prev = sectionsOf(before ?? '');
  const changes = [...next.keys()].flatMap((id) => {
    if (!prev.has(id)) return [`- \`${id}\`: new`];
    return prev.get(id) === next.get(id) ? [] : [`- \`${id}\`: changed`];
  });
  for (const id of prev.keys()) if (!next.has(id)) changes.push(`- \`${id}\`: removed`);
  return [
    '### Puzzle coverage',
    '',
    failures.length === 0 ? 'Gate passing.' : 'Gate FAILING:',
    ...failures.map((f) => `- ${f}`),
    '',
    '| Puzzle | Distinct validated | Classes solving |',
    '| --- | --- | --- |',
    ...coverages.map(
      (c) =>
        `| \`${c.id}\`${c.mvp ? ' (mvp)' : ''} | ${String(c.validated)} | ${solvers(c).join(', ') || 'none'} |`,
    ),
    '',
    changes.length === 0
      ? 'No change from the committed report.'
      : `Changed from the committed report:\n${changes.join('\n')}`,
    '',
  ].join('\n');
}
