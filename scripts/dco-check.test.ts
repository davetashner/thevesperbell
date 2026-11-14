import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSignOffs, hasSignOff, main, parseCommits } from './dco-check.ts';

const SIGNED = 'Add a thing [mw-x]\n\nSigned-off-by: Dave Tashner <dave@example.com>\n';
const UNSIGNED = 'Add a thing [mw-x]\n\nNo trailer here.\n';
const record = (sha: string, message: string): string =>
  `${sha}\x1fDave\x1fdave@example.com\x1f${message}\x1e\n`;

describe('hasSignOff', () => {
  it('AC-2: accepts a Signed-off-by trailer with a name and an email', () => {
    expect(hasSignOff(SIGNED)).toBe(true);
    expect(hasSignOff(`${SIGNED}\nCo-Authored-By: Claude <noreply@anthropic.com>\n`)).toBe(true);
  });

  it('AC-2: rejects a missing, empty or malformed sign-off', () => {
    expect(hasSignOff(UNSIGNED)).toBe(false);
    expect(hasSignOff('x\n\nSigned-off-by: \n')).toBe(false);
    expect(hasSignOff('x\n\nSigned-off-by: Dave\n')).toBe(false);
    expect(hasSignOff('x\n\nSigned-off-by: Dave <not-an-email>\n')).toBe(false);
  });
});

describe('parseCommits', () => {
  it('splits records and keeps multi-line messages', () => {
    const commits = parseCommits(record('aaaa1111', SIGNED) + record('bbbb2222', UNSIGNED));
    expect(commits.map((c) => c.sha)).toEqual(['aaaa1111', 'bbbb2222']);
    expect(commits[0]?.authorName).toBe('Dave');
    expect(commits[0]?.authorEmail).toBe('dave@example.com');
    expect(commits[0]?.message).toBe(SIGNED);
  });

  it('returns nothing for an empty log and tolerates a truncated record', () => {
    expect(parseCommits('')).toEqual([]);
    expect(parseCommits('\n')).toEqual([]);
    expect(parseCommits('abc\x1e')[0]).toEqual({
      sha: 'abc',
      authorName: '',
      authorEmail: '',
      message: '',
    });
  });
});

describe('checkSignOffs', () => {
  const commits = parseCommits(record('aaaa1111bbbb', SIGNED) + record('cccc3333dddd', UNSIGNED));

  it('AC-2: names every unsigned commit', () => {
    const errors = checkSignOffs(commits, 'davetashner');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cccc3333');
    expect(errors[0]).toContain('git commit --amend -s');
  });

  it('passes when all commits are signed', () => {
    expect(checkSignOffs(commits.slice(0, 1), 'davetashner')).toEqual([]);
  });

  it('exempts Dependabot', () => {
    expect(checkSignOffs(commits, 'dependabot[bot]')).toEqual([]);
  });
});

describe('main', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function run(log: string | undefined, env: Record<string, string> = {}): [number, string] {
    const dir = mkdtempSync(join(tmpdir(), 'dco-'));
    dirs.push(dir);
    const path = join(dir, 'commits.txt');
    if (log !== undefined) writeFileSync(path, log);
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const code = main([path], env);
    return [code, out.mock.calls.map((c) => String(c[0])).join('\n')];
  }

  it('AC-2: fails with an error annotation when a commit is unsigned', () => {
    const [code, out] = run(record('aaaa1111', UNSIGNED));
    expect(code).toBe(1);
    expect(out).toContain('::error title=DCO::');
  });

  it('passes when every commit is signed', () => {
    const [code, out] = run(record('aaaa1111', SIGNED), { PR_AUTHOR: 'davetashner' });
    expect(code).toBe(0);
    expect(out).toContain('DCO check passed for 1 commit(s).');
  });

  it('fails when the list is unreadable or empty', () => {
    expect(run(undefined)[0]).toBe(2);
    expect(run('')[0]).toBe(2);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([], {})).toBe(2);
  });

  it('the CLI reads argv and the environment and sets the process exit code', async () => {
    const argv = process.argv;
    const dir = mkdtempSync(join(tmpdir(), 'dco-cli-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'commits.txt'), record('aaaa1111', SIGNED));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', 'dco-check-cli.ts', join(dir, 'commits.txt')];
    try {
      await import('./dco-check-cli.ts');
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
