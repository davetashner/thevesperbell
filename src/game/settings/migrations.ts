// Settings schema migrations (mw-e31.1), the same chain idea as save sections (src/game/save/format/
// section.ts): stored settings at version N are upgraded one step at a time (N → N+1 → … → current),
// and only then repaired against the current schema (normalize.ts), so the schema only ever describes
// the current shape. A migration only reshapes; it never validates or clamps.

import { SETTINGS_VERSION } from './schema';

/** Upgrades stored settings from version `n` to `n + 1`. Must be pure and must not throw on junk. */
export type SettingsMigration = (settings: Record<string, unknown>) => Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Moves `from` (category, key) to `to`, keeping the value; leaves the object alone if absent. */
function move(
  settings: Record<string, unknown>,
  [fromCategory, fromKey]: readonly [string, string],
  [toCategory, toKey]: readonly [string, string],
): Record<string, unknown> {
  const source = settings[fromCategory];
  if (!isRecord(source) || !(fromKey in source)) return settings;
  const { [fromKey]: value, ...rest } = source;
  const next = { ...settings, [fromCategory]: rest };
  const target = next[toCategory];
  next[toCategory] = { ...(isRecord(target) ? target : {}), [toKey]: value };
  return next;
}

/**
 * v1 → v2: the prototype settings named the master volume `audio.masterVolume`, the look speed
 * `camera.lookSensitivity`, and kept text size under `display.uiScale`. v2 renames the first two and
 * moves text size to `accessibility.textScale`, beside the other comfort options. Values carry over.
 */
const v1ToV2: SettingsMigration = (settings) => {
  let next = move(settings, ['audio', 'masterVolume'], ['audio', 'master']);
  next = move(next, ['camera', 'lookSensitivity'], ['camera', 'sensitivity']);
  next = move(next, ['display', 'uiScale'], ['accessibility', 'textScale']);
  return next;
};

/**
 * v2 → v3: the crouch hold-or-toggle option shipped before it did anything, with a default of toggle.
 * It now drives the crouch key (mw-e31.3) and defaults to hold, so a value stored while it was inert
 * is dropped rather than suddenly changing how the key behaves.
 */
const v2ToV3: SettingsMigration = (settings) => {
  const controls = settings['controls'];
  if (!isRecord(controls) || !('crouch' in controls)) return settings;
  const rest = Object.fromEntries(Object.entries(controls).filter(([key]) => key !== 'crouch'));
  return { ...settings, controls: rest };
};

/** `SETTINGS_MIGRATIONS[n]` upgrades version n to n + 1. */
export const SETTINGS_MIGRATIONS: Readonly<Record<number, SettingsMigration>> = Object.freeze({
  1: v1ToV2,
  2: v2ToV3,
});

/**
 * Runs the chain from `from` up to `to`. Throws RangeError when a step is missing, so the caller can
 * fall back to defaults with a warning.
 */
export function migrateSettings(
  settings: Record<string, unknown>,
  from: number,
  to: number = SETTINGS_VERSION,
  migrations: Readonly<Record<number, SettingsMigration>> = SETTINGS_MIGRATIONS,
): Record<string, unknown> {
  let current = settings;
  for (let version = from; version < to; version += 1) {
    const step = migrations[version];
    if (step === undefined) {
      throw new RangeError(
        `no settings migration from v${String(version)} to v${String(version + 1)}`,
      );
    }
    current = step(current);
  }
  return current;
}
