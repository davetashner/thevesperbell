import { expect, test } from '@playwright/test';

// mw-e29.7 AC-4: frame time with 6 simultaneous distortion effects on High, through the ?perf probe
// (see e2e/perf.spec.ts for the method). Opt-in, because the number only means something headed on the
// reference machine (MacBook Pro M1 Pro, Chrome, High):
//
//   VESPER_PERF=1 VESPER_PERF_CHANNEL=chrome pnpm exec playwright test e2e/magic-perf.spec.ts --headed
//
// `?magic=haze` stands six overlapping 3.2 m heat hazes in front of a bar backdrop; `&quality=low`
// draws the same scene with none of them (distortion skipped), which is the comparison. Budget: frame
// interval p95 ≤ 16.7 ms (60 fps). VESPER_PERF_SECONDS sets the sampling time (default 20 s).

const SECONDS = Number(process.env['VESPER_PERF_SECONDS'] ?? '20');
const BUDGET_MS = 16.7;

interface Report {
  frame: { count: number; p50: number; p95: number; p99: number };
  work: { count: number; p50: number; p95: number; p99: number };
}

interface MagicProbe {
  tier: string;
  hazes: number;
  distortionPasses: number;
}

test.skip(process.env['VESPER_PERF'] !== '1', 'set VESPER_PERF=1 (and run headed) to measure');
test.use({
  ...(process.env['VESPER_PERF_CHANNEL'] ? { channel: process.env['VESPER_PERF_CHANNEL'] } : {}),
  deviceScaleFactor: 2,
  launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
});

async function measure(
  page: import('@playwright/test').Page,
  quality: 'high' | 'low',
): Promise<{ report: Report; magic: MagicProbe; summary: string }> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?scene=testbed&magic=haze&quality=${quality}&perf=${String(SECONDS)}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-perf', /frame/, { timeout: (SECONDS + 20) * 1_000 });
  const report = JSON.parse((await app.getAttribute('data-perf')) ?? '{}') as Report;
  const magic = JSON.parse((await app.getAttribute('data-magic')) ?? '{}') as MagicProbe;
  const summary = `${quality}: frame p50/p95/p99 ${report.frame.p50.toFixed(2)}/${report.frame.p95.toFixed(2)}/${report.frame.p99.toFixed(2)} ms; work p50/p95/p99 ${report.work.p50.toFixed(2)}/${report.work.p95.toFixed(2)}/${report.work.p99.toFixed(2)} ms over ${String(report.frame.count)} frames; hazes ${String(magic.hazes)}, frame copies ${String(magic.distortionPasses)}`;
  console.log(`[perf] ${summary}`);
  test.info().annotations.push({ type: 'perf', description: summary });
  return { report, magic, summary };
}

test('AC-4: 6 distortion effects on High keep frame time p95 ≤ 16.7 ms', async ({ page }) => {
  test.setTimeout((SECONDS + 30) * 1_000);
  const { report, magic } = await measure(page, 'high');
  expect(magic).toMatchObject({ tier: 'high', hazes: 6 });
  expect(magic.distortionPasses).toBeGreaterThan(0);
  expect(report.frame.p95).toBeLessThanOrEqual(BUDGET_MS);
});

test('the same scene on Low (no distortion) for comparison', async ({ page }) => {
  test.setTimeout((SECONDS + 30) * 1_000);
  const { magic } = await measure(page, 'low');
  expect(magic).toMatchObject({ tier: 'low', hazes: 0, distortionPasses: 0 });
});
