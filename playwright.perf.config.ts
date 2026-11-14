import { defineConfig, devices } from '@playwright/test';

// The perf budget suite (mw-e32.1), separate from the e2e smoke suite: `pnpm perf` runs CI mode
// (GPU-less runners: sizes, throttled load, heap, long tasks, software frame time for the
// comparison with main), `pnpm perf:ref` runs reference mode by hand on the reference machine
// (absolute frame-time budgets, headed Chrome). Specs: e2e/perf/*.perf.ts; budgets:
// perf/perf-budgets.json. One worker: measurements must not share the machine with each other.
const PORT = 4183;
const LATENCY_PORT = 4184;
const LATENCY_BUILD = 'test-results/latency-build';

export default defineConfig({
  testDir: 'e2e/perf',
  testMatch: '*.perf.ts',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ...(process.env['CI'] ? [['github'] as const] : []),
    ['list'],
    ['./e2e/perf/reporter.ts'],
  ],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ci',
      testMatch: 'ci.perf.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Uncapped, so software-rendered frame time is throughput rather than the 60 Hz timer.
        launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
      },
    },
    {
      // Input-to-motion latency and controller cost (mw-e02.8, e2e/perf/latency.perf.ts): the
      // reference machine's headed Chrome with vsync ON, the page's frames paced to 60 or 30 fps.
      // Run with the reference project by `pnpm perf:ref`; reference mode, same machine.
      name: 'latency',
      testMatch: 'latency.perf.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${String(LATENCY_PORT)}`,
        ...(process.env['VESPER_PERF_CHANNEL'] === 'chromium'
          ? {}
          : { channel: process.env['VESPER_PERF_CHANNEL'] ?? 'chrome' }),
        headless: false,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'reference',
      testMatch: 'reference.perf.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Installed Chrome, the contract's reference browser; VESPER_PERF_CHANNEL=chromium uses
        // Playwright's bundled build instead.
        ...(process.env['VESPER_PERF_CHANNEL'] === 'chromium'
          ? {}
          : { channel: process.env['VESPER_PERF_CHANNEL'] ?? 'chrome' }),
        headless: false,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2,
        launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
      },
    },
  ],
  webServer: [
    {
      command: `vite build && exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(PORT)}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The probe build (mw-e02.8) for the latency project, in its own directory and on its own port
      // so the ci project's bundle size and transfer budgets still measure the production build.
      // vite.config.ts serves it cross-origin isolated (5 µs timer ticks for the cost samples).
      command: `export VESPER_LATENCY_PROBE=on && vite build --outDir ${LATENCY_BUILD} && exec vite preview --outDir ${LATENCY_BUILD} --host 127.0.0.1 --port ${String(LATENCY_PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(LATENCY_PORT)}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
