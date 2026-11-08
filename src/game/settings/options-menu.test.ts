// @vitest-environment happy-dom
// The options menu shell (mw-e31.1): controls generated from the schema, changes applied through the
// store, per-category reset behind a confirmation, and keyboard/gamepad operation.
import { beforeEach, describe, expect, it } from 'vitest';
import { UiRoot } from '@ui/screens';
import { find } from '@ui/testing/layout';
import {
  createSettingsStore,
  defaultCategory,
  formatSlider,
  keyLabel,
  OPTIONS_SCREEN,
  openOptionsMenu,
  settingDefs,
  type SettingsStore,
} from './index';

let ui: UiRoot;
let settings: SettingsStore;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
  settings = createSettingsStore();
});

const control = (key: string): HTMLElement => find(`[data-setting="${key}"]`);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const pressReset = (category: string): void => {
  find(`[data-reset="${category}"]`).click();
};
const confirmButton = (label: string): HTMLElement => {
  const found = [...find('[data-testid="confirm"]').querySelectorAll('button')].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

describe('options menu', () => {
  it('opens a paused screen with one tab per category and a control per setting', () => {
    const menu = openOptionsMenu(ui, settings);
    expect(menu.screen.id).toBe(OPTIONS_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      'Controls',
      'Camera',
      'Display',
      'Audio',
      'Accessibility',
      'Gameplay',
    ]);
    expect(menu.tabs.selected).toBe('controls');
    for (const { key, def } of settingDefs()) {
      // A keybind setting has no generic control; the Key bindings panel edits it.
      if (def.kind === 'keybind') {
        expect(document.querySelector(`[data-setting="${key}"]`)).toBeNull();
        continue;
      }
      const el = control(key);
      const help = document.getElementById(el.getAttribute('aria-describedby') ?? '');
      expect(help?.textContent).toBe(def.help);
    }
    expect(find('[data-bindings]').getAttribute('aria-label')).toBe('Key bindings');
    expect(
      openOptionsMenu(ui, settings, { category: 'audio', pausesSim: false }).tabs.selected,
    ).toBe('audio');
  });

  it('applies each kind of control to the store immediately', () => {
    openOptionsMenu(ui, settings, { category: 'camera' });
    control('camera.invertY').click();
    expect(settings.get('camera.invertY')).toBe(true);
    expect(control('camera.invertY').getAttribute('aria-checked')).toBe('true');

    control('camera.fov').focus();
    ui.intent('right', 'keyboard');
    expect(settings.get('camera.fov')).toBe(75);
    expect(control('camera.fov').getAttribute('aria-valuetext')).toBe('75°');

    control('display.quality').click();
    expect(settings.get('display.quality')).toBe('low');
  });

  it('shows changes made elsewhere (and ignores echoes of its own)', () => {
    openOptionsMenu(ui, settings);
    settings.set('audio.master', 0.25);
    settings.set('camera.invertX', true);
    expect(control('audio.master').getAttribute('aria-valuetext')).toBe('25%');
    expect(control('camera.invertX').getAttribute('aria-checked')).toBe('true');
    const master = control('audio.master');
    ui.pop();
    // Closed: no longer listening.
    settings.set('audio.master', 0.5);
    expect(master.getAttribute('aria-valuetext')).toBe('25%');
  });

  it('AC-5: confirming "Reset to defaults" in Camera resets only camera settings', async () => {
    openOptionsMenu(ui, settings, { category: 'camera' });
    settings.set('camera.invertY', true);
    settings.set('camera.sensitivity', 2.5);
    settings.set('audio.master', 0.3);
    pressReset('camera');
    expect(ui.top?.id).toBe('confirm');
    expect(find('[data-testid="confirm"] h2').textContent).toBe('Reset Camera settings?');
    confirmButton('Reset').click();
    await tick();
    expect(settings.category('camera')).toEqual(defaultCategory('camera'));
    expect(settings.get('audio.master')).toBe(0.3);
    expect(control('camera.invertY').getAttribute('aria-checked')).toBe('false');
    expect(control('camera.sensitivity').getAttribute('aria-valuetext')).toBe('×1.0');
    expect(ui.top?.id).toBe(OPTIONS_SCREEN);
  });

  it('AC-5: cancelling the reset changes nothing', async () => {
    openOptionsMenu(ui, settings, { category: 'camera' });
    settings.set('camera.invertY', true);
    pressReset('camera');
    confirmButton('Cancel').click();
    await tick();
    expect(settings.get('camera.invertY')).toBe(true);
  });

  it('is operable from the keyboard: tabs switch with tabNext, Back closes', () => {
    const menu = openOptionsMenu(ui, settings);
    ui.intent('tabNext', 'gamepad');
    expect(menu.tabs.selected).toBe('camera');
    const back = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Back');
    back?.click();
    expect(ui.top).toBeUndefined();
  });
});

describe('formatting', () => {
  it('reads slider values in their unit and key codes as keys', () => {
    expect(formatSlider({ unit: 'percent' }, 0.8)).toBe('80%');
    expect(formatSlider({ unit: 'times' }, 1.25)).toBe('×1.3');
    expect(formatSlider({ unit: 'degrees' }, 72.4)).toBe('72°');
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Space')).toBe('Space');
  });
});
