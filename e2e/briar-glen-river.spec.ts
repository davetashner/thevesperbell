import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';
import { collectProblems, W } from './helpers/slice';

// mw-e25.24 (with mw-e25.11 and mw-e25.12): the river below Briar Glen in a real browser. From the
// walled riverbank path under the Miners' Bridge the player walks down into the river scene (the
// quay loads), follows the lit towpath east to the Millweir, reaches the far bank and walks on into
// the Briarwood. Keys only for the transitions; teleports only to skip the long towpath. Built for a
// ~1 fps CI runner (up to 5 sim ticks a frame): every wait polls published state with a 120 s
// timeout, since one poll can need minutes of wall time there; the test's own budget is 600 s.
const POLL = { timeout: 120_000 };

async function scene(page: Page): Promise<string | null> {
  return page.locator('#app').getAttribute('data-scene');
}

/** Holds forward; crossing a gate swaps the scene in place, which ends the hold. */
async function walkThrough(page: Page, ticks: number): Promise<void> {
  try {
    await holdKey(page, W, ticks, 2);
  } catch {
    // The page navigated away: the transition happened.
  }
}

async function standAt(
  page: Page,
  at: [number, number, number],
  look: { x: number; z: number },
): Promise<void> {
  await runConsole(page, `tp ${at.join(' ')}`);
  await expect.poll(async () => Math.abs((await turnTo(page, look)).error), POLL).toBeLessThan(0.1);
}

test('mw-e25.24: from under the bridge down the riverbank to the quay, the Millweir and the Briarwood far bank', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=under-the-bridge&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'under-the-bridge', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await takeControl(page);

  // 1. The path through the gap in the low river wall runs down to the river scene.
  await standAt(page, [-2.5, 0, 5], { x: -2.5, z: 9 });
  await expect
    .poll(async () => {
      await walkThrough(page, 120);
      return scene(page);
    }, POLL)
    .toBe('briar-glen-river');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await takeControl(page);
  const arrival = (await playerState(page)).position;
  expect(arrival.x).toBeLessThan(8);
  expect(arrival.z).toBeLessThan(0);

  // 2. Walk the quay path east, downriver, on the keys: face east, then one long hold. The sim is
  //    deterministic, so a single hold lands in the same place on any machine; short holds inside a
  //    30 s poll ran out of wall time on slow CI runners (~1 fps) after two or three holds.
  const here = (await playerState(page)).position;
  await turnTo(page, { x: here.x + 50, z: here.z });
  expect((await holdKey(page, W, 240, 4)).position.x).toBeGreaterThan(14);

  // 3. The quay: Patient Ann lies against it and the basin is water.
  await standAt(page, [63.5, 0.3, 2.5], { x: 70, z: 2.5 });
  expect((await playerState(page)).position.y).toBeGreaterThan(0.1);

  // 4. The far bank is the Briarwood far bank: reaching it opens the shortcut (a fact), and the
  //    gate in its south wall leads into the Briarwood.
  await standAt(page, [137, 0, 32], { x: 137, z: 45 });
  await expect(app).toHaveAttribute('data-facts', /"world\.millweir\.sluice-walk-open":true/, POLL);
  await expect
    .poll(async () => {
      await walkThrough(page, 120);
      return scene(page);
    }, POLL)
    .toBe('briarwood');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await takeControl(page);
  expect((await playerState(page)).position.x).toBeGreaterThan(130);

  expect(problems).toEqual([]);
});
