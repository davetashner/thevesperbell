import { test, expect } from '@playwright/test';
import { installVirtualPad, openScreen, openUiPage } from './helpers/ui';
import {
  audit,
  auditTabs,
  collectProblems,
  PAD,
  POLL,
  screenStack,
  tapKey,
  tapPad,
  topIs,
} from './helpers/menu-focus-spec';

// mw-e31.11: the front door (title, Load, class selection) and the narrow, 200% text layouts. See
// helpers/menu-focus-spec.ts for what every screen is checked for.

test.beforeEach(async ({ page }) => {
  await installVirtualPad(page);
});

test('AC-1, AC-2, AC-3, AC-4: title, Load and class selection; B backs out of each, to the control that opened it', async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  await expect.poll(async () => (await screenStack(page)).focus, POLL).toBe('Load');

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
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openUiPage(page, '/testbed/ui.html?scale=2');
  for (const id of ['options', 'inventory', 'container']) {
    await openScreen(page, id);
    if (id === 'options') await auditTabs(page, '390px 200%: options');
    else await audit(page, `390px 200%: ${id}`);
    await tapPad(page, PAD.b);
    await topIs(page, id, []);
  }
});
