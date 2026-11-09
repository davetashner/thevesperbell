import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-ju8.6: the Sleeping Ox against the production build (Chromium). The bar prompts "Trade / Rooms"
// and opens the shop for sleeping-ox (#app[data-shop]), whose Services tab sells a room for the night:
// booking it takes the crowns, closes the shop, shows "You sleep until morning." and publishes the
// night (#app[data-rest]: kind, hours, point, and the day and minute on waking). The game then writes
// a `rest` autosave (#app[data-autosave]). The scene is dev-only until area transitions (mw-e01.11):
// ?scene=sleeping-ox.
//
// Built for a slow runner like e2e/marsh-store.spec.ts (mw-ju8.18): CI draws about one frame a second
// and every Playwright round trip costs 2-3 s. Each test proves one thing, starts near it with a
// teleport (`runConsole`), keeps its action count low, asserts state and never wall-clock time.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/**
 * Records every toast the page shows from now on (window.__toasts, in order). A toast removes itself
 * after a wall-clock timer (6 s for the night's), and a runner drawing a frame a second spends longer
 * than that on the awaits between the booking and a check of the toast itself, so the spec reads the
 * record instead of racing the timer (mw-vvo).
 */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __toasts: string[] }).__toasts = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('vb-toast')) {
            seen.push(node.textContent);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

/** Opens the inn with the debug console and waits for the player to stand in a running sim. */
async function openInn(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=sleeping-ox&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'sleeping-ox', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

test('the inn is loaded and Dot stands behind the bar', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openInn(page);
  await expect
    .poll(() => data<{ kinds: Record<string, number>; drawn: number }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-dot': 1 }, drawn: 1 });
  expect(problems).toEqual([]);
});

test('the bar offers Trade / Rooms and opens the Sleeping Ox shop with its room on the Services tab', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await openInn(page);
  await takeControl(page);

  await runConsole(page, 'tp -2 0 -0.25');
  await turnTo(page, { x: -2, z: 1 });
  await expect(page.getByTestId('interact-prompt')).toContainText('Trade / Rooms');
  await page.keyboard.press('KeyE');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
  expect(await data<{ merchant: string; crowns: number }>(page, 'shop')).toMatchObject({
    merchant: 'sleeping-ox',
    crowns: 400,
  });
  // Frame-paced click checks never settle at a frame a second: dispatch the click directly.
  await page.locator('[data-screen="shop"] [data-tab="services"]').dispatchEvent('click');
  await expect(
    page.locator('[data-screen="shop"] [aria-label="Book Room for the night, 12 crowns"]'),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test('booking the room takes the crowns, sleeps until morning, toasts and autosaves', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openInn(page);
  await takeControl(page);

  await runConsole(page, 'tp -2 0 -0.25');
  await turnTo(page, { x: -2, z: 1 });
  await recordToasts(page);
  await page.keyboard.press('KeyE');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
  await page.locator('[data-screen="shop"] [data-tab="services"]').dispatchEvent('click');
  // Reach the room as a keyboard player does: focus the row and press Enter (12 of 400 crowns is
  // under a quarter, so no confirmation).
  await page
    .locator('[data-screen="shop"] [aria-label^="Book Room for the night"]')
    .first()
    .focus();
  await page.keyboard.press('Enter');

  // The shop closes with 12 fewer crowns, and the night is published: a new world wakes on day 2
  // at 06:00 (360 minutes).
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":false/);
  expect(await data<{ crowns: number }>(page, 'shop')).toMatchObject({ crowns: 388 });
  await expect(page.locator('#app')).toHaveAttribute(
    'data-rest',
    /"kind":"inn".*"point":"sleeping-ox".*"day":2,"minute":360/,
  );
  // The toast, from the record: it is gone after 6 s of wall-clock time, which a slow runner can
  // spend before this line (mw-vvo).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts))
    .toContain('You sleep until morning.');
  // One `rest` autosave, written once it is safe.
  await expect
    .poll(() => data<{ type: string; kind: string }>(page, 'autosave'), { timeout: 30_000 })
    .toMatchObject({ type: 'saved', kind: 'rest' });
  expect(problems).toEqual([]);
});

test('the rented room is a named place east of the common room, with the bed in it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openInn(page);
  await takeControl(page);

  await runConsole(page, 'tp bed');
  await expect
    .poll(async () => (await data<{ position: { x: number } }>(page, 'player'))?.position.x)
    .toBeGreaterThan(5);
  expect(problems).toEqual([]);
});
