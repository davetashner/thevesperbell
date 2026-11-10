import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChunkReport } from './chunk-report.ts';
import {
  eagerFiles,
  forbiddenModules,
  formatSummary,
  main,
  mb,
  measureDist,
  parseBudgets,
  staleWaivers,
  violations,
  type SizeBudgets,
  type SizeReport,
} from './size-budget.ts';

const budgets: SizeBudgets = parseBudgets(readFileSync('perf/size-budgets.json', 'utf8'));
const testBudgets: SizeBudgets = {
  ...budgets,
  toolWaivers: [],
  waivers: [],
};

const HTML = `<!doctype html><html><head>
<link rel="icon" href="data:," />
<link rel="stylesheet" href="/assets/app.css">
<script type="module" crossorigin src="/assets/main.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor.js">
<link rel="modulepreload" href="https://cdn.example/x.js">
<script src="./assets/vendor.js"></script>
<script>inline()</script>
</head><body></body></html>`;

const chunkReport: ChunkReport = {
  chunks: [
    {
      file: 'assets/main.js',
      isEntry: true,
      imports: ['assets/vendor.js'],
      dynamicImports: ['assets/lazy.js'],
      modules: ['src/main.ts'],
    },
    {
      file: 'assets/vendor.js',
      isEntry: false,
      imports: [],
      dynamicImports: [],
      modules: ['node_modules/three/x.js'],
    },
    {
      file: 'assets/lazy.js',
      isEntry: false,
      imports: [],
      dynamicImports: [],
      modules: ['src/sim/a.ts'],
    },
    {
      file: 'assets/testbed.js',
      isEntry: true,
      imports: ['assets/vendor.js'],
      dynamicImports: [],
      modules: ['testbed/x.ts'],
    },
  ],
};

const mainChunk = (modules: string[]): ChunkReport['chunks'][number] => ({
  file: 'assets/main.js',
  isEntry: true,
  imports: [],
  dynamicImports: [],
  modules,
});

describe('size budgets', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'size-budget-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const put = (file: string, data: Buffer | string): void => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), data);
  };
  const buildDist = (extra: (p: typeof put) => void = () => undefined): string => {
    const dist = join(dir, 'dist');
    const w = (file: string, data: Buffer | string): void => {
      put(join('dist', file), data);
    };
    w('index.html', HTML);
    w('assets/main.js', 'main();'.repeat(100));
    w('assets/vendor.js', 'vendor();');
    w('assets/lazy.js', 'lazy();');
    w('assets/testbed.js', 'testbed();'.repeat(50));
    w('assets/app.css', 'body{}');
    w('assets/main.js.map', 'x'.repeat(5000));
    w('assets/texture/wall.webp', Buffer.alloc(1000));
    w('assets/audio/music/theme.ogg', Buffer.alloc(2000));
    w('assets/audio/music/music-stinger-a.ogg', Buffer.alloc(3_500_000));
    w('assets/audio/sfx/hit.ogg', Buffer.alloc(3_500_000));
    w('assets/model/knight.glb', Buffer.alloc(500));
    w('testbed/audio.html', '<html></html>');
    w('other.html', '<html></html>');
    extra(w);
    return dist;
  };
  const writeInputs = (dist: string, report: ChunkReport = chunkReport): { chunks: string } => {
    const chunks = join(dir, 'chunk-modules.json');
    writeFileSync(chunks, JSON.stringify(report));
    expect(dist).toContain('dist');
    return { chunks };
  };
  const run = (
    dist: string,
    chunks: string,
    extra: string[] = [],
    env: Record<string, string> = {},
  ) => {
    const lines: string[] = [];
    const code = main(
      [
        '--dist',
        dist,
        '--chunks',
        chunks,
        '--budgets',
        'perf/size-budgets.json',
        '--out',
        join(dir, 'size-report.json'),
        ...extra,
      ],
      { log: (l) => lines.push(l), env },
    );
    return { code, lines };
  };

  it('formats decimal megabytes', () => {
    expect(mb(4_000_000)).toBe('4 MB');
    expect(mb(3_654_960)).toBe('3.65 MB');
  });

  it('reads the committed budgets: the caps from the bead, waivers with a reason and bead', () => {
    expect(budgets.initialJsGzipBytes).toBe(1_500_000);
    expect(budgets.initialPayloadBytes).toBe(50_000_000);
    expect(budgets.assetCaps.map((c) => [c.kind, c.maxBytes])).toEqual([
      ['texture', 4_000_000],
      ['audioLoop', 3_000_000],
    ]);
    expect(budgets.forbiddenSourceDirs).toEqual(['src/tools/']);
  });

  it('rejects malformed budgets', () => {
    const bad = (patch: object): string => JSON.stringify({ ...budgets, ...patch });
    expect(() => parseBudgets(bad({ initialJsGzipBytes: 0 }))).toThrow(/initialJsGzipBytes/);
    expect(() => parseBudgets(bad({ initialPayloadBytes: 0 }))).toThrow(/initialPayloadBytes/);
    expect(() => parseBudgets(bad({ assetCaps: [{ kind: 'x', maxBytes: 0 }] }))).toThrow(/"x"/);
    expect(() =>
      parseBudgets(bad({ waivers: [{ file: 'a.ogg', maxBytes: 1, reason: '', bead: 'mw-x' }] })),
    ).toThrow(/a\.ogg/);
    expect(() =>
      parseBudgets(bad({ toolWaivers: [{ prefix: 'src/tools/a/', reason: 'r', bead: 'later' }] })),
    ).toThrow(/src\/tools\/a\//);
  });

  it('finds what index.html loads eagerly: module script, modulepreload and stylesheet, not data or remote', () => {
    expect(eagerFiles(HTML)).toEqual(['assets/app.css', 'assets/main.js', 'assets/vendor.js']);
  });

  it('measures initial JS as gzip of the eager chunks and payload as the game download', () => {
    const dist = buildDist();
    const report = measureDist(dist, chunkReport, testBudgets);
    expect(report.eagerJs.map((f) => f.file)).toEqual(['assets/main.js', 'assets/vendor.js']);
    expect(report.initialJsGzipBytes).toBe(report.eagerJs.reduce((s, f) => s + f.gzipBytes, 0));
    const size = (f: string): number => readFileSync(join(dist, f)).length;
    // index.html, eager + lazy JS, css, and every non-JS file; no testbed page or chunk, no source map.
    const expected = [
      'index.html',
      'assets/main.js',
      'assets/vendor.js',
      'assets/lazy.js',
      'assets/app.css',
      'assets/texture/wall.webp',
      'assets/audio/music/theme.ogg',
      'assets/audio/music/music-stinger-a.ogg',
      'assets/audio/sfx/hit.ogg',
      'assets/model/knight.glb',
    ];
    expect(report.initialPayloadBytes).toBe(expected.reduce((s, f) => s + size(f), 0));
    expect(report.assets.map((a) => [a.file, a.kind])).toEqual([
      ['assets/audio/music/theme.ogg', 'audioLoop'],
      ['assets/texture/wall.webp', 'texture'],
    ]);
  });

  it('treats an eager chunk missing from the chunk report as a leaf', () => {
    const report = measureDist(buildDist(), { chunks: [] }, testBudgets);
    expect(report.eagerJs).toHaveLength(2);
  });

  it('passes a build within every budget', () => {
    const dist = buildDist((w) => {
      w('assets/audio/music/music-stinger-a.ogg', Buffer.alloc(10));
    });
    const { chunks } = writeInputs(dist);
    const { code, lines } = run(dist, chunks);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes('No size report from main'))).toBe(true);
    expect(lines.at(-1)).toMatch(/0 problem/);
  });

  it('AC-1: initial JS over 1.5 MB gzipped fails the check and shows the delta against main', () => {
    const base = measureDist(buildDist(), chunkReport, testBudgets);
    writeFileSync(join(dir, 'base.json'), JSON.stringify(base));
    const dist = buildDist((w) => {
      w('assets/main.js', randomBytes(1_600_000));
    });
    const { chunks } = writeInputs(dist);
    const summary = join(dir, 'summary.md');
    const { code, lines } = run(dist, chunks, ['--baseline', join(dir, 'base.json')], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(code).toBe(1);
    const error = lines.find((l) => l.startsWith('::error'));
    expect(error).toMatch(
      /Initial JS is 1\.6\d? MB gzipped, over the 1\.5 MB cap \(\+1\.6\d? MB vs main's 0 MB\)/,
    );
    const md = readFileSync(summary, 'utf8');
    expect(md).toContain('| Initial JS (gzip) | 0 MB | 1.6');
    expect(md).toContain('| over |');
    expect(md).toContain('**Over budget**');
  });

  it('fails when the initial payload passes 50 MB, with the delta', () => {
    const tight: SizeBudgets = { ...testBudgets, initialPayloadBytes: 5000 };
    const dist = buildDist();
    const current = measureDist(dist, chunkReport, tight);
    const base = { ...current, initialPayloadBytes: 1000 };
    expect(violations(current, chunkReport, tight, base)).toEqual([
      expect.stringMatching(
        /Initial payload is 7 MB, over the 0\.01 MB cap \(\+7 MB vs main's 0 MB\)/,
      ),
    ]);
    expect(violations(current, chunkReport, tight)[0]).not.toContain('vs main');
  });

  it('AC-3: a 6 MB texture fails naming the file and the 4 MB cap', () => {
    const dist = buildDist((w) => {
      w('assets/texture/huge-wall.webp', Buffer.alloc(6_000_000));
    });
    const { chunks } = writeInputs(dist);
    const { code, lines } = run(dist, chunks);
    expect(code).toBe(1);
    expect(lines).toContain(
      '::error title=Size budget::assets/texture/huge-wall.webp is 6 MB, over the 4 MB texture cap.',
    );
  });

  it('caps audio loops at 3 MB but lets stingers and one-shots through', () => {
    const dist = buildDist((w) => {
      w('assets/audio/amb/rain.ogg', Buffer.alloc(3_100_000));
    });
    const report = measureDist(dist, chunkReport, testBudgets);
    expect(violations(report, chunkReport, testBudgets)).toEqual([
      'assets/audio/amb/rain.ogg is 3.1 MB, over the 3 MB audio loop cap.',
    ]);
  });

  it('honours a waiver up to its own ceiling and names the waiver when that is exceeded', () => {
    const dist = buildDist((w) => {
      w('assets/audio/music/big.m4a', Buffer.alloc(3_600_000));
    });
    const report = measureDist(dist, chunkReport, testBudgets);
    const waived: SizeBudgets = {
      ...testBudgets,
      waivers: [
        { file: 'assets/audio/music/big.m4a', maxBytes: 3_700_000, reason: 'r', bead: 'mw-1' },
      ],
    };
    expect(violations(report, chunkReport, waived)).toEqual([]);
    const tooBig: SizeBudgets = {
      ...waived,
      waivers: [
        { file: 'assets/audio/music/big.m4a', maxBytes: 3_500_000, reason: 'r', bead: 'mw-1' },
      ],
    };
    expect(violations(report, chunkReport, tooBig)[0]).toBe(
      'assets/audio/music/big.m4a is 3.6 MB, over its waived 3.5 MB ceiling (audio loop cap 3 MB, waiver mw-1).',
    );
  });

  it('AC-2: any src/tools module in a production chunk fails, naming module and chunk', () => {
    const leaky: ChunkReport = {
      chunks: [mainChunk(['src/main.ts', 'src/tools/console/start.ts'])],
    };
    expect(forbiddenModules(leaky, testBudgets)).toEqual([
      { module: 'src/tools/console/start.ts', chunk: 'assets/main.js' },
    ]);
    const report = measureDist(buildDist(), chunkReport, testBudgets);
    expect(violations(report, leaky, testBudgets)).toEqual([
      'src/tools/console/start.ts (a dev tool) is bundled in production chunk assets/main.js.',
    ]);
    expect(forbiddenModules(chunkReport, testBudgets)).toEqual([]);
  });

  it('a tool waiver lets one prefix through and goes stale when nothing matches it', () => {
    const leaky: ChunkReport = {
      chunks: [mainChunk(['src/tools/perf/a.ts', 'src/tools/vfx-demo/b.ts'])],
    };
    const waived: SizeBudgets = {
      ...testBudgets,
      toolWaivers: [
        { prefix: 'src/tools/perf/', reason: 'r', bead: 'mw-2' },
        { prefix: 'src/tools/gone/', reason: 'r', bead: 'mw-3' },
      ],
    };
    expect(forbiddenModules(leaky, waived).map((f) => f.module)).toEqual([
      'src/tools/vfx-demo/b.ts',
    ]);
    const report = measureDist(buildDist(), chunkReport, testBudgets);
    expect(staleWaivers(report, leaky, waived)).toEqual([
      { name: 'src/tools/gone/', bead: 'mw-3' },
    ]);
  });

  it('reports a file waiver as stale once the file is within the plain cap or gone', () => {
    const report = measureDist(buildDist(), chunkReport, testBudgets);
    const waived: SizeBudgets = {
      ...testBudgets,
      waivers: [
        { file: 'assets/audio/music/theme.ogg', maxBytes: 3_700_000, reason: 'r', bead: 'mw-1' },
        { file: 'assets/audio/music/missing.ogg', maxBytes: 3_700_000, reason: 'r', bead: 'mw-4' },
      ],
    };
    expect(staleWaivers(report, chunkReport, waived).map((w) => w.name)).toEqual([
      'assets/audio/music/theme.ogg',
      'assets/audio/music/missing.ogg',
    ]);
    const over = measureDist(
      buildDist((w) => {
        w('assets/audio/music/theme.ogg', Buffer.alloc(3_100_000));
      }),
      chunkReport,
      testBudgets,
    );
    expect(staleWaivers(over, chunkReport, waived).map((w) => w.name)).toEqual([
      'assets/audio/music/missing.ogg',
    ]);
  });

  it('logs a warning for a stale waiver and prints the summary table with deltas for changed assets', () => {
    const dist = buildDist();
    const base: SizeReport = {
      ...measureDist(dist, chunkReport, testBudgets),
      assets: [
        { file: 'assets/texture/wall.webp', kind: 'texture', bytes: 400 },
        { file: 'assets/texture/gone.webp', kind: 'texture', bytes: 400 },
      ],
    };
    writeFileSync(join(dir, 'base.json'), JSON.stringify(base));
    const { chunks } = writeInputs(dist);
    const summary = join(dir, 'summary.md');
    const { code, lines } = run(dist, chunks, ['--baseline', join(dir, 'base.json')], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith('::warning') && l.includes('music-open-world'))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('src/tools/perf/'))).toBe(true);
    const md = readFileSync(summary, 'utf8');
    expect(md).toContain("Compared with main's last successful CI run.");
    expect(md).toContain('`assets/texture/wall.webp` +0 MB');
    expect(md).toContain('`assets/audio/music/theme.ogg` new, 0 MB');
  });

  it('shows a decrease with a minus sign', () => {
    const now: SizeReport = {
      schema: 1,
      initialJsGzipBytes: 1_000_000,
      initialPayloadBytes: 1,
      eagerJs: [],
      assets: [],
    };
    const md = formatSummary(now, testBudgets, [], { ...now, initialJsGzipBytes: 1_500_000 });
    expect(md).toContain('| Initial JS (gzip) | 1.5 MB | 1 MB | -0.5 MB | 1.5 MB | ok |');
    expect(violations({ ...now, initialJsGzipBytes: 1_600_000 }, chunkReport, testBudgets)[0]).toBe(
      'Initial JS is 1.6 MB gzipped, over the 1.5 MB cap.',
    );
  });

  it('formats a summary with no capped asset of some kind and no baseline', () => {
    const empty: SizeReport = {
      schema: 1,
      initialJsGzipBytes: 1,
      initialPayloadBytes: 1,
      eagerJs: [],
      assets: [],
    };
    const md = formatSummary(empty, testBudgets, []);
    expect(md).toContain('| Largest texture | n/a | 0 MB | n/a | 4 MB | ok |');
    expect(md).not.toContain('Over budget');
    expect(formatSummary(empty, testBudgets, [], empty)).not.toContain('Capped assets changed');
  });

  it('exits 2 with an error when the build or the chunk report is missing', () => {
    const { code, lines } = run(join(dir, 'nope'), join(dir, 'nope.json'));
    expect(code).toBe(2);
    expect(lines[0]).toMatch(/^::error title=Size budget::Need a production build/);
  });

  it('uses the default paths and ignores a missing baseline file or an unset summary variable', () => {
    const dist = buildDist();
    const { chunks } = writeInputs(dist);
    const lines: string[] = [];
    const out = join(dir, 'out.json');
    const code = main(
      [
        '--dist',
        dist,
        '--chunks',
        chunks,
        '--out',
        out,
        '--baseline',
        join(dir, 'missing.json'),
        '--budgets',
      ],
      {
        log: (l) => lines.push(l),
        env: { GITHUB_STEP_SUMMARY: '' },
      },
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ schema: 1 });
  });
});
