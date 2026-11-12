import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e39.6: walk up to Juniper Fenn in the shop lane (?scene=briar-glen-lane) and talk to her. She
// stands east of her counter; the player is put beside her (not at the counter, which would offer
// Trade) and Interact starts her dialogue (juniper-fenn). The player reads her greeting, asks about
// the wolves, hears her answer and says goodbye. Pacing for CI, which draws about a frame a second:
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

test('mw-e39.6: talk to Juniper Fenn in the lane, ask about the wolves and say goodbye', async ({
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
  await page.goto('/?scene=briar-glen-lane&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'briar-glen-lane', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await takeControl(page);

  // Beside Juniper (x 7, z 24), a metre from her and more than the counter's reach from the counter.
  await runConsole(page, 'tp 6.1 0 24');
  const turned = await turnTo(page, { x: 7, z: 24 });
  expect(Math.abs(turned.error)).toBeLessThan(0.1);
  await expect(page.getByTestId('interact-prompt')).toContainText('Talk', POLL);
  // Press Interact in the page on its own frames, while Talk is offered, until the box opens: a
  // slow runner can miss a single key press between two frames.
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

  // The greeting is a line (she greets each class differently), then the choices.
  const first = await dialogue(page);
  expect(first).toMatchObject({ npc: 'npc-juniper', kind: 'line', conversing: true });
  await expect(page.getByTestId('dialogue-box')).toContainText(first.text);
  await continueUntil(page, 'choice');
  const options = (await dialogue(page)).choices.map((c) => c.text);
  expect(options).toContain('The wolves have stopped howling.');
  expect(options.at(-1)).toBe("That's all.");

  // Ask about the wolves; her answer is the bible's line.
  await page.keyboard.press(
    `Digit${String(options.indexOf('The wolves have stopped howling.') + 1)}`,
  );
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  expect((await dialogue(page)).text).toContain("Wolves don't go quiet");
  await continueUntil(page, 'choice');

  // Goodbye is the last option; her farewell is a line, and the conversation completes.
  const left = (await dialogue(page)).choices;
  expect(left.map((c) => c.text)).not.toContain('The wolves have stopped howling.');
  await page.keyboard.press(`Digit${String(left.length)}`);
  await expect.poll(async () => (await dialogue(page)).kind, POLL).toBe('line');
  await continueUntil(page, 'closed');
  expect((await dialogue(page)).last).toEqual({ npc: 'npc-juniper', reason: 'completed' });
  await expect(page.getByTestId('dialogue-box')).toBeHidden();
  expect(problems).toEqual([]);
});
