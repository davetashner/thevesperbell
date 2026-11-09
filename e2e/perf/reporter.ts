// Playwright reporter for the perf budget suite (mw-e32.1): collects what each perf spec attached,
// judges it against perf/perf-budgets.json and writes test-results/perf-report.json, the GitHub job
// summary and, in reference mode, perf/results/<date>-<sha>.json. The logic is scripts/perf/report.ts.
import { execFileSync } from 'node:child_process';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadBudgets, type PerfMode } from '../../scripts/perf/budgets';
import {
  buildReport,
  formatSummary,
  writeReport,
  type PerfAttachment,
} from '../../scripts/perf/report';
import { BUDGETS_PATH, CONTRACT_PATH } from './harness';

export const REPORT_PATH = 'test-results/perf-report.json';
export const RESULTS_DIR = 'perf/results';

function shortSha(): string {
  const ci = process.env['GITHUB_SHA'];
  if (ci !== undefined && ci !== '') return ci.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default class PerfReporter implements Reporter {
  private readonly attachments: PerfAttachment[] = [];
  private mode: PerfMode | undefined;

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name;
    if (project === 'ci' || project === 'reference') this.mode = project;
    // The latency project is reference mode too: the same machine, with vsync on (mw-e02.8).
    if (project === 'latency') this.mode = 'reference';
    for (const attachment of result.attachments) {
      if (attachment.name === 'perf' && attachment.body !== undefined) {
        this.attachments.push(JSON.parse(attachment.body.toString('utf8')) as PerfAttachment);
      }
    }
  }

  onEnd(): void {
    if (this.mode === undefined) return;
    const report = buildReport(loadBudgets(BUDGETS_PATH, CONTRACT_PATH), this.attachments, {
      mode: this.mode,
      sha: shortSha(),
      date: new Date(),
    });
    const written = writeReport(report, {
      reportPath: REPORT_PATH,
      ...(this.mode === 'reference' && { resultsDir: RESULTS_DIR }),
      stepSummary: process.env['GITHUB_STEP_SUMMARY'],
    });
    console.log(`\n${formatSummary(report)}`);
    console.log(`Perf report written to ${written.join(', ')}`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
