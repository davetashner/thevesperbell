// Records which source modules end up in which production chunk (mw-e32.3 AC-2). The Vite plugin
// writes the list outside dist/ (the site and e2e never see it), and scripts/size/size-budget.ts
// asserts from it that nothing under src/tools/ was bundled. It only observes the bundle: chunk
// contents and hashes are untouched.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import type { Plugin } from 'vite';

export const DEFAULT_CHUNK_REPORT = 'build-report/chunk-modules.json';

export interface ChunkReportEntry {
  /** Output path relative to dist/, e.g. `assets/main-CosB7k2z.js`. */
  readonly file: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  /** Source module ids relative to the project root, without Vite query strings. */
  readonly modules: readonly string[];
}

export interface ChunkReport {
  readonly chunks: readonly ChunkReportEntry[];
}

/** The part of Rollup's output bundle this reads. */
export type BundleLike = Record<
  string,
  | { type: 'asset' }
  | {
      type: 'chunk';
      fileName: string;
      isEntry: boolean;
      imports: string[];
      dynamicImports: string[];
      modules: Record<string, unknown>;
    }
>;

/** A module id as a root-relative posix path with no `?query` (virtual `\0` ids lose the prefix). */
export function normalizeModuleId(id: string, root: string): string {
  const bare = id.replace(/\?.*$/, '').replace(/^\0/, '');
  const rel = relative(root, bare).replaceAll('\\', '/');
  return rel.startsWith('..') ? bare.replaceAll('\\', '/') : rel;
}

export function buildChunkReport(bundle: BundleLike, root: string): ChunkReport {
  const chunks: ChunkReportEntry[] = [];
  for (const item of Object.values(bundle)) {
    if (item.type !== 'chunk') continue;
    chunks.push({
      file: item.fileName,
      isEntry: item.isEntry,
      imports: [...item.imports],
      dynamicImports: [...item.dynamicImports],
      modules: Object.keys(item.modules)
        .map((id) => normalizeModuleId(id, root))
        .sort(),
    });
  }
  chunks.sort((a, b) => a.file.localeCompare(b.file));
  return { chunks };
}

/** Build-only Vite plugin: writes the chunk report to `outFile` (relative to the project root). */
export function chunkReportPlugin(root: string, outFile: string = DEFAULT_CHUNK_REPORT): Plugin {
  const path = `${root}/${outFile}`;
  return {
    name: 'vesper:chunk-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(buildChunkReport(bundle, root), null, 2)}\n`);
    },
  };
}
