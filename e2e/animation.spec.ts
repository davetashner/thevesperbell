import { expect, test, type Page } from '@playwright/test';

// mw-e02.20 AC-6: the greybox testbed's two animation demo characters — the grey-box humanoid and the
// four-legged beast — loop idle → move → attack → hit-react through sim state (a mover, the action
// timeline's requestMove and interruptAction), and the shared animation runtime follows. The page
// publishes the dev state probe on #app[data-animation] (JSON: per rig, each layer's state and the
// states entered, oldest first); the test only reads it. Against the production build (Chromium).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

const RIGS = ['greybox-humanoid', 'greybox-beast'] as const;
const CYCLE = ['idle', 'move', 'attack', 'hit-react'] as const;

interface Probe {
  layers: Record<string, string>;
  history: string[];
}

async function probe(page: Page): Promise<Record<string, Probe>> {
  const json = await page.locator('#app').getAttribute('data-animation');
  return JSON.parse(json ?? '{}') as Record<string, Probe>;
}

/** How far into CYCLE `history` has got, taking the states in order (a subsequence match). */
function cycleProgress(history: readonly string[]): number {
  let next = 0;
  for (const state of history) if (state === CYCLE[next]) next += 1;
  return next;
}

test('AC-6: each rig reports idle → move → attack → hit-react in order, with no console errors', async ({
  page,
}) => {
  // The cycle is ~4.3 s of sim time (~7 s wall locally), but the frame loop runs at most 5 sim ticks
  // per frame, so it needs >= ~60 frames. On a loaded software-GL runner frames can take seconds, which
  // blew the default 30 s (PR #525, three retries). The sim-state history is already a recorded log, so
  // a long wait is the only cost; give it room and render a small canvas to make frames cheaper.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 240 });
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-animation', /greybox-beast/);
  expect(Object.keys(await probe(page)).sort()).toEqual([...RIGS].sort());

  // Both rigs advance together, so the first poll absorbs nearly all the wait.
  for (const rig of RIGS) {
    await expect
      .poll(async () => cycleProgress((await probe(page))[rig]?.history ?? []), { timeout: 90_000 })
      .toBe(CYCLE.length);
  }
  const final = await probe(page);
  // The humanoid rig also has the upper-body guard layer (shield raise/hold/lower, mw-ju8.24).
  const layers: Record<string, string[]> = {
    'greybox-humanoid': ['base', 'carry', 'guard', 'action', 'hit'],
    'greybox-beast': ['base', 'action', 'hit'],
  };
  for (const rig of RIGS) {
    expect(Object.keys(final[rig]?.layers ?? {})).toEqual(layers[rig]);
  }
  expect(problems).toEqual([]);
});
