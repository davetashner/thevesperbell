import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_DOC, renderCatalogue } from '@tools/scenarios/catalogue';
import { loadScenarios } from '@tools/scenarios/files';

const DOC = resolve(import.meta.dirname, '../..', CATALOGUE_DOC);

describe('docs/design/emergence-catalogue.md (mw-e03.27)', () => {
  // `pnpm scenarios:docs` sets SCENARIOS_DOCS_WRITE=1, which rewrites the file instead of checking it.
  it('is up to date with the scenario files (run pnpm scenarios:docs if this fails)', () => {
    const expected = renderCatalogue(loadScenarios());
    if (process.env['SCENARIOS_DOCS_WRITE'] === '1') writeFileSync(DOC, expected);
    expect(readFileSync(DOC, 'utf8')).toBe(expected);
  });
});
