import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? '4173');
const PLAYTHROUGH = 'slice-playthrough.spec.ts';
const CROSS_BROWSER = ['audio.spec.ts', 'magic-materials.spec.ts'];

// Smoke tests run against the production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // CI also writes a JSON report: per-spec durations feed e2e/shards.json (mw-e41.1) and the flake
  // report (mw-e41.7); it is uploaded on every run.
  reporter: process.env['CI']
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/e2e-report.json' }],
      ]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    // Kept only for failures; CI uploads them as artifacts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: PLAYTHROUGH },
    // The slice playthrough replays a whole run for minutes in software GL; beside other specs it
    // starves their wall-clock budgets, so CI runs it alone in its own job (mw-e01.9).
    { name: 'playthrough', use: { ...devices['Desktop Chrome'] }, testMatch: PLAYTHROUGH },
    // Web Audio differs per engine (autoplay policy, AudioListener params, codecs), so the audio
    // testbed also runs in Firefox and WebKit (mw-e28.1 AC-6).
    // The magical materials are raw GLSL, which compiles differently per engine, so their material
    // test scene also runs in Firefox and WebKit (mw-e29.7 AC-1).
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: CROSS_BROWSER },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: CROSS_BROWSER },
  ],
  webServer: {
    // Call vite directly (not via `pnpm preview`): pnpm's wrapper doesn't forward SIGTERM,
    // so Playwright would hang waiting for the preview server to exit.
    command: `vite build && exec vite preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env['CI'],
  },
});
