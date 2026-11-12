// Player input capture (mw-e02.23, mw-e02.9): the DOM input adapter (mw-e02.1) plus click-to-play,
// and the gamepad adapter. A click on the game canvas asks for pointer lock; while locked, keys and
// mouse feed the ActionSampler. A gamepad needs no click: it feeds the sampler whenever the page has
// focus. The debug fly camera (F2) shares WASD, so disabling player input releases the lock, idles
// the pad (every held action lets go) and stops clicks from taking the lock until re-enabled.

import {
  attachDomInput,
  attachGamepadInput,
  type ActionSampler,
  type DomInput,
  type DomInputHost,
  type GamepadHost,
  type InputEventTarget,
  type PointerLockDocument,
  type PointerLockElement,
} from '../input';

export interface PlayerInputHost extends DomInputHost {
  readonly document: PointerLockDocument & { exitPointerLock?(): unknown };
  readonly element: PointerLockElement & InputEventTarget;
  /** The Gamepad API; without it only keyboard and mouse play. */
  readonly gamepad?: GamepadHost;
  /** True while a screen or conversation holds the pointer free: a click does not lock it. */
  readonly held?: () => boolean;
}

export interface PlayerInput {
  /** True while the pointer is locked and input reaches the sampler. */
  readonly locked: boolean;
  /** Whether a click captures input. Setting it false releases the lock and held actions. */
  enabled: boolean;
  detach(): void;
}

/** Feeds `sampler` from the page and locks the pointer on a click on `host.element`. */
export function attachPlayerInput(sampler: ActionSampler, host: PlayerInputHost): PlayerInput {
  const dom: DomInput = attachDomInput(sampler, host);
  const pad = host.gamepad === undefined ? undefined : attachGamepadInput(sampler, host.gamepad);
  let enabled = true;
  const onClick = (): void => {
    if (enabled && host.held?.() !== true) dom.requestPointerLock();
  };
  host.element.addEventListener('click', onClick);
  return {
    get locked() {
      return dom.locked;
    },
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
      if (pad !== undefined) pad.enabled = value;
      if (value) return;
      if (dom.locked) host.document.exitPointerLock?.();
      sampler.releaseAll();
    },
    detach() {
      host.element.removeEventListener('click', onClick);
      dom.detach();
      pad?.detach();
    },
  };
}
