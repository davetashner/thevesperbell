import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { steadyFrameClock, stubPointerLock } from './helpers/player';

// mw-e29.7 AC-3 in play (Chromium): a skeleton killed in the skeleton pen falls, dissolves over 1.2 s
// and its drawn body is taken out of the scene, while the other creatures (which share its materials)
// are untouched. `?corpses` publishes #app[data-corpses] (JSON: dying, gone, ids, per-creature
// dissolve progress, the creature bodies still in the scene). The sim is not touched: the creature
// stays counted in data-creatures (its health carries through saves). The deterministic timing
// (0.72 s collapse, 1.2 s dissolve) is in tests/integration/magic-materials.test.ts.
//
// Set E2E_MAGIC_SHOTS to a directory to save frames of the dissolve (the whole canvas, at moments
// the dissolve passes 0, 10, 30, 50, 70 and 90 %, and once it has gone).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Corpses {
  dying: number;
  gone: number;
  ids: number[];
  progress: (number | null)[];
  proxies: number;
  seconds: number;
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

async function corpses(page: Page): Promise<Corpses> {
  const json = await page.locator('#app').getAttribute('data-corpses');
  return JSON.parse(json ?? 'null') as Corpses;
}

test('AC-3: a killed skeleton dissolves over 1.2 s and its drawn body is removed afterwards', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  // The dissolve runs on frame time (mw-y7t): without a cap on it, one slow frame on a loaded runner
  // can carry it from 0 to gone with no frame in between. 64 ms is four sim ticks.
  await steadyFrameClock(page, 64);
  await page.goto('/?scene=skeleton-pen&debug=1&corpses');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'skeleton-pen', { timeout: 20_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 20_000 });
  await expect.poll(async () => (await corpses(page)).ids.length, { timeout: 20_000 }).toBe(4);

  // Frames of the dissolve at set moments, taken inside the page the instant it passes each mark.
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#app');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    const marks = [0, 0.1, 0.3, 0.5, 0.7, 0.9];
    const shots: { mark: string; png: string }[] = [];
    const trace = {
      dyingMax: 0,
      midFrames: 0,
      proxiesWhileMid: -1,
      onlyVictimProgressing: true,
      firstProgress: -1,
      firstAt: 0,
      goneAt: 0,
    };
    (window as unknown as { __shots: typeof shots; __trace: typeof trace }).__shots = shots;
    (window as unknown as { __trace: typeof trace }).__trace = trace;
    const tick = (): void => {
      const probe = JSON.parse(root?.dataset['corpses'] ?? '{}') as {
        progress?: (number | null)[];
        gone?: number;
        dying?: number;
        proxies?: number;
      };
      const progress = (probe.progress ?? []).find((p) => p !== null);
      const running = (probe.progress ?? []).filter((p) => p !== null);
      trace.dyingMax = Math.max(trace.dyingMax, probe.dying ?? 0);
      if (progress !== undefined && progress > 0 && progress < 1) {
        trace.midFrames++;
        trace.proxiesWhileMid = probe.proxies ?? -1;
        if (trace.firstProgress < 0) {
          trace.firstProgress = progress;
          trace.firstAt = performance.now();
        }
        if (running.length !== 1) trace.onlyVictimProgressing = false;
      }
      if ((probe.gone ?? 0) >= 1 && trace.goneAt === 0) trace.goneAt = performance.now();
      let label: string | undefined;
      if ((probe.gone ?? 0) >= 1) label = 'gone';
      else if (progress !== undefined) {
        label = marks
          .filter((m) => progress >= m && !shots.some((s) => s.mark === String(m)))
          .map(String)
          .at(-1);
      }
      if (label !== undefined && canvas && !shots.some((s) => s.mark === label)) {
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        copy.getContext('2d')?.drawImage(canvas, 0, 0);
        shots.push({ mark: label, png: copy.toDataURL('image/png') });
      }
      if (!shots.some((s) => s.mark === 'gone')) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Put a miner in front of the player and kill it with the console (the sim's own death path).
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  // God mode, so a slow runner cannot let the miner kill the player (and reload) before the kill.
  await page.keyboard.type('god on');
  await page.keyboard.press('Enter');
  await page.keyboard.type('spawn forgotten-miner 1');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await corpses(page)).ids.length, { timeout: 20_000 }).toBe(5);
  const before = await corpses(page);
  const victim = before.ids.at(-1);
  if (victim === undefined) throw new Error('no creature spawned');
  expect(before).toMatchObject({ dying: 0, gone: 0, proxies: 5 });
  await page.keyboard.type(`kill ${String(victim)}`);
  await page.keyboard.press('Enter');
  const killedAt = Date.now();

  // ... and when it is over the drawn body is gone: 4 bodies stay, the sim still counts 5 creatures.
  // (collapse and dissolve are 1.9 s of game time, at most 64 ms a frame: 30 frames, a minute at 1 fps)
  await expect.poll(async () => (await corpses(page)).gone, { timeout: 120_000 }).toBe(1);
  const after = await corpses(page);
  expect(after).toMatchObject({ dying: 0, gone: 1, proxies: 4 });
  // Seen from the page's own frames: only the killed creature dissolved, it was still drawn (5
  // bodies) while it did, and the part of the 1.2 s dissolve after the first frame that showed it
  // took at least that long (a slow runner only makes it longer).
  const trace = await page.evaluate(
    () =>
      (
        window as unknown as {
          __trace: {
            dyingMax: number;
            midFrames: number;
            proxiesWhileMid: number;
            onlyVictimProgressing: boolean;
            firstProgress: number;
            firstAt: number;
            goneAt: number;
          };
        }
      ).__trace,
  );
  expect(trace.dyingMax).toBe(1);
  expect(trace.onlyVictimProgressing).toBe(true);
  // 1.2 s at up to 64 ms a frame is up to 18 frames in the middle of it; a runner whose frames are
  // slower than the page's own sampling still shows several (9 with every frame stalled 1.4 s).
  expect(trace.midFrames).toBeGreaterThanOrEqual(5);
  expect(trace.proxiesWhileMid).toBe(5);
  expect(trace.goneAt - trace.firstAt).toBeGreaterThanOrEqual(
    (1 - trace.firstProgress) * 1200 - 100,
  );
  expect(Date.now() - killedAt).toBeGreaterThanOrEqual(1200);
  const readout = JSON.parse((await app.getAttribute('data-creatures')) ?? 'null') as {
    count: number;
    drawn: number;
  };
  expect(readout).toMatchObject({ count: 5, drawn: 5 });

  const dir = process.env['E2E_MAGIC_SHOTS'];
  if (dir !== undefined) {
    await mkdir(dir, { recursive: true });
    const shots = await page.evaluate(
      () => (window as unknown as { __shots: { mark: string; png: string }[] }).__shots,
    );
    for (const shot of shots) {
      const base64 = shot.png.replace(/^data:image\/png;base64,/, '');
      await writeFile(join(dir, `dissolve-${shot.mark}.png`), Buffer.from(base64, 'base64'));
    }
  }
  expect(problems).toEqual([]);
});
