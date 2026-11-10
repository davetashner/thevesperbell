// The settings store (mw-e31.1): one place every comfort and accessibility option lives, persists and
// announces changes. Values apply immediately: `set` notifies subscribers synchronously, then writes
// localStorage (small and synchronous, so nothing is lost on a tab close).
//
//   const settings = createSettingsStore({ storage: () => globalThis.localStorage });
//   settings.on('camera.invertY', (inverted) => { … });   // fires once per actual change
//   settings.set('camera.invertY', true);
//   settings.reset('camera');                               // only camera returns to defaults
//
// When storage is missing or refuses (private mode, blocked site data, quota), the store keeps working
// in memory for the session and says so through `persistent` and one warning; it never throws.
// The sim never reads this store: systems that need a setting (difficulty assists) get it injected.

import { migrateSettings } from './migrations';
import { coerceSetting, describeValue, normalizeSettings, type SettingsWarn } from './normalize';
import {
  defaultCategory,
  defaultSettings,
  settingDef,
  settingValueSchema,
  SETTINGS_VERSION,
  type SettingKey,
  type Settings,
  type SettingsCategory,
  type SettingValue,
} from './schema';

/** The localStorage key settings are kept under. */
export const SETTINGS_STORAGE_KEY = 'vesper-bell.settings';

/** The part of the Web Storage API the store uses. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStoreOptions {
  /**
   * Returns the backing storage (pass `() => globalThis.localStorage`). A getter, because merely
   * reading `window.localStorage` throws when the browser blocks site data. Omitted, throwing or
   * returning nothing: in-memory settings.
   */
  readonly storage?: () => SettingsStorage | null | undefined;
  /** Storage key (default SETTINGS_STORAGE_KEY). */
  readonly key?: string;
  /**
   * Values that replace the schema defaults on a first launch (nothing stored yet), e.g. the comfort
   * defaults from `prefers-reduced-motion`. They are not saved until the player changes something,
   * and stored settings always win.
   */
  readonly initial?: Readonly<Partial<{ [K in SettingKey]: SettingValue<K> }>>;
  /** Receives repairs and storage failures (default console.warn). */
  readonly warn?: SettingsWarn;
}

export type SettingListener<K extends SettingKey> = (value: SettingValue<K>, key: K) => void;
export type AnySettingListener = (key: SettingKey, value: unknown) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Parses a stored settings document (any version) into current, valid Settings. */
export function loadSettings(text: string | null, warn: SettingsWarn): Settings {
  if (text === null) return defaultSettings();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    warn('stored settings are not valid JSON; using the defaults');
    return defaultSettings();
  }
  if (!isRecord(doc) || !Number.isSafeInteger(doc['version']) || (doc['version'] as number) < 1) {
    warn('stored settings have no valid version; using the defaults');
    return defaultSettings();
  }
  const version = doc['version'] as number;
  const stored = isRecord(doc['settings']) ? doc['settings'] : {};
  if (version > SETTINGS_VERSION) {
    warn(
      `stored settings are v${String(version)}, from a newer build than v${String(SETTINGS_VERSION)}; keeping what this build understands`,
    );
    return normalizeSettings(stored, warn);
  }
  try {
    return normalizeSettings(migrateSettings(stored, version), warn);
  } catch (error) {
    warn(`stored settings could not be migrated (${errorText(error)}); using the defaults`);
    return defaultSettings();
  }
}

/**
 * The stored input bindings (mw-e02.22), raw and unvalidated, from a stored settings document: the
 * document's `bindings` member, kept beside `settings` because bindings are a structured, versioned
 * value of their own (BindingsData) rather than a menu control. `undefined` when there are none.
 */
export function loadStoredBindings(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    const doc: unknown = JSON.parse(text);
    return isRecord(doc) ? doc['bindings'] : undefined;
  } catch {
    return undefined;
  }
}

export class SettingsStore {
  readonly #values: Settings;
  #bindings: unknown;
  readonly #key: string;
  readonly #warn: SettingsWarn;
  #storage: SettingsStorage | undefined;
  readonly #listeners = new Map<SettingKey, Set<(value: unknown, key: SettingKey) => void>>();
  readonly #anyListeners = new Set<AnySettingListener>();

  constructor(options: SettingsStoreOptions = {}) {
    this.#key = options.key ?? SETTINGS_STORAGE_KEY;
    this.#warn =
      options.warn ??
      ((message) => {
        console.warn(`[settings] ${message}`);
      });
    let text: string | null = null;
    try {
      const storage = options.storage?.() ?? undefined;
      text = storage?.getItem(this.#key) ?? null;
      this.#storage = storage;
    } catch (error) {
      this.#warn(`storage unavailable (${errorText(error)}); settings last this session only`);
    }
    this.#values = loadSettings(text, this.#warn);
    if (text === null) {
      for (const [key, value] of Object.entries(options.initial ?? {})) {
        const [category, name] = key.split('.') as [SettingsCategory, string];
        const def = settingDef(key as SettingKey);
        if (settingValueSchema(def).safeParse(value).success) {
          (this.#values[category] as Record<string, unknown>)[name] = value;
        }
      }
    }
    this.#bindings = loadStoredBindings(text);
  }

  /** The persisted input bindings as stored (unvalidated; see src/game/settings/bindings.ts). */
  get storedBindings(): unknown {
    return this.#bindings;
  }

  /** Stores the input bindings document beside the settings and persists it. */
  setStoredBindings(data: unknown): void {
    this.#bindings = data;
    this.#persist();
  }

  /** False when settings live only in memory (no storage, or it refused a read or write). */
  get persistent(): boolean {
    return this.#storage !== undefined;
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    const [category, name] = key.split('.') as [SettingsCategory, string];
    return (this.#values[category] as Record<string, unknown>)[name] as SettingValue<K>;
  }

  /** A frozen copy of one category. */
  category<C extends SettingsCategory>(category: C): Readonly<Settings[C]> {
    return Object.freeze({ ...this.#values[category] });
  }

  /** A frozen copy of every setting. */
  snapshot(): Readonly<{ [C in SettingsCategory]: Readonly<Settings[C]> }> {
    const out = {} as Record<SettingsCategory, unknown>;
    for (const category of Object.keys(this.#values) as SettingsCategory[]) {
      out[category] = this.category(category);
    }
    return Object.freeze(out) as { [C in SettingsCategory]: Readonly<Settings[C]> };
  }

  /**
   * Sets one value and applies it at once. An out-of-range number is clamped and an invalid value
   * is ignored (both warn). Subscribers fire only when the stored value actually changes. Returns
   * whether it changed.
   */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): boolean {
    const def = settingDef(key);
    const valid = settingValueSchema(def).safeParse(value).success;
    if (!valid && !(def.kind === 'slider' && typeof value === 'number' && Number.isFinite(value))) {
      this.#warn(`setting ${key}: ${describeValue(value)} is invalid; ignored`);
      return false;
    }
    const next = coerceSetting(def, value, key, this.#warn);
    if (next === this.get(key)) return false;
    this.#write(key, next);
    this.#persist();
    return true;
  }

  /** Resets one category to its defaults; settings in other categories are untouched. */
  reset(category: SettingsCategory): void {
    const defaults = defaultCategory(category) as Record<string, unknown>;
    let changed = false;
    for (const [name, value] of Object.entries(defaults)) {
      const key = `${category}.${name}` as SettingKey;
      if (this.get(key) === value) continue;
      this.#write(key, value);
      changed = true;
    }
    if (changed) this.#persist();
  }

  /** Calls `listener(value, key)` after every change of `key`. Returns the unsubscribe function. */
  on<K extends SettingKey>(key: K, listener: SettingListener<K>): () => void {
    let set = this.#listeners.get(key);
    if (!set) {
      set = new Set();
      this.#listeners.set(key, set);
    }
    const entry = listener as (value: unknown, key: SettingKey) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /** Calls `listener(key, value)` after every change of any setting. Returns the unsubscribe. */
  onChange(listener: AnySettingListener): () => void {
    this.#anyListeners.add(listener);
    return () => {
      this.#anyListeners.delete(listener);
    };
  }

  #write(key: SettingKey, value: unknown): void {
    const [category, name] = key.split('.') as [SettingsCategory, string];
    (this.#values[category] as Record<string, unknown>)[name] = value;
    for (const listener of [...(this.#listeners.get(key) ?? [])]) listener(value, key);
    for (const listener of [...this.#anyListeners]) listener(key, value);
  }

  #persist(): void {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(
        this.#key,
        JSON.stringify({
          version: SETTINGS_VERSION,
          settings: this.#values,
          ...(this.#bindings === undefined ? {} : { bindings: this.#bindings }),
        }),
      );
    } catch (error) {
      this.#storage = undefined;
      this.#warn(`could not save settings (${errorText(error)}); settings last this session only`);
    }
  }
}

/** Creates the settings store (see SettingsStoreOptions). Never throws. */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  return new SettingsStore(options);
}
