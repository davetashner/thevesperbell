import { expect, test, type Page } from '@playwright/test';
import { seriousAxeViolations } from './helpers/ui';

// mw-e19.5: a new game in ?scene=testbed against the production build (Chromium). `?newgame` opens
// the class selection screen over the greybox testbed (the sim paused behind it); the keyboard picks a
// class, and the page publishes the sim's player.class on #app[data-player-class] while the kit panel
// in the HUD lists what the player carries.
//
// mw-e01.15: the game configuration (src/content/data/game/game.json) makes only the Knight playable in
// m1; the other cards are locked. The per-class tests of mw-e19.5 unlock every class with
// ?allclasses, which a build with the debug console honours (the e2e build has it).
//
// CI runners draw at ~3 fps and every Playwright round trip waits on the page's main thread (~1 s
// each, see PR #168), so these specs read the screen in one evaluate (`selectState`) instead of a
// locator assertion per fact, and click cards with page.mouse at the centres it reports instead of
// locator clicks. The UI handles keydown synchronously, so a state read after a press needs no poll.

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

interface CardState {
  readonly id: string;
  readonly checked: boolean;
  readonly locked: boolean;
  /** The lock badge is rendered and visible. */
  readonly badge: boolean;
  /** The card's accessible description (its aria-describedby text). */
  readonly description: string;
  /** The card's centre in viewport pixels, for page.mouse. */
  readonly x: number;
  readonly y: number;
}

interface SelectState {
  /** The class select screen is open. */
  readonly open: boolean;
  readonly cards: readonly CardState[];
  /** The class of the card holding focus, if any. */
  readonly focused: string | null;
  readonly confirmDisabled: boolean;
  readonly confirmFocused: boolean;
  /** Confirm's accessible description (its aria-describedby text), "" when none. */
  readonly confirmDescription: string;
  /** #app[data-player-class]: the sim's player.class, "" until a class is applied. */
  readonly playerClass: string;
  /** The HUD kit panel: class name and item lines, null when absent. */
  readonly kit: { readonly name: string; readonly items: readonly string[] } | null;
}

/** Everything the specs check about the screen and the HUD, in one round trip. */
const selectState = (page: Page): Promise<SelectState> =>
  page.evaluate(() => {
    const describedBy = (el: Element | null): string =>
      (el?.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    const screen = document.querySelector('[data-screen="class-select"]');
    const cards = [...(screen?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].map(
      (card) => {
        const box = card.getBoundingClientRect();
        const badge = card.querySelector<HTMLElement>('[data-part="lock"]');
        return {
          id: card.dataset['class'] ?? '',
          checked: card.getAttribute('aria-checked') === 'true',
          locked: card.hasAttribute('data-locked') && card.getAttribute('aria-disabled') === 'true',
          badge: badge?.checkVisibility() === true,
          description: describedBy(card),
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      },
    );
    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="class-confirm"]');
    const kit = document.querySelector('[data-testid="class-kit"]');
    return {
      open: screen !== null,
      cards,
      focused: (document.activeElement as HTMLElement | null)?.dataset['class'] ?? null,
      confirmDisabled: confirm?.disabled ?? true,
      confirmFocused: confirm !== null && document.activeElement === confirm,
      confirmDescription: describedBy(confirm),
      playerClass: document.querySelector<HTMLElement>('#app')?.dataset['playerClass'] ?? '',
      kit:
        kit === null
          ? null
          : {
              name: kit.querySelector('[data-part="class"]')?.textContent ?? '',
              items: [...kit.querySelectorAll('li')].map((li) => li.textContent),
            },
    };
  });

/** The card `id` in `state`; fails the test if it is missing. */
function cardOf(state: SelectState, id: string): CardState {
  const card = state.cards.find((c) => c.id === id);
  if (card === undefined) throw new Error(`no ${id} card`);
  return card;
}

const REASON = 'Not playable in this build yet';

test('AC-3: selecting Sorcerer and entering the testbed gives the sorcerer kit in the HUD', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&newgame&allclasses');
  const app = page.locator('#app');
  await expect(page.locator('[data-screen="class-select"]')).toBeVisible({ timeout: 10_000 });
  const opened = await selectState(page);
  expect(opened.cards.map(({ id }) => id)).toEqual(['knight', 'archer', 'sorcerer', 'thief']);
  expect(opened.cards.some(({ locked }) => locked)).toBe(false);
  // Keyboard only. Focus starts on the first card; nothing is highlighted, so Confirm is disabled.
  expect(opened.focused).toBe('knight');
  expect(opened.confirmDisabled).toBe(true);
  expect(opened.playerClass).toBe('');
  expect(await seriousAxeViolations(page)).toEqual([]);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const highlighted = await selectState(page);
  expect(highlighted.focused).toBeNull();
  expect(cardOf(highlighted, 'sorcerer').checked).toBe(true);
  expect(highlighted.confirmDisabled).toBe(false);
  expect(highlighted.confirmFocused).toBe(true);
  await page.keyboard.press('Enter');

  // The class arrival narration (mw-aw1y) opens after the class is applied; Esc skips it.
  await expect(page.locator('[data-screen="class-beat"]')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-screen]')).toHaveCount(0);

  // In the testbed: the screen is gone, the sim runs, and the player is a sorcerer with its kit.
  const entered = await selectState(page);
  expect(entered.open).toBe(false);
  expect(entered.playerClass).toBe('sorcerer');
  expect(entered.kit).toEqual({
    name: 'Sorcerer',
    items: ['Ash staff (equipped)', 'Travelling robe (equipped)', 'Mana draught ×2'],
  });
  await expect(app).toHaveAttribute('data-ui-capture', 'false');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(page.getByTestId('class-kit').locator('[data-part="gold"]')).toHaveText('30 gold');
  expect(problems).toEqual([]);
});

test('?class=thief applies the thief at boot, and the default boot has no class', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&class=thief&allclasses');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-player-class', 'thief', { timeout: 5_000 });
  await expect(page.locator('[data-screen="class-select"]')).toHaveCount(0);
  await expect(page.getByTestId('class-kit').locator('li')).toHaveText([
    'Hunting knife (equipped)',
    'Leather jerkin (equipped)',
    'Lockpicks (equipped)',
  ]);

  await page.goto('/?scene=testbed');
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 5_000 });
  await expect(app).not.toHaveAttribute('data-player-class', /./);
  await expect(page.getByTestId('class-kit')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('AC-5: a new game offers only the Knight; locked cards cannot be confirmed and the run starts as the knight', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&newgame');
  await expect(page.locator('[data-screen="class-select"]')).toBeVisible({ timeout: 10_000 });

  // AC-1 in the browser: four cards, Knight focused, the other three locked with a badge and the
  // reason as their accessible description.
  const opened = await selectState(page);
  expect(
    opened.cards.map(({ id, locked, badge, description }) => [id, locked, badge, description]),
  ).toEqual([
    ['knight', false, false, ''],
    ['archer', true, true, REASON],
    ['sorcerer', true, true, REASON],
    ['thief', true, true, REASON],
  ]);
  expect(opened.focused).toBe('knight');
  expect(await seriousAxeViolations(page)).toEqual([]);

  // AC-2: a locked card takes focus, but neither Enter nor a mouse click picks it, and Confirm is
  // disabled with the same reason.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const pressed = await selectState(page);
  expect(pressed.focused).toBe('sorcerer');
  expect(pressed.cards.filter(({ checked }) => checked)).toEqual([]);
  expect(pressed.confirmDisabled).toBe(true);
  expect(pressed.confirmDescription).toBe(REASON);
  const thief = cardOf(pressed, 'thief');
  await page.mouse.click(thief.x, thief.y);
  const clicked = await selectState(page);
  expect(clicked.focused).toBe('thief');
  expect(clicked.cards.filter(({ checked }) => checked)).toEqual([]);
  expect(clicked.confirmDisabled).toBe(true);
  expect(clicked.confirmDescription).toBe(REASON);
  expect(clicked.playerClass).toBe('');

  // The Knight: a click highlights it and moves focus to Confirm; Enter starts the run.
  const knight = cardOf(clicked, 'knight');
  await page.mouse.click(knight.x, knight.y);
  await page.keyboard.press('Enter');
  const entered = await selectState(page);
  expect(entered.open).toBe(false);
  expect(entered.playerClass).toBe('knight');
  expect(entered.kit?.name).toBe('Knight');
  expect(problems).toEqual([]);
});
