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

// mw-e25.23 AC-1: from the town end of the Miners' Bridge the player walks off the west side past the
// Bridge Watch post, down the Miners' Stair and along the old miners' track into the Deepworks forecourt,
// and back up the stair. Teleports only to the lane's town end; the crossing is walked.

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
    // The scene change reloads the page under the evaluation: expected.
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

test('AC-1: the Miners’ Stair leads from the bridge’s town end to the mine gate and back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-lane&class=knight&debug=1');
  await ready(page, 'briar-glen-lane');
  const app = page.locator('#app');
  await takeControl(page);

  // Just inside the bridge end, walk west through the gap and down the stair.
  await runConsole(page, 'tp -3 0 5');
  await walkThrough(page, { x: -40, z: 5 }, 400, 'deepworks');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"deepworks".*"spawn":"arrive-from-briar-glen-lane"/,
    { timeout: 30_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.x).toBeGreaterThan(33);
  expect(arrived.position.x).toBeLessThan(40);
  expect(arrived.position.z).toBeGreaterThan(60);
  expect(arrived.position.z).toBeLessThan(64);
  await takeControl(page);

  // And back up the track's end to the stair.
  await walkThrough(page, { x: 0, z: 62 }, 200, 'briar-glen-lane');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-lane".*"spawn":"arrive-from-deepworks"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.x).toBeLessThan(-14);
  expect(back.position.y).toBeLessThan(-1);
  expect(problems).toEqual([]);
});
