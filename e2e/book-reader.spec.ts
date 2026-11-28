import { expect, test } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e07.9 AC-5: the book reader on the greybox testbed, against the production build. The test gives
// the player a damaged story book (Abbot's letters: page 2 is lost), opens the pack with I, opens the
// book with Enter on its card and the Open action, sees the torn page, closes it with Esc, and the pack
// with I, using only the keyboard; no console error or warning appears. #app[data-book-reader]
// (open/closed) is the readout.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

test('AC-5: a fixture book opens in the reader and closes with the keyboard, with no console errors', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  await runConsole(page, 'item.give book-abbots-letters');
  await expect(app).toHaveAttribute('data-book-reader', 'closed');

  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'open');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-book-reader', 'open');
  const reader = page.getByTestId('book-reader');
  await expect(reader).toContainText('Abbot');
  await expect(page.getByTestId('book-page-right')).toHaveText('Pages missing');
  await expect(page.getByTestId('book-page-left')).not.toBeEmpty();

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-book-reader', 'closed');
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'closed');
  expect(problems).toEqual([]);
});
