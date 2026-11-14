import { expect, test, type Page } from '@playwright/test';
import { focusRing, installVirtualPad, seriousAxeViolations } from './helpers/ui';

// mw-e01.3: the pause menu in the vertical slice, against the production build (Chromium). Esc (or
// P, or the pad's Menu) pauses: Resume, Journal, Settings, Save, Load and Quit to Title over the stopped
// game. Save opens the Save screen over it and Esc comes back; Quit to Title asks first when there
// is progress since the last save, then reloads into the front door (the title over the slice), whose
// Continue loads that save. #app[data-pause] is open or closed.
//
// CI runners draw at ~3 fps and every Playwright round trip waits on the page's main thread (~1 s
// each, see PR #168), so these specs read the screens in one evaluate (`pauseState`), click with
// page.mouse at the centres it reports, press pad buttons for exactly one animation frame (a longer
// hold would auto-repeat a d-pad direction) and wait only on state, never on time.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

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

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PauseState {
  /** data-screen of every open screen, bottom first. */
  readonly screens: readonly string[];
  /** #app[data-pause]. */
  readonly pause: string;
  /** The published sim tick. */
  readonly tick: number;
  /** The focused element's data-action and text, and whether the UI shows the focus ring. */
  readonly focus: { readonly action: string; readonly text: string; readonly ring: boolean };
  /** The pause menu's buttons by action: centre and aria-disabled. */
  readonly buttons: Record<string, Point & { readonly disabled: boolean }>;
  /** The open confirmation: its title and its buttons' centres by label. */
  readonly confirm: { readonly title: string; readonly buttons: Record<string, Point> } | null;
  /** The title menu's Continue: centre and aria-disabled. */
  readonly continue: (Point & { readonly disabled: boolean }) | null;
  /** The Save screen's status line. */
  readonly status: string;
}

/** Everything the specs check, in one round trip. */
const pauseState = (page: Page): Promise<PauseState> =>
  page.evaluate(() => {
    const centre = (el: Element): { x: number; y: number } => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const app = document.querySelector<HTMLElement>('#app');
    const active = document.activeElement as HTMLElement | null;
    const confirm = document.querySelector('[data-screen="confirm"]');
    const cont = document.querySelector('[data-screen="title"] [data-action="continue"]');
    return {
      screens: [...document.querySelectorAll<HTMLElement>('[data-screen]')].map(
        (el) => el.dataset['screen'] ?? '',
      ),
      pause: app?.dataset['pause'] ?? '',
      tick: (JSON.parse(app?.dataset['player'] ?? '{"tick":-1}') as { tick: number }).tick,
      focus: {
        action: active?.dataset['action'] ?? '',
        text: active?.textContent ?? '',
        // The ring is drawn on :focus-visible, or on any focus while the UI is in nav modality.
        ring: active?.matches('.vb-ui :focus-visible, .vb-ui[data-modality="nav"] :focus') === true,
      },
      buttons: Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('[data-screen="pause"] [data-action]')].map(
          (el) => [
            el.dataset['action'] ?? '',
            { ...centre(el), disabled: el.getAttribute('aria-disabled') === 'true' },
          ],
        ),
      ),
      confirm:
        confirm === null
          ? null
          : {
              title: confirm.querySelector('h2')?.textContent ?? '',
              buttons: Object.fromEntries(
                [...confirm.querySelectorAll('button')].map((b) => [b.textContent, centre(b)]),
              ),
            },
      continue:
        cont === null
          ? null
          : { ...centre(cont), disabled: cont.getAttribute('aria-disabled') === 'true' },
      status: document.querySelector('[data-testid="save-slots-status"]')?.textContent ?? '',
    };
  });

/** A new game as the knight, straight into the slice; waits until the sim is stepping. */
async function playSlice(page: Page): Promise<void> {
  await page.goto('/?scene=slice&class=knight');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-pause', 'closed');
}

/** Waits until the published sim tick passes `tick`. */
async function ticksPast(page: Page, tick: number): Promise<void> {
  await expect
    .poll(async () => (await pauseState(page)).tick, { timeout: 15_000 })
    .toBeGreaterThan(tick);
}

/** Presses pad button `index` for exactly one animation frame (the game polls it in that frame). */
async function tapPad(page: Page, index: number): Promise<void> {
  await page.evaluate(
    (button) =>
      new Promise<void>((resolve) => {
        const pad = (window as unknown as { __pad: { buttons: number[] } }).__pad;
        pad.buttons[button] = 1;
        requestAnimationFrame(() => {
          pad.buttons[button] = 0;
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
    index,
  );
}

test('AC-1, AC-3: Esc pauses; after saving and playing on, Quit to Title asks first, then the title shows with no console errors and Continue loads the save', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  await playSlice(page);

  // Esc pauses: the menu opens on Resume and the sim stops.
  await page.keyboard.press('Escape');
  let state = await pauseState(page);
  expect(state.screens).toEqual(['pause']);
  expect(state.pause).toBe('open');
  expect(state.focus.text).toBe('Resume');
  expect(Object.keys(state.buttons)).toEqual([
    'resume',
    'journal',
    'settings',
    'save',
    'load',
    'quit',
  ]);
  expect(state.buttons['save']?.disabled).toBe(false);
  expect(await seriousAxeViolations(page)).toEqual([]);
  const pausedAt = state.tick;

  // Save → the Save screen over the menu; Enter saves into Manual save 1; Esc comes back to the menu.
  const save = state.buttons['save'];
  if (save === undefined) throw new Error('no Save button');
  await page.mouse.click(save.x, save.y);
  await expect
    .poll(async () => (await pauseState(page)).screens, { timeout: 15_000 })
    .toEqual(['pause', 'save-slots']);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await pauseState(page)).status, { timeout: 15_000 })
    .toBe('Saved to Manual save 1');
  await page.keyboard.press('Escape');
  state = await pauseState(page);
  expect(state.screens).toEqual(['pause']);
  expect(state.focus.action).toBe('save');
  // Paused all along: saving runs no sim step.
  expect(state.tick).toBe(pausedAt);

  // Esc resumes; the sim steps on past the save (progress since the last save).
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'closed');
  await ticksPast(page, pausedAt + 10);

  // P pauses too; Quit to Title asks first, with focus on Cancel.
  await page.keyboard.press('KeyP');
  state = await pauseState(page);
  expect(state.screens).toEqual(['pause']);
  const quit = state.buttons['quit'];
  if (quit === undefined) throw new Error('no Quit to Title button');
  await page.mouse.click(quit.x, quit.y);
  state = await pauseState(page);
  expect(state.screens).toEqual(['pause', 'confirm']);
  expect(state.confirm?.title).toBe('Quit to title?');
  expect(state.focus.text).toBe('Cancel');
  expect(await seriousAxeViolations(page)).toEqual([]);
  const yes = state.confirm?.buttons['Quit to Title'];
  if (yes === undefined) throw new Error('no Quit to Title confirmation');
  await page.mouse.click(yes.x, yes.y);

  // The front door: the title over the slice, Continue offering the save.
  await expect(page.locator('[data-screen="title"]')).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).search).toBe('');
  await expect
    .poll(async () => (await pauseState(page)).continue?.disabled, { timeout: 15_000 })
    .toBe(false);
  expect(problems).toEqual([]);

  state = await pauseState(page);
  const cont = state.continue;
  if (cont === null) throw new Error('no Continue');
  await page.mouse.click(cont.x, cont.y);
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-loaded-save', /"slot":"manual-1"/, { timeout: 30_000 });
  await expect(app).toHaveAttribute('data-scene', 'slice');
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('AC-4: the pad’s Menu pauses; the d-pad reaches every option with a visible focus ring; B resumes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await installVirtualPad(page);
  await playSlice(page);

  await tapPad(page, 9); // Menu
  await expect(page.locator('#app')).toHaveAttribute('data-pause', 'open', { timeout: 15_000 });
  const visited: string[] = [(await pauseState(page)).focus.action];
  for (let i = 0; i < 5; i++) {
    await tapPad(page, 13); // d-pad down
    const { focus } = await pauseState(page);
    expect(focus.ring).toBe(true);
    const ring = await focusRing(page);
    expect(ring?.style).not.toBe('none');
    expect(ring?.contrast ?? 0).toBeGreaterThanOrEqual(3);
    visited.push(focus.action);
  }
  expect(visited).toEqual(['resume', 'journal', 'settings', 'save', 'load', 'quit']);
  for (let i = 0; i < 5; i++) await tapPad(page, 12); // d-pad up, back to Resume
  expect((await pauseState(page)).focus.action).toBe('resume');

  // Settings opens the options over the menu; B goes back to the menu, B again resumes.
  await tapPad(page, 13);
  await tapPad(page, 13);
  await tapPad(page, 0); // A on Settings
  expect((await pauseState(page)).screens).toEqual(['pause', 'options']);
  await tapPad(page, 1); // B
  let state = await pauseState(page);
  expect(state.screens).toEqual(['pause']);
  expect(state.focus.action).toBe('settings');
  await tapPad(page, 1);
  state = await pauseState(page);
  expect(state.screens).toEqual([]);
  expect(state.pause).toBe('closed');
  await ticksPast(page, state.tick);
  expect(problems).toEqual([]);
});
