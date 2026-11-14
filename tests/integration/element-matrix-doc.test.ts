import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMatrix, renderMatrix } from '@sim/testing/element-matrix-report';

// Property runs are CPU heavy: under a loaded coverage run they need more than the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const DOC = resolve(import.meta.dirname, '../../docs/design/interaction-matrix.md');

describe('docs/design/interaction-matrix.md', () => {
  // `pnpm content:matrix` sets ELEMENT_MATRIX_WRITE=1, which rewrites the file instead of checking it.
  it('is up to date with the sim (run pnpm content:matrix if this fails)', () => {
    const expected = renderMatrix(buildMatrix());
    if (process.env['ELEMENT_MATRIX_WRITE'] === '1') writeFileSync(DOC, expected);
    expect(readFileSync(DOC, 'utf8')).toBe(expected);
  });
});
