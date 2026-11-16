// Gamepad input (mw-e02.9): the pure half. The browser's Gamepad API is polled once per sim tick by
// the thin adapter in gamepad-dom.ts; everything that decides what a pad means lives here and in the
// ActionSampler, and is unit-tested with fake Gamepad objects.
//
// Only the W3C "standard" mapping is read (Xbox and PlayStation pads report it in Chrome, Firefox and
// Safari): buttons 0–16 and axes 0–3 at fixed positions. Pad buttons become input codes (`PadA`,
// `PadRT`, …) that bind to actions exactly like keys do; the codes name standard-mapping positions by
// their Xbox labels, so `PadA` is Cross on a PlayStation pad.

import { actionVector, stickVector, type ActionVector } from '@sim/index';

/** Which kind of device the player last used (prompt glyphs follow it, mw-e02.9 AC-5). */
export type InputDevice = 'keyboardMouse' | 'gamepad';

/** Standard-mapping buttons in index order, as input codes. */
export const PAD_BUTTONS = [
  'PadA',
  'PadB',
  'PadX',
  'PadY',
  'PadLB',
  'PadRB',
  'PadLT',
  'PadRT',
  'PadView',
  'PadMenu',
  'PadLS',
  'PadRS',
  'PadUp',
  'PadDown',
  'PadLeft',
  'PadRight',
  'PadGuide',
] as const;

export type PadCode = (typeof PAD_BUTTONS)[number];

/** Whether `code` is a gamepad button code. */
export function isPadCode(code: string): code is PadCode {
  return (PAD_BUTTONS as readonly string[]).includes(code);
}

/** A chord: a held modifier and a pressed button, `PadLT+PadUp` (the modifier first). */
export function isPadChord(code: string): boolean {
  const parts = code.split('+');
  return parts.length === 2 && parts.every(isPadCode) && parts[0] !== parts[1];
}

/** The pad buttons a chord code names: the modifier, then the button. */
export function padChordParts(code: string): readonly PadCode[] {
  return code.split('+').filter(isPadCode);
}

/** Whether `code` is a pad button or a chord of two. */
export function isPadInputCode(code: string): boolean {
  return isPadCode(code) || isPadChord(code);
}

/** The analog triggers (standard buttons 6 and 7): pressed past a threshold, not at first touch. */
const TRIGGERS: ReadonlySet<number> = new Set([6, 7]);

/** The parts of the browser's Gamepad this game reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/** Pad tuning. The settings UI (mw-e31) will expose these; the defaults are the bead's. */
export interface GamepadSettings {
  /** Left-stick deflection at or below this (0–1, radial) is no movement (mw-e02.9 AC-1). */
  readonly moveDeadzone: number;
  /** A trigger counts as pressed past this pull (0–1). */
  readonly triggerThreshold: number;
  /**
   * Sprint on the pad latches: a click turns it on, it stays on until the left stick comes back to
   * centre or it is clicked again. Off: sprint is held like a key.
   */
  readonly sprintToggle: boolean;
  /** A pad disconnecting pauses the game (emits the pause action). */
  readonly pauseOnDisconnect: boolean;
}

export const DEFAULT_GAMEPAD_SETTINGS: GamepadSettings = Object.freeze({
  moveDeadzone: 0.15,
  triggerThreshold: 0.3,
  sprintToggle: true,
  pauseOnDisconnect: true,
});

/** One poll of a pad: buttons down and both sticks, raw (no deadzone), x right and y up. */
export interface PadSnapshot {
  readonly buttons: ReadonlySet<PadCode>;
  readonly left: ActionVector;
  readonly right: ActionVector;
}

const ZERO = actionVector(0, 0);

/** An idle pad: no buttons, sticks centred. */
export const IDLE_PAD: PadSnapshot = Object.freeze({
  buttons: new Set<PadCode>(),
  left: ZERO,
  right: ZERO,
});

const axis = (axes: readonly number[], i: number): number => {
  const value = axes[i];
  return value !== undefined && Number.isFinite(value) ? value : 0;
};

/**
 * Reads a standard-mapping pad. The Gamepad API's stick y is down-positive; the snapshot's is up.
 * Buttons beyond the pad's array read up; a trigger is down past `triggerThreshold`.
 */
export function readPad(
  pad: GamepadLike,
  settings: Pick<GamepadSettings, 'triggerThreshold'> = DEFAULT_GAMEPAD_SETTINGS,
): PadSnapshot {
  const buttons = new Set<PadCode>();
  PAD_BUTTONS.forEach((code, i) => {
    const button = pad.buttons[i];
    if (button === undefined) return;
    const down = TRIGGERS.has(i) ? button.value > settings.triggerThreshold : button.pressed;
    if (down) buttons.add(code);
  });
  return {
    buttons,
    left: actionVector(axis(pad.axes, 0), -axis(pad.axes, 1)),
    right: actionVector(axis(pad.axes, 2), -axis(pad.axes, 3)),
  };
}

/**
 * The pad to read: the current one while it stays connected, otherwise the first connected pad with
 * the standard mapping (others are ignored: their layouts are unknown). Undefined when there is none.
 */
export function choosePad(
  pads: readonly (GamepadLike | null)[],
  current?: number,
): GamepadLike | undefined {
  const usable = (pad: GamepadLike | null | undefined): pad is GamepadLike =>
    pad !== null && pad !== undefined && pad.connected && pad.mapping === 'standard';
  if (current !== undefined) {
    const kept = pads.find((pad) => pad?.index === current);
    if (usable(kept)) return kept;
  }
  return pads.find(usable);
}

/**
 * The rescaled radial deadzone (mw-e02.9 AC-1/2): a deflection of `deadzone` or less is centred, and
 * the live range from the deadzone to full deflection maps linearly onto 0–1 in the same direction,
 * so the stick has no dead jump at the edge of the zone. Quantised (see STICK_QUANTUM), length ≤ 1.
 */
export function radialDeadzone(stick: ActionVector, deadzone: number): ActionVector {
  const length = Math.sqrt(stick.x * stick.x + stick.y * stick.y);
  if (length <= deadzone) return ZERO;
  const live = (Math.min(1, length) - deadzone) / (1 - deadzone);
  return stickVector((stick.x / length) * live, (stick.y / length) * live);
}

/** A vector's length. */
export function magnitude(v: ActionVector): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Keyboard and pad movement in one tick (mw-e02.9 AC-3): the longer vector wins whole (a tie keeps
 * the keyboard's), never a sum, so the result is never longer than 1.
 */
export function mergeMove(keyboard: ActionVector, pad: ActionVector): ActionVector {
  return magnitude(pad) > magnitude(keyboard) ? pad : keyboard;
}
