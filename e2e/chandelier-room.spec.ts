import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, takeControl } from './helpers/player';

// mw-e03.13: the chandelier room against the production build (Chromium). The player takes the bow
// out, draws it, aims the view at a rope and looses: the chandelier rope's arrow drops the
// chandelier; the anvil rope's drops 160 kg onto the rope bridge, which snaps and sends every plank
// down. The page publishes the ropes on #app[data-mechanisms] ("holding" or "gone"), the camera on
// #app[data-camera] (?debug=1) and the player on #app[data-player]; the test only reads them. Set
// E2E_EVIDENCE to a directory to also keep the screenshots taken on the way.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

interface Mechanisms {
  ropes: Record<string, 'holding' | 'gone'>;
}
interface PlayerData {
  tick: number;
  combat?: { action: string | null };
  bow?: { equipped: boolean; draw: number | null };
}
interface Point {
  x: number;
  y: number;
  z: number;
}

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

async function data<T>(page: Page, key: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T;
}

async function openRoom(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=chandelier-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'chandelier-room', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await takeControl(page);
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_EVIDENCE'];
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png` });
}

/**
 * Turns the view, with mouse moves through the game's own listeners, until the camera's ray passes
 * within `tolerance` radians of `target`: each move asks for the whole remaining turn, then waits
 * for the sim to have consumed it before reading the camera again.
 */
async function aimAt(page: Page, target: Point, tolerance = 0.003): Promise<number> {
  return page.evaluate(
    ([aim, tol]) =>
      new Promise<number>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const player = () => JSON.parse(app?.dataset['player'] ?? 'null') as { tick: number };
        const camera = () =>
          JSON.parse(app?.dataset['camera'] ?? 'null') as {
            position: number[];
            quaternion: number[];
          };
        // Rotates (0, 0, −1) by the camera's quaternion: where the view looks.
        const forward = (q: number[]) => {
          const [x = 0, y = 0, z = 0, w = 1] = q;
          return {
            x: -2 * (x * z + w * y),
            y: -2 * (y * z - w * x),
            z: -(1 - 2 * (x * x + y * y)),
          };
        };
        const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
        const angles = (v: { x: number; y: number; z: number }) => ({
          yaw: Math.atan2(-v.x, -v.z),
          pitch: Math.asin(v.y / Math.hypot(v.x, v.y, v.z)),
        });
        const gainX = 0.003;
        // A positive movementY looks down; the camera orbits as it pitches, so the view turns a little
        // less than the look does and each move asks for only part of what is left.
        const gainY = -0.002;
        const ease = 0.7;
        let moves = 0;
        const step = () => {
          const { position, quaternion } = camera();
          const now = angles(forward(quaternion));
          const want = angles({
            x: aim.x - (position[0] ?? 0),
            y: aim.y - (position[1] ?? 0),
            z: aim.z - (position[2] ?? 0),
          });
          const dyaw = wrap(want.yaw - now.yaw);
          const dpitch = want.pitch - now.pitch;
          if ((Math.abs(dyaw) <= tol && Math.abs(dpitch) <= tol) || moves >= 30) {
            resolve(Math.max(Math.abs(dyaw), Math.abs(dpitch)));
            return;
          }
          moves += 1;
          const before = player().tick;
          // Right turns right (yaw falls); the pitch gain is measured, so its sign needs no assuming.
          window.dispatchEvent(
            new MouseEvent('mousemove', {
              movementX: Math.round((-dyaw * ease) / gainX),
              movementY: Math.round((dpitch * ease) / gainY),
            }),
          );
          const settle = () => {
            if (player().tick < before + 3) {
              requestAnimationFrame(settle);
              return;
            }
            step();
          };
          requestAnimationFrame(settle);
        };
        step();
      }),
    [target, tolerance] as const,
  );
}

/** Takes the bow out, draws to full, aims at `target`, shows `before` and looses. */
async function shoot(page: Page, target: Point, before: string): Promise<void> {
  await page.keyboard.press('Digit4');
  await expect.poll(async () => (await data<PlayerData>(page, 'player')).bow?.equipped).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  });
  // The camera settles over the shoulder as the string comes to full draw: aim once it has.
  await expect
    .poll(async () => (await data<PlayerData>(page, 'player')).bow?.draw ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(48);
  const error = await aimAt(page, target);
  expect(error).toBeLessThan(0.02);
  await shot(page, before);
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  });
}

const ropes = (page: Page) => data<Mechanisms>(page, 'mechanisms').then((m) => m.ropes);

/** With evidence being kept, slows the sim so the falls last long enough to catch in frames. */
async function slowForEvidence(page: Page): Promise<void> {
  if (process.env['E2E_EVIDENCE'] !== undefined) await runConsole(page, 'timescale 0.2');
}

/**
 * Evidence only: switches to the debug fly camera (F2) and flies it `up` metres and `back` metres
 * (the sim is slowed, so the fall is still to come), then looks `down` radians below level, so the
 * screenshots show the whole fall instead of the knight's back.
 */
async function flyOut(page: Page, up: number, back: number, down: number): Promise<void> {
  if (process.env['E2E_EVIDENCE'] === undefined) return;
  const FLY_SPEED = 8; // m/s, src/tools/debug-camera/fly-camera.ts
  const hold = async (code: string, metres: number) => {
    await page.keyboard.down(code);
    await page.waitForTimeout((metres / FLY_SPEED) * 1000);
    await page.keyboard.up(code);
  };
  await page.keyboard.press('F2');
  await hold('KeyE', up);
  await hold('KeyS', back);
  // Dragging the canvas looks around, 0.003 rad per pixel. Synthetic pointer events, so the game's
  // own mouse handlers (an attack on a click) never see it.
  await page.evaluate(
    (pixels) => {
      const canvas = document.querySelector('canvas');
      const at = (type: string, y: number, buttons: number) =>
        canvas?.dispatchEvent(
          new PointerEvent(type, { clientX: 640, clientY: y, buttons, bubbles: true }),
        );
      at('pointerdown', 360, 1);
      for (let i = 1; i <= 6; i++) at('pointermove', 360 + (pixels * i) / 6, 1);
      at('pointerup', 360 + pixels, 0);
    },
    Math.round(down / 0.003),
  );
}

/** Evidence only: a screenshot from the fly camera, then back to the player's view. */
async function lookAround(
  page: Page,
  up: number,
  back: number,
  down: number,
  name: string,
): Promise<void> {
  if (process.env['E2E_EVIDENCE'] === undefined) return;
  await flyOut(page, up, back, down);
  await shot(page, name);
  await page.keyboard.press('F2');
  // The fly camera lets go of the pointer lock: take it again, and let the click's swing finish.
  await takeControl(page);
  await expect
    .poll(async () => (await data<PlayerData>(page, 'player')).combat?.action ?? null, {
      timeout: 30_000,
    })
    .toBeNull();
}

/** `count` screenshots, `gapMs` apart, named `<name>-<n>`. */
async function burst(page: Page, name: string, count: number, gapMs: number): Promise<void> {
  if (process.env['E2E_EVIDENCE'] === undefined) return;
  for (let i = 1; i <= count; i++) {
    await shot(page, `${name}-${String(i)}`);
    await page.waitForTimeout(gapMs);
  }
}

test('AC-5: an arrow through the chandelier’s rope drops the chandelier', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await openRoom(page);
  await runConsole(page, 'tp 8 0 -4');
  await slowForEvidence(page);
  expect(await ropes(page)).toMatchObject({ 'chandelier-rope': 'holding' });
  await lookAround(page, 4, 3, 0.35, 'chandelier-0-before');
  await shoot(page, { x: -4, y: 8, z: 0 }, 'chandelier-1-aiming');
  await flyOut(page, 4, 3, 0.35);
  await burst(page, 'chandelier-2-falling', 8, 400);
  await expect
    .poll(async () => (await ropes(page))['chandelier-rope'], { timeout: 60_000 })
    .toBe('gone');
  await burst(page, 'chandelier-3-after', 3, 1500);
  expect(problems).toEqual([]);
});

test('AC-4: an arrow through the anvil’s rope drops it on the rope bridge, which snaps', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await openRoom(page);
  await runConsole(page, 'tp -7 0 -4');
  await slowForEvidence(page);
  expect(await ropes(page)).toMatchObject({
    'anvil-rope': 'holding',
    'rope-bridge-rope-1': 'holding',
    'rope-bridge-rope-2': 'holding',
  });
  await lookAround(page, 5, 0, 0.3, 'bridge-0-before');
  await shoot(page, { x: 6, y: 4, z: 0 }, 'bridge-1-aiming');
  await flyOut(page, 5, 0, 0.3);
  await burst(page, 'bridge-2-falling', 10, 500);
  await expect
    .poll(async () => (await ropes(page))['rope-bridge-rope-1'], { timeout: 60_000 })
    .toBe('gone');
  expect(await ropes(page)).toMatchObject({ 'anvil-rope': 'gone', 'rope-bridge-rope-2': 'gone' });
  await burst(page, 'bridge-3-snapped', 4, 700);
  expect(problems).toEqual([]);
});
