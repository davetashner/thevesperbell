// The quick-select wheel (mw-e06.16): a ring of the hotbar's slots in the middle of the screen, held
// open with the wheel button. Slot 1 is at the top and the rest follow clockwise. Pointing a mouse or
// a stick towards a slot lights it; letting go of the wheel button selects it. The game slows
// the sim while it is open (an accessibility option, default on) so a choice mid-fight is calm.
//
// Pure geometry (`wheelSlotAt`) is separate from the widget so the game can reuse it with the
// accumulated mouse or stick offset. Like every HUD widget it reads no sim state.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** What one wheel sector shows. */
export interface WheelSlotModel {
  /** The spell's name; empty for an empty slot. */
  readonly name: string;
  /** Whether it can be cast now (mana, cooldown). */
  readonly ready: boolean;
}

export interface SpellWheelModel {
  readonly open: boolean;
  readonly slots: readonly WheelSlotModel[];
  /** The slot the pointer is over, or null when it rests near the centre. */
  readonly highlight: number | null;
  /** The slot currently selected on the hotbar. */
  readonly selected: number | null;
}

/** A closed wheel. */
export const CLOSED_WHEEL: SpellWheelModel = Object.freeze({
  open: false,
  slots: Object.freeze([]),
  highlight: null,
  selected: null,
});

/** How far from the centre a pointer offset must be (in its own units) before it picks a slot. */
export const WHEEL_DEAD_ZONE = 0.35;

/**
 * The slot an offset (x right, y down, like screen pixels or a stick) points at: sector `i` of
 * `count` is centred `i / count` of a turn clockwise from straight up. Null inside the dead zone.
 */
export function wheelSlotAt(
  x: number,
  y: number,
  count: number,
  deadZone = WHEEL_DEAD_ZONE,
): number | null {
  if (count <= 0 || Math.hypot(x, y) < deadZone) return null;
  const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
  return Math.round(turn * count) % count;
}

/** The wheel; put its element in `ui.hud`. */
export class SpellWheel implements HudWidget<SpellWheelModel> {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();
  #sectors: HTMLElement[] = [];
  readonly #ring: HTMLElement;
  readonly #name: HTMLElement;

  constructor() {
    this.#ring = h('div', { className: 'vb-spell-wheel-ring' });
    this.#name = h('div', { className: 'vb-spell-wheel-name' });
    this.element = h(
      'div',
      {
        className: 'vb-spell-wheel',
        attrs: { role: 'group', 'aria-label': 'Spell wheel', hidden: '' },
        data: { testid: 'spell-wheel', uiComponent: 'spell-wheel', open: 'false' },
      },
      this.#ring,
      this.#name,
    );
  }

  /** The sector for slot `i`, made the first time it is asked for. */
  #sector(i: number): HTMLElement {
    let sector = this.#sectors[i];
    if (sector === undefined) {
      sector = h('span', { className: 'vb-spell-wheel-slot', data: { slot: String(i) } });
      this.#sectors[i] = sector;
      this.#ring.append(sector);
    }
    return sector;
  }

  update(model: SpellWheelModel): void {
    const c = this.#cache;
    c.set('open', String(model.open), (v) => {
      this.element.hidden = v !== 'true';
      this.element.dataset['open'] = v;
    });
    if (!model.open) return;
    const count = model.slots.length;
    this.#sectors.splice(count).forEach((sector) => {
      sector.remove();
    });
    model.slots.forEach((slot, i) => {
      const sector = this.#sector(i);
      const state = slot.name === '' ? 'empty' : slot.ready ? 'ready' : 'unavailable';
      const highlight = String(model.highlight === i);
      const selected = String(model.selected === i);
      c.set(`slot${String(i)}`, [count, slot.name, state, highlight, selected].join('|'), () => {
        const angle = (i / count) * 2 * Math.PI;
        sector.style.left = `${String(50 + 38 * Math.sin(angle))}%`;
        sector.style.top = `${String(50 - 38 * Math.cos(angle))}%`;
        sector.textContent = slot.name === '' ? String(i + 1) : slot.name;
        sector.dataset['state'] = state;
        sector.dataset['highlight'] = highlight;
        sector.dataset['selected'] = selected;
      });
    });
    const picked = model.highlight === null ? undefined : model.slots[model.highlight];
    c.set('name', picked?.name ?? '', (v) => {
      this.#name.textContent = v;
    });
  }
}
