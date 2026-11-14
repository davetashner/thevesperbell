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

// mw-e25.6 (with the Briarwood leg of mw-e25.25): from the Briarwood the player walks the spur trail to
// its moorings gate, arrives at Mooring's Watch, climbs the ivy up the tower's south face to the roof
// (the exterior route: walking into ivy attaches, every class), and walks back out through the spur
// gate to the Briarwood. The player teleports inside a scene to save the walk (one page evaluation
// each) and crosses scenes by walking into transition volumes. Built for a ~1 fps CI runner: state
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

test('AC-1: the Briarwood’s spur leads to Mooring’s Watch, the ivy climbs to the roof, and the spur gate leads back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briarwood&class=knight&debug=1');
  await ready(page, 'briarwood');
  const app = page.locator('#app');
  await takeControl(page);

  // The last stretch of the spur trail: walk east into the moorings gate in the Briarwood's east wall.
  await runConsole(page, 'tp 130 0 225');
  await walkThrough(page, { x: 200, z: 225 }, 330, 'moorings-watch');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"moorings-watch".*"spawn":"arrive-from-briarwood"/,
    { timeout: 30_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.x).toBeGreaterThan(4);
  expect(arrived.position.x).toBeLessThan(8);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // Down the spur approach a little, then on to the courtyard in front of the tower.
  await takeControl(page);
  await face(page, { x: 100, z: 45 });
  const start = await playerState(page);
  const walked = await holdKey(page, W, 90);
  expect(walked.position.x - start.position.x).toBeGreaterThan(3);
  await runConsole(page, 'tp 91 0 43');
  await face(page, { x: 91, z: 60 });

  // Up the ivy on the tower's south face: hold forward into it. It climbs, pulls up at the top and
  // walks onto the roof, 9 m up.
  let roof = await playerState(page);
  for (let go = 0; go < 4 && !(roof.grounded && roof.position.y > 8.5); go++) {
    roof = await holdKey(page, W, 360);
  }
  expect(roof.position.y).toBeGreaterThan(8.5);
  expect(roof.position.y).toBeLessThan(9.5);
  expect(roof.grounded).toBe(true);
  expect(roof.position.x).toBeGreaterThan(88);
  expect(roof.position.x).toBeLessThan(102);
  expect(roof.position.z).toBeGreaterThan(46);
  expect(roof.position.z).toBeLessThan(58);

  // And back: out through the spur gate to the Briarwood.
  await runConsole(page, 'tp 10 0 45');
  await walkThrough(page, { x: -100, z: 45 }, 150, 'briarwood');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briarwood".*"spawn":"arrive-from-moorings-watch"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.x).toBeGreaterThan(140);
  expect(back.position.x).toBeLessThan(146);
  expect(problems).toEqual([]);
});
