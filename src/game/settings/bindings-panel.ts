// The Key bindings panel of the options menu's Controls tab (mw-e31.2): every bindable action with a
// primary and a secondary keyboard/mouse slot. Pressing a slot starts capture ("Press a key..."): the
// next key or mouse button binds, Esc cancels without binding Esc, Delete or Backspace clears the slot.
// A code another action already uses asks Swap or Cancel, and a refused change (the last Pause
// binding) says why. Capture listens in the capture phase and swallows what it reads, so a captured
// Esc or Enter never also pauses the game or presses a menu button. Gamepad rebinding is not part of
// this panel (the model and storage already carry pad bindings; see bindings-editor.ts).

import { h } from '@ui/components/dom';
import { button, confirmDialog, type UiRoot } from '@ui/index';
import { BINDABLE_ACTIONS, codeLabel, isKeyboardMouseCode, mouseCode } from '../input/index';
import type { BindableAction, InputCode } from '../input/index';
import {
  actionLabel,
  type AssignResult,
  type BindingsEditor,
  type PendingConflict,
} from './bindings-editor';

export interface BindingsPanel {
  readonly element: HTMLElement;
  /** Leaves capture mode, if on, without binding anything. */
  cancelCapture(): void;
  /** Removes the listeners (the options screen closing). */
  dispose(): void;
}

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Builds the panel for `editor`; `ui` hosts its "Reset all" confirmation; capture listens on `host`. */
export function bindingsPanel(
  ui: UiRoot,
  editor: BindingsEditor,
  host: Target = globalThis.window,
): BindingsPanel {
  const status = h('p', { attrs: { role: 'status' }, data: { bindingsStatus: '' } });
  const say = (message: string): void => {
    status.textContent = message;
  };
  const prompt = h('div', { className: 'vb-stack', data: { bindingsConflict: '' } });
  prompt.hidden = true;
  const slotButtons = new Map<string, HTMLButtonElement>();
  const slotKey = (action: BindableAction, slot: number): string => `${action}:${String(slot)}`;

  const render = (): void => {
    for (const [key, el] of slotButtons) {
      const [action, index] = key.split(':') as [BindableAction, string];
      const slot = Number(index);
      const code = editor.bindings[action][slot];
      const name = code === undefined ? 'unbound' : codeLabel(code);
      el.textContent = name;
      el.setAttribute(
        'aria-label',
        `${actionLabel(action)}, ${slot === 0 ? 'primary' : 'secondary'} binding: ${name}. Press to change.`,
      );
    }
  };

  // --- capture mode -------------------------------------------------------------------------
  let stop: (() => void) | undefined;
  // The key or click that ended capture must not also press the slot button again.
  let swallowPress = false;

  const cancelCapture = (): void => {
    stop?.();
  };

  const closePrompt = (): void => {
    prompt.hidden = true;
    prompt.replaceChildren();
  };

  const report = (result: AssignResult, shown: HTMLButtonElement): void => {
    closePrompt();
    if (result.status === 'applied') {
      render();
      say('Binding changed.');
    } else if (result.status === 'refused') {
      say(result.reason);
    } else {
      askConflict(result.conflict, shown);
    }
  };

  const askConflict = (conflict: PendingConflict, returnTo: HTMLButtonElement): void => {
    const swap = button({
      label: 'Swap',
      onPress: () => {
        report(editor.swap(conflict), returnTo);
        returnTo.focus();
      },
    });
    swap.dataset['bindingsSwap'] = '';
    const cancel = button({
      label: 'Cancel',
      onPress: () => {
        closePrompt();
        say('Cancelled. Nothing changed.');
        returnTo.focus();
      },
    });
    cancel.dataset['bindingsCancel'] = '';
    prompt.replaceChildren(
      h('p', { text: conflict.message }),
      h('div', { className: 'vb-row' }, swap, cancel),
    );
    prompt.hidden = false;
    say('That input is already in use.');
    swap.focus();
  };

  const startCapture = (action: BindableAction, slot: number, shown: HTMLButtonElement): void => {
    cancelCapture();
    closePrompt();
    const finish = (message: string): void => {
      stop?.();
      say(message);
    };
    const apply = (code: InputCode): void => {
      stop?.();
      report(editor.assign(action, slot, code), shown);
    };
    const onKey = (event: Event): void => {
      const key = event as KeyboardEvent;
      key.preventDefault();
      key.stopPropagation();
      if (key.repeat) return;
      swallowPress = key.code === 'Space';
      if (key.code === 'Escape') {
        finish('Cancelled. Escape was not bound.');
      } else if (key.code === 'Backspace' || key.code === 'Delete') {
        stop?.();
        const result = editor.clear(action, slot);
        closePrompt();
        if (result.status === 'applied') {
          render();
          say(`${actionLabel(action)} cleared.`);
        } else {
          say(result.reason);
        }
      } else if (isKeyboardMouseCode(key.code)) {
        apply(key.code);
      } else {
        say('That key cannot be bound. Press another, or Esc to cancel.');
      }
    };
    const onMouse = (event: Event): void => {
      const mouse = event as MouseEvent;
      const onSlot = mouse.target === shown;
      // Left click on the slot itself binds left click; anywhere else it just cancels.
      if (mouse.button === 0 && !onSlot) {
        finish('Cancelled.');
        return;
      }
      mouse.preventDefault();
      mouse.stopPropagation();
      swallowPress = true;
      const code = mouseCode(mouse.button);
      if (isKeyboardMouseCode(code)) apply(code);
    };
    const onMenu = (event: Event): void => {
      event.preventDefault();
    };
    host.addEventListener('keydown', onKey, true);
    host.addEventListener('mousedown', onMouse, true);
    host.addEventListener('contextmenu', onMenu, true);
    shown.dataset['capturing'] = '';
    shown.textContent = 'Press a key…';
    say(
      `Press a key or mouse button for ${actionLabel(action)}. Esc cancels, Delete clears. ` +
        'Click this button for left click.',
    );
    stop = () => {
      host.removeEventListener('keydown', onKey, true);
      host.removeEventListener('mousedown', onMouse, true);
      host.removeEventListener('contextmenu', onMenu, true);
      delete shown.dataset['capturing'];
      stop = undefined;
      render();
    };
  };

  // --- rows ---------------------------------------------------------------------------------
  const rows = BINDABLE_ACTIONS.map((action) => {
    const slots = [0, 1].map((slot) => {
      const el = button({
        label: '',
        onPress: () => {
          if (swallowPress) {
            swallowPress = false;
            return;
          }
          startCapture(action, slot, el);
        },
      });
      el.dataset['binding'] = slotKey(action, slot);
      slotButtons.set(slotKey(action, slot), el);
      return el;
    });
    const reset = button({
      label: 'Reset',
      onPress: () => {
        closePrompt();
        const result = editor.resetAction(action);
        render();
        say(
          result.status === 'applied' ? `${actionLabel(action)} reset to default.` : result.reason,
        );
      },
    });
    reset.dataset['bindingReset'] = action;
    reset.setAttribute('aria-label', `Reset ${actionLabel(action)} to default`);
    return h(
      'div',
      { className: 'vb-row', data: { bindingRow: action } },
      h('span', { text: actionLabel(action), attrs: { style: 'min-width: 9rem' } }),
      ...slots,
      reset,
    );
  });
  const list = h('div', { className: 'vb-stack', data: { bindingsList: '' } }, ...rows);
  list.style.maxHeight = '45vh';
  list.style.overflowY = 'auto';

  const resetAll = button({
    label: 'Reset all bindings',
    variant: 'warning',
    onPress: () => {
      void confirmDialog(ui, {
        title: 'Reset all key bindings?',
        body: 'Every keyboard and mouse binding goes back to its default.',
        confirmLabel: 'Reset',
        destructive: true,
      }).then((confirmed) => {
        if (!confirmed) return;
        editor.resetAll();
        closePrompt();
        render();
        say('All bindings reset to default.');
      });
    },
  });
  resetAll.dataset['bindingsResetAll'] = '';

  const element = h(
    'section',
    { className: 'vb-stack', data: { bindings: '' }, attrs: { 'aria-label': 'Key bindings' } },
    h('h2', { text: 'Key bindings' }),
    h('p', {
      text: 'Choose a slot, then press the key or mouse button you want. Each action has a primary and a secondary binding.',
    }),
    status,
    prompt,
    list,
    h('div', { className: 'vb-row' }, resetAll),
  );
  render();
  // A stale swallow (the click never came) must not eat the next real press.
  const clearSwallow = (): void => {
    swallowPress = false;
  };
  host.addEventListener('keydown', clearSwallow);
  host.addEventListener('mousedown', clearSwallow);
  return {
    element,
    cancelCapture,
    dispose: () => {
      cancelCapture();
      host.removeEventListener('keydown', clearSwallow);
      host.removeEventListener('mousedown', clearSwallow);
    },
  };
}
