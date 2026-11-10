import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import wasm from 'vite-plugin-wasm';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DEFAULT_EXCLUDES, readExclusionGlobs } from './scripts/check-coverage-exclusions.ts';
import { ContentCoverageReporter } from './scripts/content-coverage-reporter.ts';
import { chunkReportPlugin } from './scripts/size/chunk-report.ts';
import { readLayers, vitestThresholds } from './scripts/coverage-layers.ts';

/**
 * Short commit SHA shown on screen with the scene name (mw-e00.21): CI's GITHUB_SHA, else the local
 * checkout's HEAD, else "unknown" (e.g. a source tarball without git).
 */
function buildSha(): string {
  const ci = process.env['GITHUB_SHA'];
  if (ci !== undefined && ci !== '') return ci.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Dev hot reload of controller data (mw-e02.3): a saved src/content/data/controller/*.json is sent
 * to the page on the `vesper:controller` event (CONTROLLER_HOT_EVENT in src/game/player), which
 * validates it and retunes the player, instead of reloading the page.
 */
function controllerHotReload(): Plugin {
  return {
    name: 'vesper:controller-hot-reload',
    apply: 'serve',
    async hotUpdate({ file, read }) {
      const path = relative(import.meta.dirname, file).replaceAll('\\', '/');
      if (this.environment.name !== 'client') return;
      if (!/^src\/content\/data\/controller\/[^/]+\.json$/.test(path)) return;
      this.environment.hot.send({
        type: 'custom',
        event: 'vesper:controller',
        data: { file: path, text: await read() },
      });
      return [];
    },
  };
}

// One config for dev, build and tests: path aliases come from tsconfig.json `paths`,
// so @sim/*, @content/*, @game/* … resolve identically in Vite, Vitest and tsc.
export default defineConfig({
  // Rapier's deterministic build (ADR-0001) imports its .wasm as an ES module; the plugin emits it
  // as a separate asset fetched by the lazily imported physics chunk (mw-e00.19).
  // Its typings declare `any`, hence the cast.
  // chunkReportPlugin lists each production chunk's source modules for the size check (mw-e32.3).
  plugins: [wasm() as Plugin, controllerHotReload(), chunkReportPlugin(import.meta.dirname)],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    // The debug console (mw-e33.1) is built in unless VESPER_DEBUG_CONSOLE=off (a release build);
    // even then it only loads in dev builds or with ?debug=1 (src/game/debug-console-gate.ts).
    __DEBUG_CONSOLE__: JSON.stringify(process.env['VESPER_DEBUG_CONSOLE'] !== 'off'),
    // The input latency and controller cost probe (mw-e02.8): built in with VESPER_LATENCY_PROBE=on
    // (the perf suite's build); the dev server has it too (src/main.ts also checks import.meta.env.DEV).
    // Any other build drops the probe's code (tests/toolchain/latency-probe-stripped.test.ts).
    __LATENCY_PROBE__: JSON.stringify(process.env['VESPER_LATENCY_PROBE'] === 'on'),
  },
  resolve: {
    tsconfigPaths: true,
  },
  // The perf build is served cross-origin isolated (mw-e02.8): performance.now() then ticks every
  // 5 µs instead of 100 µs, which the controller and camera cost samples (tens of microseconds each)
  // need. Only for the probe build; nothing else sets these headers.
  preview: {
    headers:
      process.env['VESPER_LATENCY_PROBE'] === 'on'
        ? {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          }
        : {},
  },
  server: {
    watch: {
      // Agent worktrees and test/coverage output live inside the repo; watching them makes every
      // parallel coverage run reload the dev page thousands of times (mw-d8h).
      ignored: ['**/.claude/**', '**/coverage/**', '**/test-results/**', '**/playwright-report/**'],
    },
  },
  build: {
    target: 'es2023',
    // three.js alone is ~530 kB minified (~130 kB gz) in one chunk; warn only above that (mw-e00.19).
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // The game, plus dev testbed pages (mw-e28.1 audio, mw-e00.19 render) that e2e drives against
      // the real build.
      input: {
        main: 'index.html',
        'testbed-audio': 'testbed/audio.html',
        'testbed-render': 'testbed/render.html',
        'testbed-ui': 'testbed/ui.html',
      },
    },
  },
  test: {
    // Sim physics tests run the real deterministic Rapier build (mw-e03.35). Its package has only a
    // `module` field (no `main`/`exports`), which Vitest's server-side resolver ignores, so point the
    // bare specifier at the ES entry and let Vite transform the package (inline) instead of handing it
    // to Node: vite-plugin-wasm above then loads its .wasm, exactly as in the browser build. No
    // -compat package is needed, so tests and game run the same engine binary.
    alias: [
      {
        find: /^@dimforge\/rapier3d-deterministic$/,
        replacement: '@dimforge/rapier3d-deterministic/rapier.js',
      },
    ],
    server: { deps: { inline: [/@dimforge\/rapier3d-deterministic/] } },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The content reporter records which content entries passing tests exercised (mw-e00.18).
    reporters: ['default', new ContentCoverageReporter()],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Only what coverage-exclusions.md lists (checked by pnpm coverage:exclusions).
      exclude: [...DEFAULT_EXCLUDES, ...readExclusionGlobs()],
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // Per-layer gates (contract §3) from coverage-layers.json; the ratchet reads the same file.
      thresholds: vitestThresholds(readLayers()),
    },
  },
});
