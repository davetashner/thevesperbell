import { expect, test, type Page } from '@playwright/test';
import { holdKey, stubPointerLock, takeControl } from './helpers/player';

// mw-e02.23: a controllable player (mw-e02.6: an animated grey-box rig) in ?scene=testbed, against the production build
// (Chromium). The page publishes the player's sim state on #app[data-player] (JSON: tick, feet
// position, grounded, traversal, yaw, pitch) after every sim tick a frame shows, and the orbit camera's
// (mw-e02.4) on #app[data-orbit-camera] after every frame it draws; the tests only read them.
//
// Input counts only while the pointer is locked to the canvas, and headless Chromium refuses pointer
// lock, so an init script (helpers/player stubPointerLock) stands in for the browser's lock:
// requestPointerLock locks at once and fires pointerlockchange, exactly as a granted request does. Everything after that (key events,
// the ActionSampler, the sim) is the real game.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The testbed's back wall: z = −5, 0.2 m thick, so its face is at z = −4.9. */
const BACK_WALL_FACE_Z = -4.9;
/** The player's capsule radius (src/content/data/controller/player.json). */
const RADIUS = 0.35;
/** The W key, for helpers/player holdKey. */
const KEY_W = { code: 'KeyW', key: 'w' };
/** The S key, for helpers/player holdKey. */
const KEY_S = { code: 'KeyS', key: 's' };

interface PlayerData {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
  yaw: number;
  pitch: number;
}

/** #app[data-orbit-camera] (mw-e02.4): the orbit camera's running counts and this frame's boom. */
interface OrbitCameraData {
  frames: number;
  clipped: number;
  pulledIn: number;
  boom: number;
  zoom: number;
  position: { x: number; y: number; z: number };
}

async function orbitCamera(page: Page): Promise<OrbitCameraData> {
  const json = await page.locator('#app').getAttribute('data-orbit-camera');
  return JSON.parse(json ?? 'null') as OrbitCameraData;
}

/** Console errors/warnings and uncaught exceptions raised by our own code. */
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

/** Waits until the sim has run `ticks` more ticks. */
async function waitTicks(page: Page, ticks: number): Promise<PlayerData> {
  const from = (await player(page)).tick;
  await expect.poll(async () => (await player(page)).tick).toBeGreaterThanOrEqual(from + ticks);
  return player(page);
}

/** Loads the testbed, waits for the player to settle and takes control (click to lock). */
async function play(page: Page): Promise<void> {
  await stubPointerLock(page);
  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await takeControl(page);
}

test('AC-1: holding W for 1 s moves the player capsule at least 4 m forward, with no console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const before = await player(page);
  // "1 s" is sim time (60 ticks), not wall time: a slow runner can take well over a second to run
  // 60 ticks. So W goes down, and comes up on the first animation frame whose published tick shows
  // 60 ticks since the press. The events are real DOM key events through the game's own listeners;
  // the frame loop runs at most 5 ticks a frame, so W may stay down a few ticks longer.
  const ticksHeld = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const tick = () =>
          (JSON.parse(app?.dataset['player'] ?? '{"tick":0}') as { tick: number }).tick;
        const key = (type: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w' }));
        };
        const pressedAt = tick();
        key('keydown');
        const watch = () => {
          const held = tick() - pressedAt;
          if (held >= 60) {
            key('keyup');
            resolve(held);
          } else {
            requestAnimationFrame(watch);
          }
        };
        requestAnimationFrame(watch);
      }),
  );
  expect(ticksHeld).toBeGreaterThanOrEqual(60);
  expect(ticksHeld).toBeLessThanOrEqual(66);
  const after = await waitTicks(page, 15); // coast to a stop
  // The player starts facing +z (into the room, towards the doorway).
  expect(after.position.z - before.position.z).toBeGreaterThanOrEqual(4);
  expect(Math.abs(after.position.x - before.position.x)).toBeLessThan(0.05);
  expect(problems).toEqual([]);
});

test('AC-2: walking into the testbed wall stops the capsule in front of it', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  // Back towards the wall behind the start, 3.9 m away: 120 sim ticks (2 s of sim time) are more than
  // enough to reach it. Held for ticks, not wall-clock time, so a slow runner costs frames, not the
  // walk (helpers/player holdKey).
  const pressing = await holdKey(page, KEY_S, 120);
  const rest = await waitTicks(page, 10);
  for (const { position } of [pressing, rest]) {
    // Stopped by the wall: the capsule's back is at the wall face, not beyond it.
    expect(position.z).toBeGreaterThan(BACK_WALL_FACE_Z + RADIUS - 0.02);
    expect(position.z).toBeLessThan(BACK_WALL_FACE_Z + RADIUS + 0.05);
  }
  expect(problems).toEqual([]);
});

test('AC-3: Space leaves the ground and lands again within 1 s', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  // As in AC-1, "1 s" is 60 sim ticks. Space is tapped from inside the page and data-player is
  // sampled on every animation frame for 90 ticks after the press, so no frame of the jump is missed
  // however slowly the runner draws.
  const samples = await page.evaluate(
    () =>
      new Promise<{ ticks: number; y: number; grounded: boolean }[]>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () =>
          JSON.parse(app?.dataset['player'] ?? 'null') as {
            tick: number;
            position: { y: number };
            grounded: boolean;
          };
        const pressedAt = read().tick;
        for (const type of ['keydown', 'keyup']) {
          window.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ' }));
        }
        const samples: { ticks: number; y: number; grounded: boolean }[] = [];
        const sample = () => {
          const data = read();
          samples.push({
            ticks: data.tick - pressedAt,
            y: data.position.y,
            grounded: data.grounded,
          });
          if (data.tick - pressedAt < 90) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }),
  );
  const offset = samples.findIndex((s) => !s.grounded);
  expect(offset).toBeGreaterThanOrEqual(0); // left the ground
  const air = samples.slice(offset);
  expect(Math.max(...air.map((s) => s.y))).toBeGreaterThan(0.5);
  const landed = air.find((s) => s.grounded);
  expect(landed).toBeDefined();
  expect(landed?.ticks ?? Infinity).toBeLessThanOrEqual(60);
  expect(problems).toEqual([]);
});

/** #app[data-player-animation] (mw-e02.6): the player body's animation probe. */
interface PlayerAnimationData {
  layers: Record<string, string>;
  clips: Record<string, string | null>;
  history: string[];
  clipHistory: string[];
}

async function playerAnimation(page: Page): Promise<PlayerAnimationData | null> {
  const json = await page.locator('#app').getAttribute('data-player-animation');
  return JSON.parse(json ?? 'null') as PlayerAnimationData | null;
}

// mw-e02.6 AC-4: the bot runs forward, jumps and lands; the placeholder rig follows the sim's
// locomotion state. The page's animation state probe (#app[data-player-animation]) records the base
// layer's states and clips in order; the bot drives from inside the page, paced by the published sim
// tick, so a slow runner takes the same route.
test('AC-4 (mw-e02.6): running and jumping play the rig’s run and jump clips, with no console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  await expect.poll(async () => (await playerAnimation(page))?.layers['base']).toBe('idle');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const tick = () =>
          (JSON.parse(app?.dataset['player'] ?? '{"tick":0}') as { tick: number }).tick;
        const key = (type: string, code: string, k: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code, key: k }));
        };
        const start = tick();
        key('keydown', 'KeyW', 'w');
        let jumped = false;
        const drive = () => {
          const ticks = tick() - start;
          // Run for 30 ticks (full speed), jump, and keep running until well after landing.
          if (!jumped && ticks >= 30) {
            jumped = true;
            key('keydown', 'Space', ' ');
            key('keyup', 'Space', ' ');
          }
          if (ticks >= 90) {
            key('keyup', 'KeyW', 'w');
            resolve();
            return;
          }
          requestAnimationFrame(drive);
        };
        requestAnimationFrame(drive);
      }),
  );
  const probe = await playerAnimation(page);
  if (probe === null) throw new Error('no player animation probe');
  test.info().annotations.push({ type: 'player animation', description: JSON.stringify(probe) });
  // The base layer went idle → move (on the run clip) → jump → fall → land, in that order.
  const order = (items: readonly string[], wanted: readonly string[]) => {
    let next = 0;
    for (const item of items) if (item === wanted[next]) next += 1;
    return next === wanted.length;
  };
  expect(order(probe.history, ['idle', 'move', 'jump', 'fall', 'land'])).toBe(true);
  expect(
    order(probe.clipHistory, ['anim-humanoid-run', 'anim-humanoid-jump', 'anim-humanoid-fall']),
  ).toBe(true);
  // The guard layer (mw-ju8.24) sits between base and action on the humanoid rig.
  expect(Object.keys(probe.layers)).toEqual(['base', 'guard', 'action', 'hit']);
  expect(problems).toEqual([]);
});

// mw-e02.13 AC-6: the testbed's climbing wall is an ivy panel (x −3.9…−3.1, face at z = 3.9) on a
// 3 m block against the room's front wall. The bot sidesteps from the spawn to the ivy's line, walks
// into it and holds forward: it climbs, pulls up at the top and stands on the platform. It drives from
// inside the page, paced by the published sim tick, and records every traversal mode it passes.
test('AC-6 (mw-e02.13): the bot climbs the ivy wall and mantles onto the platform on top, with no console errors', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const route = await page.evaluate(
    () =>
      new Promise<{ modes: (string | null)[]; ticks: number }>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () =>
          JSON.parse(app?.dataset['player'] ?? 'null') as {
            tick: number;
            position: { x: number; y: number; z: number };
            grounded: boolean;
            traversal: string | null;
          };
        const key = (type: string, code: string, k: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code, key: k }));
        };
        const start = read().tick;
        const modes: (string | null)[] = [];
        let phase: 'side' | 'settle' | 'climb' = 'side';
        let settledAt = 0;
        key('keydown', 'KeyD', 'd');
        const drive = () => {
          const data = read();
          const ticks = data.tick - start;
          if (modes.at(-1) !== data.traversal) modes.push(data.traversal);
          if (phase === 'side' && data.position.x <= -3.3) {
            key('keyup', 'KeyD', 'd');
            phase = 'settle';
            settledAt = data.tick;
          } else if (phase === 'settle' && data.tick - settledAt >= 20) {
            key('keydown', 'KeyW', 'w');
            phase = 'climb';
          }
          const done =
            phase === 'climb' && data.traversal === null && data.grounded && data.position.y > 2.9;
          if (done || ticks >= 900) {
            key('keyup', 'KeyD', 'd');
            key('keyup', 'KeyW', 'w');
            resolve({ modes, ticks });
            return;
          }
          requestAnimationFrame(drive);
        };
        requestAnimationFrame(drive);
      }),
  );
  test.info().annotations.push({ type: 'climb route', description: JSON.stringify(route) });
  expect(route.modes).toEqual([null, 'climb', 'mantle', null]);
  const top = await player(page);
  expect(top.grounded).toBe(true);
  expect(top.position.y).toBeCloseTo(3, 1);
  expect(top.position.z).toBeGreaterThan(3.9);
  expect(problems).toEqual([]);
});

test('mw-e04.8: R with no direction held backsteps the player 1.2 m away from the camera', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const before = await player(page);
  await page.evaluate(() => {
    for (const type of ['keydown', 'keyup']) {
      window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyR', key: 'r' }));
    }
  });
  // The backstep lasts 24 ticks; its 1.2 m are covered on ticks 2–7.
  const after = await waitTicks(page, 40);
  // Looking along −sin(yaw), −cos(yaw): the backstep goes the other way.
  const dx = after.position.x - before.position.x;
  const dz = after.position.z - before.position.z;
  expect(Math.hypot(dx, dz)).toBeCloseTo(1.2, 2);
  expect(dx * -Math.sin(before.yaw) + dz * -Math.cos(before.yaw)).toBeCloseTo(-1.2, 2);
  expect(after.grounded).toBe(true);
  expect(problems).toEqual([]);
});

// W is held for a number of sim ticks from inside the page (helpers/player holdKey), not for a span
// of wall time: on a software-rendered runner a few frames a second, 300 ms of wall time can be one
// frame (five ticks) or, with Playwright round trips around it, many more.
test('the debug camera (F2) takes WASD from the player, and hands it back', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  const app = page.locator('#app');
  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'on');
  // Flying releases pointer lock, so the player stays put while the camera moves.
  const { locked, parked } = await page.evaluate(() => ({
    locked: document.pointerLockElement !== null,
    parked: JSON.parse(
      document.querySelector<HTMLElement>('#app')?.dataset['player'] ?? 'null',
    ) as {
      position: { x: number; y: number; z: number };
    },
  }));
  expect(locked).toBe(false);
  // Half a second of sim time with W down flies the camera; the player does not move.
  expect((await holdKey(page, KEY_W, 30, 5)).position).toEqual(parked.position);
  await page.keyboard.press('F2');
  await expect(app).toHaveAttribute('data-debug-camera', 'off');
  await takeControl(page);
  // The same half second walks the player again.
  expect((await holdKey(page, KEY_W, 30, 5)).position.z).toBeGreaterThan(parked.position.z + 0.5);
  expect(problems).toEqual([]);
});

// mw-e02.4 AC-5: the bot walks the narrow corridor (1.8 m wide, pillars narrowing it to 1.35 m) out
// into the arena while swinging the mouse left and right and up and down, so the orbit camera's boom
// keeps swinging into the corridor walls, the pillars and the floor. The page's clipping probe tests
// every frame the orbit camera draws: the sphere around the near plane must overlap no collider
// (the colliders are the drawn greybox geometry). Driving happens inside the page on animation frames,
// paced by the published sim tick, so a slow software-rendered runner walks the same route.
test('AC-5: walking the narrow corridor with pillars, no frame puts the near plane inside geometry, and no console errors', async ({
  page,
}) => {
  // The walk's budget is sim ticks (at most 480), and the frame loop runs at most five ticks a
  // frame, so it can take 96 drawn frames: on a software-rendered CI runner at ~3 frames a second
  // that alone is ~32 s of wall time, beyond the default 30 s test timeout before setup is counted.
  // The timeout covers the tick bound at that frame rate; the walk itself is paced by ticks.
  test.setTimeout(75_000);
  const problems = collectProblems(page);
  await play(page);
  const start = await orbitCamera(page);
  expect(start.clipped).toBe(0);
  const walk = await page.evaluate(
    () =>
      new Promise<{ ticks: number; z: number }>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () =>
          JSON.parse(app?.dataset['player'] ?? 'null') as {
            tick: number;
            position: { z: number };
          };
        const key = (type: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w' }));
        };
        const startTick = read().tick;
        let lastTick = startTick;
        key('keydown');
        const step = () => {
          const { tick, position } = read();
          const ticks = tick - startTick;
          if (position.z > 18 || ticks > 480) {
            key('keyup');
            resolve({ ticks, z: position.z });
            return;
          }
          // A slow sway: about ±25° of yaw and ±15° of pitch, zero on average so the walk stays on
          // course. Mouse counts per elapsed tick, so the sway is the same at any frame rate.
          const elapsed = tick - lastTick;
          lastTick = tick;
          if (elapsed > 0) {
            const movementX = Math.round(12 * Math.cos(ticks / 12) * elapsed);
            const movementY = Math.round(8 * Math.sin(ticks / 9) * elapsed);
            window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY }));
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  // It got through the corridor (z 5 → 15) and into the arena.
  expect(walk.z).toBeGreaterThan(15);
  const camera = await orbitCamera(page);
  test.info().annotations.push({
    type: 'orbit camera',
    description: `${String(walk.ticks)} ticks, ${JSON.stringify(camera)}`,
  });
  expect(camera.frames - start.frames).toBeGreaterThanOrEqual(20);
  // Collision did work on the way (the probe is not passing vacuously)...
  expect(camera.pulledIn).toBeGreaterThan(0);
  // ...and no drawn frame had the near plane inside a wall, pillar or floor.
  expect(camera.clipped).toBe(0);
  expect(problems).toEqual([]);
});

test('mw-e02.4: the mouse wheel zooms the orbit camera between 2 and 6 m', async ({ page }) => {
  const problems = collectProblems(page);
  await play(page);
  expect((await orbitCamera(page)).zoom).toBe(3.5);
  const canvas = page.getByTestId('game-canvas');
  await canvas.dispatchEvent('wheel', { deltaY: -100 });
  await expect.poll(async () => (await orbitCamera(page)).zoom).toBe(3);
  for (let i = 0; i < 12; i++) await canvas.dispatchEvent('wheel', { deltaY: 100 });
  await expect.poll(async () => (await orbitCamera(page)).zoom).toBe(6);
  expect(problems).toEqual([]);
});

// mw-e02.5 AC-6: the testbed's lever stands 2 m ahead of the player start, so the player faces it on
// arrival. The page publishes the player's completed interactions on #app[data-interactions].
test('mw-e02.5 AC-6: facing the lever, Interact pulls it and the prompt shows the bound key', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await play(page);
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt.locator('kbd')).toHaveText('E');
  await expect(prompt).toContainText('Pull lever');
  await expect(prompt).toHaveAttribute('data-available', 'true');
  expect(await page.locator('#app').getAttribute('data-interactions')).toBeNull();
  await page.keyboard.press('KeyE');
  await expect
    .poll(async () => {
      const json = await page.locator('#app').getAttribute('data-interactions');
      return JSON.parse(json ?? '[]') as { verb: string; spawn: string | null }[];
    })
    .toEqual([expect.objectContaining({ verb: 'pull', spawn: 'room-lever' })]);
  expect(problems).toEqual([]);
});
