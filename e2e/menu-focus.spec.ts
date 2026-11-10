import { expect, test, type Page } from '@playwright/test';
import { runConsole, stubPointerLock, turnTo } from './helpers/player';
import { installVirtualPad, openScreen, openUiPage, seriousAxeViolations } from './helpers/ui';
import {
  PAD,
  screenStack,
  sweep,
  sweepProblems,
  tapKey,
  tapPad,
  type Sweep,
} from './helpers/menu-focus';

// mw-e31.11: every menu of the real game (production build, Chromium) is operable with the keyboard
// and a gamepad with a visible focus ring. For each screen: Tab visits every control and wraps inside
// it (the focus trap), focus is never lost to the page behind, the ring is drawn and fits, axe finds
// no serious or critical violation, and Esc / the pad's B goes back to the previous screen with focus
// returned to the control that opened it. The debug console and debug panels are exempt.
//
// CI renders at about a frame a second and one evaluate can take 4 to 5 s: every action is one
// evaluate, and every wait is a poll on screen state, never on time.

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const FRAME_LOOP_NOTICE = 'frame loop: ';
const POLL = { timeout: 30_000 };

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

/** Waits until the top screen is `id`. */
async function topIs(page: Page, id: string, stack?: string[]): Promise<void> {
  await expect.poll(async () => (await screenStack(page)).screens, POLL).toEqual(stack ?? [id]);
}

/** The audit every screen gets: sweep, axe. */
async function audit(page: Page, label: string): Promise<Sweep> {
  const result = await sweep(page);
  expect({ label, problems: sweepProblems(result) }).toEqual({ label, problems: [] });
  expect({ label, axe: await seriousAxeViolations(page) }).toEqual({ label, axe: [] });
  return result;
}

/** Presses `step` with the keyboard or the pad, as the test asks. */
async function back(page: Page, device: 'keyboard' | 'pad'): Promise<void> {
  if (device === 'pad') await tapPad(page, PAD.b);
  else await tapKey(page, 'Escape');
}

async function playSlice(page: Page): Promise<void> {
  await page.goto('/?scene=slice&class=knight&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
}

test.describe('menu focus', () => {
  test.beforeEach(async ({ page }) => {
    await installVirtualPad(page);
  });

  test('AC-1, AC-2, AC-3, AC-4: title, Load and class selection; B backs out of each, to the control that opened it', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = collectProblems(page);
    await page.goto('/?scene=testbed&menu=title&allclasses');
    await topIs(page, 'title');
    await audit(page, 'title');
    // Real key presses take the same path: Tab and the arrows move within the screen, never out.
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Tab']) {
      await page.keyboard.press(key);
      expect((await screenStack(page)).inTop, key).toBe(true);
    }

    // Load opens over the title; B returns to the title with Load focused again.
    await page.getByRole('button', { name: 'Load' }).focus();
    await tapPad(page, PAD.a);
    await topIs(page, 'save-slots', ['title', 'save-slots']);
    await audit(page, 'load');
    await tapPad(page, PAD.b);
    await topIs(page, 'title');
    expect((await screenStack(page)).focus).toBe('Load');

    // New Game replaces the title with class selection; B (and Esc) go back to the title.
    await page.getByRole('button', { name: 'New Game' }).focus();
    await tapPad(page, PAD.a);
    await topIs(page, 'class-select');
    await audit(page, 'class selection');
    await tapPad(page, PAD.b);
    await topIs(page, 'title');
    await page.getByRole('button', { name: 'New Game' }).focus();
    await tapKey(page, 'Enter');
    await topIs(page, 'class-select');
    await tapKey(page, 'Escape');
    await topIs(page, 'title');
    expect(problems).toEqual([]);
  });

  test('AC-1, AC-2, AC-3, AC-4: at 390 px and 200% text the options, inventory and container still sweep clean, and B closes each', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openUiPage(page, '/testbed/ui.html?scale=2');
    for (const id of ['options', 'inventory', 'container']) {
      await openScreen(page, id);
      if (id === 'options') {
        const tabs = await page.locator('[data-screen="options"] [role="tab"]').allTextContents();
        for (const tab of tabs) {
          await expect(
            page.locator('[data-screen="options"] [role="tab"][aria-selected="true"]'),
          ).toHaveText(tab, POLL);
          await audit(page, `390px 200%: options ${tab}`);
          await tapPad(page, PAD.rb);
        }
      } else {
        await audit(page, `390px 200%: ${id}`);
      }
      await tapPad(page, PAD.b);
      await expect.poll(async () => (await screenStack(page)).screens, POLL).toEqual([]);
    }
  });

  test('AC-1, AC-2, AC-3, AC-4: pause, every options tab, key bindings, Save, Load and the quit confirmation', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page);
    await playSlice(page);
    await tapPad(page, PAD.menu);
    await topIs(page, 'pause');
    await audit(page, 'pause');

    // Settings: every tab is swept; E (RB) moves to the next tab.
    await page.locator('[data-screen="pause"] [data-action="settings"]').focus();
    await tapPad(page, PAD.a);
    await topIs(page, 'options', ['pause', 'options']);
    const tabs = await page.locator('[data-screen="options"] [role="tab"]').allTextContents();
    expect(tabs.length).toBeGreaterThanOrEqual(5);
    for (const tab of tabs) {
      await expect(
        page.locator('[data-screen="options"] [role="tab"][aria-selected="true"]'),
      ).toHaveText(tab, POLL);
      await audit(page, `options: ${tab}`);
      await tapPad(page, PAD.rb);
    }
    // A modal confirmation traps focus; B answers No and focus returns to the button that asked.
    await page
      .locator('[data-screen="options"] [role="tabpanel"]:not([hidden]) button', {
        hasText: 'Reset to defaults',
      })
      .focus();
    await tapPad(page, PAD.a);
    await topIs(page, 'confirm', ['pause', 'options', 'confirm']);
    const trap = await audit(page, 'confirmation');
    expect(trap.controls).toHaveLength(2);
    await tapPad(page, PAD.b);
    await topIs(page, 'options', ['pause', 'options']);
    expect((await screenStack(page)).focus).toBe('Reset to defaults');
    await tapPad(page, PAD.b);
    await topIs(page, 'pause');
    expect((await screenStack(page)).focus).toBe('Settings');

    // Save and Load slot lists over the pause menu; Esc returns to the opener each time.
    for (const [action, label] of [
      ['save', 'Save'],
      ['load', 'Load'],
    ] as const) {
      await page.locator(`[data-screen="pause"] [data-action="${action}"]`).focus();
      await tapKey(page, 'Enter');
      await topIs(page, 'save-slots', ['pause', 'save-slots']);
      await audit(page, `pause ${label} list`);
      await back(page, 'keyboard');
      await topIs(page, 'pause');
      expect((await screenStack(page)).focus).toBe(label);
    }

    await tapPad(page, PAD.b);
    await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed', POLL);
    expect(problems).toEqual([]);
  });

  test('AC-1, AC-2, AC-3: the inventory, its action menu and the container window', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page);
    await stubPointerLock(page);
    await page.goto('/?scene=testbed&debug=1');
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
    await runConsole(page, 'give healing-draught 3');
    await runConsole(page, 'give lockpicks 2');
    await page.keyboard.press('KeyI');
    await expect(app).toHaveAttribute('data-inventory', 'open', POLL);
    await audit(page, 'inventory');
    // The action menu opens over it; B closes it and focus is back on the item.
    await tapPad(page, PAD.a);
    await topIs(page, 'inventory-actions', ['inventory', 'inventory-actions']);
    await audit(page, 'inventory action menu');
    await tapPad(page, PAD.b);
    await topIs(page, 'inventory');
    expect((await screenStack(page)).inTop).toBe(true);
    await tapPad(page, PAD.b);
    await expect(app).toHaveAttribute('data-inventory', 'closed', POLL);

    // The chest: stand before it and Interact.
    await runConsole(page, 'tp -2 0 -0.2');
    await turnTo(page, { x: -2, z: 1 });
    await page.keyboard.press('KeyE');
    await expect(app).toHaveAttribute('data-container-window', 'open', POLL);
    await audit(page, 'container');
    await tapPad(page, PAD.b);
    await expect(app).toHaveAttribute('data-container-window', 'closed', POLL);
    expect(problems).toEqual([]);
  });

  test('AC-1, AC-2, AC-3: the shop, every tab, and B closes it', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page);
    await stubPointerLock(page);
    await page.goto('/?scene=shop-room&debug=1');
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
    await runConsole(page, 'tp -2 0 -0.2');
    await turnTo(page, { x: -2, z: 1 });
    await page.keyboard.press('KeyE');
    await expect(app).toHaveAttribute('data-shop', /"open":true/, POLL);
    const tabs = await page.locator('[data-screen="shop"] [role="tab"]').allTextContents();
    expect(tabs).toEqual(['Buy', 'Sell', 'Buyback', 'Services']);
    for (const tab of tabs) {
      await expect(
        page.locator('[data-screen="shop"] [role="tab"][aria-selected="true"]'),
      ).toHaveText(tab, POLL);
      await audit(page, `shop: ${tab}`);
      await tapPad(page, PAD.rb);
    }
    await tapPad(page, PAD.b);
    await expect(app).toHaveAttribute('data-shop', /"open":false/, POLL);
    expect(problems).toEqual([]);
  });

  test('AC-1, AC-2, AC-3: the death screen and its load list', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = collectProblems(page);
    await stubPointerLock(page);
    await page.goto('/?scene=slice&class=knight&debug=1');
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 30_000 });
    await runConsole(page, 'save manual-1');
    await runConsole(page, 'kill');
    await topIs(page, 'death');
    await audit(page, 'death');
    await page.locator('[data-screen="death"] button', { hasText: 'Load…' }).focus();
    await tapPad(page, PAD.a);
    await expect
      .poll(() => page.locator('[data-screen="death"] [data-save]').count(), POLL)
      .toBeGreaterThan(0);
    await audit(page, 'death: load list');
    await tapPad(page, PAD.b);
    await expect(page.locator('[data-screen="death"] [data-save]')).toBeHidden(POLL);
    expect(problems).toEqual([]);
  });
});
