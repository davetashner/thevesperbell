import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';
import { collectProblems } from './helpers/slice';

// mw-opf6: the Drowned Gull's dice table in Wendmouth (?scene=wendmouth-harbour, debug way in). The
// player stands beside the table, Interact opens the contest window (fee and the rules), Enter pays
// and starts, F rolls, and N walks away; the published state (#app[data-contest]) says what is going
// on. Built for a ~1 fps CI runner: every wait polls published state, Interact is pressed again on
// each poll, and the match is allowed to end any way it likes (the house paces itself).

const POLL = { timeout: 30_000 };

interface Contest {
  playing: string | null;
  open: boolean;
  last: string | null;
}

const contest = (page: Page): Promise<Contest> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['contest'] ?? '{}',
      ) as Contest,
  );

test('mw-opf6: the dice table opens its entry window, a player can enter, roll and finish the match', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=wendmouth-harbour&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'wendmouth-harbour', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await takeControl(page);
  await runConsole(page, 'gold 40');

  // A metre west of the dice table, facing it.
  await runConsole(page, 'tp 83.5 0.5 145');
  await expect
    .poll(async () => Math.abs((await turnTo(page, { x: 84.5, z: 145 })).error), POLL)
    .toBeLessThan(0.1);
  await expect(page.getByTestId('interact-prompt')).toContainText('Play dice', POLL);
  await expect
    .poll(async () => {
      if ((await contest(page)).open) return true;
      await page.keyboard.press('KeyE');
      return false;
    }, POLL)
    .toBe(true);
  await expect(page.getByTestId('contest-window')).toContainText('Entry fee: 1');

  // Entering pays the fee and starts the match; the panel shows the standings and the keys.
  await page.locator('[data-screen="contest"] [data-action="enter"]').dispatchEvent('click');
  await expect.poll(async () => (await contest(page)).playing, POLL).toBe('drowned-gull-dice');
  await expect(page.getByTestId('contest-hud')).toContainText('F: roll');

  // Roll until the match is decided, or walk away: either way it ends and says so.
  await expect
    .poll(
      async () => {
        const state = await contest(page);
        if (state.playing === null) return state.last;
        await page.keyboard.press('KeyF');
        return null;
      },
      { timeout: 90_000 },
    )
    .toMatch(/^drowned-gull-dice:(won|lost)$/);
  expect(problems).toEqual([]);
});
