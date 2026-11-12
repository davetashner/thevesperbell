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

// mw-e25.22 AC-1 (with mw-e25.1): from a new game in Briar Glen the player walks the woodside path at
// the lane's north end and the Briarwood loads at its town gate; walking back down the main trail
// returns to the lane's woodside path. The player teleports inside a scene to save the walk (one page
// evaluation each) and crosses by walking into the transition volume. Built for a ~1 fps CI runner:
// state polls with 30 s timeouts, no wall-clock assertions, and nothing aimed at a moving entity.

const W = { code: 'KeyW', key: 'w' };

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Faces `aim` (until the returned error is small) and walks forward `ticks` ticks into a gate. */
async function walkThrough(
  page: Page,
  aim: { x: number; z: number },
  ticks: number,
  scene: string,
) {
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

test('AC-1: the lane’s woodside path leads into the Briarwood and the town gate leads back', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-lane&class=knight&debug=1');
  await ready(page, 'briar-glen-lane');
  const app = page.locator('#app');
  await takeControl(page);

  // North end of the lane: past the college, walk the 6 m passage to its end.
  await runConsole(page, 'tp 0 0 38');
  await walkThrough(page, { x: 0, z: 100 }, 130, 'briarwood');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briarwood".*"spawn":"arrive-from-briar-glen-lane"/,
    { timeout: 30_000 },
  );
  const inside = await playerState(page);
  expect(inside.position.z).toBeGreaterThan(3);
  expect(inside.position.z).toBeLessThan(7);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // And back: face the town gate and walk down the trail to it.
  await takeControl(page);
  await walkThrough(page, { x: 0, z: -100 }, 80, 'briar-glen-lane');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-lane".*"spawn":"arrive-from-briarwood"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(40);
  expect(back.position.z).toBeLessThan(44);
  expect(problems).toEqual([]);
});
