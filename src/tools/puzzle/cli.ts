// pnpm puzzle:validate (mw-e15.6), run through scripts/puzzle-validate-cli.ts, which loads this file
// through Vite (path aliases, extensionless imports, Rapier's wasm). See validate.ts for the verdicts.

import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent, type GameContent } from '@content/index';
import { runSolution } from './concrete';
import { main as validate, TIME_BOX_MS } from './validate';

export const USAGE = `Usage: pnpm puzzle:validate [puzzle-id…] [--abstract-only] [--time-box <ms>]

Proves every declared puzzle solution reachable: a bounded abstract search for its capability set,
then its step list executed in the headless sim. Exits 1 when an mvp puzzle (or one named) has an
unreachable or diverging solution. --abstract-only skips the headless runs; --time-box is the budget
per puzzle in milliseconds (default ${String(TIME_BOX_MS)}).`;

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
  now(): number;
  content(): GameContent;
  readonly rapier: typeof RAPIER;
}

export const defaultIo: CliIo = {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  now: () => performance.now(),
  content: loadGameContent,
  rapier: RAPIER,
};

/** The exit code of `pnpm puzzle:validate <args>`. */
export function main(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes('--help') || args.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  const content = io.content();
  const rapier = args.includes('--abstract-only') ? undefined : io.rapier;
  return validate(args, {
    log: (line) => {
      io.log(line);
    },
    error: (line) => {
      io.error(line);
    },
    now: () => io.now(),
    content,
    concrete:
      rapier === undefined
        ? undefined
        : (puzzle, solution) => runSolution(rapier, content, puzzle, solution),
  });
}
