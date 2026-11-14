import { expect, test, type Page } from '@playwright/test';
import { holdKey, playerState, stubPointerLock, takeControl } from './helpers/player';
import { seriousAxeViolations } from './helpers/ui';

// mw-e01.2: the title screen is the game's front door, against the production build (Chromium). A
// page with no ?scene=, ?newgame, ?class= or ?menu= boots the game's start scene (game.startScene:
// the slice) with the title menu over it, the sim paused. New Game opens class selection right
// there, with no reload; confirming the Knight puts the knight at the slice's spawn point, playable.
// The page publishes when the title showed, when New Game was pressed and when the class was applied
// on #app[data-front-door] (page-relative ms). The 10 s load budget over those is the perf suite's
// (mw-e41.8, e2e/perf/flows.ts), not asserted here.
//
// CI runners draw at ~3 fps and every Playwright round trip waits on the page's main thread (~1 s
// each, see PR #168), so these specs read the screens in one evaluate (`frontState`), click with
// page.mouse at the centres it reports instead of locator clicks, and wait only on state.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

const W = { code: 'KeyW', key: 'w' };

/** The slice's player-start spawn (docs/design/vertical-slice.md §4). */
const SPAWN = { x: 0, z: -2 };

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

interface FrontState {
  /** data-screen of every open screen, bottom first. */
  readonly screens: readonly string[];
  /** The title menu's buttons by data-action: centre, text, aria-disabled and description. */
  readonly title: Record<
    string,
    Point & { readonly text: string; readonly disabled: boolean; readonly description: string }
  >;
  /** The title's build line. */
  readonly build: string;
  /** The focused element's text. */
  readonly focus: string;
  /** Class cards by class id: centre, checked, locked. */
  readonly cards: Record<string, Point & { readonly checked: boolean; readonly locked: boolean }>;
  /** Class select's Confirm: centre and disabled, null when not open. */
  readonly confirm: (Point & { readonly disabled: boolean }) | null;
  readonly scene: string;
  readonly playerClass: string;
  readonly frontDoor: { titleMs?: number; newGameMs?: number; playableMs?: number } | null;
}

/** Everything the specs check about the title and class select, in one round trip. */
const frontState = (page: Page): Promise<FrontState> =>
  page.evaluate(() => {
    const centre = (el: Element): { x: number; y: number } => {
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const describedBy = (el: Element): string =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    const app = document.querySelector<HTMLElement>('#app');
    const title = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-screen="title"] button[data-action]')].map(
        (el) => [
          el.dataset['action'] ?? '',
          {
            ...centre(el),
            text: el.textContent,
            disabled: el.getAttribute('aria-disabled') === 'true',
            description: describedBy(el),
          },
        ],
      ),
    );
    const cards = Object.fromEntries(
      [
        ...document.querySelectorAll<HTMLElement>('[data-screen="class-select"] [role="radio"]'),
      ].map((el) => [
        el.dataset['class'] ?? '',
        {
          ...centre(el),
          checked: el.getAttribute('aria-checked') === 'true',
          locked: el.getAttribute('aria-disabled') === 'true',
        },
      ]),
    );
    const confirm = document.querySelector<HTMLButtonElement>(
      '[data-screen="class-select"] [data-testid="class-confirm"]',
    );
    const frontDoor = app?.dataset['frontDoor'];
    return {
      screens: [...document.querySelectorAll<HTMLElement>('[data-screen]')].map(
        (el) => el.dataset['screen'] ?? '',
      ),
      title,
      build: document.querySelector('[data-testid="title-build"]')?.textContent ?? '',
      focus: document.activeElement?.textContent ?? '',
      cards,
      confirm: confirm === null ? null : { ...centre(confirm), disabled: confirm.disabled },
      scene: app?.dataset['scene'] ?? '',
      playerClass: app?.dataset['playerClass'] ?? '',
      frontDoor:
        frontDoor === undefined ? null : (JSON.parse(frontDoor) as FrontState['frontDoor']),
    };
  });

/** Opens the front door (`/`) and waits for the title menu. */
async function openTitle(page: Page): Promise<FrontState> {
  await page.goto('/');
  await expect(page.locator('[data-screen="title"]')).toBeVisible({ timeout: 30_000 });
  return frontState(page);
}

/**
 * Waits until the knight is in play: class applied, the class arrival narration (mw-aw1y) read and
 * skipped with Esc, no screen open, the sim stepping.
 */
async function inPlay(page: Page): Promise<FrontState> {
  await expect
    .poll(
      async () => {
        const state = await frontState(page);
        return { playerClass: state.playerClass, screens: state.screens };
      },
      { timeout: 15_000 },
    )
    .toEqual({ playerClass: 'knight', screens: ['class-beat'] });
  const reading = JSON.parse(
    (await page.locator('#app').getAttribute('data-class-beat')) ?? '{}',
  ) as { open: boolean; beat: string };
  expect(reading).toMatchObject({ open: true, beat: 'opening' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await frontState(page)).screens, { timeout: 15_000 }).toEqual([]);
  return frontState(page);
}

/** The player walks: W held from the spawn moves them more than half a metre. */
async function walksFromSpawn(page: Page): Promise<void> {
  const start = await playerState(page);
  expect(Math.hypot(start.position.x - SPAWN.x, start.position.z - SPAWN.z)).toBeLessThan(0.5);
  await takeControl(page);
  const moved = await holdKey(page, W, 30, 5);
  expect(
    Math.hypot(moved.position.x - start.position.x, moved.position.z - start.position.z),
  ).toBeGreaterThan(0.5);
}

test('AC-1: on a clean profile, New Game → Knight → Confirm makes the slice spawn room playable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);

  let state = await openTitle(page);
  expect(state.scene).toBe('slice');
  const newGame = state.title['new-game'];
  if (newGame === undefined) throw new Error('no New Game button');
  await page.mouse.click(newGame.x, newGame.y);

  // Class selection opens over the slice, in the same page: no reload.
  await expect.poll(async () => (await frontState(page)).screens).toEqual(['class-select']);
  state = await frontState(page);
  expect(state.cards['knight']?.locked).toBe(false);
  const knight = state.cards['knight'];
  if (knight === undefined) throw new Error('no Knight card');
  await page.mouse.click(knight.x, knight.y);
  state = await frontState(page);
  expect(state.cards['knight']?.checked).toBe(true);
  if (state.confirm === null || state.confirm.disabled) throw new Error('Confirm is not enabled');
  await page.mouse.click(state.confirm.x, state.confirm.y);

  state = await inPlay(page);
  expect(state.scene).toBe('slice');
  expect(new URL(page.url()).search).toBe('');
  // The front door published its three timestamps (the perf suite turns them into the load budget).
  const { titleMs, newGameMs, playableMs } = state.frontDoor ?? {};
  expect([titleMs, newGameMs, playableMs].map((ms) => typeof ms)).toEqual([
    'number',
    'number',
    'number',
  ]);
  await walksFromSpawn(page);
  expect(problems).toEqual([]);
});

test('AC-2: with no saves the title disables Continue with an accessible "No saves yet" tooltip; the keyboard alone starts the game', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  const state = await openTitle(page);
  expect(state.screens).toEqual(['title']);
  expect(state.title['continue']).toMatchObject({
    text: 'Continue',
    disabled: true,
    description: 'No saves yet',
  });
  expect(state.focus).toBe('New Game');
  expect(state.build).toMatch(/^Build \S+$/);
  // Announced as a button that cannot be pressed, its tooltip as its description.
  const cont = page.locator('[data-screen="title"]').getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await expect(cont).toHaveAccessibleDescription('No saves yet');
  expect(await seriousAxeViolations(page)).toEqual([]);

  // Enter on New Game opens class selection with the Knight focused; Enter highlights it and moves
  // to Confirm; Enter confirms.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await frontState(page)).screens).toEqual(['class-select']);
  expect(await seriousAxeViolations(page)).toEqual([]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await inPlay(page);
  await walksFromSpawn(page);
  expect(problems).toEqual([]);
});
