// HUD widgets and view-model binding (mw-e00.23). HUD widgets never read sim state: after each tick
// the game glue derives an immutable view model from the sim snapshot (a pure `select` function) and
// hands it to `HudBinding.frame()` once per rendered frame. Every widget remembers what it last wrote
// and touches the DOM only when a value it shows actually changed, so an idle HUD costs zero DOM
// writes (AC-5). Commands never flow back through here: player intent reaches the sim only as action
// frames.
//
// The meter's delayed-damage segment: when the value drops, a trail stays at the old value for
// `trailHoldMs`, then drains towards the new value at `trailDrainPerSec` (fraction of max per second),
// or over a fixed `trailDrainMs` whatever its size (the combat HUD's chip, mw-e04.10). Under reduced
// motion it snaps. A meter can also flash (`flash(nowMs)` sets `data-flash` for `flashMs`) and mark
// itself low (`data-low` while the value is below `lowBelow` of max). Every timer runs on the `nowMs`
// the caller passes, never on wall time, so tests drive it frame by frame.

import { h } from './components/dom';

/** A value out of a maximum (health 72 / 100). */
export interface MeterModel {
  readonly value: number;
  readonly max: number;
}

/** One quick slot: an item or spell, its count and its cooldown (0 ready … 1 just used). */
export interface SlotModel {
  /** Accessible name, e.g. "Healing draught". Empty = an empty slot. */
  readonly label: string;
  /** Short glyph shown until icon art exists (mw-e37). */
  readonly glyph: string;
  readonly count?: number;
  readonly cooldown?: number;
}

/** What the vitals HUD shows. Derived from a sim snapshot by the owning feature (mw-e04.10). */
export interface VitalsViewModel {
  readonly health: MeterModel;
  readonly stamina: MeterModel;
  readonly slots: readonly SlotModel[];
}

/** A HUD widget: shows a view model; `nowMs` drives its animations. */
export interface HudWidget<TModel> {
  readonly element: HTMLElement;
  update(model: TModel, nowMs: number): void;
}

/** Runs a DOM write only when its value differs from the last one written under the same key. */
export class WriteCache {
  readonly #last = new Map<string, string>();

  /** Calls `write(value)` unless `value` is what `key` last wrote; returns whether it wrote. */
  set(key: string, value: string, write: (value: string) => void): boolean {
    if (this.#last.get(key) === value) return false;
    this.#last.set(key, value);
    write(value);
    return true;
  }
}

export interface MeterOptions {
  /** Accessible name, e.g. "Health". */
  readonly label: string;
  /** Colour set: `health` (ember), `stamina` (leaf), `breath` or `mana` (sky). */
  readonly kind?: 'health' | 'stamina' | 'breath' | 'mana';
  readonly trailHoldMs?: number;
  readonly trailDrainPerSec?: number;
  /** Drain the whole trail in this many ms after the hold, whatever its size (overrides the rate). */
  readonly trailDrainMs?: number;
  /** How long `flash()` keeps the flash state (default 300 ms). */
  readonly flashMs?: number;
  /** Fraction of max below which the meter is marked low (`data-low`); omitted = never. */
  readonly lowBelow?: number;
  /** Whether motion is reduced right now (see comfort.ts reducedMotion). */
  readonly reducedMotion?: () => boolean;
}

const fraction = (value: number, max: number): number =>
  max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

/** Rounds a scale factor so sub-pixel jitter never causes a write. */
const scaleText = (f: number): string => `scaleX(${f.toFixed(4)})`;

/** A bar with a delayed-damage trail (health, stamina, mana). */
export class Meter implements HudWidget<MeterModel> {
  readonly element: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #trail: HTMLElement;
  readonly #cache = new WriteCache();
  readonly #holdMs: number;
  readonly #drain: number;
  readonly #drainMs: number | undefined;
  readonly #flashMs: number;
  readonly #lowBelow: number;
  readonly #reduced: () => boolean;
  #shown: number | undefined;
  #trailFrac = 0;
  #drainFrom = 0;
  #lastMs: number | undefined;
  #holdUntil = 0;
  #flashUntil = -Infinity;
  #flashing = false;
  #low = false;

  constructor(options: MeterOptions) {
    this.#holdMs = options.trailHoldMs ?? 500;
    this.#drain = options.trailDrainPerSec ?? 0.6;
    this.#drainMs = options.trailDrainMs;
    this.#flashMs = options.flashMs ?? 300;
    this.#lowBelow = options.lowBelow ?? 0;
    this.#reduced = options.reducedMotion ?? (() => false);
    this.#trail = h('span', { className: 'vb-meter-trail' });
    this.#fill = h('span', { className: 'vb-meter-fill' });
    this.element = h(
      'div',
      {
        className: 'vb-meter',
        attrs: {
          role: 'meter',
          'aria-label': options.label,
          'aria-valuemin': '0',
        },
        data: { kind: options.kind ?? 'health', uiComponent: 'meter' },
      },
      this.#trail,
      this.#fill,
    );
  }

  /** The trail's current fraction of max (tests read it). */
  get trail(): number {
    return this.#trailFrac;
  }

  /** The delayed-damage segment's width as a fraction of max: trail minus fill (tests read it). */
  get chip(): number {
    return Math.max(0, this.#trailFrac - (this.#shown ?? 0));
  }

  /** Whether the flash state is on as of the last update. */
  get flashing(): boolean {
    return this.#flashing;
  }

  /** Whether the meter is marked low as of the last update. */
  get low(): boolean {
    return this.#low;
  }

  /** Starts (or restarts) the flash at `nowMs`; it shows from the next `update`. */
  flash(nowMs: number): void {
    this.#flashUntil = nowMs + this.#flashMs;
  }

  update(model: MeterModel, nowMs: number): void {
    const f = fraction(model.value, model.max);
    // Drain time since the last frame, counting only what lies past the hold.
    const since = Math.max(this.#lastMs ?? nowMs, this.#holdUntil);
    const dt = Math.max(0, nowMs - since);
    this.#lastMs = nowMs;
    if (this.#shown === undefined || this.#reduced()) {
      this.#trailFrac = f;
    } else if (f < this.#shown) {
      // A drop: the trail holds where the bar was (or higher, if still draining) before draining.
      this.#trailFrac = Math.max(this.#trailFrac, this.#shown);
      this.#drainFrom = this.#trailFrac;
      this.#holdUntil = nowMs + this.#holdMs;
    } else if (f > this.#trailFrac) {
      this.#trailFrac = f; // healing: no trail
    } else if (nowMs >= this.#holdUntil && this.#trailFrac > f) {
      if (this.#drainMs === undefined) {
        this.#trailFrac = Math.max(f, this.#trailFrac - (this.#drain * dt) / 1000);
      } else {
        const t = this.#drainMs > 0 ? (nowMs - this.#holdUntil) / this.#drainMs : 1;
        this.#trailFrac = t >= 1 ? f : Math.max(f, this.#drainFrom + (f - this.#drainFrom) * t);
      }
    }
    this.#shown = f;
    this.#flashing = nowMs < this.#flashUntil;
    this.#low = f < this.#lowBelow;
    const c = this.#cache;
    c.set('flash', String(this.#flashing), (v) => {
      this.element.toggleAttribute('data-flash', v === 'true');
    });
    c.set('low', String(this.#low), (v) => {
      this.element.toggleAttribute('data-low', v === 'true');
    });
    c.set('value', String(model.value), (v) => (this.element.dataset['value'] = v));
    c.set('fill', scaleText(f), (v) => (this.#fill.style.transform = v));
    c.set('trail', scaleText(this.#trailFrac), (v) => (this.#trail.style.transform = v));
    c.set('max', String(model.max), (v) => {
      this.element.setAttribute('aria-valuemax', v);
    });
    c.set('now', String(Math.round(model.value)), (v) => {
      this.element.setAttribute('aria-valuenow', v);
    });
  }
}

export interface IconSlotOptions {
  /** Keyboard/gamepad hint for the slot ("1", "D-pad Up"), announced with it. */
  readonly key?: string;
}

/** A quick slot: glyph, count and a cooldown wipe. */
export class IconSlot implements HudWidget<SlotModel> {
  readonly element: HTMLElement;
  readonly #glyph: HTMLElement;
  readonly #count: HTMLElement;
  readonly #cooldown: HTMLElement;
  readonly #cache = new WriteCache();
  readonly #key: string | undefined;

  constructor(options: IconSlotOptions = {}) {
    this.#key = options.key;
    this.#glyph = h('span', { attrs: { 'aria-hidden': 'true' } });
    this.#count = h('span', { className: 'vb-slot-count', attrs: { 'aria-hidden': 'true' } });
    this.#cooldown = h('span', { className: 'vb-slot-cooldown' });
    this.element = h(
      'span',
      { className: 'vb-slot', attrs: { role: 'img' }, data: { uiComponent: 'slot' } },
      this.#glyph,
      this.#cooldown,
      this.#count,
    );
  }

  update(model: SlotModel): void {
    const cooldown = Math.min(1, Math.max(0, model.cooldown ?? 0));
    const count = model.count === undefined ? '' : String(model.count);
    const parts = [model.label === '' ? 'Empty slot' : model.label];
    if (count !== '') parts.push(`× ${count}`);
    if (cooldown > 0) parts.push('cooling down');
    if (this.#key !== undefined) parts.push(`(${this.#key})`);
    const c = this.#cache;
    c.set('label', parts.join(' '), (v) => {
      this.element.setAttribute('aria-label', v);
    });
    c.set('glyph', model.glyph, (v) => (this.#glyph.textContent = v));
    c.set('count', count, (v) => (this.#count.textContent = v));
    c.set(
      'cooldown',
      `scaleY(${cooldown.toFixed(3)})`,
      (v) => (this.#cooldown.style.transform = v),
    );
  }
}

/** Health and stamina bars plus quick slots: the vitals HUD. */
export class VitalsHud implements HudWidget<VitalsViewModel> {
  readonly element: HTMLElement;
  readonly health: Meter;
  readonly stamina: Meter;
  readonly slots: readonly IconSlot[];

  constructor(options: { slots: number; reducedMotion?: () => boolean }) {
    const reduced = options.reducedMotion ? { reducedMotion: options.reducedMotion } : {};
    this.health = new Meter({ label: 'Health', kind: 'health', ...reduced });
    this.stamina = new Meter({ label: 'Stamina', kind: 'stamina', ...reduced });
    this.slots = Array.from(
      { length: options.slots },
      (_, i) => new IconSlot({ key: String(i + 1) }),
    );
    this.element = h(
      'div',
      { className: 'vb-vitals', data: { testid: 'vitals-hud' } },
      h('div', { className: 'vb-stack' }, this.health.element, this.stamina.element),
      h('div', { className: 'vb-row' }, ...this.slots.map((slot) => slot.element)),
    );
  }

  update(model: VitalsViewModel, nowMs: number): void {
    this.health.update(model.health, nowMs);
    this.stamina.update(model.stamina, nowMs);
    this.slots.forEach((slot, i) => {
      slot.update(model.slots[i] ?? EMPTY_SLOT);
    });
  }
}

export const EMPTY_SLOT: SlotModel = Object.freeze({ label: '', glyph: '' });

/**
 * Binds HUD widgets to a sim snapshot source. `select` derives the view model (pure: same snapshot,
 * equal model); the binding re-derives only when the snapshot object changes, then lets each widget
 * dirty-check its own DOM. Call `frame()` from the render callback.
 */
export class HudBinding<TSnapshot, TModel> {
  readonly #select: (snapshot: TSnapshot) => TModel;
  readonly #widgets: readonly HudWidget<TModel>[];
  #snapshot: TSnapshot | undefined;
  #model: TModel | undefined;

  constructor(select: (snapshot: TSnapshot) => TModel, widgets: readonly HudWidget<TModel>[]) {
    this.#select = select;
    this.#widgets = widgets;
  }

  /** The latest view model (undefined before the first frame). */
  get model(): TModel | undefined {
    return this.#model;
  }

  frame(snapshot: TSnapshot, nowMs: number): void {
    if (this.#model === undefined || snapshot !== this.#snapshot) {
      this.#snapshot = snapshot;
      this.#model = this.#select(snapshot);
    }
    for (const widget of this.#widgets) widget.update(this.#model, nowMs);
  }
}
