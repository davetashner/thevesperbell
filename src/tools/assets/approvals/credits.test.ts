import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCredit, parseCredits, rowId } from './credits.ts';

const TABLE = `# Credits

| Licence id | Meaning |
|---|---|
| \`CC0-1.0\` | Public domain |

| Asset id | Type | Source | Placeholder |
|---|---|---|---|
| \`vfx-*\` — every png under public/assets/vfx/ | vfx | original | yes |
| model-prop-crate-01 | model | generated:tripo | no |
| amb-drips-01 (source take \`mine-bed\`) | amb | generated:suno | YES |
| _(none yet)_ | | | |
|
| lonely |
`;

describe('CREDITS parsing', () => {
  it('takes a leading code span, or else the first word, as the asset id', () => {
    expect(rowId('`vfx-*` — the pack')).toBe('vfx-*');
    expect(rowId('amb-drips-01 (source take `mine-bed`)')).toBe('amb-drips-01');
  });

  it('reads only asset tables, skipping separators, empty rows and malformed lines', () => {
    expect(parseCredits(TABLE)).toEqual([
      { id: 'vfx-*', type: 'vfx', placeholder: true, line: 9 },
      { id: 'model-prop-crate-01', type: 'model', placeholder: false, line: 10 },
      { id: 'amb-drips-01', type: 'amb', placeholder: true, line: 11 },
    ]);
  });

  it('prefers an exact id over a glob, and matches globs whole', () => {
    const rows = [
      { id: 'vfx-*', type: 'vfx', placeholder: true, line: 1 },
      { id: 'vfx-ring-01', type: 'vfx', placeholder: false, line: 2 },
    ];
    expect(findCredit(rows, 'vfx-ring-01')?.line).toBe(2);
    expect(findCredit(rows, 'vfx-spark-01')?.line).toBe(1);
    expect(findCredit(rows, 'tex-vfx-01')).toBeUndefined();
  });

  it('parses the real assets/CREDITS.md', () => {
    const rows = parseCredits(readFileSync('assets/CREDITS.md', 'utf8'));
    expect(rows.length).toBeGreaterThan(150);
    expect(findCredit(rows, 'amb-deepworks-drips-01')?.placeholder).toBe(true);
    expect(findCredit(rows, 'music-marsh-general-store')?.placeholder).toBe(false);
  });
});
