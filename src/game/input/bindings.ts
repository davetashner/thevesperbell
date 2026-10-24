// Remappable key, mouse and gamepad bindings (mw-e02.1, mw-e02.9). A Bindings value maps every
// bindable action to up to MAX_SLOTS input codes: KeyboardEvent.code for keys ("KeyW", "Space"),
// "Mouse<button>" for mouse buttons and "Pad<button>" for gamepad buttons (gamepad.ts). Keyboard +
// mouse and gamepad each have their own Bindings set, remapped with the same functions and the same
// conflict rules; both are live at once. Bindings are immutable; `rebind` returns a new set or a
// conflict and never half-applies. `serializeBindings` / `deserializeBindings` are the seam the
// settings store (mw-e02.22) persists through: plain JSON out, validated and conflict-checked on the
// way back in.

import { ACTIONS, BUTTON_ACTIONS, type ActionContext, type ButtonAction } from '@sim/index';
import { isPadCode } from './gamepad';

/** The four directions of the move vector, bound like buttons. */
export const MOVE_DIRECTIONS = ['moveForward', 'moveBack', 'moveLeft', 'moveRight'] as const;
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/**
 * Anything a key, mouse or pad button can be bound to. Look always comes from mouse movement and
 * the right stick; the left stick always moves (it adds to the move directions, see mergeMove).
 */
export type BindableAction = MoveDirection | ButtonAction;

/** Every bindable action: move directions first, then buttons in registry order. */
export const BINDABLE_ACTIONS: readonly BindableAction[] = Object.freeze([
  ...MOVE_DIRECTIONS,
  ...BUTTON_ACTIONS,
]);

/** Codes per action (primary, secondary). */
export const MAX_SLOTS = 2;

/** An input code: KeyboardEvent.code, `Mouse<n>` for MouseEvent.button n, or a PadCode. */
export type InputCode = string;

/** The code for a mouse button (0 left, 1 middle, 2 right, 3 back, 4 forward). */
export function mouseCode(button: number): InputCode {
  return `Mouse${String(button)}`;
}

/** KeyboardEvent.code values (UI Events spec) that can be bound; anything else is not a key. */
const KEY_CODES: ReadonlySet<string> = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${String(i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${String(i)}`),
  ...Array.from({ length: 24 }, (_, i) => `F${String(i + 1)}`),
  ...['Up', 'Down', 'Left', 'Right'].map((d) => `Arrow${d}`),
  ...['Add', 'Subtract', 'Multiply', 'Divide', 'Decimal', 'Enter', 'Equal', 'Comma'].map(
    (k) => `Numpad${k}`,
  ),
  ...['Shift', 'Control', 'Alt', 'Meta'].flatMap((m) => [`${m}Left`, `${m}Right`]),
  ...['Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon'],
  ...['Quote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'IntlYen', 'IntlRo'],
  ...['Escape', 'Backspace', 'Tab', 'Enter', 'Space', 'CapsLock', 'ContextMenu'],
  ...['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'PrintScreen', 'ScrollLock'],
  ...['Pause', 'NumLock'],
]);

/** Mouse buttons a binding can name: left, middle, right, back, forward. */
const MOUSE_BUTTONS = 5;

/** Whether `code` is a keyboard or mouse code this game can bind (not a pad code). */
export function isKeyboardMouseCode(code: string): boolean {
  if (KEY_CODES.has(code)) return true;
  return Array.from({ length: MOUSE_BUTTONS }, (_, i) => mouseCode(i)).includes(code);
}

export type Bindings = Readonly<Record<BindableAction, readonly InputCode[]>>;

/** Default keyboard + mouse layout. */
export const DEFAULT_BINDINGS: Bindings = freezeBindings({
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  crouch: ['KeyC'],
  slowWalk: ['KeyX'],
  dodge: ['KeyR'],
  interact: ['KeyE'],
  lockOn: ['KeyQ', mouseCode(1)],
  cycleTarget: ['Tab'],
  primaryAttack: [mouseCode(0)],
  secondaryAttack: [mouseCode(2)],
  ability1: ['Digit1'],
  ability2: ['Digit2'],
  ability3: ['Digit3'],
  ability4: ['Digit4'],
  cast: ['KeyV'],
  cancelCast: ['KeyB'],
  // Spell slots (mw-e06.16): the number row's 1-4 are the class abilities, so slots 1-4 sit on the
  // numpad and 5-8 on both; [ and ] step through the bar, and Z holds the wheel.
  spellSlot1: ['Numpad1'],
  spellSlot2: ['Numpad2'],
  spellSlot3: ['Numpad3'],
  spellSlot4: ['Numpad4'],
  spellSlot5: ['Digit5', 'Numpad5'],
  spellSlot6: ['Digit6', 'Numpad6'],
  spellSlot7: ['Digit7', 'Numpad7'],
  spellSlot8: ['Digit8', 'Numpad8'],
  spellPrev: ['BracketLeft'],
  spellNext: ['BracketRight'],
  spellWheel: ['KeyZ'],
  inventory: ['KeyI'],
  drop: ['KeyG'],
  throw: ['KeyT'],
  pause: ['Escape', 'KeyP'],
});

/**
 * Default gamepad layout (Xbox labels; standard mapping), after common action-RPG conventions. The
 * left stick moves and the right stick looks; neither is a binding. The shoulder controls are the
 * combat cluster selected in mw-e04.39: RB (PlayStation R1) attacks with the right hand, RT/R2 is
 * the strong attack, LB/L1 is the left-hand action (the knight's shield parry), and LT/L2 holds the
 * shield up. RS/R3 crouches, so lock-on moves to Y/Triangle. Slow walk has no button: a light push
 * of the left stick is the pad's slow walk (mw-e02.10). See docs/design/controls.md for the table.
 */
export const DEFAULT_PAD_BINDINGS: Bindings = freezeBindings({
  moveForward: [],
  moveBack: [],
  moveLeft: [],
  moveRight: [],
  jump: ['PadA'],
  sprint: ['PadLS'],
  crouch: ['PadRS'],
  slowWalk: [],
  dodge: ['PadB'],
  interact: ['PadX'],
  lockOn: ['PadY'],
  cycleTarget: [],
  primaryAttack: ['PadRB'],
  secondaryAttack: ['PadLT'],
  ability1: ['PadRT'],
  ability2: ['PadRight'],
  ability3: ['PadLB'],
  ability4: ['PadLeft'],
  cast: ['PadUp'],
  cancelCast: ['PadDown'],
  spellSlot1: [],
  spellSlot2: [],
  spellSlot3: [],
  spellSlot4: [],
  spellSlot5: [],
  spellSlot6: [],
  spellSlot7: [],
  spellSlot8: [],
  spellPrev: [],
  spellNext: [],
  spellWheel: ['PadGuide'],
  inventory: ['PadView'],
  drop: [],
  throw: [],
  pause: ['PadMenu'],
});

function freezeBindings(bindings: Bindings): Bindings {
  const frozen: Partial<Record<BindableAction, readonly InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) frozen[action] = Object.freeze([...bindings[action]]);
  return Object.freeze(frozen) as Bindings;
}

/** The input context a bindable action belongs to. */
export function contextOf(action: BindableAction): ActionContext {
  return (MOVE_DIRECTIONS as readonly string[]).includes(action)
    ? ACTIONS.move.context
    : ACTIONS[action as ButtonAction].context;
}

/** Whether a code on both actions would clash: same context, or either one global. */
function sharesContext(a: BindableAction, b: BindableAction): boolean {
  const ca = contextOf(a);
  const cb = contextOf(b);
  return ca === cb || ca === 'global' || cb === 'global';
}

/** Two actions claiming the same code. */
export interface BindingConflict {
  readonly code: InputCode;
  /** The action being rebound, then the action that already holds the code. */
  readonly actions: readonly [BindableAction, BindableAction];
}

export type RebindResult =
  | { readonly ok: true; readonly bindings: Bindings }
  | { readonly ok: false; readonly conflict: BindingConflict };

/**
 * Binds `code` to `action` in `slot` (0 primary, 1 secondary; a slot past the action's last code
 * appends). If another action in a clashing context already uses the code, returns that conflict and
 * `bindings` is left as it was. Binding a code the action already has in another slot moves it.
 */
export function rebind(
  bindings: Bindings,
  action: BindableAction,
  code: InputCode,
  slot = 0,
): RebindResult {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS) {
    throw new RangeError(`binding slot must be 0–${String(MAX_SLOTS - 1)}, got ${String(slot)}`);
  }
  if (code === '') throw new RangeError('input code must not be empty');
  for (const other of BINDABLE_ACTIONS) {
    if (other !== action && sharesContext(action, other) && bindings[other].includes(code)) {
      return { ok: false, conflict: { code, actions: [action, other] } };
    }
  }
  const codes = bindings[action].filter((existing) => existing !== code);
  if (slot < codes.length) codes[slot] = code;
  else codes.push(code);
  return { ok: true, bindings: freezeBindings({ ...bindings, [action]: codes }) };
}

/** Removes the code in `slot` from `action` (no-op when the slot is empty). */
export function unbind(bindings: Bindings, action: BindableAction, slot = 0): Bindings {
  const codes = bindings[action];
  if (slot < 0 || slot >= codes.length) return bindings;
  return freezeBindings({ ...bindings, [action]: codes.filter((_, i) => i !== slot) });
}

/** Every clash in a bindings set (each pair once, in BINDABLE_ACTIONS order). */
export function findConflicts(bindings: Bindings): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  BINDABLE_ACTIONS.forEach((action, i) => {
    const clashing = BINDABLE_ACTIONS.slice(i + 1).filter((other) => sharesContext(action, other));
    for (const other of clashing) {
      for (const code of bindings[action]) {
        if (bindings[other].includes(code)) conflicts.push({ code, actions: [action, other] });
      }
    }
  });
  return conflicts;
}

/** The actions bound to each code: what the sampler looks up. */
export function actionsByCode(
  bindings: Bindings,
): ReadonlyMap<InputCode, readonly BindableAction[]> {
  const map = new Map<InputCode, BindableAction[]>();
  for (const action of BINDABLE_ACTIONS) {
    for (const code of bindings[action]) {
      const list = map.get(code);
      if (list) list.push(action);
      else map.set(code, [action]);
    }
  }
  return map;
}

/**
 * The persisted form of the bindings (JSON). Version 2 (mw-e02.9) adds `gamepad`; version 1 data
 * (keyboard + mouse only) still reads, with the default pad layout.
 */
export interface BindingsData {
  readonly version: typeof BINDINGS_DATA_VERSION;
  /** Keyboard + mouse codes per action. */
  readonly actions: Readonly<Partial<Record<BindableAction, readonly InputCode[]>>>;
  /** Gamepad codes per action. */
  readonly gamepad: Readonly<Partial<Record<BindableAction, readonly InputCode[]>>>;
}

export const BINDINGS_DATA_VERSION = 2;

const plain = (bindings: Bindings): Partial<Record<BindableAction, InputCode[]>> => {
  const actions: Partial<Record<BindableAction, InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) actions[action] = [...bindings[action]];
  return actions;
};

/** Plain JSON for the settings store: the keyboard + mouse set and the gamepad set. */
export function serializeBindings(
  bindings: Bindings,
  gamepad: Bindings = DEFAULT_PAD_BINDINGS,
): BindingsData {
  return { version: BINDINGS_DATA_VERSION, actions: plain(bindings), gamepad: plain(gamepad) };
}

export interface DeserializedBindings {
  /** Keyboard + mouse. */
  readonly bindings: Bindings;
  readonly gamepad: Bindings;
  /** Problems found; entries they affect fall back to the defaults. Empty when the data was clean. */
  readonly issues: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCodes(value: unknown, pad: boolean): value is InputCode[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SLOTS &&
    value.every(
      (code) => typeof code === 'string' && (pad ? isPadCode(code) : isKeyboardMouseCode(code)),
    ) &&
    new Set(value).size === value.length
  );
}

/** Reads one device's set; `label` prefixes its issues. Conflicts fall back to `defaults` whole. */
function readSet(
  stored: Record<string, unknown>,
  defaults: Bindings,
  pad: boolean,
  label: string,
): { bindings: Bindings; issues: string[] } {
  const issues: string[] = [];
  const merged: Partial<Record<BindableAction, readonly InputCode[]>> = {};
  for (const action of BINDABLE_ACTIONS) {
    const codes = stored[action];
    if (validCodes(codes, pad)) {
      merged[action] = codes;
    } else {
      if (codes !== undefined) issues.push(`${label}${action}: invalid codes; using defaults`);
      merged[action] = defaults[action];
    }
  }
  for (const key of Object.keys(stored)) {
    if (!(BINDABLE_ACTIONS as readonly string[]).includes(key)) {
      issues.push(`${label}${key}: unknown action ignored`);
    }
  }
  const bindings = freezeBindings(merged as Bindings);
  const conflicts = findConflicts(bindings);
  if (conflicts.length > 0) {
    const list = conflicts.map((c) => `${c.code} (${c.actions.join(', ')})`).join('; ');
    return {
      bindings: defaults,
      issues: [...issues, `${label}conflicting bindings ${list}; using defaults`],
    };
  }
  return { bindings, issues };
}

/**
 * Reads persisted bindings. Unknown actions are ignored and missing or malformed ones keep their
 * default codes, each noted in `issues` (keyboard + mouse sets take no pad codes, gamepad sets only
 * pad codes). If a set would contain a conflict, or is missing, that set's defaults are used whole;
 * if the data is not version-1 or version-2 bindings at all, every default is. Version 1 predates
 * gamepads: its pad set is the default, silently.
 */
export function deserializeBindings(
  data: unknown,
  defaults: Bindings = DEFAULT_BINDINGS,
  padDefaults: Bindings = DEFAULT_PAD_BINDINGS,
): DeserializedBindings {
  const version = isRecord(data) ? data['version'] : undefined;
  if (
    !isRecord(data) ||
    (version !== 1 && version !== BINDINGS_DATA_VERSION) ||
    !isRecord(data['actions'])
  ) {
    return {
      bindings: defaults,
      gamepad: padDefaults,
      issues: ['not version 1 or 2 bindings data; using defaults'],
    };
  }
  const keyboard = readSet(data['actions'], defaults, false, '');
  const storedPad = data['gamepad'];
  const pad =
    version === 1
      ? { bindings: padDefaults, issues: [] }
      : isRecord(storedPad)
        ? readSet(storedPad, padDefaults, true, 'gamepad ')
        : { bindings: padDefaults, issues: ['gamepad: missing; using defaults'] };
  return {
    bindings: keyboard.bindings,
    gamepad: pad.bindings,
    issues: [...keyboard.issues, ...pad.issues],
  };
}
