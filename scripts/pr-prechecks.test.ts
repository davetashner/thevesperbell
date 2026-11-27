import { describe, expect, it } from 'vitest';
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
} from './pr-prechecks.ts';

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
