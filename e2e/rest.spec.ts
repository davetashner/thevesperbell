import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e27.13: resting at the greybox rest room's unlit campfire (?scene=rest-room) against the production build (Chromium).
// The player lights it with Interact (the `light` verb is heat on its fuel, so the fire rules burn it),
// opens the rest menu with Interact again (the verb is greyed "The fire is out" until it burns), and
// rests 8 hours: the HUD clock moves on 8 h, health is full, the game writes its `rest` autosave, and
// nothing logs an error. The long rests (interrupts, dawn and dusk, vetoes) are in the sim's tests;
// the frame loop runs five ticks a frame at most, so the spec asserts the action and its immediate
// effect and never waits out sim time.
//
// Built for a slow runner like e2e/sleeping-ox.spec.ts: every Playwright round trip costs seconds, so
// the spec starts beside the fire with a teleport and keeps its action count low.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

interface Clock {
  day: number;
  minute: number;
  text: string;
}

test('AC-7: the player lights the campfire and rests 8 h: the clock reads +8 h, health is full, no errors', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=rest-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'rest-room', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await takeControl(page);

  // South of the campfire (0, 1), facing it. It starts unlit: the prompt offers to light it, and the
  // game clock reads its start, day 1 06:00.
  await runConsole(page, 'tp 0 0 -0.5');
  await turnTo(page, { x: 0, z: 1 });
  await expect(page.getByTestId('interact-prompt')).toContainText('Light the campfire');
  const start = await data<Clock>(page, 'clock');
  expect(start).toMatchObject({ day: 1, minute: 360 });
  await expect(page.getByTestId('clock-hud')).toHaveText(start?.text ?? '');

  // Lighting it is heat on its fuel; once it burns the prompt offers rest.
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('interact-prompt')).toContainText('Rest by the fire');
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-rest-ui', /"open":true.*"kind":"campfire"/);
  await expect(page.locator('[data-screen="rest"] [data-action^="rest:"]')).toHaveCount(4);

  // Rest 8 hours. Frame-paced click checks never settle at a frame a second: dispatch the click.
  await page.locator('[data-screen="rest"] [data-action="rest:hours-8"]').dispatchEvent('click');
  await expect(app).toHaveAttribute('data-rest-ui', /"open":false.*"ok":true,"hours":8/);
  await expect(app).toHaveAttribute('data-rest', /"kind":"campfire".*"point":"rest-campfire"/);
  const woke = await data<Clock>(page, 'clock');
  expect(woke).toMatchObject({ day: 1, minute: 360 + 8 * 60 });
  await expect(page.getByTestId('clock-hud')).toHaveText(woke?.text ?? '');
  // Health is full.
  const health = page.locator('[role="meter"][aria-label="Health"]');
  await expect(health).toHaveAttribute(
    'aria-valuenow',
    (await health.getAttribute('aria-valuemax')) ?? '',
  );
  // One `rest` autosave, written once it is safe.
  await expect
    .poll(() => data<{ type: string; kind: string }>(page, 'autosave'), { timeout: 30_000 })
    .toMatchObject({ type: 'saved', kind: 'rest' });
  expect(problems).toEqual([]);
});
