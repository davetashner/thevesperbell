import { expect, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './player';

// Shared by the wendmouth-harbour-loop*.spec.ts files (mw-e40.35): the Wendmouth dock played in a
// real browser. Built for a ~1 fps CI runner: every wait polls published state with a long timeout.

export const POLL = { timeout: 90_000 };
// The waits that advance the sim themselves with short holds (a hold per poll try) get longer: a
// ~1 fps CI runner fits few holds into 90 s, and the sim is deterministic, so waiting longer is safe.
export const POLL_HOLDS = { timeout: 120_000 };

export interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  conversing: boolean;
  focus: number;
  choices: { text: string; locked: boolean }[];
}

export const dialogue = (page: Page): Promise<Dialogue> =>
  page.evaluate(
    () =>
      JSON.parse(
        document.querySelector<HTMLElement>('#app')?.dataset['dialogue'] ?? '{}',
      ) as Dialogue,
  );

/**
 * The console view leaves the DOM when it closes, and runConsole closes it, so its answers are
 * recorded as they are printed: window.__consoleLines holds every log line in order.
 */
export async function recordConsole(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const lines: string[] = [];
    (window as unknown as { __consoleLines: string[] }).__consoleLines = lines;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Partial<HTMLElement>;
        if (target.dataset?.['testid'] !== 'debug-console-log') continue;
        for (const node of record.addedNodes) lines.push(node.textContent ?? '');
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

export async function boot(page: Page): Promise<void> {
  await stubPointerLock(page);
  await recordConsole(page);
  await page.goto('/?scene=wendmouth-harbour&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'wendmouth-harbour', { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-dialogue', /"open":false/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 30_000 });
  await takeControl(page);
}

/** Stands the player at (x, y, z) and turns to face (lookX, lookZ). */
export async function standAt(
  page: Page,
  at: [number, number, number],
  look: { x: number; z: number },
): Promise<void> {
  await runConsole(page, `tp ${at.join(' ')}`);
  await expect.poll(async () => Math.abs((await turnTo(page, look)).error), POLL).toBeLessThan(0.1);
}

/** Presses Interact until Hesketh's (or whoever's) dialogue opens. */
export async function startTalk(page: Page, npc: string): Promise<void> {
  await expect(page.getByTestId('interact-prompt')).toContainText('Talk', POLL);
  await expect
    .poll(async () => {
      if ((await dialogue(page)).open) return true;
      await page.keyboard.press('KeyE');
      return false;
    }, POLL)
    .toBe(true);
  expect(await dialogue(page)).toMatchObject({ npc, conversing: true });
}

/** Advances lines until a choice list shows. */
export async function toChoices(page: Page): Promise<Dialogue> {
  await expect
    .poll(async () => {
      const d = await dialogue(page);
      if (d.kind === 'line') await page.keyboard.press('Enter');
      return d.kind;
    }, POLL)
    .toBe('choice');
  return dialogue(page);
}

/** Reads the closing lines (Enter) until the dialogue has closed. */
export async function closeTalk(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const d = await dialogue(page);
      if (d.open) await page.keyboard.press('Enter');
      return d.open;
    }, POLL)
    .toBe(false);
}

/** Picks the choice whose text is `text` with its number key. */
export async function choose(page: Page, text: string): Promise<void> {
  const { choices } = await toChoices(page);
  const index = choices.findIndex((c) => c.text === text);
  expect(index, `choice "${text}" among ${JSON.stringify(choices)}`).toBeGreaterThanOrEqual(0);
  expect(choices[index]?.locked).toBe(false);
  await page.keyboard.press(`Digit${String(index + 1)}`);
}

/** Runs a console line and returns the log text after it. */
export async function consoleSays(page: Page, line: string): Promise<string> {
  await runConsole(page, line);
  // The observer delivers its records in a microtask: read after one more frame.
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        requestAnimationFrame(() => {
          const lines = (window as unknown as { __consoleLines: string[] }).__consoleLines;
          resolve(lines.join('\n'));
        });
      }),
  );
}

/** Whether the pack holds the tally: the newest item.list answer, up to its gold line. */
export async function packHolds(page: Page): Promise<boolean> {
  const lines = (await consoleSays(page, 'item.list')).split('\n');
  const from = lines.map((l) => l === '> item.list').lastIndexOf(true);
  return lines.slice(from).some((l) => l.includes('tern-gangway-pass × 1'));
}

export async function factIs(page: Page, key: string): Promise<string> {
  const lines = (await consoleSays(page, `facts.get ${key}`)).split('\n');
  return lines.filter((l) => l.startsWith(`${key} = `)).pop() ?? '';
}
