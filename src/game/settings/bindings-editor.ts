// The rebinding model behind the Key bindings panel (mw-e31.2). It edits the keyboard + mouse set
// through the pure rebind/unbind rules in src/game/input/bindings.ts and saves every change through
// the settings store, so the bindings persist across a reload. A change that would leave two actions
// on one code in a clashing context is never applied silently: `assign` returns a conflict the caller
// resolves with swap() or cancel(), and `clear` refuses to leave a required action (Pause) with no
// binding at all, so a player cannot lock themselves out of the pause menu.

import {
  DEFAULT_BINDINGS,
  codeLabel,
  rebind,
  unbind,
  type BindableAction,
  type Bindings,
  type InputCode,
} from '../input/index';
import { ACTIONS } from '@sim/index';
import { loadBindings, saveBindings } from './bindings';
import type { SettingsStore } from './store';

/** Actions that must always keep a keyboard or mouse binding. */
export const REQUIRED_ACTIONS: readonly BindableAction[] = Object.freeze(['pause']);

/** The label a player sees for an action ("Dodge", "Move forward"). */
export function actionLabel(action: BindableAction): string {
  switch (action) {
    case 'moveForward':
      return 'Move forward';
    case 'moveBack':
      return 'Move back';
    case 'moveLeft':
      return 'Move left';
    case 'moveRight':
      return 'Move right';
    default:
      return ACTIONS[action].label;
  }
}

/** A code that another action already holds; resolve with swap() or cancel(). */
export interface PendingConflict {
  readonly action: BindableAction;
  readonly slot: number;
  readonly code: InputCode;
  /** The action that holds `code` now. */
  readonly other: BindableAction;
  /** The code the action gives up, which the other action takes in a swap ('' when slot was empty). */
  readonly displaced: InputCode;
  /** What to ask the player. */
  readonly message: string;
}

export type AssignResult =
  | { readonly status: 'applied' }
  | { readonly status: 'conflict'; readonly conflict: PendingConflict }
  | { readonly status: 'refused'; readonly reason: string };

export type ClearResult =
  { readonly status: 'applied' } | { readonly status: 'refused'; readonly reason: string };

/** `rebind`, keeping the set as it was when the code clashes. */
export function tryRebind(
  bindings: Bindings,
  action: BindableAction,
  code: InputCode,
  slot: number,
): Bindings {
  const result = rebind(bindings, action, code, slot);
  return result.ok ? result.bindings : bindings;
}

export class BindingsEditor {
  readonly #store: SettingsStore;
  readonly #onChange: (bindings: Bindings) => void;
  #bindings: Bindings;
  #gamepad: Bindings;

  /** `onChange` hears every applied keyboard + mouse set (the live sampler takes it). */
  constructor(store: SettingsStore, onChange: (bindings: Bindings) => void = () => undefined) {
    this.#store = store;
    this.#onChange = onChange;
    const loaded = loadBindings(store);
    this.#bindings = loaded.bindings;
    this.#gamepad = loaded.gamepad;
  }

  /** The current keyboard + mouse bindings. */
  get bindings(): Bindings {
    return this.#bindings;
  }

  #commit(next: Bindings): void {
    this.#bindings = next;
    saveBindings(this.#store, next, this.#gamepad);
    this.#onChange(next);
  }

  /** Binds `code` to `action` in `slot`; a clash with another action comes back as a conflict. */
  assign(action: BindableAction, slot: number, code: InputCode): AssignResult {
    const result = rebind(this.#bindings, action, code, slot);
    if (result.ok) {
      this.#commit(result.bindings);
      return { status: 'applied' };
    }
    const other = result.conflict.actions[1];
    const displaced = this.#bindings[action][slot] ?? '';
    const gives =
      displaced === '' ? '' : ` ${actionLabel(other)} would take ${codeLabel(displaced)}.`;
    return {
      status: 'conflict',
      conflict: {
        action,
        slot,
        code,
        other,
        displaced,
        message:
          `${codeLabel(code)} is already used by ${actionLabel(other)}. ` +
          `Swap them, or cancel and keep things as they were.${gives}`,
      },
    };
  }

  /** Resolves a conflict by swapping: `action` takes the code and the other action takes `displaced`. */
  swap(conflict: PendingConflict): AssignResult {
    const { action, slot, code, other, displaced } = conflict;
    const otherSlot = this.#bindings[other].indexOf(code);
    let next = unbind(this.#bindings, other, otherSlot);
    next = tryRebind(next, action, code, slot);
    if (displaced !== '') {
      // A third action in another context can hold the displaced code; then the other action
      // simply loses the code rather than a duplicate being left behind.
      next = tryRebind(next, other, displaced, Math.min(otherSlot, next[other].length));
    }
    if (next[other].length === 0 && REQUIRED_ACTIONS.includes(other)) {
      return { status: 'refused', reason: this.#requiredReason(other) };
    }
    this.#commit(next);
    return { status: 'applied' };
  }

  #requiredReason(action: BindableAction): string {
    return `${actionLabel(action)} needs at least one keyboard or mouse binding, so you can always open the menu. Bind another input first.`;
  }

  /** Removes the binding in `slot`; refused when it is the last one of a required action. */
  clear(action: BindableAction, slot: number): ClearResult {
    const codes = this.#bindings[action];
    if (slot >= codes.length) return { status: 'applied' };
    if (codes.length === 1 && REQUIRED_ACTIONS.includes(action)) {
      return { status: 'refused', reason: this.#requiredReason(action) };
    }
    this.#commit(unbind(this.#bindings, action, slot));
    return { status: 'applied' };
  }

  /**
   * Puts one action back on its default codes. Refused, naming the action, when a default code is
   * held by another action now (reset that one first, or reset everything).
   */
  resetAction(action: BindableAction): ClearResult {
    let next = this.#bindings;
    for (let i = next[action].length - 1; i >= 0; i--) next = unbind(next, action, i);
    for (const [slot, code] of DEFAULT_BINDINGS[action].entries()) {
      const result = rebind(next, action, code, slot);
      if (!result.ok) {
        const other = result.conflict.actions[1];
        return {
          status: 'refused',
          reason: `${codeLabel(code)} is used by ${actionLabel(other)} now. Reset ${actionLabel(other)} first, or reset all bindings.`,
        };
      }
      next = result.bindings;
    }
    this.#commit(next);
    return { status: 'applied' };
  }

  /** Every action back on its default codes. */
  resetAll(): void {
    this.#commit(DEFAULT_BINDINGS);
  }
}
