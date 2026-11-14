// Input latency and controller cost budgets (mw-e02.8), run by `pnpm perf:ref` on the reference
// machine (the `latency` project of playwright.perf.config.ts). "Responsive" is a number:
//
// - AC-1: 50 synthetic move key presses in the greybox testbed at High, input-to-motion latency
//   p95 ≤ 100 ms (target ≤ 50 ms): from the keydown event reaching the page to the end of the first
//   frame callback in which the player's drawn transform changed (src/tools/perf/latency-probe.ts).
// - AC-4: the same at the Low preset with the display paced to 30 fps, the Low worst case: ≤ 133 ms.
// - AC-2: 60 s of scripted traversal, the controller system ≤ 0.3 ms per sim tick and the camera
//   placement ≤ 0.2 ms per frame, both p95, timed inside the game around the real systems.
//
// Frame pacing: the page's requestAnimationFrame is paced to 60 (or 30) fps whatever the display
// does (a ProMotion MacBook runs rAF at 120 Hz, which would flatter the latency of "60 fps"), and
// vsync stays on (this project has none of the reference project's uncap flags). The keys are real
// browser input events dispatched by Playwright, so they cross the same input path as a player's,
// less the OS and USB. The probe measures to the end of the frame callback; compositor and display
// scan-out (about one more frame interval) are outside it.
//
// Needs the probe build (VESPER_LATENCY_PROBE=on, which the config's web server sets) and
// `?latency` on the page; a production build has neither (tests/toolchain/latency-probe-stripped).
import { expect, test, type Page } from '@playwright/test';
import { percentiles } from '../../src/tools/perf/percentiles';
import type { LatencyReport } from '../../src/tools/perf/latency-probe';
import { stubPointerLock, takeControl } from '../helpers/player';
import { browserName, enforce } from './harness';

/** Measured key presses (AC-1). */
const PRESSES = 50;
/** Presses before them that warm the JIT and the input path; not measured. */
const WARMUP_PRESSES = 5;
/** Most key presses tried to get PRESSES + WARMUP_PRESSES measured (a press while still coasting is discarded). */
const MAX_ATTEMPTS = 160;
/** Seconds of scripted traversal (AC-2) and of warm-up before its cost samples count. */
const TRAVERSAL_S = Number(process.env['PERF_TRAVERSAL_S'] ?? '60');
const TRAVERSAL_WARMUP_S = 3;

const PRESETS = {
  high: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, fps: 60 },
  low: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, fps: 30 },
} as const;

interface ProbeWindow {
  mwLatencyProbe?: { report(): LatencyReport; resetCosts(): void };
}

/** Paces requestAnimationFrame to at most `fps` frames a second; call before navigating. */
async function paceFrames(page: Page, fps: number): Promise<void> {
  await page.addInitScript((frameMs) => {
    const raf = window.requestAnimationFrame.bind(window);
    let last = -Infinity;
    // A frame is let through once frameMs minus half a refresh interval has passed, so a 60 Hz
    // display (16.7 ms apart) is not read as late at 60 fps, nor a 120 Hz one as early.
    const gate = (callback: FrameRequestCallback) => (time: number) => {
      if (time - last < frameMs - 4) {
        raf(gate(callback));
        return;
      }
      last = time;
      callback(time);
    };
    window.requestAnimationFrame = (callback) => raf(gate(callback));
  }, 1_000 / fps);
}

/** Opens the testbed with the probe and takes pointer lock; the player stands, grounded. */
async function openTestbed(page: Page, preset: 'high' | 'low'): Promise<void> {
  await stubPointerLock(page);
  await paceFrames(page, PRESETS[preset].fps);
  await page.goto(`/?scene=testbed&latency${preset === 'low' ? '&quality=low' : ''}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  // Cross-origin isolated (the perf build's preview server sets the headers): performance.now()
  // ticks every 5 µs, not 100 µs, which the sub-millisecond cost samples need.
  expect(await page.evaluate(() => window.crossOriginIsolated), 'crossOriginIsolated').toBe(true);
  await takeControl(page);
  await page.waitForTimeout(1_000);
}

const report = (page: Page): Promise<LatencyReport> =>
  page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).mwLatencyProbe;
    if (probe === undefined)
      throw new Error('no latency probe: is this a VESPER_LATENCY_PROBE build?');
    return probe.report();
  });

/** Presses move keys one at a time (alternating so the player stays in the room) until enough count. */
async function pressKeys(page: Page): Promise<LatencyReport> {
  const keys = ['KeyW', 'KeyS', 'KeyD', 'KeyA'];
  let latest = await report(page);
  for (let i = 0; i < MAX_ATTEMPTS && latest.latency.count < PRESSES + WARMUP_PRESSES; i++) {
    const key = keys[i % keys.length] ?? 'KeyW';
    await page.keyboard.down(key);
    await page.waitForTimeout(250);
    await page.keyboard.up(key);
    // Long enough for the player to stop: a press while still coasting is discarded, not measured.
    await page.waitForTimeout(450);
    latest = await report(page);
  }
  return latest;
}

for (const preset of ['high', 'low'] as const) {
  test.describe(`input-to-motion latency at ${preset}`, () => {
    test.use({
      viewport: PRESETS[preset].viewport,
      deviceScaleFactor: PRESETS[preset].deviceScaleFactor,
    });

    test(
      preset === 'high'
        ? 'AC-1: 50 move key presses at High, 60 fps: input-to-motion p95 ≤ 100 ms'
        : 'AC-4: 50 move key presses at Low paced to 30 fps: input-to-motion p95 ≤ 133 ms',
      async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        await openTestbed(page, preset);
        const done = await pressKeys(page);
        const samples = done.latency.samples.slice(WARMUP_PRESSES, WARMUP_PRESSES + PRESSES);
        const stats = percentiles(samples);
        console.log(
          `[perf] input-to-motion at ${preset} (${String(PRESETS[preset].fps)} fps): ` +
            `${String(stats.count)} presses (${String(done.discarded)} discarded) ` +
            `p50 ${stats.p50.toFixed(1)} / p95 ${stats.p95.toFixed(1)} / max ${stats.max.toFixed(1)} ms`,
        );
        expect(samples.length, 'measured key presses').toBe(PRESSES);
        await enforce(testInfo, 'reference', {
          browser: browserName(page),
          measurements: [
            { metric: 'inputToMotionP95Ms', value: stats.p95, scene: 'testbed', preset },
          ],
        });
      },
    );
  });
}

/** One lap of a scripted traversal: sprinting, strafing, backing up, jumping and looking around. */
async function traversalLap(page: Page): Promise<void> {
  const hold = async (keys: string[], ms: number): Promise<void> => {
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.move(640, 360);
    await page.mouse.move(700, 380, { steps: 6 });
    await page.waitForTimeout(ms);
    for (const key of keys.reverse()) await page.keyboard.up(key);
  };
  await hold(['KeyW'], 1_200);
  await hold(['KeyW', 'ShiftLeft'], 800);
  await hold(['KeyD'], 700);
  await hold(['KeyW', 'Space'], 900);
  await hold(['KeyS'], 1_500);
  await hold(['KeyA', 'KeyS'], 700);
  await hold(['KeyA'], 700);
  await page.mouse.move(600, 340, { steps: 8 });
  await page.waitForTimeout(300);
}

test.describe('controller and camera cost', () => {
  test.use({
    viewport: PRESETS.high.viewport,
    deviceScaleFactor: PRESETS.high.deviceScaleFactor,
  });

  test('AC-2: 60 s of traversal: controller ≤ 0.3 ms per tick and camera ≤ 0.2 ms per frame at p95', async ({
    page,
  }, testInfo) => {
    test.setTimeout((TRAVERSAL_S + TRAVERSAL_WARMUP_S + 120) * 1_000);
    await openTestbed(page, 'high');
    // The warm-up's costs are not sampled: the JIT is still tiering up.
    const warmUntil = Date.now() + TRAVERSAL_WARMUP_S * 1_000;
    while (Date.now() < warmUntil) await traversalLap(page);
    await page.evaluate(() => {
      (window as unknown as ProbeWindow).mwLatencyProbe?.resetCosts();
    });
    const until = Date.now() + TRAVERSAL_S * 1_000;
    while (Date.now() < until) await traversalLap(page);
    const { controller, camera } = await report(page);
    console.log(
      `[perf] ${String(TRAVERSAL_S)} s traversal: controller ${String(controller.count)} ticks ` +
        `p50 ${controller.p50.toFixed(3)} / p95 ${controller.p95.toFixed(3)} / max ${controller.max.toFixed(3)} ms; ` +
        `camera ${String(camera.count)} frames p50 ${camera.p50.toFixed(3)} / p95 ${camera.p95.toFixed(3)} / max ${camera.max.toFixed(3)} ms`,
    );
    // 60 s at 60 ticks a second, less what the paced frame loop and the lap's pauses drop.
    expect(controller.count, 'controller ticks timed').toBeGreaterThan(TRAVERSAL_S * 40);
    expect(camera.count, 'camera frames timed').toBeGreaterThan(TRAVERSAL_S * 40);
    await enforce(testInfo, 'reference', {
      browser: browserName(page),
      measurements: [
        { metric: 'controllerTickP95Ms', value: controller.p95, scene: 'testbed' },
        { metric: 'cameraFrameP95Ms', value: camera.p95, scene: 'testbed' },
      ],
    });
  });
});
