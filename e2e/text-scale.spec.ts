// UI text scaling (mw-e31.4) in a real browser: at 200% every settings tab, the inventory and the
// container window fit without clipped text at 1280×720 and at phone width, and the dyslexia-friendly
// font switches the font family live, with no reload.
import { expect, test, type Page } from '@playwright/test';
import { clippedText, openScreen, openUiPage } from './helpers/ui';

const SIZES = [
  { name: '1280×720', width: 1280, height: 720 },
  { name: '390×844', width: 390, height: 844 },
] as const;

/** Panels whose content is wider than the panel (a sideways scrollbar), which clippedText allows. */
const sideways = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.vb-panel, .vb-inventory-grid')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className),
  );

const fontOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('AC-1: at 200% every settings tab fits with no clipped text', async ({ page }) => {
      await openUiPage(page, '/testbed/ui.html?scale=2');
      await openScreen(page, 'options');
      const tabs = page.locator('[data-screen="options"] [role="tab"]');
      const count = await tabs.count();
      expect(count).toBeGreaterThan(4);
      for (let i = 0; i < count; i += 1) {
        await tabs.nth(i).click();
        // Only the chosen tab's panel shows (a hidden panel must not stay displayed).
        await expect(page.locator('[data-screen="options"] [role="tabpanel"]:visible')).toHaveCount(
          1,
        );
        expect({ tab: await tabs.nth(i).textContent(), clipped: await clippedText(page) }).toEqual({
          tab: await tabs.nth(i).textContent(),
          clipped: [],
        });
        expect(await sideways(page)).toEqual([]);
      }
    });

    for (const id of ['inventory', 'container']) {
      test(`AC-1: at 200% the ${id} screen has no clipped text`, async ({ page }) => {
        await openUiPage(page, '/testbed/ui.html?scale=2');
        await openScreen(page, id);
        expect(await clippedText(page)).toEqual([]);
        expect(await sideways(page)).toEqual([]);
      });
    }
  });
}

test('AC-3: toggling the dyslexia-friendly font changes the menu font without a reload', async ({
  page,
}) => {
  await openUiPage(page);
  await openScreen(page, 'options');
  await page.locator('[data-screen="options"] [role="tab"]', { hasText: 'Accessibility' }).click();
  const before = await fontOf(page, '[data-screen="options"] .vb-panel');
  await page.evaluate(() => {
    (window as unknown as { __marker: number }).__marker = 1;
  });
  await page.locator('[data-setting="accessibility.dyslexiaFont"]').click();
  const after = await fontOf(page, '[data-screen="options"] .vb-panel');
  expect(after).not.toBe(before);
  expect(after).toContain('OpenDyslexic');
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
});

test('the text size slider scales the menu live, and reads out as a percentage', async ({
  page,
}) => {
  await openUiPage(page);
  await openScreen(page, 'options');
  await page.locator('[data-screen="options"] [role="tab"]', { hasText: 'Accessibility' }).click();
  const slider = page.locator('[data-setting="accessibility.textScale"]');
  await expect(slider).toHaveAttribute('aria-valuetext', '100%');
  const size = () =>
    fontOf(page, '[data-screen="options"] h1').then(() =>
      page
        .locator('[data-screen="options"] h1')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
  const before = await size();
  await slider.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '200%');
  expect(await size()).toBeCloseTo(before * 2, 0);
});
