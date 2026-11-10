// First-launch comfort defaults (mw-e31.7): a player whose system asks for reduced motion starts with
// the camera shake off and reduce-flashing on. They only seed a fresh settings store (the `initial`
// option); anything the player has saved wins, and they stay free to turn the shake back up.

import type { SettingsStoreOptions } from './store';

/** The `matchMedia` part of `window` this reads. */
export type MediaQuery = (query: string) => { readonly matches: boolean };

/** The initial settings for a system that does (or does not) ask for reduced motion. */
export function comfortDefaults(
  matchMedia?: MediaQuery,
): NonNullable<SettingsStoreOptions['initial']> {
  const reduce = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return reduce ? { 'camera.shakeScale': 0, 'accessibility.reduceFlashing': true } : {};
}
