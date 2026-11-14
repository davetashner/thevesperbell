// The Gamepad API side of input (mw-e02.9): a thin adapter that polls `navigator.getGamepads()` once
// per sim tick, from inside ActionSampler.sample(), and hands the chosen pad's snapshot to the
// sampler. The browser has no events for button or stick changes, so polling is the only way; it
// happens at the tick rate so every tick sees exactly one pad state (hot-plug included).
//
// Unlike keyboard and mouse, the pad does not need pointer lock: it works whenever the page has
// focus, so a player on the couch never has to click the canvas. Without focus the pad reads idle
// (held buttons release) but stays connected. All mapping logic is in gamepad.ts and the sampler.

import { choosePad, readPad, IDLE_PAD, type GamepadLike } from './gamepad';
import type { ActionSampler } from './sampler';

/** Where pads come from (the browser passes `navigator`). */
export interface GamepadSource {
  getGamepads(): readonly (GamepadLike | null)[];
}

export interface GamepadHost {
  readonly navigator: GamepadSource;
  /** Whether the page has focus (the browser passes `() => document.hasFocus()`). */
  readonly hasFocus: () => boolean;
  /** A pad was connected (or became the one read). */
  readonly onConnect?: (pad: GamepadLike) => void;
  /**
   * The pad being read went away (mw-e02.9 AC-4). The sampler has already released everything it
   * held and taps pause on the next frame (per settings); this is for the UI to say so.
   */
  readonly onDisconnect?: () => void;
}

export interface GamepadInput {
  /** The index of the pad being read, if any. */
  readonly index: number | undefined;
  /** Whether pad input reaches the sampler; false releases it (the debug fly camera, mw-e00.21). */
  enabled: boolean;
  /** Stops polling. */
  detach(): void;
}

/** Polls the host's gamepads into `sampler` once per sample. */
export function attachGamepadInput(sampler: ActionSampler, host: GamepadHost): GamepadInput {
  let index: number | undefined;
  let enabled = true;
  let wasLive = true;
  const poll = (): void => {
    let pads: readonly (GamepadLike | null)[] = [];
    try {
      pads = host.navigator.getGamepads();
    } catch {
      // A permissions policy can forbid the Gamepad API: no pads, then.
    }
    const pad = choosePad(pads, index);
    if (index !== undefined && pad?.index !== index) {
      // The pad being read is gone (another may take over below): that is a disconnect.
      index = undefined;
      sampler.gamepad(undefined);
      host.onDisconnect?.();
    }
    if (pad === undefined) return;
    if (pad.index !== index) {
      index = pad.index;
      host.onConnect?.(pad);
    }
    // Losing focus (or the debug camera taking the pad) lets toggled actions go, as it does for keys.
    const live = enabled && host.hasFocus();
    if (wasLive && !live) sampler.releaseToggles();
    wasLive = live;
    sampler.gamepad(live ? readPad(pad, sampler.gamepadSettings) : IDLE_PAD);
  };
  const remove = sampler.addPoller(poll);
  return {
    get index() {
      return index;
    },
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
    },
    detach() {
      remove();
      if (index !== undefined) sampler.gamepad(IDLE_PAD);
      index = undefined;
    },
  };
}
