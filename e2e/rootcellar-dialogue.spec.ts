import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e39.8: walk up to Mother Kettleback in the debug conversation room (?scene=conversation-room&debug=1),
// where Clatter, Kettleback and Snig stand until their real scenes exist (E26), and talk to her. Interact
// starts her dialogue (kettleback-kitchen). The player reads her wary greeting, asks whether goblins
// dream, hears her answer and says goodbye. Pacing for CI, which draws about a frame a second:
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

test('mw-e39.8: talk to Mother Kettleback in the conversation room, ask if goblins dream and say goodbye', async ({
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
  await page.goto('/?scene=conversation-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'conversation-room', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await takeControl(page);

  // A metre west of Kettleback (x 4.5, z -1), facing her.
  await runConsole(page, 'tp 3.4 0 -1');
  const turned = await turnTo(page, { x: 4.5, z: -1 });
  expect(Math.abs(turned.error)).toBeLessThan(0.1);
  await expect(page.getByTestId('interact-prompt')).toContainText('Talk', POLL);
  // Press Interact until the box opens: a slow runner can miss a single key press between two frames,
  // and the prompt flickers while the three goblins and the villager turn to greet the player.
  await expect
    .poll(async () => {
      if ((await dialogue(page)).open) return true;
      await page.keyboard.press('KeyE');
      return false;
    }, POLL)
    .toBe(true);

  // Her greeting is a line (the wary opening: standing neutral by default), then the choices.
  const first = await dialogue(page);
  expect(first).toMatchObject({ npc: 'npc-kettleback', kind: 'line', conversing: true });
  await expect(page.getByTestId('dialogue-box')).toContainText(first.text);
  expect(first.text).toContain('Stay by the door, sweetling');
  await continueUntil(page, 'choice');
  const options = (await dialogue(page)).choices.map((c) => c.text);
  expect(options).toContain('Do goblins dream?');
  expect(options.at(-1)).toBe('Goodbye, Mother Kettleback.');

  // Ask; her answer is the bible's line.
  await page.keyboard.press(`Digit${String(options.indexOf('Do goblins dream?') + 1)}`);
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  expect((await dialogue(page)).text).toContain("Goblins don't dream, sweetling");
  await continueUntil(page, 'choice');

  // Goodbye is the last option; her farewell is a line, and the conversation completes.
  const left = (await dialogue(page)).choices;
  expect(left.map((c) => c.text)).not.toContain('Do goblins dream?');
  await page.keyboard.press(`Digit${String(left.length)}`);
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  await continueUntil(page, 'closed');
  expect((await dialogue(page)).last).toEqual({ npc: 'npc-kettleback', reason: 'completed' });
  await expect(page.getByTestId('dialogue-box')).toBeHidden();
  expect(problems).toEqual([]);
});
