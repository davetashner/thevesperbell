// The rebinding model (mw-e31.2): conflicts prompt swap or cancel, required actions keep a binding,
// every change saves through the settings store.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS, findConflicts, type Bindings } from '../input/index';
import {
  actionLabel,
  BindingsEditor,
  createSettingsStore,
  loadBindings,
  REQUIRED_ACTIONS,
  tryRebind,
  type PendingConflict,
  type SettingsStore,
} from './index';

const editor = (store: SettingsStore = createSettingsStore(), onChange?: (b: Bindings) => void) =>
  new BindingsEditor(store, onChange);

function conflictOf(result: ReturnType<BindingsEditor['assign']>): PendingConflict {
  if (result.status !== 'conflict') throw new Error(`expected a conflict, got ${result.status}`);
  return result.conflict;
}

describe('assigning bindings', () => {
  it('applies a free code, saves it and tells the listener', () => {
    const store = createSettingsStore();
    const onChange = vi.fn();
    const e = editor(store, onChange);
    expect(e.assign('dodge', 0, 'KeyF')).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual(['KeyF']);
    expect(loadBindings(store).bindings.dodge).toEqual(['KeyF']);
    expect(onChange).toHaveBeenCalledWith(e.bindings);
  });

  it('AC-2: a code another action holds in the same context is a conflict, and nothing changes yet', () => {
    const e = editor();
    const conflict = conflictOf(e.assign('dodge', 0, 'ShiftLeft'));
    expect(conflict.other).toBe('sprint');
    expect(conflict.message).toContain('Shift is already used by Sprint');
    expect(conflict.message).toContain('Swap');
    expect(e.bindings).toBe(DEFAULT_BINDINGS);
  });

  it('AC-2: cancelling (never calling swap) leaves the set as it was and unsaved', () => {
    const store = createSettingsStore();
    const e = editor(store);
    conflictOf(e.assign('dodge', 0, 'ShiftLeft'));
    expect(store.storedBindings).toBeUndefined();
    expect(e.bindings.sprint).toEqual(['ShiftLeft']);
  });

  it('AC-2: swap gives the other action the displaced code, leaving no duplicate', () => {
    const e = editor();
    const result = e.swap(conflictOf(e.assign('dodge', 0, 'ShiftLeft')));
    expect(result).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual(['ShiftLeft']);
    expect(e.bindings.sprint).toEqual(['KeyR']);
    expect(findConflicts(e.bindings)).toEqual([]);
  });

  it('AC-2: swapping into an empty slot just moves the code, and the other action loses it', () => {
    const e = editor();
    const conflict = conflictOf(e.assign('dodge', 1, 'KeyC'));
    expect(conflict.displaced).toBe('');
    expect(conflict.message).not.toContain('would take');
    expect(e.swap(conflict)).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual(['KeyR', 'KeyC']);
    expect(e.bindings.crouch).toEqual([]);
    expect(findConflicts(e.bindings)).toEqual([]);
  });

  it('AC-2: a displaced code held by an action in another context is dropped, not duplicated', () => {
    const e = editor();
    // Menu-context actions may share a code with gameplay ones; bind inventory (menu) to KeyR.
    e.assign('inventory', 1, 'KeyR');
    const conflict = conflictOf(e.assign('dodge', 0, 'ShiftLeft'));
    const result = e.swap(conflict);
    expect(result).toEqual({ status: 'applied' });
    expect(findConflicts(e.bindings)).toEqual([]);
  });

  it('AC-3: a swap that would strip Pause of its last binding is refused', () => {
    const e = editor();
    e.clear('pause', 1);
    const conflict = conflictOf(e.assign('jump', 1, 'Escape'));
    const result = e.swap(conflict);
    expect(result.status).toBe('refused');
    expect(e.bindings.pause).toEqual(['Escape']);
    expect(e.bindings.jump).toEqual(['Space']);
  });

  it('a swap that hands the required action the displaced code is allowed', () => {
    const e = editor();
    e.clear('pause', 1);
    const result = e.swap(conflictOf(e.assign('pause', 0, 'KeyE')));
    expect(result).toEqual({ status: 'applied' });
    expect(e.bindings.pause).toEqual(['KeyE']);
    expect(e.bindings.interact).toEqual(['Escape']);
  });
});

describe('clearing and resetting', () => {
  it('clears one slot, and an empty slot is a no-op', () => {
    const e = editor();
    expect(e.clear('pause', 1)).toEqual({ status: 'applied' });
    expect(e.bindings.pause).toEqual(['Escape']);
    expect(e.clear('dodge', 1)).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual(['KeyR']);
  });

  it('AC-3: unbinding the last binding of Pause is refused with an explanation', () => {
    const e = editor();
    e.clear('pause', 1);
    const result = e.clear('pause', 0);
    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.reason).toContain('Pause needs at least one keyboard or mouse binding');
    }
    expect(e.bindings.pause).toEqual(['Escape']);
  });

  it('AC-3: Pause is the required action, and other actions may be left unbound', () => {
    expect(REQUIRED_ACTIONS).toEqual(['pause']);
    const e = editor();
    expect(e.clear('dodge', 0)).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual([]);
  });

  it('resets one action to its defaults', () => {
    const e = editor();
    e.assign('dodge', 0, 'KeyF');
    expect(e.resetAction('dodge')).toEqual({ status: 'applied' });
    expect(e.bindings.dodge).toEqual(DEFAULT_BINDINGS.dodge);
  });

  it('refuses to reset an action whose default code another action took, naming it', () => {
    const e = editor();
    e.swap(conflictOf(e.assign('dodge', 0, 'ShiftLeft')));
    const result = e.resetAction('sprint');
    expect(result.status).toBe('refused');
    if (result.status === 'refused') expect(result.reason).toContain('Dodge');
    expect(e.bindings.sprint).toEqual(['KeyR']);
  });

  it('resets everything and saves it', () => {
    const store = createSettingsStore();
    const e = editor(store);
    e.assign('dodge', 0, 'KeyF');
    e.resetAll();
    expect(e.bindings).toBe(DEFAULT_BINDINGS);
    expect(loadBindings(store).bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('AC-5: a new editor on the same store starts from the saved bindings', () => {
    const store = createSettingsStore();
    editor(store).assign('dodge', 0, 'KeyF');
    expect(editor(store).bindings.dodge).toEqual(['KeyF']);
  });
});

describe('action labels', () => {
  it('names move directions and reads button labels from the action map', () => {
    expect(actionLabel('moveForward')).toBe('Move forward');
    expect(actionLabel('moveBack')).toBe('Move back');
    expect(actionLabel('moveLeft')).toBe('Move left');
    expect(actionLabel('moveRight')).toBe('Move right');
    expect(actionLabel('dodge')).toBe('Dodge');
  });
});

describe('tryRebind', () => {
  it('binds a free code and keeps the set as it was when the code clashes', () => {
    expect(tryRebind(DEFAULT_BINDINGS, 'dodge', 'KeyF', 0).dodge).toEqual(['KeyF']);
    expect(tryRebind(DEFAULT_BINDINGS, 'dodge', 'ShiftLeft', 0)).toBe(DEFAULT_BINDINGS);
  });
});
