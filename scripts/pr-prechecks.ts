// Local pre-push gate (mw-e41.30): the mechanical misses that kept failing CI (no sign-off, stray
// .beads edits, missing CHANGELOG line, prettier, stale generated content, shard table, unknown
// Closes ids). Pure checks live here; scripts/pr-prechecks-cli.ts is the thin CLI. It complements
// `pnpm lint:changed` and `pnpm typecheck`; it never runs lint, tests or typecheck.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkChangelog, CHANGELOG_PATH, NO_CHANGELOG_LABEL } from './changelog-check.ts';
import { knownIds, lintPrBody, NO_BEAD_LABEL } from './pr-body-lint.ts';

export interface Failure {
  check: string;
  message: string;
  fix: string;
}

export interface Commit {
  sha: string;
  body: string;
}

export interface ChangedFile {
  /** git name-status letter: A, M, D, R... */
  status: string;
  path: string;
}

export interface Options {
  lead: boolean;
  noChangelog: boolean;
}

/** Every commit ahead of origin/main needs a Signed-off-by trailer (DCO). */
export function checkSignoff(commits: readonly Commit[]): Failure[] {
  return commits
    .filter((c) => !/^Signed-off-by: .+/m.test(c.body))
    .map((c) => ({
      check: 'sign-off',
      message: `commit ${c.sha.slice(0, 8)} has no Signed-off-by line`,
      fix: 'git rebase origin/main --signoff   (new commits: git commit -s)',
    }));
}

/** Workers never touch .beads/; the lead (--lead) may. */
export function checkBeadsEdits(files: readonly ChangedFile[], lead: boolean): Failure[] {
  if (lead) return [];
  const touched = files.filter((f) => f.path.startsWith('.beads/')).map((f) => f.path);
  if (touched.length === 0) return [];
  return [
    {
      check: 'beads',
      message: `workers must not edit .beads/ (${touched.join(', ')})`,
      fix: 'git checkout origin/main -- .beads   (the lead owns the export; the lead runs pnpm prechecks --lead)',
    },
  ];
}

/** Player-facing paths need a CHANGELOG.md change, reusing changelog-check's rules. */
export function checkChangelogNote(
  files: readonly ChangedFile[],
  changelog: string | undefined,
  noChangelog: boolean,
): Failure[] {
  const result = checkChangelog({
    files: files.map((f) => f.path),
    labels: noChangelog ? [NO_CHANGELOG_LABEL] : [],
    author: '',
    changelog,
  });
  return result.errors.map((message) => ({
    check: 'changelog',
    message,
    fix: `add a line under "## [Unreleased]" in ${CHANGELOG_PATH}, or pass --no-changelog and label the PR ${NO_CHANGELOG_LABEL}`,
  }));
}

/** Files prettier should check: everything changed that still exists. */
export function prettierTargets(files: readonly ChangedFile[]): string[] {
  return files.filter((f) => f.status !== 'D').map((f) => f.path);
}

export function contentTypesChanged(files: readonly ChangedFile[]): boolean {
  return files.some((f) => f.path.startsWith('src/content/types/'));
}

export function e2eSpecsAddedOrRemoved(files: readonly ChangedFile[]): boolean {
  return files.some(
    (f) =>
      /^e2e\/.*\.spec\.ts$/.test(f.path) && (f.status.startsWith('A') || f.status.startsWith('D')),
  );
}

/** Every Closes id must exist in the branch's .beads/issues.jsonl. */
export function checkClosesIds(body: string, jsonl: string): Failure[] {
  const result = lintPrBody({ body, author: '', labels: [NO_BEAD_LABEL] }, knownIds(jsonl));
  return result.errors.map((message) => ({
    check: 'closes',
    message,
    fix: 'fix the id in the PR body; for a bead created since the last export, ask the lead to add a fresh `bd export -o .beads/issues.jsonl`',
  }));
}

/** Parses `git diff --name-status` output (renames count as an add of the new path). */
export function parseNameStatus(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const [status = '', ...paths] = line.split('\t');
    const path = paths[paths.length - 1];
    if (path !== undefined) files.push({ status: status.startsWith('R') ? 'A' : status, path });
  }
  return files;
}

export function parseArgs(argv: readonly string[]): Options & { body?: string; error?: string } {
  const opts: Options & { body?: string; error?: string } = { lead: false, noChangelog: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lead') opts.lead = true;
    else if (arg === '--no-changelog') opts.noChangelog = true;
    else if (arg === '--body') {
      const value = argv[++i];
      if (value === undefined) opts.error = '--body needs a file path';
      else opts.body = value;
    } else opts.error = `unknown argument ${String(arg)}`;
  }
  return opts;
}

function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Runs every check against HEAD vs origin/main; returns the exit code (0 pass, 1 failures, 2 usage). */
export function main(argv: readonly string[]): number {
  const opts = parseArgs(argv);
  if (opts.error !== undefined) {
    console.log(`${opts.error}\nusage: pnpm prechecks [--lead] [--no-changelog] [--body <file>]`);
    return 2;
  }
  const base = sh('git', ['merge-base', 'HEAD', 'origin/main']);
  if (!base.ok) {
    console.log('cannot find origin/main; run: git fetch origin main');
    return 2;
  }
  const mergeBase = base.out.trim();
  const failures: Failure[] = [];

  const log = sh('git', ['log', '--no-merges', '--format=%H%x00%B%x01', `${mergeBase}..HEAD`]).out;
  const commits = log
    .split('\x01')
    .map((e) => e.trim())
    .filter((e) => e !== '')
    .map((e) => {
      const [sha = '', body = ''] = e.split('\x00');
      return { sha, body };
    });
  failures.push(...checkSignoff(commits));

  const files = parseNameStatus(sh('git', ['diff', '--name-status', `${mergeBase}..HEAD`]).out);
  failures.push(...checkBeadsEdits(files, opts.lead));
  failures.push(...checkChangelogNote(files, readOptional(CHANGELOG_PATH), opts.noChangelog));

  const targets = prettierTargets(files);
  if (targets.length > 0) {
    const r = sh('pnpm', ['exec', 'prettier', '--check', '--ignore-unknown', ...targets]);
    if (!r.ok) {
      failures.push({
        check: 'prettier',
        message: r.out
          .split('\n')
          .filter((l) => l.startsWith('[warn]') && !l.includes('Code style issues'))
          .join('\n'),
        fix: 'pnpm exec prettier --write <the files above>',
      });
    }
  }

  if (contentTypesChanged(files)) {
    if (!sh('node', ['scripts/content-schemas-cli.ts', '--check']).ok) {
      failures.push({
        check: 'content-schemas',
        message: 'generated content schemas are stale',
        fix: 'pnpm content:schemas',
      });
    }
    if (!sh('node', ['scripts/content-docs-cli.ts', '--check']).ok) {
      failures.push({
        check: 'content-docs',
        message: 'generated content docs are stale',
        fix: 'pnpm content:docs',
      });
    }
  }

  if (e2eSpecsAddedOrRemoved(files) && !sh('node', ['scripts/e2e-shards-cli.ts', 'check']).ok) {
    failures.push({
      check: 'shards',
      message: 'e2e/shards.json does not match the e2e specs',
      fix: 'pnpm e2e:shards:check shows the diff; add or remove the spec in e2e/shards.json',
    });
  }

  if (opts.body !== undefined) {
    const body = readOptional(opts.body);
    const jsonl = readOptional('.beads/issues.jsonl') ?? '';
    if (body === undefined) {
      failures.push({
        check: 'closes',
        message: `cannot read ${opts.body}`,
        fix: 'check the --body path',
      });
    } else {
      failures.push(...checkClosesIds(body, jsonl));
    }
  }

  for (const f of failures) {
    console.log(`FAIL [${f.check}] ${f.message}\n  fix: ${f.fix}`);
  }
  if (failures.length === 0) {
    console.log(
      `prechecks passed (${String(commits.length)} commit(s), ${String(files.length)} file(s))`,
    );
    return 0;
  }
  return 1;
}
