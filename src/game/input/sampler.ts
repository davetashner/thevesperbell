// Per-tick action sampling (mw-e02.1, mw-e02.9). The DOM adapter (dom.ts) pushes raw input events
// into an ActionSampler as they arrive; once per fixed sim tick the frame loop calls `sample()`, which
// first runs the pollers (the gamepad adapter, gamepad-dom.ts, hands over this tick's pad snapshot),
// then replays the events queued since the previous tick through the current bindings and returns one
// frozen ActionFrame. Replaying the queue in order is what keeps taps: a key that goes down and up
// between two samples reports pressed and released on the same frame (held false). No DOM here, so
// every rule is unit-tested with plain calls.
//
// Keyboard + mouse and gamepad are equal inputs merged into the one frame: pad buttons are codes
// held while down (through the pad bindings), so a button and a key on the same action OR together;
// movement takes the longer of the key vector and the left stick after its deadzone (mergeMove); the
// right stick is the frame's `lookStick`, beside the mouse's `look`.

import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  stickVector,
  type ActionButton,
  type ActionFrame,
  type ButtonAction,
} from '@sim/index';
import type { CommandSampler } from '../loop';
import {
  actionsByCode,
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  type BindableAction,
  type Bindings,
  type InputCode,
  type MoveDirection,
} from './bindings';
import {
  DEFAULT_GAMEPAD_SETTINGS,
  IDLE_PAD,
  isPadCode,
  magnitude,
  mergeMove,
  PAD_BUTTONS,
  radialDeadzone,
  type GamepadSettings,
  type InputDevice,
  type PadCode,
  type PadSnapshot,
} from './gamepad';

type RawEvent =
  | { readonly type: 'down'; readonly code: InputCode }
  | { readonly type: 'up'; readonly code: InputCode }
  | { readonly type: 'releaseAll' }
  | { readonly type: 'releaseToggles' };

interface Edges {
  pressed: boolean;
  released: boolean;
}

/** The key + mouse and pad code → action lookup, both sets together (their codes never overlap). */
function byCode(keys: Bindings, pad: Bindings): ReadonlyMap<InputCode, readonly BindableAction[]> {
  const map = new Map(actionsByCode(keys));
  for (const [code, actions] of actionsByCode(pad)) {
    map.set(code, [...(map.get(code) ?? []), ...actions]);
  }
  return map;
}

/**
 * Whether a press of `code` toggles `action` instead of holding it. The pad's own crouch and sprint
 * already latch (the stance toggle and `sprintToggle` below), so their pad codes pass through; any
 * other code on a toggled action flips it.
 */
function flips(action: BindableAction, code: InputCode): boolean {
  return !(isPadCode(code) && (action === 'sprint' || action === 'crouch'));
}

export interface ActionSamplerOptions {
  /** Keyboard + mouse bindings; defaults to DEFAULT_BINDINGS. */
  readonly bindings?: Bindings;
  /** Gamepad bindings; defaults to DEFAULT_PAD_BINDINGS. */
  readonly padBindings?: Bindings;
  readonly gamepad?: GamepadSettings;
  /** Actions that start in toggle mode (the hold-or-toggle setting, mw-e31.3); none by default. */
  readonly toggled?: Iterable<BindableAction>;
  /**
   * Whether a toggled action may latch right now. Aim and draw only toggle while the bow is out, so
   * a swing of the sword is never stuck on. A latch whose action stops qualifying lets go.
   */
  readonly toggleApplies?: (action: BindableAction) => boolean;
}

export class ActionSampler {
  #bindings: Bindings;
  #padBindings: Bindings;
  readonly #padSettings: GamepadSettings;
  #byCode: ReadonlyMap<InputCode, readonly BindableAction[]>;
  /** Codes down as of the last sample. */
  readonly #held = new Set<InputCode>();
  /** Actions held as of the last sample. */
  readonly #actionHeld = new Set<BindableAction>();
  #queue: RawEvent[] = [];
  #lookX = 0;
  #lookY = 0;
  #last: ActionFrame = IDLE_ACTION_FRAME;
  readonly #pollers = new Set<() => void>();
  /** The pad's latest snapshot; undefined while no pad is connected. */
  #pad: PadSnapshot | undefined;
  /** A pad went away since the last sample. */
  #disconnected = false;
  /** Pad buttons down (raw) as of the last sample: press edges for latches and the device. */
  #padRaw: ReadonlySet<PadCode> = IDLE_PAD.buttons;
  #sprintLatched = false;
  #crouchLatched = false;
  #padMoving = false;
  #lastDevice: InputDevice = 'keyboardMouse';
  /** Actions in toggle mode: a press flips them and the release does nothing (mw-e31.3). */
  #toggled: ReadonlySet<BindableAction>;
  readonly #toggleApplies: (action: BindableAction) => boolean;
  /** Toggled actions currently latched on. */
  readonly #latched = new Set<BindableAction>();
  /** `action:code` pairs held across a mode change: ignored until that code comes up. */
  readonly #stale = new Set<string>();

  constructor(options: ActionSamplerOptions = {}) {
    this.#bindings = options.bindings ?? DEFAULT_BINDINGS;
    this.#padBindings = options.padBindings ?? DEFAULT_PAD_BINDINGS;
    this.#padSettings = options.gamepad ?? DEFAULT_GAMEPAD_SETTINGS;
    this.#byCode = byCode(this.#bindings, this.#padBindings);
    this.#toggled = new Set(options.toggled);
    this.#toggleApplies = options.toggleApplies ?? (() => true);
  }

  /** The actions in toggle mode. */
  get toggled(): ReadonlySet<BindableAction> {
    return this.#toggled;
  }

  /**
   * Sets which actions toggle (the hold-or-toggle setting, mw-e31.3). An action whose mode changed
   * resets to released: its latch lets go, and a key still down from the old mode is ignored until
   * it comes up, so nothing is stuck on either way.
   */
  setToggled(actions: Iterable<BindableAction>): void {
    const next = new Set(actions);
    for (const action of BINDABLE_ACTIONS) {
      if (next.has(action) === this.#toggled.has(action)) continue;
      this.#latched.delete(action);
      for (const code of this.#held) {
        if ((this.#byCode.get(code) ?? []).includes(action)) this.#stale.add(`${action}:${code}`);
      }
    }
    this.#toggled = next;
  }

  /**
   * Lets every toggle go: a menu opened, the player died or respawned. Held keys are untouched. Held
   * actions report a release on the next frame.
   */
  releaseToggles(): void {
    this.#queue.push({ type: 'releaseToggles' });
  }

  /** Keyboard + mouse bindings. */
  get bindings(): Bindings {
    return this.#bindings;
  }

  get padBindings(): Bindings {
    return this.#padBindings;
  }

  get gamepadSettings(): GamepadSettings {
    return this.#padSettings;
  }

  /** The device the player last used: a key, mouse button or movement, or a pad button or stick. */
  get lastDevice(): InputDevice {
    return this.#lastDevice;
  }

  /**
   * Swaps the bindings; the next sample maps every code through them. Actions whose codes are still
   * down stay held; ones that lose their key report a release.
   */
  setBindings(bindings: Bindings): void {
    this.#bindings = bindings;
    this.#byCode = byCode(bindings, this.#padBindings);
  }

  /** Swaps the gamepad bindings, as setBindings does the keyboard's. */
  setPadBindings(bindings: Bindings): void {
    this.#padBindings = bindings;
    this.#byCode = byCode(this.#bindings, bindings);
  }

  /**
   * Adds a function run at the start of every sample (once per tick), before anything is read: the
   * gamepad adapter polls the pad here. Returns a function that removes it.
   */
  addPoller(poll: () => void): () => void {
    this.#pollers.add(poll);
    return () => {
      this.#pollers.delete(poll);
    };
  }

  /**
   * This tick's gamepad state, or undefined when no pad is connected. A pad going from connected to
   * undefined is a disconnect (mw-e02.9 AC-4): the next frame releases every pad-held action and, if
   * the settings say so, taps pause. The adapter passes IDLE_PAD while the page lacks focus.
   */
  gamepad(snapshot: PadSnapshot | undefined): void {
    if (snapshot === undefined && this.#pad !== undefined) this.#disconnected = true;
    this.#pad = snapshot;
  }

  /** Whether `code` is bound to any action (the adapter suppresses the browser default for these). */
  isBound(code: InputCode): boolean {
    return this.#byCode.has(code);
  }

  /** A key or mouse button went down. Auto-repeat is harmless: a held code going down is ignored. */
  down(code: InputCode): void {
    this.#queue.push({ type: 'down', code });
  }

  /** A key or mouse button went up. */
  up(code: InputCode): void {
    this.#queue.push({ type: 'up', code });
  }

  /** Mouse movement in counts (MouseEvent.movementX/Y: x right, y down). Non-finite values are dropped. */
  look(movementX: number, movementY: number): void {
    if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return;
    this.#lookX += movementX;
    this.#lookY -= movementY;
  }

  /**
   * Keyboard + mouse focus is gone (pointer lock lost, window blur): every key and mouse button goes
   * up and pending look is discarded, so nothing stays stuck. Held actions report a release on the
   * next frame, and so do toggled ones. Pad buttons follow the pad's own snapshot (the adapter idles
   * it without focus).
   */
  releaseAll(): void {
    this.#queue.push({ type: 'releaseAll' });
    this.#lookX = 0;
    this.#lookY = 0;
  }

  /** The most recent frame (idle before the first sample). */
  get lastFrame(): ActionFrame {
    return this.#last;
  }

  /** Consumes everything since the previous sample into this tick's ActionFrame. */
  sample(): ActionFrame {
    for (const poll of this.#pollers) poll();
    const edges = new Map<BindableAction, Edges>();
    const edgesOf = (action: BindableAction): Edges => {
      let entry = edges.get(action);
      if (!entry) {
        entry = { pressed: false, released: false };
        edges.set(action, entry);
      }
      return entry;
    };
    const held = new Set<BindableAction>(this.#actionHeld);
    // Codes down per action while replaying, counted through the current bindings.
    const count = new Map<BindableAction, number>();
    const bump = (action: BindableAction, delta: number): number => {
      const n = (count.get(action) ?? 0) + delta;
      count.set(action, n);
      return n;
    };
    const press = (action: BindableAction): void => {
      held.add(action);
      edgesOf(action).pressed = true;
    };
    const release = (action: BindableAction): void => {
      held.delete(action);
      edgesOf(action).released = true;
    };
    // Whether `code` holds `action` (rather than toggling it, or being stale from a mode change).
    const holds = (action: BindableAction, code: InputCode): boolean =>
      !(this.#toggled.has(action) && flips(action, code)) && !this.#stale.has(`${action}:${code}`);
    for (const code of this.#held) {
      for (const action of this.#byCode.get(code) ?? []) if (holds(action, code)) bump(action, 1);
    }
    // After a bindings change an action can be held with no key down any more, or the reverse.
    for (const action of BINDABLE_ACTIONS) {
      const down = this.#latched.has(action) || (count.get(action) ?? 0) > 0;
      if (held.has(action) !== down) {
        if (down) press(action);
        else release(action);
      }
    }

    const goDown = (code: InputCode): void => {
      if (this.#held.has(code)) return;
      this.#held.add(code);
      for (const action of this.#byCode.get(code) ?? []) {
        if (this.#toggled.has(action) && flips(action, code)) {
          // A toggle: the press flips the latch, if the action may latch right now.
          if (this.#latched.delete(action)) {
            if ((count.get(action) ?? 0) === 0) release(action);
          } else if (this.#toggleApplies(action)) {
            this.#latched.add(action);
            if (!held.has(action)) press(action);
          }
        } else if (!this.#stale.has(`${action}:${code}`) && bump(action, 1) === 1) {
          if (!held.has(action)) press(action);
        }
      }
    };
    const goUp = (code: InputCode): void => {
      if (!this.#held.delete(code)) return;
      for (const action of this.#byCode.get(code) ?? []) {
        if (this.#stale.delete(`${action}:${code}`)) continue;
        if (this.#toggled.has(action) && flips(action, code)) continue;
        if (bump(action, -1) === 0 && !this.#latched.has(action)) release(action);
      }
    };
    const unlatch = (action: BindableAction): void => {
      this.#latched.delete(action);
      if ((count.get(action) ?? 0) === 0) release(action);
    };
    let keyboardUsed = this.#lookX !== 0 || this.#lookY !== 0;
    for (const event of this.#queue) {
      if (event.type === 'down') {
        keyboardUsed = true;
        goDown(event.code);
      } else if (event.type === 'up') goUp(event.code);
      else {
        if (event.type === 'releaseAll') {
          for (const code of [...this.#held]) if (!isPadCode(code)) goUp(code);
        }
        for (const action of [...this.#latched]) unlatch(action);
      }
    }
    this.#queue = [];
    // A latch whose action no longer qualifies (the bow was put away) lets go.
    for (const action of [...this.#latched]) if (!this.#toggleApplies(action)) unlatch(action);

    // The pad: its buttons are codes held while down, like keys.
    const settings = this.#padSettings;
    const pad = this.#pad ?? IDLE_PAD;
    const padMove = radialDeadzone(pad.left, settings.moveDeadzone);
    const wanted = new Set<PadCode>(pad.buttons);
    let padUsed =
      magnitude(pad.left) > settings.moveDeadzone || magnitude(pad.right) > settings.moveDeadzone;
    for (const code of pad.buttons) if (!this.#padRaw.has(code)) padUsed = true;
    // Pad crouch is a stance toggle: each bound-button click flips it. The first bound code carries
    // the synthetic held state, so releasing R3 does not stand the player up.
    const crouchCodes = this.#padBindings.crouch.filter(isPadCode);
    for (const code of crouchCodes) {
      if (pad.buttons.has(code) && !this.#padRaw.has(code)) {
        this.#crouchLatched = !this.#crouchLatched;
      }
      wanted.delete(code);
    }
    const [crouchLatch] = crouchCodes;
    if (this.#crouchLatched && crouchLatch !== undefined) wanted.add(crouchLatch);
    if (settings.sprintToggle) {
      // Sprint latches: a click flips it, and it lets go when the stick comes back to centre.
      const moving = magnitude(padMove) > 0;
      if (this.#padMoving && !moving) this.#sprintLatched = false;
      this.#padMoving = moving;
      const sprintCodes = this.#padBindings.sprint.filter(isPadCode);
      for (const code of sprintCodes) {
        if (pad.buttons.has(code) && !this.#padRaw.has(code)) {
          this.#sprintLatched = !this.#sprintLatched;
        }
        wanted.delete(code);
      }
      const [latch] = sprintCodes;
      if (this.#sprintLatched && latch !== undefined) wanted.add(latch);
    }
    for (const code of PAD_BUTTONS) {
      if (wanted.has(code)) goDown(code);
      else goUp(code);
    }
    // Jumping or engaging sprint exits the crouch stance. Keyboard actions count too because both
    // devices merge into this frame; a held keyboard crouch still wins through its own binding.
    // A latch only exists when a pad crouch button is bound, so `latched` is defined exactly when crouching.
    const latched = this.#crouchLatched ? crouchLatch : undefined;
    if (latched !== undefined && (edges.get('jump')?.pressed === true || held.has('sprint'))) {
      this.#crouchLatched = false;
      goUp(latched);
    }
    this.#padRaw = pad.buttons;
    if (this.#disconnected) {
      this.#disconnected = false;
      this.#sprintLatched = false;
      this.#crouchLatched = false;
      this.#padMoving = false;
      if (crouchLatch !== undefined) goUp(crouchLatch);
      // AC-4: everything the pad held has just been released above; the game pauses per settings.
      if (settings.pauseOnDisconnect) {
        const pause = edgesOf('pause');
        pause.pressed = true;
        pause.released = true;
      }
    }
    if (padUsed) this.#lastDevice = 'gamepad';
    else if (keyboardUsed) this.#lastDevice = 'keyboardMouse';

    this.#actionHeld.clear();
    for (const action of held) this.#actionHeld.add(action);

    const axis = (plus: MoveDirection, minus: MoveDirection): number =>
      (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
    let x = axis('moveRight', 'moveLeft');
    let y = axis('moveForward', 'moveBack');
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    const move = mergeMove(actionVector(x, y), padMove);
    const look = actionVector(this.#lookX, this.#lookY);
    this.#lookX = 0;
    this.#lookY = 0;

    const button = (action: ButtonAction): ActionButton => {
      const e = edges.get(action);
      return actionButton(e?.pressed ?? false, held.has(action), e?.released ?? false);
    };
    this.#last = actionFrame({
      move,
      look,
      lookStick: stickVector(pad.right.x, pad.right.y),
      buttons: button,
    });
    return this.#last;
  }

  /** The frame loop hook: one ActionFrame per tick. */
  readonly sampleCommands: CommandSampler<ActionFrame> = () => [this.sample()];
}
