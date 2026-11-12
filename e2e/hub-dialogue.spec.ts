import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e39.5: walk up to Dot Farrow in the Sleeping Ox (?scene=sleeping-ox) and talk to her. She stands
// south of her bar; the player is put beside her (not at the bar, which would offer Trade) and Interact
// starts her dialogue (dot-sleeping-ox). The player reads her greeting, asks after Fitch, hears her
// answer and says goodbye. Pacing for CI, which draws about a frame a second:
// every wait polls published sim state with a 30 s timeout and nothing depends on wall-clock timing.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const FRAME_LOOP_NOTICE = 'frame loop: ';
const POLL = { timeout: 30_000 };

interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  choices: { id?: string; text: string }[];
  conversing: boolean;
  last?: { npc: string; reason: string; cause?: string };
}

const dialogue = (page: Page): Promise<Dialogue> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['dialogue'] ?? '{}',
      ) as Dialogue,
  );

/**
 * Continues lines until the conversation reaches the given kind (or closes). The dialogue screen may
 * take a first Enter to finish revealing a line, so press again each poll rather than once.
 */
async function continueUntil(page: Page, kind: 'choice' | 'closed'): Promise<void> {
  await expect
    .poll(async () => {
      const state = await dialogue(page);
      if (kind === 'closed' ? !state.open : state.kind === kind) return true;
      if (state.kind === 'line') await page.keyboard.press('Enter');
      return false;
    }, POLL)
    .toBe(true);
}

test('mw-e39.5: talk to Dot Farrow in the Sleeping Ox, ask after Fitch and say goodbye', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=sleeping-ox&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'sleeping-ox', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await takeControl(page);

  // Beside Dot (x -2, z 3), a metre from her and more than the bar's reach from the bar.
  await runConsole(page, 'tp -3.1 0 3');
  const turned = await turnTo(page, { x: -2, z: 3 });
  expect(Math.abs(turned.error)).toBeLessThan(0.1);
  await expect(page.getByTestId('interact-prompt')).toContainText('Talk', POLL);
  // Press Interact, while Talk is offered, until the box opens: a slow runner can miss a single key
  // press between two frames, so press again on every poll rather than once.
  await expect
    .poll(async () => {
      if ((await dialogue(page)).open) return true;
      await page.keyboard.press('KeyE');
      return false;
    }, POLL)
    .toBe(true);

  // The greeting is a line (she greets each class differently), then the choices.
  const first = await dialogue(page);
  expect(first).toMatchObject({ npc: 'npc-dot', kind: 'line', conversing: true });
  await expect(page.getByTestId('dialogue-box')).toContainText(first.text);
  await continueUntil(page, 'choice');
  const options = (await dialogue(page)).choices.map((c) => c.text);
  expect(options).toContain("You're missing a barman.");
  expect(options.at(-1)).toBe("That's all.");

  // Ask after Fitch; her answer is the bible's missing barman.
  await page.keyboard.press(`Digit${String(options.indexOf("You're missing a barman.") + 1)}`);
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  expect((await dialogue(page)).text).toContain('Twelve years behind that bar');
  await continueUntil(page, 'choice');

  // Goodbye is the last option; her farewell is a line, and the conversation completes.
  const left = (await dialogue(page)).choices;
  expect(left.map((c) => c.text)).not.toContain("You're missing a barman.");
  await page.keyboard.press(`Digit${String(left.length)}`);
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  await continueUntil(page, 'closed');
  expect((await dialogue(page)).last).toEqual({ npc: 'npc-dot', reason: 'completed' });
  await expect(page.getByTestId('dialogue-box')).toBeHidden();
  expect(problems).toEqual([]);
});
