import { expect, test, type Page } from '@playwright/test';

// mw-e02.20 AC-6: the greybox testbed's two animation demo characters — the grey-box humanoid and the
// four-legged beast — loop idle → move → attack → hit-react through sim state (a mover, the action
// timeline's requestMove and interruptAction), and the shared animation runtime follows. The page
// publishes the dev state probe on #app[data-animation] (JSON: per rig, each layer's state and the
// states entered, oldest first); the test only reads it. Against the production build (Chromium).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

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
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto('/?scene=testbed');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-animation', /greybox-beast/);
  expect(Object.keys(await probe(page)).sort()).toEqual([...RIGS].sort());

  // One cycle is about 4.3 s of sim time; allow a slow runner several times that.
  for (const rig of RIGS) {
    await expect
      .poll(async () => cycleProgress((await probe(page))[rig]?.history ?? []), { timeout: 30_000 })
      .toBe(CYCLE.length);
  }
  const final = await probe(page);
  // The humanoid rig also has the upper-body guard layer (shield raise/hold/lower, mw-ju8.24).
  const layers: Record<string, string[]> = {
    'greybox-humanoid': ['base', 'guard', 'action', 'hit'],
    'greybox-beast': ['base', 'action', 'hit'],
  };
  for (const rig of RIGS) {
    expect(Object.keys(final[rig]?.layers ?? {})).toEqual(layers[rig]);
  }
  expect(problems).toEqual([]);
});
