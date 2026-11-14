import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-kf4c: reading a placed text against the production build (Chromium, 1280x720). The Wendmouth
// harbour's clerk-desk spawn (tagged readable + note-cargo-manifest, a `read` affordance) opens the reader on
// Interact; Interact closes it again; reading a second time does not read it "first" again.
// #app[data-reader] (JSON: open, text, read) is the readout.

const MANIFEST = { x: -21, z: 58.5 };

async function openHarbour(page: Page): Promise<void> {
  await page.goto('/?scene=wendmouth-harbour&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'wendmouth-harbour', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

async function readout(
  page: Page,
): Promise<{ open: boolean; text: string | null; read: string[] }> {
  return JSON.parse((await page.locator('#app').getAttribute('data-reader')) ?? 'null') as {
    open: boolean;
    text: string | null;
    read: string[];
  };
}

test('AC-1: Interact on the manifest opens the reader; Interact closes it; a second read adds nothing', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await stubPointerLock(page);
  await openHarbour(page);
  expect(await readout(page)).toEqual({ open: false, text: null, read: [] });
  await takeControl(page);
  await page.keyboard.press('Backquote');
  await page.getByTestId('debug-console-input').focus();
  await page.keyboard.insertText(`tp ${String(MANIFEST.x)} 0 ${String(MANIFEST.z - 1.2)}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  await turnTo(page, MANIFEST);

  await expect(page.getByTestId('interact-prompt')).toContainText('Read');
  await page.keyboard.press('KeyE');
  await expect
    .poll(() => readout(page))
    .toEqual({
      open: true,
      text: 'note-cargo-manifest',
      read: ['note-cargo-manifest'],
    });
  await expect(page.getByTestId('reader-window')).toContainText('Cargo Manifest');
  await expect(page.getByTestId('reader-body')).toContainText('GLENSTONE SAMPLES');

  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await readout(page)).open).toBe(false);

  await takeControl(page);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await readout(page)).open).toBe(true);
  expect((await readout(page)).read).toEqual(['note-cargo-manifest']);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await readout(page)).open).toBe(false);
});
