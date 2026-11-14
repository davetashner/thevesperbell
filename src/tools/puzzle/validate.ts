// The puzzle validator (mw-e15.6), `pnpm puzzle:validate [id]`: for every declared solution of a
// puzzle, the abstract layer (abstract.ts) proves the goal reachable for its capability set and the
// concrete layer (concrete.ts) runs its step list in the headless sim.
//
// A solution's verdict:
//   ok               reachable abstractly (minimum actions reported) and, where it ran, confirmed.
//   unreachable      the abstraction proves no sequence works (or the level lacks something the
//                    steps need) and the concrete run did not succeed either. A failure.
//   diverged         the concrete run left the script at a step (index shown) or the goal stayed
//                    false. A failure.
//   abstraction-gap  the abstraction says unreachable but the concrete run succeeded: the model is
//                    too pessimistic (a warning; the abstraction needs a rule).
//   inconclusive     the search stopped at its bound (states, depth or the time budget) or the goal /
//                    a capability has no abstract model, and nothing confirmed it. A warning.
// Softlocks (mw-e15.7): for each solution's capability set the abstract layer also searches the states
// reachable after something the puzzle lists is lost for good (burnt away, broken, pushed out of the
// level, melted) for one from which the goal cannot be reached. One that no recovery policy covers is
// a failure like an unreachable solution; one only a recovery removes is reported as covered.
// Shortcuts (a class-specific solution whose goal is also reachable with fewer capabilities) are
// informational. Failures of an `mvp` puzzle fail the run (exit 1): CI's puzzle-validate job.

import type { Frozen, GameContent, Puzzle as PuzzleDef, SceneDef } from '@content/index';

type Puzzle = Frozen<PuzzleDef>;
import {
  abstractPuzzle,
  capabilityElementsOf,
  checkSolution,
  DEFAULT_BOUNDS,
  findShortcut,
  findSoftlock,
  type AbstractResult,
  type CapabilityElements,
  type SearchBounds,
  type Shortcut,
  type SoftlockResult,
} from './abstract';
import type { ConcreteResult } from './concrete';

export type Verdict = 'ok' | 'unreachable' | 'diverged' | 'abstraction-gap' | 'inconclusive';

export interface SolutionReport {
  readonly id: string;
  readonly capabilities: readonly string[];
  readonly abstract: AbstractResult;
  readonly concrete: ConcreteResult | undefined;
  readonly shortcut: Shortcut | undefined;
  /** The softlock search (mw-e15.7): can something be lost for good so that the goal cannot be reached. */
  readonly softlock: SoftlockResult;
  readonly verdict: Verdict;
}

export interface PuzzleReport {
  readonly id: string;
  readonly mvp: boolean;
  readonly solutions: readonly SolutionReport[];
  /** Whether any solution is unreachable or diverged. */
  readonly failed: boolean;
}

export interface ValidateDeps {
  readonly capabilityElements: CapabilityElements;
  readonly bounds?: SearchBounds;
  /** Runs a declared step list headlessly; absent: the abstract layer only. */
  readonly concrete?: ((solution: Puzzle['solutions'][number]) => ConcreteResult) | undefined;
}

export function verdictOf(abstract: AbstractResult, concrete: ConcreteResult | undefined): Verdict {
  if (concrete?.status === 'diverged') return 'diverged';
  if (abstract.status === 'unreachable') {
    return concrete?.status === 'confirmed' ? 'abstraction-gap' : 'unreachable';
  }
  if (abstract.status === 'inconclusive') {
    return concrete?.status === 'confirmed' ? 'ok' : 'inconclusive';
  }
  return 'ok';
}

/** Validates every declared solution of `puzzle`, which lives in `scene` (prefabs expanded). */
export function validatePuzzle(
  puzzle: Puzzle,
  scene: Frozen<Pick<SceneDef, 'spawns'>>,
  deps: ValidateDeps,
): PuzzleReport {
  const abstract = abstractPuzzle(puzzle, scene, deps.capabilityElements);
  const bounds = deps.bounds ?? DEFAULT_BOUNDS;
  const solutions = puzzle.solutions.map((solution): SolutionReport => {
    const result = checkSolution(abstract, solution, bounds);
    const concrete = deps.concrete?.(solution);
    return {
      id: solution.id,
      capabilities: solution.capabilities,
      abstract: result,
      concrete,
      shortcut: findShortcut(abstract, solution, bounds),
      softlock: findSoftlock(abstract, solution.capabilities, bounds),
      verdict: verdictOf(result, concrete),
    };
  });
  return {
    id: puzzle.id,
    mvp: puzzle.tags.includes('mvp'),
    solutions,
    failed: solutions.some(
      (s) =>
        s.verdict === 'unreachable' || s.verdict === 'diverged' || s.softlock.status === 'softlock',
    ),
  };
}

const list = (items: readonly string[]) => (items.length === 0 ? 'none' : items.join(', '));

/** The report as text lines for the terminal and the CI log. */
export function formatReport(report: PuzzleReport): string[] {
  const lines = [`puzzle ${report.id}${report.mvp ? ' (mvp)' : ''}`];
  for (const s of report.solutions) {
    lines.push(`  ${s.verdict.toUpperCase()} ${s.id} [capabilities: ${list(s.capabilities)}]`);
    const a = s.abstract;
    if (a.status === 'reachable') {
      lines.push(`    abstract: goal reachable in ${String(a.steps)} action(s): ${list(a.path)}`);
    } else if (a.status === 'unreachable') {
      lines.push(
        a.missing.length > 0
          ? `    abstract: unreachable, the level lacks: ${a.missing.join('; ')}`
          : `    abstract: unreachable, no action sequence reaches the goal (${String(a.explored)} states searched)`,
      );
    } else {
      lines.push(`    abstract: inconclusive, ${a.reason} (${String(a.explored)} states)`);
    }
    const c = s.concrete;
    if (c?.status === 'confirmed')
      lines.push(`    concrete: goal true after ${String(c.ticks)} ticks`);
    if (c?.status === 'diverged') {
      lines.push(
        `    concrete: diverged${c.step === undefined ? '' : ` at step ${String(c.step)}`}: ${c.reason}`,
      );
    }
    if (s.verdict === 'abstraction-gap') {
      lines.push(
        '    warning: abstraction gap, the concrete run succeeded where the search found nothing',
      );
    }
    const k = s.softlock;
    if (k.status === 'softlock') {
      lines.push(
        `    SOFTLOCK: after ${k.path.join(', ')} (${k.lost.join(', ')} lost for good) no action reaches the goal; declare a recovery policy (respawn the entity, or mark it critical) in policy.recovery`,
      );
    } else if (k.status === 'covered') {
      lines.push(`    info: softlock avoided by recovery: ${k.by.join('; ')}`);
    } else if (k.status === 'inconclusive') {
      lines.push(`    softlock search: inconclusive, ${k.reason}`);
    }
    if (s.shortcut !== undefined) {
      lines.push(
        `    info: shortcut, the goal is also reachable in ${String(s.shortcut.steps)} action(s) with capabilities: ${list(s.shortcut.capabilities)}`,
      );
    }
  }
  return lines;
}

export interface ValidateIo {
  log(line: string): void;
  error(line: string): void;
  readonly content: Pick<GameContent, 'all'>;
  /** Runs a solution headlessly; undefined with `--abstract-only`. */
  readonly concrete?:
    ((puzzle: Puzzle, solution: Puzzle['solutions'][number]) => ConcreteResult) | undefined;
  /** Milliseconds clock for the time box. */
  readonly now: () => number;
}

/** Default time box per puzzle, milliseconds (the CI budget). */
export const TIME_BOX_MS = 10_000;

/** `pnpm puzzle:validate [id] [--abstract-only] [--time-box ms]`; the exit code. */
export function main(args: readonly string[], io: ValidateIo): number {
  const { spells, scenes, puzzles } = {
    spells: io.content.all('spell'),
    scenes: io.content.all('scene'),
    puzzles: io.content.all('puzzle'),
  };
  const flags = args.filter((a) => a.startsWith('--'));
  const ids = args.filter((a) => !a.startsWith('--'));
  const boxAt = flags.indexOf('--time-box');
  const wanted = ids.filter((id) => id !== args[args.indexOf('--time-box') + 1] || boxAt < 0);
  const timeBox = boxAt >= 0 ? Number(args[args.indexOf('--time-box') + 1]) : TIME_BOX_MS;
  const abstractOnly = flags.includes('--abstract-only');
  const chosen = wanted.length === 0 ? puzzles : puzzles.filter((p) => wanted.includes(p.id));
  const unknown = wanted.filter((id) => !puzzles.some((p) => p.id === id));
  const [first] = unknown;
  if (first !== undefined || !(timeBox > 0)) {
    io.error(
      first === undefined
        ? 'puzzle:validate: --time-box needs a positive number of milliseconds'
        : `puzzle:validate: no puzzle "${first}" (have: ${puzzles.map((p) => p.id).join(', ')})`,
    );
    return 2;
  }
  const capabilityElements = capabilityElementsOf(spells);
  const runConcrete = io.concrete;
  let broken = 0;
  for (const puzzle of chosen) {
    const scene = scenes.find((s) => s.id === puzzle.scene.id);
    if (scene === undefined) {
      io.error(`puzzle ${puzzle.id}: scene "${puzzle.scene.id}" is missing`);
      broken++;
      continue;
    }
    const began = io.now();
    const report = validatePuzzle(puzzle, scene, {
      capabilityElements,
      bounds: { ...DEFAULT_BOUNDS, timeBudgetMs: timeBox, now: io.now },
      concrete:
        abstractOnly || runConcrete === undefined
          ? undefined
          : (solution) => runConcrete(puzzle, solution),
    });
    formatReport(report).forEach((line) => {
      io.log(line);
    });
    io.log(`  (${String(Math.round(io.now() - began))} ms)`);
    // Every puzzle's breakage is shown; only an mvp puzzle (or one asked for by id) fails the run.
    if (report.failed && (report.mvp || wanted.length > 0)) broken++;
  }
  io.log(
    broken === 0
      ? `puzzle:validate: ${String(chosen.length)} puzzle(s) checked, no broken mvp solution`
      : `puzzle:validate: ${String(broken)} puzzle(s) with an unreachable, diverging or softlocking declared solution`,
  );
  return broken === 0 ? 0 : 1;
}
