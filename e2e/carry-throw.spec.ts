import { expect, test, type Page } from '@playwright/test';
import { holdKey, runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e02.38 AC-1: the testbed has liftable props (a glass bottle, a clay pot, a small barrel). The
// player lifts the bottle with Interact (E), faces the back wall and throws it by holding Throw (T);
// the bottle shatters against the wall and the world records the noise. The page publishes what
// broke and the noises made on #app[data-breakables]; the test only reads them.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const KEY_T = { code: 'KeyT', key: 't' };

interface Breaks {
  broken: { profile: string; cause: string; by: string }[];
  noises: { tick: number; kind: string; loudness: number }[];
}

async function breaks(page: Page): Promise<Breaks> {
  const json = await page.locator('#app').getAttribute('data-breakables');
  return JSON.parse(json ?? 'null') as Breaks;
}

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test.setTimeout(60_000);

test('AC-1: lifting the testbed bottle and throwing it at the west wall breaks it and records a noise', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
  expect((await breaks(page)).broken).toEqual([]);
  expect((await breaks(page)).noises).toEqual([]);

  // The bottle stands by the west wall, off the player's usual paths: go next to it, face it (west,
  // yaw +90 degrees) and lift it.
  await runConsole(page, 'tp -3 0 -2');
  await turnTo(page, Math.PI / 2);
  await expect(page.getByTestId('interact-prompt')).toContainText('Pick up');
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('interact-prompt')).toBeHidden();

  // Throw at full charge at the west wall (x = -5), a metre or two ahead.
  await holdKey(page, KEY_T, 70, 60);
  await expect
    .poll(async () => (await breaks(page)).broken.map((b) => b.profile))
    .toEqual(['glass-bottle']);
  const after = await breaks(page);
  expect(after.broken[0]?.cause).toBe('impact');
  expect(after.noises.some((n) => n.kind === 'break' && n.loudness > 0)).toBe(true);
  expect(problems).toEqual([]);
});
