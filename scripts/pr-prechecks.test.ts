import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkBeadsEdits,
  checkChangelogNote,
  checkClosesIds,
  checkSignoff,
  contentTypesChanged,
  e2eSpecsAddedOrRemoved,
  parseArgs,
  parseNameStatus,
  prettierTargets,
  main,
} from './pr-prechecks.ts';

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
vi.mock('node:fs', () => ({ readFileSync: mocks.readFileSync }));

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n- Something.\n';
const JSONL = '{"id":"mw-e1.1"}\n';

describe('pr-prechecks', () => {
  it('AC-1: sign-off fails with its fix hint', () => {
    const f = checkSignoff([
      { sha: 'abcdef123456', body: 'feat: x\n\nSigned-off-by: A <a@b.c>' },
      { sha: '123456abcdef', body: 'feat: y' },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('123456ab');
    expect(f[0]?.fix).toContain('--signoff');
  });

  it('AC-1: .beads edits fail for workers with a fix hint', () => {
    const f = checkBeadsEdits([{ status: 'M', path: '.beads/issues.jsonl' }], false);
    expect(f).toHaveLength(1);
    expect(f[0]?.fix).toContain('git checkout origin/main -- .beads');
  });

  it('AC-1: a player-facing change without CHANGELOG fails, --no-changelog allows it', () => {
    const files = [{ status: 'M', path: 'src/ui/hud.ts' }];
    const f = checkChangelogNote(files, CHANGELOG, false);
    expect(f).toHaveLength(1);
    expect(f[0]?.fix).toContain('--no-changelog');
    expect(checkChangelogNote(files, CHANGELOG, true)).toEqual([]);
    expect(
      checkChangelogNote([...files, { status: 'M', path: 'CHANGELOG.md' }], CHANGELOG, false),
    ).toEqual([]);
  });

  it('AC-1: content, shard and prettier triggers read the changed files', () => {
    expect(contentTypesChanged([{ status: 'M', path: 'src/content/types/item.ts' }])).toBe(true);
    expect(contentTypesChanged([{ status: 'M', path: 'src/content/data/a.json' }])).toBe(false);
    expect(e2eSpecsAddedOrRemoved([{ status: 'A', path: 'e2e/new.spec.ts' }])).toBe(true);
    expect(e2eSpecsAddedOrRemoved([{ status: 'D', path: 'e2e/old.spec.ts' }])).toBe(true);
    expect(e2eSpecsAddedOrRemoved([{ status: 'M', path: 'e2e/old.spec.ts' }])).toBe(false);
    expect(
      prettierTargets([
        { status: 'M', path: 'a.ts' },
        { status: 'D', path: 'b.ts' },
      ]),
    ).toEqual(['a.ts']);
  });

  it('AC-1: an unknown Closes id fails with a fix hint', () => {
    const f = checkClosesIds('Closes mw-nope.1\n', JSONL);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]?.check).toBe('closes');
    expect(f[0]?.fix).toContain('bd export');
  });

  it('AC-2: a clean branch passes every pure check', () => {
    const files = [{ status: 'M', path: 'scripts/foo.ts' }];
    expect(checkSignoff([{ sha: 'a', body: 'x\n\nSigned-off-by: A <a@b.c>' }])).toEqual([]);
    expect(checkBeadsEdits(files, false)).toEqual([]);
    expect(checkChangelogNote(files, CHANGELOG, false)).toEqual([]);
    expect(checkClosesIds('Closes mw-e1.1\n', JSONL)).toEqual([]);
  });

  it('AC-3: --lead allows .beads edits', () => {
    expect(checkBeadsEdits([{ status: 'M', path: '.beads/issues.jsonl' }], true)).toEqual([]);
    expect(parseArgs(['--lead']).lead).toBe(true);
  });

  it('parses name-status and flags', () => {
    expect(parseNameStatus('A\tx.ts\nR090\told.ts\tnew.ts\n\n')).toEqual([
      { status: 'A', path: 'x.ts' },
      { status: 'A', path: 'new.ts' },
    ]);
    expect(parseArgs(['--no-changelog', '--body', 'b.md'])).toEqual({
      lead: false,
      noChangelog: true,
      body: 'b.md',
    });
    expect(parseArgs(['--body']).error).toBeDefined();
    expect(parseArgs(['--wat']).error).toContain('--wat');
  });
});

const SIGNED = 'Signed-off-by: A <a@b.c>';

interface World {
  /** `git log` output */
  log?: string;
  /** `git diff --name-status` output */
  diff?: string;
  mergeBaseOk?: boolean;
  /** commands (joined) that exit non-zero, mapped to their output */
  failing?: Record<string, string>;
  /** files readFileSync can read; anything else throws */
  files?: Record<string, string>;
}

function world(w: World): string[] {
  const ran: string[] = [];
  mocks.spawnSync.mockImplementation((cmd: string, args: string[]) => {
    const key = [cmd, ...args].join(' ');
    ran.push(key);
    const fail = Object.entries(w.failing ?? {}).find(([k]) => key.includes(k));
    if (fail) return { status: 1, stdout: fail[1], stderr: '' };
    if (key.startsWith('git merge-base')) {
      return { status: w.mergeBaseOk === false ? 1 : 0, stdout: 'base123\n', stderr: '' };
    }
    if (key.startsWith('git log')) return { status: 0, stdout: w.log ?? '', stderr: '' };
    if (key.startsWith('git diff')) return { status: 0, stdout: w.diff ?? '', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  });
  mocks.readFileSync.mockImplementation((path: string) => {
    const text = w.files?.[path];
    if (text === undefined) throw new Error('ENOENT');
    return text;
  });
  return ran;
}

const goodLog = `abc123\0feat: x\n\n${SIGNED}\n\x01`;

describe('pr-prechecks main', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((m: unknown) => {
      out.push(String(m));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.spawnSync.mockReset();
    mocks.readFileSync.mockReset();
  });

  it('AC-1: a usage error exits 2', () => {
    expect(main(['--wat'])).toBe(2);
    expect(out.join('\n')).toContain('usage: pnpm prechecks');
  });

  it('AC-1: a missing origin/main exits 2 with a fetch hint', () => {
    world({ mergeBaseOk: false });
    expect(main([])).toBe(2);
    expect(out.join('\n')).toContain('git fetch origin main');
  });

  it('AC-2: a clean branch passes and runs no content or shard checks', () => {
    const ran = world({
      log: goodLog,
      diff: 'M\tscripts/foo.ts\nD\tscripts/old.ts\n',
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main([])).toBe(0);
    expect(out.join('\n')).toContain('prechecks passed (1 commit(s), 2 file(s))');
    expect(ran.some((c) => c.includes('content-'))).toBe(false);
    expect(ran.some((c) => c.includes('e2e-shards'))).toBe(false);
    expect(ran.some((c) => c.includes('prettier --check --ignore-unknown scripts/foo.ts'))).toBe(
      true,
    );
  });

  it('AC-2: skips prettier when every changed file was deleted', () => {
    const ran = world({
      log: '',
      diff: 'D\tscripts/old.ts\n',
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main([])).toBe(0);
    expect(ran.some((c) => c.includes('prettier'))).toBe(false);
  });

  it('AC-1: reports sign-off, beads, changelog and prettier failures with fix hints', () => {
    world({
      log: 'dead0000\0feat: unsigned\x01nobody-separator\x01',
      diff: 'M\tsrc/ui/hud.ts\nM\t.beads/issues.jsonl\n',
      failing: {
        prettier: '[warn] src/ui/hud.ts\n[warn] Code style issues found in 1 file.\nnoise\n',
      },
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main([])).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('FAIL [sign-off]');
    expect(text).toContain('FAIL [beads]');
    expect(text).toContain('FAIL [changelog]');
    expect(text).toContain(
      'FAIL [prettier] [warn] src/ui/hud.ts\n  fix: pnpm exec prettier --write',
    );
    expect(text).not.toContain('Code style issues');
  });

  it('AC-3: --lead and --no-changelog suppress the beads and changelog failures', () => {
    world({
      log: goodLog,
      diff: 'M\tsrc/ui/hud.ts\nM\t.beads/issues.jsonl\n',
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main(['--lead', '--no-changelog'])).toBe(0);
  });

  it('AC-1: reports stale content schemas and docs when content types change', () => {
    world({
      log: goodLog,
      diff: 'M\tsrc/content/types/item.ts\n',
      failing: { 'content-schemas-cli': '', 'content-docs-cli': '' },
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main(['--no-changelog'])).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('FAIL [content-schemas]');
    expect(text).toContain('fix: pnpm content:schemas');
    expect(text).toContain('FAIL [content-docs]');
    expect(text).toContain('fix: pnpm content:docs');
  });

  it('AC-2: content types that are up to date pass', () => {
    const ran = world({
      log: goodLog,
      diff: 'M\tsrc/content/types/item.ts\n',
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main(['--no-changelog'])).toBe(0);
    expect(ran.some((c) => c.includes('content-docs-cli.ts --check'))).toBe(true);
  });

  it('AC-1: reports a stale shard table when a spec is added', () => {
    world({
      log: goodLog,
      diff: 'A\te2e/new.spec.ts\n',
      failing: { 'e2e-shards-cli': '' },
      files: { 'CHANGELOG.md': CHANGELOG },
    });
    expect(main([])).toBe(1);
    expect(out.join('\n')).toContain('FAIL [shards]');
  });

  it('AC-2: a passing shard table passes', () => {
    world({ log: goodLog, diff: 'A\te2e/new.spec.ts\n', files: { 'CHANGELOG.md': CHANGELOG } });
    expect(main([])).toBe(0);
  });

  it('AC-1: --body checks Closes ids against .beads/issues.jsonl', () => {
    world({
      log: goodLog,
      diff: 'M\tscripts/foo.ts\n',
      files: {
        'CHANGELOG.md': CHANGELOG,
        'pr.md': 'Closes mw-nope.1\n',
        '.beads/issues.jsonl': JSONL,
      },
    });
    expect(main(['--body', 'pr.md'])).toBe(1);
    expect(out.join('\n')).toContain('FAIL [closes]');
  });

  it('AC-2: --body with a known id passes, even without an export file to read', () => {
    world({
      log: goodLog,
      diff: 'M\tscripts/foo.ts\n',
      files: {
        'CHANGELOG.md': CHANGELOG,
        'pr.md': 'Closes mw-e1.1\n',
        '.beads/issues.jsonl': JSONL,
      },
    });
    expect(main(['--body', 'pr.md'])).toBe(0);
  });

  it('AC-1: an unreadable --body file fails, and a missing export counts as empty', () => {
    world({ log: goodLog, diff: 'M\tscripts/foo.ts\n', files: { 'CHANGELOG.md': CHANGELOG } });
    expect(main(['--body', 'missing.md'])).toBe(1);
    expect(out.join('\n')).toContain('cannot read missing.md');
  });

  it('AC-1: a missing export leaves every Closes id unknown', () => {
    world({
      log: goodLog,
      diff: 'M\tscripts/foo.ts\n',
      files: { 'CHANGELOG.md': CHANGELOG, 'pr.md': 'Closes mw-e1.1\n' },
    });
    expect(main(['--body', 'pr.md'])).toBe(1);
  });

  it('AC-1: a missing CHANGELOG.md fails the changelog check', () => {
    world({ log: goodLog, diff: 'M\tscripts/foo.ts\n' });
    expect(main([])).toBe(1);
    expect(out.join('\n')).toContain('FAIL [changelog]');
  });

  it('ignores name-status lines without a path', () => {
    expect(parseNameStatus('garbage\n')).toEqual([]);
  });

  it('the CLI passes argv to main and sets the process exit code', async () => {
    const argv = process.argv;
    process.argv = ['node', 'pr-prechecks-cli.ts', '--wat'];
    try {
      await import('./pr-prechecks-cli.ts');
      expect(process.exitCode).toBe(2);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
