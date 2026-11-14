import { expect, test, type Page } from '@playwright/test';
import { installVirtualPad } from './helpers/ui';
import {
  audit,
  collectProblems,
  OPEN_TAB_PANEL,
  PAD,
  playSlice,
  POLL,
  screenStack,
  selectedTab,
  tabLabels,
  tapKey,
  tapPad,
  topIs,
} from './helpers/menu-focus-spec';

// mw-e31.11: the pause menu and what opens from it. One test per group, each with its own budget:
// the Save and Load lists, and every options tab with the confirmation dialog (the focus trap).

test.beforeEach(async ({ page }) => {
  await installVirtualPad(page);
});

test('AC-1, AC-2, AC-3: pause, and its Save and Load lists with Esc back to the opener', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await playSlice(page);
  await tapPad(page, PAD.menu);
  await topIs(page, 'pause');
  await audit(page, 'pause');
  for (const [action, label] of [
    ['save', 'Save'],
    ['load', 'Load'],
  ] as const) {
    await page.locator(`[data-screen="pause"] [data-action="${action}"]`).focus();
    await tapKey(page, 'Enter');
    await topIs(page, 'save-slots', ['pause', 'save-slots']);
    await audit(page, `pause ${label} list`);
    await tapKey(page, 'Escape');
    await topIs(page, 'pause');
    await expect.poll(async () => (await screenStack(page)).focus, POLL).toBe(label);
  }
  await tapPad(page, PAD.b);
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed', POLL);
  expect(problems).toEqual([]);
});

/** Open the pause menu, then Settings, in a fresh slice. */
async function openOptions(page: Page): Promise<void> {
  await playSlice(page);
  await tapPad(page, PAD.menu);
  await topIs(page, 'pause');
  await page.locator('[data-screen="pause"] [data-action="settings"]').focus();
  await tapPad(page, PAD.a);
  await topIs(page, 'options', ['pause', 'options']);
}

// One test per options tab, each with its own budget: a Tab sweep of the tab, and axe over its panel
// (every rule, serious and critical kept). Camera is also scanned over the whole screen, which
// covers the title, the tab strip and Back that the panel scans leave out.
const OPTIONS_TABS = ['Controls', 'Camera', 'Display', 'Audio', 'Accessibility', 'Gameplay'];

for (const [index, tab] of OPTIONS_TABS.entries()) {
  test(`AC-1, AC-2, AC-3: options tab ${tab} (Controls includes key bindings) sweeps clean`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await openOptions(page);
    // RB moves on one tab at a time; each step waits for that tab to be the selected one.
    for (const step of OPTIONS_TABS.slice(0, index + 1)) {
      if (step !== OPTIONS_TABS[0]) await tapPad(page, PAD.rb);
      await expect.poll(() => selectedTab(page), POLL).toBe(step);
    }
    await audit(page, `options: ${tab}`, tab === 'Camera' ? undefined : OPEN_TAB_PANEL);
    expect(problems).toEqual([]);
  });
}

test('AC-3, AC-4: the options tabs are the ones tested, and the confirmation dialog traps focus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await openOptions(page);
  expect(await tabLabels(page)).toEqual(OPTIONS_TABS);

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
  await expect.poll(async () => (await screenStack(page)).focus, POLL).toBe('Reset to defaults');
  await tapPad(page, PAD.b);
  await topIs(page, 'pause');
  await expect.poll(async () => (await screenStack(page)).focus, POLL).toBe('Settings');
  expect(problems).toEqual([]);
});
