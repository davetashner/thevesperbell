import { expect, test } from '@playwright/test';
import { runConsole, stubPointerLock, turnTo } from './helpers/player';
import { installVirtualPad } from './helpers/ui';
import { auditTabs, collectProblems, PAD, POLL, tapPad } from './helpers/menu-focus-spec';

// mw-e31.11: the shop, every tab (Buy, Sell, Buyback, Services), and B closes it.

test('AC-1, AC-2, AC-3: the shop, every tab, and B closes it', async ({ page }) => {
  test.setTimeout(120_000);
  await installVirtualPad(page);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=shop-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, POLL);
  await runConsole(page, 'tp -2 0 -0.2');
  await turnTo(page, { x: -2, z: 1 });
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-shop', /"open":true/, POLL);
  expect(await auditTabs(page, 'shop')).toEqual(['Buy', 'Sell', 'Buyback', 'Services']);
  await tapPad(page, PAD.b);
  await expect(app).toHaveAttribute('data-shop', /"open":false/, POLL);
  expect(problems).toEqual([]);
});
