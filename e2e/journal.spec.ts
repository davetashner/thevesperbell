import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl } from './helpers/player';

// mw-e23.6: the journal screen, against the production build (Chromium). J opens it in play and the
// pause menu's Journal opens it over the menu; Esc closes it. It never opens by itself: a debug
// scene boot stays clear until the player asks. #app[data-journal] is open or closed.

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

test('mw-e23.6: the journal stays closed on a scene boot, J opens it, Esc closes it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-journal', 'closed');
  await expect(page.locator('[data-screen="journal"]')).toHaveCount(0);
  await takeControl(page);

  await page.keyboard.press('KeyJ');
  await expect(app).toHaveAttribute('data-journal', 'open');
  const tabs = page.locator('[data-screen="journal"] [role="tab"]');
  await expect(tabs).toHaveText(['Active', 'Completed / Failed', 'Rumours', 'Notes']);
  await expect(page.locator('[data-screen="journal"] [data-panel="active"]')).toBeVisible();

  // Q / E switch sections; J closes it again.
  await page.keyboard.press('KeyE');
  await expect(
    page.locator('[data-screen="journal"] [role="tab"][aria-selected="true"]'),
  ).toHaveText('Completed / Failed');
  await page.keyboard.press('KeyJ');
  await expect(app).toHaveAttribute('data-journal', 'closed');
  await expect(page.locator('[data-screen="journal"]')).toHaveCount(0);

  // Opening the journal released the pointer, as any screen does; the player takes it back.
  await takeControl(page);
  await page.keyboard.press('KeyJ');
  await expect(app).toHaveAttribute('data-journal', 'open');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-journal', 'closed');
  expect(problems).toEqual([]);
});

test('mw-e23.6: the pause menu opens the journal over itself, and Esc returns to the menu', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await takeControl(page);

  await page.keyboard.press('KeyP');
  await expect(app).toHaveAttribute('data-pause', 'open');
  await page.locator('[data-screen="pause"] [data-action="journal"]').click();
  await expect(app).toHaveAttribute('data-journal', 'open');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-journal', 'closed');
  await expect(app).toHaveAttribute('data-pause', 'open');
  expect(problems).toEqual([]);
});
