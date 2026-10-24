// mw-ju8.13: the Bridgeward College against the production build (Chromium). Both instructors can be
// talked to (the lesson tables prompt, then open the shop screen for their merchant on its Services tab),
// a lesson takes its price and teaches the technique (#app[data-learned]), and nobody offers sorcery.
// Built for a slow runner like e2e/sleeping-ox.spec.ts: each test starts near its subject with a teleport,
// keeps its action count low, asserts state and never wall-clock time.

import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

//: the Sleeping Ox against the production build (Chromium). The bar prompts "Trade / Rooms"
// and opens the shop for bridgeward-college (#app[data-shop]), whose Services tab sells a room for the night:
// booking it takes the crowns, closes the shop, shows "You sleep until morning." and publishes the
// night (#app[data-rest]: kind, hours, point, and the day and minute on waking). The game then writes
// a `rest` autosave (#app[data-autosave]). The scene is dev-only until area transitions (mw-e01.11):
// ?scene=bridgeward-college.
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

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

/** Opens the college with the debug console and waits for the player to stand in a running sim. */
async function openCollege(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=bridgeward-college&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'bridgeward-college', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

const TABLES = [
  {
    who: 'Sergeant Garrick',
    creature: 'npc-garrick',
    x: -4.5,
    merchant: 'bridgeward-fighting-hall',
    label: 'Fighting lessons',
  },
  {
    who: 'Master Rooke',
    creature: 'npc-rooke',
    x: 4.5,
    merchant: 'bridgeward-archery-butts',
    label: 'Archery lessons',
  },
] as const;

test('the college is loaded with a fighting and an archery instructor standing in it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openCollege(page);
  await expect
    .poll(() => data<{ kinds: Record<string, number>; drawn: number }>(page, 'creatures'))
    .toMatchObject({ kinds: { 'npc-garrick': 1, 'npc-rooke': 1 }, drawn: 2 });
  expect(problems).toEqual([]);
});

for (const table of TABLES) {
  test(`AC-2: ${table.who} can be talked to, and only lessons are on offer (no sorcery)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = collectProblems(page);
    await openCollege(page);
    await takeControl(page);

    await runConsole(page, `tp ${String(table.x)} 0 -1.25`);
    await turnTo(page, { x: table.x, z: 0 });
    await expect(page.getByTestId('interact-prompt')).toContainText(table.label);
    await page.keyboard.press('KeyE');
    await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
    expect(await data<{ merchant: string }>(page, 'shop')).toMatchObject({
      merchant: table.merchant,
    });
    await page.locator('[data-screen="shop"] [data-tab="services"]').dispatchEvent('click');
    const rows = page.locator('[data-screen="shop"] [aria-label^="Book "]');
    await expect(rows.first()).toBeVisible();
    const labels = await rows.evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) expect(label).not.toMatch(/spell|ember|firebolt|sorcer/i);
    expect(problems).toEqual([]);
  });
}

test('paying Sergeant Garrick for Shoulder Barge takes 100 crowns and teaches it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openCollege(page);
  await takeControl(page);

  await runConsole(page, 'tp -4.5 0 -1.25');
  await turnTo(page, { x: -4.5, z: 0 });
  await page.keyboard.press('KeyE');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
  const before = (await data<{ crowns: number }>(page, 'shop'))?.crowns ?? 0;
  await page.locator('[data-screen="shop"] [data-tab="services"]').dispatchEvent('click');
  await page.locator('[data-screen="shop"] [aria-label^="Book Shoulder Barge"]').first().focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => data<string[]>(page, 'learned')).toEqual(['technique.shoulder-barge']);
  await expect
    .poll(async () => (await data<{ crowns: number }>(page, 'shop'))?.crowns)
    .toBe(before - 100);
  expect(problems).toEqual([]);
});
