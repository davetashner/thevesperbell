import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';
import { collectProblems } from './helpers/slice';

// mw-e40.1: Wendmouth Harbour (?scene=wendmouth-harbour, the debug way in until the river legs exist) loads
// with the player on the Stone Wharf; they are put beside Mags Oakum at the barge berth at the foot of the
// Great Stair, and Interact starts her dialogue (mags-patient-ann). Built for a ~1 fps CI runner: every wait
// polls published state with a 30 s timeout, and Interact is pressed again on every poll.

const POLL = { timeout: 30_000 };

interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  conversing: boolean;
}

const dialogue = (page: Page): Promise<Dialogue> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['dialogue'] ?? '{}',
      ) as Dialogue,
  );

test('mw-e40.1: the harbour loads on the Stone Wharf and Mags Oakum can be talked to at the barge berth', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=wendmouth-harbour&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'wendmouth-harbour', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await takeControl(page);

  // Down the Great Stair's foot: a metre west of Mags on the landing, facing her.
  await runConsole(page, 'tp -11.5 -2 106');
  await expect
    .poll(async () => Math.abs((await turnTo(page, { x: -9.5, z: 106 })).error), POLL)
    .toBeLessThan(0.1);
  await expect(page.getByTestId('interact-prompt')).toContainText('Talk', POLL);
  await expect
    .poll(async () => {
      if ((await dialogue(page)).open) return true;
      await page.keyboard.press('KeyE');
      return false;
    }, POLL)
    .toBe(true);
  const first = await dialogue(page);
  expect(first).toMatchObject({ npc: 'npc-mags', conversing: true });
  await expect(page.getByTestId('dialogue-box')).toContainText(first.text);
  expect(problems).toEqual([]);
});
