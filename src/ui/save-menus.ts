// The title menu and the save slot screens (mw-e30.11). The title menu offers Continue (the most
// recent save), New Game and Load. With no save, Continue stays in place but is disabled with the
// reason "No saves yet" (aria-disabled, so it keeps focus order and a screen reader still reads the
// reason; mw-e01.2 AC-2), and New Game takes focus. The slot list is the Load screen (every save,
// most recent first) and the Save screen (the ten manual slots): one row per slot with its thumbnail,
// title and details, and a Delete button beside it. Rows stack vertically, so up/down move between
// slots, right reaches Delete, Enter presses and Esc goes back: everything is reachable by keyboard
// or pad alone. Grey-box styling; the menu kit art is mw-e37.35. The title menu shows the build SHA
// (mw-e01.2), so a playtester's report names the build they played.
//
// The screens only report choices; src/game/save/menus loads, saves, asks for confirmation and
// redraws the list through `SlotList.update`.

import { button } from './components/controls';
import { h, uid } from './components/dom';
import { attachTooltip } from './components/overlays';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the title menu. */
export const TITLE_SCREEN = 'title';

/** `data-screen` of the Load and Save slot lists. */
export const SAVE_SLOTS_SCREEN = 'save-slots';

export const SAVE_MENU_TEXT = Object.freeze({
  title: 'The Vesper Bell',
  menu: 'Main menu',
  continue: 'Continue',
  newGame: 'New Game',
  load: 'Load',
  noSaves: 'No saves yet',
  lastSave: 'Last save',
  build: 'Build',
  loadHeading: 'Load a save',
  saveHeading: 'Save the game',
  loadVerb: 'Load',
  saveVerb: 'Save here',
  emptyList: 'No saves yet. Saves you make, autosaves and quicksaves appear here.',
  slots: 'Save slots',
  delete: 'Delete',
  back: 'Back',
  hint: '↑ ↓ choose · → Delete · Enter select · Esc back',
});

/** A save the title menu's Continue loads. */
export interface ContinueEntry {
  readonly title: string;
  readonly detail: string;
}

export interface TitleMenuOptions<T extends ContinueEntry> {
  /** The most recent save; undefined disables Continue. */
  readonly last: T | undefined;
  /** Why Continue is disabled when there is no save (default "No saves yet"). */
  readonly unavailable?: string | undefined;
  /** The build SHA, shown under the menu ("Build abc1234"); omitted shows none. */
  readonly build?: string | undefined;
  /** Continue was pressed (only ever with a save). */
  readonly onContinue: (last: T) => void;
  readonly onNewGame: () => void;
  readonly onLoad: () => void;
}

export interface TitleMenu {
  readonly screen: Screen;
  readonly continueButton: HTMLButtonElement;
}

/**
 * Opens the title menu. It pauses the sim and captures input; Back never closes it (it is the root
 * of the menus).
 */
export function openTitleMenu<T extends ContinueEntry>(
  ui: UiRoot,
  options: TitleMenuOptions<T>,
): TitleMenu {
  const { last } = options;
  const continueButton = button({
    label: SAVE_MENU_TEXT.continue,
    autofocus: last !== undefined,
    onPress: () => {
      if (last !== undefined) options.onContinue(last);
    },
  });
  continueButton.dataset['action'] = 'continue';
  const newGame = button({
    label: SAVE_MENU_TEXT.newGame,
    autofocus: last === undefined,
    onPress: options.onNewGame,
  });
  newGame.dataset['action'] = 'new-game';
  const load = button({ label: SAVE_MENU_TEXT.load, onPress: options.onLoad });
  load.dataset['action'] = 'load';
  const column = h('div', { className: 'vb-title-menu' }, continueButton);
  if (last === undefined) {
    // Disabled but focusable, described by its reason (the tooltip is its aria-describedby).
    const reason = options.unavailable ?? SAVE_MENU_TEXT.noSaves;
    continueButton.setAttribute('aria-disabled', 'true');
    continueButton.dataset['reason'] = reason;
    continueButton.title = reason;
    attachTooltip(continueButton, reason);
  } else {
    const detail = h('p', {
      className: 'vb-title-last',
      text: `${SAVE_MENU_TEXT.lastSave}: ${last.title} · ${last.detail}`,
      attrs: { id: uid('vb-title-last') },
    });
    continueButton.setAttribute('aria-describedby', detail.id);
    column.append(detail);
  }
  column.append(newGame, load);
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-title', data: { testid: 'title-menu' } },
    h('h1', { text: SAVE_MENU_TEXT.title }),
    h('nav', { attrs: { 'aria-label': SAVE_MENU_TEXT.menu } }, column),
  );
  if (options.build !== undefined) {
    content.append(
      h('p', {
        className: 'vb-title-build',
        text: `${SAVE_MENU_TEXT.build} ${options.build}`,
        data: { testid: 'title-build' },
      }),
    );
  }
  const screen = ui.push({
    id: TITLE_SCREEN,
    label: SAVE_MENU_TEXT.title,
    content,
    pausesSim: true,
    onBack: () => true,
  });
  return { screen, continueButton };
}

/** One row of a slot list. */
export interface SlotEntry {
  /** The slot id, written to the row's `data-slot`. */
  readonly id: string;
  /** "Manual save 1", or the player's label for it. */
  readonly title: string;
  /** Area, playtime and age, already formatted; "Empty slot" for an empty one. */
  readonly detail: string;
  /** Nothing saved here: no Delete, and saving needs no confirmation. */
  readonly empty: boolean;
  /** The thumbnail as an image URL; undefined draws the placeholder. */
  readonly thumbnail?: string | undefined;
  /** Set when the row's main action is unavailable (a damaged save with nothing to restore). */
  readonly unavailable?: string | undefined;
}

/** A line under the heading after an action. */
export interface SlotListMessage {
  /** Polite status, e.g. "Saved to Manual save 1". */
  readonly status?: string | undefined;
  /** An error the player must see (role alert). */
  readonly error?: string | undefined;
}

export interface SlotListOptions<T extends SlotEntry> {
  /** Load lists saves to load; Save lists slots to save into. */
  readonly mode: 'load' | 'save';
  readonly entries: readonly T[];
  /** Shown for as long as the screen is open, e.g. saves live only in memory. */
  readonly warning?: string | undefined;
  /** The list could not be read. */
  readonly error?: string | undefined;
  /**
   * The row's main action (Load or Save here) was pressed. Also called for an `unavailable` row,
   * which looks and reads as disabled: the caller ignores it.
   */
  readonly onChoose: (entry: T) => void;
  /** The row's Delete was pressed. */
  readonly onDelete: (entry: T) => void;
  readonly onClose?: () => void;
}

export interface SlotList<T extends SlotEntry> {
  readonly screen: Screen;
  /** Redraws the rows, keeping focus on the same slot and action where it still exists. */
  update(entries: readonly T[], message?: SlotListMessage): void;
}

/** Opens the Load or Save screen. It pauses the sim; Back closes it. */
export function openSlotList<T extends SlotEntry>(
  ui: UiRoot,
  options: SlotListOptions<T>,
): SlotList<T> {
  const { mode } = options;
  const heading = mode === 'load' ? SAVE_MENU_TEXT.loadHeading : SAVE_MENU_TEXT.saveHeading;
  const status = h('p', { attrs: { role: 'status' }, data: { testid: 'save-slots-status' } });
  const error = h('p', {
    className: 'vb-slot-error',
    attrs: { role: 'alert' },
    data: { testid: 'save-slots-error' },
  });
  const rows = h('ul', {
    className: 'vb-slot-list',
    attrs: { 'aria-label': SAVE_MENU_TEXT.slots },
  });
  const back = button({
    label: SAVE_MENU_TEXT.back,
    onPress: () => {
      screen.close();
    },
  });
  back.dataset['action'] = 'back';

  const showMessage = (message: SlotListMessage): void => {
    status.textContent = message.status ?? '';
    error.textContent = message.error ?? '';
    error.hidden = message.error === undefined;
  };

  const draw = (entries: readonly T[]): void => {
    if (entries.length === 0) {
      rows.replaceChildren(
        h('li', {
          className: 'vb-slot-empty',
          text: SAVE_MENU_TEXT.emptyList,
          data: { testid: 'save-slots-empty' },
        }),
      );
      return;
    }
    rows.replaceChildren(...entries.map((entry) => slotRow(entry, mode, options)));
  };

  const parts: HTMLElement[] = [h('h1', { text: heading })];
  if (options.warning !== undefined) {
    parts.push(
      h('p', {
        className: 'vb-slot-warning',
        text: options.warning,
        attrs: { role: 'alert' },
        data: { testid: 'save-slots-warning' },
      }),
    );
  }
  parts.push(error, status, rows, h('div', { className: 'vb-row' }, back), hint());
  showMessage({ error: options.error });
  draw(options.entries);
  const first = rows.querySelector<HTMLElement>('[data-action="choose"]') ?? back;
  first.dataset['autofocus'] = '';

  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-slots', data: { testid: 'save-slots', mode } },
    ...parts,
  );
  const screen = ui.push({
    id: SAVE_SLOTS_SCREEN,
    label: heading,
    content,
    pausesSim: true,
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });

  return {
    screen,
    update(entries, message = {}) {
      // A screen always holds focus somewhere (UiRoot focuses it on push).
      const active = content.ownerDocument.activeElement as HTMLElement;
      const action = active.dataset['action'];
      const slot = active.closest<HTMLElement>('[data-slot]')?.dataset['slot'];
      draw(entries);
      showMessage(message);
      if (slot === undefined || action === undefined) return;
      const same = rows.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      const target =
        same?.querySelector<HTMLElement>(`[data-action="${action}"]`) ??
        same?.querySelector<HTMLElement>('[data-action="choose"]') ??
        rows.querySelector<HTMLElement>('[data-action="choose"]') ??
        back;
      target.focus();
    },
  };
}

function slotRow<T extends SlotEntry>(
  entry: T,
  mode: 'load' | 'save',
  options: SlotListOptions<T>,
): HTMLElement {
  const thumb =
    entry.thumbnail === undefined
      ? h('span', { className: 'vb-slot-thumb', data: { placeholder: '' } })
      : h('img', {
          className: 'vb-slot-thumb',
          attrs: { src: entry.thumbnail, alt: '', width: '128', height: '72' },
        });
  thumb.setAttribute('aria-hidden', 'true');
  const verb = mode === 'load' ? SAVE_MENU_TEXT.loadVerb : SAVE_MENU_TEXT.saveVerb;
  const choose = h(
    'button',
    {
      className: 'vb-button vb-slot-choose',
      attrs: { type: 'button' },
      data: { action: 'choose', uiComponent: 'button' },
    },
    thumb,
    h(
      'span',
      { className: 'vb-slot-text' },
      h('span', { className: 'vb-slot-title', text: entry.title }),
      h('span', { className: 'vb-slot-detail', text: entry.detail }),
    ),
    h('span', { className: 'vb-slot-verb', text: verb }),
  );
  const { unavailable } = entry;
  if (unavailable !== undefined) {
    choose.setAttribute('aria-disabled', 'true');
    choose.dataset['reason'] = unavailable;
    const reason = h('span', {
      className: 'vb-slot-reason',
      text: unavailable,
      attrs: { id: uid('vb-slot-reason') },
    });
    choose.querySelector('.vb-slot-text')?.append(reason);
    choose.setAttribute('aria-describedby', reason.id);
  }
  choose.addEventListener('click', () => {
    options.onChoose(entry);
  });
  const row = h('li', { className: 'vb-save-row', data: { slot: entry.id } }, choose);
  if (!entry.empty) {
    const remove = button({
      label: SAVE_MENU_TEXT.delete,
      variant: 'warning',
      onPress: () => {
        options.onDelete(entry);
      },
    });
    remove.dataset['action'] = 'delete';
    remove.setAttribute('aria-label', `${SAVE_MENU_TEXT.delete} ${entry.title}`);
    row.append(remove);
  }
  return row;
}

function hint(): HTMLElement {
  return h('p', {
    className: 'vb-slot-hint',
    text: SAVE_MENU_TEXT.hint,
    attrs: { 'aria-hidden': 'true' },
  });
}
