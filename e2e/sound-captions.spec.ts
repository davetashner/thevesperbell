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

async function openSandbox(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, version, saved]) => {
      window.localStorage.setItem(
        key as string,
        JSON.stringify({ version, settings: { accessibility: saved } }),
      );
    },
    [SETTINGS_KEY, SETTINGS_VERSION, settings],
  );
  await page.goto('/?scene=combat-sandbox');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
    timeout: 30_000,
  });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
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

// mw-e31.5: at phone width and 200% text, with several creatures shouting at once, the captions
// stay inside the screen and clear of the interact prompt and the rest of the HUD. Set
// E2E_CAPTION_SHOTS to a directory to also save a screenshot.
test.describe('phone width, 200% text', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mw-e31.5: captions fit the screen and clear the interact prompt and HUD', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const problems = collectProblems(page);
    await openSandbox(page, { captions: true, textScale: 2, textBackground: 0.5 });
    await typeCommand(page, 'god on', 'god mode on');
    await typeCommand(page, 'spawn forgotten-miner 3', 'spawning 3 × forgotten-miner');
    await page.keyboard.press('Backquote');
    // F3 hides the sandbox's debug frame-data panel (a developer overlay, not part of the HUD).
    await page.keyboard.press('F3');

    const lines = page.getByTestId('sound-captions').locator('.vb-caption');
    await expect.poll(async () => lines.count(), { timeout: 120_000 }).toBeGreaterThanOrEqual(3);
    const shots = process.env['E2E_CAPTION_SHOTS'];
    if (shots !== undefined) await page.screenshot({ path: `${shots}/captions-390-200.png` });

    const boxes = await page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const captions = document.querySelector<HTMLElement>('[data-testid="sound-captions"]');
      const hud = captions?.parentElement;
      if (captions === null || !hud) return null;
      // The interact prompt is hidden until there is something to use: measure where it would sit.
      const prompt = hud.querySelector<HTMLElement>('.vb-interact');
      const wasHidden = prompt?.hidden ?? true;
      if (prompt) prompt.hidden = false;
      const promptRect = prompt ? rect(prompt) : null;
      if (prompt) prompt.hidden = wasHidden;
      // Every visible leaf of the HUD (containers such as the combat HUD cover the whole screen).
      const others = [...hud.querySelectorAll('*')]
        .filter(
          (el) =>
            !captions.contains(el) &&
            !(prompt?.contains(el) ?? false) &&
            el.children.length === 0 &&
            getComputedStyle(el).display !== 'none' &&
            getComputedStyle(el).visibility !== 'hidden' &&
            (el as HTMLElement).closest('[hidden]') === null,
        )
        .map((el) => ({
          cls: `${el.closest<HTMLElement>('[data-ui-component]')?.dataset['uiComponent'] ?? '?'} > ${el.className}`,
          ...rect(el),
        }))
        .filter((r) => r.right > r.left && r.bottom > r.top);
      return {
        captions: rect(captions),
        lines: [...captions.querySelectorAll('.vb-caption')].map(rect),
        prompt: promptRect,
        others,
        width: window.innerWidth,
      };
    });
    expect(boxes).not.toBeNull();
    if (boxes === null) return;
    // The band is clipped: lines that do not fit wrap into a column the clip hides whole.
    expect(boxes.captions.left).toBeGreaterThanOrEqual(0);
    expect(boxes.captions.right).toBeLessThanOrEqual(boxes.width);
    const shown = boxes.lines.filter((line) => line.left < boxes.captions.right);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (const line of shown) {
      expect(line.left).toBeGreaterThanOrEqual(boxes.captions.left);
      expect(line.right).toBeLessThanOrEqual(boxes.captions.right + 1);
      expect(line.bottom).toBeLessThanOrEqual(boxes.captions.bottom + 1);
    }
    if (boxes.prompt !== null) expect(boxes.captions.bottom).toBeLessThanOrEqual(boxes.prompt.top);
    for (const other of boxes.others) {
      const apart =
        other.bottom <= boxes.captions.top ||
        other.top >= boxes.captions.bottom ||
        other.right <= boxes.captions.left ||
        other.left >= boxes.captions.right;
      expect(
        apart,
        `overlaps HUD ${JSON.stringify(other)} captions ${JSON.stringify(boxes.captions)}`,
      ).toBe(true);
    }
    expect(problems).toEqual([]);
  });
});
