// Abstract player actions and the per-tick ActionFrame (mw-e02.1). The sim never sees keys or mouse
// buttons: src/game/input maps them through remappable bindings to one ActionFrame per fixed tick,
// fed to `World.step` among that tick's commands. A frame is plain, frozen JSON data (no tick number,
// so identical idle ticks run-length encode in replays), and it satisfies the controller's
// MovementActions structurally: `{ actions: frame, cameraYaw }` is a CharacterInput.

import type { ButtonState } from '../character/controller';

/** Which input context an action belongs to; bindings only conflict within a context (or global). */
export type ActionContext = 'gameplay' | 'global';

/** One entry of the action registry. */
export interface ActionDef {
  /** `button`: digital with edges; `vector`: 2D analog. */
  readonly kind: 'button' | 'vector';
  /** Player-facing name (the remapping UI, mw-e31, shows it). */
  readonly label: string;
  /** Global actions conflict with a binding in any context. */
  readonly context: ActionContext;
}

/** The action registry: every abstract action the game reacts to, in display order. */
export const ACTIONS = {
  move: { kind: 'vector', label: 'Move', context: 'gameplay' },
  look: { kind: 'vector', label: 'Look', context: 'gameplay' },
  jump: { kind: 'button', label: 'Jump', context: 'gameplay' },
  sprint: { kind: 'button', label: 'Sprint', context: 'gameplay' },
  crouch: { kind: 'button', label: 'Crouch', context: 'gameplay' },
  slowWalk: { kind: 'button', label: 'Slow walk', context: 'gameplay' },
  dodge: { kind: 'button', label: 'Dodge', context: 'gameplay' },
  interact: { kind: 'button', label: 'Interact', context: 'gameplay' },
  lockOn: { kind: 'button', label: 'Lock on', context: 'gameplay' },
  cycleTarget: { kind: 'button', label: 'Cycle target', context: 'gameplay' },
  primaryAttack: { kind: 'button', label: 'Primary attack', context: 'gameplay' },
  secondaryAttack: { kind: 'button', label: 'Secondary attack', context: 'gameplay' },
  ability1: { kind: 'button', label: 'Ability 1', context: 'gameplay' },
  ability2: { kind: 'button', label: 'Ability 2', context: 'gameplay' },
  ability3: { kind: 'button', label: 'Ability 3', context: 'gameplay' },
  ability4: { kind: 'button', label: 'Ability 4', context: 'gameplay' },
  // The selected spell (mw-e06.15): press to cast, hold to channel; cancel calls a cast off.
  cast: { kind: 'button', label: 'Cast spell', context: 'gameplay' },
  cancelCast: { kind: 'button', label: 'Cancel cast', context: 'gameplay' },
  // The spell hotbar (mw-e06.16): a key per slot, previous/next spell, and the hold-to-open wheel.
  spellSlot1: { kind: 'button', label: 'Spell slot 1', context: 'gameplay' },
  spellSlot2: { kind: 'button', label: 'Spell slot 2', context: 'gameplay' },
  spellSlot3: { kind: 'button', label: 'Spell slot 3', context: 'gameplay' },
  spellSlot4: { kind: 'button', label: 'Spell slot 4', context: 'gameplay' },
  spellSlot5: { kind: 'button', label: 'Spell slot 5', context: 'gameplay' },
  spellSlot6: { kind: 'button', label: 'Spell slot 6', context: 'gameplay' },
  spellSlot7: { kind: 'button', label: 'Spell slot 7', context: 'gameplay' },
  spellSlot8: { kind: 'button', label: 'Spell slot 8', context: 'gameplay' },
  spellPrev: { kind: 'button', label: 'Previous spell', context: 'gameplay' },
  spellNext: { kind: 'button', label: 'Next spell', context: 'gameplay' },
  spellWheel: { kind: 'button', label: 'Spell wheel (hold)', context: 'gameplay' },
  inventory: { kind: 'button', label: 'Inventory', context: 'gameplay' },
  // The selected item (mw-e17.7): drop its stack in front of you, or throw one along your look.
  drop: { kind: 'button', label: 'Drop item', context: 'gameplay' },
  throw: { kind: 'button', label: 'Throw item', context: 'gameplay' },
  pause: { kind: 'button', label: 'Pause', context: 'global' },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;

/** The digital actions (every registry entry of kind `button`). */
export type ButtonAction = {
  [K in ActionId]: (typeof ACTIONS)[K]['kind'] extends 'button' ? K : never;
}[ActionId];

/** Every button action, in registry order. */
export const BUTTON_ACTIONS: readonly ButtonAction[] = Object.freeze(
  (Object.keys(ACTIONS) as ActionId[]).filter(
    (id): id is ButtonAction => ACTIONS[id].kind === 'button',
  ),
);

/** A digital action this tick: the controller's ButtonState plus the release edge. */
export interface ActionButton extends ButtonState {
  /** Went up this tick. A tap inside one tick reports pressed and released, with held false. */
  readonly released: boolean;
}

/**
 * A 2D vector. `move`: x right, y forward, length ≤ 1. `look`: mouse counts, x right, y up.
 * `lookStick`: right-stick deflection, x right, y up, length ≤ 1.
 */
export interface ActionVector {
  readonly x: number;
  readonly y: number;
}

/** The command `kind` that marks an ActionFrame among a tick's commands. */
export const ACTION_FRAME_COMMAND = 'input.actions' as const;

/** Every action's state for one sim tick. */
export type ActionFrame = {
  readonly kind: typeof ACTION_FRAME_COMMAND;
  readonly move: ActionVector;
  /** Look delta since the previous tick, raw mouse counts (sensitivity is applied downstream). */
  readonly look: ActionVector;
  /**
   * Analog look this tick (mw-e02.9): the right stick's raw deflection, quantised by `stickVector`.
   * A rate, not a delta: the sim applies the look deadzone, response curve and turn rates.
   */
  readonly lookStick: ActionVector;
} & Readonly<Record<ButtonAction, ActionButton>>;

const button = (pressed: boolean, held: boolean, released: boolean): ActionButton =>
  Object.freeze({ pressed, held, released });
const pair = (pressed: boolean, held: boolean) =>
  [button(pressed, held, false), button(pressed, held, true)] as const;

// Eight frozen values, indexed [pressed][held][released], cover every combination, so frames
// allocate no button objects.
const BUTTONS = [
  [pair(false, false), pair(false, true)],
  [pair(true, false), pair(true, true)],
] as const;

/** The shared frozen ActionButton for these edges. */
export function actionButton(pressed: boolean, held: boolean, released: boolean): ActionButton {
  return BUTTONS[pressed ? 1 : 0][held ? 1 : 0][released ? 1 : 0];
}

/** Everything a frame carries besides its kind. */
export interface ActionFrameParts {
  readonly move: ActionVector;
  readonly look: ActionVector;
  /** Defaults to centred. */
  readonly lookStick?: ActionVector;
  readonly buttons: (action: ButtonAction) => ActionButton;
}

const ZERO: ActionVector = Object.freeze({ x: 0, y: 0 });

/** A frozen vector; -0 becomes 0 so frames survive a JSON round trip (replays reject -0). */
export function actionVector(x: number, y: number): ActionVector {
  if (x === 0 && y === 0) return ZERO;
  return Object.freeze({ x: x + 0, y: y + 0 });
}

/**
 * The analog resolution of every stick value in an ActionFrame: thousandths of full deflection.
 *
 * Replays store frames as JSON and must replay bit for bit. `stickVector` rounds each axis to the
 * nearest k / 1000 (k an integer, computed as `Math.round(v * 1000) / 1000`, which IEEE-754 makes
 * the double closest to k / 1000 on every engine), so a value is short in JSON (`0.575`) and
 * parses back to the same double. 1/1000 is finer than a pad's hardware (typically 8–16 bit axes,
 * reported after the browser's own filtering), so rounding is not felt.
 */
export const STICK_QUANTUM = 1 / 1000;
const STICK_STEPS = 1000;

/**
 * A stick vector quantised to STICK_QUANTUM per axis, with length ≤ 1: a longer input is scaled
 * back onto the unit circle, and when rounding to the nearest step would push the length past 1,
 * both axes round towards zero instead. Non-finite axes read 0.
 */
export function stickVector(x: number, y: number): ActionVector {
  let fx = Number.isFinite(x) ? x : 0;
  let fy = Number.isFinite(y) ? y : 0;
  // Many pads report a square-ish range (both axes near 1 on a diagonal): scale back to the circle.
  const length = Math.sqrt(fx * fx + fy * fy);
  if (length > 1) {
    fx /= length;
    fy /= length;
  }
  let qx = Math.round(fx * STICK_STEPS);
  let qy = Math.round(fy * STICK_STEPS);
  if (qx * qx + qy * qy > STICK_STEPS * STICK_STEPS) {
    qx = Math.trunc(fx * STICK_STEPS);
    qy = Math.trunc(fy * STICK_STEPS);
  }
  return actionVector(qx / STICK_STEPS, qy / STICK_STEPS);
}

/** Builds a frozen ActionFrame. */
export function actionFrame(parts: ActionFrameParts): ActionFrame {
  const frame: Record<string, unknown> = {
    kind: ACTION_FRAME_COMMAND,
    move: parts.move,
    look: parts.look,
    lookStick: parts.lookStick ?? ZERO,
  };
  for (const action of BUTTON_ACTIONS) frame[action] = parts.buttons(action);
  return Object.freeze(frame) as ActionFrame;
}

const UP = actionButton(false, false, false);

/** No input: sticks centred, no look, every button up. */
export const IDLE_ACTION_FRAME: ActionFrame = actionFrame({
  move: ZERO,
  look: ZERO,
  buttons: () => UP,
});

/** True for an ActionFrame among arbitrary step inputs. */
export function isActionFrame(input: unknown): input is ActionFrame {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === ACTION_FRAME_COMMAND
  );
}

/** The tick's ActionFrame (the first, if several), or undefined when none was sampled. */
export function actionFrameOf(inputs: readonly unknown[]): ActionFrame | undefined {
  return inputs.find(isActionFrame);
}
