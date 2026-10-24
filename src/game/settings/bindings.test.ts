// Persisting input bindings through the settings store (mw-e02.22).
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  isKeyboardMouseCode,
  rebind,
  type Bindings,
} from '../input/bindings';
import { createSettingsStore, loadBindings, saveBindings, SETTINGS_STORAGE_KEY } from './index';
import type { SettingsStorage } from './index';

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function rebound(bindings: Bindings, action: Parameters<typeof rebind>[1], code: string): Bindings {
  const result = rebind(bindings, action, code);
  if (!result.ok) throw new Error('unexpected conflict');
  return result.bindings;
}

const stored = (bindings: unknown): string =>
  JSON.stringify({ version: 2, settings: {}, bindings });

describe('saving and loading bindings', () => {
  it('AC-1: custom bindings saved through the settings store are restored after a reload', () => {
    const storage = memoryStorage();
    const first = createSettingsStore({ storage: () => storage });
    first.set('audio.music', 0.5);
    const keyboard = rebound(DEFAULT_BINDINGS, 'jump', 'KeyF');
    const pad = rebound(DEFAULT_PAD_BINDINGS, 'jump', 'PadGuide');
    saveBindings(first, keyboard, pad);

    const reloaded = createSettingsStore({ storage: () => storage });
    const warn = vi.fn();
    const loaded = loadBindings(reloaded, warn);
    expect(loaded.bindings).toEqual(keyboard);
    expect(loaded.gamepad).toEqual(pad);
    expect(warn).not.toHaveBeenCalled();
    expect(reloaded.get('audio.music')).toBe(0.5);
  });

  it('AC-1: other settings changes keep the saved bindings, and the reverse', () => {
    const storage = memoryStorage();
    const store = createSettingsStore({ storage: () => storage });
    saveBindings(store, rebound(DEFAULT_BINDINGS, 'jump', 'KeyF'), DEFAULT_PAD_BINDINGS);
    store.set('camera.invertY', true);
    const again = createSettingsStore({ storage: () => storage });
    expect(loadBindings(again).bindings.jump).toEqual(['KeyF']);
    expect(again.get('camera.invertY')).toBe(true);
  });

  it('gives the defaults, without warnings, when nothing is stored', () => {
    const warn = vi.fn();
    const loaded = loadBindings(createSettingsStore({ storage: () => memoryStorage() }), warn);
    expect(loaded.bindings).toBe(DEFAULT_BINDINGS);
    expect(loaded.gamepad).toBe(DEFAULT_PAD_BINDINGS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('tolerates a stored document that is not JSON or not an object', () => {
    for (const text of ['{nope', '[1]']) {
      const store = createSettingsStore({
        storage: () => memoryStorage({ [SETTINGS_STORAGE_KEY]: text }),
        warn: () => undefined,
      });
      expect(store.storedBindings).toBeUndefined();
      expect(loadBindings(store, () => undefined).bindings).toBe(DEFAULT_BINDINGS);
    }
  });

  it('works on the in-memory fallback when storage is unavailable', () => {
    const store = createSettingsStore({ warn: () => undefined });
    saveBindings(store, rebound(DEFAULT_BINDINGS, 'jump', 'KeyF'), DEFAULT_PAD_BINDINGS);
    expect(loadBindings(store).bindings.jump).toEqual(['KeyF']);
  });

  it('warns on the console by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createSettingsStore({
      storage: () => memoryStorage({ [SETTINGS_STORAGE_KEY]: stored('junk') }),
    });
    loadBindings(store);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[bindings]'));
    spy.mockRestore();
  });
});

describe('migration of stored bindings', () => {
  const load = (bindings: unknown): ReturnType<typeof loadBindings> & { warnings: string[] } => {
    const warnings: string[] = [];
    const store = createSettingsStore({
      storage: () => memoryStorage({ [SETTINGS_STORAGE_KEY]: stored(bindings) }),
      warn: () => undefined,
    });
    return { ...loadBindings(store, (m) => warnings.push(m)), warnings };
  };

  it('AC-2: an unknown action is dropped and the defaults fill the gap', () => {
    const { bindings, gamepad, warnings } = load({
      version: 2,
      actions: { jump: ['KeyF'], dance: ['KeyZ'] },
      gamepad: { wave: ['PadA'] },
    });
    expect(bindings.jump).toEqual(['KeyF']);
    expect(bindings.sprint).toEqual(DEFAULT_BINDINGS.sprint);
    expect(Object.keys(bindings)).not.toContain('dance');
    expect(gamepad).toEqual(DEFAULT_PAD_BINDINGS);
    expect(warnings).toEqual([
      'dance: unknown action ignored',
      'gamepad wave: unknown action ignored',
    ]);
  });

  it('AC-2: an unknown key, mouse or pad code drops that entry and the default fills the gap', () => {
    const { bindings, gamepad, warnings } = load({
      version: 2,
      actions: { jump: ['KeyF'], crouch: ['KeyNope'], interact: ['Mouse9'], sprint: ['PadA'] },
      gamepad: { jump: ['PadNope'], dodge: ['KeyB'] },
    });
    expect(bindings.jump).toEqual(['KeyF']);
    expect(bindings.crouch).toEqual(DEFAULT_BINDINGS.crouch);
    expect(bindings.interact).toEqual(DEFAULT_BINDINGS.interact);
    expect(bindings.sprint).toEqual(DEFAULT_BINDINGS.sprint);
    expect(gamepad).toEqual(DEFAULT_PAD_BINDINGS);
    expect(warnings).toHaveLength(5);
  });

  it('AC-2: a stored set with a conflict falls back to that device defaults, whole', () => {
    const { bindings, warnings } = load({ version: 2, actions: { jump: ['KeyE'] }, gamepad: {} });
    expect(bindings).toBe(DEFAULT_BINDINGS);
    expect(warnings).toEqual(['conflicting bindings KeyE (jump, interact); using defaults']);
  });

  it('AC-2: data that is not bindings data at all gives the defaults', () => {
    const { bindings, gamepad } = load('junk');
    expect(bindings).toBe(DEFAULT_BINDINGS);
    expect(gamepad).toBe(DEFAULT_PAD_BINDINGS);
  });
});

describe('isKeyboardMouseCode', () => {
  it('accepts every default keyboard and mouse code and rejects the rest', () => {
    for (const codes of Object.values(DEFAULT_BINDINGS)) {
      for (const code of codes) expect(isKeyboardMouseCode(code)).toBe(true);
    }
    for (const code of ['', 'PadA', 'Mouse5', 'KeyNope', 'keyw']) {
      expect(isKeyboardMouseCode(code)).toBe(false);
    }
  });
});
