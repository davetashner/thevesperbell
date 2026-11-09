import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { percentiles } from '../../src/tools/perf/percentiles.ts';
import { BASELINE_SOURCE_PREFIX, type PerfBudget } from './budgets.ts';
import {
  buildReport,
  formatSummary,
  resultsFileName,
  writeReport,
  type FrameRun,
  type PerfAttachment,
} from './report.ts';

const source = `${BASELINE_SOURCE_PREFIX}: steady 60 fps`;
const budgets: PerfBudget[] = [
  { id: 'initial-transfer', metric: 'initialTransferBytes', mode: 'ci', max: 50e6, source },
  { id: 'heap-after-idle', metric: 'heapBytesAfterIdle', mode: 'ci', max: 1.5e9, source },
  {
    id: 'frame-p95-high',
    metric: 'frameP95Ms',
    mode: 'reference',
    max: 16.7,
    source,
    scene: 'perf-baseline',
  },
];

const frames = (p95: number): FrameRun => ({
  scene: 'perf-baseline',
  frame: { ...percentiles(Array<number>(1800).fill(8)), p95 },
  work: percentiles(Array<number>(1800).fill(3)),
  viewport: '1280×720 @2x',
  renderer: 'Apple M1 Pro',
});

const meta = (mode: 'ci' | 'reference') => ({
  mode,
  sha: 'abc1234',
  date: new Date('2026-10-03T12:00:00Z'),
});

describe('perf run report (mw-e32.1)', () => {
  it('AC-1: a reference run over 16.7 ms p95 fails with a per-metric report', () => {
    const attachments: PerfAttachment[] = [
      {
        measurements: [{ metric: 'frameP95Ms', value: 19.2, scene: 'perf-baseline' }],
        frames: frames(19.2),
        browser: 'chrome 141',
      },
    ];
    const report = buildReport(budgets, attachments, meta('reference'));
    expect(report.pass).toBe(false);
    expect(report.results).toHaveLength(1); // only reference-mode budgets of measured metrics
    expect(report.results[0]?.message).toContain('exceeds budget ≤ 16.70 ms by +2.50 ms');
    const summary = formatSummary(report);
    expect(summary).toContain('## Perf budgets (reference mode) — FAIL');
    expect(summary).toContain('· chrome 141');
    expect(summary).toContain(
      '| frame-p95-high | frameP95Ms | 19.20 ms | ≤ 16.70 ms | +2.50 ms | **FAIL** |',
    );
    expect(summary).toContain(
      '| perf-baseline | 1280×720 @2x | Apple M1 Pro | 1800 | 8.00 / 19.20 /',
    );
  });

  it('a Low frame run is labelled with its preset in the summary', () => {
    const run = { ...frames(8), scene: 'valley-01', preset: 'low' } as const;
    const report = buildReport(
      [
        {
          id: 'valley-01-frame-p95-low',
          metric: 'frameP95Ms',
          mode: 'reference',
          max: 16.7,
          source,
          scene: 'valley-01',
          preset: 'low',
        },
      ],
      [
        {
          measurements: [{ metric: 'frameP95Ms', value: 8, scene: 'valley-01', preset: 'low' }],
          frames: run,
        },
      ],
      meta('reference'),
    );
    expect(report.pass).toBe(true);
    expect(formatSummary(report)).toContain('| valley-01 (low) | 1280×720 @2x |');
  });

  it('a CI run judges only what it measured, and passes when every budget does', () => {
    const report = buildReport(
      budgets,
      [{ measurements: [{ metric: 'heapBytesAfterIdle', value: 2e8 }] }],
      meta('ci'),
    );
    expect(report).toMatchObject({
      pass: true,
      mode: 'ci',
      date: '2026-10-03T12:00:00.000Z',
      browser: 'unknown',
    });
    expect(report.results.map((r) => r.id)).toEqual(['heap-after-idle']);
    expect(report.frames).toEqual([]);
    const summary = formatSummary(report);
    expect(summary).toContain('— pass');
    expect(summary).toContain('| −1300.00 MB | pass |'.replace('−', '-'));
    expect(summary).not.toContain('| Scene |');
    expect(buildReport(budgets, [], meta('ci')).pass).toBe(false); // nothing measured is no pass
  });

  it('leaves out a budget measured only in another scene; shows a broken value as not measured', () => {
    const elsewhere = buildReport(
      budgets,
      [{ measurements: [{ metric: 'frameP95Ms', value: 9, scene: 'testbed' }] }],
      meta('reference'),
    );
    expect(elsewhere.results).toEqual([]);
    const broken = buildReport(
      budgets,
      [{ measurements: [{ metric: 'frameP95Ms', value: Number.NaN, scene: 'perf-baseline' }] }],
      meta('reference'),
    );
    expect(formatSummary(broken)).toContain('| not measured | ≤ 16.70 ms | — | **FAIL** |');
  });

  describe('writing', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'perf-report-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true });
    });

    it('writes the JSON report and the job summary; reference runs also write perf/results', () => {
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '');
      const attachments = [
        { measurements: [{ metric: 'frameP95Ms' as const, value: 12, scene: 'perf-baseline' }] },
      ];
      const reference = buildReport(budgets, attachments, meta('reference'));
      expect(resultsFileName(reference)).toBe('2026-10-03-abc1234.json');
      const written = writeReport(reference, {
        reportPath: join(dir, 'out', 'perf-report.json'),
        resultsDir: join(dir, 'results'),
        stepSummary: summary,
      });
      expect(written).toEqual([
        join(dir, 'out', 'perf-report.json'),
        join(dir, 'results', '2026-10-03-abc1234.json'),
      ]);
      expect(JSON.parse(readFileSync(written[1] ?? '', 'utf8'))).toMatchObject({ pass: true });
      expect(readFileSync(summary, 'utf8')).toContain('Perf budgets (reference mode) — pass');

      const ci = buildReport(budgets, [], meta('ci'));
      const ciPath = join(dir, 'ci.json');
      expect(
        writeReport(ci, {
          reportPath: ciPath,
          resultsDir: join(dir, 'ci-results'),
          stepSummary: '',
        }),
      ).toEqual([ciPath]);
      expect(existsSync(join(dir, 'ci-results'))).toBe(false);
      expect(writeReport(ci, { reportPath: ciPath })).toEqual([ciPath]);
    });
  });
});
