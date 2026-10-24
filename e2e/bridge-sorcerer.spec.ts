// mw-ju8.14: the sorcery teacher under the Miners' Bridge against the production build (Chromium).
// AC-1: the game starts at 06:00 (dawn), so the bank is empty and his table does not answer; setting the
// clock to 22:00 (`time set`, a replayable debug command) brings him in and the table prompts. AC-2: a
// lesson takes 200 crowns and teaches Ember (#app[data-learned]). The path from the lane's riverbank
// gap leads down to the bank. AC-3 (a first-time player finds him without a guide) is manual.
// Built for a slow runner like e2e/bridgeward-college.spec.ts: teleports, few actions, state asserted,
// never wall-clock time.

import { expect, test, type Page } from '@playwright/test';
import { playerState, runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

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

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

/** Opens the bank under the bridge (the game starts at 06:00, dawn) with the debug console. */
async function openBank(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=under-the-bridge&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'under-the-bridge', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

const SCREENSHOT = process.env['QUILLON_SHOT'];

test('AC-1: by day the bank is empty and the table is silent; at night Idris Quillon is there', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openBank(page);
  await takeControl(page);
  expect(await data<{ kinds: Record<string, number> }>(page, 'creatures')).toMatchObject({
    kinds: {},
  });
  await runConsole(page, 'tp 0 0 -1.25');
  await turnTo(page, { x: 0, z: 0 });
  await expect(page.getByTestId('interact-prompt')).not.toContainText('Sorcery lessons');

  await runConsole(page, 'time set 1 22:00');
  await expect(page.locator('#app')).toHaveAttribute('data-facts', /"time\.phase":"night"/);
  await expect
    .poll(() => data<{ kinds: Record<string, number> }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-quillon': 1 } });
  await turnTo(page, { x: 0, z: 0 });
  await expect(page.getByTestId('interact-prompt')).toContainText('Sorcery lessons');
  if (SCREENSHOT !== undefined) await page.screenshot({ path: SCREENSHOT });

  await runConsole(page, 'time set 2 06:00');
  await expect
    .poll(() => data<{ kinds: Record<string, number> }>(page, 'creatures'))
    .toMatchObject({ kinds: {} });
  expect(problems).toEqual([]);
});

test('AC-2: at night, paying Idris Quillon for Ember takes 200 crowns and teaches it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openBank(page);
  await takeControl(page);
  await runConsole(page, 'time set 1 22:00');
  await expect
    .poll(() => data<{ kinds: Record<string, number> }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-quillon': 1 } });
  await runConsole(page, 'tp 0 0 -1.25');
  await turnTo(page, { x: 0, z: 0 });
  await page.keyboard.press('KeyE');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
  expect(await data<{ merchant: string }>(page, 'shop')).toMatchObject({
    merchant: 'bridge-sorcerer',
  });
  const before = (await data<{ crowns: number }>(page, 'shop'))?.crowns ?? 0;
  await page.locator('[data-screen="shop"] [data-tab="services"]').dispatchEvent('click');
  await page.locator('[data-screen="shop"] [aria-label^="Learn Ember"]').first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Learn', exact: true }).dispatchEvent('click');
  await expect.poll(() => data<string[]>(page, 'learned')).toEqual(['spell.ember']);
  await expect
    .poll(async () => (await data<{ crowns: number }>(page, 'shop'))?.crowns)
    .toBe(before - 200);
  expect(problems).toEqual([]);
});

test('the lane’s riverbank path leads down to the bank under the bridge', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-lane&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'briar-glen-lane', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await runConsole(page, 'tp 11.4 0 7.25').catch((error: unknown) => {
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(/scene=under-the-bridge(&|$)/, { timeout: 90_000 });
  await expect(app).toHaveAttribute('data-scene', 'under-the-bridge', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  expect((await playerState(page)).position.z).toBeLessThan(-4);
  expect(problems).toEqual([]);
});
