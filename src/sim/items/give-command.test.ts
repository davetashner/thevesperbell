import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addInventory, inventoryOf, InventoryRules } from '../inventory/inventory';
import { giveItemCommand, giveItems, isGiveItemCommand } from './give-command';

const ITEMS = [
  {
    id: 'scroll',
    category: 'book',
    stackable: true,
    maxStack: 5,
    flags: { unique: false, questItem: false },
  },
] as const;

function setup() {
  const world = new World<never>({ seed: 1 });
  const giver = { inventory: new InventoryRules(ITEMS), known: (id: string) => id === 'scroll' };
  const actor = world.spawn();
  addInventory(world, actor);
  const held = (): number =>
    (inventoryOf(world, actor)?.items ?? []).reduce((n, item) => n + item.count, 0);
  const give = (...commands: ReturnType<typeof giveItemCommand>[]): void => {
    for (const command of commands) giveItems(world, command, giver);
  };
  return { world, actor, held, give };
}

describe('give-item command', () => {
  it('puts the items in the pack on the tick the command runs', () => {
    const { actor, held, give } = setup();
    give(giveItemCommand(actor, 'scroll', 3), giveItemCommand(actor, 'scroll'));
    expect(held()).toBe(4);
  });

  it('ignores unknown items, bad counts, and actors that are gone or have no pack', () => {
    const { world, actor, held, give } = setup();
    const bare = world.spawn();
    give(
      giveItemCommand(actor, 'nonsense'),
      giveItemCommand(actor, 'scroll', 0),
      giveItemCommand(actor, 'scroll', 1.5),
      giveItemCommand(bare, 'scroll'),
    );
    world.destroy(bare);
    give(giveItemCommand(bare, 'scroll'));
    expect(held()).toBe(0);
  });

  it('isGiveItemCommand recognises only its own type', () => {
    expect(isGiveItemCommand(giveItemCommand(1, 'x'))).toBe(true);
    expect(isGiveItemCommand({ type: 'cast' })).toBe(false);
    expect(isGiveItemCommand(null)).toBe(false);
    expect(isGiveItemCommand('give-item')).toBe(false);
  });
});
