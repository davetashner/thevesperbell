// The pause menu in the game (mw-e01.3): when it opens and closes, and what its options do. The
// screen is src/ui/pause-menu.ts; it pauses the sim (the loop runs no steps while it is open, so the
// world clock stops and a replay never sees how long the game sat paused) and captures input.
//
// Opening: Pause (Esc or P; Menu on the pad) opens it whenever the player is in play and no other
// screen is open. The keys arrive three ways, and all three end here:
// - `keydown`: a pause key on the window, after the UI's own navigation had its turn. With no screen
//   open the UI leaves Esc alone, so it pauses; with a screen open Esc is that screen's Back (screens
//   stack: Esc closes the inventory, the options or a slot list first, and the pause menu last).
// - `pausePressed`: the gameplay Pause action in sampled action frames: the pad's Menu button, a key
//   under pointer lock, and a pad disconnecting (mw-e02.9 taps Pause then).
// - `pointerUnlocked`: the browser ends pointer lock on Esc itself (and on alt-tab) without always
//   passing the key on, so losing the lock while playing pauses too.
// While the menu is open, Pause again (P, Menu) or Back (Esc, B) resumes. A Pause press recorded
// before the menu opened (the key that opened it, under pointer lock) is dropped: the first drained
// frame after opening never closes it.
//
// Save is disabled with the reason while a safety veto objects (the autosave's: a creature in Combat,
// "Can't save during combat"). Quit to Title asks first when the world has moved on since it was last
// saved or loaded (`SaveProgress`), then leaves for the title.

import { confirmDialog, openPauseMenu, type PauseMenu, type UiRoot } from '@ui/index';

export const PAUSE_QUIT_TEXT = Object.freeze({
  title: 'Quit to title?',
  body: 'Progress since your last save will be lost.',
  confirm: 'Quit to Title',
});

/** Whether the world has moved on since it was last saved or loaded: its tick changed since then. */
export class SaveProgress {
  #savedTick: number;

  constructor(private readonly tick: () => number) {
    this.#savedTick = tick();
  }

  /** The world was saved or loaded just now. */
  mark(): void {
    this.#savedTick = this.tick();
  }

  /** True when the sim has stepped since the last save or load (or since the game started). */
  get unsaved(): boolean {
    return this.tick() !== this.#savedTick;
  }
}

export interface PauseControllerOptions {
  readonly ui: UiRoot;
  /** Whether the game may pause now: a living player in play (not flying the debug camera). */
  readonly canPause: () => boolean;
  /** Why saving is unsafe now (the first objecting safety veto), or null. */
  readonly saveBlocked: () => string | null;
  /** Whether there is progress since the last save (asks before quitting). */
  readonly unsavedProgress: () => boolean;
  /** Keyboard codes bound to Pause (the sampler's bindings: Esc, P). */
  readonly pauseKeys: () => readonly string[];
  readonly openJournal: () => void;
  readonly openSettings: () => void;
  readonly openSave: () => void;
  readonly openLoad: () => void;
  /** Leaves for the title screen (in the game, the page reloads into the front door). */
  readonly quitToTitle: () => void;
  /** Publishes `open` or `closed` for the e2e. */
  readonly publish?: (state: 'open' | 'closed') => void;
}

/** A key press as the controller reads it. */
export interface PauseKey {
  readonly code: string;
  readonly repeat: boolean;
  readonly defaultPrevented: boolean;
}

export class PauseController {
  readonly #options: PauseControllerOptions;
  #menu: PauseMenu | undefined;
  /** False until the first drained frame after opening (drops a Pause press from before it). */
  #armed = false;

  constructor(options: PauseControllerOptions) {
    this.#options = options;
    options.publish?.('closed');
  }

  get isOpen(): boolean {
    return this.#menu !== undefined;
  }

  /** The open menu, if any. */
  get menu(): PauseMenu | undefined {
    return this.#menu;
  }

  /** Opens the menu (unless it is open, another screen is, or the game cannot pause now). */
  open(): boolean {
    const { ui, canPause, saveBlocked } = this.#options;
    if (this.#menu !== undefined || ui.top !== undefined || !canPause()) return false;
    this.#armed = false;
    this.#menu = openPauseMenu(ui, {
      saveBlocked: saveBlocked() ?? undefined,
      onChoose: (action) => {
        switch (action) {
          case 'resume':
            break;
          case 'journal':
            this.#options.openJournal();
            break;
          case 'settings':
            this.#options.openSettings();
            break;
          case 'save':
            this.#options.openSave();
            break;
          case 'load':
            this.#options.openLoad();
            break;
          case 'quit':
            void this.quit();
            break;
        }
      },
      onClose: () => {
        this.#menu = undefined;
        this.#options.publish?.('closed');
      },
    });
    this.#options.publish?.('open');
    return true;
  }

  /** Closes the menu (Resume). */
  close(): void {
    this.#menu?.screen.close();
  }

  /** A key went down on the window: a Pause key opens the menu, or resumes from it. */
  keydown(event: PauseKey): boolean {
    if (event.repeat || event.defaultPrevented) return false;
    if (!this.#options.pauseKeys().includes(event.code)) return false;
    if (this.#onTop()) {
      this.close();
      return true;
    }
    return this.open();
  }

  /** The gameplay Pause action was pressed in a sampled frame (the game is running). */
  pausePressed(): void {
    this.open();
  }

  /** A frame of gameplay input was drained while the sim was paused (`pressed`: Pause in it). */
  drained(pressed: boolean): void {
    if (this.#menu === undefined) return;
    if (pressed && this.#armed && this.#onTop()) this.close();
    this.#armed = true;
  }

  /** Pointer lock ended (Esc, alt-tab) while it was the player's. */
  pointerUnlocked(): void {
    this.open();
  }

  /** Quit to Title: asks first when there is unsaved progress. Resolves once decided. */
  async quit(): Promise<void> {
    const { ui, unsavedProgress, quitToTitle } = this.#options;
    if (unsavedProgress()) {
      const confirmed = await confirmDialog(ui, {
        title: PAUSE_QUIT_TEXT.title,
        body: PAUSE_QUIT_TEXT.body,
        confirmLabel: PAUSE_QUIT_TEXT.confirm,
        destructive: true,
        pausesSim: true,
      });
      if (!confirmed) return;
    }
    // The menu stays open (the sim paused) while the page leaves.
    quitToTitle();
  }

  #onTop(): boolean {
    return this.#menu !== undefined && this.#options.ui.top === this.#menu.screen;
  }
}
