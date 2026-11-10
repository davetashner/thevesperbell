import { expect, test } from '@playwright/test';
import { runConsole, stubPointerLock, turnTo } from './helpers/player';
import { installVirtualPad } from './helpers/ui';
import {
  audit,
  collectProblems,
  PAD,
  POLL,
  screenStack,
  tapPad,
  topIs,
} from './helpers/menu-focus-spec';

// mw-e31.11: the inventory with its action menu, and the container window, in the testbed.

test.beforeEach(async ({ page }) => {
  await installVirtualPad(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-player', /"grounded":true/, POLL);
});

test('AC-1, AC-2, AC-3: the inventory and its action menu; B closes the menu, then the inventory', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  const app = page.locator('#app');
  await runConsole(page, 'give healing-draught 3');
  await runConsole(page, 'give lockpicks 2');
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'open', POLL);
  await audit(page, 'inventory');
  await tapPad(page, PAD.a);
  await topIs(page, 'inventory-actions', ['inventory', 'inventory-actions']);
  await audit(page, 'inventory action menu');
  await tapPad(page, PAD.b);
  await topIs(page, 'inventory');
  await expect.poll(async () => (await screenStack(page)).inTop, POLL).toBe(true);
  await tapPad(page, PAD.b);
  await expect(app).toHaveAttribute('data-inventory', 'closed', POLL);
  expect(problems).toEqual([]);
});

test('AC-1, AC-2, AC-3: the container window; B closes it', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  const app = page.locator('#app');
  await runConsole(page, 'tp -2 0 -0.2');
  await turnTo(page, { x: -2, z: 1 });
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-container-window', 'open', POLL);
  await audit(page, 'container');
  await tapPad(page, PAD.b);
  await expect(app).toHaveAttribute('data-container-window', 'closed', POLL);
  expect(problems).toEqual([]);
});
