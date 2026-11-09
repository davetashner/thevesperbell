import { expect, test, type Page } from '@playwright/test';
import { focusRing } from './helpers/ui';
import { stubPointerLock, takeControl } from './helpers/player';

// mw-e31.2: remapping from the pause menu's Settings, against the production build (Chromium). The
// Key bindings panel (Controls tab) takes a key in capture mode; Esc cancels without binding Esc; a
// clash asks Swap or Cancel; the new layout drives the knight's dodge (the backstep, mw-e04.8) at
// once and is still there after a reload. Dodge ships on R in this build, so the Shift rebind is a
// swap with Sprint (Shift's default), which also exercises the conflict prompt end to end.

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

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
}

const player = async (page: Page): Promise<PlayerData> =>
  JSON.parse((await page.locator('#app').getAttribute('data-player')) ?? 'null') as PlayerData;

async function playSlice(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=slice&class=knight');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

/** Pause, then Settings: the options screen over the pause menu, on the Controls tab. */
async function openControls(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'open');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
  await expect(page.locator('[data-bindings]')).toBeVisible();
}

const slot = (page: Page, action: string, n = 0) =>
  page.locator(`[data-binding="${action}:${String(n)}"]`);

/** Back out of the options and the pause menu, and take the pointer again. */
async function resume(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

/** Taps `code` and returns how far the player moved over the next 40 sim ticks. */
async function tapAndMeasure(page: Page, code: string): Promise<number> {
  const before = await player(page);
  await page.evaluate((c) => {
    for (const type of ['keydown', 'keyup']) {
      window.dispatchEvent(new KeyboardEvent(type, { code: c, bubbles: true }));
    }
  }, code);
  // 40 ticks at about a frame a second, five ticks a frame, with slow answers (mw-8qo).
  await expect
    .poll(async () => (await player(page)).tick, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(before.tick + 40);
  const after = await player(page);
  return Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
}

test('AC-1, AC-5: Dodge rebound to Shift dodges on Shift, not on its old key, and survives a reload', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await playSlice(page);
  expect(await tapAndMeasure(page, 'KeyR')).toBeGreaterThan(1);

  await openControls(page);
  await expect(slot(page, 'dodge')).toHaveText('R');
  await slot(page, 'dodge').click();
  await page.keyboard.press('ShiftLeft');
  // Shift is Sprint's: the prompt asks, and Swap hands Sprint the R key.
  await expect(page.locator('[data-bindings-conflict]')).toContainText(
    'Shift is already used by Sprint',
  );
  await page.locator('[data-bindings-swap]').click();
  await expect(slot(page, 'dodge')).toHaveText('Shift');
  await expect(slot(page, 'sprint')).toHaveText('R');
  await resume(page);

  expect(await tapAndMeasure(page, 'ShiftLeft')).toBeGreaterThan(1);
  expect(await tapAndMeasure(page, 'KeyR')).toBeLessThan(0.1);

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-player', /"grounded":true/, {
    timeout: 30_000,
  });
  await takeControl(page);
  await openControls(page);
  await expect(slot(page, 'dodge')).toHaveText('Shift');
  await expect(slot(page, 'sprint')).toHaveText('R');
  await resume(page);
  expect(await tapAndMeasure(page, 'ShiftLeft')).toBeGreaterThan(1);
  expect(problems).toEqual([]);
});

test('AC-4: Esc in capture mode cancels without binding Esc or leaving the options', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await playSlice(page);
  await openControls(page);
  await slot(page, 'dodge').click();
  await expect(slot(page, 'dodge')).toHaveText('Press a key…');
  await page.keyboard.press('Escape');
  await expect(slot(page, 'dodge')).toHaveText('R');
  await expect(page.locator('[data-bindings-status]')).toHaveText(
    'Cancelled. Escape was not bound.',
  );
  // The options are still open (the Esc did not also go Back), and nothing was saved.
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
  await expect(slot(page, 'pause')).toHaveText('Esc');
  await expect(slot(page, 'pause', 1)).toHaveText('P');
});

test('the bindings panel works at phone width, from the keyboard, with a visible focus ring', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 667 });
  await playSlice(page);
  await openControls(page);
  const button = slot(page, 'dodge');
  await button.focus();
  await expect(button).toBeFocused();
  // Step away and back with Tab, as a keyboard player does: the UI shows its focus ring.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  const ring = await focusRing(page);
  expect(ring?.style).not.toBe('none');
  expect(ring?.contrast ?? 0).toBeGreaterThanOrEqual(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Press a key…');
  await page.keyboard.press('KeyH');
  await expect(button).toHaveText('H');
});
