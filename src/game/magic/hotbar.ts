// The spell hotbar and wheel in the game (mw-e06.16): the glue between the sim's hotbar
// (src/sim/magic/hotbar.ts), mana, cooldowns and the cast state, and the two widgets
// (src/ui/spell-hotbar.ts, src/ui/spell-wheel.ts).
//
// - `spellSlotModels` turns the caster's bar into what each slot shows: name, cost, cooldown left
//   (seconds, in tenths when shown), whether the mana is there, selected, channelling.
// - `SpellWheelControl` runs the hold-to-open wheel from the action frames. While the wheel button
//   is held the wheel is open: mouse look (or the right stick) moves a pointer instead of turning
//   the view, the slot it points at is lit, and letting go selects that slot. Opening it slows the
//   sim to `WHEEL_TIME_SCALE` (an accessibility option, default on; the caller applies the scale).
// - `attachSpellBar` redraws both widgets once per drawn frame.

import type { SpellEntry } from '@content/index';
import {
  actionVector,
  availableMana,
  castStateOf,
  cooldownRemaining,
  hotbarOf,
  SPELL_HOTBAR_SLOTS,
  type ActionFrame,
  type EntityId,
  type SpellLookup,
  type World,
} from '@sim/index';
import {
  CLOSED_WHEEL,
  EMPTY_SPELL_SLOT,
  SpellHotbar,
  SpellWheel,
  wheelSlotAt,
  type SpellSlotModel,
  type SpellWheelModel,
} from '@ui/index';

/** Sim speed while the wheel is open. */
export const WHEEL_TIME_SCALE = 0.25;

/** Mouse counts that move the wheel pointer one full radius. */
export const WHEEL_MOUSE_RADIUS = 120;

/** The pointer's longest reach, in radii (it clamps, so a flick back is never far to travel). */
const POINTER_LIMIT = 1.25;

/** Whether `spell` can be cast with the mana `available` (or may be over-cast). */
export function affordable(spell: SpellEntry, available: number): boolean {
  return spell.flags.allowOvercast || available >= spell.cost.mana;
}

/** What each hotbar slot shows now. */
export function spellSlotModels(
  world: World<never>,
  player: EntityId,
  spells: SpellLookup,
): readonly SpellSlotModel[] {
  const bar = hotbarOf(world, player);
  const mana = availableMana(world, player);
  const casting = castStateOf(world, player);
  return Array.from({ length: SPELL_HOTBAR_SLOTS }, (_, slot) => {
    const id = bar?.slots[slot] ?? null;
    const spell = id === null ? undefined : spells(id);
    if (spell === undefined) return EMPTY_SPELL_SLOT;
    return {
      name: spell.name,
      cost: spell.cost.mana,
      cooldown: cooldownRemaining(world, player, spell.id) / world.clock.hz,
      cooldownTotal: spell.cooldown,
      affordable: affordable(spell, mana),
      selected: bar?.selected === slot,
      channelling: casting?.phase === 'channeling' && casting.spell === spell.id,
    };
  });
}

/** The wheel's model: the hotbar's slots, the pointed-at slot and the selected one. */
export function wheelModel(
  slots: readonly SpellSlotModel[],
  open: boolean,
  highlight: number | null,
): SpellWheelModel {
  if (!open) return CLOSED_WHEEL;
  const selected = slots.findIndex((slot) => slot.selected);
  return {
    open,
    highlight,
    selected: selected >= 0 ? selected : null,
    slots: slots.map((slot) => ({
      name: slot.name,
      ready: slot.cooldown <= 0 && slot.affordable,
    })),
  };
}

/** The hold-to-open wheel; see the file header. */
export class SpellWheelControl {
  #open = false;
  #x = 0;
  #y = 0;
  readonly #picks: number[] = [];

  get open(): boolean {
    return this.#open;
  }

  /** The slot the pointer is over now (null near the centre or when closed). */
  get highlight(): number | null {
    return this.#open ? wheelSlotAt(this.#x, -this.#y, SPELL_HOTBAR_SLOTS) : null;
  }

  /** Closes the wheel without choosing (a menu opened, the caster died). */
  close(): void {
    this.#open = false;
  }

  /** The slots the wheel chose since the last call (one per release over a slot). */
  takePicks(): readonly number[] {
    return this.#picks.splice(0);
  }

  /**
   * Reads a frame; returns it as the sim should see it: with the wheel open, look is spent on the
   * pointer, not the view. Opening, pointing and closing all happen here.
   */
  shape(frame: ActionFrame): ActionFrame {
    if (frame.spellWheel.pressed) {
      this.#open = true;
      this.#x = 0;
      this.#y = 0;
    }
    if (!this.#open) return frame;
    const stick = frame.lookStick;
    if (stick.x !== 0 || stick.y !== 0) {
      this.#x = stick.x;
      this.#y = stick.y;
    } else {
      this.#x = clamp(this.#x + frame.look.x / WHEEL_MOUSE_RADIUS);
      this.#y = clamp(this.#y + frame.look.y / WHEEL_MOUSE_RADIUS);
    }
    if (frame.spellWheel.released || !frame.spellWheel.held) {
      const pick = this.highlight;
      if (pick !== null) this.#picks.push(pick);
      this.#open = false;
    }
    return { ...frame, look: actionVector(0, 0), lookStick: actionVector(0, 0) };
  }
}

const clamp = (v: number): number => Math.max(-POINTER_LIMIT, Math.min(POINTER_LIMIT, v));

export interface SpellBarOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly spells: SpellLookup;
  readonly hotbar: SpellHotbar;
  readonly wheel: SpellWheel;
  readonly control: SpellWheelControl;
  /** Whether the wheel slows the sim (the accessibility option). */
  readonly slowsTime: () => boolean;
  /** The sim's time scale now, and a way to set it (the wheel gives back what it found). */
  readonly timeScale: () => number;
  readonly setTimeScale: (scale: number) => void;
  /** Whether a screen has paused the game (the wheel closes then). */
  readonly paused: () => boolean;
}

/** Keeps the hotbar and wheel widgets current; call `frame()` once per drawn frame. */
export function attachSpellBar(options: SpellBarOptions): { frame(): void } {
  const { world, player, spells, hotbar, wheel, control } = options;
  let before: number | undefined;
  return {
    frame() {
      if (options.paused()) control.close();
      const slots = spellSlotModels(world, player, spells);
      // Nothing on the bar yet (no spell learned): the bar stays out of the way.
      hotbar.element.hidden = slots.every((slot) => slot.name === '');
      hotbar.update(slots);
      wheel.update(wheelModel(slots, control.open, control.highlight));
      // Slow the sim on the way in and hand back the speed it had on the way out, so a speed set
      // from the console is neither fought nor lost.
      const slow = control.open && options.slowsTime();
      if (slow && before === undefined) {
        before = options.timeScale();
        options.setTimeScale(WHEEL_TIME_SCALE);
      } else if (!slow && before !== undefined) {
        options.setTimeScale(before);
        before = undefined;
      }
    },
  };
}
