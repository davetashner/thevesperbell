import { describe, expect, it } from 'vitest';
import { ActionSampler } from '../input/sampler';
import { bindHoldToggle, toggledActions } from './hold-toggle';
import { migrateSettings } from './migrations';
import { defaultSettings, settingDef } from './schema';
import { createSettingsStore, SETTINGS_STORAGE_KEY, type SettingsStorage } from './store';

const memory = (initial: Record<string, string> = {}): SettingsStorage => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe('hold or toggle settings (mw-e31.3)', () => {
  it('every sustained action defaults to hold, so behaviour is unchanged', () => {
    for (const key of ['sprint', 'crouch', 'block', 'aim'] as const) {
      expect(defaultSettings().controls[key]).toBe('hold');
      expect(settingDef(`controls.${key}`)).toMatchObject({
        kind: 'select',
        options: [
          { value: 'hold', label: 'Hold' },
          { value: 'toggle', label: 'Toggle' },
        ],
      });
    }
    expect(toggledActions(createSettingsStore())).toEqual([]);
  });

  it('maps block to the secondary attack and aim to the primary attack', () => {
    const settings = createSettingsStore();
    settings.set('controls.block', 'toggle');
    settings.set('controls.aim', 'toggle');
    expect(toggledActions(settings)).toEqual(['secondaryAttack', 'primaryAttack']);
  });

  it('persists the choice with the other settings', () => {
    const storage = memory();
    createSettingsStore({ storage: () => storage }).set('controls.crouch', 'toggle');
    const reloaded = createSettingsStore({ storage: () => storage });
    expect(reloaded.get('controls.crouch')).toBe('toggle');
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('"crouch":"toggle"');
  });

  it('a crouch choice stored while the option was inert is dropped by the v2 migration', () => {
    expect(
      migrateSettings({ controls: { crouch: 'toggle', sprint: 'toggle' }, audio: {} }, 2),
    ).toEqual({ controls: { sprint: 'toggle' }, audio: {} });
    expect(migrateSettings({ controls: { sprint: 'toggle' } }, 2)).toEqual({
      controls: { sprint: 'toggle' },
    });
    expect(migrateSettings({}, 2)).toEqual({});
  });

  it('AC-3: changing the setting mid-hold applies at once, releases the action, and cannot stick', () => {
    const settings = createSettingsStore();
    const sampler = new ActionSampler();
    const stop = bindHoldToggle(settings, sampler);
    sampler.down('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    settings.set('controls.crouch', 'toggle');
    expect(sampler.sample().crouch).toEqual({ pressed: false, held: false, released: true });
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(false);
    sampler.down('KeyC');
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    settings.set('controls.crouch', 'hold');
    expect(sampler.sample().crouch.held).toBe(false);
    stop();
    settings.set('controls.crouch', 'toggle');
    sampler.down('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(false);
  });

  it('a locked page (a replay) stays on hold whatever the settings say', () => {
    const settings = createSettingsStore();
    settings.set('controls.sprint', 'toggle');
    const sampler = new ActionSampler();
    bindHoldToggle(settings, sampler, () => true);
    expect(sampler.toggled.size).toBe(0);
    sampler.down('ShiftLeft');
    sampler.up('ShiftLeft');
    sampler.sample();
    expect(sampler.sample().sprint.held).toBe(false);
  });
});
