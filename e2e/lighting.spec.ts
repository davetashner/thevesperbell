import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { attachFrame, captureFrame } from './helpers/canvas';

// mw-e03.37: rendered light mirrors the sim's light field, against the production build (Chromium).
// The lighting room (src/content/data/scene/lighting-room.json) is a roofed room at night with two
// wall torches, a burning crate and moonlight through a doorway. With ?lightprobe the game publishes
// the sim's light level at every floor point the camera can see, with its screen position
// (#app[data-light-probe]); the test reads the rendered luma there. #app[data-lights] holds the sim
// level and rendered light intensity of each lit spawn, both from the same frame.

interface ProbeSample {
  at: { x: number; y: number; z: number };
  level: number;
  ndc: { x: number; y: number };
}

interface LightReadout {
  tick: number;
  spawns: Record<string, { entity: number; sim: number; rendered: number }>;
}

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function probe(page: Page): Promise<ProbeSample[]> {
  const json = await page.locator('#app').getAttribute('data-light-probe');
  return JSON.parse(json ?? '[]') as ProbeSample[];
}

async function lights(page: Page): Promise<LightReadout> {
  const json = await page.locator('#app').getAttribute('data-lights');
  return JSON.parse(json ?? 'null') as LightReadout;
}

/** Ranks with ties averaged. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.value === order[i]?.value) j++;
    for (let k = i; k <= j; k++) out[order[k]?.index ?? 0] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation: Pearson correlation of the ranks. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] ?? 0) - ma;
    const y = (rb[i] ?? 0) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

/** `count` samples spread evenly through `samples` (which is in floor-grid order). */
function spread<T>(samples: readonly T[], count: number): T[] {
  return Array.from(
    { length: count },
    (_, i) => samples[Math.floor((i * samples.length) / count)] as T,
  );
}

async function openLightingRoom(page: Page, query = ''): Promise<void> {
  await page.goto(`/?scene=lighting-room&lightprobe${query}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'lighting-room', { timeout: 10_000 });
  await expect
    .poll(async () => (await probe(page)).length, { timeout: 10_000 })
    .toBeGreaterThan(20);
  await expect
    .poll(async () => (await lights(page)).spawns['torch-west']?.rendered ?? 0)
    .toBeGreaterThan(0);
}

test('AC-1: in the lighting room, sim light level and rendered luminance at 20 floor points rank-correlate ≥ 0.8', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openLightingRoom(page);
  const samples = spread(await probe(page), 20);
  expect(samples).toHaveLength(20);
  const frame = await captureFrame(page, {
    afterMs: 200,
    png: true,
    points: samples.map((s) => s.ndc),
  });
  await attachFrame(testInfo, 'lighting-room', frame);
  const levels = samples.map((s) => s.level);
  const luma = frame.luma ?? [];
  const rho = spearman(levels, luma);
  const parity = JSON.stringify(
    { rho, samples: samples.map((s, i) => ({ ...s, luma: luma[i] })) },
    null,
    2,
  );
  await writeFile(testInfo.outputPath('parity.json'), parity);
  await testInfo.attach('parity', { body: parity, contentType: 'application/json' });
  // The room has both lit and dark floor, so the check has something to rank.
  expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
  expect(rho).toBeGreaterThanOrEqual(0.8);
  expect(problems).toEqual([]);
});

test('AC-3: a torch that stops burning goes dark on screen on the same tick its sim light drops', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openLightingRoom(page, '&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  const before = await lights(page);
  const torch = before.spawns['torch-west'];
  expect(torch?.sim).toBeGreaterThanOrEqual(0.9);
  // The floor point the west torch lights most, and how bright it is on screen now.
  const lit = (await probe(page)).reduce((best, s) =>
    Math.hypot(s.at.x + 4.75, s.at.z + 2) < Math.hypot(best.at.x + 4.75, best.at.z + 2) ? s : best,
  );
  const [litBefore = 0] = (await captureFrame(page, { points: [lit.ndc] })).luma ?? [];

  await page.getByTestId('game-canvas').click();
  await page.keyboard.press('Backquote');
  await expect(app).toHaveAttribute('data-debug-console', 'open');
  // With the fire rules in the game a hot flammable thing relights itself, so the torch is cooled as
  // well as put out (both commands apply on the same tick).
  const input = page.getByTestId('debug-console-input');
  await input.fill(`prop ${String(torch?.entity)} temperature 20`);
  await page.keyboard.press('Enter');
  await input.fill(`prop ${String(torch?.entity)} burning false`);
  await page.keyboard.press('Enter');

  // The first published readout where the sim level has dropped already has the light off: both come
  // from the same frame, which drew the tick the property changed on.
  await expect
    .poll(async () => (await lights(page)).spawns['torch-west']?.sim ?? 1)
    .toBeLessThan(0.5);
  const after = await lights(page);
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.spawns['torch-west']?.rendered).toBe(0);
  expect(after.spawns['torch-east']?.rendered).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const frame = await captureFrame(page, { afterMs: 200, png: true, points: [lit.ndc] });
  await attachFrame(testInfo, 'torch-out', frame);
  const [litAfter = 0] = frame.luma ?? [];
  expect(litAfter).toBeLessThan(litBefore * 0.7);
  expect(problems).toEqual([]);
});
