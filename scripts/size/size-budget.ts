// Size budgets over the production build, per PR (mw-e32.3). Run through scripts/size/size-budget-cli.ts
// after `pnpm build`.
//
// Definitions (decimal MB, like perf/perf-budgets.json):
// - Initial JS: the JavaScript dist/index.html loads eagerly, i.e. its module script plus every
//   modulepreload link, each gzipped at level 9, summed. Lazy chunks are not initial JS.
// - Initial payload: raw bytes of everything the game page can fetch: index.html, the eager JS above,
//   every JS chunk reachable from it through dynamic imports (physics, debug console, scene content),
//   and every other file under dist/ (assets, wasm, stylesheets). The testbed pages and chunks only
//   they use are not part of the game download, source maps are not shipped. Both encodings of an
//   audio file count, so this overstates what one browser fetches and errs on the safe side.
// - Per-asset caps (perf/size-budgets.json): textures and audio loops (music and ambience, not
//   stingers). A waiver in the same file raises one named file's ceiling, with its reason and bead.
// - Dev tools: no module under src/tools/ may be in any chunk (chunk-modules.json, chunk-report.ts).

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DEFAULT_CHUNK_REPORT, type ChunkReport } from './chunk-report.ts';

export const DEFAULT_BUDGETS = 'perf/size-budgets.json';
export const DEFAULT_OUT = 'build-report/size-report.json';
const TITLE = 'Size budget';

export interface AssetCap {
  readonly kind: string;
  readonly label: string;
  readonly maxBytes: number;
  readonly extensions: readonly string[];
  readonly pathPattern?: string;
  readonly excludePathPattern?: string;
}

export interface Waiver {
  readonly file: string;
  readonly maxBytes: number;
  readonly reason: string;
  readonly bead: string;
}

/** A src/tools path prefix known to be in the bundle until its bead moves it behind a lazy import. */
export interface ToolWaiver {
  readonly prefix: string;
  readonly reason: string;
  readonly bead: string;
}

export interface SizeBudgets {
  readonly initialJsGzipBytes: number;
  readonly initialPayloadBytes: number;
  readonly assetCaps: readonly AssetCap[];
  readonly forbiddenSourceDirs: readonly string[];
  readonly toolWaivers: readonly ToolWaiver[];
  readonly waivers: readonly Waiver[];
}

export interface AssetSize {
  readonly file: string;
  readonly kind: string;
  readonly bytes: number;
}

/** What one build measures; also the baseline file main's CI run publishes. */
export interface SizeReport {
  readonly schema: 1;
  readonly initialJsGzipBytes: number;
  readonly initialPayloadBytes: number;
  readonly eagerJs: readonly { readonly file: string; readonly gzipBytes: number }[];
  readonly assets: readonly AssetSize[];
}

/** "4 MB", "3.65 MB". */
export const mb = (bytes: number): string => `${String(Number((bytes / 1e6).toFixed(2)))} MB`;

const signed = (delta: number): string => `${delta >= 0 ? '+' : '-'}${mb(Math.abs(delta))}`;

const vsMain = (now: number, before: number | undefined): string =>
  before === undefined ? '' : ` (${signed(now - before)} vs main's ${mb(before)})`;

export function parseBudgets(json: string): SizeBudgets {
  const budgets = JSON.parse(json) as SizeBudgets;
  const bad = (what: string): never => {
    throw new Error(`Invalid size budgets: ${what}`);
  };
  if (!(budgets.initialJsGzipBytes > 0)) bad('initialJsGzipBytes must be a positive number');
  if (!(budgets.initialPayloadBytes > 0)) bad('initialPayloadBytes must be a positive number');
  for (const cap of budgets.assetCaps) {
    if (!(cap.maxBytes > 0)) bad(`asset cap "${cap.kind}" needs a positive maxBytes`);
  }
  for (const w of [...budgets.waivers, ...budgets.toolWaivers]) {
    if (w.reason === '' || !/^mw-[a-z0-9.]+$/.test(w.bead)) {
      bad(`a waiver (${'file' in w ? w.file : w.prefix}) needs a reason and a bead id`);
    }
  }
  return budgets;
}

/** Files index.html loads eagerly: module scripts, modulepreload and stylesheet links (dist-relative). */
export function eagerFiles(html: string): string[] {
  const files = new Set<string>();
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const isScript = tag.startsWith('<script');
    if (!isScript && !/rel="(?:modulepreload|stylesheet)"/.test(tag)) continue;
    const url = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (url !== undefined && !/^(?:[a-z]+:|data:)/.test(url)) files.add(url.replace(/^\.?\//, ''));
  }
  return [...files];
}

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

const isJs = (file: string): boolean => file.endsWith('.js');

/** JS chunks reachable from the eager set through static and dynamic imports. */
function reachableChunks(eager: readonly string[], report: ChunkReport): Set<string> {
  const byFile = new Map(report.chunks.map((c) => [c.file, c]));
  const seen = new Set<string>();
  const queue = [...eager];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const chunk = byFile.get(file);
    if (chunk !== undefined) queue.push(...chunk.imports, ...chunk.dynamicImports);
  }
  return seen;
}

function assetKind(file: string, caps: readonly AssetCap[]): string | undefined {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return caps.find(
    (c) =>
      c.extensions.includes(ext) &&
      (c.pathPattern === undefined || new RegExp(c.pathPattern).test(file)) &&
      (c.excludePathPattern === undefined || !new RegExp(c.excludePathPattern).test(file)),
  )?.kind;
}

/** Measures a built dist/ directory. */
export function measureDist(
  distDir: string,
  report: ChunkReport,
  budgets: SizeBudgets,
): SizeReport {
  const size = (file: string): number => statSync(join(distDir, file)).size;
  const eager = eagerFiles(readFileSync(join(distDir, 'index.html'), 'utf8'));
  const eagerJs = eager.filter(isJs).map((file) => ({
    file,
    gzipBytes: gzipSync(readFileSync(join(distDir, file)), { level: 9 }).length,
  }));
  const lazyOk = reachableChunks(eager.filter(isJs), report);
  let initialPayloadBytes = 0;
  const assets: AssetSize[] = [];
  for (const file of walk(distDir).sort()) {
    if (file.endsWith('.map') || file.startsWith('testbed/')) continue;
    if (file.endsWith('.html') && file !== 'index.html') continue;
    if (isJs(file) && !lazyOk.has(file)) continue;
    const bytes = size(file);
    initialPayloadBytes += bytes;
    const kind = assetKind(file, budgets.assetCaps);
    if (kind !== undefined) assets.push({ file, kind, bytes });
  }
  return {
    schema: 1,
    initialJsGzipBytes: eagerJs.reduce((sum, f) => sum + f.gzipBytes, 0),
    initialPayloadBytes,
    eagerJs,
    assets,
  };
}

/** Every (module, chunk) pair that is under a forbidden source directory. */
export function forbiddenModules(
  report: ChunkReport,
  budgets: Pick<SizeBudgets, 'forbiddenSourceDirs' | 'toolWaivers'>,
): { module: string; chunk: string }[] {
  return report.chunks.flatMap((chunk) =>
    chunk.modules
      .filter(
        (m) =>
          budgets.forbiddenSourceDirs.some((d) => m.startsWith(d)) &&
          !budgets.toolWaivers.some((w) => m.startsWith(w.prefix)),
      )
      .map((module) => ({ module, chunk: chunk.file })),
  );
}

/** One message per broken budget; empty when the build is within every budget. */
export function violations(
  current: SizeReport,
  report: ChunkReport,
  budgets: SizeBudgets,
  base?: SizeReport,
): string[] {
  const out: string[] = [];
  if (current.initialJsGzipBytes > budgets.initialJsGzipBytes) {
    const delta = vsMain(current.initialJsGzipBytes, base?.initialJsGzipBytes);
    out.push(
      `Initial JS is ${mb(current.initialJsGzipBytes)} gzipped, over the ${mb(budgets.initialJsGzipBytes)} cap${delta}.`,
    );
  }
  if (current.initialPayloadBytes > budgets.initialPayloadBytes) {
    const delta = vsMain(current.initialPayloadBytes, base?.initialPayloadBytes);
    out.push(
      `Initial payload is ${mb(current.initialPayloadBytes)}, over the ${mb(budgets.initialPayloadBytes)} cap${delta}.`,
    );
  }
  for (const cap of budgets.assetCaps) {
    for (const asset of current.assets.filter((a) => a.kind === cap.kind)) {
      const waiver = budgets.waivers.find((w) => w.file === asset.file);
      const max = waiver?.maxBytes ?? cap.maxBytes;
      if (asset.bytes <= max) continue;
      out.push(
        waiver === undefined
          ? `${asset.file} is ${mb(asset.bytes)}, over the ${mb(cap.maxBytes)} ${cap.label} cap.`
          : `${asset.file} is ${mb(asset.bytes)}, over its waived ${mb(max)} ceiling (${cap.label} cap ${mb(cap.maxBytes)}, waiver ${waiver.bead}).`,
      );
    }
  }
  for (const f of forbiddenModules(report, budgets)) {
    out.push(`${f.module} (a dev tool) is bundled in production chunk ${f.chunk}.`);
  }
  return out;
}

/** Waivers that no longer cover anything (file within the plain cap or gone, prefix unmatched). */
export function staleWaivers(
  current: SizeReport,
  report: ChunkReport,
  budgets: SizeBudgets,
): { name: string; bead: string }[] {
  const modules = report.chunks.flatMap((c) => c.modules);
  const files = budgets.waivers
    .filter((w) => {
      const asset = current.assets.find((a) => a.file === w.file);
      const cap = budgets.assetCaps.find((c) => c.kind === asset?.kind);
      return asset === undefined || (cap !== undefined && asset.bytes <= cap.maxBytes);
    })
    .map((w) => ({ name: w.file, bead: w.bead }));
  const tools = budgets.toolWaivers
    .filter((w) => !modules.some((m) => m.startsWith(w.prefix)))
    .map((w) => ({ name: w.prefix, bead: w.bead }));
  return [...files, ...tools];
}

function largest(report: SizeReport, kind: string): AssetSize | undefined {
  return report.assets.filter((a) => a.kind === kind).sort((a, b) => b.bytes - a.bytes)[0];
}

/** Markdown for the job summary: totals against the caps, and the change since main when known. */
export function formatSummary(
  current: SizeReport,
  budgets: SizeBudgets,
  problems: readonly string[],
  base?: SizeReport,
): string {
  const row = (name: string, now: number, before: number | undefined, cap: number): string =>
    `| ${name} | ${before === undefined ? 'n/a' : mb(before)} | ${mb(now)} | ${before === undefined ? 'n/a' : signed(now - before)} | ${mb(cap)} | ${now > cap ? 'over' : 'ok'} |`;
  const lines = [
    '## Size budgets',
    '',
    base === undefined
      ? 'No size report from main to compare with yet: showing the build alone.'
      : "Compared with main's last successful CI run.",
    '',
    '| Metric | main | This build | Delta | Cap | |',
    '|---|---|---|---|---|---|',
    row(
      'Initial JS (gzip)',
      current.initialJsGzipBytes,
      base?.initialJsGzipBytes,
      budgets.initialJsGzipBytes,
    ),
    row(
      'Initial payload',
      current.initialPayloadBytes,
      base?.initialPayloadBytes,
      budgets.initialPayloadBytes,
    ),
  ];
  for (const cap of budgets.assetCaps) {
    const now = largest(current, cap.kind);
    const before = base === undefined ? undefined : largest(base, cap.kind);
    lines.push(
      row(
        `Largest ${cap.label}${now === undefined ? '' : ` (\`${now.file}\`)`}`,
        now?.bytes ?? 0,
        before?.bytes,
        cap.maxBytes,
      ),
    );
  }
  if (base !== undefined) {
    const before = new Map(base.assets.map((a) => [a.file, a.bytes]));
    const changed = current.assets.flatMap((a) => {
      const was = before.get(a.file);
      if (was === a.bytes) return [];
      return [`\`${a.file}\` ${was === undefined ? `new, ${mb(a.bytes)}` : signed(a.bytes - was)}`];
    });
    if (changed.length > 0) lines.push('', `Capped assets changed: ${changed.join(', ')}.`);
  }
  if (problems.length > 0) lines.push('', '**Over budget**', '', ...problems.map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

export interface Io {
  readonly log: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * `[--dist dist] [--chunks build-report/chunk-modules.json] [--budgets perf/size-budgets.json]
 * [--baseline <main's size-report.json>] [--out build-report/size-report.json]`. Writes the measured
 * report to --out, a table to $GITHUB_STEP_SUMMARY, an error annotation per broken budget, and returns
 * 1 if any budget is broken. A missing baseline only drops the delta columns.
 */
export function main(argv: readonly string[], io: Io): number {
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : (argv[i + 1] ?? fallback);
  };
  const dist = arg('--dist', 'dist');
  const chunksPath = arg('--chunks', DEFAULT_CHUNK_REPORT);
  if (!existsSync(join(dist, 'index.html')) || !existsSync(chunksPath)) {
    io.log(
      `::error title=${TITLE}::Need a production build: ${dist}/index.html and ${chunksPath} (written by pnpm build) are missing.`,
    );
    return 2;
  }
  const budgets = parseBudgets(readFileSync(arg('--budgets', DEFAULT_BUDGETS), 'utf8'));
  const chunks = JSON.parse(readFileSync(chunksPath, 'utf8')) as ChunkReport;
  const current = measureDist(dist, chunks, budgets);
  writeFileSync(arg('--out', DEFAULT_OUT), `${JSON.stringify(current, null, 2)}\n`);

  const basePath = arg('--baseline', '');
  const base =
    basePath !== '' && existsSync(basePath)
      ? (JSON.parse(readFileSync(basePath, 'utf8')) as SizeReport)
      : undefined;
  if (base === undefined)
    io.log(
      `::notice title=${TITLE}::No size report from main to compare with yet; showing no delta.`,
    );

  const problems = violations(current, chunks, budgets, base);
  for (const w of staleWaivers(current, chunks, budgets)) {
    io.log(
      `::warning title=${TITLE}::The waiver for ${w.name} (${w.bead}) is no longer needed; remove it.`,
    );
  }
  for (const p of problems) io.log(`::error title=${TITLE}::${p}`);
  io.log(
    `Initial JS ${mb(current.initialJsGzipBytes)} gz (cap ${mb(budgets.initialJsGzipBytes)}), initial payload ${mb(current.initialPayloadBytes)} (cap ${mb(budgets.initialPayloadBytes)}), ${String(problems.length)} problem(s).`,
  );
  const summary = io.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, formatSummary(current, budgets, problems, base));
  }
  return problems.length === 0 ? 0 : 1;
}
