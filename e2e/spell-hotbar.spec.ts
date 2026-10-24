import { expect, test, type Page } from '@playwright/test';
import { holdKey, runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e06.16: the spell hotbar and quick-select wheel in the greybox testbed against the production
// build (Chromium). The player learns Ember from the debug console (the only spell in the game's
// content so far), moves it to slot 3, selects it with the number keys, and holds the wheel (Z):
// the sim runs at a quarter speed until it is let go. The page publishes the casting state on
// #app[data-spells]; the hotbar and wheel are read from their DOM. Set E2E_HOTBAR_SHOT to a file
// path to also save a screenshot with the wheel open.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface SpellData {
  selected: string | null;
  hotbar: (string | null)[];
  slot: number | null;
  wheel: { open: boolean; highlight: number | null };
  timeScale: number;
  fizzles: string[];
}

async function spells(page: Page): Promise<SpellData> {
  const json = await page.locator('#app').getAttribute('data-spells');
  return JSON.parse(json ?? 'null') as SpellData;
}

async function start(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  return problems;
}

test('selects spells from the hotbar by key, and the held wheel slows the sim to a quarter', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = await start(page);
  const hotbar = page.getByTestId('spell-hotbar');
  const slot = (n: number) => hotbar.locator('.vb-spell-slot').nth(n);

  // Nothing learned: the bar stays out of the way.
  await expect(hotbar).toBeHidden();

  await runConsole(page, 'spell learn ember');
  await expect.poll(async () => (await spells(page)).selected, { timeout: 15_000 }).toBe('ember');
  await expect(hotbar).toBeVisible();
  await expect(slot(0)).toHaveAttribute('data-spell', 'Ember');
  await expect(slot(0)).toHaveAttribute('data-selected', 'true');
  await expect(slot(0)).toHaveAttribute('data-state', 'ready');
  await expect(slot(1)).toHaveAttribute('data-state', 'empty');
  expect((await spells(page)).hotbar.slice(0, 2)).toEqual(['ember', null]);

  // AC-4: the key of an empty slot selects nothing and breaks nothing.
  await holdKey(page, { code: 'Digit5', key: '5' }, 2, 2);
  expect((await spells(page)).slot).toBe(0);

  // Moving Ember to slot 3 empties slot 1 and clears the selection...
  await runConsole(page, 'spell slot 3 ember');
  await expect(slot(2)).toHaveAttribute('data-spell', 'Ember');
  await expect(slot(0)).toHaveAttribute('data-state', 'empty');
  await expect.poll(async () => (await spells(page)).slot).toBeNull();

  // AC-1: ...and the slot's key selects it again.
  await holdKey(page, { code: 'Numpad3', key: '3' }, 2, 2);
  await expect.poll(async () => (await spells(page)).slot).toBe(2);
  await expect(slot(2)).toHaveAttribute('data-selected', 'true');

  // AC-6: holding the wheel runs the sim at a quarter speed until it is let go.
  expect((await spells(page)).timeScale).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z' }));
  });
  const wheel = page.getByTestId('spell-wheel');
  await expect(wheel).toBeVisible();
  await expect.poll(async () => (await spells(page)).timeScale).toBe(0.25);
  // Mouse look moves the wheel's pointer, not the view: right of centre is slot 3.
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: 130, movementY: 0 }));
  });
  await expect.poll(async () => (await spells(page)).wheel.highlight).toBe(2);
  const shot = process.env['E2E_HOTBAR_SHOT'];
  if (shot !== undefined) await page.screenshot({ path: shot });
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ', key: 'z' }));
  });
  await expect(wheel).toBeHidden();
  await expect.poll(async () => (await spells(page)).timeScale).toBe(1);
  expect((await spells(page)).slot).toBe(2);
  expect((await spells(page)).fizzles).toEqual([]);
  expect(problems).toEqual([]);
});
