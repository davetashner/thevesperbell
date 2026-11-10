// pnpm puzzle:coverage (mw-e15.8), run through scripts/puzzle-coverage-cli.ts, which loads this file
// through Vite (path aliases, extensionless imports, Rapier's wasm). See coverage.ts for the rules.

import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent, type GameContent } from '@content/index';
import { capabilityElementsOf, DEFAULT_BOUNDS } from './abstract';
import { runSolution } from './concrete';
import {
  coverageOf,
  gateFailures,
  profilesOf,
  renderReport,
  renderSummary,
  type PuzzleCoverage,
} from './coverage';
import { validatePuzzle } from './validate';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where the generated report lives, relative to the repository root (the working directory). */
export const REPORT_PATH = 'docs/design/puzzle-coverage.md';

export const USAGE = `Usage: pnpm puzzle:coverage [--write] [--check] [--summary] [--base <file>] [--out <file>]

Validates every puzzle (abstract search, then the headless run of each declared solution) and works
out which of the four classes can solve it with their MVP-milestone capabilities. Prints the gate
result and exits 1 when an mvp puzzle has fewer than 2 distinct validated solutions or is solvable by
fewer than 3 of 4 classes.
  --write    write the report to ${REPORT_PATH}
  --check    exit 1 when the committed report is not what would be generated
  --summary  print a markdown summary (for $GITHUB_STEP_SUMMARY), including what changed
  --base     with --summary, diff against this report (CI: the base branch's) instead of the committed one
  --out      the report file to write or check (default ${REPORT_PATH})`;

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  content(): GameContent;
  readonly rapier: typeof RAPIER;
  /** The file's text, or undefined when it does not exist. */
  readFile(path: string): string | undefined;
  writeFile(path: string, text: string): void;
}

export const defaultIo: CliIo = {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  content: loadGameContent,
  rapier: RAPIER,
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
};

/** The coverage of every puzzle in `content`, each run headlessly. */
export function auditContent(content: GameContent, rapier: typeof RAPIER) {
  const capabilityElements = capabilityElementsOf(content.all('spell'));
  const profiles = profilesOf(content);
  const coverages: PuzzleCoverage[] = content.all('puzzle').map((puzzle) => {
    const scene = content.resolve(puzzle.scene);
    const report = validatePuzzle(puzzle, scene, {
      capabilityElements,
      bounds: DEFAULT_BOUNDS,
      concrete: (solution) => runSolution(rapier, content, puzzle, solution),
    });
    return coverageOf(puzzle, scene, report, profiles, capabilityElements);
  });
  return { coverages, profiles, text: renderReport(coverages, profiles) };
}

/** The exit code of `pnpm puzzle:coverage <args>`. */
export function main(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes('--help') || args.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  const option = (flag: string, fallback: string): string | undefined => {
    const at = args.indexOf(flag);
    const value = at >= 0 ? args[at + 1] : fallback;
    return value === undefined || value.startsWith('--') ? undefined : value;
  };
  const out = option('--out', REPORT_PATH);
  const base = option('--base', '');
  if (out === undefined || base === undefined) {
    io.error('puzzle:coverage: --out and --base need a file path');
    return 2;
  }
  const { coverages, text } = auditContent(io.content(), io.rapier);
  const committed = io.readFile(out);
  let code = 0;
  const failures = gateFailures(coverages);
  for (const failure of failures) io.error(failure);
  if (failures.length > 0) code = 1;
  if (args.includes('--write')) {
    io.writeFile(out, text);
    io.log(`puzzle:coverage: wrote ${out}`);
  } else if (args.includes('--check') && committed !== text) {
    io.error(`puzzle:coverage: ${out} is out of date; run pnpm puzzle:coverage --write`);
    code = 1;
  }
  if (args.includes('--summary'))
    io.log(renderSummary(coverages, text, base === '' ? committed : io.readFile(base)));
  if (code === 0) io.log(`puzzle:coverage: ${String(coverages.length)} puzzle(s), gate passing`);
  return code;
}
