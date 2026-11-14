import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl } from './helpers/player';

// mw-e39.40: the epilogue slideshow against the production build (Chromium, 1280x720). The debug
// console's `epilogue.preview <ending>` plays an ending's card and slides; E advances, Esc skips.
// #app[data-epilogue] (JSON: open, slide, preview, ended) is the readout.

interface Readout {
  open: boolean;
  slide: string | null;
  preview: boolean;
  ended: string | null;
}

const readout = async (page: Page): Promise<Readout> =>
  JSON.parse((await page.locator('#app').getAttribute('data-epilogue')) ?? 'null') as Readout;

test('AC-5: epilogue.preview plays the card and the slides; E advances and Esc skips', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await stubPointerLock(page);
  await page.goto('/?scene=wendmouth-harbour&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'wendmouth-harbour', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  expect(await readout(page)).toEqual({ open: false, slide: null, preview: false, ended: null });
  await takeControl(page);
  await page.keyboard.press('Backquote');
  await page.getByTestId('debug-console-input').focus();
  await page.keyboard.insertText('epilogue.preview vespers-rung');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');

  await expect
    .poll(() => readout(page))
    .toMatchObject({
      open: true,
      slide: 'ending-vespers-rung',
      preview: true,
    });
  await expect(page.getByTestId('epilogue-counter')).toContainText('Slide 1 of');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await readout(page)).slide).not.toBe('ending-vespers-rung');
  await page.keyboard.press('Escape');
  await expect.poll(() => readout(page)).toMatchObject({ open: false, ended: null });
  await expect(page.getByTestId('epilogue-slideshow')).toHaveCount(0);
});
