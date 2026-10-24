import { expect, test, type Page } from '@playwright/test';

// mw-e33.1: the in-game debug console, against the production build (Chromium). Dev builds always
// load it; this production build loads it only with ?debug=1 (the playtest switch), which is what
// these tests use to stand in for "a dev build". Without the flag it must not load at all.
//
// Pointer lock: headless Chromium refuses it, so (as in testbed-player.spec.ts) an init script
// grants requestPointerLock at once; everything else is the real game.

/** The string only the console module contains (src/tools/console/view.ts CONSOLE_MODULE_MARKER). */
const CONSOLE_MODULE_MARKER = 'vesper-debug-console-module';

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
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

async function player(page: Page): Promise<PlayerData> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as PlayerData;
}

/** Loads the testbed (with `query`), waits for the player to settle and takes control. */
async function play(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    const lock: { element: Element | null } = { element: null };
    const change = () => document.dispatchEvent(new Event('pointerlockchange'));
    Object.defineProperty(Document.prototype, 'pointerLockElement', {
      configurable: true,
      get: () => lock.element,
    });
    Element.prototype.requestPointerLock = function requestPointerLock(this: Element) {
      lock.element = this;
      change();
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function exitPointerLock() {
      lock.element = null;
      change();
    };
  });
  await page.goto(`/?scene=testbed${query}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await page.getByTestId('game-canvas').click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
}

test('AC-4: backtick opens the console, which captures the keyboard (the player does not move); Esc and backtick close it', async ({
  page,
}) => {
  // Many small steps, each slow on GPU-less CI runners (~0.8 s per Playwright call there).
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await play(page, '&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  const consolePanel = page.getByTestId('debug-console');
  const input = page.getByTestId('debug-console-input');
  await expect(consolePanel).toBeHidden();

  await page.keyboard.press('Backquote');
  await expect(app).toHaveAttribute('data-debug-console', 'open');
  await expect(consolePanel).toBeVisible();
  // A capturing screen on the UI stack (mw-e00.23): no gameplay frames, pointer lock released.
  await expect(app).toHaveAttribute('data-ui-capture', 'true');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(''); // the backtick itself is not typed

  // Hold W (and more movement keys) for 60+ sim ticks: they go into the console, not the player.
  const before = await player(page);
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await player(page)).tick, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before.tick + 60);
  await page.keyboard.up('KeyW');
  await page.keyboard.type('wasd');
  const after = await player(page);
  expect(after.position.x).toBeCloseTo(before.position.x, 3);
  expect(after.position.z).toBeCloseTo(before.position.z, 3);
  await expect(input).toHaveValue(/^w+asd$/);

  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await expect(app).toHaveAttribute('data-ui-capture', 'false');
  await expect(consolePanel).toBeHidden();

  await page.keyboard.press('Backquote');
  await expect(app).toHaveAttribute('data-debug-console', 'open');
  await page.keyboard.press('Backquote');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  expect(problems).toEqual([]);
});

test('AC-6: typing spa + Tab completes to spawn, and a spawn runs', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await play(page, '&debug=1');
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('spa');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('spawn ');
  await expect(input).toBeFocused(); // Tab completed instead of moving focus
  await page.keyboard.type('testprop-crate 3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('debug-console-log')).toContainText('spawning 3 × testprop-crate');
  expect(problems).toEqual([]);
});

test('AC-5: without ?debug=1 a production build opens nothing and never loads the console module', async ({
  page,
}) => {
  const problems = collectProblems(page);
  const scripts: string[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') {
      scripts.push(response.url());
    }
  });
  await play(page, '');
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('debug-console')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('data-debug-console', /.*/);

  // No script the page loaded contains the console module…
  expect(scripts.length).toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await page.request.get(url)).text();
    expect(body, url).not.toContain(CONSOLE_MODULE_MARKER);
  }
  // …while the console chunk does exist in this build (so the marker is a real test).
  await page.goto('/?scene=testbed&debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console')).toHaveAttribute(
    'data-module',
    CONSOLE_MODULE_MARKER,
  );
  expect(problems).toEqual([]);
});
