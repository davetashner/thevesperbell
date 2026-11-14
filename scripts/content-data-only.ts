// Data-only proof (mw-e15.9 AC-3): a content item built with the puzzle kit must change no engine
// code. Given the files a diff changes, this lists the ones that are source code under src/: any
// .ts or .tsx file there. Content data (src/content/data/**, JSON) is allowed, and so is everything
// outside src/ (tests, scripts, docs, e2e). Test files inside src/ (*.test.ts, *.test.tsx) are
// allowed too: they are not engine code, and the two scene inventory tests list every scene by name,
// so any new scene touches them (see mw-e15.9's follow-up bead to derive those lists from content).
import { execFileSync } from 'node:child_process';

const SOURCE = /^src\/.*\.tsx?$/;
const TEST = /\.test\.tsx?$/;

/** The changed files that are source code under src/ (tests and data excluded). */
export function sourceChanges(files: readonly string[]): string[] {
  return files.filter((file) => SOURCE.test(file) && !TEST.test(file));
}

/** The changed files that are tests under src/ (reported so a reviewer sees them). */
export function testChanges(files: readonly string[]): string[] {
  return files.filter((file) => SOURCE.test(file) && TEST.test(file));
}

/** The files `git diff` says changed between `base` and the working tree's HEAD. */
export function changedFiles(base: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  return out.split('\n').filter((line) => line !== '');
}

/**
 * `content-data-only <base>` checks the diff against `base`; `content-data-only --files a b …`
 * checks an explicit list. Exit 1 lists the source files that changed.
 */
export function main(
  args: readonly string[],
  log: (line: string) => void = console.log,
  diff: (base: string) => string[] = changedFiles,
): number {
  const [first, ...rest] = args;
  if (first === undefined) {
    log('usage: pnpm content:data-only <base-ref> | pnpm content:data-only --files <file>…');
    return 2;
  }
  const files = first === '--files' ? rest : diff(first);
  const bad = sourceChanges(files);
  const tests = testChanges(files);
  if (tests.length > 0) log(`note: test files under src/ changed: ${tests.join(', ')}`);
  if (bad.length > 0) {
    log(`not data-only: ${String(bad.length)} source file(s) under src/ changed:`);
    for (const file of bad) log(`  ${file}`);
    return 1;
  }
  log(`data-only: ${String(files.length)} changed file(s), no source code under src/`);
  return 0;
}
