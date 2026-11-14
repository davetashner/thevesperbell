// Hold or toggle for the sustained actions (mw-e31.3): sprint, crouch, block and aim/draw. The
// settings store holds the player's choice; this maps it onto the input actions and feeds it to the
// sampler. Toggling is resolved there, before the sim, so the sim only ever sees held or not held.

import type { BindableAction } from '../input/bindings';
import type { SettingsStore } from './store';

/** The settings that choose hold or toggle, and the input action each one drives. */
export const HOLD_TOGGLE_SETTINGS = {
  'controls.sprint': 'sprint',
  'controls.crouch': 'crouch',
  'controls.block': 'secondaryAttack',
  'controls.aim': 'primaryAttack',
} as const satisfies Readonly<Record<string, BindableAction>>;

/** The actions the settings currently put in toggle mode. */
export function toggledActions(settings: Pick<SettingsStore, 'get'>): BindableAction[] {
  const keys = Object.keys(HOLD_TOGGLE_SETTINGS) as (keyof typeof HOLD_TOGGLE_SETTINGS)[];
  return keys
    .filter((key) => settings.get(key) === 'toggle')
    .map((key) => HOLD_TOGGLE_SETTINGS[key]);
}

/** The slice of the sampler this wires up. */
export interface ToggleTarget {
  setToggled(actions: Iterable<BindableAction>): void;
}

/**
 * Applies the settings to `target` now and on every change. Returns a function that stops listening.
 * `locked` (a replay in progress) keeps everything on hold, so recorded raw inputs replay as they
 * were played.
 */
export function bindHoldToggle(
  settings: Pick<SettingsStore, 'get' | 'on'>,
  target: ToggleTarget,
  locked: () => boolean = () => false,
): () => void {
  const apply = (): void => {
    target.setToggled(locked() ? [] : toggledActions(settings));
  };
  apply();
  const stops = (Object.keys(HOLD_TOGGLE_SETTINGS) as (keyof typeof HOLD_TOGGLE_SETTINGS)[]).map(
    (key) => settings.on(key, apply),
  );
  return () => {
    for (const stop of stops) stop();
  };
}
