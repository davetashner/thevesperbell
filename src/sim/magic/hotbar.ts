// The spell hotbar (mw-e06.16): eight slots a caster fills with spells it has learned, and which one
// is selected (the spell the cast button casts). It is sim state, not UI state, so it is saved with
// the world, replays, and hashes with it; but the component is registered lazily, on the first
// spell learned or the first assignment, so a world that never casts keeps the same state hash.
//
// - `assign-spell-slot` puts a learned spell in a slot (or empties it with `spell: null`). A spell
//   sits in at most one slot: assigning it to another swaps the two (drag from the grimoire).
// - `select-spell-slot` selects a filled slot and emits SpellSelected. An empty slot, a slot out of
//   range or the slot already selected changes nothing (and throws nothing).
// - The first spell a caster learns lands in its first empty slot, and is selected when nothing is.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { knowsSpell } from './components';
import { SpellLearned } from './learning';

/** Slots on the hotbar. */
export const SPELL_HOTBAR_SLOTS = 8;

/** One caster's hotbar (`magic.hotbar`; a snapshot and save key, never renamed). */
export interface SpellHotbar {
  /** A spell id per slot, null when empty; always `SPELL_HOTBAR_SLOTS` long. */
  readonly slots: readonly (string | null)[];
  /** The selected slot, or null when none is. */
  readonly selected: number | null;
}
export const SpellHotbarComponent = defineComponent<SpellHotbar>('magic.hotbar');

/** A caster selected a slot's spell. */
export interface SpellSelectedInfo {
  readonly tick: number;
  readonly caster: EntityId;
  readonly slot: number;
  readonly spell: string;
}
export const SpellSelected = defineEvent<SpellSelectedInfo>('SpellSelected');

/** The `select-spell-slot` input command. */
export interface SelectSpellSlotCommand {
  readonly type: 'select-spell-slot';
  readonly caster: EntityId;
  readonly slot: number;
}

/** The `assign-spell-slot` input command; `spell: null` empties the slot. */
export interface AssignSpellSlotCommand {
  readonly type: 'assign-spell-slot';
  readonly caster: EntityId;
  readonly slot: number;
  readonly spell: string | null;
}

export type SpellHotbarCommand = SelectSpellSlotCommand | AssignSpellSlotCommand;

/** Builds the command that selects `slot` (0-based). */
export function selectSpellSlotCommand(caster: EntityId, slot: number): SelectSpellSlotCommand {
  return { type: 'select-spell-slot', caster, slot };
}

/** Builds the command that puts `spell` (or nothing) in `slot` (0-based). */
export function assignSpellSlotCommand(
  caster: EntityId,
  slot: number,
  spell: string | null,
): AssignSpellSlotCommand {
  return { type: 'assign-spell-slot', caster, slot, spell };
}

const typeOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null ? (input as { type?: unknown }).type : undefined;

/** Whether an input command is a select-spell-slot command. */
export function isSelectSpellSlotCommand(input: unknown): input is SelectSpellSlotCommand {
  return typeOf(input) === 'select-spell-slot';
}

/** Whether an input command is an assign-spell-slot command. */
export function isAssignSpellSlotCommand(input: unknown): input is AssignSpellSlotCommand {
  return typeOf(input) === 'assign-spell-slot';
}

const isSlot = (slot: unknown): slot is number =>
  typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < SPELL_HOTBAR_SLOTS;

// A hotbar first added inside a step does not exist until the step ends (structural changes wait), so
// later commands in the same tick read it from here.
const fresh = new WeakMap<object, { tick: number; bars: Map<EntityId, SpellHotbar> }>();

/** `caster`'s hotbar, or undefined when it has none yet. */
export function hotbarOf(world: World<never>, caster: EntityId): SpellHotbar | undefined {
  const added = fresh.get(world);
  if (added?.tick === world.tick && added.bars.has(caster)) return added.bars.get(caster);
  return world.isRegistered(SpellHotbarComponent)
    ? world.get(caster, SpellHotbarComponent)
    : undefined;
}

/** The spell in `caster`'s selected slot, or undefined when none is selected. */
export function selectedHotbarSpell(world: World<never>, caster: EntityId): string | undefined {
  const bar = hotbarOf(world, caster);
  return bar?.selected == null ? undefined : (bar.slots[bar.selected] ?? undefined);
}

const EMPTY: SpellHotbar = Object.freeze({
  slots: Object.freeze(Array.from({ length: SPELL_HOTBAR_SLOTS }, () => null)),
  selected: null,
});

function write(world: World<never>, caster: EntityId, next: SpellHotbar): void {
  const frozen = Object.freeze({ slots: Object.freeze([...next.slots]), selected: next.selected });
  if (!world.isRegistered(SpellHotbarComponent)) world.register(SpellHotbarComponent);
  let added = fresh.get(world);
  if (added?.tick !== world.tick) fresh.set(world, (added = { tick: world.tick, bars: new Map() }));
  if (world.has(caster, SpellHotbarComponent)) {
    world.set(caster, SpellHotbarComponent, frozen);
    // A hotbar added earlier this tick is still read from the map, so keep it current.
    if (added.bars.has(caster)) added.bars.set(caster, frozen);
    return;
  }
  world.add(caster, SpellHotbarComponent, frozen);
  added.bars.set(caster, frozen);
}

/** `bar` with `spell` (or nothing) in `slot`, swapping with the slot the spell was in. */
function place(bar: SpellHotbar, slot: number, spell: string | null): SpellHotbar {
  const slots = [...bar.slots];
  const from = spell === null ? -1 : slots.indexOf(spell);
  if (from >= 0) slots[from] = slots[slot] as string | null;
  slots[slot] = spell;
  const selected = bar.selected !== null && slots[bar.selected] === null ? null : bar.selected;
  return { slots, selected };
}

/**
 * Puts a learned `spell` in `slot` (swapping with the slot it was in), or empties `slot` with null.
 * False, and no change, for a slot out of range or a spell the caster has not learned.
 */
export function assignSpellSlot(
  world: World<never>,
  caster: EntityId,
  slot: number,
  spell: string | null,
): boolean {
  if (!isSlot(slot)) return false;
  if (spell !== null && !knowsSpell(world, caster, spell)) return false;
  write(world, caster, place(hotbarOf(world, caster) ?? EMPTY, slot, spell));
  return true;
}

/** Selects `slot`; false (nothing changes, nothing is emitted) for an empty or invalid slot. */
export function selectSpellSlot(world: World<never>, caster: EntityId, slot: number): boolean {
  if (!isSlot(slot)) return false;
  const bar = hotbarOf(world, caster);
  const spell = bar?.slots[slot] ?? null;
  if (bar === undefined || spell === null) return false;
  if (bar.selected !== slot) {
    write(world, caster, { slots: bar.slots, selected: slot });
    world.events.emit(SpellSelected, { tick: world.tick, caster, slot, spell });
  }
  return true;
}

/**
 * Makes `world` act on the hotbar commands, and give every newly learned spell a slot. Call once at
 * setup, outside a step; registers nothing until a caster learns or assigns a spell.
 */
export function installSpellHotbar<TInput>(world: World<TInput>): void {
  const w: World<never> = world;
  world.events.on(SpellLearned, ({ actor, spellId }) => {
    const bar = hotbarOf(w, actor) ?? EMPTY;
    const slot = bar.slots.indexOf(null);
    if (slot < 0 || bar.slots.includes(spellId)) return;
    const placed = place(bar, slot, spellId);
    const selects = placed.selected === null;
    write(w, actor, selects ? { ...placed, selected: slot } : placed);
    if (selects) {
      w.events.emit(SpellSelected, { tick: w.tick, caster: actor, slot, spell: spellId });
    }
  });
  const system: System<TInput> = {
    name: 'spell-hotbar',
    run: ({ inputs }) => {
      for (const input of inputs) {
        if (isSelectSpellSlotCommand(input) && w.isAlive(input.caster)) {
          selectSpellSlot(w, input.caster, input.slot);
        } else if (isAssignSpellSlotCommand(input) && w.isAlive(input.caster)) {
          assignSpellSlot(w, input.caster, input.slot, input.spell);
        }
      }
    },
  };
  world.addSystem(system);
}
