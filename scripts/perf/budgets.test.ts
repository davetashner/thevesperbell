import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASELINE_SOURCE_PREFIX,
  baselineSection,
  budgetsFor,
  evaluate,
  evaluateAll,
  formatValue,
  loadBudgets,
  measures,
  quoteOf,
  validateBudgets,
  type PerfBudget,
} from './budgets.ts';
import { DEFAULT_BUDGETS, DEFAULT_CONTRACT, main } from './budgets-check.ts';

const contract = readFileSync(DEFAULT_CONTRACT, 'utf8');
const committed: unknown = JSON.parse(readFileSync(DEFAULT_BUDGETS, 'utf8'));

const budget = (overrides: Partial<PerfBudget> = {}): PerfBudget => ({
  id: 'initial-transfer',
  metric: 'initialTransferBytes',
  mode: 'ci',
  max: 50_000_000,
  source: `${BASELINE_SOURCE_PREFIX}: initial download ≤ 50 MB`,
  ...overrides,
});

describe('perf budgets (mw-e32.1)', () => {
  it('AC-6: the committed budget file cites the contract’s hardware baseline for every budget', () => {
    const result = validateBudgets(committed, contract);
    expect(result).toMatchObject({ ok: true });
    const budgets = result.ok ? result.budgets : [];
    expect(budgets.map((b) => b.id)).toEqual(
      expect.arrayContaining([
        'initial-transfer',
        'load-to-playable',
        'heap-after-idle',
        'frame-p95-high',
      ]),
    );
    // Long tasks: CI judges only those that are not frame renders; the reference GPU judges all.
    expect(budgets.filter((b) => b.metric === 'nonFrameLongTasksOver200ms')).toMatchObject([
      { mode: 'ci', scene: 'perf-baseline', max: 0 },
      { mode: 'ci', scene: 'testbed', max: 0 },
    ]);
    expect(
      budgets
        .filter((b) => b.metric === 'longTasksOver200ms')
        .map((b) => [b.mode, b.scene, b.preset, b.max]),
    ).toEqual([
      ['reference', 'perf-baseline', 'high', 0],
      ...['valley-01', 'valley-02', 'valley-03'].flatMap((scene) =>
        ['high', 'low'].map((preset) => ['reference', scene, preset, 0]),
      ),
    ]);
    expect(budgets.find((b) => b.id === 'frame-p95-high')).toMatchObject({
      max: 16.7,
      mode: 'reference',
      scene: 'perf-baseline',
      preset: 'high',
    });
  });

  it('mw-e02.8: input-to-motion latency (100 ms High, 133 ms Low at 30 fps) and controller and camera cost budgets', () => {
    const result = validateBudgets(committed, contract);
    const budgets = result.ok ? result.budgets : [];
    const pick = (id: string) => budgets.find((b) => b.id === id);
    expect(pick('input-to-motion-high')).toMatchObject({
      metric: 'inputToMotionP95Ms',
      mode: 'reference',
      max: 100,
      scene: 'testbed',
      preset: 'high',
    });
    expect(pick('input-to-motion-low-30fps')).toMatchObject({
      metric: 'inputToMotionP95Ms',
      max: 133,
      preset: 'low',
    });
    expect(pick('controller-tick-p95')).toMatchObject({ metric: 'controllerTickP95Ms', max: 0.3 });
    expect(pick('camera-frame-p95')).toMatchObject({ metric: 'cameraFrameP95Ms', max: 0.2 });
    // A High latency does not pass the Low budget, nor the reverse.
    const [high, low] = [pick('input-to-motion-high'), pick('input-to-motion-low-30fps')];
    const at = (preset: 'low' | 'high') => ({
      metric: 'inputToMotionP95Ms' as const,
      value: 1,
      scene: 'testbed',
      preset,
    });
    expect(high && measures(high, at('low'))).toBe(false);
    expect(low && measures(low, at('low'))).toBe(true);
  });

  it('AC-6: a budget lacking a source citing the baseline fails validation', () => {
    const unsourced: Record<string, unknown> = { ...budget() };
    delete unsourced['source'];
    expect(validateBudgets({ budgets: [unsourced] })).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^budgets\.0\.source: missing: cite the baseline as/)],
    });
    for (const source of [
      'my hunch: 50 MB feels right',
      BASELINE_SOURCE_PREFIX,
      `${BASELINE_SOURCE_PREFIX}:   `,
    ]) {
      const result = validateBudgets({ budgets: [budget({ source })] });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.errors[0]).toMatch(/budgets\.0\.source: must cite the baseline/);
    }
  });

  it('AC-6: a source quoting words the hardware baseline does not contain fails against the contract', () => {
    const invented = budget({ source: `${BASELINE_SOURCE_PREFIX}: initial download ≤ 80 MB` });
    expect(validateBudgets({ budgets: [invented] })).toMatchObject({ ok: true }); // no contract given
    expect(validateBudgets({ budgets: [invented] }, contract)).toEqual({
      ok: false,
      errors: [
        `budgets.0.source: "initial download ≤ 80 MB" is not in the contract's Hardware baseline section`,
      ],
    });
    // Quotes match across Markdown bold and line wraps; words outside the section never do.
    const bold = budget({
      source: `${BASELINE_SOURCE_PREFIX}: High preset: steady 60 fps on the reference machine`,
    });
    expect(validateBudgets({ budgets: [bold] }, contract).ok).toBe(true);
    const elsewhere = budget({ source: `${BASELINE_SOURCE_PREFIX}: squash merge only` });
    expect(validateBudgets({ budgets: [elsewhere] }, contract).ok).toBe(false);
    expect(validateBudgets({ budgets: [elsewhere] }, 'no such section').ok).toBe(false);
  });

  it('rejects malformed files and duplicate ids, naming the path', () => {
    expect(validateBudgets([])).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^\(file\): /)],
    });
    expect(validateBudgets({ budgets: [] }).ok).toBe(false);
    expect(validateBudgets({ budgets: [budget({ metric: 'fps' as never })] })).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^budgets\.0\.metric: /)],
    });
    expect(validateBudgets({ budgets: [budget(), budget()] })).toEqual({
      ok: false,
      errors: ['budgets.1.id: duplicate id "initial-transfer"'],
    });
  });

  it('finds the hardware baseline section and the quote of a source', () => {
    expect(baselineSection(contract)).toMatch(/^### Hardware baseline/);
    expect(baselineSection(contract)).not.toContain('Architecture boundary');
    expect(baselineSection('### Hardware baseline\n- JS heap ≤ 1.5 GB')).toContain('1.5 GB');
    expect(baselineSection('nothing here')).toBe('');
    expect(quoteOf(`${BASELINE_SOURCE_PREFIX}: JS heap ≤ 1.5 GB `)).toBe('JS heap ≤ 1.5 GB');
    expect(quoteOf('JS heap ≤ 1.5 GB')).toBeUndefined();
  });

  it('AC-2: a transfer over 50 MB fails naming the metric and the delta vs budget', () => {
    const result = evaluate(budget({ scene: 'testbed' }), 61_200_000);
    expect(result).toMatchObject({
      pass: false,
      value: 61_200_000,
      delta: 11_200_000,
      unit: 'bytes',
    });
    expect(result.message).toBe(
      'initial-transfer (initialTransferBytes in testbed): 61.20 MB exceeds budget ≤ 50.00 MB by +11.20 MB (+22.4%)',
    );
  });

  it('AC-2: a throttled load-to-playable over 10 s fails naming the metric and the delta', () => {
    const load = budget({ id: 'load-to-playable', metric: 'loadToPlayableMs', max: 10_000 });
    expect(evaluate(load, 12_500).message).toBe(
      'load-to-playable (loadToPlayableMs): 12500.00 ms exceeds budget ≤ 10000.00 ms by +2500.00 ms (+25.0%)',
    );
    expect(evaluate(load, 4_000)).toMatchObject({
      pass: true,
      delta: -6_000,
      message:
        'load-to-playable (loadToPlayableMs): 4000.00 ms within budget ≤ 10000.00 ms (−6000.00 ms (−60.0%))',
    });
    expect(evaluate(load, 10_000).pass).toBe(true); // ≤ is inside
  });

  it('AC-4: heap over 1.5 GB fails; a metric that was not measured fails too', () => {
    const heap = budget({
      id: 'heap-after-idle',
      metric: 'heapBytesAfterIdle',
      max: 1_500_000_000,
    });
    expect(evaluate(heap, 1_600_000_000)).toMatchObject({ pass: false, delta: 100_000_000 });
    expect(evaluate(heap, undefined)).toMatchObject({
      pass: false,
      value: undefined,
      delta: undefined,
      message: 'heap-after-idle (heapBytesAfterIdle): not measured (budget ≤ 1500.00 MB)',
    });
    expect(evaluate(heap, Number.NaN).pass).toBe(false);
  });

  it('counts have no percentage against a zero budget', () => {
    const tasks = budget({ id: 'long-tasks', metric: 'longTasksOver200ms', max: 0 });
    expect(evaluate(tasks, 2).message).toBe(
      'long-tasks (longTasksOver200ms): 2 exceeds budget ≤ 0 by +2',
    );
    expect(evaluate(tasks, 0).pass).toBe(true);
    expect(formatValue(1.234, 'ms')).toBe('1.23 ms');
  });

  it('selects budgets by mode and metric and judges each against its scene’s measurement', () => {
    const p95 = budget({
      id: 'frame-p95-high',
      metric: 'frameP95Ms',
      mode: 'reference',
      max: 16.7,
      scene: 'perf-baseline',
    });
    const all = [budget(), p95];
    expect(budgetsFor(all, 'ci')).toEqual([budget()]);
    expect(budgetsFor(all, 'reference', ['frameP95Ms'])).toEqual([p95]);
    expect(budgetsFor(all, 'reference', ['frameP50Ms'])).toEqual([]);
    const results = evaluateAll(all, [
      { metric: 'frameP95Ms', value: 30, scene: 'testbed' },
      { metric: 'frameP95Ms', value: 12, scene: 'perf-baseline' },
      { metric: 'initialTransferBytes', value: 1_000 },
    ]);
    expect(results.map((r) => [r.id, r.value, r.pass])).toEqual([
      ['initial-transfer', 1_000, true],
      ['frame-p95-high', 12, true],
    ]);
  });
});

describe('presets (mw-ju8.2 AC-1)', () => {
  const low = budget({
    id: 'valley-01-frame-p95-low',
    metric: 'frameP95Ms',
    mode: 'reference',
    max: 16.7,
    scene: 'valley-01',
    preset: 'low',
  });
  const high = { ...low, id: 'valley-01-frame-p95-high', preset: 'high' } as const;

  it('AC-1: a budget with a preset judges only the measurement at that preset (none means High)', () => {
    const at = (preset?: 'low' | 'high') => ({
      metric: 'frameP95Ms' as const,
      value: preset === 'low' ? 5 : 3,
      scene: 'valley-01',
      ...(preset === undefined ? {} : { preset }),
    });
    expect(measures(low, at('low'))).toBe(true);
    expect(measures(low, at('high'))).toBe(false);
    expect(measures(low, at())).toBe(false);
    expect(measures(high, at())).toBe(true);
    expect(measures(high, at('high'))).toBe(true);
    expect(measures({ ...low, scene: 'valley-02' }, at('low'))).toBe(false);
    expect(measures(budget({ preset: undefined }), { ...at('low'), metric: 'frameP95Ms' })).toBe(
      false,
    );
    const results = evaluateAll([low, high], [at('high'), at('low')]);
    expect(results.map((r) => [r.id, r.value])).toEqual([
      ['valley-01-frame-p95-low', 5],
      ['valley-01-frame-p95-high', 3],
    ]);
    expect(results[0]?.message).toContain('valley-01 at low');
  });

  it('AC-1: the committed budgets hold a p50, p95 and long-task budget per valley scene and preset', () => {
    const result = validateBudgets(committed, contract);
    const ids = new Set((result.ok ? result.budgets : []).map((b) => b.id));
    for (const scene of ['valley-01', 'valley-02', 'valley-03']) {
      for (const preset of ['high', 'low']) {
        for (const metric of ['frame-p50', 'frame-p95', 'long-tasks']) {
          expect(
            ids.has(
              metric === 'long-tasks'
                ? `${scene}-long-tasks-${preset}`
                : `${scene}-${metric}-${preset}`,
            ),
          ).toBe(true);
        }
      }
    }
  });
});

describe('pnpm perf:budgets (mw-e32.1 AC-6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'perf-budgets-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('passes the committed file and fails one without sources, one annotation per problem', () => {
    const log = vi.fn();
    expect(main([], log)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('citing the hardware baseline'));
    const bad = join(dir, 'bad.json');
    const unsourced: Record<string, unknown> = { ...budget() };
    delete unsourced['source'];
    writeFileSync(
      bad,
      JSON.stringify({ budgets: [unsourced, budget({ id: 'x', source: 'vibes' })] }),
    );
    const errors = vi.fn();
    expect(main([bad, DEFAULT_CONTRACT], errors)).toBe(1);
    expect(errors.mock.calls.map(([line]) => line as string)).toEqual([
      expect.stringMatching(
        /^::error title=Perf budgets,file=.*bad\.json::budgets\.0\.source: missing/,
      ),
      expect.stringMatching(/::budgets\.1\.source: must cite the baseline/),
      expect.stringMatching(/bad\.json is invalid:$/),
    ]);
    expect(() => loadBudgets(bad)).toThrow(/is invalid/);
  });

  it('the CLI sets the exit code', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const argv = process.argv;
    process.argv = ['node', 'budgets-cli.ts'];
    try {
      await import('./budgets-cli.ts');
    } finally {
      process.argv = argv;
    }
    expect(process.exitCode).toBe(0);
    expect(console.log).toHaveBeenCalled();
  });
});
