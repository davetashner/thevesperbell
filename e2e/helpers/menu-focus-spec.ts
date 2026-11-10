// mw-e31.11: shared by the menu-focus specs (e2e/menu-focus-*.spec.ts), one file per menu group so
// each has its own time budget and CI's duration-weighted sharding can spread them. Every menu of the
// real game (production build, Chromium) is operable with the keyboard and a gamepad with a visible
// focus ring: Tab visits every control and wraps inside the screen (the focus trap), focus is never
// lost to the page behind, the ring is drawn and fits, axe finds no serious or critical violation in
// the open screen, and Esc / the pad's B goes back with focus returned to the opener. The debug
// console and debug panels are exempt.
//
// CI renders at about a frame a second and one evaluate can take 4 to 5 s: every action is one
// evaluate, every wait is a 30 s poll on published UI state, and a sweep waits on nothing at all
// (focus moves synchronously), so a menu costs a handful of round trips.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { PAD, screenStack, sweep, sweepProblems, tapPad, type Sweep } from './menu-focus';

export { PAD, screenStack, tapKey, tapPad } from './menu-focus';

const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
const FRAME_LOOP_NOTICE = 'frame loop: ';
export const POLL = { timeout: 30_000 };

/** Console errors and warnings the page logged (driver notices and starved-frame notes excluded). */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** Waits (30 s poll) until the screen stack is `stack`, or just `[id]`. */
export async function topIs(page: Page, id: string, stack?: string[]): Promise<void> {
  await expect.poll(async () => (await screenStack(page)).screens, POLL).toEqual(stack ?? [id]);
}

const TOP_SCREEN = '.vb-menus > [data-screen]:last-child';
/** The shown tab panel of the open screen (a hidden panel is not scanned). */
export const OPEN_TAB_PANEL = `${TOP_SCREEN} [role="tabpanel"]:not([hidden])`;

/**
 * axe-core serious or critical violations inside `scope` (default: the open, top screen). Every
 * rule runs; a big screen can be scanned panel by panel to keep one scan short.
 */
async function screenAxe(page: Page, scope = TOP_SCREEN): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include(scope).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id} (${String(v.impact)}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
}

/** The audit every screen gets: a Tab sweep, then axe (over the whole screen, or just `axeScope`). */
export async function audit(page: Page, label: string, axeScope?: string): Promise<Sweep> {
  const result = await sweep(page);
  expect({ label, problems: sweepProblems(result) }).toEqual({ label, problems: [] });
  expect({ label, axe: await screenAxe(page, axeScope) }).toEqual({ label, axe: [] });
  return result;
}

/** Text of the selected tab of the open screen's tab strip ('' when none). */
export async function selectedTab(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document
        .querySelector('.vb-menus > [data-screen]:last-child [role="tab"][aria-selected="true"]')
        ?.textContent.trim() ?? '',
  );
}

/** Every tab label of the open screen. */
export async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.vb-menus > [data-screen]:last-child [role="tab"]')].map((tab) =>
      tab.textContent.trim(),
    ),
  );
}

/**
 * Audits every tab of the open screen once, moving on with the pad's RB. Each step waits (poll) for
 * the next tab to be the selected one, so a slow frame cannot desynchronise it.
 */
export async function auditTabs(page: Page, label: string): Promise<string[]> {
  const tabs = await tabLabels(page);
  for (const [index, tab] of tabs.entries()) {
    await expect.poll(() => selectedTab(page), POLL).toBe(tab);
    await audit(page, `${label}: ${tab}`);
    if (index < tabs.length - 1) await tapPad(page, PAD.rb);
  }
  return tabs;
}

/** A new game as the knight in the slice, with the debug console. */
export async function playSlice(page: Page): Promise<void> {
  await page.goto('/?scene=slice&class=knight&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', POLL);
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, POLL);
  await expect(app).toHaveAttribute('data-pause', 'closed', POLL);
}
