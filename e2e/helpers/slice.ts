// Shared by the slice playthrough specs (mw-e01.9): the recorder (e2e/slice-record.spec.ts) drives the
// slice with a bot through the page's own input listeners while the page logs what its sampler
// receives, tick-stamped (src/game/loop/input-log.ts); the playthrough (e2e/slice-playthrough.spec.ts)
// plays that log back. Everything here is paced by published sim state, never wall time.
import { expect, type Page } from '@playwright/test';
import { holdKey, playerState, turnTo, type PlayerState } from './player';

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

export const W = { code: 'KeyW', key: 'w' };
export const E = { code: 'KeyE', key: 'e' };

/** Sim ticks per metre of walking: 5 m/s at 60 Hz. */
const TICKS_PER_METRE = 12;

/** A new game as the knight in the slice, with the debug console (which the input log needs). */
export const SLICE_URL = '/?scene=slice&class=knight&debug=1';

export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

export async function data<T>(page: Page, key: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T;
}

/** Waits until the slice's player stands in a running sim. */
export async function ready(page: Page): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
}

/** Types `line` into the debug console and closes it again. */
export async function run(page: Page, line: string): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 30_000 });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
}

/**
 * Walks north along x = 0 until the player's z reaches `target`, or until a leg makes no headway, or
 * the slice is complete (its card opens a frame after the pass and takes the keys and the mouse, so
 * how far a leg gets past the pass depends on frame batching: not a reason to turn again).
 * Returns where it stopped.
 */
export async function walkNorth(page: Page, target: number, maxLegs = 12): Promise<PlayerState> {
  let state = await playerState(page);
  for (let leg = 0; leg < maxLegs && state.position.z < target; leg++) {
    if ((await data<Record<string, unknown>>(page, 'facts'))['slice.complete'] === true) break;
    await turnTo(page, { x: 0, z: target + 2 }, { tolerance: 0.03 });
    const ticks = Math.max(5, Math.ceil((target - state.position.z) * TICKS_PER_METRE));
    const before = state.position.z;
    state = await holdKey(page, W, ticks, 8);
    if (state.position.z - before < 0.05) break;
  }
  return state;
}

/** Presses Interact for one tick (the frame loop may hold it a few more). */
export async function interact(page: Page): Promise<void> {
  await holdKey(page, E, 1, 5);
}

export interface FightResult {
  /** Sim ticks the fight took. */
  ticks: number;
  /** Where the Forgotten miner stood when it fell. */
  at: [number, number, number];
}

/**
 * Fights the Forgotten miner with the knight's light chain until it falls: each sim tick turn to it,
 * walk up to sword reach, swing whenever the last swing is done. Runs in the page, one decision per
 * published tick. Fails if the knight dies or the fight outlasts `maxTicks`.
 */
export async function fightSkeleton(page: Page, maxTicks = 3000): Promise<FightResult> {
  const result = await page.evaluate(
    (limit) =>
      new Promise<{ ticks: number; at: [number, number, number]; died: boolean }>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const player = () =>
          JSON.parse(app?.dataset['player'] ?? 'null') as PlayerState & {
            combat: { action: string | null };
          };
        const agent = () =>
          (
            JSON.parse(app?.dataset['ai'] ?? 'null') as {
              agents: { at: [number, number, number] }[];
            }
          ).agents[0];
        const slain = () =>
          (JSON.parse(app?.dataset['facts'] ?? '{}') as Record<string, unknown>)[
            'entity:slice/skeleton.slain'
          ] === true;
        const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
        const key = (type: string) =>
          window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyW', key: 'w' }));
        const mouse = (type: string) => window.dispatchEvent(new MouseEvent(type, { button: 0 }));
        const start = player().tick;
        let walking = false;
        let swinging = false;
        let lastTick = -1;
        let at: [number, number, number] = agent()?.at ?? [0, 0, 0];
        const finish = (died: boolean) => {
          if (walking) key('keyup');
          if (swinging) mouse('mouseup');
          resolve({ ticks: player().tick - start, at, died });
        };
        const frame = () => {
          const now = player();
          const foe = agent();
          if (foe !== undefined) at = foe.at;
          if (slain() || document.querySelector('[data-screen="death"]') !== null) {
            finish(!slain());
            return;
          }
          if (now.tick - start > limit) {
            finish(true);
            return;
          }
          if (swinging) {
            mouse('mouseup');
            swinging = false;
          } else if (now.tick !== lastTick && foe !== undefined) {
            lastTick = now.tick;
            const dx = foe.at[0] - now.position.x;
            const dz = foe.at[2] - now.position.z;
            const dist = Math.hypot(dx, dz);
            const error = wrap(Math.atan2(-dx, -dz) - now.yaw);
            if (Math.abs(error) > 0.05) {
              window.dispatchEvent(
                new MouseEvent('mousemove', {
                  movementX: Math.round(-error / 0.003),
                  movementY: 0,
                }),
              );
            }
            const advance = dist > 1.9;
            if (advance && !walking) key('keydown');
            else if (!advance && walking) key('keyup');
            walking = advance;
            if (dist < 2.4 && now.combat.action === null && Math.abs(error) < 0.3) {
              mouse('mousedown');
              swinging = true;
            }
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    maxTicks,
  );
  expect(result.died, 'the knight won the fight').toBe(false);
  return { ticks: result.ticks, at: result.at };
}
