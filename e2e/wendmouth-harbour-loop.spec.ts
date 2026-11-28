import { expect, test } from '@playwright/test';
import { holdKey, playerState } from './helpers/player';
import { collectProblems, W } from './helpers/slice';
import {
  POLL,
  POLL_HOLDS,
  boot,
  choose,
  closeTalk,
  factIs,
  packHolds,
  standAt,
  startTalk,
} from './helpers/harbour';

// mw-e40.35: the Wendmouth dock played end to end in a real browser. Hesketh signs the player on and
// hands over the gangway tally, the gate opens to it and the player WALKS up the gangway onto the
// Gilded Tern's deck (tern.boarded). The hatch leg is in wendmouth-harbour-loop-hold.spec.ts and
// Tereza's route to the same token in wendmouth-harbour-loop-tereza.spec.ts.

test('mw-e40.35: sign on with Hesketh, open the gangway, walk aboard, climb into the hold and out', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const problems = collectProblems(page);
  await boot(page);

  // 1. Hesketh, the crew route to its end.
  await standAt(page, [35, 0, 94], { x: 35, z: 96 });
  expect(await packHolds(page)).toBe(false);
  await standAt(page, [35, 0, 94], { x: 35, z: 96 });
  await startTalk(page, 'npc-hesketh');
  await choose(page, 'Are you hiring?');
  await choose(page, 'Sign me on.');
  await choose(page, "That's all.");
  await closeTalk(page);

  // 2. The tally is in the pack.
  await expect.poll(() => packHolds(page), POLL).toBe(true);

  // 3. Face the gate. It is shut to the player's body until Interact opens it to the tally.
  await standAt(page, [35, 0, 97.6], { x: 35, z: 99 });
  expect((await holdKey(page, W, 24, 6)).position.z).toBeLessThan(99);
  await standAt(page, [35, 0, 97.6], { x: 35, z: 99 });
  // Interact only while the prompt offers to unlock or open it: a second press would shut it again.
  await expect
    .poll(async () => {
      const prompt = page.getByTestId('interact-prompt');
      if (/Unlock|Open door/.test((await prompt.textContent()) ?? '')) {
        await page.keyboard.press('KeyE');
      }
      return (await holdKey(page, W, 12, 2)).position.z > 99.5;
    }, POLL_HOLDS)
    .toBe(true);

  // 4. Walk up the gangway onto the deck: keys only, no teleport.
  await expect
    .poll(async () => {
      const state = await holdKey(page, W, 24, 4);
      return state.position.y > 2 && state.position.z > 104;
    }, POLL_HOLDS)
    .toBe(true);
  const deck = (await playerState(page)).position;
  expect(deck.x).toBeGreaterThan(31);
  expect(deck.x).toBeLessThan(39);
  expect(deck.y).toBeGreaterThan(1.9);
  expect(deck.y).toBeLessThan(3.2);
  await expect.poll(() => factIs(page, 'tern.boarded'), POLL).toContain('true');

  expect(problems).toEqual([]);
});
