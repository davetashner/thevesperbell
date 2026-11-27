import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';
import { collectProblems, W } from './helpers/slice';

// mw-e40.35: the Wendmouth dock played end to end in a real browser as one loop. Hesketh signs the
// player on and hands over the gangway tally, the gate opens to it, the player WALKS up the gangway
// onto the Gilded Tern's deck (tern.boarded), climbs down the hatch ladder into the hold and back out.
// Tereza's route to the same token is a second, shorter test. Built for a ~1 fps CI runner: every
// wait polls published state with a 90 s timeout, since a busy runner (two heavy 3D specs on one
// shard) fits too few short holds into 30 s; the tests' own budgets are 600 s and 300 s.

const POLL = { timeout: 90_000 };
// The waits that advance the sim themselves with short holds (a hold per poll try) get longer: a
// ~1 fps CI runner fits few holds into 90 s, and the sim is deterministic, so waiting longer is safe.
const POLL_HOLDS = { timeout: 120_000 };

interface Dialogue {
  open: boolean;
  npc: string | null;
  kind: 'line' | 'choice' | null;
  text: string;
  conversing: boolean;
  focus: number;
  choices: { text: string; locked: boolean }[];
}

const dialogue = (page: Page): Promise<Dialogue> =>
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
async function recordConsole(page: Page): Promise<void> {
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

async function boot(page: Page): Promise<void> {
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
async function standAt(
  page: Page,
  at: [number, number, number],
  look: { x: number; z: number },
): Promise<void> {
  await runConsole(page, `tp ${at.join(' ')}`);
  await expect.poll(async () => Math.abs((await turnTo(page, look)).error), POLL).toBeLessThan(0.1);
}

/** Presses Interact until Hesketh's (or whoever's) dialogue opens. */
async function startTalk(page: Page, npc: string): Promise<void> {
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
async function toChoices(page: Page): Promise<Dialogue> {
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
async function closeTalk(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const d = await dialogue(page);
      if (d.open) await page.keyboard.press('Enter');
      return d.open;
    }, POLL)
    .toBe(false);
}

/** Picks the choice whose text is `text` with its number key. */
async function choose(page: Page, text: string): Promise<void> {
  const { choices } = await toChoices(page);
  const index = choices.findIndex((c) => c.text === text);
  expect(index, `choice "${text}" among ${JSON.stringify(choices)}`).toBeGreaterThanOrEqual(0);
  expect(choices[index]?.locked).toBe(false);
  await page.keyboard.press(`Digit${String(index + 1)}`);
}

/** Runs a console line and returns the log text after it. */
async function consoleSays(page: Page, line: string): Promise<string> {
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
async function packHolds(page: Page): Promise<boolean> {
  const lines = (await consoleSays(page, 'item.list')).split('\n');
  const from = lines.map((l) => l === '> item.list').lastIndexOf(true);
  return lines.slice(from).some((l) => l.includes('tern-gangway-pass × 1'));
}

async function factIs(page: Page, key: string): Promise<string> {
  const lines = (await consoleSays(page, `facts.get ${key}`)).split('\n');
  return lines.filter((l) => l.startsWith(`${key} = `)).pop() ?? '';
}

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
