// mw-e31.10: presets, the assist settings and the bridge into the sim's DifficultyConfig.
import { describe, expect, it } from 'vitest';
import { loadGameContent, GAME_CONFIG_ID } from '@content/index';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_RANGES,
  DifficultyConfigError,
  hashWorld,
  World,
  type DifficultyCommand,
  type DifficultyConfig,
} from '@sim/index';
import {
  SaveRegistry,
  decodeSave,
  encodeSave,
  WORLD_SECTION_ID,
  type SaveEnvelope,
} from '../save/format';
import {
  bindDifficulty,
  choiceOf,
  CUSTOM_DIFFICULTY_KEYS,
  customDifficulty,
  difficultyFor,
  loadDifficultyPresets,
  type DifficultyTelemetryEvent,
} from './difficulty';
import { SETTINGS_SCHEMA, defaultSettings, settingDef, type SliderSetting } from './schema';
import { createSettingsStore } from './store';

const game = loadGameContent().get('game', GAME_CONFIG_ID);
const presets = loadDifficultyPresets(game);

describe('presets', () => {
  it('AC-1: Story resolves to damageTaken 0.5, parryWindow 1.5, detectionSpeed 0.6', () => {
    expect(presets.presets.story).toMatchObject({
      damageTaken: 0.5,
      parryWindow: 1.5,
      detectionSpeed: 0.6,
    });
  });

  it('the default preset is Adventurer, which is the neutral config (the game as authored)', () => {
    expect(presets.default).toBe('adventurer');
    expect(presets.presets.adventurer).toEqual(DEFAULT_DIFFICULTY);
    expect(defaultSettings().gameplay.difficulty).toBe(presets.default);
  });

  it('Veteran is harder than Adventurer and Story easier, on every difficulty multiplier', () => {
    const { story, adventurer, veteran } = presets.presets;
    expect(story.damageTaken).toBeLessThan(adventurer.damageTaken);
    expect(veteran.damageTaken).toBeGreaterThan(adventurer.damageTaken);
    expect(story.parryWindow).toBeGreaterThan(veteran.parryWindow);
    expect(story.detectionSpeed).toBeLessThan(veteran.detectionSpeed);
    expect(story.searchDuration).toBeLessThan(veteran.searchDuration);
  });

  it('AC-3: a preset outside the sim ranges is rejected naming the field', () => {
    const bad = {
      difficulty: {
        ...game.difficulty,
        presets: {
          ...game.difficulty.presets,
          veteran: { ...game.difficulty.presets.veteran, parryWindow: 10 },
        },
      },
    };
    expect(() => loadDifficultyPresets(bad)).toThrow(DifficultyConfigError);
    expect(() => loadDifficultyPresets(bad)).toThrow(/parryWindow/);
  });

  it('the assist sliders allow exactly the ranges the sim does', () => {
    const sliders: Record<string, keyof typeof DIFFICULTY_RANGES> = {
      customDamageTaken: 'damageTaken',
      customParryWindow: 'parryWindow',
      customDetectionSpeed: 'detectionSpeed',
      customSearchDuration: 'searchDuration',
    };
    for (const [name, key] of Object.entries(sliders)) {
      const def = (SETTINGS_SCHEMA.gameplay.settings as Readonly<Record<string, unknown>>)[name] as
        SliderSetting | undefined;
      expect({ name, min: def?.min, max: def?.max }).toEqual({ name, ...DIFFICULTY_RANGES[key] });
    }
    expect(CUSTOM_DIFFICULTY_KEYS.map((key) => settingDef(key).default)).toEqual([
      1,
      1,
      1,
      1,
      true,
      true,
    ]);
  });
});

describe('what the settings mean', () => {
  it('a preset choice is that preset; Custom is built from the assists', () => {
    const gameplay = { ...defaultSettings().gameplay };
    expect(difficultyFor({ ...gameplay, difficulty: 'veteran' }, presets)).toBe(
      presets.presets.veteran,
    );
    const custom = {
      ...gameplay,
      difficulty: 'custom' as const,
      customDamageTaken: 2,
      customParryWindow: 1.2,
      customDetectionSpeed: 0.5,
      customSearchDuration: 3,
      customPuzzleHints: false,
      customFallDamage: false,
    };
    expect(difficultyFor(custom, presets)).toEqual({
      ...DEFAULT_DIFFICULTY,
      damageTaken: 2,
      parryWindow: 1.2,
      dodgeWindow: 1.2,
      detectionSpeed: 0.5,
      searchDuration: 3,
      puzzleHints: 0,
      fallDamage: 0,
    });
    expect(customDifficulty(gameplay)).toEqual(DEFAULT_DIFFICULTY);
  });

  it('choiceOf names a preset only for an exact match', () => {
    expect(choiceOf(presets.presets.story, presets)).toBe('story');
    expect(choiceOf(DEFAULT_DIFFICULTY, presets)).toBe('adventurer');
    expect(choiceOf({ ...DEFAULT_DIFFICULTY, damageTaken: 1.01 }, presets)).toBe('custom');
  });
});

/** A world, its command queue and settings, with the binding between them. */
function rig(initial?: Parameters<typeof createSettingsStore>[0] extends infer O ? O : never) {
  const settings = createSettingsStore(initial ?? {});
  const world = new World<DifficultyCommand>({ seed: 3 });
  const queue: DifficultyCommand[] = [];
  const events: DifficultyTelemetryEvent[] = [];
  const binding = bindDifficulty({
    settings,
    world,
    presets,
    submit: (command) => queue.push(command),
    telemetry: (event) => events.push(event),
  });
  /** Steps one tick with whatever the settings queued, as the game loop does. */
  const step = (): void => {
    world.step(queue.splice(0));
  };
  return { settings, world, queue, events, binding, step };
}

describe('the settings to sim bridge', () => {
  it('Adventurer at start sends nothing, so the game is unchanged', () => {
    const { binding, queue, step, world } = rig();
    const before = hashWorld(new World({ seed: 3 }));
    binding.start();
    step();
    expect(queue).toEqual([]);
    expect(world.difficulty).toEqual(DEFAULT_DIFFICULTY);
    expect(hashWorld(new World({ seed: 3 }))).toBe(before);
  });

  it('start sends a stored non-default preset', () => {
    const { binding, step, world, events } = rig({ initial: { 'gameplay.difficulty': 'story' } });
    binding.start();
    step();
    expect(world.difficulty).toEqual(presets.presets.story);
    expect(events).toEqual([
      { name: 'difficulty.changed', tick: 0, from: 'adventurer', to: 'story' },
    ]);
  });

  it('picking a preset mid-game changes the sim on the next tick, fills the assists, and logs once', () => {
    const { settings, world, events, step } = rig();
    step();
    settings.set('gameplay.difficulty', 'veteran');
    expect(settings.get('gameplay.customDamageTaken')).toBe(1.5);
    expect(settings.get('gameplay.customPuzzleHints')).toBe(true);
    expect(world.difficulty).toEqual(DEFAULT_DIFFICULTY); // not until a tick runs
    step();
    step();
    expect(world.difficulty).toEqual(presets.presets.veteran);
    expect(events).toEqual([
      { name: 'difficulty.changed', tick: 1, from: 'adventurer', to: 'veteran' },
    ]);
  });

  it('touching an assist switches to Custom and applies the assist', () => {
    const { settings, world, events, step } = rig({ initial: { 'gameplay.difficulty': 'story' } });
    settings.set('gameplay.customFallDamage', false);
    expect(settings.get('gameplay.difficulty')).toBe('custom');
    step();
    expect(world.difficulty.fallDamage).toBe(0);
    expect(events.map((e) => e.to)).toEqual(['custom']);
    settings.set('gameplay.customDamageTaken', 2);
    step();
    expect(world.difficulty.damageTaken).toBe(2);
    expect(events.map((e) => e.to)).toEqual(['custom', 'custom']);
  });

  it('choosing Custom uses the assists as they stand, and settings that are not difficulty are ignored', () => {
    const { settings, queue, step, world } = rig();
    settings.set('camera.invertY', true);
    expect(queue).toEqual([]);
    settings.set('gameplay.difficulty', 'veteran');
    settings.set('gameplay.difficulty', 'custom');
    step();
    expect(world.difficulty).toEqual({ ...presets.presets.veteran, damageDealt: 1 });
  });

  it('a change that lands on the current config sends nothing', () => {
    const { settings, queue } = rig();
    settings.set('gameplay.difficulty', 'custom');
    expect(queue).toEqual([]);
  });

  it('a throwing telemetry sink never breaks a tick; dispose detaches the bridge', () => {
    const settings = createSettingsStore({});
    const world = new World<DifficultyCommand>({ seed: 3 });
    const queue: DifficultyCommand[] = [];
    const binding = bindDifficulty({
      settings,
      world,
      presets,
      submit: (c) => {
        queue.push(c);
      },
      telemetry: () => {
        throw new Error('sink down');
      },
    });
    settings.set('gameplay.difficulty', 'story');
    expect(() => {
      world.step(queue.splice(0));
    }).not.toThrow();
    expect(world.difficulty).toEqual(presets.presets.story);
    binding.dispose();
    settings.set('gameplay.difficulty', 'veteran');
    expect(queue).toEqual([]);
  });

  it('works with no telemetry sink', () => {
    const settings = createSettingsStore({});
    const world = new World<DifficultyCommand>({ seed: 3 });
    const queue: DifficultyCommand[] = [];
    bindDifficulty({
      settings,
      world,
      presets,
      submit: (c) => {
        queue.push(c);
      },
    });
    settings.set('gameplay.difficulty', 'story');
    expect(() => {
      world.step(queue.splice(0));
    }).not.toThrow();
  });
});

describe('difficulty across a save', () => {
  const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
  const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };

  it('AC-4: changed mid-session, saved and reloaded, the new config is restored and the change was logged once', () => {
    const { settings, world, events, step, binding } = rig();
    step();
    settings.set('gameplay.difficulty', 'story');
    step();
    step();
    expect(events).toHaveLength(1);

    const registry = new SaveRegistry();
    const bytes = registry.write(world, saveOptions);

    // A fresh session whose settings say Veteran loads the save: the save wins, and the menu shows it.
    const loaded = rig({ initial: { 'gameplay.difficulty': 'veteran' } });
    expect(registry.read(loaded.world, bytes)).toMatchObject({ ok: true });
    loaded.binding.adopt();
    expect(loaded.world.difficulty).toEqual(presets.presets.story);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
    expect(loaded.settings.get('gameplay.difficulty')).toBe('story');
    expect(loaded.settings.get('gameplay.customDamageTaken')).toBe(0.5);
    loaded.step();
    expect(loaded.events).toEqual([]); // loading is not a change
    binding.dispose();
  });

  it('a save made before difficulty existed loads as Adventurer', () => {
    const registry = new SaveRegistry();
    const decoded = decodeSave(registry.write(new World({ seed: 3 }), saveOptions));
    if (!decoded.ok) throw decoded.error;
    const envelope: SaveEnvelope = decoded.envelope;
    const record = envelope.sections[WORLD_SECTION_ID];
    const old: Record<string, unknown> = { ...(record?.data as Record<string, unknown>) };
    delete old['difficulty'];
    const bytes = encodeSave({
      ...envelope,
      sections: { ...envelope.sections, [WORLD_SECTION_ID]: { version: 1, data: old } },
    });

    const { world, settings, binding } = rig({ initial: { 'gameplay.difficulty': 'veteran' } });
    expect(registry.read(world, bytes)).toMatchObject({ ok: true });
    binding.adopt();
    expect(world.difficulty).toEqual(DEFAULT_DIFFICULTY);
    expect(settings.get('gameplay.difficulty')).toBe('adventurer');
  });

  it('a loaded config that is no preset shows as Custom with its assists', () => {
    const { world, settings, binding, queue } = rig();
    world.restore(
      new World({ seed: 3, difficulty: { damageTaken: 2, puzzleHints: 0 } }).snapshot(),
    );
    binding.adopt();
    expect(settings.get('gameplay.difficulty')).toBe('custom');
    expect(settings.get('gameplay.customDamageTaken')).toBe(2);
    expect(settings.get('gameplay.customPuzzleHints')).toBe(false);
    expect(queue).toEqual([]);
    // The world keeps what the save said until the player changes something.
    const config: DifficultyConfig = world.difficulty;
    expect(config.damageTaken).toBe(2);
  });
});
