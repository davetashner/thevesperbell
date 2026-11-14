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

// mw-e26.9: from the Deepworks breach room the player walks north through the breach door into the Knot's
// outer half (knot-outer), walks up the Outer Ring's first corridor, stands in the Ossuary hall (a teleport:
// the Scales gate and the vent are the integration test's) and in the Chapel nave, and walks back out of the
// breach door to the Deepworks. The player teleports inside a scene to save the walk and crosses scenes by
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

test('AC-1: the Deepworks breach leads into the Knot’s Outer Ring, the Ossuary and the Chapel stand, and the breach door leads back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=deepworks&class=knight&debug=1');
  await ready(page, 'deepworks');
  const app = page.locator('#app');
  await takeControl(page);

  // In the breach room, then north through the breach door.
  await runConsole(page, 'tp 100 -12 322');
  await walkThrough(page, { x: 100, z: 400 }, 200, 'knot-outer');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"knot-outer".*"spawn":"arrive-from-deepworks"/,
    { timeout: 60_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.z).toBeGreaterThan(4);
  expect(arrived.position.z).toBeLessThan(8);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // North across the landing into the Outer Ring's south corridor.
  await takeControl(page);
  await face(page, { x: 60, z: 100 });
  const start = await playerState(page);
  const walked = await holdKey(page, W, 120);
  expect(walked.position.z - start.position.z).toBeGreaterThan(3);

  // The Ossuary hall, then the Chapel nave.
  await runConsole(page, 'tp 60 0 96');
  await expect
    .poll(async () => (await playerState(page)).position.z, { timeout: 60_000 })
    .toBeGreaterThan(90);
  await runConsole(page, 'tp 60 0 200');
  await expect
    .poll(async () => (await playerState(page)).position.z, { timeout: 60_000 })
    .toBeGreaterThan(190);

  // And back: out through the breach door to the Deepworks.
  await runConsole(page, 'tp 60 0 8');
  await walkThrough(page, { x: 60, z: -100 }, 200, 'deepworks');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"deepworks".*"spawn":"arrive-from-knot-outer"/,
    { timeout: 60_000 },
  );
  const back = await playerState(page);
  expect(back.position.y).toBeLessThan(-11);
  expect(back.position.z).toBeGreaterThan(320);
  expect(back.position.z).toBeLessThan(328);
  expect(problems).toEqual([]);
});
