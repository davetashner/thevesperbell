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

// mw-e31.5: at phone width and 200% text, a full stack of four captions (the most that show) stays
// inside the screen and clear of the locked target's bar, the interact prompt and the rest of the
// HUD. Layout only, so it is deterministic on a slow runner: the lines are built in one evaluate
// from the widget's own markup, and the target bar and prompt (hidden until there is a target or
// something to use) are shown with their longest text for the measurement. Set E2E_CAPTION_SHOTS to
// a directory to also save a screenshot.
test.describe('phone width, 200% text', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mw-e31.5: captions fit the screen and clear the target bar, interact prompt and HUD', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const problems = collectProblems(page);
    await page.addInitScript(
      ([key, version]) => {
        window.localStorage.setItem(
          key as string,
          JSON.stringify({
            version,
            settings: { accessibility: { captions: true, textScale: 2, textBackground: 0.5 } },
          }),
        );
      },
      [SETTINGS_KEY, SETTINGS_VERSION],
    );
    await page.goto('/?scene=combat-sandbox');
    await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('sound-captions')).toBeAttached({ timeout: 60_000 });
    // F3 hides the sandbox's debug frame-data panel (a developer overlay, not part of the HUD).
    await page.keyboard.press('F3');

    const boxes = await page.evaluate(() => {
      const rect = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const captions = document.querySelector<HTMLElement>('[data-testid="sound-captions"]');
      const hud = captions?.parentElement;
      if (captions === null || !hud) return null;
      // Four lines of typical caption text, in the widget's markup.
      captions.hidden = false;
      captions.replaceChildren(
        ...[
          'Attack incoming, ahead left',
          'Alert bark, behind right',
          'Door opening, behind left',
          'Footsteps, ahead right',
        ].map((words) => {
          const line = document.createElement('div');
          line.className = 'vb-caption';
          const arrow = document.createElement('span');
          arrow.className = 'vb-caption-arrow';
          arrow.textContent = '▲';
          const text = document.createElement('span');
          text.className = 'vb-caption-text';
          text.textContent = `[${words}]`;
          line.append(arrow, text);
          return line;
        }),
      );
      // The locked target's bar and the interact prompt, shown with their text for the measurement.
      const shown: Element[] = [];
      for (const [selector, texts] of [
        [
          '.vb-target-bar',
          { '.vb-target-name': 'Forgotten miner', '.vb-target-note': 'Staggered' },
        ],
        ['.vb-interact', {}],
      ] as const) {
        const el = hud.querySelector<HTMLElement>(selector);
        if (!el) continue;
        el.hidden = false;
        el.querySelectorAll<HTMLElement>('[hidden]').forEach((child) => (child.hidden = false));
        for (const [sub, text] of Object.entries(texts)) {
          const t = el.querySelector(sub);
          if (t) t.textContent = text;
        }
        shown.push(el);
      }
      const targetBar = hud.querySelector<HTMLElement>('.vb-target-bar');
      const prompt = hud.querySelector<HTMLElement>('.vb-interact');
      // Every other visible leaf of the HUD (containers such as the combat HUD cover the screen).
      const others = [...hud.querySelectorAll('*')]
        .filter(
          (el) =>
            !captions.contains(el) &&
            !(prompt?.contains(el) ?? false) &&
            !(targetBar?.contains(el) ?? false) &&
            el.children.length === 0 &&
            getComputedStyle(el).display !== 'none' &&
            getComputedStyle(el).visibility !== 'hidden' &&
            el.closest('[hidden]') === null,
        )
        .map((el) => ({
          cls: `${el.closest<HTMLElement>('[data-ui-component]')?.dataset['uiComponent'] ?? '?'} > ${el.className}`,
          ...rect(el),
        }))
        .filter((r) => r.right > r.left && r.bottom > r.top);
      return {
        captions: rect(captions),
        lines: [...captions.querySelectorAll('.vb-caption')].map(rect),
        targetBar: targetBar ? rect(targetBar) : null,
        prompt: prompt ? rect(prompt) : null,
        others,
        width: window.innerWidth,
      };
    });
    expect(boxes).not.toBeNull();
    if (boxes === null) return;
    const shots = process.env['E2E_CAPTION_SHOTS'];
    if (shots !== undefined) await page.screenshot({ path: `${shots}/captions-390-200.png` });

    // The band is clipped: lines that do not fit wrap into a column the clip hides whole.
    expect(boxes.captions.left).toBeGreaterThanOrEqual(0);
    expect(boxes.captions.right).toBeLessThanOrEqual(boxes.width);
    const visible = boxes.lines.filter((line) => line.left < boxes.captions.right);
    expect(visible.length).toBeGreaterThanOrEqual(2);
    for (const line of visible) {
      expect(line.left).toBeGreaterThanOrEqual(boxes.captions.left);
      expect(line.right).toBeLessThanOrEqual(boxes.captions.right + 1);
      expect(line.bottom).toBeLessThanOrEqual(boxes.captions.bottom + 1);
    }
    expect(boxes.targetBar).not.toBeNull();
    expect(boxes.prompt).not.toBeNull();
    if (boxes.targetBar !== null) {
      expect(boxes.targetBar.bottom).toBeLessThanOrEqual(boxes.captions.top);
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
