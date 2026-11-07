import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addEquipment, equipmentOf, EquipmentRules } from '../inventory/equipment';
import { addInventory, inventoryOf, InventoryRules } from '../inventory/inventory';
import {
  equipItemCommand,
  giveGoldCommand,
  isItemDebugCommand,
  removeItemCommand,
  runItemDebugCommand,
} from './debug-commands';
import { giveItemCommand, giveItems } from './give-command';

const base = { stackable: true, maxStack: 10, flags: { unique: false, questItem: false } };
const ITEMS = [
  { id: 'potion', category: 'consumable', ...base },
  { id: 'ring', category: 'misc', ...base },
  {
    id: 'sword',
    category: 'weapon',
    stackable: false,
    flags: { unique: false, questItem: false },
    equip: { slot: 'main-hand', proficiencies: [], nonProficient: {} },
  },
] as never[];

function setup(withEquipment = true) {
  const world = new World<never>({ seed: 1 });
  const inventory = new InventoryRules(ITEMS, { goldMax: 100 });
  const giver = {
    inventory,
    known: (id: string) => ITEMS.some((i: { id: string }) => i.id === id),
  };
  const equipment = new EquipmentRules(ITEMS, [
    { id: 'knight', proficiencies: [], armorCapacityKg: 50 },
  ]);
  const actor = world.spawn();
  addInventory(world, actor, 5);
  if (withEquipment) addEquipment(world, actor, 'knight');
  const run = (command: Parameters<typeof runItemDebugCommand>[1], who = actor): void => {
    runItemDebugCommand(world, { ...command, actor: who }, giver, equipment);
  };
  return { world, actor, giver, run };
}

describe('item debug commands', () => {
  it('AC-3: a give-item command with a stolen flag adds a stolen instance owned by the owner', () => {
    const { world, actor, giver } = setup();
    giveItems(world, giveItemCommand(actor, 'ring', 1, { stolen: true, ownerId: 'mayor' }), giver);
    giveItems(world, giveItemCommand(actor, 'ring', 1), giver);
    const [stolen, clean] = inventoryOf(world, actor)?.items ?? [];
    expect(stolen?.flags).toEqual({ stolen: true, ownerId: 'mayor' });
    expect(clean?.flags).toEqual({});
  });

  it('removes units of an item, ignoring bad counts, unknown items and refusals', () => {
    const { world, actor, giver, run } = setup();
    giveItems(world, giveItemCommand(actor, 'potion', 4), giver);
    run(removeItemCommand(actor, 'potion', 3));
    expect(inventoryOf(world, actor)?.items[0]?.count).toBe(1);
    run(removeItemCommand(actor, 'potion', 0));
    run(removeItemCommand(actor, 'nonsense', 1));
    run(removeItemCommand(actor, 'potion', 9));
    expect(inventoryOf(world, actor)?.items[0]?.count).toBe(1);
  });

  it('changes gold up (capped by the rules) and down (to nothing at most)', () => {
    const { world, actor, run } = setup();
    const gold = () => inventoryOf(world, actor)?.gold;
    run(giveGoldCommand(actor, 20));
    expect(gold()).toBe(25);
    run(giveGoldCommand(actor, -10));
    expect(gold()).toBe(15);
    run(giveGoldCommand(actor, -1000));
    expect(gold()).toBe(0);
    run(giveGoldCommand(actor, -5));
    run(giveGoldCommand(actor, 0));
    run(giveGoldCommand(actor, 1.5));
    expect(gold()).toBe(0);
  });

  it('equips the first held instance of an item, and skips one that is not held', () => {
    const { world, actor, giver, run } = setup();
    run(equipItemCommand(actor, 'sword'));
    expect(equipmentOf(world, actor)?.slots['main-hand']).toBeNull();
    giveItems(world, giveItemCommand(actor, 'sword'), giver);
    run(equipItemCommand(actor, 'sword'));
    expect(equipmentOf(world, actor)?.slots['main-hand']).not.toBeNull();
  });

  it('ignores an equip for an actor with no equipment, and any command for a missing actor', () => {
    const bare = setup(false);
    giveItems(bare.world, giveItemCommand(bare.actor, 'sword'), bare.giver);
    bare.run(equipItemCommand(bare.actor, 'sword'));
    expect(equipmentOf(bare.world, bare.actor)).toBeUndefined();
    const { world, run } = setup();
    const gone = world.spawn();
    world.destroy(gone);
    run(giveGoldCommand(gone, 5), gone);
    expect(inventoryOf(world, gone)).toBeUndefined();
  });

  it('isItemDebugCommand recognises only its own types', () => {
    expect(isItemDebugCommand(giveGoldCommand(1, 2))).toBe(true);
    expect(isItemDebugCommand(removeItemCommand(1, 'x'))).toBe(true);
    expect(isItemDebugCommand(equipItemCommand(1, 'x'))).toBe(true);
    expect(isItemDebugCommand({ type: 'give-item' })).toBe(false);
    expect(isItemDebugCommand(null)).toBe(false);
  });
});
