// The target readout and damage numbers (mw-e04.21). Like every HUD widget they read no sim state:
// the game hands in view models and spawns numbers, and only changed values touch the DOM.
//
// - TargetBar: the fighter you are locked onto (or last hit) — its name and a health bar with the
//   combat HUD's delayed chip — docked top-centre. Hidden when there is no target.
// - BossBar: the same for a boss, docked at the bottom. Poise shows on the target bar after the first poise
//   damage and flashes when it breaks; "No effect" shows as text for an immune hit.
// - HitMarkers: a brief shape per hit variant (normal, weak point, headshot, deflected).
// - DamageNumbers: a small pool of figures that rise and fade where a hit landed: what you dealt
//   (on the target) and what you took (by your own bars). "No effect" shows for an immune hit.
//   Every timer runs on the `nowMs` the caller passes.

import { h } from './components/dom';
import { Meter, WriteCache, type HudWidget, type MeterModel } from './hud';

/** How long a number takes to rise and fade. */
export const DAMAGE_NUMBER_MS = 900;
/** How far a number rises, CSS pixels. */
export const DAMAGE_NUMBER_RISE = 36;
/** At most this many numbers show at once; a new one replaces the oldest. */
export const MAX_DAMAGE_NUMBERS = 12;

/** The target bar's model: null hides it. */
export interface TargetModel {
  readonly name: string;
  readonly health: MeterModel;
  /** The poise bar; absent until the target has taken poise damage (then it stays). */
  readonly poise?: MeterModel;
  /** The poise just broke: the poise bar flashes and the note says so. */
  readonly poiseBroken?: boolean;
  /** An immune hit just landed: the note says "No effect" (and the bar shows no chip). */
  readonly noEffect?: boolean;
}

/** The note under the bar, "No effect" before "Poise broken"; '' for none. Text, not colour alone. */
export function targetNote(model: TargetModel): string {
  if (model.noEffect === true) return 'No effect';
  return model.poiseBroken === true ? 'Poise broken' : '';
}

/** The locked target's name, health, poise and what the last hit did. */
export class TargetBar implements HudWidget<TargetModel | null> {
  readonly element: HTMLElement;
  readonly health: Meter;
  readonly poise: Meter;
  readonly #name: HTMLElement;
  readonly #note: HTMLElement;
  readonly #cache = new WriteCache();
  #broken = false;

  constructor(options: { readonly reducedMotion?: () => boolean } = {}) {
    const reduced = options.reducedMotion ? { reducedMotion: options.reducedMotion } : {};
    this.health = new Meter({
      label: 'Target health',
      kind: 'health',
      trailHoldMs: 500,
      trailDrainMs: 400,
      ...reduced,
    });
    this.poise = new Meter({
      label: 'Target poise',
      kind: 'poise',
      flashMs: 600,
      trailHoldMs: 0,
      ...reduced,
    });
    this.poise.element.hidden = true;
    this.#name = h('div', { className: 'vb-target-name' });
    this.#note = h('div', {
      className: 'vb-target-note',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    this.element = h(
      'div',
      {
        className: 'vb-target-bar',
        attrs: { hidden: '' },
        data: { testid: 'target-bar', uiComponent: 'target-bar' },
      },
      this.#name,
      this.health.element,
      this.poise.element,
      this.#note,
    );
  }

  update(model: TargetModel | null, nowMs: number): void {
    const shown = model !== null;
    this.#cache.set('shown', String(shown), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) {
      this.#broken = false;
      return;
    }
    this.#cache.set('name', model.name, (v) => (this.#name.textContent = v));
    this.health.update(model.health, nowMs);
    const hasPoise = model.poise !== undefined;
    this.#cache.set('poise', String(hasPoise), (v) => {
      this.poise.element.hidden = v === 'false';
    });
    const broken = model.poiseBroken === true;
    if (broken && !this.#broken) this.poise.flash(nowMs);
    this.#broken = broken;
    if (model.poise !== undefined) this.poise.update(model.poise, nowMs);
    this.#cache.set('note', targetNote(model), (v) => (this.#note.textContent = v));
  }
}

/** A creature flagged boss, docked at the bottom of the screen: its name and health. */
export class BossBar implements HudWidget<TargetModel | null> {
  readonly element: HTMLElement;
  readonly health: Meter;
  readonly #name: HTMLElement;
  readonly #cache = new WriteCache();

  constructor(options: { readonly reducedMotion?: () => boolean } = {}) {
    this.health = new Meter({
      label: 'Boss health',
      kind: 'health',
      trailHoldMs: 500,
      trailDrainMs: 600,
      ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
    });
    this.#name = h('div', { className: 'vb-boss-name' });
    this.element = h(
      'div',
      {
        className: 'vb-boss-bar',
        attrs: { hidden: '' },
        data: { testid: 'boss-bar', uiComponent: 'boss-bar' },
      },
      this.#name,
      this.health.element,
    );
  }

  update(model: TargetModel | null, nowMs: number): void {
    this.#cache.set('shown', String(model !== null), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) return;
    this.#cache.set('name', model.name, (v) => (this.#name.textContent = v));
    this.health.update(model.health, nowMs);
  }
}

/** What a landed hit struck. Archery (e05) reuses these. */
export type HitVariant = 'normal' | 'weakpoint' | 'headshot' | 'deflected';

/** How long a hit marker shows. */
export const HIT_MARKER_MS = 250;
/** At most this many markers show at once; a new one replaces the oldest. */
export const MAX_HIT_MARKERS = 6;

/** Each variant has its own shape as well as colour. */
const MARKER_GLYPH: Readonly<Record<HitVariant, string>> = {
  normal: '\u00d7',
  weakpoint: '\u25c6',
  headshot: '\u2726',
  deflected: '\u25a0',
};

interface MarkerSlot {
  readonly el: HTMLElement;
  readonly cache: WriteCache;
  variant: HitVariant;
  x: number;
  y: number;
  since: number;
}

/** The hit markers: a brief shape where a hit landed. */
export class HitMarkers {
  readonly element: HTMLElement;
  readonly #slots: MarkerSlot[] = [];
  #live: HitVariant[] = [];

  constructor() {
    this.element = h('div', {
      className: 'vb-hit-markers',
      attrs: { 'aria-hidden': 'true' },
      data: { testid: 'hit-markers', uiComponent: 'hit-markers' },
    });
    for (let i = 0; i < MAX_HIT_MARKERS; i++) {
      const el = h('span', { className: 'vb-hit-marker', attrs: { hidden: '' } });
      this.element.append(el);
      this.#slots.push({
        el,
        cache: new WriteCache(),
        variant: 'normal',
        x: 0,
        y: 0,
        since: -Infinity,
      });
    }
  }

  /** The variants showing as of the last update, oldest first. */
  get variants(): readonly HitVariant[] {
    return this.#live;
  }

  spawn(variant: HitVariant, x: number, y: number, nowMs: number): void {
    const slot =
      this.#slots.find((s) => nowMs - s.since >= HIT_MARKER_MS) ??
      this.#slots.reduce((oldest, s) => (s.since < oldest.since ? s : oldest));
    Object.assign(slot, { variant, x: Math.round(x), y: Math.round(y), since: nowMs });
  }

  update(nowMs: number): void {
    const live: { variant: HitVariant; since: number }[] = [];
    for (const s of this.#slots) {
      const age = nowMs - s.since;
      const shown = age >= 0 && age < HIT_MARKER_MS;
      s.cache.set('shown', String(shown), (v) => {
        s.el.hidden = v === 'false';
      });
      if (!shown) continue;
      live.push({ variant: s.variant, since: s.since });
      s.cache.set('variant', s.variant, (v) => {
        s.el.dataset['variant'] = v;
        s.el.textContent = MARKER_GLYPH[s.variant];
      });
      s.cache.set('at', `translate(${String(s.x)}px, ${String(s.y)}px)`, (v) => {
        s.el.style.transform = v;
      });
    }
    this.#live = live.sort((a, b) => a.since - b.since).map((m) => m.variant);
  }
}

/** Whose damage a number shows. */
export type DamageNumberKind = 'dealt' | 'taken';

/** One live number (tests read them). */
export interface DamageNumber {
  readonly text: string;
  readonly kind: DamageNumberKind;
  /** 1 when it appeared, 0 when it is gone. */
  readonly opacity: number;
}

interface Slot {
  readonly el: HTMLElement;
  readonly cache: WriteCache;
  text: string;
  kind: DamageNumberKind;
  x: number;
  y: number;
  since: number;
}

/** The rising damage figures. */
export class DamageNumbers {
  readonly element: HTMLElement;
  readonly #slots: Slot[] = [];
  readonly #reduced: () => boolean;
  #live: DamageNumber[] = [];

  constructor(options: { readonly reducedMotion?: () => boolean } = {}) {
    this.#reduced = options.reducedMotion ?? (() => false);
    this.element = h('div', {
      className: 'vb-damage-numbers',
      attrs: { 'aria-hidden': 'true' },
      data: { testid: 'damage-numbers', uiComponent: 'damage-numbers' },
    });
    for (let i = 0; i < MAX_DAMAGE_NUMBERS; i++) {
      const el = h('span', { className: 'vb-damage-number', attrs: { hidden: '' } });
      this.element.append(el);
      this.#slots.push({
        el,
        cache: new WriteCache(),
        text: '',
        kind: 'dealt',
        x: 0,
        y: 0,
        since: -Infinity,
      });
    }
  }

  /** The numbers showing as of the last update, oldest first. */
  get numbers(): readonly DamageNumber[] {
    return this.#live;
  }

  /** Shows `text` at (`x`, `y`) CSS pixels in the HUD layer from `nowMs`. */
  spawn(text: string, kind: DamageNumberKind, x: number, y: number, nowMs: number): void {
    const slot =
      this.#slots.find((s) => nowMs - s.since >= DAMAGE_NUMBER_MS) ??
      this.#slots.reduce((oldest, s) => (s.since < oldest.since ? s : oldest));
    Object.assign(slot, { text, kind, x: Math.round(x), y: Math.round(y), since: nowMs });
  }

  update(nowMs: number): void {
    const live: { n: DamageNumber; since: number }[] = [];
    for (const s of this.#slots) {
      const age = nowMs - s.since;
      const shown = age >= 0 && age < DAMAGE_NUMBER_MS;
      s.cache.set('shown', String(shown), (v) => {
        s.el.hidden = v === 'false';
      });
      if (!shown) continue;
      const t = age / DAMAGE_NUMBER_MS;
      live.push({ n: { text: s.text, kind: s.kind, opacity: 1 - t }, since: s.since });
      s.cache.set('text', s.text, (v) => (s.el.textContent = v));
      s.cache.set('kind', s.kind, (v) => (s.el.dataset['kind'] = v));
      const rise = this.#reduced() ? 0 : Math.round(t * DAMAGE_NUMBER_RISE);
      s.cache.set('at', `translate(${String(s.x)}px, ${String(s.y - rise)}px)`, (v) => {
        s.el.style.transform = v;
      });
      s.cache.set('opacity', (1 - t).toFixed(2), (v) => (s.el.style.opacity = v));
    }
    this.#live = live.sort((a, b) => a.since - b.since).map(({ n }) => n);
  }
}
