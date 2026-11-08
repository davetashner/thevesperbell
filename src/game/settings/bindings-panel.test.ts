// @vitest-environment happy-dom
// The Key bindings panel (mw-e31.2): capture mode, conflicts, refusals and resets, driven with real
// DOM events.
import { beforeEach, describe, expect, it } from 'vitest';
import { UiRoot } from '@ui/screens';
import { find } from '@ui/testing/layout';
import { DEFAULT_BINDINGS } from '../input/index';
import {
  BindingsEditor,
  bindingsPanel,
  createSettingsStore,
  loadBindings,
  openOptionsMenu,
  type BindingsPanel,
  type SettingsStore,
} from './index';

let ui: UiRoot;
let store: SettingsStore;
let editor: BindingsEditor;
let panel: BindingsPanel;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
  store = createSettingsStore();
  editor = new BindingsEditor(store);
  panel = bindingsPanel(ui, editor);
  document.body.append(panel.element);
});

const slot = (action: string, n = 0): HTMLButtonElement =>
  find(`[data-binding="${action}:${String(n)}"]`) as HTMLButtonElement;
const status = (): string => find('[data-bindings-status]').textContent;
const press = (code: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
};
const mouse = (button: number, target: Element = document.body): MouseEvent => {
  const event = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the bindings list', () => {
  it('shows every action with its primary and secondary binding, or unbound', () => {
    expect(slot('dodge').textContent).toBe('R');
    expect(slot('dodge', 1).textContent).toBe('unbound');
    expect(slot('moveForward', 1).textContent).toBe('Up');
    expect(slot('dodge').getAttribute('aria-label')).toBe(
      'Dodge, primary binding: R. Press to change.',
    );
    expect(find('[data-binding-row="dodge"]').textContent).toContain('Dodge');
  });
});

describe('capture mode', () => {
  it('AC-1: pressing a slot, then a key, rebinds the action and saves it', () => {
    slot('dodge').click();
    expect(slot('dodge').textContent).toBe('Press a key…');
    expect(slot('dodge').hasAttribute('data-capturing')).toBe(true);
    expect(status()).toContain('Press a key or mouse button for Dodge');
    const event = press('KeyF');
    expect(event.defaultPrevented).toBe(true);
    expect(editor.bindings.dodge).toEqual(['KeyF']);
    expect(slot('dodge').textContent).toBe('F');
    expect(slot('dodge').hasAttribute('data-capturing')).toBe(false);
    expect(status()).toBe('Binding changed.');
    expect(loadBindings(store).bindings.dodge).toEqual(['KeyF']);
  });

  it('AC-4: Esc cancels capture without binding Esc, and the keypress goes no further', () => {
    let seen = false;
    document.body.addEventListener('keydown', () => {
      seen = true;
    });
    slot('dodge').click();
    press('Escape');
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    expect(slot('dodge').textContent).toBe('R');
    expect(status()).toBe('Cancelled. Escape was not bound.');
    expect(seen).toBe(false);
    // Capture is over: the next key is an ordinary key again.
    press('KeyF');
    expect(editor.bindings.dodge).toEqual(['KeyR']);
  });

  it('ignores key repeat and keys that cannot be bound, and stays in capture', () => {
    slot('dodge').click();
    press('KeyF', { repeat: true });
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    press('MediaPlayPause');
    expect(status()).toContain('cannot be bound');
    press('KeyH');
    expect(editor.bindings.dodge).toEqual(['KeyH']);
  });

  it('binds a mouse button, and suppresses the context menu while capturing', () => {
    slot('dodge').click();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    const down = mouse(4);
    expect(down.defaultPrevented).toBe(true);
    expect(editor.bindings.dodge).toEqual(['Mouse4']);
    expect(slot('dodge').textContent).toBe('Mouse 5');
    // The click that finishes the mouse press does not start a new capture.
    slot('dodge').click();
    expect(slot('dodge').hasAttribute('data-capturing')).toBe(false);
    slot('dodge').click();
    expect(slot('dodge').hasAttribute('data-capturing')).toBe(true);
  });

  it('left click on the slot binds left click; anywhere else cancels', () => {
    slot('dodge').click();
    mouse(0);
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    expect(status()).toBe('Cancelled.');
    slot('primaryAttack').click();
    press('Delete');
    slot('dodge').click();
    mouse(0, slot('dodge'));
    expect(editor.bindings.dodge).toEqual(['Mouse0']);
  });

  it('a mouse button the game cannot bind is ignored', () => {
    slot('dodge').click();
    mouse(7);
    expect(editor.bindings.dodge).toEqual(['KeyR']);
  });

  it('Space binds without its release pressing the slot again', () => {
    slot('dodge').click();
    press('Space');
    // Space is Jump's: a conflict, so the prompt is up and the focus is on Swap.
    expect(find('[data-bindings-conflict]').hidden).toBe(false);
    find('[data-bindings-cancel]').click();
    slot('dodge').click();
    press('KeyH');
    slot('jump').click();
    press('Space');
    expect(editor.bindings.jump).toEqual(['Space']);
    slot('jump').click();
    expect(slot('jump').hasAttribute('data-capturing')).toBe(false);
    // A later real press is not swallowed once another key went down.
    press('KeyJ');
    slot('jump').click();
    expect(slot('jump').hasAttribute('data-capturing')).toBe(true);
  });

  it('starting a second capture ends the first', () => {
    slot('dodge').click();
    slot('jump').click();
    expect(slot('dodge').hasAttribute('data-capturing')).toBe(false);
    expect(slot('jump').hasAttribute('data-capturing')).toBe(true);
    panel.cancelCapture();
    expect(slot('jump').hasAttribute('data-capturing')).toBe(false);
    panel.cancelCapture();
  });

  it('Delete or Backspace clears the slot', () => {
    slot('dodge').click();
    press('Delete');
    expect(editor.bindings.dodge).toEqual([]);
    expect(slot('dodge').textContent).toBe('unbound');
    expect(status()).toBe('Dodge cleared.');
    slot('jump').click();
    press('Backspace');
    expect(editor.bindings.jump).toEqual([]);
  });

  it('AC-3: clearing the last Pause binding is refused, with the reason shown', () => {
    slot('pause', 1).click();
    press('Delete');
    expect(editor.bindings.pause).toEqual(['Escape']);
    slot('pause').click();
    press('Delete');
    expect(editor.bindings.pause).toEqual(['Escape']);
    expect(status()).toContain('Pause needs at least one keyboard or mouse binding');
    expect(slot('pause').textContent).toBe('Esc');
  });

  it('AC-3: rebinding the last Pause slot to another key is allowed', () => {
    slot('pause', 1).click();
    press('Delete');
    slot('pause').click();
    press('KeyP');
    expect(editor.bindings.pause).toEqual(['KeyP']);
  });
});

describe('conflicts', () => {
  const askSwap = (): void => {
    slot('dodge').click();
    press('ShiftLeft');
  };

  it('AC-2: a clash asks Swap or Cancel, focuses Swap and changes nothing yet', () => {
    askSwap();
    const prompt = find('[data-bindings-conflict]');
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toContain('Shift is already used by Sprint');
    expect(document.activeElement).toBe(find('[data-bindings-swap]'));
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    expect(status()).toBe('That input is already in use.');
  });

  it('AC-2: Swap exchanges the two codes and closes the prompt', () => {
    askSwap();
    find('[data-bindings-swap]').click();
    expect(editor.bindings.dodge).toEqual(['ShiftLeft']);
    expect(editor.bindings.sprint).toEqual(['KeyR']);
    expect(slot('sprint').textContent).toBe('R');
    expect(find('[data-bindings-conflict]').hidden).toBe(true);
    expect(document.activeElement).toBe(slot('dodge'));
    expect(status()).toBe('Binding changed.');
  });

  it('AC-2: Cancel keeps both as they were', () => {
    askSwap();
    find('[data-bindings-cancel]').click();
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    expect(editor.bindings.sprint).toEqual(['ShiftLeft']);
    expect(find('[data-bindings-conflict]').hidden).toBe(true);
    expect(status()).toBe('Cancelled. Nothing changed.');
    expect(document.activeElement).toBe(slot('dodge'));
  });

  it('AC-3: a swap that would leave Pause unbound is refused, and says why', () => {
    slot('pause', 1).click();
    press('Delete');
    // Interact's empty second slot takes P (Pause's last key): swapping would strip Pause.
    slot('pause').click();
    press('KeyP');
    slot('interact', 1).click();
    press('KeyP');
    find('[data-bindings-swap]').click();
    expect(editor.bindings.pause).toEqual(['KeyP']);
    expect(editor.bindings.interact).toEqual(['KeyE']);
    expect(status()).toContain('Pause needs at least one keyboard or mouse binding');
    expect(find('[data-bindings-conflict]').hidden).toBe(true);
  });

  it('a new capture or reset closes an open prompt', () => {
    askSwap();
    slot('jump').click();
    expect(find('[data-bindings-conflict]').hidden).toBe(true);
    panel.cancelCapture();
  });
});

describe('resetting', () => {
  it('resets one action, or says why it cannot', () => {
    editor.assign('dodge', 0, 'KeyF');
    panel.element.querySelector<HTMLElement>('[data-binding-reset="dodge"]')?.click();
    expect(editor.bindings.dodge).toEqual(['KeyR']);
    expect(status()).toBe('Dodge reset to default.');
    expect(slot('dodge').textContent).toBe('R');

    editor.assign('jump', 0, 'KeyF');
    editor.assign('dodge', 0, 'Space');
    panel.element.querySelector<HTMLElement>('[data-binding-reset="jump"]')?.click();
    expect(status()).toContain('Space is used by Dodge now');
  });

  it('Reset all asks first, then restores every default', async () => {
    editor.assign('dodge', 0, 'KeyF');
    find('[data-bindings-reset-all]').click();
    const dialog = find('[data-testid="confirm"]');
    expect(dialog.textContent).toContain('Reset all key bindings?');
    const buttons = [...dialog.querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Cancel')?.click();
    await tick();
    expect(editor.bindings.dodge).toEqual(['KeyF']);

    find('[data-bindings-reset-all]').click();
    [...find('[data-testid="confirm"]').querySelectorAll('button')]
      .find((b) => b.textContent === 'Reset')
      ?.click();
    await tick();
    expect(editor.bindings).toBe(DEFAULT_BINDINGS);
    expect(slot('dodge').textContent).toBe('R');
    expect(status()).toBe('All bindings reset to default.');
  });
});

describe('inside the options menu', () => {
  it('sits in the Controls tab and stops listening when the screen closes', () => {
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { unstyled: true });
    const menu = openOptionsMenu(ui, store, { bindings: editor });
    expect(find('[data-category="controls"] [data-bindings]')).toBeTruthy();
    expect(document.querySelectorAll('[data-bindings]')).toHaveLength(1);
    slot('dodge').click();
    menu.screen.close();
    press('KeyF');
    expect(editor.bindings.dodge).toEqual(['KeyR']);
  });

  it('builds its own editor from the store when none is given', () => {
    document.body.innerHTML = '';
    ui = new UiRoot(document.body, { unstyled: true });
    openOptionsMenu(ui, store);
    slot('dodge').click();
    press('KeyF');
    expect(loadBindings(store).bindings.dodge).toEqual(['KeyF']);
  });
});
