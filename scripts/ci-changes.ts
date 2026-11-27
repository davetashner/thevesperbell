// CI change classifier (mw-e41.4): which parts of the per-PR pipeline a diff can affect. Docs, backlog
// and site PRs cannot break the e2e shards or the build, so they skip them; scripts-only PRs still run
// lint, types and the coverage gate (scripts/**/*.ts has a 100% threshold) but not the browser jobs.
// Required checks stay green through always-running aggregators in ci.yml, never through a workflow
// path filter, because a required check that is never created blocks merging. Run in CI through
// scripts/ci-changes-cli.ts with the PR's changed paths in a file. Unknown paths run everything.
import { readFileSync } from 'node:fs';

/**
 * `light`: nothing in the pipeline reads it. `unit`: only lint, types, tests, coverage and the
 * content validators can notice it. `full`: it may change the app, so everything runs.
 */
export type ChangeClass = 'light' | 'unit' | 'full';

export interface CiPlan {
  /** Run lint, typecheck, the coverage shards and gate, and the content validators. */
  unit: boolean;
  /** Run the browser and release jobs: e2e shards, playthrough, build and size-budget. */
  app: boolean;
}

const FULL_PLAN: CiPlan = { unit: true, app: true };

/** Backlog data, plan files, the public site and the changelog: no test or build reads them. */
const LIGHT: readonly RegExp[] = [/^\.beads\//, /^plan\//, /^site\//, /^CHANGELOG\.md$/];
/**
 * Docs and scripts are read by unit tests (generated docs, link checks, economy tables) and the
 * validators, so those still run; the app never imports them.
 */
const UNIT: readonly RegExp[] = [/^docs\//, /^scripts\//, /^[^/]+\.md$/];

const RANK: Record<ChangeClass, number> = { light: 0, unit: 1, full: 2 };

/** The class of one repo-relative path. Anything not listed is `full`. */
export function classifyPath(path: string): ChangeClass {
  const p = path.replace(/^\.\//, '');
  if (LIGHT.some((re) => re.test(p))) return 'light';
  if (UNIT.some((re) => re.test(p))) return 'unit';
  return 'full';
}

/** The jobs a set of changed paths needs. No paths at all (an empty or odd diff) runs everything. */
export function planFor(paths: readonly string[]): CiPlan {
  if (paths.length === 0) return { ...FULL_PLAN };
  let top: ChangeClass = 'light';
  for (const path of paths) {
    const c = classifyPath(path);
    if (RANK[c] > RANK[top]) top = c;
  }
  return { unit: top !== 'light', app: top === 'full' };
}

/** Changed paths from the text of a `git diff --name-only` listing. */
export function parsePaths(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** The `key=value` lines GitHub Actions appends to $GITHUB_OUTPUT. */
export function formatOutputs(plan: CiPlan): string {
  return `unit=${String(plan.unit)}\napp=${String(plan.app)}\n`;
}

/**
 * CLI body: prints the outputs and returns the exit code. Only pull requests are narrowed; pushes to
 * main and manual runs always run the full pipeline, and so does a missing or unreadable list.
 */
export function main(argv: readonly string[], env: Record<string, string | undefined>): number {
  let plan: CiPlan = { ...FULL_PLAN };
  if (env['GITHUB_EVENT_NAME'] === 'pull_request') {
    try {
      plan = planFor(parsePaths(readFileSync(argv[0] ?? '', 'utf8')));
    } catch {
      console.error(
        '::warning title=ci-changes::changed-files list unreadable; running the full pipeline.',
      );
    }
  }
  console.log(formatOutputs(plan).trimEnd());
  return 0;
}
