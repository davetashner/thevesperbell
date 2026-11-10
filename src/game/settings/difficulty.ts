// Difficulty presets and granular assists (mw-e31.10): the bridge between the player's settings and the
// sim's injected DifficultyConfig (src/sim/difficulty.ts).
//
// The settings store keeps the player's choice per browser: a preset (Story, Adventurer, Veteran) or
// Custom, plus six assist controls (damage taken, parry and dodge timing, notice speed, search time,
// puzzle hints, fall damage). The sim never reads the store. This module turns the choice into a
// DifficultyConfig and feeds it to the world as a `difficultyCommand`, so a change mid-game is an input
// the replay recorder captures and the sim emits `DifficultyChanged` once for it.
//
// The sim's copy is the one a save keeps. After a load the world holds the save's config (a save with no
// difficulty block holds the neutral one, which is Adventurer), so `adopt` pushes that back into the
// settings: the menu always shows what the running game uses.
//
// Preset numbers are content data (src/content/data/game/game.json, `difficulty`), not constants here.

import type { GameConfigEntry } from '@content/index';
import {
  DIFFICULTY_KEYS,
  DifficultyChanged,
  difficultyCommand,
  resolveDifficulty,
  type DifficultyCommand,
  type DifficultyConfig,
  type World,
} from '@sim/index';
import type { SettingsStore } from './store';
import type { SettingKey, Settings } from './schema';

/** The presets a player can pick; `custom` uses the assist controls. */
export const DIFFICULTY_PRESET_IDS = ['story', 'adventurer', 'veteran'] as const;
export type DifficultyPresetId = (typeof DIFFICULTY_PRESET_IDS)[number];
export type DifficultyChoice = DifficultyPresetId | 'custom';

/** The presets from content, each resolved (validated against the sim's ranges) to a full config. */
export interface DifficultyPresets {
  /** The preset a player who never chose one plays on. */
  readonly default: DifficultyPresetId;
  readonly presets: Readonly<Record<DifficultyPresetId, DifficultyConfig>>;
}

/**
 * Resolves the content's presets into sim configs.
 * @throws DifficultyConfigError when a preset's number is outside the sim's allowed range.
 */
export function loadDifficultyPresets(
  game: Pick<GameConfigEntry, 'difficulty'>,
): DifficultyPresets {
  const { presets } = game.difficulty;
  return {
    default: game.difficulty.default,
    presets: {
      story: resolveDifficulty(presets.story),
      adventurer: resolveDifficulty(presets.adventurer),
      veteran: resolveDifficulty(presets.veteran),
    },
  };
}

type Gameplay = Settings['gameplay'];

/** The assist settings (Custom difficulty), in menu order. */
export const CUSTOM_DIFFICULTY_KEYS = [
  'gameplay.customDamageTaken',
  'gameplay.customParryWindow',
  'gameplay.customDetectionSpeed',
  'gameplay.customSearchDuration',
  'gameplay.customPuzzleHints',
  'gameplay.customFallDamage',
] as const satisfies readonly SettingKey[];

const DIFFICULTY_KEY = 'gameplay.difficulty' as const;

/**
 * The config the assist settings describe. The parry setting drives both timing windows; hints and
 * fall damage are on or off (1 or 0); damage dealt stays neutral.
 */
export function customDifficulty(gameplay: Gameplay): DifficultyConfig {
  return resolveDifficulty({
    damageTaken: gameplay.customDamageTaken,
    parryWindow: gameplay.customParryWindow,
    dodgeWindow: gameplay.customParryWindow,
    detectionSpeed: gameplay.customDetectionSpeed,
    searchDuration: gameplay.customSearchDuration,
    puzzleHints: gameplay.customPuzzleHints ? 1 : 0,
    fallDamage: gameplay.customFallDamage ? 1 : 0,
  });
}

/** The config the player's choice means: the chosen preset, or the assists for Custom. */
export function difficultyFor(gameplay: Gameplay, presets: DifficultyPresets): DifficultyConfig {
  return gameplay.difficulty === 'custom'
    ? customDifficulty(gameplay)
    : presets.presets[gameplay.difficulty];
}

const sameConfig = (a: DifficultyConfig, b: DifficultyConfig): boolean =>
  DIFFICULTY_KEYS.every((key) => Object.is(a[key], b[key]));

/** Which choice a config is: the preset it equals exactly, else Custom. */
export function choiceOf(config: DifficultyConfig, presets: DifficultyPresets): DifficultyChoice {
  return DIFFICULTY_PRESET_IDS.find((id) => sameConfig(presets.presets[id], config)) ?? 'custom';
}

/** The assist settings that show `config`. */
function customSettingsOf(config: DifficultyConfig): readonly [SettingKey, unknown][] {
  return [
    ['gameplay.customDamageTaken', config.damageTaken],
    ['gameplay.customParryWindow', config.parryWindow],
    ['gameplay.customDetectionSpeed', config.detectionSpeed],
    ['gameplay.customSearchDuration', config.searchDuration],
    ['gameplay.customPuzzleHints', config.puzzleHints > 0],
    ['gameplay.customFallDamage', config.fallDamage > 0],
  ];
}

/** A local telemetry event: enumerated values and a tick only, never free text. */
export interface DifficultyTelemetryEvent {
  readonly name: 'difficulty.changed';
  /** The sim tick the change took effect on. */
  readonly tick: number;
  readonly from: DifficultyChoice;
  readonly to: DifficultyChoice;
}

export interface DifficultyBindingOptions {
  readonly settings: SettingsStore;
  readonly world: World<never>;
  readonly presets: DifficultyPresets;
  /** Feeds a command to the next `World.step` (the game's command queue). */
  readonly submit: (command: DifficultyCommand) => void;
  /** Local sink for change events (no network); the game logs them. Best effort. */
  readonly telemetry?: (event: DifficultyTelemetryEvent) => void;
}

export interface DifficultyBinding {
  /** Sends the settings' difficulty to the sim (a new game: the player's chosen difficulty). */
  start(): void;
  /** Shows the sim's difficulty in the settings (after a save loaded into the world). */
  adopt(): void;
  dispose(): void;
}

/** Keeps the settings and the sim's difficulty in step; see the file comment. */
export function bindDifficulty(options: DifficultyBindingOptions): DifficultyBinding {
  const { settings, world, presets, submit, telemetry } = options;
  // What the sim was last asked to run (a queued command has not reached world.difficulty yet).
  let requested = world.difficulty;
  // True while this module writes settings itself, so those writes do not loop back.
  let writing = false;

  const write = (entries: readonly (readonly [SettingKey, unknown])[]): void => {
    writing = true;
    try {
      for (const [key, value] of entries) settings.set(key, value as never);
    } finally {
      writing = false;
    }
  };

  const push = (): void => {
    const wanted = difficultyFor(settings.snapshot().gameplay, presets);
    if (sameConfig(wanted, requested)) return;
    requested = wanted;
    submit(difficultyCommand(wanted));
  };

  const offSetting = settings.onChange((key) => {
    if (writing) return;
    if (key === DIFFICULTY_KEY) {
      const choice = settings.get(DIFFICULTY_KEY);
      // Picking a preset fills the assists with its values, so Custom starts from there.
      if (choice !== 'custom') write(customSettingsOf(presets.presets[choice]));
    } else if ((CUSTOM_DIFFICULTY_KEYS as readonly string[]).includes(key)) {
      // Touching an assist is choosing Custom.
      write([[DIFFICULTY_KEY, 'custom']]);
    } else return;
    push();
  });

  const offEvent = world.events.on(DifficultyChanged, ({ tick, previous, next }) => {
    try {
      telemetry?.({
        name: 'difficulty.changed',
        tick,
        from: choiceOf(previous, presets),
        to: choiceOf(next, presets),
      });
    } catch {
      // Telemetry is best effort; a broken sink must never break a tick.
    }
  });

  return {
    start: push,
    adopt: () => {
      requested = world.difficulty;
      write([[DIFFICULTY_KEY, choiceOf(requested, presets)], ...customSettingsOf(requested)]);
    },
    dispose: () => {
      offSetting();
      offEvent();
    },
  };
}
