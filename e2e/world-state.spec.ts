import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e27.6: the world state console tools (`facts.*`, `deltas.list`, `state.*`) in the grey-box
// testbed, against the production build, which is a debug build: with ?debug=1 the console and the
// tools load. The panel (`state.panel on`) publishes its lines to #app[data-world-state].

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

test.use({ viewport: { width: 1280, height: 720 } });

test('the panel lists facts and level deltas; commands report errors without breaking the game', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 15_000 });
  await takeControl(page);

  const panel = page.getByTestId('world-state-panel');
  await expect(panel).toBeHidden();
  // The tools start once save storage has opened; the command exists from then on.
  await expect(async () => {
    await runConsole(page, 'state.panel on');
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(panel).toContainText('facts (');
  await expect(panel).toContainText('level deltas (');
  await expect(app).toHaveAttribute('data-world-state', /facts \(/);

  // An undeclared fact is an error line, not an exception; snapshot, restore and diff run.
  await runConsole(page, 'facts.set no.such.fact 1');
  await runConsole(page, 'state.snapshot e2e');
  await runConsole(page, 'state.restore e2e');
  await runConsole(page, 'state.diff e2e live');
  await runConsole(page, 'state.panel off');
  await expect(panel).toBeHidden();
  expect(problems).toEqual([]);
});

test('is safe on a scene that does not exist, and absent without the debug flag', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=does-not-exist&debug=1');
  await expect(page.locator('#app')).toContainText('does-not-exist');
  await expect(page.getByTestId('world-state-panel')).toBeHidden();
  await page.goto('/?scene=testbed');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  expect(await page.getByTestId('world-state-panel').count()).toBe(0);
  expect(problems.filter((p) => !/404|Failed to load resource/.test(p))).toEqual([]);
});
