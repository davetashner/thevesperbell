// mw-e39.24 AC-5: the lint over the full shipped narrative set completes in 10 s with zero errors.
import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from '@content/index';
import { contentEnv } from '../../src/tools/narrative-lint/cli';
import { lintNarrative } from '../../src/tools/narrative-lint/lint';

describe('narrative lint over src/content/data', () => {
  it('AC-5: finishes within 10 s with zero errors', () => {
    const started = performance.now();
    const report = lintNarrative(gameContentSources(), contentEnv(loadGameContent()));
    const seconds = (performance.now() - started) / 1000;
    expect(report.errors).toEqual([]);
    expect(report.files).toBeGreaterThan(30);
    expect(seconds).toBeLessThanOrEqual(10);
  });
});
