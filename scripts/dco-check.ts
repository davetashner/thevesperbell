// DCO check (mw-e00.22): every commit a PR adds carries a `Signed-off-by: Name <email>` trailer
// (`git commit -s`). Run in CI through scripts/dco-check-cli.ts with the PR's commits on stdin-free
// input: a file written by `git log --no-merges --format=%H%x1f%an%x1f%ae%x1f%B%x1e <base>..<head>`.
import { readFileSync } from 'node:fs';
import { EXEMPT_AUTHORS } from './pr-body-lint.ts';

export interface CommitInfo {
  sha: string;
  authorName: string;
  authorEmail: string;
  message: string;
}

const SIGNOFF = /^Signed-off-by:[ \t]+\S.*<[^<>\s]+@[^<>\s]+>[ \t]*$/m;

/** Whether the commit message has a well-formed Signed-off-by trailer line. */
export function hasSignOff(message: string): boolean {
  return SIGNOFF.test(message);
}

/** Parses the `%H%x1f%an%x1f%ae%x1f%B%x1e` log format used in CI. */
export function parseCommits(log: string): CommitInfo[] {
  return log
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha = '', authorName = '', authorEmail = '', ...rest] = record.split('\x1f');
      return { sha, authorName, authorEmail, message: rest.join('\x1f') };
    });
}

/** One error per commit without a sign-off; bot commits from exempt authors are skipped. */
export function checkSignOffs(commits: readonly CommitInfo[], prAuthor: string): string[] {
  if (EXEMPT_AUTHORS.includes(prAuthor)) return [];
  return commits
    .filter((c) => !hasSignOff(c.message))
    .map(
      (c) =>
        `Commit ${c.sha.slice(0, 8)} by ${c.authorName} has no Signed-off-by line. ` +
        'Amend it with `git commit --amend -s` (or `git rebase --signoff origin/main`) and push ' +
        'the branch again.',
    );
}

/**
 * argv: `<commits.txt>`; PR_AUTHOR comes from the environment. Returns the exit code: 0 pass,
 * 1 unsigned commits, 2 unreadable list or no commits.
 */
export function main(argv: readonly string[], env: Record<string, string | undefined>): number {
  let log: string;
  try {
    log = readFileSync(argv[0] ?? '', 'utf8');
  } catch {
    console.log('::error title=DCO::Cannot read the commit list.');
    return 2;
  }
  const commits = parseCommits(log);
  if (commits.length === 0) {
    console.log('::error title=DCO::The PR has no commits to check.');
    return 2;
  }
  const errors = checkSignOffs(commits, env['PR_AUTHOR'] ?? '');
  for (const e of errors) console.log(`::error title=DCO::${e}`);
  if (errors.length === 0) console.log(`DCO check passed for ${String(commits.length)} commit(s).`);
  return errors.length > 0 ? 1 : 0;
}
