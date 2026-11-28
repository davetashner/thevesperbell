import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approvalRecord, parseApprovals, serializeApprovals } from './schema.ts';

const RECORD = {
  assetId: 'model-creature-minotaur-01',
  gate: 'turntable',
  version: 'v3',
  sha256: 'a'.repeat(64),
  decision: 'approved',
  approver: 'owner',
  date: '2026-11-27T22:00:00.000Z',
  file: 'assets/_incoming/model-creature-minotaur-01/v3.glb',
  note: '',
};

describe('approvals.json schema', () => {
  it('accepts a well-formed record and round-trips the file', () => {
    const text = serializeApprovals({ records: [approvalRecord.parse(RECORD)] });
    expect(parseApprovals(text, 'a.json').records[0]).toEqual(RECORD);
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('rejects an email as approver, a bad version and a short hash', () => {
    expect(approvalRecord.safeParse({ ...RECORD, approver: 'me@example.com' }).success).toBe(false);
    expect(approvalRecord.safeParse({ ...RECORD, version: '3' }).success).toBe(false);
    expect(approvalRecord.safeParse({ ...RECORD, sha256: 'abc' }).success).toBe(false);
  });

  it('AC-5: a malformed approvals.json fails with a parse error location', () => {
    expect(() => parseApprovals('{\n  "records": [\n  ,]\n}', 'assets/approvals.json')).toThrow(
      /^assets\/approvals\.json: .*line 3 column 3/,
    );
  });

  it('AC-5: a schema error names the failing record field, or the root', () => {
    const bad = JSON.stringify({ records: [RECORD, { ...RECORD, gate: 'vibes' }] });
    expect(() => parseApprovals(bad, 'assets/approvals.json')).toThrow(
      /assets\/approvals\.json: records\[1\]\.gate: /,
    );
    expect(() => parseApprovals('[]', 'x.json')).toThrow(/^x\.json: \(root\): /);
  });

  it('the committed assets/approvals.json is valid', () => {
    const file = parseApprovals(readFileSync('assets/approvals.json', 'utf8'), 'approvals.json');
    expect(file.records.length).toBeGreaterThan(0);
  });
});
