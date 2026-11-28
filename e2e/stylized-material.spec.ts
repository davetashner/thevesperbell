import { expect, test, type Page } from '@playwright/test';
import { attachFrame, captureFrame, distinct } from './helpers/canvas';

// mw-e37.13: the shared stylized material's test scene (testbed/materials.html) against the production
// build, at High and Low. A row of spheres under the golden-hour preset: pure black, pure white, dry and
// wet stone, an emissive glyph mask and a normal-mapped stone. The page publishes what it read off its
// own frame on #status[data-probe]. Screenshots of both are attached to the report (AC-1's pictures).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

type Rgb = [number, number, number];

interface Probe {
  quality: 'high' | 'low';
  programs: { count: number; normalMapped: number };
  blackShadow: Rgb;
  whiteLit: Rgb;
  dry: Rgb;
  wet: Rgb;
  errors: number;
}

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

async function open(page: Page, quality: 'high' | 'low'): Promise<Probe> {
  await page.goto(`/testbed/materials.html?quality=${quality}`);
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  return JSON.parse((await status.getAttribute('data-probe')) ?? 'null') as Probe;
}

const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luma = ([r, g, b]: Rgb): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

test.use({ viewport: { width: 1000, height: 600 } });

for (const quality of ['high', 'low'] as const) {
  test(`AC-1, AC-4: the material test scene draws at ${quality} with no console errors`, async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    const probe = await open(page, quality);
    expect(probe.quality).toBe(quality);
    expect(probe.errors).toBe(0);
    expect(probe.programs.count).toBeGreaterThan(0);
    // AC-4: Low compiles no normal-map sampling; High does, for the normal-mapped sphere.
    if (quality === 'low') expect(probe.programs.normalMapped).toBe(0);
    else expect(probe.programs.normalMapped).toBeGreaterThan(0);
    const frame = await captureFrame(page, { png: true });
    expect(distinct(frame)).toBeGreaterThan(20);
    await attachFrame(testInfo, `stylized-material-${quality}`, frame);
    expect(problems).toEqual([]);
  });
}

test('AC-3, AC-5: black shadows lean to dusk, white clamps below cream, wet is 20–30 % darker', async ({
  page,
}) => {
  const probe = await open(page, 'high');
  // AC-5: pure black in shadow is never black: it sits near dusk #3B3A5A, blue above red.
  const [r, g, b] = probe.blackShadow;
  expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(30);
  expect(b).toBeGreaterThan(r + 10);
  for (const [got, want] of [
    [r, 0x3b],
    [g, 0x3a],
    [b, 0x5a],
  ]) {
    expect(Math.abs((got ?? 0) - (want ?? 0))).toBeLessThanOrEqual(25);
  }
  // AC-5: pure white in full light stays at or below cream #FFF4DC, never pure white.
  const cream: Rgb = [0xff, 0xf4, 0xdc];
  probe.whiteLit.forEach((c, i) => {
    expect(c).toBeLessThanOrEqual((cream[i] ?? 255) + 2);
  });
  expect(probe.whiteLit.some((c) => c < 250)).toBe(true);
  // AC-3: the wet sphere's diffuse light is 20–30 % below the dry one's (a little slack for the rim).
  const ratio = luma(probe.wet) / luma(probe.dry);
  expect(ratio).toBeGreaterThanOrEqual(0.67);
  expect(ratio).toBeLessThanOrEqual(0.83);
});
