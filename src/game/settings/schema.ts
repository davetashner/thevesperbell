// The settings schema (mw-e31.1): every player setting, grouped in categories, with its default and
// the metadata the options menu is generated from (label, help text, range or choices). Settings are
// per-browser, not per-save. The value types are inferred from these definitions, and a strict zod
// schema is built from them; the lenient loader (normalize.ts) repairs stored data into that shape.
//
// Adding a setting: add it here with a default. Stored settings without it pick up the default, so
// no migration is needed. Renaming, moving or re-scaling one needs a SETTINGS_VERSION bump and a
// migration (migrations.ts).

import { z } from 'zod';

export interface SettingMeta {
  /** Shown next to the control, and its accessible name. */
  readonly label: string;
  /** One sentence shown under the control (its accessible description). */
  readonly help: string;
}

export interface ToggleSetting extends SettingMeta {
  readonly kind: 'toggle';
  readonly default: boolean;
}

export interface SliderSetting extends SettingMeta {
  readonly kind: 'slider';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** How the value reads out: `percent` 0–1 as 0–100%, `times` as ×1.0, `degrees` as 70°. */
  readonly unit: 'percent' | 'times' | 'degrees';
}

export interface SelectSetting<T extends string = string> extends SettingMeta {
  readonly kind: 'select';
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly default: T;
}

/** A key binding shown in the menu; remapping it arrives with mw-e31.2 (a placeholder here). */
export interface KeybindSetting extends SettingMeta {
  readonly kind: 'keybind';
  /** A KeyboardEvent.code, e.g. `KeyE`. */
  readonly default: string;
}

export type SettingDef = ToggleSetting | SliderSetting | SelectSetting | KeybindSetting;

const toggle = (def: Omit<ToggleSetting, 'kind'>): ToggleSetting => ({ kind: 'toggle', ...def });
const slider = (def: Omit<SliderSetting, 'kind'>): SliderSetting => ({ kind: 'slider', ...def });
const keybind = (def: Omit<KeybindSetting, 'kind'>): KeybindSetting => ({
  kind: 'keybind',
  ...def,
});
function choice<const T extends string>(def: {
  readonly label: string;
  readonly help: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly default: NoInfer<T>;
}): SelectSetting<T> {
  return { kind: 'select', ...def };
}

const holdOrToggle = [
  { value: 'hold', label: 'Hold' },
  { value: 'toggle', label: 'Toggle' },
] as const;

const volume = (label: string, help: string, value = 1): SliderSetting =>
  slider({ label, help, min: 0, max: 1, step: 0.05, default: value, unit: 'percent' });

/** The current schema version of stored settings. Bump it with a migration on a breaking change. */
export const SETTINGS_VERSION = 2;

/** Every category and setting, in menu order. */
export const SETTINGS_SCHEMA = {
  controls: {
    label: 'Controls',
    settings: {
      sprint: choice({
        label: 'Sprint',
        help: 'Hold the key to sprint, or press it once to start and again to stop.',
        options: holdOrToggle,
        default: 'hold',
      }),
      crouch: choice({
        label: 'Crouch',
        help: 'Hold the key to stay crouched, or press it once to crouch and again to stand.',
        options: holdOrToggle,
        default: 'toggle',
      }),
      interact: keybind({
        label: 'Interact',
        help: 'Open doors, pull levers and pick things up. Remapping arrives in a later update.',
        default: 'KeyE',
      }),
    },
  },
  camera: {
    label: 'Camera',
    settings: {
      sensitivity: slider({
        label: 'Look sensitivity',
        help: 'How fast the camera turns with the mouse or right stick.',
        min: 0.2,
        max: 3,
        step: 0.1,
        default: 1,
        unit: 'times',
      }),
      invertY: toggle({
        label: 'Invert vertical look',
        help: 'Pushing up looks down, like a flight stick.',
        default: false,
      }),
      invertX: toggle({
        label: 'Invert horizontal look',
        help: 'Pushing right turns the camera left.',
        default: false,
      }),
      fov: slider({
        label: 'Field of view',
        help: 'How wide the view is. Wider shows more but can feel faster.',
        min: 60,
        max: 100,
        step: 5,
        default: 70,
        unit: 'degrees',
      }),
    },
  },
  display: {
    label: 'Display',
    settings: {
      quality: choice({
        label: 'Graphics quality',
        help: 'Low keeps older or integrated graphics smooth; High adds shadows and effects.',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ],
        default: 'high',
      }),
      brightness: slider({
        label: 'Brightness',
        help: 'Raise it if the darkest corners hide too much on your screen.',
        min: 0.5,
        max: 1.5,
        step: 0.05,
        default: 1,
        unit: 'percent',
      }),
    },
  },
  audio: {
    label: 'Audio',
    settings: {
      master: volume('Master volume', 'The overall volume of the game.', 0.8),
      music: volume('Music volume', 'The score and the ambient music beds.'),
      sfx: volume('Effects volume', 'Footsteps, combat, doors and the world around you.'),
      voice: volume('Voice volume', 'Spoken lines and barks.'),
      mono: toggle({
        label: 'Mono audio',
        help: 'Plays everything through both speakers, for one ear or one speaker.',
        default: false,
      }),
    },
  },
  accessibility: {
    label: 'Accessibility',
    settings: {
      textScale: slider({
        label: 'Text size',
        help: 'Scales every menu and HUD text.',
        min: 0.8,
        max: 2,
        step: 0.1,
        default: 1,
        unit: 'times',
      }),
      hudScale: slider({
        label: 'HUD size',
        help: 'Scales the health and stamina bars and the damage direction ring.',
        min: 0.75,
        max: 2,
        step: 0.05,
        default: 1,
        unit: 'percent',
      }),
      motion: choice({
        label: 'Motion',
        help: 'Reduce screen and menu motion, or follow your system setting.',
        options: [
          { value: 'system', label: 'System' },
          { value: 'reduce', label: 'Reduced' },
          { value: 'full', label: 'Full' },
        ],
        default: 'system',
      }),
      subtitles: toggle({
        label: 'Subtitles',
        help: 'Shows spoken lines as text.',
        default: true,
      }),
      wheelSlowsTime: toggle({
        label: 'Slow time in the spell wheel',
        help: 'Slows the game to a quarter speed while the spell wheel is held open.',
        default: true,
      }),
    },
  },
  gameplay: {
    label: 'Gameplay',
    settings: {
      difficulty: choice({
        label: 'Difficulty',
        help: 'How hard fights hit and how forgiving the world is. Change it any time.',
        options: [
          { value: 'story', label: 'Story' },
          { value: 'normal', label: 'Normal' },
          { value: 'hard', label: 'Hard' },
        ],
        default: 'normal',
      }),
      damageNumbers: toggle({
        label: 'Damage numbers',
        help: 'Shows the damage you deal over your target and the damage you take.',
        default: true,
      }),
    },
  },
} as const satisfies Readonly<
  Record<
    string,
    { readonly label: string; readonly settings: Readonly<Record<string, SettingDef>> }
  >
>;

type Schema = typeof SETTINGS_SCHEMA;

export type SettingsCategory = keyof Schema;

/** The value type a definition holds. */
export type ValueOf<D> = D extends ToggleSetting
  ? boolean
  : D extends SliderSetting
    ? number
    : D extends SelectSetting<infer T>
      ? T
      : string;

/** All settings, by category. */
export type Settings = {
  -readonly [C in SettingsCategory]: {
    -readonly [K in keyof Schema[C]['settings']]: ValueOf<Schema[C]['settings'][K]>;
  };
};

/** A setting's dotted key, e.g. `camera.invertY`. */
export type SettingKey = {
  [C in SettingsCategory]: `${C}.${keyof Schema[C]['settings'] & string}`;
}[SettingsCategory];

/** The value type of a dotted key. */
export type SettingValue<K extends SettingKey> = K extends `${infer C}.${infer S}`
  ? C extends SettingsCategory
    ? S extends keyof Settings[C]
      ? Settings[C][S]
      : never
    : never
  : never;

/** Categories in menu order. */
export const SETTINGS_CATEGORIES = Object.keys(SETTINGS_SCHEMA) as SettingsCategory[];

/** Every setting definition with its dotted key, in menu order. */
export function settingDefs(category?: SettingsCategory): { key: SettingKey; def: SettingDef }[] {
  const categories = category === undefined ? SETTINGS_CATEGORIES : [category];
  return categories.flatMap((c) =>
    Object.entries(SETTINGS_SCHEMA[c].settings).map(([name, def]: [string, SettingDef]) => ({
      key: `${c}.${name}` as SettingKey,
      def,
    })),
  );
}

/** The definition of a dotted key. */
export function settingDef(key: SettingKey): SettingDef {
  const def = DEFS.get(key);
  if (def === undefined) throw new RangeError(`unknown setting ${key}`);
  return def;
}

const DEFS = new Map<string, SettingDef>(settingDefs().map(({ key, def }) => [key, def]));

/** The strict zod schema of one setting's value. */
export function settingValueSchema(def: SettingDef): z.ZodType {
  switch (def.kind) {
    case 'toggle':
      return z.boolean();
    case 'slider':
      return z.number().min(def.min).max(def.max);
    case 'select':
      return z.enum(def.options.map((option) => option.value) as [string, ...string[]]);
    case 'keybind':
      return z.string().min(1);
  }
}

/** The strict zod schema of a whole, current-version settings object (no unknown keys). */
export const settingsSchema = z.strictObject(
  Object.fromEntries(
    SETTINGS_CATEGORIES.map((c) => [
      c,
      z.strictObject(
        Object.fromEntries(
          settingDefs(c).map(({ key, def }) => [key.split('.')[1], settingValueSchema(def)]),
        ),
      ),
    ]),
  ),
) as unknown as z.ZodType<Settings>;

/** A fresh copy of every default. */
export function defaultSettings(): Settings {
  return Object.fromEntries(
    SETTINGS_CATEGORIES.map((c) => [c, defaultCategory(c)]),
  ) as unknown as Settings;
}

/** A fresh copy of one category's defaults. */
export function defaultCategory<C extends SettingsCategory>(category: C): Settings[C] {
  return Object.fromEntries(
    settingDefs(category).map(({ key, def }) => [key.split('.')[1], def.default]),
  ) as Settings[C];
}
