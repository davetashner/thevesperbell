import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e03.29: the field debug overlay (`fields <layer>`, `inspect`, `stim`) in the grey-box testbed,
// against the production build, which is a debug build: with ?debug=1 the console and the overlay
// load. The page publishes #app[data-field-debug] ({ layer, cells, selected }) after a frame that
// changes it. Set FIELD_DEBUG_SHOTS to a directory to also save screenshots.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Readout {
  layer: string | null;
  cells: number;
  selected: number | null;
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

async function readout(page: Page): Promise<Readout | null> {
  const json = await page.locator('#app').getAttribute('data-field-debug');
  return json === null ? null : (JSON.parse(json) as Readout);
}

const shots = process.env['FIELD_DEBUG_SHOTS'];
async function shoot(page: Page, name: string): Promise<void> {
  if (shots !== undefined) await page.screenshot({ path: `${shots}/${name}.png` });
}

async function start(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&elements&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 15_000 });
  await takeControl(page);
}

test.use({ viewport: { width: 1280, height: 720 } });

test('AC-4: toggling the overlay through every layer, with stimuli and the inspector, logs no console errors', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await start(page);
  await expect.poll(async () => (await readout(page))?.layer).toBeNull();
  await expect(page.getByTestId('field-debug-panel')).toBeHidden();

  // A crate to inspect, a few metres ahead, and heat, water and charge in front of the player.
  await runConsole(page, 'tp 0 0 -1');
  await turnTo(page, { x: 0, z: 3 });
  await runConsole(page, 'tp 0 0 -1');
  await runConsole(page, 'spawn testprop-crate at-cursor');
  await runConsole(page, 'stim heat 600 3');
  await runConsole(page, 'stim water 1 3');
  await runConsole(page, 'stim charge 300 2');

  for (const layer of ['temperature', 'moisture', 'gas', 'charge', 'light']) {
    await runConsole(page, `fields ${layer}`);
    await expect.poll(async () => (await readout(page))?.layer, { timeout: 15_000 }).toBe(layer);
    await expect(page.getByTestId('field-debug-panel')).toContainText(`layer: ${layer}`);
    if (layer === 'temperature' || layer === 'light') {
      await expect.poll(async () => (await readout(page))?.cells ?? 0).toBeGreaterThan(0);
      await shoot(page, `layer-${layer}`);
    }
  }

  await runConsole(page, 'inspect');
  await expect(page.getByTestId('field-debug-panel')).toContainText('stimuli (newest first)');
  await shoot(page, 'inspector-and-light');
  await runConsole(page, 'fields off');
  await expect.poll(async () => (await readout(page))?.layer).toBeNull();
  await runConsole(page, 'inspect none');
  await expect(page.getByTestId('field-debug-panel')).toBeHidden();
  expect(problems).toEqual([]);
});

test('the overlay is safe on a scene that does not exist, and off by default elsewhere', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=does-not-exist&debug=1');
  await expect(page.locator('#app')).toContainText('does-not-exist');
  // The debug console still loads, and with it the overlay: off, panel hidden.
  await expect(page.getByTestId('field-debug-panel')).toBeHidden();
  await page.goto('/?scene=testbed');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  expect(await page.getByTestId('field-debug-panel').count()).toBe(0);
  expect(problems.filter((p) => !/404|Failed to load resource/.test(p))).toEqual([]);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('the panel stays inside the screen', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page);
    await runConsole(page, 'stim heat 600 3');
    await runConsole(page, 'fields temperature');
    await expect.poll(async () => (await readout(page))?.cells ?? 0).toBeGreaterThan(0);
    const box = await page.getByTestId('field-debug-panel').boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await shoot(page, 'phone-temperature');
  });
});
