import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attachFrame, captureFrame, distinct } from './helpers/canvas';

// mw-e29.7 AC-1 and AC-2: the magical material test scene (?scene=testbed&magic=materials) against the
// production build, in Chromium, Firefox and WebKit. It draws one of each material (dissolve at four
// stages and live, fresnel glow, emissive pulse, rune decal, heat haze, soft particles beside hard
// ones); every shader must compile with nothing logged, and the frame must be a real picture.
// The page publishes the library's counters on #app[data-magic] (JSON).
//
// Set E2E_MAGIC_SHOTS to a directory to also save screenshots (the full page, per browser).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface MagicProbe {
  tier: 'high' | 'low';
  hazes: number;
  distortionSkipped: number;
  distortionPasses: number;
  depthPasses: number;
  demo?: {
    mode: string;
    placed: boolean;
    items: string[];
    dissolves: number[];
    sharedMaterialUntouched: boolean;
    copies: number;
  };
}

/** Console errors/warnings (shader compile errors included) and uncaught exceptions. */
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

async function probe(page: Page): Promise<MagicProbe | null> {
  const json = await page.locator('#app').getAttribute('data-magic');
  return JSON.parse(json ?? 'null') as MagicProbe | null;
}

// Software WebGL renders every pixel on the CPU, so a small viewport keeps frames fast under load.
test.use({ viewport: { width: 960, height: 540 } });

async function saveShot(page: Page, name: string, browser: string): Promise<void> {
  const dir = process.env['E2E_MAGIC_SHOTS'];
  if (dir === undefined) return;
  await mkdir(dir, { recursive: true });
  const frame = await captureFrame(page, { png: true });
  const base64 = (frame.png ?? '').replace(/^data:image\/png;base64,/, '');
  await writeFile(join(dir, `${name}-${browser}.png`), Buffer.from(base64, 'base64'));
}

test('AC-1: every material of the test scene draws with no shader errors and a real picture', async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&magic=materials&quality=high');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 20_000 });
  await expect
    .poll(async () => (await probe(page))?.demo?.placed ?? false, { timeout: 30_000 })
    .toBe(true);
  // Let several frames draw so every program has compiled and the passes have run.
  await expect
    .poll(async () => (await probe(page))?.distortionPasses ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(2);
  await expect
    .poll(async () => (await probe(page))?.depthPasses ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(2);

  const stats = await probe(page);
  expect(stats?.tier).toBe('high');
  expect(stats?.hazes).toBe(1);
  expect(stats?.demo?.items).toEqual(
    expect.arrayContaining(['fresnel', 'pulse', 'rune', 'haze', 'soft', 'hard', 'dissolve-live']),
  );
  // The five dissolving figures were made from one shared material, which was never patched.
  expect(stats?.demo?.sharedMaterialUntouched).toBe(true);
  expect(stats?.demo?.dissolves.slice(0, 4)).toEqual([0, 0.35, 0.65, 0.9]);

  // The frame is a picture, and it moves (live dissolve, pulse and haze flow).
  const first = await captureFrame(page, { png: true });
  await attachFrame(testInfo, `magic-materials-${browserName}`, first);
  expect(distinct(first)).toBeGreaterThan(20);
  const later = await captureFrame(page, { afterMs: 500 });
  const changed = first.rgb.filter((colour, i) => colour !== later.rgb[i]).length;
  expect(changed).toBeGreaterThan(10);
  await saveShot(page, 'materials-high', browserName);

  expect(problems).toEqual([]);
});

test('AC-2: on Low distortion is skipped and no distortion pass ever runs', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&magic=materials&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', { timeout: 20_000 });
  await expect
    .poll(async () => (await probe(page))?.demo?.placed ?? false, { timeout: 30_000 })
    .toBe(true);
  // Plenty of frames draw (the live dissolve keeps moving) ...
  const before = await captureFrame(page, { png: true });
  const after = await captureFrame(page, { afterMs: 800 });
  expect(distinct(before)).toBeGreaterThan(20);
  expect(after.rgb.filter((colour, i) => colour !== before.rgb[i]).length).toBeGreaterThan(10);
  // ... and the haze was asked for, refused, and never copied a frame; soft particles took no depth.
  const stats = await probe(page);
  expect(stats).toMatchObject({
    tier: 'low',
    hazes: 0,
    distortionSkipped: 1,
    distortionPasses: 0,
    depthPasses: 0,
  });
  await saveShot(page, 'materials-low', browserName);
  expect(problems).toEqual([]);
});
