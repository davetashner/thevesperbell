// The component gallery (mw-e00.23): one screen showing every kit component, used by the e2e tests
// (focus traversal, focus ring contrast, axe scan, overflow at 2× text) and as the living reference
// for anyone building a screen. Served by testbed/ui.html (src/testbed/ui.ts).

import { button, select, slider, toggle } from './components/controls';
import { h } from './components/dom';
import { VirtualList } from './components/list';
import {
  attachTooltip,
  confirmDialog,
  glyphPrompt,
  ToastHost,
  UI_INTENT_GLYPHS,
} from './components/overlays';
import { tabs } from './components/tabs';
import { Meter, VitalsHud, type VitalsViewModel } from './hud';
import type { Screen, UiRoot } from './screens';

export const GALLERY_SCREEN = 'gallery';

export interface Gallery {
  readonly screen: Screen;
  readonly toasts: ToastHost;
  readonly vitals: VitalsHud;
  /** The demo HUD's view model; the Damage and Heal buttons change it. */
  readonly model: () => VitalsViewModel;
  /** Last value reported by each control (tests read it). */
  readonly values: Readonly<Record<string, unknown>>;
}

const ITEMS = Array.from({ length: 200 }, (_, i) => `Item ${String(i + 1)}`);
const SPELLS = Array.from({ length: 48 }, (_, i) => `Spell ${String(i + 1)}`);

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h('section', { className: 'vb-stack' }, h('h2', { text: title }), ...children);
}

/** Every bar kind, full and stacked as in the HUD, to check each reads without colour (mw-e31.8). */
function indicatorBars(): HTMLElement {
  const kinds = ['health', 'stamina', 'mana', 'breath', 'poise'] as const;
  const bars = kinds.map((kind) => {
    const meter = new Meter({ label: `${kind} bar`, kind });
    meter.update({ value: 80, max: 100 }, 0);
    return meter.element;
  });
  return h('div', { className: 'vb-stack', data: { testid: 'indicator-bars' } }, ...bars);
}

export interface GalleryOptions {
  readonly toasts?: ToastHost;
  readonly reducedMotion?: () => boolean;
}

/** Opens the gallery screen on `ui` (and puts its demo HUD and toasts in the HUD layer). */
export function openGallery(ui: UiRoot, options: GalleryOptions = {}): Gallery {
  const values: Record<string, unknown> = {};
  const ownToasts = options.toasts === undefined;
  const toasts = options.toasts ?? new ToastHost();
  const vitals = new VitalsHud({
    slots: 4,
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
  });
  let model: VitalsViewModel = {
    health: { value: 100, max: 100 },
    stamina: { value: 80, max: 100 },
    slots: [
      { label: 'Healing draught', glyph: '♥', count: 3 },
      { label: 'Fire bolt', glyph: '✦', cooldown: 0.4 },
      { label: 'Lockpick', glyph: '⚿', count: 12 },
      { label: '', glyph: '' },
    ],
  };
  const setHealth = (value: number): void => {
    model = { ...model, health: { ...model.health, value: Math.max(0, Math.min(100, value)) } };
    values['health'] = model.health.value;
  };

  const withTip = button({
    label: 'Hover or focus me',
    onPress: () => {
      values['tooltipButton'] = true;
    },
  });
  const tipHolder = h('div', { className: 'vb-tip-holder' }, withTip);
  tipHolder.style.position = 'relative';
  attachTooltip(withTip, 'Tooltips appear on focus and hover.');

  const opener = button({
    label: 'Open confirm dialog',
    onPress: () => {
      void confirmDialog(ui, {
        title: 'Burn the letter?',
        body: 'The letter will be lost for good.',
        confirmLabel: 'Burn it',
        destructive: true,
      }).then((answer) => {
        values['confirm'] = answer;
      });
    },
  });

  const list = new VirtualList({
    label: 'Inventory items',
    items: ITEMS,
    text: (item) => item,
    onSelect: (item) => {
      values['list'] = item;
    },
  });
  const grid = new VirtualList({
    label: 'Spell grid',
    items: SPELLS,
    columns: 4,
    visibleRows: 3,
    text: (item) => item,
    onSelect: (item) => {
      values['grid'] = item;
    },
  });

  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-gallery', data: { testid: 'gallery' } },
    h('h1', { text: 'Component gallery' }),
    h(
      'div',
      { className: 'vb-gallery-columns' },
      h(
        'div',
        { className: 'vb-stack' },
        section(
          'Buttons',
          h(
            'div',
            { className: 'vb-row' },
            button({
              label: 'Primary',
              autofocus: true,
              onPress: () => {
                values['primary'] = ((values['primary'] as number | undefined) ?? 0) + 1;
              },
            }),
            button({
              label: 'Show toast',
              onPress: () => {
                toasts.show('A toast appears, then fades.');
              },
            }),
            opener,
          ),
        ),
        section(
          'Settings controls',
          toggle({
            label: 'Subtitles',
            checked: true,
            onChange: (on) => {
              values['toggle'] = on;
            },
          }).element,
          slider({
            label: 'Volume',
            min: 0,
            max: 100,
            step: 10,
            value: 50,
            format: (v) => `${String(v)}%`,
            onChange: (v) => {
              values['slider'] = v;
            },
          }).element,
          select({
            label: 'Difficulty',
            value: 'normal',
            options: [
              { value: 'story', label: 'Story' },
              { value: 'normal', label: 'Normal' },
              { value: 'hard', label: 'Hard' },
            ],
            onChange: (v) => {
              values['select'] = v;
            },
          }).element,
        ),
        section(
          'Tabs',
          tabs({
            label: 'Journal sections',
            tabs: [
              { id: 'quests', label: 'Quests', panel: h('p', { text: 'Find the Vesper Bell.' }) },
              {
                id: 'rumours',
                label: 'Rumours',
                panel: h('p', { text: 'The bell rings at dusk.' }),
              },
              { id: 'notes', label: 'Notes', panel: h('p', { text: 'Ask the bookseller.' }) },
            ],
            onChange: (id) => {
              values['tabs'] = id;
            },
          }).element,
        ),
        section('Tooltip', tipHolder),
        section('Indicators', indicatorBars()),
        section(
          'HUD pieces',
          h(
            'div',
            { className: 'vb-row' },
            button({
              label: 'Damage',
              onPress: () => {
                setHealth(model.health.value - 25);
              },
            }),
            button({
              label: 'Heal',
              onPress: () => {
                setHealth(model.health.value + 25);
              },
            }),
          ),
          h(
            'div',
            { className: 'vb-row' },
            glyphPrompt(UI_INTENT_GLYPHS.keyboard.confirm, 'Select').element,
            glyphPrompt(UI_INTENT_GLYPHS.keyboard.back, 'Back').element,
            glyphPrompt(UI_INTENT_GLYPHS.gamepad.confirm, 'Select').element,
            glyphPrompt(UI_INTENT_GLYPHS.gamepad.back, 'Back').element,
          ),
        ),
      ),
      h(
        'div',
        { className: 'vb-stack' },
        section('Virtualised list', list.element),
        section('Virtualised grid', grid.element),
      ),
    ),
  );

  vitals.element.style.position = 'absolute';
  vitals.element.style.left = '1rem';
  vitals.element.style.bottom = '1rem';
  ui.hud.append(vitals.element);
  if (ownToasts) ui.hud.append(toasts.element);
  const screen = ui.push({
    id: GALLERY_SCREEN,
    label: 'Component gallery',
    content,
    onClose: () => {
      vitals.element.remove();
      if (ownToasts) toasts.element.remove();
    },
    // The gallery is the root screen of its page: back does not close it.
    onBack: () => true,
  });
  return { screen, toasts, vitals, model: () => model, values };
}
