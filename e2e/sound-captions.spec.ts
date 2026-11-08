import { expect, test, type Page } from '@playwright/test';

// mw-e28.14 AC-5: sound captions against the production build (Chromium), which is a debug build
// (the console is built in). With captions switched on in the saved settings, a Forgotten miner
// spawned in the combat sandbox winds up a telegraphed attack at the player, and the caption for it
// ("[Attack incoming, ahead]") must be on screen within 100 ms. The page publishes #app[data-captions]
// every frame it changes: captions shown and how long the latest new caption waited between the sim
// event reaching the caption layer and the frame that handed it to the widget, so the figure is the
// game's own latency, not the runner's round trips. Audio stays locked (no gesture): captions are
// for players who cannot rely on sound.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';
const SETTINGS_KEY = 'vesper-bell.settings';
const SETTINGS_VERSION = 2;

interface CaptionReadout {
  shown: number;
  latencyMs: number | null;
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

async function readout(page: Page): Promise<CaptionReadout | null> {
  return page.evaluate(() => {
    const json = document.querySelector<HTMLElement>('#app')?.dataset['captions'];
    return json === undefined ? null : (JSON.parse(json) as CaptionReadout);
  });
}

async function typeCommand(page: Page, line: string, echo: string): Promise<void> {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('debug-console-log')).toContainText(echo);
}

test('AC-5: with captions on, a creature telegraph in the sandbox shows its caption within 100 ms', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = collectProblems(page);
  await page.addInitScript(
    ([key, version]) => {
      window.localStorage.setItem(
        key as string,
        JSON.stringify({ version, settings: { accessibility: { captions: true } } }),
      );
    },
    [SETTINGS_KEY, SETTINGS_VERSION],
  );
  await page.goto('/?scene=combat-sandbox');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
    timeout: 30_000,
  });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await typeCommand(page, 'god on', 'god mode on');
  await typeCommand(page, 'spawn forgotten-miner', 'spawning 1 × forgotten-miner');

  const captions = page.getByTestId('sound-captions');
  await expect(captions).toHaveAttribute('aria-live', 'polite');
  await expect(captions.locator('.vb-caption-text').first()).toHaveText(
    /^\[Attack incoming, [a-z ]+\]$/,
    { timeout: 120_000 },
  );
  const seen = await readout(page);
  expect(seen?.shown).toBeGreaterThan(0);
  expect(seen?.latencyMs).not.toBeNull();
  expect(seen?.latencyMs).toBeLessThanOrEqual(100);
  expect(problems).toEqual([]);
});
