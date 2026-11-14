// Playwright helpers for specs that drive the testbed player (mw-e00.32). The page publishes the
// player's sim state on #app[data-player] (JSON: tick, feet position, yaw, …) after every sim tick a
// frame shows. CI renders with software GL at a few frames a second, and the frame loop runs at most
// five sim ticks a frame, so wall time says little about how far the sim has got: these helpers are
// paced by the published sim tick and drive input from inside the page, one Playwright round trip per
// action, so a slow runner costs frames rather than round trips or flaky timing.
import { expect, type Page } from '@playwright/test';

/** Mouse look, radians per count (src/content/data/camera/player.json mouseSensitivity). */
export const LOOK_SENSITIVITY = 0.003;

export interface PlayerState {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
  yaw: number;
  pitch: number;
}

/** The player's last published state. */
export async function playerState(page: Page): Promise<PlayerState> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as PlayerState;
}

/**
 * Grants pointer lock as a browser does (headless Chromium refuses it): requestPointerLock locks at
 * once and fires pointerlockchange, exactly as a granted request does. Call before navigating.
 */
export async function stubPointerLock(page: Page): Promise<void> {
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
}

/**
 * Gives the page a game clock that never jumps more than `maxFrameMs` in one frame (mw-y7t). The
 * game advances wall-clock effects (a corpse's 1.2 s dissolve) by the time between frames, so on a
 * runner that draws a frame a second the whole effect can pass between two frames and a spec that
 * samples it sees nothing in the middle, however long it waits. Here performance.now() stands still
 * between frames and moves by the real time since the last frame, at most `maxFrameMs`: a fast
 * machine runs in real time, a slow one in slow motion, and every effect is drawn in steps. The
 * game's sim and effects both read this clock, so a duration measured with it in the page is the
 * game's own time (never more than the real time). Call before navigating; keep `maxFrameMs` under
 * five sim ticks (83 ms) so the loop does not drop steps.
 */
export async function steadyFrameClock(page: Page, maxFrameMs: number): Promise<void> {
  await page.addInitScript((max) => {
    const realNow = performance.now.bind(performance);
    const request = window.requestAnimationFrame.bind(window);
    let game = realNow();
    let lastReal = game;
    performance.now = () => game;
    window.requestAnimationFrame = (callback) =>
      request(() => {
        const real = realNow();
        game += Math.min(real - lastReal, max);
        lastReal = real;
        callback(game);
      });
  }, maxFrameMs);
}

/**
 * Takes pointer lock by clicking the game, as a player does. The game canvas fills the window, so
 * this is a real mouse click at the window's centre, hit-tested by the browser like any click (a
 * HUD element over that point would take it, and the lock would not come). A locator click would
 * add actionability round trips (stable across frames, scroll, hit target) that cost seconds on a
 * runner drawing a few frames a second.
 */
export async function takeControl(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('takeControl needs a fixed viewport');
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  // One evaluate can itself take 4-5 s on such a runner (mw-8qo: a check that answered true after
  // 4.4 s still lost to the default 5 s poll), so the timeout has to outlast a few slow answers.
  await expect
    .poll(() => page.evaluate(() => document.pointerLockElement !== null), { timeout: 30_000 })
    .toBe(true);
}

/**
 * Runs one debug-console line (`tp bed`, `tp -2 0 -0.25`) and hands the game back to the player,
 * all inside one page evaluation. The key-by-key way (Backquote, wait for focus, type, Enter, Escape,
 * wait for the console to close, click, wait for the lock) is about eight Playwright round trips,
 * and on a runner drawing a frame a second each costs 2-3 s (CI traces of mw-ju8.18): twenty
 * seconds a teleport. Here the keys go through the console's own listeners and the waits ride the
 * page's frames, so a slow runner pays for the frames and not for the round trips. Needs
 * `?debug=1` and the pointer-lock stub; the click is retried until the lock lands, because the UI
 * only allows it again a frame after the console closes.
 */
export async function runConsole(page: Page, line: string): Promise<void> {
  await page.evaluate(
    (text) =>
      new Promise<void>((resolve, reject) => {
        const app = document.querySelector<HTMLElement>('#app');
        const started = performance.now();
        const until = (done: () => boolean, then: () => void, what: string): void => {
          const check = (): void => {
            if (done()) then();
            else if (performance.now() - started > 60_000) reject(new Error(`timed out: ${what}`));
            else requestAnimationFrame(check);
          };
          check();
        };
        const key = (target: EventTarget, code: string, name: string): void => {
          target.dispatchEvent(
            new KeyboardEvent('keydown', { code, key: name, bubbles: true, cancelable: true }),
          );
        };
        key(window, 'Backquote', '`');
        const input = () =>
          document.querySelector<HTMLInputElement>('[data-testid="debug-console-input"]');
        until(
          () => input() !== null,
          () => {
            const field = input();
            if (field === null) return;
            field.focus();
            field.value = text;
            key(field, 'Enter', 'Enter');
            key(field, 'Escape', 'Escape');
            until(
              () => app?.dataset['debugConsole'] === 'closed',
              () => {
                const take = (): void => {
                  if (document.pointerLockElement !== null) {
                    resolve();
                    return;
                  }
                  document
                    .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  requestAnimationFrame(() => {
                    if (performance.now() - started > 60_000) reject(new Error('timed out: lock'));
                    else take();
                  });
                };
                take();
              },
              'the console to close',
            );
          },
          'the console to open',
        );
      }),
    line,
  );
}

/**
 * Holds the key `code` (KeyboardEvent.key `key`) through the game's own window listeners for
 * `ticks` sim ticks, lets it go, waits `coast` more ticks and returns the player's state then. All
 * in one page evaluation, paced by the published tick: the frame loop runs at most five ticks a
 * frame, so the key may stay down a few ticks longer than asked.
 */
export async function holdKey(
  page: Page,
  key: { code: string; key: string },
  ticks: number,
  coast = 0,
): Promise<PlayerState> {
  return page.evaluate(
    ([code, name, hold, rest]) =>
      new Promise<PlayerState>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () => JSON.parse(app?.dataset['player'] ?? 'null') as PlayerState;
        const send = (type: string) => {
          window.dispatchEvent(new KeyboardEvent(type, { code, key: name }));
        };
        const start = read().tick;
        let releasedAt: number | undefined;
        send('keydown');
        const watch = () => {
          const state = read();
          if (releasedAt === undefined && state.tick - start >= hold) {
            send('keyup');
            releasedAt = state.tick;
          }
          if (releasedAt !== undefined && state.tick - releasedAt >= rest) {
            resolve(state);
            return;
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }),
    [key.code, key.key, ticks, coast] as const,
  );
}

/** Where the player should look: a yaw (radians, 0 looks along −z) or a point (x, z) on the floor. */
export type LookTarget = number | { x: number; z: number };

export interface TurnResult {
  /** Mouse moves sent. */
  moves: number;
  /** The yaw left to turn when the player stopped, radians (signed, wrapped to ±π). */
  error: number;
}

/**
 * Turns the player until it looks at `target` within `tolerance` radians, with mouse moves through
 * the game's own listeners (pointer lock must be held). A closed loop, independent of frame rate:
 * each move asks for the whole remaining turn (in counts, at the measured sensitivity), then waits
 * for the published tick to pass the one it read, i.e. for the sim to have consumed that move,
 * before reading the new yaw. A point target is re-aimed from the player's position each step.
 * Fails if the player does not converge in `maxMoves` moves.
 */
export async function turnTo(
  page: Page,
  target: LookTarget,
  { tolerance = 0.02, maxMoves = 8 }: { tolerance?: number; maxMoves?: number } = {},
): Promise<TurnResult> {
  const result = await page.evaluate(
    ([aim, sensitivity, tol, limit]) =>
      new Promise<TurnResult & { stalled?: boolean }>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () => JSON.parse(app?.dataset['player'] ?? 'null') as PlayerState;
        const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
        // Yaw 0 looks along −z: the player faces (−sin yaw, −cos yaw).
        const remaining = ({ yaw, position }: PlayerState) =>
          wrap(
            (typeof aim === 'number'
              ? aim
              : Math.atan2(-(aim.x - position.x), -(aim.z - position.z))) - yaw,
          );
        let gain: number = sensitivity;
        let moves = 0;
        const move = () => {
          const before = read();
          const error = remaining(before);
          // Moving the mouse right (positive counts) turns right: yaw falls.
          const counts = Math.round(-error / gain);
          if (Math.abs(error) <= tol || counts === 0 || moves >= limit) {
            resolve({ moves, error });
            return;
          }
          moves += 1;
          window.dispatchEvent(new MouseEvent('mousemove', { movementX: counts, movementY: 0 }));
          const sentAt = performance.now();
          const settle = () => {
            const after = read();
            if (after.tick > before.tick) {
              // Learn the sensitivity actually applied (a settings multiplier scales it).
              const turned = wrap(after.yaw - before.yaw);
              if (Math.abs(counts) >= 20 && Math.abs(turned) > 1e-6) {
                const measured = -turned / counts;
                if (measured > 0) gain = measured;
              }
              move();
            } else if (performance.now() - sentAt > 15_000) {
              // A sanity guard, not a convergence budget: the sim stopped ticking (paused, a menu).
              resolve({ moves, error, stalled: true });
            } else {
              requestAnimationFrame(settle);
            }
          };
          requestAnimationFrame(settle);
        };
        move();
      }),
    [target, LOOK_SENSITIVITY, tolerance, maxMoves] as const,
  );
  expect(result.stalled, 'the sim stopped ticking while turning').toBeUndefined();
  expect(Math.abs(result.error), `turned to within ${String(tolerance)} rad`).toBeLessThanOrEqual(
    tolerance,
  );
  return { moves: result.moves, error: result.error };
}
