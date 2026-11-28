import { expect, test, type Page } from '@playwright/test';
import { countsReturn, heapGrowth } from '../scripts/perf/leak';
import { runConsole, stubPointerLock } from './helpers/player';

// mw-e32.12: repeated in-place area swaps (mw-ju8.28) do not leak, against the production build
// (Chromium). Each cycle saves, walks out of valley-01 by its north gate into valley-02 and back
// (two swaps; the page is never reloaded, a marker on the document proves it), then samples the JS
// heap after a forced GC (CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage) and the renderer's
// geometry and texture counts (#app[data-renderer-memory], from renderer.info.memory). Cycle 1 is
// warm-up; the detector (scripts/perf/leak.ts, proven against a leaking fixture in leak.test.ts)
// compares the last cycles with the ones after a four-cycle warm-up (JIT code, lazy chunks, first-swap content), sampling the GPU counts once they settle. Chromium only: CDP is a Chromium feature.
//
// A load from a save reloads the page (location.assign), which resets the renderer by construction,
// so the repeated "load" is the area swap that rebuilds the world on the surviving renderer.

const CYCLES = 20;
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const FRAME_LOOP_NOTICE = 'frame loop: ';

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Runs a console line that crosses a gate and waits for the in-place swap into `scene`. */
async function crossBy(page: Page, line: string, scene: string): Promise<void> {
  await runConsole(page, line).catch((error: unknown) => {
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

/**
 * The renderer's counts once they stop moving: a mesh or texture uploads on the first frame that
 * draws it, a few frames after the swap, so a read at "ready" is early (mw-e06.12). Settled means
 * the same value on 10 reads 100 ms apart.
 */
async function settledMemory(page: Page): Promise<{ geometries: number; textures: number }> {
  let last = await rendererMemory(page);
  let steady = 0;
  for (let reads = 0; steady < 10 && reads < 300; reads += 1) {
    await page.waitForTimeout(100);
    const now = await rendererMemory(page);
    steady = now.geometries === last.geometries && now.textures === last.textures ? steady + 1 : 0;
    last = now;
  }
  return last;
}

async function rendererMemory(page: Page): Promise<{ geometries: number; textures: number }> {
  const raw = await page.locator('#app').getAttribute('data-renderer-memory');
  return JSON.parse(raw ?? '{}') as { geometries: number; textures: number };
}

test('AC-1, AC-2: 20 save and area-swap cycles keep the heap and the renderer’s GPU resources bounded', async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=valley-01&debug=1');
  await ready(page, 'valley-01');
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)['__sameDocument'] = true;
  });
  const cdp = await page.context().newCDPSession(page);

  const heap: number[] = [];
  const geometries: number[] = [];
  const textures: number[] = [];
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    await runConsole(page, 'save leak-check');
    await crossBy(page, 'tp 6 0 52.5', 'valley-02');
    await crossBy(page, 'tp 0 0 1', 'valley-01');
    await cdp.send('HeapProfiler.collectGarbage');
    heap.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
    const memory = await settledMemory(page);
    geometries.push(memory.geometries);
    textures.push(memory.textures);
  }
  const verdicts = {
    heap: heapGrowth(heap),
    geometries: countsReturn('geometries', geometries),
    textures: countsReturn('textures', textures),
  };
  const series = { heap, geometries, textures };
  console.log(`[leak] ${JSON.stringify(series)}`);
  await testInfo.attach('leak-series.json', {
    body: JSON.stringify({ series, verdicts }, null, 2),
    contentType: 'application/json',
  });

  // Never a page reload: every cycle swapped in place.
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['__sameDocument']),
  ).toBe(true);
  // AC-1: heap growth from cycle 2 to cycle 20 stays within the limit.
  expect.soft(verdicts.heap.ok, verdicts.heap.detail).toBe(true);
  // AC-2: geometry and texture counts return to the settled post-warm-up value (±2).
  expect.soft(verdicts.geometries.ok, verdicts.geometries.detail).toBe(true);
  expect.soft(verdicts.textures.ok, verdicts.textures.detail).toBe(true);
  expect(problems).toEqual([]);
});
