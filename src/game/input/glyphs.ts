// Input glyphs (mw-e02.9 AC-5): the label a prompt shows for an action on the device the player last
// used. Xbox labels for the pad (the default; the owner's test device), key and mouse names for
// keyboard + mouse. Plain text for now; mw-e37.133 swaps in the approved glyph art by the same keys.

import type { BindableAction, Bindings, InputCode } from './bindings';
import { isPadCode, isPadChord, padChordParts, type InputDevice, type PadCode } from './gamepad';

/** Xbox labels for the standard-mapping buttons. */
export const XBOX_GLYPHS: Readonly<Record<PadCode, string>> = Object.freeze({
  PadA: 'A',
  PadB: 'B',
  PadX: 'X',
  PadY: 'Y',
  PadLB: 'LB',
  PadRB: 'RB',
  PadLT: 'LT',
  PadRT: 'RT',
  PadView: 'View',
  PadMenu: 'Menu',
  PadLS: 'LS',
  PadRS: 'RS',
  PadUp: 'D-pad Up',
  PadDown: 'D-pad Down',
  PadLeft: 'D-pad Left',
  PadRight: 'D-pad Right',
  PadGuide: 'Xbox',
});

const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
};

/**
 * A readable name for an input code: `KeyW` → `W`, `Digit1` → `1`, `ShiftLeft` → `Shift`,
 * `Mouse0` → `Left click`, `PadA` → `A`. Unknown codes read as themselves.
 */
export function codeLabel(code: InputCode): string {
  if (isPadCode(code)) return XBOX_GLYPHS[code];
  if (isPadChord(code))
    return padChordParts(code)
      .map((part) => XBOX_GLYPHS[part])
      .join(' + ');
  const named = NAMED_KEYS[code];
  if (named !== undefined) return named;
  const letter = /^(?:Key|Digit)(.)$/.exec(code);
  if (letter?.[1] !== undefined) return letter[1];
  const sided = /^(Shift|Control|Alt|Meta)(?:Left|Right)$/.exec(code);
  if (sided?.[1] !== undefined) return sided[1] === 'Control' ? 'Ctrl' : sided[1];
  return code;
}

/** The bindings for each device. */
export interface DeviceBindings {
  readonly keyboardMouse: Bindings;
  readonly gamepad: Bindings;
}

/** Shown for an action with no binding on the device. */
export const UNBOUND_GLYPH = '(unbound)';

/**
 * The glyph a prompt shows for `action` on `device`: the label of its primary binding there. Moving
 * on the pad is always the left stick; on the keyboard the four primary keys run together (`WASD`)
 * when each is a single character, else they are joined with slashes.
 */
export function inputGlyph(
  action: BindableAction | 'move' | 'look',
  device: InputDevice,
  bindings: DeviceBindings,
): string {
  if (action === 'look') return device === 'gamepad' ? 'Right stick' : 'Mouse';
  if (action === 'move') {
    if (device === 'gamepad') return 'Left stick';
    const keys = (['moveForward', 'moveLeft', 'moveBack', 'moveRight'] as const).map((direction) =>
      inputGlyph(direction, device, bindings),
    );
    return keys.every((key) => key.length === 1) ? keys.join('') : keys.join('/');
  }
  const [primary] = bindings[device][action];
  return primary === undefined ? UNBOUND_GLYPH : codeLabel(primary);
}
