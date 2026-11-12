import { expect, test, type Page } from '@playwright/test';
import { playerState, stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e10.9: climbing in the vertical hall (?scene=vertical-hall), against the production build
// (Chromium). The hall stands in for the stealth course's vertical hall until that course exists: a
// 5 m rafter platform against the back wall with a ladder up its front face (every class), a rough
// stone face on its west end (the thief) and a hook to tie a rope off. The player runs to the
// ladder, walks into it and holds forward: it climbs, pulls up at the top and stands on the rafter
// platform within 10 s of sim time of the first input. A knight jumping at the rough face is told
// it is too hard. The page publishes the player on #app[data-player] (tick, feet, grounded,
// traversal); the tests only read it and drive keys through the game's own window listeners, paced
// by the published sim tick (CI draws about a frame a second, so wall time says little).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';
/** The sim runs at 60 ticks a second (DEFAULT_TICK_RATE_HZ). */
const HZ = 60;
/** Ceiling for one poll: a slow runner may need many frames to move the sim on. */
const POLL = { timeout: 30_000 };

interface HallPlayer {
  tick: number;
  position: { x: number; y: number; z: number };
  grounded: boolean;
  traversal: string | null;
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

async function hall(page: Page): Promise<HallPlayer> {
  return (await playerState(page)) as unknown as HallPlayer;
}

async function play(page: Page, query = ''): Promise<void> {
  await stubPointerLock(page);
  await page.goto(`/?scene=vertical-hall${query}`);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'vertical-hall', POLL);
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, POLL);
  await takeControl(page);
}

/** A stop condition for `drive`, evaluated on every frame against the published player. */
type Stop =
  | { x: number; dir: 1 | -1 }
  | { z: number; dir: 1 | -1 }
  | { topped: number }
  | { traversal: string };

interface Drive {
  readonly modes: (string | null)[];
  readonly ticks: number;
  readonly reached: boolean;
  readonly state: HallPlayer;
}

/**
 * Holds `keys` until `stop` holds or `maxTicks` sim ticks pass, then lets them go and coasts
 * `coast` ticks. All inside one page evaluation, paced by the published tick; records every
 * traversal mode the player passes through.
 */
async function drive(
  page: Page,
  keys: readonly { code: string; key: string }[],
  stop: Stop,
  maxTicks: number,
  coast = 12,
): Promise<Drive> {
  return page.evaluate(
    ([held, until, limit, rest]) =>
      new Promise<Drive>((resolve) => {
        const app = document.querySelector<HTMLElement>('#app');
        const read = () => JSON.parse(app?.dataset['player'] ?? 'null') as HallPlayer;
        const send = (type: string) => {
          for (const { code, key } of held) {
            window.dispatchEvent(new KeyboardEvent(type, { code, key }));
          }
        };
        const done = (s: HallPlayer): boolean => {
          if ('x' in until) return (s.position.x - until.x) * until.dir >= 0;
          if ('z' in until) return (s.position.z - until.z) * until.dir >= 0;
          if ('topped' in until) {
            return s.traversal === null && s.grounded && s.position.y > until.topped;
          }
          return s.traversal === until.traversal;
        };
        const start = read().tick;
        const modes: (string | null)[] = [];
        let releasedAt: number | undefined;
        let reached = false;
        send('keydown');
        const watch = () => {
          const s = read();
          if (modes.at(-1) !== s.traversal) modes.push(s.traversal);
          if (releasedAt === undefined && (done(s) || s.tick - start >= limit)) {
            reached = done(s);
            send('keyup');
            releasedAt = s.tick;
          }
          if (releasedAt !== undefined && s.tick - releasedAt >= rest) {
            resolve({ modes, ticks: releasedAt - start, reached, state: s });
            return;
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }),
    [keys, stop, maxTicks, coast] as const,
  );
}

const W = { code: 'KeyW', key: 'w' };
const SPACE = { code: 'Space', key: ' ' };

test('AC-5 (mw-e10.9): the player climbs the ladder to the rafter platform within 10 s, with no console errors', async ({
  page,
}) => {
  test.setTimeout(240_000); // CI's ~1 fps runner
  const problems = collectProblems(page);
  await play(page);

  // Line up with the ladder (x = 2): face east, run to it, face the hall's back wall (+z).
  await turnTo(page, { x: 2, z: -2.5 }, { tolerance: 0.03 });
  // The ladder is 0.8 m wide (x 1.6-2.4); the frame loop may run five ticks (0.4 m) past the stop, and
  // the player coasts about 0.25 m, so stopping at its near edge lands inside it on any runner.
  const aligned = await drive(page, [W], { x: 1.6, dir: 1 }, 600);
  expect(aligned.reached, 'ran east to the ladder’s line').toBe(true);
  const settled = await hall(page);
  expect(settled.position.x).toBeGreaterThan(1.55);
  expect(settled.position.x).toBeLessThan(2.35);
  await turnTo(page, { x: settled.position.x, z: 3 }, { tolerance: 0.03 });

  // Hold forward: the ladder is walked into, climbed, and the hands pull up onto the platform.
  const climb = await drive(page, [W], { topped: 4.9 }, 10 * HZ, 0);
  test.info().annotations.push({
    type: 'climb',
    description: JSON.stringify({ modes: climb.modes, ticks: climb.ticks }),
  });
  expect(climb.reached, 'stood on the rafter platform').toBe(true);
  expect(climb.ticks, 'within 10 s of the first input').toBeLessThanOrEqual(10 * HZ);
  expect(climb.modes).toContain('climb');
  expect(climb.modes.at(-1)).toBeNull();
  const top = await hall(page);
  expect(top.grounded).toBe(true);
  expect(top.position.y).toBeCloseTo(5, 1);
  // On the platform: x 0.5-3.5, z 1.375-3.125.
  expect(top.position.x).toBeGreaterThan(0.5);
  expect(top.position.x).toBeLessThan(3.5);
  expect(top.position.z).toBeGreaterThan(1.375);
  expect(top.position.z).toBeLessThan(3.125);
  expect(problems).toEqual([]);
});

test('AC-2 (mw-e10.9): a knight jumping at the rough stone face is told it is too hard to climb', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await play(page, '&class=knight');
  // The rough face is the west end of the platform (x = 0, z 1.45-3.05): go up the hall's west
  // side (x = -1) to z = 2.25, then face east at it.
  await turnTo(page, { x: -1, z: -2.5 }, { tolerance: 0.03 });
  const west = await drive(page, [W], { x: -1, dir: -1 }, 600);
  expect(west.reached).toBe(true);
  await turnTo(page, { x: -1, z: 4 }, { tolerance: 0.03 });
  const north = await drive(page, [W], { z: 2.25, dir: 1 }, 600);
  expect(north.reached).toBe(true);
  await turnTo(page, { x: 3, z: north.state.position.z }, { tolerance: 0.03 });
  // Walk up to the face (the player stops against it), then jump at it and keep pressing: refused.
  const against = await drive(page, [W], { x: -0.4, dir: 1 }, 600, 6);
  expect(against.reached, 'walked up to the rough face').toBe(true);
  await drive(page, [W, SPACE], { traversal: 'climb' }, 60, 0);
  // The page keeps the latest refusal on #app[data-climb-refused] (the greyed prompt itself shows
  // for 2.5 s of draw time, which a slow runner's polling can miss).
  await expect(page.locator('#app')).toHaveAttribute(
    'data-climb-refused',
    /"reason":"too-difficult".*"text":"Too hard for you to climb"/,
    POLL,
  );
  const after = await hall(page);
  expect(after.traversal).not.toBe('climb');
  expect(after.position.y).toBeLessThan(2.5);
  expect(problems).toEqual([]);
});
