import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// mw-e29.12: the world-space awareness indicators in the greybox testbed against the production build
// (Chromium). `?awareness=demo` lines six stand-in creatures up in front of the player, one per alert
// state, and the page publishes what the indicator rules produced on #app[data-awareness] (JSON):
// per indicator its entity, state, shape and fill percent, plus the ghost and ripple counts. The real
// creatures go through the same rules; the last test spawns guards and compares with #app[data-ai].
// Every page must draw with no console errors or warnings.
//
// Set E2E_AWARENESS_SHOTS to a directory to also save a screenshot of each page.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface AwarenessProbe {
  indicators: [number, string, string, number][];
  ghosts: number;
  ripples: number;
  started: number;
  demoNoises: number;
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

async function probe(page: Page): Promise<AwarenessProbe | null> {
  return page.evaluate(() => {
    const json = document.querySelector<HTMLElement>('#app')?.dataset['awareness'];
    return json === undefined ? null : (JSON.parse(json) as AwarenessProbe);
  });
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_AWARENESS_SHOTS'];
  if (dir === undefined) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** Both assists on, as a player would set them in Settings > Gameplay. */
async function assistsOn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'vesper-bell.settings',
      JSON.stringify({
        version: 2,
        settings: { gameplay: { lastKnownMarker: true, noiseRipples: true } },
      }),
    );
  });
}

// Software WebGL renders every pixel on the CPU; this is large enough to judge the shapes by eye.
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('awareness indicators in the testbed', () => {
  test.setTimeout(120_000);

  test('AC-1, AC-2: one indicator per state but Unaware, Suspicious filled 40%, each its own shape', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.goto('/?scene=testbed&awareness=demo');
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 15_000 });
    await expect(app).toHaveAttribute('data-player', /"grounded":true/);
    await expect
      .poll(async () => (await probe(page))?.indicators.length, { timeout: 30_000 })
      .toBe(5);
    const seen = await probe(page);
    expect(seen?.indicators.map(([, state]) => state)).toEqual([
      'suspicious',
      'investigating',
      'searching',
      'alerted',
      'combat',
    ]);
    expect(new Set(seen?.indicators.map(([, , shape]) => shape)).size).toBe(5);
    expect(seen?.indicators[0]?.[3]).toBe(40);
    expect(seen?.indicators.slice(1).every(([, , , fill]) => fill === 100)).toBe(true);
    // The assists are off by default: no ghost, no ripple.
    expect(seen).toMatchObject({ ghosts: 0, ripples: 0, started: 0 });
    // Let the pop-in settle, then look at it.
    await page.waitForTimeout(800);
    await shoot(page, 'states-default');
    expect(problems).toEqual([]);
  });

  test('AC-4: with the assists off (the default) a noise draws no ripple and a lost target leaves no ghost', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    // Off (the default): the demo makes two noises and nothing is drawn.
    await page.goto('/?scene=testbed&awareness=demo');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', {
      timeout: 15_000,
    });
    await expect
      .poll(async () => (await probe(page))?.demoNoises ?? 0, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(2);
    expect(await probe(page)).toMatchObject({ ghosts: 0, ripples: 0, started: 0 });
    expect(problems).toEqual([]);
  });

  test('with the assists on, a noise draws a ripple and the Searching stand-in shows its ghost', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await assistsOn(page);
    await page.goto('/?scene=testbed&awareness=demo');
    await expect(page.locator('#app')).toHaveAttribute('data-scene', 'testbed', {
      timeout: 15_000,
    });
    await expect
      .poll(async () => (await probe(page))?.started ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(0);
    expect((await probe(page))?.ghosts).toBe(1);
    await expect
      .poll(async () => (await probe(page))?.ripples ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await probe(page))?.ripples ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await shoot(page, 'assists-on');
    expect(problems).toEqual([]);
  });

  test('real creatures: the guards’ indicators follow their alert states (#app[data-ai])', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = collectProblems(page);
    await page.goto('/?scene=testbed&debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
      timeout: 30_000,
    });
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-console-input')).toBeFocused();
    for (const line of ['god on', 'spawn fixture-guard 2']) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('Backquote');
    // Once a guard has noticed the player, its indicator shows the state the AI reports.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const app = document.querySelector<HTMLElement>('#app');
            const ai = JSON.parse(app?.dataset['ai'] ?? '{"agents":[]}') as {
              agents: { entity: number; state: string }[];
            };
            const fx = JSON.parse(app?.dataset['awareness'] ?? '{"indicators":[]}') as {
              indicators: [number, string, string, number][];
            };
            return ai.agents.filter(
              (a) =>
                a.state !== 'unaware' &&
                fx.indicators.some(([e, state]) => e === a.entity && state === a.state),
            ).length;
          }),
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);
    await shoot(page, 'real-guards');
    expect(problems).toEqual([]);
  });
});
