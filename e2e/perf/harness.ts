// Browser side of the perf budget suite (mw-e32.1): what the specs in this directory measure and how.
//
// - Frame time: the game's own ?perf probe (src/tools/perf/frame-probe.ts) times every rAF callback
//   after a 3 s warm-up until it has 1,800 frame intervals, and publishes the raw intervals on
//   #app[data-perf]; percentiles are computed here with the suite's percentile code.
// - Long tasks: a PerformanceObserver installed before any page script records every long task, and
//   a wrapper around requestAnimationFrame records when each frame callback ran. A long task that
//   overlaps a frame callback is a frame render; the rest (GC, parsing, timers, input handlers) are
//   not. On a real GPU (reference mode) every long task ≥ 200 ms in the sampling window counts. On
//   GPU-less runners (CI mode) each software-rendered frame is itself a 100–200 ms task, so frame
//   renders are only reported there and the budget counts the long tasks that are not frame renders,
//   during play: the perf-baseline sampling window and the testbed's idle minutes.
// - Load: the Chrome DevTools Protocol throttles the network to 50 Mbps (contract §1) and counts the
//   encoded bytes of every response; playable is the first frame drawn after the scene loaded
//   (#app[data-scene] appears), on the page's clock, which starts at navigation.
// - Heap: CDP Runtime.getHeapUsage after idling.
//
// Chromium only: the CDP and the longtask entry type are Chromium features (cross-browser runs are
// e32-browser-matrix).

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { frameTimeStats, percentiles, type Percentiles } from '../../src/tools/perf/percentiles';
import {
  budgetsFor,
  evaluateAll,
  loadBudgets,
  measures,
  type Measurement,
  type PerfMetric,
  type PerfMode,
} from '../../scripts/perf/budgets';
import type { FrameRun, PerfAttachment } from '../../scripts/perf/report';

export const BUDGETS_PATH = 'perf/perf-budgets.json';
export const CONTRACT_PATH = 'docs/backlog-contract.md';

/** 50 Mbps down (contract §1); upload and round-trip time are harness choices, not budgets. */
export const NETWORK_50_MBPS = {
  offline: false,
  downloadThroughput: 50_000_000 / 8,
  uploadThroughput: 10_000_000 / 8,
  latency: 20,
} as const;

/** Frames sampled after the warm-up (bead notes: ≥ 1,800 frames, first 3 s excluded). */
export const SAMPLE_FRAMES = 1_800;
export const WARMUP_S = 3;
/** A task this long or longer counts against the long-task budget, ms. */
export const LONG_TASK_MS = 200;

const INIT_SCRIPT = `
  window.__vesperLongTasks = [];
  window.__vesperFrames = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const start = performance.now();
      try {
        callback(time);
      } finally {
        const frames = window.__vesperFrames;
        if (frames.length >= 400000) frames.splice(0, 200000);
        frames.push(start, performance.now());
      }
    });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vesperLongTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const watchScene = () => {
    const app = document.querySelector('#app');
    if (app === null || app.dataset.scene === undefined) return false;
    requestAnimationFrame(() => {
      window.__vesperPlayableMs ??= performance.now();
    });
    return true;
  };
  new MutationObserver((_, observer) => {
    if (watchScene()) observer.disconnect();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-scene'] });
`;

interface PerfWindow {
  __vesperLongTasks: { start: number; duration: number }[];
  /** Frame callback intervals, flattened: start, end, start, end… (page clock, ms). */
  __vesperFrames: number[];
  __vesperPlayableMs?: number;
}

/** Installs the long-task observer and the playable marker; call before the first navigation. */
export async function instrument(page: Page): Promise<void> {
  await page.addInitScript(INIT_SCRIPT);
}

/** The validated budgets for `mode` (and `metrics`), checked against the contract's baseline. */
export function budgets(mode: PerfMode, metrics?: readonly PerfMetric[]) {
  return budgetsFor(loadBudgets(BUDGETS_PATH, CONTRACT_PATH), mode, metrics);
}

/**
 * Attaches the measurements for the reporter, then fails the test with one line per budget over
 * (each naming the metric and the delta vs budget) if any is.
 */
export async function enforce(
  testInfo: TestInfo,
  mode: PerfMode,
  attachment: PerfAttachment,
): Promise<void> {
  await testInfo.attach('perf', {
    body: JSON.stringify(attachment),
    contentType: 'application/json',
  });
  // The budgets this test measured: same metric, and same scene when the budget names one.
  const measured = budgets(mode).filter((b) => attachment.measurements.some((m) => measures(b, m)));
  const results = evaluateAll(measured, attachment.measurements);
  for (const result of results) {
    testInfo.annotations.push({
      type: result.pass ? 'perf' : 'perf-fail',
      description: result.message,
    });
    console.log(`[perf] ${result.pass ? 'pass' : 'FAIL'} ${result.message}`);
  }
  expect(
    results.filter((r) => !r.pass).map((r) => r.message),
    'perf budgets over (metric: value vs budget, delta)',
  ).toEqual([]);
}

/** e.g. "chrome 141.0.7390.55" (installed Chrome) or "chromium 140.0.7339.16" (bundled). */
export function browserName(page: Page): string {
  const browser = page.context().browser();
  const channel = test.info().project.use.channel;
  const name = channel ?? browser?.browserType().name() ?? 'browser';
  return `${name} ${browser?.version() ?? ''}`.trim();
}

/** The WebGL renderer the page gets (SwiftShader on GPU-less runners). */
export function rendererName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return 'no WebGL 2';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
  });
}

/** Opens a CDP session with the network throttled to 50 Mbps and the cache on or off. */
export async function throttled(page: Page, cacheDisabled: boolean): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled });
  await cdp.send('Network.emulateNetworkConditions', NETWORK_50_MBPS);
  return cdp;
}

/** Waits for the first frame after the scene loaded; returns its time since navigation, ms. */
export async function playableMs(page: Page, timeoutMs: number): Promise<number> {
  await page.waitForFunction(
    () => (window as unknown as PerfWindow).__vesperPlayableMs !== undefined,
    undefined,
    {
      timeout: timeoutMs,
    },
  );
  return page.evaluate(() => (window as unknown as PerfWindow).__vesperPlayableMs ?? Number.NaN);
}

/** Sums the encoded bytes of every response the session sees from now on. */
export function countBytes(cdp: CDPSession): {
  readonly total: () => number;
  readonly reset: () => void;
} {
  let bytes = 0;
  cdp.on('Network.loadingFinished', (event) => {
    bytes += event.encodedDataLength;
  });
  return {
    total: () => bytes,
    reset: () => {
      bytes = 0;
    },
  };
}

/** Bytes of every file under `dir` but source maps. */
export function directoryBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(path);
    else if (!entry.name.endsWith('.map')) total += statSync(path).size;
  }
  return total;
}

/** Long tasks in a window of the page's clock. */
export interface LongTaskStats {
  /** Long tasks ≥ 200 ms, frame renders included. */
  readonly over200: number;
  /** Long tasks ≥ 200 ms that overlap no frame callback (not frame renders). */
  readonly nonFrameOver200: number;
  /** Every long task (≥ 50 ms): ms after the window started, duration, and whether a frame render. */
  readonly log: readonly {
    readonly atMs: number;
    readonly durationMs: number;
    readonly frame: boolean;
  }[];
}

/** Classifies the long tasks that started in [fromMs, toMs] on the page's clock. */
export async function longTasksBetween(
  page: Page,
  fromMs: number,
  toMs: number,
): Promise<LongTaskStats> {
  const { tasks, frames } = await page.evaluate(() => {
    const w = window as unknown as PerfWindow;
    return { tasks: w.__vesperLongTasks, frames: w.__vesperFrames };
  });
  const overlapsFrame = (start: number, end: number): boolean => {
    for (let i = 0; i + 1 < frames.length; i += 2) {
      if ((frames[i] ?? 0) < end && (frames[i + 1] ?? 0) > start) return true;
    }
    return false;
  };
  const log = tasks
    .filter((t) => t.start >= fromMs && t.start <= toMs)
    .map((t) => ({
      atMs: Math.round(t.start - fromMs),
      durationMs: Math.round(t.duration),
      frame: overlapsFrame(t.start, t.start + t.duration),
    }));
  const over = log.filter((t) => t.durationMs >= LONG_TASK_MS);
  return { over200: over.length, nonFrameOver200: over.filter((t) => !t.frame).length, log };
}

/** One console line about the long tasks of a phase, listing those ≥ 200 ms. */
export function describeLongTasks(phase: string, stats: LongTaskStats): string {
  const over = stats.log.filter((t) => t.durationMs >= LONG_TASK_MS);
  const frames = stats.log.filter((t) => t.frame).length;
  return (
    `[perf] ${phase}: ${String(stats.log.length)} long task(s) ≥ 50 ms (${String(frames)} frame renders); ` +
    `≥ 200 ms: ${String(stats.over200)}, not frame renders: ${String(stats.nonFrameOver200)}` +
    (over.length === 0
      ? ''
      : ` [ms in: duration${over.some((t) => t.frame) ? ', f = frame render' : ''}] ` +
        over
          .map((t) => `${String(t.atMs)}: ${String(t.durationMs)}${t.frame ? 'f' : ''}`)
          .join(', '))
  );
}

/** What the game's ?perf probe publishes on #app[data-perf]. */
interface ProbeReport {
  readonly frame: Percentiles;
  readonly work: Percentiles;
  readonly samples: readonly number[];
  readonly window: { readonly startMs: number; readonly endMs: number };
}

export interface FrameSample {
  readonly run: FrameRun;
  readonly samples: readonly number[];
  /** Long tasks in the sampling window. */
  readonly longTasks: LongTaskStats;
}

/**
 * Samples frame time in `scene`: `?perf` with 1,800 frames after a 3 s warm-up, or what `capS`
 * seconds of sampling allow. Fails the test with "insufficient samples" under `minSamples` frames.
 */
export async function sampleFrames(
  page: Page,
  options: {
    scene: string;
    capS: number;
    minSamples: number;
    viewport: string;
    /** Quality preset to run at (`?quality=low` for Low). Omitted: High, the default. */
    preset?: 'low' | 'high';
    /** Spawn to start at (`?spawn=`), e.g. a rooftop view. Omitted: the scene's player start. */
    spawn?: string;
  },
): Promise<FrameSample> {
  const { scene, capS, minSamples, preset } = options;
  await page.goto(
    `/?scene=${scene}&perf=${String(capS)}&perfFrames=${String(SAMPLE_FRAMES)}&perfWarmup=${String(WARMUP_S)}` +
      (preset === 'low' ? '&quality=low' : '') +
      (options.spawn === undefined ? '' : `&spawn=${options.spawn}`),
  );
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-perf', /frame/, {
    timeout: (capS + WARMUP_S + 30) * 1_000,
  });
  const probe = JSON.parse((await app.getAttribute('data-perf')) ?? '{}') as ProbeReport;
  const stats = frameTimeStats(probe.samples, minSamples);
  expect(
    stats,
    `${scene}: ${String(probe.samples.length)} frames sampled, at least ${String(minSamples)} needed`,
  ).toMatchObject({
    ok: true,
  });
  const longTasks = await longTasksBetween(page, probe.window.startMs, probe.window.endMs);
  return {
    run: {
      scene,
      ...(preset === undefined ? {} : { preset }),
      frame: percentiles(probe.samples),
      work: probe.work,
      viewport: options.viewport,
      renderer: await rendererName(page),
    },
    samples: probe.samples,
    longTasks,
  };
}

/** The frame-time measurements of a sample (frameP50Ms, frameP95Ms) in its scene and preset. */
export function frameMeasurements({ run }: FrameSample): Measurement[] {
  const preset = run.preset === undefined ? {} : { preset: run.preset };
  return [
    { metric: 'frameP50Ms', value: run.frame.p50, scene: run.scene, ...preset },
    { metric: 'frameP95Ms', value: run.frame.p95, scene: run.scene, ...preset },
  ];
}
