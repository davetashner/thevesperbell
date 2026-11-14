// Motion comfort defaults (mw-e31.7) in a real browser: a system that asks for reduced motion starts
// with the camera shake at 0% and reduce-flashing on; a system that does not starts with the shake
// at full and reduce-flashing off.
import { expect, test, type Page } from '@playwright/test';
import { openScreen, openUiPage } from './helpers/ui';

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

async function shown(page: Page) {
  await openUiPage(page);
  await openScreen(page, 'options');
  await page.locator('[role="tab"]', { hasText: 'Camera' }).click();
  const shake = await setting(page, 'camera.shakeScale').getAttribute('aria-valuetext');
  await page.locator('[role="tab"]', { hasText: 'Accessibility' }).click();
  const flashing = await setting(page, 'accessibility.reduceFlashing').getAttribute('aria-checked');
  return { shake, flashing };
}

test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });
  test('AC-3: first launch has shake 0% and reduce-flashing on', async ({ page }) => {
    expect(await shown(page)).toEqual({ shake: '0%', flashing: 'true' });
  });
});

test.describe('no motion preference', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('AC-3: first launch keeps shake 100% and reduce-flashing off', async ({ page }) => {
    expect(await shown(page)).toEqual({ shake: '100%', flashing: 'false' });
  });
});
