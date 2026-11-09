import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e03.23: hiding in the testbed's wardrobe and haystack against the production build (Chromium).
// The player slips into the wardrobe with Interact, looks out through its peek camera, steps out, then
// hides in the haystack and is thrown out of it when it catches fire. Zero console errors. Screenshots
// land in E2E_HIDING_SHOTS when it is set (the PR's evidence).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Reading {
  entity: number;
  occupied: boolean;
  occupants: string[];
}
interface Hiding {
  spots: Record<string, Reading>;
  player: string | null;
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

const hiding = async (page: Page): Promise<Hiding> =>
  JSON.parse((await page.locator('#app').getAttribute('data-hiding')) ?? 'null') as Hiding;

/** Presses the Interact key (E) through the game's own listeners. */
async function interact(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
  });
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_HIDING_SHOTS'];
  if (dir === undefined) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

test('a thief hides in the wardrobe, peeks out, leaves, and a burning haystack evicts them (mw-e03.23)', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await takeControl(page);

  // The wardrobe at (4.5, 1.5) opens towards −x.
  await runConsole(page, 'tp 3.3 0 1.5');
  await turnTo(page, -Math.PI / 2);
  await expect(page.getByTestId('interact-prompt')).toContainText('Hide');
  await shot(page, '1-entering');
  await interact(page);
  await expect.poll(async () => (await hiding(page)).player).toBe('hiding-wardrobe');
  expect((await hiding(page)).spots['hiding-wardrobe']?.occupied).toBe(true);
  await expect(page.getByTestId('interact-prompt')).toContainText('Leave');
  await shot(page, '2-inside-peek-view');
  await interact(page);
  await expect.poll(async () => (await hiding(page)).player).toBeNull();

  // The haystack at (1.5, 3) opens towards −z. A burning haystack throws the player out.
  await runConsole(page, 'tp 1.5 0 1.7');
  await turnTo(page, Math.PI);
  await interact(page);
  await expect.poll(async () => (await hiding(page)).player).toBe('hiding-haystack');
  const haystack = (await hiding(page)).spots['hiding-haystack']?.entity;
  expect(haystack).toBeDefined();
  await runConsole(page, `prop ${String(haystack)} temperature 600`);
  await expect.poll(async () => (await hiding(page)).player, { timeout: 20_000 }).toBeNull();
  await shot(page, '3-ejected-by-fire');

  expect(problems).toEqual([]);
});
