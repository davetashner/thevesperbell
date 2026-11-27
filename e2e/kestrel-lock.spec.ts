import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  runConsole,
  stubPointerLock,
  takeControl,
  turnTo,
} from './helpers/player';
import { collectProblems } from './helpers/slice';

// mw-e25.14, mw-e40.26, mw-e25.31: the towpath walked end to end in a real browser. From the east end of
// the Millweir's river scene the player walks the towpath gate into Kestrel Lock (6 game hours), walks the lock's towpath east into
// Wendmouth's Stone Wharf (6 more hours) and back west through the towpath gate into the lock. Teleports
// only save the walk inside a scene; scenes are crossed by walking into transition volumes. Built for a
// ~1 fps CI runner: every wait polls published state with a long timeout and holds are paced by ticks.

const W = { code: 'KeyW', key: 'w' };
const POLL = { timeout: 60_000 };

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

/** Runs a console line and returns the whole log after it. */
async function consoleSays(page: Page, line: string): Promise<string> {
  await runConsole(page, line);
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

async function fact(page: Page, key: string): Promise<string> {
  const lines = (await consoleSays(page, `facts.get ${key}`)).split('\n');
  return lines.filter((l) => l.startsWith(`${key} = `)).pop() ?? '';
}

/** Game minutes since day 1 00:00, from the clock facts. */
async function gameMinutes(page: Page): Promise<number> {
  const day = Number(/= (\d+)/.exec(await fact(page, 'time.day'))?.[1]);
  const minute = Number(/= (\d+)/.exec(await fact(page, 'time.minute'))?.[1]);
  return (day - 1) * 1440 + minute;
}

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 30_000 });
  await takeControl(page);
}

async function face(page: Page, aim: { x: number; z: number }): Promise<void> {
  await expect.poll(async () => Math.abs((await turnTo(page, aim)).error), POLL).toBeLessThan(0.1);
}

/** Faces `aim` and walks forward until the page reloads into `scene`. */
async function walkThrough(
  page: Page,
  aim: { x: number; z: number },
  scene: string,
): Promise<void> {
  await face(page, aim);
  await holdKey(page, W, 300).catch((error: unknown) => {
    // The scene change reloads the page under the evaluation: expected.
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 120_000 });
  await ready(page, scene);
}

test('mw-e25.14, mw-e25.31 AC-1: the towpath from the Millweir to Kestrel Lock to the Stone Wharf and back, 6 game hours a leg', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await recordConsole(page);
  await page.goto('/?scene=briar-glen-river&debug=1');
  const app = page.locator('#app');
  await ready(page, 'briar-glen-river');
  const start = await gameMinutes(page);

  // Leg 1: the Millweir's towpath east, through the towpath gate, into Kestrel Lock.
  await runConsole(page, 'tp 210 0 -7');
  await walkThrough(page, { x: 260, z: -7 }, 'kestrel-lock');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"kestrel-lock".*"spawn":"arrive-from-briar-glen-river"/,
    POLL,
  );
  const atLock = await gameMinutes(page);
  expect(atLock - start).toBeGreaterThanOrEqual(360);
  expect(atLock - start).toBeLessThan(380);
  expect((await playerState(page)).position.x).toBeLessThan(-40);

  // Leg 2: east along the lock's towpath into the Stone Wharf.
  await runConsole(page, 'tp 42 0 -5.5');
  await walkThrough(page, { x: 100, z: -5.5 }, 'wendmouth-harbour');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"wendmouth-harbour".*"spawn":"arrive-from-kestrel-lock"/,
    POLL,
  );
  const atWharf = await gameMinutes(page);
  expect(atWharf - atLock).toBeGreaterThanOrEqual(360);
  expect(atWharf - atLock).toBeLessThan(400);

  // And back through the towpath gate: the lock again.
  await walkThrough(page, { x: -85, z: -100 }, 'kestrel-lock');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"kestrel-lock".*"spawn":"arrive-from-wendmouth-harbour"/,
    POLL,
  );
  expect((await playerState(page)).position.x).toBeGreaterThan(40);
  expect(await gameMinutes(page)).toBeGreaterThanOrEqual(atWharf + 360);
  expect(problems).toEqual([]);
});

test('mw-e25.27 AC-2: the lower paddle lever on the lockside is thrown by hand from the towpath', async ({
  page,
}) => {
  // The 20 s levels-settle delay that writes kestrel-lock.gate-open is 1200 sim ticks: at the
  // ~5 ticks per frame a 1 fps CI runner reaches, that is four minutes of wall time, which is what
  // timed the old step out (180 s). The delay and fact write are covered by the integration test
  // (tests/integration/towpath-kestrel-lock.test.ts); here the lever the player reaches is thrown.
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=kestrel-lock&debug=1');
  await ready(page, 'kestrel-lock');
  const lever = (): Promise<number | undefined> =>
    page
      .locator('#app')
      .getAttribute('data-mechanisms')
      .then((json) => {
        const read = JSON.parse(json ?? 'null') as { switches: Record<string, number> } | null;
        return read?.switches['lower-paddle-lever'];
      });
  await expect.poll(lever, POLL).toBe(0);
  await runConsole(page, 'tp 7.5 0 -5.5');
  await face(page, { x: 7.5, z: -3.75 });
  await holdKey(page, { code: 'KeyE', key: 'e' }, 3);
  await expect.poll(lever, POLL).toBe(1);
  // A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
  expect(problems.filter((p) => !p.includes('frame loop: '))).toEqual([]);
});
