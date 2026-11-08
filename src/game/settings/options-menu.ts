// The options menu shell (mw-e31.1): one tab per settings category, each control generated from the
// schema's metadata (label, help text, range or choices) with the UI kit's generic toggle, slider and
// select, and the Key bindings panel under Controls (mw-e31.2). Changes apply immediately
// through the store; "Reset to defaults" asks first and resets only the category it sits in. Every
// control is keyboard and gamepad reachable through the kit's focus navigation (docs/design/ui.md).

import { h } from '@ui/components/dom';
import {
  button,
  confirmDialog,
  select,
  slider,
  tabs,
  toggle,
  type Screen,
  type Tabs,
  type UiRoot,
} from '@ui/index';
import { BindingsEditor } from './bindings-editor';
import { bindingsPanel } from './bindings-panel';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_SCHEMA,
  settingDefs,
  type KeybindSetting,
  type SettingDef,
  type SettingKey,
  type SettingsCategory,
  type SliderSetting,
} from './schema';
import type { SettingsStore } from './store';

export const OPTIONS_SCREEN = 'options';

export interface OptionsMenuOptions {
  /** The tab shown first (default: the first category). */
  readonly category?: SettingsCategory;
  /** Pause the sim while open (default true). */
  readonly pausesSim?: boolean;
  /** The bindings the Key bindings panel edits (default: the settings store's own). */
  readonly bindings?: BindingsEditor;
}

export interface OptionsMenu {
  readonly screen: Screen;
  readonly tabs: Tabs;
}

/** How a slider value reads out, per the schema's unit. */
export function formatSlider(def: Pick<SliderSetting, 'unit'>, value: number): string {
  switch (def.unit) {
    case 'percent':
      return `${String(Math.round(value * 100))}%`;
    case 'times':
      return `×${value.toFixed(1)}`;
    case 'degrees':
      return `${String(Math.round(value))}°`;
  }
}

/** `KeyE` → `E`, `Digit1` → `1`; other codes as they are. */
export function keyLabel(code: string): string {
  return code.replace(/^(Key|Digit)/, '');
}

interface Control {
  readonly element: HTMLElement;
  value: unknown;
}

/** Builds the generic control for one setting, wired to the store both ways. */
function control(
  settings: SettingsStore,
  key: SettingKey,
  def: Exclude<SettingDef, KeybindSetting>,
): Control {
  const set = (value: unknown): void => {
    settings.set(key, value as never);
  };
  const value: unknown = settings.get(key);
  switch (def.kind) {
    case 'toggle': {
      const item = toggle({ label: def.label, checked: value as boolean, onChange: set });
      return {
        element: item.element,
        get value() {
          return item.checked;
        },
        set value(next: unknown) {
          item.checked = next as boolean;
        },
      };
    }
    case 'slider':
      return slider({
        label: def.label,
        min: def.min,
        max: def.max,
        step: def.step,
        value: value as number,
        format: (v) => formatSlider(def, v),
        onChange: set,
      });
    case 'select':
      return select({
        label: def.label,
        options: def.options,
        value: value as string,
        onChange: set,
      });
  }
}

/** One labelled row: the control and its help text (linked as its accessible description). */
function row(
  settings: SettingsStore,
  key: SettingKey,
  def: Exclude<SettingDef, KeybindSetting>,
  track: (c: Control) => void,
) {
  const item = control(settings, key, def);
  track(item);
  item.element.dataset['setting'] = key;
  const helpId = `vb-setting-help-${key.replace('.', '-')}`;
  item.element.setAttribute('aria-describedby', helpId);
  return h(
    'div',
    { className: 'vb-stack', data: { settingRow: key } },
    item.element,
    h('p', { text: def.help, attrs: { id: helpId } }),
  );
}

/** Opens the options screen on `ui`, editing `settings`. */
export function openOptionsMenu(
  ui: UiRoot,
  settings: SettingsStore,
  options: OptionsMenuOptions = {},
): OptionsMenu {
  const controls = new Map<SettingKey, Control>();
  const panel = bindingsPanel(ui, options.bindings ?? new BindingsEditor(settings));
  const panels = SETTINGS_CATEGORIES.map((category) => {
    const { label } = SETTINGS_SCHEMA[category];
    const reset = button({
      label: 'Reset to defaults',
      variant: 'warning',
      onPress: () => {
        void confirmDialog(ui, {
          title: `Reset ${label} settings?`,
          body: `Every ${label.toLowerCase()} setting goes back to its default. Other categories keep their values.`,
          confirmLabel: 'Reset',
          destructive: true,
        }).then((confirmed) => {
          if (confirmed) settings.reset(category);
        });
      },
    });
    reset.dataset['reset'] = category;
    const content = h(
      'div',
      { className: 'vb-stack', data: { category } },
      // Keybind settings are edited in the Key bindings panel, not as generic controls.
      ...settingDefs(category).flatMap(({ key, def }) =>
        def.kind === 'keybind' ? [] : [row(settings, key, def, (c) => controls.set(key, c))],
      ),
      ...(category === 'controls' ? [panel.element] : []),
      h('div', { className: 'vb-row' }, reset),
    );
    return { id: category, label, panel: content };
  });
  const strip = tabs({
    label: 'Settings categories',
    tabs: panels,
    selected: options.category ?? 'controls',
  });
  // Keep every control showing the stored value (resets, or another view changing a setting).
  const unsubscribe = settings.onChange((key, value) => {
    const item = controls.get(key);
    if (item && item.value !== value) item.value = value;
  });
  const close = button({
    label: 'Back',
    onPress: () => {
      screen.close();
    },
  });
  const content = h(
    'div',
    { className: 'vb-panel vb-stack', data: { testid: 'options' } },
    h('h1', { text: 'Options' }),
    strip.element,
    h('div', { className: 'vb-row' }, close),
  );
  const screen = ui.push({
    id: OPTIONS_SCREEN,
    label: 'Options',
    content,
    pausesSim: options.pausesSim ?? true,
    onClose: () => {
      unsubscribe();
      panel.dispose();
    },
  });
  return { screen, tabs: strip };
}
