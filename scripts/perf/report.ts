// Perf run reports (mw-e32.1): what one run of the perf suite measured, judged against its budgets.
// The Playwright reporter (e2e/perf/reporter.ts) builds one at the end of a run and writes it as JSON
// (test-results/perf-report.json; CI uploads it, and main's copy is the baseline PRs compare
// against), as a Markdown job summary, and in reference mode also as perf/results/<date>-<sha>.json,
// committed so the results build a trend over time.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Percentiles } from '../../src/tools/perf/percentiles.ts';
import {
  evaluateAll,
  measures,
  formatValue,
  type BudgetResult,
  type Measurement,
  type PerfBudget,
  type PerfMode,
} from './budgets.ts';

/** Frame-time statistics of one scene in one run. */
export interface FrameRun {
  readonly scene: string;
  /** The quality preset the scene was run at; absent means High. */
  readonly preset?: 'low' | 'high';
  /** Frame interval percentiles, ms. */
  readonly frame: Percentiles;
  /** Main-thread work per frame, ms. */
  readonly work: Percentiles;
  /** e.g. "1280×720 @2x". */
  readonly viewport: string;
  /** The WebGL renderer string (e.g. SwiftShader on CI runners). */
  readonly renderer: string;
}

/** What a perf spec attaches to its test result for the reporter. */
export interface PerfAttachment {
  readonly measurements: readonly Measurement[];
  readonly frames?: FrameRun;
  /** Browser name and version, e.g. "chromium 140.0.7339.16". */
  readonly browser?: string;
}

export interface PerfRunReport {
  readonly schema: 1;
  readonly mode: PerfMode;
  /** Commit measured (short SHA) and when. */
  readonly sha: string;
  readonly date: string;
  readonly browser: string;
  readonly results: readonly BudgetResult[];
  readonly measurements: readonly Measurement[];
  readonly frames: readonly FrameRun[];
  /** Every budget passed (and at least one was measured). */
  readonly pass: boolean;
}

export interface RunMeta {
  readonly mode: PerfMode;
  readonly sha: string;
  readonly date: Date;
}

/**
 * The report for one run: every budget of the run's mode judged against the attachments. Budgets the
 * run never measured (no measurement of their metric, in their scene when they name one) are left
 * out, so a filtered run (`--grep heap`) judges just what it measured; the spec that should have
 * measured one fails on its own.
 */
export function buildReport(
  budgets: readonly PerfBudget[],
  attachments: readonly PerfAttachment[],
  meta: RunMeta,
): PerfRunReport {
  const measurements = attachments.flatMap((a) => a.measurements);
  const results = evaluateAll(
    budgets.filter((b) => b.mode === meta.mode && measurements.some((m) => measures(b, m))),
    measurements,
  );
  return {
    schema: 1,
    mode: meta.mode,
    sha: meta.sha,
    date: meta.date.toISOString(),
    browser: attachments.find((a) => a.browser !== undefined)?.browser ?? 'unknown',
    results,
    measurements,
    frames: attachments.flatMap((a) => (a.frames === undefined ? [] : [a.frames])),
    pass: results.length > 0 && results.every((r) => r.pass),
  };
}

const ms = (n: number): string => n.toFixed(2);

/** The run as Markdown: one row per budget, then frame-time statistics per scene. */
export function formatSummary(report: PerfRunReport): string {
  const lines = [
    `## Perf budgets (${report.mode} mode) — ${report.pass ? 'pass' : 'FAIL'}`,
    '',
    `Commit \`${report.sha}\` · ${report.date} · ${report.browser}`,
    '',
    '| Budget | Metric | Value | Budget | Delta | Result |',
    '|---|---|---|---|---|---|',
    ...report.results.map(
      (r) =>
        `| ${r.id} | ${r.metric} | ${r.value === undefined ? 'not measured' : formatValue(r.value, r.unit)} | ≤ ${formatValue(r.max, r.unit)} | ${r.delta === undefined ? '—' : `${r.delta > 0 ? '+' : ''}${formatValue(r.delta, r.unit)}`} | ${r.pass ? 'pass' : '**FAIL**'} |`,
    ),
  ];
  if (report.frames.length > 0) {
    lines.push(
      '',
      '| Scene | Viewport | Renderer | Frames | Frame p50 / p95 / p99 / max (ms) | Work p50 / p95 (ms) |',
      '|---|---|---|---|---|---|',
      ...report.frames.map(
        (f) =>
          `| ${f.scene}${f.preset === undefined ? '' : ` (${f.preset})`} | ${f.viewport} | ${f.renderer} | ${String(f.frame.count)} | ${ms(f.frame.p50)} / ${ms(f.frame.p95)} / ${ms(f.frame.p99)} / ${ms(f.frame.max)} | ${ms(f.work.p50)} / ${ms(f.work.p95)} |`,
      ),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** perf/results file name for a reference run: `<YYYY-MM-DD>-<sha>.json`. */
export function resultsFileName(report: Pick<PerfRunReport, 'date' | 'sha'>): string {
  return `${report.date.slice(0, 10)}-${report.sha}.json`;
}

export interface WriteOptions {
  /** Where the run's JSON report goes (test-results/perf-report.json). */
  readonly reportPath: string;
  /** Reference mode: the directory results are committed in (perf/results). */
  readonly resultsDir?: string;
  /** GitHub's job summary file, when running in Actions. */
  readonly stepSummary?: string | undefined;
}

/** Writes the report, the job summary and (reference mode) the results file; returns their paths. */
export function writeReport(report: PerfRunReport, options: WriteOptions): string[] {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  mkdirSync(dirname(options.reportPath), { recursive: true });
  writeFileSync(options.reportPath, json);
  const written = [options.reportPath];
  if (report.mode === 'reference' && options.resultsDir !== undefined) {
    const path = join(options.resultsDir, resultsFileName(report));
    mkdirSync(options.resultsDir, { recursive: true });
    writeFileSync(path, json);
    written.push(path);
  }
  if (options.stepSummary !== undefined && options.stepSummary !== '') {
    appendFileSync(options.stepSummary, formatSummary(report));
  }
  return written;
}
