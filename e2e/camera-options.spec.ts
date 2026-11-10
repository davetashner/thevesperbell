import { expect, test, type Page } from '@playwright/test';
import { navigate } from './helpers/ui';
import { playerState, stubPointerLock, takeControl, LOOK_SENSITIVITY } from './helpers/player';

// mw-e31.6: look sensitivity, invert and field of view from the pause menu's Settings > Camera,
// against the production build (Chromium). The mouse look is sent through the game's own listeners;
// the published player yaw and pitch and the camera's field of view show what the sim and the lens
// did, and every change applies when the game resumes, with no reload.

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

async function playSlice(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=slice&class=knight');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

/** Moves the mouse by `x`, `y` counts and returns how far yaw and pitch turned once the sim took it. */
async function look(page: Page, x: number, y: number): Promise<{ yaw: number; pitch: number }> {
  const before = await playerState(page);
  await page.evaluate(
    ([movementX, movementY]: readonly [number, number]) => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY }));
    },
    [x, y] as const,
  );
  await expect
    .poll(async () => (await playerState(page)).tick, { timeout: 30_000 })
    .toBeGreaterThan(before.tick + 1);
  const after = await playerState(page);
  return { yaw: after.yaw - before.yaw, pitch: after.pitch - before.pitch };
}

const fovOf = async (page: Page): Promise<number> =>
  (
    JSON.parse((await page.locator('#app').getAttribute('data-orbit-camera')) ?? 'null') as {
      fov: number;
    }
  ).fov;

async function openCamera(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'open');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('[data-screen="options"]')).toBeVisible();
  await page.locator('[role="tab"]', { hasText: 'Camera' }).click();
}

async function resume(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await takeControl(page);
}

test('AC-3: sensitivity, invert and field of view changed in the menu apply on return, without a reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await playSlice(page);

  // The defaults are the content's: 0.003 rad per count, not inverted, 70 degrees.
  const plain = await look(page, 50, 50);
  expect(plain.yaw).toBeCloseTo(-50 * LOOK_SENSITIVITY, 4);
  expect(plain.pitch).toBeLessThan(0); // the mouse moved down
  expect(Math.abs(plain.pitch)).toBeCloseTo(50 * LOOK_SENSITIVITY, 4);
  await expect.poll(() => fovOf(page)).toBeCloseTo(70, 1);

  await openCamera(page);
  const sensitivity = setting(page, 'camera.sensitivity');
  await sensitivity.focus();
  await navigate(page, Array<'right'>(10).fill('right')); // ×1.0 to ×2.0
  await expect(sensitivity).toHaveAttribute('aria-valuetext', '×2.0');
  await setting(page, 'camera.invertY').click();
  const fov = setting(page, 'camera.fov');
  await fov.focus();
  await navigate(page, Array<'right'>(6).fill('right')); // 70° to 100°
  await expect(fov).toHaveAttribute('aria-valuetext', '100°');
  await resume(page);

  const fast = await look(page, 50, 50);
  expect(fast.yaw).toBeCloseTo(2 * plain.yaw, 4);
  expect(fast.pitch).toBeCloseTo(-2 * plain.pitch, 4);
  await expect.poll(() => fovOf(page), { timeout: 30_000 }).toBeCloseTo(100, 1);

  // Horizontal invert flips the turn the other way.
  await openCamera(page);
  await setting(page, 'camera.invertX').click();
  await resume(page);
  const flipped = await look(page, 50, 0);
  expect(flipped.yaw).toBeCloseTo(-fast.yaw, 4);
});

test('the camera options stay in reach at phone width and with the keyboard', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 780 });
  await playSlice(page);
  await openCamera(page);
  for (const key of ['sensitivity', 'invertX', 'invertY', 'autoCentre', 'fov']) {
    const row = setting(page, `camera.${key}`);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box, key).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 390, key).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const auto = setting(page, 'camera.autoCentre');
  await auto.focus();
  await navigate(page, ['confirm']);
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await takeControl(page);
  await openCamera(page);
  await expect(setting(page, 'camera.autoCentre')).toHaveAttribute('aria-checked', 'true');
});
