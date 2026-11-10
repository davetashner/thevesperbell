import { expect, test } from '@playwright/test';
import { installVirtualPad } from './helpers/ui';
import {
  audit,
  auditTabs,
  collectProblems,
  PAD,
  playSlice,
  POLL,
  screenStack,
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

test('AC-1, AC-2, AC-3, AC-4: every options tab including key bindings, and the confirmation dialog traps focus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await playSlice(page);
  await tapPad(page, PAD.menu);
  await topIs(page, 'pause');
  await page.locator('[data-screen="pause"] [data-action="settings"]').focus();
  await tapPad(page, PAD.a);
  await topIs(page, 'options', ['pause', 'options']);
  const tabs = await auditTabs(page, 'options');
  expect(tabs.length).toBeGreaterThanOrEqual(5);

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
