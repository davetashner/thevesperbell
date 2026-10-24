// The player's casting controller (mw-e06.15): the glue from input actions to the sim's cast
// commands. Each gameplay ActionFrame goes through `commands`, which returns the commands to step
// the sim with in the same frame (so a press is a cast request in the very tick it is sampled):
//
//   cast pressed         aim the selected spell along the reticle ray (aim.ts) and send `cast`
//                        with the aim point (and target); an invalid aim sends nothing and is
//                        counted as a refusal, which the reticle shows in red
//   cast released        ends a channel the press started (`cancel-cast`), so a held spell stops
//                        within the tick of the release
//   cancelCast pressed   calls off whatever the caster is winding up or channelling
//
// The selected spell is the hotbar's (mw-e06.16, src/sim/magic/hotbar.ts): the spell in the selected
// slot, else the first spell the caster has learned. The slot keys, previous/next and the wheel's
// pick become `select-spell-slot` commands in the same frame; a cast pressed in that frame already
// uses the newly selected spell. Nothing here changes the sim itself: the sim decides whether the
// cast may start (mana, cooldown, learned) and says why not through SpellFizzled.

import type { SpellEntry } from '@content/index';
import {
  assignSpellSlot,
  hotbarOf,
  KnownSpellsComponent,
  selectedHotbarSpell,
  selectSpellSlot,
  selectSpellSlotCommand,
  SPELL_HOTBAR_SLOTS,
  type ActionFrame,
  type ButtonAction,
  type CancelCastCommand,
  type CastCommand,
  type SelectSpellSlotCommand,
  type SpellLookup,
  type World,
} from '@sim/index';
import { resolveAim, type AimContext, type AimInvalid, type AimRay, type AimResult } from './aim';

/** What the controller adds to a frame's commands. */
export type SpellCommand = CastCommand | CancelCastCommand | SelectSpellSlotCommand;

/** The action that selects each hotbar slot. */
export const SLOT_ACTIONS: readonly ButtonAction[] = Object.freeze([
  'spellSlot1',
  'spellSlot2',
  'spellSlot3',
  'spellSlot4',
  'spellSlot5',
  'spellSlot6',
  'spellSlot7',
  'spellSlot8',
]);

export interface SpellCasterOptions extends AimContext {
  readonly spells: SpellLookup;
  /** Whether the caster can act at all (false once dead); defaults to always. */
  readonly canCast?: () => boolean;
}

/** Why the controller itself, before the sim, did not send a cast. */
export type Refusal = AimInvalid | 'no-spell';

export class SpellCaster {
  readonly #options: SpellCasterOptions;
  readonly #world: World<never>;
  #channelling = false;
  #refusals = 0;
  #lastRefusal: Refusal | undefined;

  constructor(options: SpellCasterOptions) {
    this.#options = options;
    this.#world = options.world;
  }

  /** The spells the caster has learned, in the order learned. */
  learned(): readonly string[] {
    return this.#world.get(this.#options.caster, KnownSpellsComponent)?.spells ?? [];
  }

  /** The spell the cast button casts: the hotbar's selected one, else the first learned. */
  get selected(): string | undefined {
    const known = this.learned();
    const slotted = selectedHotbarSpell(this.#world, this.#options.caster);
    return slotted !== undefined && known.includes(slotted) ? slotted : known[0];
  }

  /**
   * Chooses `id` now (outside a step; the console's way): its slot is selected, and a spell that is
   * not on the bar yet takes the first empty slot, or the selected one when the bar is full. False
   * (and no change) when the caster has not learned it.
   */
  select(id: string): boolean {
    const { caster } = this.#options;
    if (!this.learned().includes(id)) return false;
    const bar = hotbarOf(this.#world, caster) ?? { slots: [], selected: null };
    let slot = bar.slots.indexOf(id);
    if (slot < 0) {
      slot = bar.slots.indexOf(null);
      if (slot < 0) slot = bar.selected ?? 0;
      assignSpellSlot(this.#world, caster, slot, id);
    }
    return selectSpellSlot(this.#world, caster, slot);
  }

  /** The command that selects hotbar slot `slot`; none for an empty or selected slot or a dead caster. */
  slotCommands(slot: number): readonly SpellCommand[] {
    const bar = hotbarOf(this.#world, this.#options.caster);
    if (this.#options.canCast?.() === false || bar === undefined) return [];
    if (bar.slots[slot] == null || bar.selected === slot) return [];
    return [selectSpellSlotCommand(this.#options.caster, slot)];
  }

  /** The slot after (or before) the selected one that holds a spell, wrapping; undefined if none. */
  #step(direction: 1 | -1): number | undefined {
    const bar = hotbarOf(this.#world, this.#options.caster);
    if (bar === undefined) return undefined;
    const from = bar.selected ?? (direction === 1 ? -1 : SPELL_HOTBAR_SLOTS);
    for (let i = 1; i <= SPELL_HOTBAR_SLOTS; i++) {
      const slot = (from + direction * i + SPELL_HOTBAR_SLOTS * 2) % SPELL_HOTBAR_SLOTS;
      if (bar.slots[slot] !== null && slot !== bar.selected) return slot;
    }
    return undefined;
  }

  /** The selected spell's definition, if there is one. */
  spell(): SpellEntry | undefined {
    const id = this.selected;
    return id === undefined ? undefined : this.#options.spells(id);
  }

  /** Where the selected spell would go along `ray` now (undefined with none selected). */
  preview(ray: AimRay): AimResult | undefined {
    const spell = this.spell();
    return spell === undefined ? undefined : resolveAim(spell, ray, this.#options);
  }

  /** Casts the controller refused to send, since it was made. */
  get refusals(): number {
    return this.#refusals;
  }

  /** The reason for the latest refusal. */
  get lastRefusal(): Refusal | undefined {
    return this.#lastRefusal;
  }

  /**
   * The cast commands for one gameplay frame. `ray` is read only when a cast is actually aimed.
   */
  commands(frame: ActionFrame, ray: () => AimRay): readonly SpellCommand[] {
    const { caster } = this.#options;
    const out: SpellCommand[] = [];
    if (this.#options.canCast?.() === false) {
      this.#channelling = false;
      return out;
    }
    const cancel = (): void => {
      out.push({ type: 'cancel-cast', caster });
      this.#channelling = false;
    };
    if (frame.cancelCast.pressed) {
      cancel();
      return out;
    }
    // Selection first: a cast pressed in the same frame uses the spell just chosen.
    let spell = this.spell();
    const bar = hotbarOf(this.#world, caster);
    const wanted = SLOT_ACTIONS.findIndex((action) => frame[action].pressed);
    const slot =
      wanted >= 0
        ? wanted
        : frame.spellNext.pressed
          ? this.#step(1)
          : frame.spellPrev.pressed
            ? this.#step(-1)
            : undefined;
    const slotted = slot === undefined ? undefined : bar?.slots[slot];
    if (slot !== undefined && slotted != null) {
      if (slot !== bar?.selected) out.push(selectSpellSlotCommand(caster, slot));
      spell = this.#options.spells(slotted);
    }
    if (frame.cast.pressed && spell === undefined) this.#refuse('no-spell');
    if (frame.cast.pressed && spell !== undefined) {
      const aim = resolveAim(spell, ray(), this.#options);
      if (!aim.valid) {
        this.#refuse(aim.reason);
      } else {
        out.push({
          type: 'cast',
          caster,
          spell: spell.id,
          aim: aim.point,
          ...(aim.mode === 'target' && aim.target !== null && { target: aim.target }),
        });
        this.#channelling = spell.channel !== undefined;
      }
    }
    if (this.#channelling && frame.cast.released) cancel();
    return out;
  }

  #refuse(reason: Refusal): void {
    this.#refusals += 1;
    this.#lastRefusal = reason;
  }
}
