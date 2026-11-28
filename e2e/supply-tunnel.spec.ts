import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';
import { collectProblems } from './helpers/slice';

// mw-e25.9: the far end of Mooring's Watch's supply tunnel leads into the Deepworks' tunnel stub, and
// the stub's end leads back. Only the crossings: the player is teleported past the collapse (its
// routes and the fact it writes are tests/integration/supply-tunnel.test.ts) and walks a few metres
// into each transition.

const W = { code: 'KeyW', key: 'w' };

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

async function walkThrough(
  page: Page,
  aim: { x: number; z: number },
  ticks: number,
  scene: string,
): Promise<void> {
  await expect
    .poll(async () => Math.abs((await turnTo(page, aim)).error), { timeout: 30_000 })
    .toBeLessThan(0.1);
  await holdKey(page, W, ticks).catch((error: unknown) => {
    // The scene change may reload the page under the evaluation: expected.
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

test('the supply tunnel leads from Mooring’s Watch into the Deepworks and back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=moorings-watch&class=knight&debug=1');
  await ready(page, 'moorings-watch');
  const app = page.locator('#app');
  await takeControl(page);

  // Past the collapse, near the tunnel's end: walk north into the gate.
  await runConsole(page, 'tp 78 0 90');
  await walkThrough(page, { x: 78, z: 100 }, 120, 'deepworks');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"deepworks".*"spawn":"arrive-from-moorings-watch"/,
    { timeout: 30_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.x).toBeGreaterThan(28);
  expect(arrived.position.x).toBeLessThan(32);
  await takeControl(page);

  // And back west into the stub's end.
  await walkThrough(page, { x: 10, z: 155 }, 120, 'moorings-watch');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"moorings-watch".*"spawn":"arrive-from-deepworks"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(89);
  expect(back.position.z).toBeLessThan(92);
  expect(problems).toEqual([]);
});
