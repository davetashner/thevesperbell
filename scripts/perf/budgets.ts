// Perf budgets (mw-e32.1): perf/perf-budgets.json lists what the perf suite enforces, and every number
// in it comes from the hardware baseline in docs/backlog-contract.md §1 — stories cite it rather than
// invent new ones. Each budget therefore carries a `source` that cites the baseline verbatim:
//
//   "source": "docs/backlog-contract.md §1 Hardware baseline: initial download ≤ 50 MB"
//
// Validation (AC-6) fails a budget without such a source, and, given the contract's text, one whose
// quoted words are not in the contract's Hardware baseline section. `evaluate` judges a measured
// value against a budget and names the metric and the delta when it is over (AC-2).

import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** Every source starts with this, then `: ` and words quoted verbatim from that section. */
export const BASELINE_SOURCE_PREFIX = 'docs/backlog-contract.md §1 Hardware baseline';

/** What the suite measures, with the unit each value is in. */
export const PERF_METRICS = {
  /** Bytes over the network from navigation until the game is playable and the network is quiet. */
  initialTransferBytes: 'bytes',
  /** Bytes of the production build (dist/, source maps excluded). */
  bundleBytes: 'bytes',
  /** Cold load at 50 Mbps: navigation start to the scene being loaded and drawn. */
  loadToPlayableMs: 'ms',
  /** The same with the browser cache warm. */
  warmReloadMs: 'ms',
  /** Warm reload of the front door: navigation start to the first frame drawn (data-first-frame-ms). */
  firstFrameMs: 'ms',
  /** Front door cold at 50 Mbps: title shown, then New Game → Knight → Confirm to playable, leaving out reading time. */
  frontDoorLoadMs: 'ms',
  /** Death screen "Load last save" pressed to the first sim step from the save (warm). */
  saveLoadToPlayableMs: 'ms',
  /** Title "Continue" pressed to the first sim step from the save (warm). */
  continueToPlayableMs: 'ms',
  /** Death screen "Restart area" pressed to the first sim step of the new world (warm). */
  restartToPlayableMs: 'ms',
  /** Crossing an area transition volume to the first sim step of the next area (warm). */
  transitionToPlayableMs: 'ms',
  /** JS heap (allocated) after idling in the testbed. */
  heapBytesAfterIdle: 'bytes',
  /** Main-thread tasks of 200 ms or more while frames are sampled, frame renders included. */
  longTasksOver200ms: 'count',
  /**
   * The same, leaving out tasks that are frame renders (overlap a requestAnimationFrame callback):
   * GC, parsing, timers. What CI can judge, where software rendering makes every frame a long task.
   */
  nonFrameLongTasksOver200ms: 'count',
  /** Move key's keydown to the end of the first frame the player's drawn transform changed, p95 of 50 presses (mw-e02.8). */
  inputToMotionP95Ms: 'ms',
  /** Wall time of one character controller system run (one sim tick), p95 over 60 s of traversal. */
  controllerTickP95Ms: 'ms',
  /** Wall time of one orbit camera placement (one drawn frame), p95 over 60 s of traversal. */
  cameraFrameP95Ms: 'ms',
  /** Frame interval percentiles in a scene, ms. */
  frameP50Ms: 'ms',
  frameP95Ms: 'ms',
} as const;

export type PerfMetric = keyof typeof PERF_METRICS;
export type PerfUnit = (typeof PERF_METRICS)[PerfMetric];

/** CI mode runs on GPU-less runners; reference mode on the reference machine (contract §1). */
export const PERF_MODES = ['ci', 'reference'] as const;
export type PerfMode = (typeof PERF_MODES)[number];

const metricIds = Object.keys(PERF_METRICS) as [PerfMetric, ...PerfMetric[]];

const budgetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  metric: z.enum(metricIds),
  mode: z.enum(PERF_MODES),
  max: z.number().nonnegative(),
  source: z
    .string({ error: `missing: cite the baseline as "${BASELINE_SOURCE_PREFIX}: <its words>"` })
    .refine((source) => quoteOf(source) !== undefined, {
      message: `must cite the baseline as "${BASELINE_SOURCE_PREFIX}: <its words>"`,
    }),
  scene: z.string().optional(),
  preset: z.enum(['low', 'high']).optional(),
  note: z.string().optional(),
});

export type PerfBudget = z.infer<typeof budgetSchema>;

const fileSchema = z.strictObject({
  $comment: z.string().optional(),
  budgets: z.array(budgetSchema).min(1),
});

/** The words a source quotes from the baseline, or undefined when it does not cite it. */
export function quoteOf(source: string): string | undefined {
  const prefix = `${BASELINE_SOURCE_PREFIX}: `;
  if (!source.startsWith(prefix)) return undefined;
  const quote = source.slice(prefix.length).trim();
  return quote === '' ? undefined : quote;
}

/** The Hardware baseline section of the contract (up to the next heading), or ''. */
export function baselineSection(contract: string): string {
  const start = contract.indexOf('### Hardware baseline');
  if (start === -1) return '';
  const rest = contract.slice(start);
  const end = rest.slice(1).search(/\n#{1,3} /);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** Markdown emphasis and runs of whitespace removed, so quotes can match across bold and wraps. */
const plain = (text: string): string => text.replaceAll('*', '').replace(/\s+/g, ' ');

export type BudgetValidation =
  | { readonly ok: true; readonly budgets: readonly PerfBudget[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validates a parsed budget file (AC-6). With `contract` (the text of docs/backlog-contract.md), every
 * source's quoted words must also appear in its Hardware baseline section.
 */
export function validateBudgets(json: unknown, contract?: string): BudgetValidation {
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join('.');
        return `${path === '' ? '(file)' : path}: ${issue.message}`;
      }),
    };
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  const section = contract === undefined ? undefined : plain(baselineSection(contract));
  parsed.data.budgets.forEach((budget, i) => {
    if (seen.has(budget.id)) errors.push(`budgets.${String(i)}.id: duplicate id "${budget.id}"`);
    seen.add(budget.id);
    const quote = plain(budget.source.slice(BASELINE_SOURCE_PREFIX.length + 1)).trim();
    if (section !== undefined && !section.includes(quote)) {
      errors.push(
        `budgets.${String(i)}.source: "${quote}" is not in the contract's Hardware baseline section`,
      );
    }
  });
  return errors.length === 0 ? { ok: true, budgets: parsed.data.budgets } : { ok: false, errors };
}

/** Reads and validates a budget file; throws listing every problem. */
export function loadBudgets(path: string, contractPath?: string): readonly PerfBudget[] {
  const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const contract = contractPath === undefined ? undefined : readFileSync(contractPath, 'utf8');
  const result = validateBudgets(json, contract);
  if (!result.ok) throw new Error(`${path} is invalid:\n  ${result.errors.join('\n  ')}`);
  return result.budgets;
}

/** One budget judged against what was measured. */
export interface BudgetResult {
  readonly id: string;
  readonly metric: PerfMetric;
  readonly unit: PerfUnit;
  readonly max: number;
  /** Undefined when the run did not measure it (a failure). */
  readonly value: number | undefined;
  /** value − max (positive: over budget); undefined when not measured. */
  readonly delta: number | undefined;
  readonly pass: boolean;
  /** One line naming the budget, metric, value and delta vs budget. */
  readonly message: string;
  readonly source: string;
}

/** A value in its unit for people: MB for bytes, ms to two places, counts as integers. */
export function formatValue(value: number, unit: PerfUnit): string {
  if (unit === 'bytes') return `${(value / 1_000_000).toFixed(2)} MB`;
  if (unit === 'ms') return `${value.toFixed(2)} ms`;
  return String(value);
}

const signed = (text: string, n: number): string => (n >= 0 ? `+${text}` : `−${text}`);

/** Judges `value` against `budget` (AC-2: a failure names the metric and the delta vs budget). */
export function evaluate(budget: PerfBudget, value: number | undefined): BudgetResult {
  const unit = PERF_METRICS[budget.metric];
  const base = {
    id: budget.id,
    metric: budget.metric,
    unit,
    max: budget.max,
    source: budget.source,
  };
  const name = `${budget.id} (${budget.metric}${budget.scene === undefined ? '' : ` in ${budget.scene}`}${budget.preset === undefined ? '' : ` at ${budget.preset}`})`;
  if (value === undefined || !Number.isFinite(value)) {
    return {
      ...base,
      value: undefined,
      delta: undefined,
      pass: false,
      message: `${name}: not measured (budget ≤ ${formatValue(budget.max, unit)})`,
    };
  }
  const delta = value - budget.max;
  const pass = delta <= 0;
  const percent =
    budget.max === 0
      ? ''
      : ` (${signed(`${Math.abs((delta / budget.max) * 100).toFixed(1)}%`, delta)})`;
  const deltaText = `${signed(formatValue(Math.abs(delta), unit), delta)}${percent}`;
  return {
    ...base,
    value,
    delta,
    pass,
    message: pass
      ? `${name}: ${formatValue(value, unit)} within budget ≤ ${formatValue(budget.max, unit)} (${deltaText})`
      : `${name}: ${formatValue(value, unit)} exceeds budget ≤ ${formatValue(budget.max, unit)} by ${deltaText}`,
  };
}

/** The budgets of `mode`, optionally only those for `metrics`. */
export function budgetsFor(
  budgets: readonly PerfBudget[],
  mode: PerfMode,
  metrics?: readonly PerfMetric[],
): PerfBudget[] {
  return budgets.filter(
    (b) => b.mode === mode && (metrics === undefined || metrics.includes(b.metric)),
  );
}

/** A value measured by the suite for one metric (and the scene and preset it was measured in, if any). */
export interface Measurement {
  readonly metric: PerfMetric;
  readonly value: number;
  readonly scene?: string;
  /** The quality preset measured; absent means High, the default. */
  readonly preset?: 'low' | 'high';
}

/**
 * Whether `measurement` is the value `budget` judges: same metric, in the budget's scene when it names
 * one, and at the budget's preset when it names one (a measurement with no preset is High).
 */
export function measures(budget: PerfBudget, measurement: Measurement): boolean {
  return (
    measurement.metric === budget.metric &&
    (budget.scene === undefined || measurement.scene === budget.scene) &&
    (budget.preset === undefined || (measurement.preset ?? 'high') === budget.preset)
  );
}

/** Judges every budget against the measurement of its metric (and scene, when it names one). */
export function evaluateAll(
  budgets: readonly PerfBudget[],
  measurements: readonly Measurement[],
): BudgetResult[] {
  return budgets.map((budget) =>
    evaluate(budget, measurements.find((m) => measures(budget, m))?.value),
  );
}
