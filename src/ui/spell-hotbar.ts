// The spell hotbar HUD (mw-e06.16): the caster's eight spell slots in a row above the quick slots,
// bottom centre. Each shows a placeholder icon (the spell's initial; final art is mw-e37.31), the key
// that selects it, the mana it costs, and its state:
//
// - empty         nothing assigned (a faint outline)
// - ready         can be cast now
// - cooldown      recharging: a sweep over the icon and the seconds left, in tenths ("1.4")
// - unaffordable  not enough mana (and the spell may not be over-cast): dimmed, cost in red
//
// The selected slot has a brass rim; a slot whose spell is being channelled pulses. Like every HUD
// widget it reads no sim state: the game derives the models (src/game/magic/hotbar.ts) and the
// widget rewrites the DOM only when a shown value changes.

import { clampHudScale } from './combat-hud';
import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** What one hotbar slot shows. */
export interface SpellSlotModel {
  /** The spell's display name; empty for an empty slot. */
  readonly name: string;
  /** Mana a cast costs. */
  readonly cost: number;
  /** Seconds of cooldown left (0 when ready). */
  readonly cooldown: number;
  /** The spell's whole cooldown, seconds (for the sweep). */
  readonly cooldownTotal: number;
  /** Whether the caster has the mana (or may over-cast). */
  readonly affordable: boolean;
  readonly selected: boolean;
  /** The caster is channelling this spell now. */
  readonly channelling: boolean;
}

/** An empty slot. */
export const EMPTY_SPELL_SLOT: SpellSlotModel = Object.freeze({
  name: '',
  cost: 0,
  cooldown: 0,
  cooldownTotal: 0,
  affordable: true,
  selected: false,
  channelling: false,
});

export type SpellSlotState = 'empty' | 'ready' | 'cooldown' | 'unaffordable';

/** A slot's state; a cooldown outranks a lack of mana. */
export function spellSlotState(model: SpellSlotModel): SpellSlotState {
  if (model.name === '') return 'empty';
  if (model.cooldown > 0) return 'cooldown';
  return model.affordable ? 'ready' : 'unaffordable';
}

/** Cooldown seconds as shown: tenths, rounded up so a running cooldown never reads "0.0". */
export function cooldownText(seconds: number): string {
  return seconds > 0 ? (Math.ceil(seconds * 10 - 1e-9) / 10).toFixed(1) : '';
}

/** The slot's accessible name: "Spell 2: Ember, 6 mana, ready" / "…: empty". */
export function spellSlotLabel(index: number, model: SpellSlotModel): string {
  const slot = `Spell ${String(index + 1)}`;
  const state = spellSlotState(model);
  if (state === 'empty') return `${slot}: empty`;
  const detail: Record<Exclude<SpellSlotState, 'empty'>, string> = {
    ready: 'ready',
    cooldown: `recharging, ${cooldownText(model.cooldown)} seconds`,
    unaffordable: 'not enough mana',
  };
  return `${slot}: ${model.name}, ${String(model.cost)} mana, ${detail[state]}${model.selected ? ', selected' : ''}`;
}

/** Slot sizes at 100 % HUD scale, CSS pixels. */
export const SPELL_HOTBAR_BASE = Object.freeze({
  /** Gap from the viewport's bottom edge: clears the quick-slot strip (24 + 52 + 12). */
  margin: 88,
  size: 44,
  gap: 8,
  font: 12,
});

export interface SpellHotbarLayout {
  readonly scale: number;
  readonly margin: number;
  readonly size: number;
  readonly gap: number;
  readonly font: number;
}

const px = (n: number): number => Math.round(n * 100) / 100;

/** The bar's dimensions at `scale` (clamped to 0.75–2). */
export function spellHotbarLayout(scale: number): SpellHotbarLayout {
  const s = clampHudScale(scale);
  return {
    scale: s,
    margin: px(SPELL_HOTBAR_BASE.margin * s),
    size: px(SPELL_HOTBAR_BASE.size * s),
    gap: px(SPELL_HOTBAR_BASE.gap * s),
    font: px(SPELL_HOTBAR_BASE.font * s),
  };
}

interface SlotParts {
  readonly element: HTMLElement;
  readonly icon: HTMLElement;
  readonly cost: HTMLElement;
  readonly timer: HTMLElement;
  readonly cache: WriteCache;
}

export interface SpellHotbarOptions {
  /** Slots shown (default 8). */
  readonly slots?: number;
  /** HUD scale, 0.75–2 (default 1). */
  readonly scale?: number;
  /** The key label of each slot, shown on it (default "1"…). */
  readonly keys?: readonly string[];
}

/** The spell hotbar; put its element in `ui.hud`. */
export class SpellHotbar implements HudWidget<readonly SpellSlotModel[]> {
  readonly element: HTMLElement;
  readonly #slots: SlotParts[];
  readonly #cache = new WriteCache();
  #layout: SpellHotbarLayout;

  constructor(options: SpellHotbarOptions = {}) {
    this.#slots = Array.from({ length: options.slots ?? 8 }, (_, i) => {
      const icon = h('span', { className: 'vb-spell-slot-icon', attrs: { 'aria-hidden': 'true' } });
      const key = h('span', {
        className: 'vb-spell-slot-key',
        text: options.keys?.[i] ?? String(i + 1),
        attrs: { 'aria-hidden': 'true' },
      });
      const cost = h('span', { className: 'vb-spell-slot-cost', attrs: { 'aria-hidden': 'true' } });
      const timer = h('span', {
        className: 'vb-spell-slot-timer',
        attrs: { 'aria-hidden': 'true' },
      });
      const element = h(
        'span',
        { className: 'vb-spell-slot', attrs: { role: 'img' }, data: { slot: String(i) } },
        icon,
        timer,
        key,
        cost,
      );
      return { element, icon, cost, timer, cache: new WriteCache() };
    });
    this.element = h(
      'div',
      {
        className: 'vb-spell-hotbar',
        attrs: { role: 'group', 'aria-label': 'Spell hotbar' },
        data: { testid: 'spell-hotbar', uiComponent: 'spell-hotbar' },
      },
      ...this.#slots.map((slot) => slot.element),
    );
    this.#layout = spellHotbarLayout(options.scale ?? 1);
    this.#applyLayout();
  }

  /** The current dimensions. */
  get layout(): SpellHotbarLayout {
    return this.#layout;
  }

  /** Applies a new HUD scale (clamped to 0.75–2) at once. */
  setScale(scale: number): void {
    this.#layout = spellHotbarLayout(scale);
    this.#applyLayout();
  }

  update(model: readonly SpellSlotModel[]): void {
    this.#slots.forEach((slot, i) => {
      const shown = model[i] ?? EMPTY_SPELL_SLOT;
      const state = spellSlotState(shown);
      const c = slot.cache;
      c.set('label', spellSlotLabel(i, shown), (v) => {
        slot.element.setAttribute('aria-label', v);
      });
      c.set('state', state, (v) => (slot.element.dataset['state'] = v));
      c.set('selected', String(shown.selected), (v) => (slot.element.dataset['selected'] = v));
      c.set('channel', String(shown.channelling), (v) => {
        slot.element.dataset['channelling'] = v;
      });
      c.set('spell', shown.name, (v) => {
        slot.element.dataset['spell'] = v;
        slot.icon.textContent = v.slice(0, 1).toUpperCase();
      });
      c.set('cost', state === 'empty' ? '' : String(shown.cost), (v) => {
        slot.cost.textContent = v;
      });
      c.set('timer', cooldownText(shown.cooldown), (v) => {
        slot.timer.textContent = v;
      });
      const sweep =
        shown.cooldown > 0 && shown.cooldownTotal > 0 ? shown.cooldown / shown.cooldownTotal : 0;
      c.set('sweep', String(Math.round(Math.min(1, sweep) * 100)), (v) => {
        slot.element.style.setProperty('--sweep', `${v}%`);
      });
    });
  }

  #applyLayout(): void {
    const { margin, size, gap, font } = this.#layout;
    this.#cache.set('layout', `${String(margin)} ${String(size)} ${String(gap)}`, () => {
      this.element.style.bottom = `${String(margin)}px`;
      this.element.style.gap = `${String(gap)}px`;
      this.element.style.fontSize = `${String(font)}px`;
      for (const slot of this.#slots) {
        slot.element.style.width = `${String(size)}px`;
        slot.element.style.height = `${String(size)}px`;
      }
    });
    this.element.dataset['scale'] = String(this.#layout.scale);
  }
}
