import { describe, expect, it } from 'vitest';
import type { World } from '../core/world';
import { learnSpell } from './components';
import {
  assignSpellSlot,
  assignSpellSlotCommand,
  hotbarOf,
  installSpellHotbar,
  selectedHotbarSpell,
  selectSpellSlot,
  selectSpellSlotCommand,
  SPELL_HOTBAR_SLOTS,
  SpellHotbarComponent,
  SpellSelected,
  type SpellHotbarCommand,
  type SpellSelectedInfo,
} from './hotbar';
import { SpellLearned } from './learning';
import { makeSpell, spellWorld } from './testing';

const setup = () => {
  const fixture = spellWorld([makeSpell('t-a'), makeSpell('t-b'), makeSpell('t-c')]);
  const world = fixture.world as unknown as World<SpellHotbarCommand>;
  installSpellHotbar(world);
  const caster = fixture.spawn();
  for (const id of ['t-a', 't-b', 't-c']) learnSpell(world, caster, id);
  const selected: SpellSelectedInfo[] = [];
  world.events.on(SpellSelected, (e) => selected.push(e));
  return { world, caster, selected };
};

describe('spell hotbar (mw-e06.16)', () => {
  it('AC-1: with spells in slots 1-3, selecting slot 2 selects that spell and fires SpellSelected', () => {
    const { world, caster, selected } = setup();
    world.step([
      assignSpellSlotCommand(caster, 0, 't-a'),
      assignSpellSlotCommand(caster, 1, 't-b'),
      assignSpellSlotCommand(caster, 2, 't-c'),
    ]);
    world.step([selectSpellSlotCommand(caster, 1)]);
    expect(selectedHotbarSpell(world, caster)).toBe('t-b');
    expect(selected).toEqual([{ tick: world.tick - 1, caster, slot: 1, spell: 't-b' }]);
  });

  it('AC-4: an empty slot, a bad slot or a gone caster selects nothing and throws nothing', () => {
    const { world, caster, selected } = setup();
    world.step([assignSpellSlotCommand(caster, 0, 't-a')]);
    world.step([
      selectSpellSlotCommand(caster, 0),
      selectSpellSlotCommand(caster, 4),
      selectSpellSlotCommand(caster, -1),
      selectSpellSlotCommand(caster, 1.5),
      selectSpellSlotCommand(9999, 0),
      'not a command' as never,
      null as never,
      { type: 'select-spell-slot', caster: 'x', slot: 0 } as never,
      { type: 'other', caster } as never,
    ]);
    expect(hotbarOf(world, caster)?.selected).toBe(0);
    expect(selected).toHaveLength(1);
    expect(selectSpellSlot(world, caster, 3)).toBe(false);
    expect(selectSpellSlot(world, 12345, 3)).toBe(false);
    expect(selected).toHaveLength(1);
  });

  it('selecting the selected slot again fires nothing; a world with no hotbar selects nothing', () => {
    const { world, caster, selected } = setup();
    expect(selectSpellSlot(world, caster, 0)).toBe(false);
    expect(selectedHotbarSpell(world, caster)).toBeUndefined();
    world.step([assignSpellSlotCommand(caster, 0, 't-a')]);
    world.step([selectSpellSlotCommand(caster, 0)]);
    world.step([selectSpellSlotCommand(caster, 0)]);
    expect(selected).toHaveLength(1);
    expect(selectSpellSlot(world, caster, 0)).toBe(true);
    expect(selected).toHaveLength(1);
  });

  it('assigns only learned spells, swaps a spell already on the bar, and clears a slot', () => {
    const { world, caster } = setup();
    expect(assignSpellSlot(world, caster, 0, 'nonsense')).toBe(false);
    expect(assignSpellSlot(world, caster, SPELL_HOTBAR_SLOTS, 't-a')).toBe(false);
    expect(hotbarOf(world, caster)).toBeUndefined();
    world.step([assignSpellSlotCommand(caster, 0, 't-a')]);
    world.step([assignSpellSlotCommand(caster, 1, 't-b'), selectSpellSlotCommand(caster, 0)]);
    world.step([assignSpellSlotCommand(caster, 1, 't-a')]);
    expect(hotbarOf(world, caster)?.slots.slice(0, 3)).toEqual(['t-b', 't-a', null]);
    expect(hotbarOf(world, caster)?.selected).toBe(0);
    world.step([assignSpellSlotCommand(caster, 0, null)]);
    expect(hotbarOf(world, caster)).toMatchObject({ selected: null });
    world.step([assignSpellSlotCommand(caster, 3, null)]);
    expect(hotbarOf(world, caster)?.slots).toHaveLength(SPELL_HOTBAR_SLOTS);
  });

  it('a newly learned spell takes the first empty slot and is selected when nothing is', () => {
    const fixture = spellWorld([makeSpell('t-a'), makeSpell('t-b')]);
    const world = fixture.world as unknown as World<SpellHotbarCommand>;
    installSpellHotbar(world);
    const caster = fixture.spawn();
    const selected: SpellSelectedInfo[] = [];
    world.events.on(SpellSelected, (e) => selected.push(e));
    expect(world.isRegistered(SpellHotbarComponent)).toBe(false);
    learnSpell(world, caster, 't-a');
    world.events.emit(SpellLearned, { tick: 0, actor: caster, spellId: 't-a', source: 'x' });
    world.step([]);
    learnSpell(world, caster, 't-b');
    world.events.emit(SpellLearned, { tick: 0, actor: caster, spellId: 't-b', source: 'x' });
    world.step([]);
    world.events.emit(SpellLearned, { tick: 0, actor: caster, spellId: 't-b', source: 'x' });
    world.step([]);
    expect(hotbarOf(world, caster)?.slots.slice(0, 3)).toEqual(['t-a', 't-b', null]);
    expect(hotbarOf(world, caster)?.selected).toBe(0);
    expect(selected.map((e) => e.spell)).toEqual(['t-a']);
  });

  it('a damaged save whose selected slot is empty selects nothing', () => {
    const { world, caster } = setup();
    world.step([assignSpellSlotCommand(caster, 0, 't-a')]);
    world.step([]);
    world.set(caster, SpellHotbarComponent, { slots: [null, 't-a'], selected: 0 });
    expect(selectedHotbarSpell(world, caster)).toBeUndefined();
  });

  it('calls made outside a step (the console, a loader) see each other at once', () => {
    const { world, caster } = setup();
    expect(assignSpellSlot(world, caster, 2, 't-c')).toBe(true);
    expect(assignSpellSlot(world, caster, 0, 't-a')).toBe(true);
    expect(selectSpellSlot(world, caster, 2)).toBe(true);
    expect(hotbarOf(world, caster)).toMatchObject({ selected: 2 });
    expect(hotbarOf(world, caster)?.slots.slice(0, 3)).toEqual(['t-a', null, 't-c']);
  });

  it('a full bar leaves a new spell off it', () => {
    const ids = Array.from({ length: SPELL_HOTBAR_SLOTS + 1 }, (_, i) => `t-${String(i)}`);
    const fixture = spellWorld(ids.map((id) => makeSpell(id)));
    const world = fixture.world as unknown as World<SpellHotbarCommand>;
    installSpellHotbar(world);
    const caster = fixture.spawn();
    for (const id of ids) {
      learnSpell(world, caster, id);
      world.events.emit(SpellLearned, { tick: 0, actor: caster, spellId: id, source: 'x' });
      world.step([]);
    }
    expect(hotbarOf(world, caster)?.slots).toEqual(ids.slice(0, SPELL_HOTBAR_SLOTS));
  });
});
