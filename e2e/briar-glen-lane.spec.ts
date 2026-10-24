import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-ju8.5: the Briar Glen shop lane against the production build (Chromium), ?scene=briar-glen-lane.
// AC-2: the three keepers (Oswin Brand, Juniper Fenn, Hollis Pell) are loaded and drawn in their
// open-fronted shops, and Interact at each counter opens the shop screen for the right merchant under
// the keeper's name. The area exits (the bridge, Marsh's door) are markers until area transitions
// exist (mw-e01.11), so they are not exercised here.
//
// Built for a slow runner, like e2e/marsh-store.spec.ts (mw-ju8.18): CI draws about one frame a
// second and every Playwright round trip costs 2-3 s. Two small tests, each starting with a teleport
// (`runConsole`), no walking and nothing that waits on wall-clock timing.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

const SHOPS = [
  { merchant: 'brand-forge', name: 'Oswin Brand', z: 16 },
  { merchant: 'fenn-fletchery-simples', name: 'Juniper Fenn', z: 24 },
  { merchant: 'pell-bakery', name: 'Hollis Pell', z: 32 },
] as const;

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

/** Opens the lane with the debug console and waits for the player to stand in a running sim. */
async function openLane(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-lane&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'briar-glen-lane', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

test('AC-2: the three keepers and the Bridge Watch are loaded and drawn', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await openLane(page);

  await expect
    .poll(() => data<{ kinds: Record<string, number>; drawn: number }>(page, 'creatures'))
    .toMatchObject({
      kinds: {
        'npc-oswin': 1,
        'npc-juniper': 1,
        'npc-hollis': 1,
        // The game starts at 06:00 (dawn): the day watch is on shift, the night guard is not (mw-ju8.14).
        'npc-watchman-day': 2,
      },
      drawn: 5,
    });
  // Each stands east of her counter (x > 5.5), in her own shop.
  const ai = await data<{ agents: { at: number[] }[] }>(page, 'ai');
  const zs = (ai?.agents ?? []).map((agent) => agent.at).filter((at) => (at[0] ?? 0) > 5.5);
  expect(zs).toHaveLength(3);
  expect(problems).toEqual([]);
});

test('AC-2: each counter offers a trade and opens the shop of its keeper', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openLane(page);
  await takeControl(page);

  for (const { merchant, name, z } of SHOPS) {
    await runConsole(page, `tp 3.5 0 ${String(z)}`);
    await turnTo(page, { x: 5, z });
    await expect(page.getByTestId('interact-prompt')).toContainText('Trade');
    await page.keyboard.press('KeyE');
    await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);
    expect(await data<{ merchant: string; crowns: number }>(page, 'shop')).toMatchObject({
      merchant,
      crowns: 400,
    });
    await expect(page.locator('[data-screen="shop"] .vb-shop-name')).toHaveText(name);
    await page.keyboard.press('Escape');
    await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":false/);
  }
  expect(problems).toEqual([]);
});

test('mw-ju8.7: gear sells back at the Forge counter for fewer crowns than it cost', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openLane(page);
  await takeControl(page);
  await runConsole(page, 'tp 3.5 0 16');
  await turnTo(page, { x: 5, z: 16 });
  await page.keyboard.press('KeyE');
  await expect(page.locator('#app')).toHaveAttribute('data-shop', /"open":true/);

  // Buy a knife (the debug console has no `give`), then sell it: crowns rise by its buy-back price
  // and the knife leaves the pack. Reach the rows as a keyboard player does: focus, then Enter.
  const shop = page.locator('[data-screen="shop"]');
  await shop.locator('[aria-label^="Buy Utility knife"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('shop-status')).toHaveText(
    /^Bought Utility knife for \d+ crowns\.$/,
  );
  const bought = await data<{ crowns: number; pack: { item: string }[] }>(page, 'shop');
  expect(bought?.pack).toContainEqual({ item: 'utility-knife', count: 1 });

  await shop.locator('[data-tab="sell"]').click();
  await shop.locator('[aria-label^="Sell Utility knife"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('shop-status')).toHaveText(/^Sold Utility knife for \d+ crowns\.$/);
  const sold = await data<{ crowns: number; pack: { item: string }[] }>(page, 'shop');
  expect(sold?.crowns).toBeGreaterThan(bought?.crowns ?? Number.POSITIVE_INFINITY);
  expect(sold?.crowns).toBeLessThan(400);
  expect(sold?.pack).toEqual([]);
  expect(problems).toEqual([]);
});
