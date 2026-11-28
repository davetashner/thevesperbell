import { expect, test } from '@playwright/test';
import { holdKey, playerState } from './helpers/player';
import { collectProblems, W } from './helpers/slice';
import { POLL_HOLDS, boot, standAt } from './helpers/harbour';

// mw-e40.35: the hatch leg of the Wendmouth dock loop: the player is stood on the deck's north side,
// climbs down the hatch ladder into the hold and back out to the deck.

test('mw-e40.35: climb down the hatch ladder into the hold and back out', async ({ page }) => {
  test.setTimeout(600_000);
  const problems = collectProblems(page);
  await boot(page);

  // 5. The hatch: step in from the deck's north side pressing forward; the ladder on the hatch's
  // south edge catches the player, who comes down to the hold floor (y -1.5).
  await standAt(page, [35, 2.05, 132.2], { x: 35, z: 128 });
  await expect
    // 120 s: the descent takes many short holds, and a ~1 fps CI runner fit too few into 30 s
    // (it stopped at the same y on every retry: out of wall time, not stuck).
    .poll(async () => (await holdKey(page, W, 4, 1)).position.y, {
      timeout: 120_000,
      intervals: [100],
    })
    .toBeLessThan(-1.2);
  const hold = await playerState(page);
  expect(hold.position.x).toBeGreaterThan(31.5);
  expect(hold.position.x).toBeLessThan(38.5);
  expect(hold.position.z).toBeGreaterThan(108.5);
  expect(hold.position.z).toBeLessThan(143.5);
  // Still on the ladder: pulling back lets go at the bottom and puts the player on the hold floor.
  await expect
    .poll(async () => (await holdKey(page, { code: 'KeyS', key: 's' }, 6, 1)).grounded, POLL_HOLDS)
    .toBe(true);
  expect((await playerState(page)).position.y).toBeLessThan(-1.3);

  // ...and back out: at the ladder's foot, facing it, forward climbs to the deck.
  await standAt(page, [35, -1.5, 130.5], { x: 35, z: 128 });
  await expect
    .poll(async () => {
      const st = await holdKey(page, W, 12, 2);
      return st.position.y > 1.9 && st.grounded;
    }, POLL_HOLDS)
    .toBe(true);
  expect((await playerState(page)).position.z).toBeLessThan(129.6);

  expect(problems).toEqual([]);
});
