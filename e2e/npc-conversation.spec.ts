import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e22.9 AC-5: the greybox villager (dev scene `conversation-room`, debug builds) against the
// production build (Chromium). She walks a patrol route along the room. The player stands where she
// is, faces her and presses Interact: the conversation opens (#app[data-dialogue], JSON) and her
// routine pauses. The player continues the line, picks two options and says goodbye, and she walks
// her route again. CI draws about a frame a second, so every wait polls published sim state, and the
// player is moved next to her (never aimed at a moving target from afar) until Talk is offered.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const FRAME_LOOP_NOTICE = 'frame loop: ';
const POLL = { timeout: 30_000 };

interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  choices: { text: string; locked?: boolean; reason?: string }[];
  focus?: number;
  historyOpen?: boolean;
  history?: number;
  conversing: boolean;
  last?: { npc: string; reason: string; cause?: string };
}
interface Ai {
  agents: { state: string; activity: string | null; at: [number, number, number] }[];
}

const dialogue = (page: Page): Promise<Dialogue> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['dialogue'] ?? '{}',
      ) as Dialogue,
  );
const villager = async (page: Page): Promise<Ai['agents'][number] | undefined> =>
  page.evaluate(() => {
    const json = document.querySelector<HTMLElement>('#app')?.dataset['ai'];
    return json === undefined ? undefined : (JSON.parse(json) as Ai).agents[0];
  });

test('mw-e22.9 AC-5, mw-e22.10: talk to the greybox villager, pick options by number, see a locked reason, open the history, say goodbye; she walks her route again', async ({
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
  await expect.poll(async () => (await villager(page))?.activity, POLL).toBe('patrol');
  await takeControl(page);

  // Stand mid-route a metre and a half from her path, facing it: she passes through the view, Talk
  // is offered, and Interact is pressed while it is.
  await runConsole(page, 'tp 0 0 1.5');
  const turned = await turnTo(page, { x: 0, z: 3 });
  expect(Math.abs(turned.error)).toBeLessThan(0.1);
  // In the page, on its own frames: a slow runner shows Talk for a frame or two as she passes.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const app = document.querySelector<HTMLElement>('#app');
        const started = performance.now();
        const key = (type: string): void => {
          window.dispatchEvent(
            new KeyboardEvent(type, { code: 'KeyE', key: 'e', bubbles: true, cancelable: true }),
          );
        };
        const watch = (): void => {
          const open = (JSON.parse(app?.dataset['dialogue'] ?? '{}') as { open?: boolean }).open;
          const prompt = document.querySelector<HTMLElement>('[data-testid="interact-prompt"]');
          if (open === true) resolve();
          else if (performance.now() - started > 90_000) reject(new Error('Talk never worked'));
          else {
            if (prompt !== null && !prompt.hidden && prompt.dataset['available'] === 'true') {
              key('keydown');
              key('keyup');
            }
            requestAnimationFrame(watch);
          }
        };
        watch();
      }),
  );

  // Her routine is paused and the first line shows.
  const first = await dialogue(page);
  expect(first).toMatchObject({
    open: true,
    npc: 'greybox-villager',
    kind: 'line',
    conversing: true,
  });
  await expect(page.getByTestId('dialogue-box')).toContainText(first.text);
  const stopped = await villager(page);
  // Talking is modal for input (mw-e22.19): the pointer is free and gameplay frames are withheld.
  await expect(app).toHaveAttribute('data-ui-capture', 'true');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  // The line types out: Enter shows the rest first, then goes on. Press until it has.
  const continueLine = async (): Promise<void> => {
    for (let i = 0; i < 6 && (await dialogue(page)).kind === 'line'; i += 1) {
      await page.keyboard.press('Enter');
    }
    await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('choice');
  };
  await continueLine();
  expect((await dialogue(page)).choices.map((c) => c.text)).toEqual([
    'Who are you?',
    'Heard anything lately?',
    'Here is a purse for your trouble.',
    'Goodbye.',
  ]);

  // A locked option shows why when the cursor is on it, and Enter does nothing there.
  const purse = (await dialogue(page)).choices[2];
  expect(purse).toMatchObject({ locked: true, reason: 'Needs gold at least 99' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await dialogue(page)).focus, POLL).toBe(2);
  await expect(page.getByTestId('dialogue-box')).toContainText('Needs gold at least 99');
  await page.keyboard.press('Enter');
  expect((await dialogue(page)).kind).toBe('choice');

  // Pick an option with a number key, read its answer, and open the history.
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  await page.keyboard.press('KeyH');
  await expect.poll(async () => (await dialogue(page)).historyOpen, POLL).toBe(true);
  const box = page.getByTestId('dialogue-box');
  await expect(box.locator('.vb-dialogue-history')).toContainText('Who are you?');
  await expect(box.locator('.vb-dialogue-history')).toContainText(first.text);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dialogue(page)).historyOpen, POLL).toBe(false);
  await continueLine();

  // A second option, then Goodbye.
  await page.keyboard.press('Digit1'); // "Heard anything lately?" is first now
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  await continueLine();
  await expect.poll(async () => (await dialogue(page)).choices.length, POLL).toBe(2);
  await page.keyboard.press('Digit2'); // Goodbye (the locked purse is first)
  await expect.poll(async () => (await dialogue(page)).open, POLL).toBe(false);
  expect((await dialogue(page)).last).toEqual({ npc: 'greybox-villager', reason: 'completed' });
  await expect(page.getByTestId('dialogue-box')).toBeHidden();
  await expect(app).toHaveAttribute('data-ui-capture', 'false');

  // She went nowhere while talking, and walks her route again.
  await expect
    .poll(async () => {
      const now = (await villager(page))?.at;
      return now !== undefined && stopped !== undefined && Math.abs(now[0] - stopped.at[0]) > 0.3;
    }, POLL)
    .toBe(true);
  await expect.poll(async () => (await villager(page))?.activity, POLL).toBe('patrol');
  expect(problems).toEqual([]);
});
