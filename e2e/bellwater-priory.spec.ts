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

// mw-e26.5 (with the priory legs of mw-e25.25): from the Briarwood the player walks the priory road to
// its gate in the north wall, arrives at Bellwater Priory, walks up the road and through the precinct gate
// into the nave, and walks back out through the road gate to the Briarwood. The player teleports inside a scene to save the walk (one page evaluation
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

test('AC-1: the Briarwood’s priory road leads to Bellwater Priory, the nave opens past the gate, and the road gate leads back', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briarwood&class=knight&debug=1');
  await ready(page, 'briarwood');
  const app = page.locator('#app');
  await takeControl(page);

  // The last stretch of the priory road: walk north into the priory road gate in the Briarwood's north wall.
  await runConsole(page, 'tp 0 0 232');
  await walkThrough(page, { x: 0, z: 300 }, 330, 'bellwater-priory');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"bellwater-priory".*"spawn":"arrive-from-briarwood"/,
    { timeout: 30_000 },
  );
  const arrived = await playerState(page);
  expect(arrived.position.z).toBeGreaterThan(4);
  expect(arrived.position.z).toBeLessThan(8);
  await expect(app).toHaveAttribute('data-autosave', /"kind":"area-transition"/, {
    timeout: 60_000,
  });

  // Up the road a little, then on through the precinct gate to the nave's open front.
  await takeControl(page);
  await face(page, { x: 60, z: 100 });
  const start = await playerState(page);
  const walked = await holdKey(page, W, 90);
  expect(walked.position.z - start.position.z).toBeGreaterThan(3);
  await runConsole(page, 'tp 60 0 22');
  await face(page, { x: 60, z: 60 });
  const nave = await holdKey(page, W, 240);
  expect(nave.position.z).toBeGreaterThan(30);
  expect(nave.position.x).toBeGreaterThan(40);
  expect(nave.position.x).toBeLessThan(80);

  // And back: out through the road gate to the Briarwood.
  await runConsole(page, 'tp 60 0 8');
  await walkThrough(page, { x: 60, z: -100 }, 150, 'briarwood');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briarwood".*"spawn":"arrive-from-bellwater-priory"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(240);
  expect(back.position.z).toBeLessThan(247);
  expect(problems).toEqual([]);
});
