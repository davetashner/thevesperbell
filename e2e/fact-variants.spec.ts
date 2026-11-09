import { expect, test, type Page } from '@playwright/test';

// mw-e27.8: the variant room against the production build (Chromium). The room has a miller that is
// a villager once variants.miller.rescued is true (a crate of his things before it). Setting the fact
// from the debug console brings him in, but not while his spot is on the player's screen: the swap
// waits until the camera looks away (the debug camera turns the view), and then he is there.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Creatures {
  count: number;
  kinds: Record<string, number>;
}

async function creatures(page: Page): Promise<Creatures> {
  const json = await page.locator('#app').getAttribute('data-creatures');
  return JSON.parse(json ?? '{"count":0,"kinds":{}}') as Creatures;
}

async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

test('AC-1: a fact flip waits while the spot is on screen, then brings the miller in', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/?scene=variant-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'variant-room', { timeout: 10_000 });
  expect((await creatures(page)).kinds['npc-hollis']).toBeUndefined();

  await run(page, 'facts.set variants.miller.rescued true');
  await expect(app).toHaveAttribute('data-facts', /"variants\.miller\.rescued":true/);
  // The miller's spot is on screen, so he waits...
  await page.waitForTimeout(1_000);
  expect((await creatures(page)).kinds['npc-hollis']).toBeUndefined();
  // ...until the view moves on: the fly camera (F2) flies past his spot, which is then behind it.
  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'on');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2_500);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await creatures(page)).kinds['npc-hollis']).toBe(1);
  expect(problems).toEqual([]);
});
