import { expect, test, type Page } from '@playwright/test';
import { focusRing, navigate } from './helpers/ui';
import { stubPointerLock, takeControl } from './helpers/player';

// mw-e31.3: hold or toggle for sprint, crouch, block and aim/draw, against the production build
// (Chromium). Block is the observable one: the player readout publishes `combat.blocking`. The
// setting lives in the pause menu's Settings > Controls; a toggled block stays up after the button
// is released, drops when a menu opens (and does not come back), and the choice survives a reload.

const RIGHT_BUTTON = 2;

async function playSlice(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=slice&class=knight');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

const blocking = async (page: Page): Promise<boolean> => {
  const json = await page.locator('#app').getAttribute('data-player');
  const readout = JSON.parse(json ?? 'null') as { combat?: { blocking: boolean } } | null;
  return readout?.combat?.blocking === true;
};

const expectBlocking = (page: Page, value: boolean) =>
  expect.poll(() => blocking(page), { timeout: 30_000 }).toBe(value);

/** Presses (and, when `release`, lets go of) the right mouse button, which is Block. */
async function block(page: Page, phase: 'down' | 'up'): Promise<void> {
  await page.evaluate(
    ([type, button]) => {
      window.dispatchEvent(new MouseEvent(type as string, { button: button as number }));
    },
    [phase === 'down' ? 'mousedown' : 'mouseup', RIGHT_BUTTON],
  );
}

async function openControls(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'open');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
}

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

/** Steps a hold/toggle select with the keyboard, as the menu's own navigation does. */
async function choose(page: Page, key: string, label: 'Hold' | 'Toggle'): Promise<void> {
  const control = setting(page, key);
  await control.focus();
  if ((await control.getAttribute('aria-valuetext')) !== label) await navigate(page, ['right']);
  await expect(control).toHaveAttribute('aria-valuetext', label);
}

async function resume(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

test('AC-1, AC-2, AC-3: toggled block stays up after release, drops when a menu opens, and a mode change leaves nothing stuck', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await playSlice(page);

  // Defaults keep today's behaviour: hold.
  await block(page, 'down');
  await expectBlocking(page, true);
  await block(page, 'up');
  await expectBlocking(page, false);

  await openControls(page);
  for (const key of ['sprint', 'crouch', 'block', 'aim']) {
    await expect(setting(page, `controls.${key}`)).toHaveAttribute('aria-valuetext', 'Hold');
  }
  await choose(page, 'controls.block', 'Toggle');
  await resume(page);

  // One press and release keeps the shield up; the next press lowers it.
  await block(page, 'down');
  await block(page, 'up');
  await expectBlocking(page, true);
  await block(page, 'down');
  await block(page, 'up');
  await expectBlocking(page, false);

  // AC-2: raised, then a menu opens: the shield drops and stays down after the menu closes.
  await block(page, 'down');
  await block(page, 'up');
  await expectBlocking(page, true);
  await openControls(page);
  await resume(page);
  await expectBlocking(page, false);
  await openControls(page);

  // AC-3: back to hold from the menu; nothing is stuck, and hold works as before.
  await choose(page, 'controls.block', 'Hold');
  await resume(page);
  await expectBlocking(page, false);
  await block(page, 'down');
  await expectBlocking(page, true);
  await block(page, 'up');
  await expectBlocking(page, false);
});

test('the setting persists across a reload, and the controls read at phone width with a visible focus', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 780 });
  await playSlice(page);
  await openControls(page);
  await choose(page, 'controls.aim', 'Toggle');
  await choose(page, 'controls.crouch', 'Toggle');
  const ring = await focusRing(page);
  expect(ring?.width ?? 0).toBeGreaterThanOrEqual(2);
  const row = setting(page, 'controls.aim');
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
  await openControls(page);
  await expect(setting(page, 'controls.aim')).toHaveAttribute('aria-valuetext', 'Toggle');
  await expect(setting(page, 'controls.crouch')).toHaveAttribute('aria-valuetext', 'Toggle');
  await expect(setting(page, 'controls.block')).toHaveAttribute('aria-valuetext', 'Hold');
});
