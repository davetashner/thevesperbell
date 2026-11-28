import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CreditRow } from './credits.ts';
import { REQUIRED_GATES, type ApprovalRecord } from './schema.ts';
import {
  committedFile,
  listRuntimeAssets,
  sha256File,
  validateApprovals,
  type ApprovalEnv,
} from './validate.ts';

const MODEL = 'model-creature-minotaur-01';
const credit = (id: string, type: string, placeholder = false): CreditRow => ({
  id,
  type,
  placeholder,
  line: 7,
});
const record = (over: Partial<ApprovalRecord>): ApprovalRecord => ({
  assetId: MODEL,
  gate: 'image',
  version: 'v1',
  sha256: 'img',
  decision: 'approved',
  approver: 'owner',
  date: '2026-11-27T22:00:00.000Z',
  file: `assets/source/model/${MODEL}/${MODEL}.png`,
  note: '',
  ...over,
});

/** Files by path → content hash; a record's file is committed when it is in the map. */
const env = (
  records: ApprovalRecord[],
  credits: CreditRow[] = [credit(MODEL, 'model')],
  files: Record<string, string> = {},
): ApprovalEnv => ({
  assets: [{ assetId: MODEL, files: [`public/assets/model/${MODEL}.glb`] }],
  credits,
  records,
  requiredGates: REQUIRED_GATES,
  committedFile: (r) => (r.file in files ? r.file : undefined),
  hashOf: (path) => String(files[path]),
});

const PNG = `assets/source/model/${MODEL}/${MODEL}.png`;
const GLB = `assets/source/model/${MODEL}/${MODEL}.glb`;

describe('approvals rule', () => {
  it('AC-1: a final 3D asset with an image approval but no turntable record fails naming the gate', () => {
    const report = validateApprovals(env([record({})], undefined, { [PNG]: 'img' }));
    expect(report.problems).toEqual([
      `${MODEL}: missing approval for gate "turntable" (required for type "model")`,
    ]);
    expect(report.finals).toBe(1);
  });

  it('passes once both gates are approved and the committed files match', () => {
    const records = [record({}), record({ gate: 'turntable', sha256: 'glb', file: GLB })];
    const report = validateApprovals(env(records, undefined, { [PNG]: 'img', [GLB]: 'glb' }));
    expect(report.problems).toEqual([]);
  });

  it('AC-2: a file changed after approval fails with "approval stale" and both hashes', () => {
    const records = [record({}), record({ gate: 'turntable', sha256: 'glb', file: GLB })];
    const report = validateApprovals(env(records, undefined, { [PNG]: 'img', [GLB]: 'edited' }));
    expect(report.problems).toEqual([
      `${MODEL}: approval stale for gate "turntable": ${GLB} has sha256 edited, approved v1 has sha256 glb`,
    ]);
  });

  it('AC-4: a placeholder asset needs no approval', () => {
    const report = validateApprovals(env([], [credit('model-*', 'model', true)]));
    expect(report).toEqual({ problems: [], placeholders: 1, finals: 0 });
  });

  it('AC-5: after a rejected v1 and an approved v2, only the v2 hash is accepted', () => {
    const credits = [credit(MODEL, 'concept')];
    const records = [
      record({ sha256: 'v1', decision: 'rejected' }),
      record({ version: 'v2', sha256: 'v2' }),
    ];
    expect(validateApprovals(env(records, credits, { [PNG]: 'v2' })).problems).toEqual([]);
    expect(validateApprovals(env(records, credits, { [PNG]: 'v1' })).problems).toEqual([
      `${MODEL}: ${PNG} is the rejected image v1`,
    ]);
  });

  it('fails an approval whose file was never committed, a missing CREDITS row and an unknown type', () => {
    expect(validateApprovals(env([record({})], [credit(MODEL, 'concept')])).problems[0]).toMatch(
      /the approved image v1 file is not committed/,
    );
    expect(validateApprovals(env([], [])).problems[0]).toMatch(/no assets\/CREDITS.md row/);
    expect(validateApprovals(env([], [credit(MODEL, 'hologram')])).problems[0]).toMatch(
      /type "hologram" \(line 7\) has no entry in required-gates.json/,
    );
  });
});

describe('approvals filesystem helpers', () => {
  const repo = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'approvals-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  it('groups runtime files by id and skips JSON sidecars', () => {
    const root = repo({
      'public/assets/audio/music/music-a.ogg': '1',
      'public/assets/audio/music/music-a.m4a': '2',
      'public/assets/audio/music/music-a.json': '{}',
      'public/assets/model/model-b.glb': '3',
    });
    expect(listRuntimeAssets(root)).toEqual([
      {
        assetId: 'music-a',
        files: ['public/assets/audio/music/music-a.m4a', 'public/assets/audio/music/music-a.ogg'],
      },
      { assetId: 'model-b', files: ['public/assets/model/model-b.glb'] },
    ]);
    expect(listRuntimeAssets(repo({}))).toEqual([]);
  });

  it('resolves committed files and promoted _incoming candidates', () => {
    const root = repo({
      [PNG]: 'png',
      'assets/source/music/music-a/music-a.wav': 'wav',
      'public/assets/x/tex-a.webp': 'webp',
    });
    const at = (file: string): string | undefined => committedFile(root, record({ file }));
    expect(at('public/assets/x/tex-a.webp')).toBe('public/assets/x/tex-a.webp');
    expect(at('public/assets/x/missing.webp')).toBeUndefined();
    expect(at(`assets/_incoming/${MODEL}/v1.png`)).toBe(PNG);
    expect(at('assets/_incoming/music/music-a.wav')).toBe('assets/source/music/music-a/music-a.wav');
    expect(at(`assets/_incoming/${MODEL}/v1.glb`)).toBeUndefined();
    expect(committedFile(repo({}), record({ file: `assets/_incoming/${MODEL}/v1.png` }))).toBe(
      undefined,
    );
    expect(sha256File(join(root, PNG))).toMatch(/^[0-9a-f]{64}$/);
  });
});
