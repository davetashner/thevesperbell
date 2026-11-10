// The settings store (mw-e31.1): lenient loading, per-key subscriptions, schema migration and the
// in-memory fallback when storage is unavailable.
import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsStore,
  defaultCategory,
  defaultSettings,
  describeValue,
  loadSettings,
  migrateSettings,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  settingDef,
  settingDefs,
  settingsSchema,
  type SettingKey,
  type SettingsStorage,
} from './index';

/** A Map-backed Web Storage stand-in. */
function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const stored = (settings: unknown, version: number = SETTINGS_VERSION): string =>
  JSON.stringify({ version, settings });

describe('schema', () => {
  it('every default satisfies the strict zod schema, and so does every repaired load', () => {
    expect(settingsSchema.safeParse(defaultSettings()).success).toBe(true);
    const repaired = normalizeSettings({ audio: { master: 7, bogus: 1 } }, () => undefined);
    expect(settingsSchema.parse(repaired)).toEqual(repaired);
  });

  it('lists the bead categories in menu order, with unique dotted keys', () => {
    expect(Object.keys(defaultSettings())).toEqual([
      'controls',
      'camera',
      'display',
      'audio',
      'accessibility',
      'gameplay',
    ]);
    const keys = settingDefs().map(({ key }) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(settingDef(key).label).not.toBe('');
  });

  it('mw-e04.10: HUD size is an accessibility slider, 75–200 %, default 100 %, needing no migration', () => {
    expect(settingDef('accessibility.hudScale')).toMatchObject({
      kind: 'slider',
      min: 0.75,
      max: 2,
      default: 1,
      unit: 'percent',
    });
    // Settings stored before it existed pick up the default.
    const stored = JSON.stringify({ version: SETTINGS_VERSION, settings: {} });
    expect(loadSettings(stored, () => undefined).accessibility.hudScale).toBe(1);
  });

  it('rejects an unknown key', () => {
    expect(() => settingDef('audio.nope' as SettingKey)).toThrow(RangeError);
  });

  it('describes values for warnings', () => {
    expect(describeValue(Number.NaN)).toBe('NaN');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue('loud')).toBe('"loud"');
  });
});

describe('loading', () => {
  it('AC-1: drops an unknown key, clamps an out-of-range value and warns about both', () => {
    const warn = vi.fn();
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: stored({
        audio: { master: 4, music: 0.3, loudness: 11 },
        camera: { fov: 20 },
      }),
    });
    const settings = createSettingsStore({ storage: () => storage, warn });
    expect(settings.get('audio.master')).toBe(1);
    expect(settings.get('camera.fov')).toBe(60);
    expect(settings.get('audio.music')).toBe(0.3);
    expect(settings.category('audio')).not.toHaveProperty('loudness');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped unknown setting audio.loudness'),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audio.master: 4 is outside 0–1'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('camera.fov: 20'));
  });

  it('AC-1: defaults a wrongly typed value, and drops unknown or malformed categories', () => {
    const warn = vi.fn();
    const settings = normalizeSettings(
      {
        camera: { invertY: 'yes', sensitivity: Number.NaN },
        gameplay: { difficulty: 'nightmare' },
        display: 'high',
        cheats: { god: true },
      },
      warn,
    );
    expect(settings.camera.invertY).toBe(false);
    expect(settings.camera.sensitivity).toBe(1);
    expect(settings.gameplay.difficulty).toBe('normal');
    expect(settings.display).toEqual(defaultCategory('display'));
    expect(warn.mock.calls.map(([m]) => m as string)).toEqual([
      'dropped unknown settings category cheats',
      'setting camera.sensitivity: NaN is invalid; using the default',
      'setting camera.invertY: "yes" is invalid; using the default',
      'settings category display is not an object; using its defaults',
      'setting gameplay.difficulty: "nightmare" is invalid; using the default',
    ]);
  });

  it('uses the defaults silently when nothing is stored, and loudly when the document is junk', () => {
    const warn = vi.fn();
    expect(loadSettings(null, warn)).toEqual(defaultSettings());
    expect(warn).not.toHaveBeenCalled();
    for (const junk of ['{nope', '[]', '{"settings":{}}', '{"version":0}', '{"version":1.5}']) {
      expect(loadSettings(junk, warn)).toEqual(defaultSettings());
    }
    expect(warn).toHaveBeenCalledTimes(5);
    expect(normalizeSettings(42, warn)).toEqual(defaultSettings());
    expect(warn).toHaveBeenLastCalledWith('stored settings are not an object; using the defaults');
  });

  it('keeps what it understands from a newer build, and tolerates a missing settings object', () => {
    const warn = vi.fn();
    const settings = loadSettings(
      stored({ audio: { master: 0.4, spatial: 'hrtf' } }, SETTINGS_VERSION + 1),
      warn,
    );
    expect(settings.audio.master).toBe(0.4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('from a newer build'));
    expect(loadSettings(JSON.stringify({ version: SETTINGS_VERSION }), warn)).toEqual(
      defaultSettings(),
    );
  });
});

describe('subscriptions', () => {
  it('AC-2: a subscriber to audio.master fires once with the new value; unchanged sets do not fire', () => {
    const settings = createSettingsStore();
    const master = vi.fn();
    const any = vi.fn();
    settings.on('audio.master', master);
    settings.onChange(any);
    expect(settings.set('audio.master', 0.5)).toBe(true);
    expect(master).toHaveBeenCalledTimes(1);
    expect(master).toHaveBeenCalledWith(0.5, 'audio.master');
    expect(any).toHaveBeenCalledWith('audio.master', 0.5);
    expect(settings.set('audio.master', 0.5)).toBe(false);
    settings.set('audio.music', 0.2);
    expect(master).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('AC-2: a stored text size of 350% loads as 200%', () => {
    const warn = vi.fn();
    const settings = loadSettings(stored({ accessibility: { textScale: 3.5 } }), warn);
    expect(settings.accessibility.textScale).toBe(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('clamps an out-of-range set, ignores an invalid one, and unsubscribes', () => {
    const warn = vi.fn();
    const settings = createSettingsStore({ warn });
    const fov = vi.fn();
    const off = settings.on('camera.fov', fov);
    settings.set('camera.fov', 500);
    expect(fov).toHaveBeenCalledWith(100, 'camera.fov');
    expect(settings.set('camera.fov', 500)).toBe(false);
    expect(settings.set('gameplay.difficulty', 'nightmare' as 'hard')).toBe(false);
    expect(settings.set('camera.invertY', 'yes' as unknown as boolean)).toBe(false);
    expect(settings.get('gameplay.difficulty')).toBe('normal');
    expect(warn).toHaveBeenCalledWith(
      'setting gameplay.difficulty: "nightmare" is invalid; ignored',
    );
    const second = vi.fn();
    settings.on('camera.fov', second);
    settings.set('camera.fov', 90);
    expect(second).toHaveBeenCalledWith(90, 'camera.fov');
    expect(fov).toHaveBeenCalledTimes(2);
    off();
    const offAny = settings.onChange(fov);
    offAny();
    settings.set('camera.fov', 80);
    expect(fov).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('reset returns only that category to its defaults, notifying each changed key once', () => {
    const storage = memoryStorage();
    const settings = createSettingsStore({ storage: () => storage });
    settings.set('camera.invertY', true);
    settings.set('camera.fov', 90);
    settings.set('audio.master', 0.25);
    const changes = vi.fn();
    settings.onChange(changes);
    settings.reset('camera');
    expect(settings.category('camera')).toEqual(defaultCategory('camera'));
    expect(settings.get('audio.master')).toBe(0.25);
    expect(changes.mock.calls).toEqual([
      ['camera.invertY', false],
      ['camera.fov', 70],
    ]);
    const writes = storage.data.get(SETTINGS_STORAGE_KEY);
    settings.reset('camera');
    expect(changes).toHaveBeenCalledTimes(2);
    expect(storage.data.get(SETTINGS_STORAGE_KEY)).toBe(writes);
  });

  it('snapshots are frozen copies', () => {
    const settings = createSettingsStore();
    const snapshot = settings.snapshot();
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.audio)).toBe(true);
    settings.set('audio.master', 0.1);
    expect(snapshot.audio.master).toBe(0.8);
  });
});

describe('persistence and migration', () => {
  it('writes every change as a versioned document and reads it back', () => {
    const storage = memoryStorage();
    const first = createSettingsStore({ storage: () => storage });
    expect(first.persistent).toBe(true);
    first.set('accessibility.subtitles', false);
    expect(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY) ?? '')).toMatchObject({
      version: SETTINGS_VERSION,
      settings: { accessibility: { subtitles: false } },
    });
    expect(createSettingsStore({ storage: () => storage }).get('accessibility.subtitles')).toBe(
      false,
    );
  });

  it('AC-3: v1 settings load into v2 with renamed keys mapped and user values preserved', () => {
    const warn = vi.fn();
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: stored(
        {
          audio: { masterVolume: 0.35, music: 0.6 },
          camera: { lookSensitivity: 1.7, invertY: true },
          display: { uiScale: 1.5, quality: 'low' },
        },
        1,
      ),
    });
    const settings = createSettingsStore({ storage: () => storage, warn });
    expect(settings.get('audio.master')).toBe(0.35);
    expect(settings.get('audio.music')).toBe(0.6);
    expect(settings.get('camera.sensitivity')).toBe(1.7);
    expect(settings.get('camera.invertY')).toBe(true);
    expect(settings.get('accessibility.textScale')).toBe(1.5);
    expect(settings.get('display.quality')).toBe('low');
    expect(warn).not.toHaveBeenCalled();
    // Saved back at the current version on the next change.
    settings.set('audio.sfx', 0.5);
    expect(JSON.parse(storage.data.get(SETTINGS_STORAGE_KEY) ?? '')).toMatchObject({
      version: SETTINGS_VERSION,
    });
  });

  it('AC-3: the v1 migration leaves absent keys alone and creates the target category', () => {
    expect(migrateSettings({ audio: { music: 1 } }, 1)).toEqual({ audio: { music: 1 } });
    expect(migrateSettings({ display: { uiScale: 2 } }, 1)).toEqual({
      display: {},
      accessibility: { textScale: 2 },
    });
    expect(migrateSettings({ x: 1 }, SETTINGS_VERSION)).toEqual({ x: 1 });
  });

  it('a gap in the migration chain falls back to the defaults with a warning', () => {
    expect(() => migrateSettings({}, 1, 3, { 1: (s) => s })).toThrow(/v2 to v3/);
    const warn = vi.fn();
    const settings = loadSettings(stored({ audio: { master: 0.1 } }, 0.5), warn);
    expect(settings).toEqual(defaultSettings());
    const fromV0 = loadSettings(JSON.stringify({ version: -1 }), warn);
    expect(fromV0).toEqual(defaultSettings());
  });

  it('a migration that throws falls back to the defaults with a warning', async () => {
    vi.resetModules();
    vi.doMock('./migrations', () => ({
      migrateSettings: () => {
        throw new Error('boom');
      },
    }));
    const { loadSettings: load } = await import('./store');
    const warn = vi.fn();
    expect(load(stored({}, 1), warn)).toEqual(defaultSettings());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be migrated (Error: boom)'),
    );
    vi.doUnmock('./migrations');
  });
});

describe('storage unavailable', () => {
  it('AC-6: when localStorage cannot even be reached, defaults live in memory and nothing throws', () => {
    const warn = vi.fn();
    const settings = createSettingsStore({
      storage: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      warn,
    });
    expect(settings.persistent).toBe(false);
    expect(settings.snapshot()).toEqual(defaultSettings());
    expect(warn).toHaveBeenCalledWith(
      'storage unavailable (SecurityError: The operation is insecure.); settings last this session only',
    );
    expect(settings.set('camera.invertY', true)).toBe(true);
    expect(settings.get('camera.invertY')).toBe(true);
  });

  it('AC-6: with no storage at all, or one whose reads throw, the game starts on defaults', () => {
    const warn = vi.fn();
    expect(createSettingsStore({ storage: () => undefined, warn }).persistent).toBe(false);
    expect(createSettingsStore({ storage: () => null, warn }).persistent).toBe(false);
    const reads = createSettingsStore({
      storage: () => ({
        getItem: () => {
          const notAnError: unknown = 'denied';
          throw notAnError;
        },
        setItem: () => undefined,
      }),
      warn,
    });
    expect(reads.persistent).toBe(false);
    expect(reads.snapshot()).toEqual(defaultSettings());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(denied)'));
  });

  it('AC-6: a refused write (quota) drops to memory once, keeping the value', () => {
    const warn = vi.fn();
    const setItem = vi.fn(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const settings = createSettingsStore({
      storage: () => ({ getItem: () => null, setItem }),
      warn,
    });
    settings.set('audio.master', 0.3);
    settings.set('audio.master', 0.4);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(settings.persistent).toBe(false);
    expect(settings.get('audio.master')).toBe(0.4);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns on the console by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createSettingsStore({ storage: () => memoryStorage({ [SETTINGS_STORAGE_KEY]: '{' }) });
    expect(spy).toHaveBeenCalledWith(
      '[settings] stored settings are not valid JSON; using the defaults',
    );
    spy.mockRestore();
  });
});

describe('mixer settings (mw-e28.5)', () => {
  it('AC-4: bus volumes, mute-when-hidden and night mode persist across a reload', () => {
    const storage = new Map<string, string>();
    const backing = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };
    const first = createSettingsStore({ storage: () => backing });
    expect(first.get('audio.muteHidden')).toBe(true);
    expect(first.get('audio.nightMode')).toBe(false);
    first.set('audio.ambience', 0.4);
    first.set('audio.ui', 0.1);
    first.set('audio.muteHidden', false);
    first.set('audio.nightMode', true);
    const reloaded = createSettingsStore({ storage: () => backing });
    expect(reloaded.get('audio.ambience')).toBe(0.4);
    expect(reloaded.get('audio.ui')).toBe(0.1);
    expect(reloaded.get('audio.muteHidden')).toBe(false);
    expect(reloaded.get('audio.nightMode')).toBe(true);
  });
});
