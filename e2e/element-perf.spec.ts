import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e03.28 AC-4: frame time with 40 burning entities and a smoke cloud in view. Opt-in, because the
// number only means something headed on the reference machine (MacBook Pro M1 Pro, Chrome, High):
//
//   VESPER_PERF=1 pnpm exec playwright test e2e/element-perf.spec.ts --headed
//
// In the testbed, five rows of eight crates are spawned ahead of the player and heated past their
// ignition point from the debug console; once 40 are burning and the smoke they make is drawn, the
// page's own animation frames are timed for VESPER_PERF_SECONDS (default 15). Budget: frame
// interval p95 ≤ 16.7 ms (60 fps). VESPER_PERF_CHANNEL=chrome uses installed Chrome.

const SECONDS = Number(process.env['VESPER_PERF_SECONDS'] ?? '15');
const BUDGET_MS = 16.7;
const BURNING = 40;

interface Probe {
  perState: Record<string, number>;
  clouds: number;
  live: number;
  culled: number;
  vfx: number;
  objects: { id: number; x: number; z: number }[];
}

test.skip(process.env['VESPER_PERF'] !== '1', 'set VESPER_PERF=1 (and run headed) to measure');
test.use({
  ...(process.env['VESPER_PERF_CHANNEL'] ? { channel: process.env['VESPER_PERF_CHANNEL'] } : {}),
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 720 },
  launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] },
});

const probe = async (page: Page): Promise<Probe> =>
  JSON.parse((await page.locator('#app').getAttribute('data-elements')) ?? 'null') as Probe;

test('AC-4: 40 burning entities and a smoke cloud keep frame time p95 ≤ 16.7 ms', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await stubPointerLock(page);
  await page.goto(`/?scene=testbed&elements&debug=1`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 20_000 });
  await expect(app).toHaveAttribute('data-elements', /"objects":\[\{/, { timeout: 20_000 });
  await takeControl(page);
  const before = new Set((await probe(page)).objects.map((o) => o.id));
  for (let row = 0; row < 5; row++) {
    await runConsole(page, `tp -3.5 0 ${String(0.5 + row * 1.5)}`);
    await runConsole(page, 'spawn testprop-crate 8');
  }
  await runConsole(page, 'tp 0 0 -1');
  const crates = (await probe(page)).objects.filter((o) => !before.has(o.id)).map((o) => o.id);
  expect(crates).toHaveLength(BURNING);
  for (const id of crates) await runConsole(page, `prop ${String(id)} temperature 600`);
  await expect
    .poll(async () => (await probe(page)).perState['burning'] ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(BURNING);
  await expect.poll(async () => (await probe(page)).clouds, { timeout: 30_000 }).toBeGreaterThan(0);
  const at = await probe(page);

  const frames = await page.evaluate(
    (seconds) =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = [];
        const end = performance.now() + seconds * 1000;
        let last = performance.now();
        const tick = (now: number): void => {
          deltas.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else resolve(deltas);
        };
        requestAnimationFrame(tick);
      }),
    SECONDS,
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  const after = await probe(page);
  const summary = `frame p50/p95/p99 ${q(0.5).toFixed(2)}/${q(0.95).toFixed(2)}/${q(0.99).toFixed(2)} ms over ${String(frames.length)} frames; ${String(at.perState['burning'])} burning, ${String(after.clouds)} smoke clouds, ${String(after.live)} live handles, ${String(after.vfx)} effects`;
  console.log(`[perf] ${summary}`);
  test.info().annotations.push({ type: 'perf', description: summary });
  expect(q(0.95)).toBeLessThanOrEqual(BUDGET_MS);
});
