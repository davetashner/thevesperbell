// The combat HUD (mw-e04.10): health and stamina bars top-right with the feedback
// a fight needs at a glance, and no numbers on screen.
//
// - Health shows a delayed "chip": lost health stays in a lighter colour for CHIP_HOLD_MS, then
//   drains over CHIP_DRAIN_MS (so any hit's chip is gone 1 s after it), and the bar pulses while
//   health is below LOW_HEALTH_FRACTION of max.
// - Stamina flashes for STAMINA_FLASH_MS when an action is refused for want of stamina.
// - A hit from off screen shows an arc on a ring around the screen centre, pointing towards where it
//   came from (0° ahead, clockwise, 180° behind), fading out over DAMAGE_ARC_MS.
// - Everything scales with the HUD scale setting (accessibility.hudScale); bar sizes are whole CSS
//   pixels written inline, so they never depend on the text size.
//
// Like every HUD widget it reads no sim state: the game derives the model (src/game/combat/
// combat-hud.ts) and reports events through `staminaRejected` and `damageFrom`. Every timer runs on
// the `nowMs` the caller passes, so tests drive it frame by frame without wall time.

import { h } from './components/dom';
import { Meter, WriteCache, type HudWidget, type MeterModel } from './hud';

/** How long the chip holds at the old health before draining. */
export const CHIP_HOLD_MS = 500;
/** How long the chip takes to drain once it starts. */
export const CHIP_DRAIN_MS = 500;
/** How long the stamina bar flashes after a refusal. */
export const STAMINA_FLASH_MS = 300;
/** How long a damage arc takes to fade out. */
export const DAMAGE_ARC_MS = 1500;
/** Health below this fraction of max pulses. */
export const LOW_HEALTH_FRACTION = 0.25;
/** At most this many damage arcs show at once; a new one replaces the oldest. */
export const MAX_DAMAGE_ARCS = 4;

/** HUD scale bounds (style bible §9: the UI scales 75–200 %). */
export const MIN_HUD_SCALE = 0.75;
export const MAX_HUD_SCALE = 2;

/** Bar sizes at 100 % HUD scale, CSS pixels (designed against a 1280×720 viewport and up). */
export const COMBAT_HUD_BASE = Object.freeze({
  /** Gap from the viewport's top and right edges. */
  margin: 24,
  /** Gap between the bars. */
  gap: 6,
  health: Object.freeze({ width: 240, height: 14 }),
  stamina: Object.freeze({ width: 180, height: 10 }),
  /** The mana bar, shown only for a caster (mw-e06.15); below the stamina bar. */
  mana: Object.freeze({ width: 140, height: 8 }),
  /** Diameter of the damage-direction ring. */
  ring: 240,
});

/** What the combat HUD shows each frame. */
export interface CombatHudModel {
  readonly health: MeterModel;
  readonly stamina: MeterModel;
  /** The caster's mana (mw-e06.15); absent or empty max hides the bar. */
  readonly mana?: MeterModel;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Every scaled dimension of the combat HUD, CSS pixels. */
export interface CombatHudLayout {
  readonly scale: number;
  readonly margin: number;
  readonly gap: number;
  readonly health: Size;
  readonly stamina: Size;
  readonly mana: Size;
  /** The bars' block: as wide as the widest bar, both bars and the gap tall. */
  readonly block: Size;
  readonly ring: number;
}

/** Clamps a HUD scale to 0.75–2; a non-finite value is the default 1. */
export function clampHudScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_HUD_SCALE, Math.max(MIN_HUD_SCALE, scale));
}

const px = (n: number): number => Math.round(n * 100) / 100;

/** The combat HUD's dimensions at `scale` (clamped). */
export function combatHudLayout(scale: number): CombatHudLayout {
  const s = clampHudScale(scale);
  const size = ({ width, height }: Size): Size => ({
    width: px(width * s),
    height: px(height * s),
  });
  const health = size(COMBAT_HUD_BASE.health);
  const stamina = size(COMBAT_HUD_BASE.stamina);
  const mana = size(COMBAT_HUD_BASE.mana);
  const gap = px(COMBAT_HUD_BASE.gap * s);
  return {
    scale: s,
    margin: px(COMBAT_HUD_BASE.margin * s),
    gap,
    health,
    stamina,
    mana,
    block: {
      width: Math.max(health.width, stamina.width),
      height: px(health.height + gap + stamina.height),
    },
    ring: px(COMBAT_HUD_BASE.ring * s),
  };
}

/** Where the bars' block sits in a `viewport`-sized HUD layer (top-right), CSS pixels. */
export function combatHudBounds(
  layout: CombatHudLayout,
  viewport: Size,
): { left: number; top: number; right: number; bottom: number } {
  const right = viewport.width - layout.margin;
  const top = layout.margin;
  return {
    left: right - layout.block.width,
    top,
    right,
    bottom: top + layout.block.height,
  };
}

/** One live damage arc (tests read them). */
export interface DamageArc {
  /** Where the hit came from: degrees clockwise from the camera's forward, 0–360. */
  readonly bearing: number;
  /** 1 when it appeared, 0 when it is gone. */
  readonly opacity: number;
}

const wrapDegrees = (deg: number): number => ((deg % 360) + 360) % 360;

/** The off-screen damage direction ring: up to MAX_DAMAGE_ARCS arcs, each fading on its own. */
export class DamageIndicator {
  readonly element: HTMLElement;
  readonly #arcs: { el: HTMLElement; cache: WriteCache; bearing: number; since: number }[] = [];
  readonly #cache = new WriteCache();
  #live: DamageArc[] = [];

  constructor() {
    this.element = h('div', {
      className: 'vb-damage-ring',
      attrs: { 'aria-hidden': 'true' },
      data: { testid: 'damage-indicator', uiComponent: 'damage-indicator' },
    });
    for (let i = 0; i < MAX_DAMAGE_ARCS; i++) {
      const el = h('span', { className: 'vb-damage-arc', attrs: { hidden: '' } });
      this.element.append(el);
      this.#arcs.push({ el, cache: new WriteCache(), bearing: 0, since: -Infinity });
    }
  }

  /** The arcs showing as of the last update, oldest first. */
  get arcs(): readonly DamageArc[] {
    return this.#live;
  }

  /** Shows an arc towards `bearing` (degrees clockwise from forward) from `nowMs`. */
  show(bearing: number, nowMs: number): void {
    const free =
      this.#arcs.find((arc) => nowMs - arc.since >= DAMAGE_ARC_MS) ??
      this.#arcs.reduce((oldest, arc) => (arc.since < oldest.since ? arc : oldest));
    free.bearing = wrapDegrees(bearing);
    free.since = nowMs;
  }

  /** Sets the ring's diameter (CSS pixels). */
  resize(diameter: number): void {
    const size = `${String(diameter)}px`;
    this.#cache.set('size', size, (v) => {
      this.element.style.width = v;
      this.element.style.height = v;
    });
  }

  update(nowMs: number): void {
    const live: { arc: DamageArc; since: number }[] = [];
    for (const arc of this.#arcs) {
      const age = nowMs - arc.since;
      const shown = age >= 0 && age < DAMAGE_ARC_MS;
      const opacity = shown ? 1 - age / DAMAGE_ARC_MS : 0;
      arc.cache.set('shown', String(shown), (v) => {
        arc.el.hidden = v === 'false';
      });
      if (!shown) continue;
      live.push({ arc: { bearing: arc.bearing, opacity }, since: arc.since });
      arc.cache.set('bearing', `rotate(${arc.bearing.toFixed(1)}deg)`, (v) => {
        arc.el.style.transform = v;
        arc.el.dataset['bearing'] = arc.bearing.toFixed(1);
      });
      arc.cache.set('opacity', opacity.toFixed(2), (v) => (arc.el.style.opacity = v));
    }
    this.#live = live.sort((a, b) => a.since - b.since).map(({ arc }) => arc);
  }
}

export interface CombatHudOptions {
  /** HUD scale, 0.75–2 (default 1). */
  readonly scale?: number;
  /** Whether motion is reduced right now (see comfort.ts reducedMotion): the chip snaps. */
  readonly reducedMotion?: () => boolean;
}

/** The combat HUD widget; put its element in `ui.hud`. */
export class CombatHud implements HudWidget<CombatHudModel> {
  readonly element: HTMLElement;
  readonly health: Meter;
  readonly stamina: Meter;
  readonly mana: Meter;
  readonly indicator: DamageIndicator;
  readonly #bars: HTMLElement;
  readonly #cache = new WriteCache();
  #layout: CombatHudLayout;

  constructor(options: CombatHudOptions = {}) {
    const reduced = options.reducedMotion ? { reducedMotion: options.reducedMotion } : {};
    this.health = new Meter({
      label: 'Health',
      kind: 'health',
      trailHoldMs: CHIP_HOLD_MS,
      trailDrainMs: CHIP_DRAIN_MS,
      lowBelow: LOW_HEALTH_FRACTION,
      ...reduced,
    });
    this.stamina = new Meter({
      label: 'Stamina',
      kind: 'stamina',
      trailHoldMs: CHIP_HOLD_MS,
      trailDrainMs: CHIP_DRAIN_MS,
      flashMs: STAMINA_FLASH_MS,
      ...reduced,
    });
    this.mana = new Meter({ label: 'Mana', kind: 'mana', trailHoldMs: CHIP_HOLD_MS, ...reduced });
    this.mana.element.hidden = true;
    this.indicator = new DamageIndicator();
    this.#bars = h(
      'div',
      { className: 'vb-combat-bars' },
      this.health.element,
      this.stamina.element,
      this.mana.element,
    );
    this.element = h(
      'div',
      { className: 'vb-combat-hud', data: { testid: 'combat-hud', uiComponent: 'combat-hud' } },
      this.indicator.element,
      this.#bars,
    );
    this.#layout = combatHudLayout(options.scale ?? 1);
    this.#applyLayout();
  }

  /** The current dimensions. */
  get layout(): CombatHudLayout {
    return this.#layout;
  }

  /** Applies a new HUD scale (clamped to 0.75–2) at once. */
  setScale(scale: number): void {
    this.#layout = combatHudLayout(scale);
    this.#applyLayout();
  }

  /** An action was refused for stamina at `nowMs`: the stamina bar flashes. */
  staminaRejected(nowMs: number): void {
    this.stamina.flash(nowMs);
  }

  /** A hit came from `bearing` degrees clockwise of the camera's forward at `nowMs`. */
  damageFrom(bearing: number, nowMs: number): void {
    this.indicator.show(bearing, nowMs);
  }

  update(model: CombatHudModel, nowMs: number): void {
    this.health.update(model.health, nowMs);
    this.stamina.update(model.stamina, nowMs);
    const mana = model.mana !== undefined && model.mana.max > 0 ? model.mana : undefined;
    this.#cache.set('mana', String(mana !== undefined), () => {
      this.mana.element.hidden = mana === undefined;
    });
    if (mana !== undefined) this.mana.update(mana, nowMs);
    this.indicator.update(nowMs);
  }

  #applyLayout(): void {
    const { margin, gap, health, stamina, mana, ring } = this.#layout;
    const c = this.#cache;
    const sizeOf = (key: string, el: HTMLElement, size: Size): void => {
      c.set(key, `${String(size.width)}x${String(size.height)}`, () => {
        el.style.width = `${String(size.width)}px`;
        el.style.height = `${String(size.height)}px`;
      });
    };
    sizeOf('health', this.health.element, health);
    sizeOf('stamina', this.stamina.element, stamina);
    sizeOf('mana', this.mana.element, mana);
    c.set('place', `${String(margin)} ${String(gap)}`, () => {
      this.#bars.style.right = `${String(margin)}px`;
      this.#bars.style.top = `${String(margin)}px`;
      this.#bars.style.gap = `${String(gap)}px`;
    });
    this.indicator.resize(ring);
    this.element.dataset['scale'] = String(this.#layout.scale);
  }
}
