import { describe, expect, it } from 'vitest';
import { comfortDefaults } from './comfort-defaults';
import { createSettingsStore } from './store';

const query = (matches: boolean) => (q: string) => {
  expect(q).toBe('(prefers-reduced-motion: reduce)');
  return { matches };
};
const memory = (text: string | null) => () => ({
  getItem: () => text,
  setItem: () => undefined,
});

describe('comfort defaults (mw-e31.7)', () => {
  it('AC-3: with reduced motion on, a first launch has shake 0 and reduce-flashing on', () => {
    const store = createSettingsStore({ initial: comfortDefaults(query(true)) });
    expect(store.get('camera.shakeScale')).toBe(0);
    expect(store.get('accessibility.reduceFlashing')).toBe(true);
    expect(store.get('accessibility.reduceScreenEffects')).toBe(false);
  });

  it('keeps the normal defaults without the preference or without matchMedia', () => {
    for (const media of [query(false), undefined]) {
      const store = createSettingsStore({ initial: comfortDefaults(media) });
      expect(store.get('camera.shakeScale')).toBe(1);
      expect(store.get('accessibility.reduceFlashing')).toBe(false);
    }
  });

  it('saved settings win over the initial values, and the player can turn shake back up', () => {
    const saved = JSON.stringify({ version: 3, settings: { camera: { shakeScale: 0.5 } } });
    const store = createSettingsStore({
      storage: memory(saved),
      initial: comfortDefaults(query(true)),
    });
    expect(store.get('camera.shakeScale')).toBe(0.5);
    expect(store.get('accessibility.reduceFlashing')).toBe(false);
    const fresh = createSettingsStore({ initial: comfortDefaults(query(true)) });
    expect(fresh.set('camera.shakeScale', 1)).toBe(true);
  });

  it('ignores an invalid initial value', () => {
    const store = createSettingsStore({ initial: { 'camera.shakeScale': 7 } });
    expect(store.get('camera.shakeScale')).toBe(1);
  });
});
