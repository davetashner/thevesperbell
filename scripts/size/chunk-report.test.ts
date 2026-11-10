import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildChunkReport,
  chunkReportPlugin,
  normalizeModuleId,
  type BundleLike,
  type ChunkReport,
} from './chunk-report.ts';

const root = '/proj';
const bundle: BundleLike = {
  'assets/z.js': {
    type: 'chunk',
    fileName: 'assets/z.js',
    isEntry: false,
    imports: [],
    dynamicImports: ['assets/a.js'],
    modules: {
      '/proj/src/sim/world.ts': {},
      '\0vite/preload-helper.js': {},
      '/elsewhere/x.js': {},
    },
  },
  'assets/a.js': {
    type: 'chunk',
    fileName: 'assets/a.js',
    isEntry: true,
    imports: ['assets/z.js'],
    dynamicImports: [],
    modules: { '/proj/src/main.ts?used': {} },
  },
  'assets/rapier.wasm': { type: 'asset' },
};

describe('chunk report (mw-e32.3 AC-2 input)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('normalizes module ids to root-relative posix paths without queries', () => {
    expect(normalizeModuleId('/proj/src/main.ts?used', root)).toBe('src/main.ts');
    expect(normalizeModuleId('\0vite/preload-helper.js', root)).toBe('vite/preload-helper.js');
    expect(normalizeModuleId('/elsewhere/x.js', root)).toBe('/elsewhere/x.js');
    expect(normalizeModuleId('C:\\proj\\src\\a.ts', 'C:\\proj')).toContain('a.ts');
  });

  it('lists chunks, sorted, with their modules and imports and skips assets', () => {
    const report = buildChunkReport(bundle, root);
    expect(report.chunks.map((c) => c.file)).toEqual(['assets/a.js', 'assets/z.js']);
    expect(report.chunks[0]).toEqual({
      file: 'assets/a.js',
      isEntry: true,
      imports: ['assets/z.js'],
      dynamicImports: [],
      modules: ['src/main.ts'],
    });
    expect(report.chunks[1]?.modules).toEqual([
      '/elsewhere/x.js',
      'src/sim/world.ts',
      'vite/preload-helper.js',
    ]);
  });

  it('writes the report from the build-only plugin generateBundle hook', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chunk-report-'));
    dirs.push(dir);
    const plugin = chunkReportPlugin(dir, 'out/nested/chunks.json');
    expect(plugin.apply).toBe('build');
    const hook = plugin.generateBundle as (o: unknown, b: BundleLike) => void;
    hook({}, { ...bundle });
    expect(existsSync(join(dir, 'out/nested/chunks.json'))).toBe(true);
    const written = JSON.parse(
      readFileSync(join(dir, 'out/nested/chunks.json'), 'utf8'),
    ) as ChunkReport;
    expect(written.chunks).toHaveLength(2);
  });

  it('defaults the output outside dist/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chunk-report-'));
    dirs.push(dir);
    const hook = chunkReportPlugin(dir).generateBundle as (o: unknown, b: BundleLike) => void;
    hook({}, bundle);
    expect(existsSync(join(dir, 'build-report/chunk-modules.json'))).toBe(true);
  });
});
