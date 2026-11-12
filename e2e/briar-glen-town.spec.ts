import { readFileSync } from 'node:fs';
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

// mw-e24.2 AC-3: the Briar Glen town tour. From a new game in the shop lane the player walks the
// woodside pocket's green-gate into Market Green, visits every landmark of the green (teleporting
// inside the scene to save the walk; one page evaluation each), reaches the two planned road stubs
// (the mine road and the priory road), walks back out through the lane gate, and takes the woodside
// path into the Briarwood. Scenes are crossed only by walking into transition volumes. Built for a
// ~1 fps CI runner: state polls with 30 s timeouts, no wall-clock assertions, and nothing aimed at a
// moving entity.

const W = { code: 'KeyW', key: 'w' };

interface Spawn {
  id: string;
  at: [number, number, number];
  tags?: string[];
}
const green = JSON.parse(readFileSync('src/content/data/scene/briar-glen-green.json', 'utf8')) as {
  spawns: Spawn[];
};
const spawn = (id: string): Spawn => {
  const found = green.spawns.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no briar-glen-green spawn ${id}`);
  return found;
};

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

/** Teleports to a landmark and waits until the player stands on it. */
async function visit(page: Page, id: string): Promise<void> {
  const [x, y, z] = spawn(id).at;
  await runConsole(page, `tp ${String(x)} ${String(y)} ${String(z)}`);
  await expect
    .poll(
      async () => {
        const state = await playerState(page);
        return state.grounded
          ? Math.hypot(state.position.x - x, state.position.z - z) < 2.5 &&
              Math.abs(state.position.y - y) < 1.5
          : false;
      },
      { timeout: 30_000, message: `the player stands at ${id}` },
    )
    .toBe(true);
}

const LANDMARKS = [
  'market-green',
  'notice-board',
  'glen-well',
  'lamplit-stacks',
  'watch-house',
  'schoolhouse',
  'cemetery',
  'rise-foot',
  'vane-house',
  'exit-mine-road',
  'exit-priory-road',
];

test('AC-3: the town tour visits every landmark and exits to Briarwood, the mine road and the priory road', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=briar-glen-lane&class=knight&debug=1');
  await ready(page, 'briar-glen-lane');
  const app = page.locator('#app');
  await takeControl(page);

  // Lane to Market Green: the green-gate stub off the woodside pocket.
  await runConsole(page, 'tp 0 0 42');
  await walkThrough(page, { x: 20, z: 43 }, 100, 'briar-glen-green');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-green".*"spawn":"arrive-from-briar-glen-lane"/,
    { timeout: 30_000 },
  );
  const inside = await playerState(page);
  expect(inside.position.x).toBeLessThan(-80);
  await takeControl(page);

  // Every landmark, the two road stubs included.
  for (const id of LANDMARKS) await visit(page, id);
  expect(spawn('exit-mine-road').tags).toContain('planned:mw-e25.23');
  expect(spawn('exit-priory-road').tags).toContain('planned:mw-e25.25');
  await expect(app).toHaveAttribute('data-scene', 'briar-glen-green');

  // Back out of the lane gate.
  await runConsole(page, 'tp -86 0 20');
  await walkThrough(page, { x: -120, z: 20 }, 100, 'briar-glen-lane');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briar-glen-lane".*"spawn":"arrive-from-briar-glen-green"/,
    { timeout: 30_000 },
  );
  const back = await playerState(page);
  expect(back.position.x).toBeGreaterThan(0);
  expect(back.position.z).toBeGreaterThan(40);

  // And on to the Briarwood by the woodside path.
  await takeControl(page);
  await runConsole(page, 'tp 0 0 38');
  await walkThrough(page, { x: 0, z: 100 }, 130, 'briarwood');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"briarwood".*"spawn":"arrive-from-briar-glen-lane"/,
    { timeout: 30_000 },
  );
  expect(problems).toEqual([]);
});
