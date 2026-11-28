import { expect, test } from '@playwright/test';
import { runConsole } from './helpers/player';
import { collectProblems } from './helpers/slice';
import {
  POLL,
  boot,
  choose,
  closeTalk,
  factIs,
  packHolds,
  standAt,
  startTalk,
} from './helpers/harbour';

// mw-e40.35: Tereza's route to the Gilded Tern's gangway token, a second, shorter leg of the dock loop.

test("mw-e40.35: Tereza's vouch gets the same gangway token from Hesketh", async ({ page }) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await boot(page);
  await runConsole(page, 'facts.set tereza.tern-access true');
  await expect.poll(() => factIs(page, 'tereza.tern-access'), POLL).toContain('true');
  expect(await packHolds(page)).toBe(false);
  await standAt(page, [35, 0, 94], { x: 35, z: 96 });
  await startTalk(page, 'npc-hesketh');
  await choose(page, 'Tereza said I might come aboard.');
  await choose(page, "That's all.");
  await closeTalk(page);
  await expect.poll(() => packHolds(page), POLL).toBe(true);
  await expect.poll(() => factIs(page, 'hesketh.gangway-open'), POLL).toContain('true');
  expect(problems).toEqual([]);
});
