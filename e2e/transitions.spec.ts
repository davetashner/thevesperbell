import { expect, test, type Page } from '@playwright/test';
import { playerState, runConsole, stubPointerLock } from './helpers/player';

// mw-e01.11: walking between areas against the production build (Chromium). The player teleports
// next to a gate (`runConsole`, one page evaluation) and crosses it; the page swaps in place into the target
// scene (#app[data-scene]), the player stands at the named arrival spawn (#app[data-player]) and what
// it carried is still there. Built for a slow runner (mw-ju8.18): few actions, teleports, and no
// wall-clock assertions; the transition time budget lives in the perf suite (e2e/perf/flows.ts).

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
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

async function ready(page: Page, scene: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', scene, { timeout: 60_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 60_000 });
}

/**
 * Runs the console line that puts the player in a gate and waits for the page to reload into
 * `scene`. The reload tears the page down under the line's own evaluation (it is still waiting for
 * the console to close), so a destroyed context there is the expected result, not a failure; every
 * later read waits for the new URL and the new scene first.
 */
async function crossBy(page: Page, line: string, scene: string): Promise<void> {
  await runConsole(page, line).catch((error: unknown) => {
    if (!/Execution context was destroyed|navigation|closed/i.test(String(error))) throw error;
  });
  await page.waitForURL(new RegExp(`scene=${scene}(&|$)`), { timeout: 90_000 });
  await ready(page, scene);
}

async function rendererMemory(page: Page): Promise<{ geometries: number; textures: number }> {
  const raw = await page.locator('#app').getAttribute('data-renderer-memory');
  return JSON.parse(raw ?? '{}') as { geometries: number; textures: number };
}

test('AC-1: crossing valley-01’s north gate arrives in valley-02 at its named spawn, and the south gate returns', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=valley-01&debug=1');
  await ready(page, 'valley-01');
  // A marker only this page load can hold: a crossing swaps the area in place (mw-ju8.28).
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>)['__sameDocument'] = true;
    // And a mark on the canvas: the same element must carry the next area (mw-ju8.44).
    (document.querySelector('[data-testid="game-canvas"]') as unknown as Record<string, unknown>)[
      '__firstCanvas'
    ] = true;
  });
  // Two metres inside the north gate (x 4.5…7.5, z 51.5…53.5).
  await crossBy(page, 'tp 6 0 52.5', 'valley-02');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute(
    'data-transit',
    /"kind":"arrived".*"to":"valley-02".*"spawn":"arrive-from-valley-01"/,
  );
  // AC-1 (mw-ju8.28): the page was not reloaded to get there, and the URL names the new scene.
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['__sameDocument']),
  ).toBe(true);
  const arrived = await playerState(page);
  // AC-1 (mw-ju8.44): the canvas (and with it the WebGL context and pointer lock) survived the
  // swap. Headless Chromium has no real pointer lock, so the lock is the spec's stub, which holds
  // the element it was granted to; that it still names the live, marked canvas shows the swap did
  // not replace the element the lock sits on.
  expect(
    await page.evaluate(() => {
      const canvases = document.querySelectorAll('[data-testid="game-canvas"]');
      const canvas = canvases[0] as unknown as Record<string, unknown> | undefined;
      return {
        count: canvases.length,
        marked: canvas?.['__firstCanvas'] === true,
        locked: document.pointerLockElement === (canvas as unknown as Element),
      };
    }),
  ).toEqual({ count: 1, marked: true, locked: true });
  // The camera faces the arrival's look yaw (what the player state publishes), not the default.
  const camera = JSON.parse((await app.getAttribute('data-camera')) ?? '{}') as {
    quaternion: number[];
  };
  const [qx = 0, qy = 0, qz = 0, qw = 1] = camera.quaternion;
  const cameraYaw = Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy));
  const wrapped = Math.atan2(Math.sin(cameraYaw - arrived.yaw), Math.cos(cameraYaw - arrived.yaw));
  expect(Math.abs(wrapped)).toBeLessThan(0.05);
  // arrive-from-valley-01 is at x 0, z 4.
  expect(arrived.position.x).toBeCloseTo(0, 0);
  expect(arrived.position.z).toBeGreaterThan(3);
  expect(arrived.position.z).toBeLessThan(6);
  // The arrival autosaved (area-transition trigger).
  await expect(app).toHaveAttribute(
    'data-autosave',
    /"kind":"area-transition".*"type":"saved"|"type":"saved".*"kind":"area-transition"/,
    {
      timeout: 60_000,
    },
  );

  // Back through the south gate (z 0.25…1.75): valley-01, at the spawn by its north end.
  await crossBy(page, 'tp 0 0 1', 'valley-01');
  const back = await playerState(page);
  expect(back.position.z).toBeGreaterThan(45);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['__sameDocument']),
  ).toBe(true);
  // AC-3: swapping areas in place does not grow the renderer's memory without bound (mw-e32.12):
  // the third visit to valley-01 holds no more GPU resources than the second.
  const second = await rendererMemory(page);
  await crossBy(page, 'tp 6 0 52.5', 'valley-02');
  await crossBy(page, 'tp 0 0 1', 'valley-01');
  const third = await rendererMemory(page);
  expect(third.geometries).toBeLessThanOrEqual(second.geometries);
  expect(third.textures).toBeLessThanOrEqual(second.textures);
  expect(problems).toEqual([]);
});
