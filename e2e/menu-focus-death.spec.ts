import { expect, test } from '@playwright/test';
import { runConsole, stubPointerLock } from './helpers/player';
import { installVirtualPad } from './helpers/ui';
import { audit, collectProblems, PAD, POLL, tapPad, topIs } from './helpers/menu-focus-spec';

// mw-e31.11: the death screen and its load list (B returns from the list to the choices).

test('AC-1, AC-2, AC-3: the death screen and its load list', async ({ page }) => {
  test.setTimeout(120_000);
  await installVirtualPad(page);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=slice&class=knight&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, POLL);
  await runConsole(page, 'save manual-1');
  await runConsole(page, 'kill');
  await topIs(page, 'death');
  await audit(page, 'death');
  await page.locator('[data-screen="death"] button', { hasText: 'Load…' }).focus();
  await tapPad(page, PAD.a);
  await expect
    .poll(() => page.locator('[data-screen="death"] [data-save]').count(), POLL)
    .toBeGreaterThan(0);
  await audit(page, 'death: load list');
  await tapPad(page, PAD.b);
  await expect(page.locator('[data-screen="death"] [data-save]')).toBeHidden(POLL);
  expect(problems).toEqual([]);
});
