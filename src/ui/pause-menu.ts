// The pause menu (mw-e01.3): Resume, Journal (mw-e23.6), Settings, Save, Load and Quit to Title over the paused game. The
// options stack vertically, so up/down (arrows, d-pad, left stick) reach every one of them and Enter
// or A presses the focused one; Back (Esc, B) resumes. Resume takes focus on open. When saving is
// unsafe (a creature in Combat), Save stays in place but is disabled: aria-disabled, so it keeps its
// place in the focus order and a screen reader still reads why, with the reason shown under it as the
// button's description. Grey-box styling like the title menu; the menu kit art is mw-e37.35.
//
// The screen only reports choices; src/game/ui/pause.ts opens the settings, save and load screens over
// it, asks before quitting with unsaved progress and leaves for the title.

import { button } from './components/controls';
import { h, uid } from './components/dom';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the pause menu. */
export const PAUSE_SCREEN = 'pause';

export const PAUSE_MENU_TEXT = Object.freeze({
  title: 'Paused',
  menu: 'Pause menu',
  resume: 'Resume',
  journal: 'Journal',
  settings: 'Settings',
  save: 'Save',
  load: 'Load',
  quit: 'Quit to Title',
});

/** The pause menu's options, written to each button's `data-action`. */
export type PauseAction = 'resume' | 'journal' | 'settings' | 'save' | 'load' | 'quit';

export interface PauseMenuOptions {
  /** Why saving is unavailable right now (e.g. "Can't save during combat"); undefined: Save works. */
  readonly saveBlocked?: string | undefined;
  /** An option was pressed (never `save` while saving is blocked). Resume closes the menu first. */
  readonly onChoose: (action: PauseAction) => void;
  /** The menu closed (Resume, Back, or closed by the game). */
  readonly onClose?: () => void;
}

export interface PauseMenu {
  readonly screen: Screen;
  /** The option buttons by action. */
  readonly buttons: Readonly<Record<PauseAction, HTMLButtonElement>>;
}

/** Opens the pause menu. It pauses the sim and captures input; Back resumes. */
export function openPauseMenu(ui: UiRoot, options: PauseMenuOptions): PauseMenu {
  const { saveBlocked } = options;
  const make = (action: PauseAction, label: string): HTMLButtonElement => {
    const el = button({
      label,
      autofocus: action === 'resume',
      onPress: () => {
        if (action === 'save' && saveBlocked !== undefined) return;
        if (action === 'resume') screen.close();
        options.onChoose(action);
      },
    });
    el.dataset['action'] = action;
    return el;
  };
  const buttons: Record<PauseAction, HTMLButtonElement> = {
    resume: make('resume', PAUSE_MENU_TEXT.resume),
    journal: make('journal', PAUSE_MENU_TEXT.journal),
    settings: make('settings', PAUSE_MENU_TEXT.settings),
    save: make('save', PAUSE_MENU_TEXT.save),
    load: make('load', PAUSE_MENU_TEXT.load),
    quit: make('quit', PAUSE_MENU_TEXT.quit),
  };
  const column = h(
    'div',
    { className: 'vb-title-menu' },
    buttons.resume,
    buttons.journal,
    buttons.settings,
  );
  column.append(buttons.save);
  if (saveBlocked !== undefined) {
    // Disabled but focusable, described by its reason, which is also shown under it.
    const reason = h('p', {
      className: 'vb-title-last',
      text: saveBlocked,
      attrs: { id: uid('vb-pause-reason') },
      data: { testid: 'pause-save-reason' },
    });
    buttons.save.setAttribute('aria-disabled', 'true');
    buttons.save.setAttribute('aria-describedby', reason.id);
    buttons.save.dataset['reason'] = saveBlocked;
    column.append(reason);
  }
  column.append(buttons.load, buttons.quit);
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-title', data: { testid: 'pause-menu' } },
    h('h1', { text: PAUSE_MENU_TEXT.title }),
    h('nav', { attrs: { 'aria-label': PAUSE_MENU_TEXT.menu } }, column),
  );
  const screen = ui.push({
    id: PAUSE_SCREEN,
    label: PAUSE_MENU_TEXT.title,
    content,
    pausesSim: true,
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });
  return { screen, buttons };
}
