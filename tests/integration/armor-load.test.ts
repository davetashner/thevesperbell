// mw-e04.16: the shipped dodge moves carry ADR-0003's roll numbers, and the knight's starting kit is a
// Medium load. (The rules themselves are tested in src/sim/combat/load.test.ts, which cannot load
// content.)
import { loadGameContent } from '@content/game-content';
import { describe, expect, it } from 'vitest';
import { addEquipment, addInventory, EquipmentRules, InventoryRules, World } from '@sim/index';
import { shippedMoveTable } from '@tools/replay/action-timeline-scenario';

describe('shipped armor-load content (mw-e04.16)', () => {
  it.each([
    ['dodge-roll-light', 36, 13, 3.6],
    ['dodge-roll-medium', 40, 11, 3.0],
    ['dodge-roll-heavy', 46, 9, 2.2],
  ] as const)(
    'AC-1/AC-2: %s is %i ticks with %i i-frames and %d m of travel',
    (id, ticks, iframes, metres) => {
      const move = shippedMoveTable().get(id);
      expect(move?.totalTicks).toBe(ticks);
      expect((move?.iframes?.to ?? 0) - (move?.iframes?.from ?? 0) + 1).toBe(iframes);
      expect(move?.motion?.distance).toBe(metres);
      expect(move?.staminaCost).toBe(20);
    },
  );

  it('AC-3: the stumble is 20 ticks with no i-frames, no travel and no cost', () => {
    const move = shippedMoveTable().get('dodge-stumble');
    expect(move).toMatchObject({ totalTicks: 20, iframes: null, motion: null, staminaCost: 0 });
  });

  it('the unequipped roll is unchanged: 36 ticks, 13 i-frames, 3.0 m', () => {
    const move = shippedMoveTable().get('dodge-roll');
    expect(move).toMatchObject({ totalTicks: 36, iframes: { from: 2, to: 14 } });
    expect(move?.motion?.distance).toBe(3);
  });

  it('the knight’s starting kit is a Medium load (mail and wooden shield, 11 kg of 30)', () => {
    const content = loadGameContent();
    const rules = new EquipmentRules(content.all('item'), content.all('class'));
    const world = new World({ seed: 1 });
    const actor = world.spawn();
    addInventory(world, actor);
    addEquipment(world, actor, 'knight');
    const inventory = new InventoryRules(content.all('item'));
    for (const id of ['mail-hauberk', 'wooden-shield']) {
      const added = inventory.add(world, actor, id, 1);
      if (!added.ok) throw new Error('add failed');
      rules.equip(world, actor, added.instanceIds[0] ?? 0);
    }
    const state = rules.state(world, actor);
    expect(state.armorKg).toBe(11);
    expect(state.loadClass).toBe('medium');
    expect(state.absorption).toEqual({});
    expect(state.poiseBonus).toBe(0);
  });
});
