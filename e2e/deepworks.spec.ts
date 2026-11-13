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

// mw-e26.2: from Market Green the player walks out of the south gate onto the mine road, arrives in the
// Deepworks, walks up the road to the forecourt, stands in the cutting hall and the silver galleries
// (teleports: the gate wall and the stairs are the integration test's), and walks back out of the road
// gate to the green. The player teleports inside a scene to save the walk (one page evaluation each) and
// crosses scenes by walking into transition volumes. Built for a ~1 fps CI runner: state
// polls with 30 s timeouts, ticks (never wall time) pace every hold, turnTo errors are checked, and
// nothing is aimed at a moving entity.

const W = { code: 'KeyW', key: 'w' };

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/** Faces `aim` until the turn error is small. */
async function face(page: Page, aim: { x: number; z: number }): Promise<void> {
  await expect
    .poll(async () => Math.abs((await turnTo(page, aim)).error), { timeout: 30_000 })
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
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

test('AC-1: Market Green’s mine road leads into the Deepworks, the forecourt and halls stand, and the road gate leads back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-green&class=knight&debug=1');
  await ready(page, 'briar-glen-green');
  const app = page.locator('#app');
  await takeControl(page);

  // Out of the south wall's doorway onto the mine road.
  await runConsole(page, 'tp 60 0 8');
  await walkThrough(page, { x: 60, z: -100 }, 150, 'deepworks');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"deepworks".*"spawn":"arrive-from-briar-glen-green"/,
    { timeout: 30_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.z).toBeGreaterThan(4);
  expect(arrived.position.z).toBeLessThan(8);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // Up the mine road a little.
  await takeControl(page);
  await face(page, { x: 100, z: 100 });
  const start = await playerState(page);
  const walked = await holdKey(page, W, 90);
  expect(walked.position.z - start.position.z).toBeGreaterThan(3);

  // The cutting hall: walk north through the pillars from its south doorway.
  await runConsole(page, 'tp 92 0 194');
  await face(page, { x: 92, z: 240 });
  const hall = await holdKey(page, W, 240);
  expect(hall.position.z).toBeGreaterThan(205);

  // A level down: the silver galleries' landing under the cutting hall.
  await runConsole(page, 'tp 100 -6 270');
  await expect
    .poll(async () => (await playerState(page)).position.y, { timeout: 30_000 })
    .toBeLessThan(-5);

  // And back: out through the road gate to Market Green.
  await runConsole(page, 'tp 100 0 8');
  await walkThrough(page, { x: 100, z: -100 }, 150, 'briar-glen-green');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-green".*"spawn":"arrive-from-deepworks"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(5);
  expect(back.position.z).toBeLessThan(9);
  expect(problems).toEqual([]);
});
