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

// mw-e26.10: from the landing beyond the Chapel the player walks north through the horns door into the Knot's
// inner half (knot-inner), walks up the vestibule into Horn's Hall, stands in the Fold and the Cradle (a
// teleport: the routes between them are the integration test's) and walks back out of the horns door to the
// Chapel landing. The player teleports inside a scene to save the walk and crosses scenes by
// walking into transition volumes. Built for a ~1 fps CI runner: state polls with 60 s timeouts, ticks
// (never wall time) pace every hold, turnTo errors are checked, and nothing is aimed at a moving entity.

const W = { code: 'KeyW', key: 'w' };

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Faces `aim` until the turn error is small. */
async function face(page: Page, aim: { x: number; z: number }): Promise<void> {
  await expect
    .poll(async () => Math.abs((await turnTo(page, aim)).error), { timeout: 60_000 })
    .toBeLessThan(0.1);
}

/** Faces `aim` and walks forward `ticks` ticks into a gate; waits for the new scene to be playable. */
async function walkThrough(
  page: Page,
  aim: { x: number; z: number },
  ticks: number,
  scene: string,
): Promise<void> {
  await face(page, aim);
  await holdKey(page, W, ticks).catch((error: unknown) => {
    // The scene change reloads the page under the evaluation: expected.
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 120_000 });
  await ready(page, scene);
}

test('AC-1: the Chapel landing leads into Horn’s Hall, the Fold, the Cradle and the Shaft’s foot stand, and the horns door leads back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=knot-outer&class=knight&debug=1');
  await ready(page, 'knot-outer');
  const app = page.locator('#app');
  await takeControl(page);

  // On the landing, then north through the horns door.
  await runConsole(page, 'tp 60 0 250');
  await walkThrough(page, { x: 60, z: 400 }, 200, 'knot-inner');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"knot-inner".*"spawn":"arrive-from-knot-outer"/,
    { timeout: 60_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.z).toBeGreaterThan(4);
  expect(arrived.position.z).toBeLessThan(8);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // North up the vestibule into Horn's Hall.
  await takeControl(page);
  await face(page, { x: 90, z: 100 });
  const start = await playerState(page);
  const walked = await holdKey(page, W, 120);
  expect(walked.position.z - start.position.z).toBeGreaterThan(3);

  // The Fold, the Cradle and the Shaft's foot.
  await runConsole(page, 'tp 35 0 45');
  await expect
    .poll(async () => (await playerState(page)).position.x, { timeout: 60_000 })
    .toBeLessThan(50);
  await runConsole(page, 'tp 90 0 120');
  await expect
    .poll(async () => (await playerState(page)).position.z, { timeout: 60_000 })
    .toBeGreaterThan(110);
  await runConsole(page, 'tp 90 0 160');
  await expect
    .poll(async () => (await playerState(page)).position.z, { timeout: 60_000 })
    .toBeGreaterThan(150);

  // And back: out through the horns door to the Chapel landing.
  await runConsole(page, 'tp 90 0 8');
  await walkThrough(page, { x: 90, z: -100 }, 200, 'knot-outer');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"knot-outer".*"spawn":"arrive-from-knot-inner"/,
    { timeout: 60_000 },
  );
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(250);
  expect(back.position.z).toBeLessThan(257);
  expect(problems).toEqual([]);
});
