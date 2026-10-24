// Duration-weighted e2e sharding (mw-e41.1). Playwright's own --shard splits by file order and test
// count, which left one CI shard at 600-810 s beside others at 330-670 s; the slowest shard sets the
// PR's wall clock. This plans shards from measured per-spec durations (e2e/shards.json, regenerated
// from a Playwright JSON report) with longest-processing-time-first assignment. Specs the file has
// not seen yet get the median weight, so adding a spec never breaks CI; it just is not tuned yet.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Spec file basenames to seconds, as stored in e2e/shards.json. */
export type Durations = Readonly<Record<string, number>>;

/** Specs the chromium shards do not run: the playthrough has a runner of its own (ci.yml). */
export const SHARD_EXCLUDED: readonly string[] = ['slice-playthrough.spec.ts'];

/** Every spec file basename in the e2e directory the chromium shards are responsible for. */
export function listShardSpecs(e2eDir: string): string[] {
  return readdirSync(e2eDir)
    .filter((name) => name.endsWith('.spec.ts') && !SHARD_EXCLUDED.includes(name))
    .sort();
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  // One middle element for an odd count, the two middle elements for an even one.
  const middle = sorted.slice(
    Math.floor((sorted.length - 1) / 2),
    Math.floor(sorted.length / 2) + 1,
  );
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

/** The weight used for a spec: its recorded duration, else the median of the recorded ones. */
export function weightOf(spec: string, durations: Durations, fallback: number): number {
  const recorded = durations[spec];
  return recorded !== undefined && recorded > 0 ? recorded : fallback;
}

/**
 * Splits specs into `count` shards, heaviest first onto the currently lightest shard. Deterministic:
 * ties break on spec name and then shard index, and every shard's list is sorted.
 */
export function assignShards(
  specs: readonly string[],
  durations: Durations,
  count: number,
): string[][] {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`shard count must be a positive integer, got ${String(count)}`);
  const fallback = median(
    specs.flatMap((spec) => {
      const recorded = durations[spec];
      return recorded === undefined ? [] : [recorded];
    }),
  );
  const weighted = specs
    .map((spec) => ({ spec, weight: weightOf(spec, durations, fallback) }))
    .sort((a, b) => b.weight - a.weight || a.spec.localeCompare(b.spec));
  const shards: { specs: string[]; total: number }[] = Array.from({ length: count }, () => ({
    specs: [],
    total: 0,
  }));
  for (const { spec, weight } of weighted) {
    const lightest = shards.reduce((best, shard) => (shard.total < best.total ? shard : best));
    lightest.specs.push(spec);
    lightest.total += weight;
  }
  return shards.map((shard) => shard.specs.sort());
}

interface JsonResult {
  duration?: number;
}
interface JsonTest {
  projectName?: string;
  results?: JsonResult[];
}
interface JsonSpec {
  file?: string;
  tests?: JsonTest[];
}
interface JsonSuite {
  file?: string;
  suites?: JsonSuite[];
  specs?: JsonSpec[];
}

/**
 * Per-spec-file seconds from a Playwright JSON report: the sum of each test's final attempt in that
 * file (tests within a file run one after another, so the sum is the file's cost). Earlier failed
 * attempts are left out: retries are flake noise, and weighting by them would pile weight onto the
 * flakiest specs instead of the slowest.
 */
export function durationsFromReport(report: unknown, project = 'chromium'): Record<string, number> {
  const totals = new Map<string, number>();
  const visit = (suite: JsonSuite): void => {
    for (const spec of suite.specs ?? []) {
      const file = (spec.file ?? suite.file ?? '').split('/').pop();
      if (!file) continue;
      for (const test of spec.tests ?? []) {
        if (test.projectName !== undefined && test.projectName !== project) continue;
        for (const result of (test.results ?? []).slice(-1)) {
          totals.set(file, (totals.get(file) ?? 0) + (result.duration ?? 0) / 1000);
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  const root = report as JsonSuite;
  visit(root);
  return Object.fromEntries(
    [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, seconds]) => [file, Math.round(seconds * 10) / 10]),
  );
}

/**
 * Averages several runs' per-spec seconds (each from durationsFromReport; one run's shard reports
 * hold disjoint specs, so a spec appears at most once per run). A single noisy CI run then cannot
 * skew the weights.
 */
export function averageDurations(runs: readonly Record<string, number>[]): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const run of runs) {
    for (const [file, seconds] of Object.entries(run)) {
      const entry = sums.get(file) ?? { total: 0, count: 0 };
      sums.set(file, { total: entry.total + seconds, count: entry.count + 1 });
    }
  }
  return Object.fromEntries(
    [...sums.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, { total, count }]) => [file, Math.round((total / count) * 10) / 10]),
  );
}

export interface ShardIo {
  e2eDir: string;
  shardsFile: string;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  log(line: string): void;
  error(line: string): void;
}

/** The real file system and console; tests pass fakes or point it at a temporary directory. */
export const fileIo: ShardIo = {
  e2eDir: 'e2e',
  shardsFile: 'e2e/shards.json',
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, text) => {
    writeFileSync(path, text);
  },
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
};

const USAGE = 'usage: e2e-shards-cli.ts files <shard> <count> | regenerate <report.json>...';

/**
 * CLI logic (see e2e-shards-cli.ts): `files <shard> <count>` prints the spec paths for one chromium
 * shard (1-based); `regenerate <report.json>...` rewrites e2e/shards.json from Playwright JSON reports (averaged).
 * Returns the process exit code.
 */
export function main(args: readonly string[], io: ShardIo = fileIo): number {
  const [command, first, second] = args;
  if (command === 'files') {
    const shard = Number(first);
    const count = Number(second);
    if (!Number.isInteger(shard) || !Number.isInteger(count) || shard < 1 || shard > count) {
      io.error('usage: e2e-shards-cli.ts files <shard> <count>, with 1 <= shard <= count');
      return 2;
    }
    const stored = JSON.parse(io.readText(io.shardsFile)) as { durations: Durations };
    const plan = assignShards(listShardSpecs(io.e2eDir), stored.durations, count);
    io.log(
      plan
        .slice(shard - 1, shard)
        .flat()
        .map((spec) => `${io.e2eDir}/${spec}`)
        .join(' '),
    );
    return 0;
  }
  if (command === 'regenerate' && first !== undefined) {
    // One report per shard: merge reports of the same run, and pass several runs' worth to average.
    // A spec's seconds are averaged over the reports that contain it.
    const reports = args.slice(1).map((path) => durationsFromReport(JSON.parse(io.readText(path))));
    const durations = averageDurations(reports);
    const body = {
      note: 'Seconds per spec file in the chromium project, from a Playwright JSON report. Regenerate with pnpm e2e:shards:regenerate <report.json>. Specs missing here get the median weight.',
      durations,
    };
    io.writeText(io.shardsFile, `${JSON.stringify(body, null, 2)}\n`);
    io.log(`Wrote ${io.shardsFile} (${String(Object.keys(durations).length)} specs).`);
    return 0;
  }
  io.error(USAGE);
  return 2;
}
