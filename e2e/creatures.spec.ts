import { expect, test, type Page } from '@playwright/test';

// mw-e12.4: data-defined creatures in the grey-box scenes, against the production build (Chromium),
// which is a debug build (the console built in), so it carries the frozen fixture creatures and the
// creature pen. The page publishes #app[data-creatures] after every frame: how many creatures the
// sim has, how many have a render proxy, and how many of those are inside the camera's view.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface CreatureReadout {
  count: number;
  drawn: number;
  inView: number;
  kinds: Record<string, number>;
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

async function creatures(page: Page): Promise<CreatureReadout> {
  const json = await page.locator('#app').getAttribute('data-creatures');
  return JSON.parse(json ?? 'null') as CreatureReadout;
}

test('AC-5: the creature pen loads its 4 creature spawns, all drawn and in view, with no console errors', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=creature-pen');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'creature-pen', {
    timeout: 10_000,
  });
  await expect
    .poll(() => creatures(page), { timeout: 10_000 })
    .toEqual({
      count: 4,
      drawn: 4,
      inView: 4,
      kinds: { 'fixture-guard': 1, 'fixture-hound': 2, 'fixture-sentinel': 1 },
    });
  expect(problems).toEqual([]);
});

test('AC-3: `spawn fixture-hound 3` in the testbed console makes 3 drawn hounds; `despawn all` removes them', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 10_000 });
  await expect.poll(() => creatures(page)).toMatchObject({ count: 0, drawn: 0 });
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('spawn fixture-hound 3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('debug-console-log')).toContainText('spawning 3 × fixture-hound');
  await expect
    .poll(() => creatures(page))
    .toMatchObject({ count: 3, drawn: 3, kinds: { 'fixture-hound': 3 } });
  await page.keyboard.type('despawn all');
  await page.keyboard.press('Enter');
  await expect.poll(() => creatures(page)).toMatchObject({ count: 0, drawn: 0 });
  expect(problems).toEqual([]);
});

// mw-1ja AC-2: the Forgotten miner has four looks; ?miner=N pins the Nth, so each loads its own model
// file (and the shared pick) with no console errors. Which look a miner wears is otherwise random per
// game session (src/render/creatures/variant.ts).
for (const look of [1, 2, 3, 4]) {
  test(`AC-2 (mw-1ja): ?miner=${String(look)} draws look ${String(look)} of the Forgotten miner`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page);
    const model = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/assets/model/model-creature-forgotten-miner-0${String(look)}.glb`) &&
        response.ok(),
    );
    await page.goto(`/?scene=testbed&debug=1&miner=${String(look)}`);
    await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
      timeout: 10_000,
    });
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-console-input')).toBeFocused();
    await page.keyboard.type('spawn forgotten-miner 1');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => creatures(page))
      .toMatchObject({ count: 1, drawn: 1, kinds: { 'forgotten-miner': 1 } });
    await model;
    // Give the model a few frames to swap in, so a failure to build it would raise an error here.
    await page.waitForTimeout(1_500);
    expect(problems).toEqual([]);
  });
}

// mw-ju8.35 AC-1: the brute, archer and shield-bearer each load their own model files (a bigger
// skeleton and a maul; a bow; a shield) beside the miner's, with no console errors.
const VARIANT_FILES: Record<string, string[]> = {
  'forgotten-brute': ['model-creature-forgotten-brute-01', 'model-prop-brute-maul-01'],
  'forgotten-archer': ['model-prop-forgotten-bow-01'],
  'forgotten-shield-bearer': ['model-prop-forgotten-shield-01'],
};
for (const [kind, files] of Object.entries(VARIANT_FILES)) {
  test(`AC-1 (mw-ju8.35): ${kind} loads ${files.join(' and ')}`, async ({ page }) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page);
    const loaded = files.map((file) =>
      page.waitForResponse(
        (response) => response.url().includes(`/assets/model/${file}.glb`) && response.ok(),
      ),
    );
    await page.goto('/?scene=testbed&debug=1&miner=1');
    await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
      timeout: 10_000,
    });
    await page.keyboard.press('Backquote');
    await expect(page.getByTestId('debug-console-input')).toBeFocused();
    await page.keyboard.type(`spawn ${kind} 1`);
    await page.keyboard.press('Enter');
    await expect.poll(() => creatures(page)).toMatchObject({ count: 1, drawn: 1 });
    await Promise.all(loaded);
    await page.waitForTimeout(1_500);
    expect(problems).toEqual([]);
  });
}
