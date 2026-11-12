import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { inventoryCheckpoint } from './checkpoint';
import { addInventory, InventoryRules, inventoryOf } from './inventory';

const rules = new InventoryRules([
  { id: 'key', category: 'key', stackable: false, flags: { unique: false, questItem: false } },
]);

function setup() {
  const world = new World<never>({ seed: 1, hz: 60 });
  const actor = world.spawn();
  addInventory(world, actor, 10);
  world.step();
  return { world, actor };
}

describe('inventoryCheckpoint (mw-e23.11)', () => {
  it('rollback restores items and gold', () => {
    const { world, actor } = setup();
    const before = inventoryOf(world, actor);
    const checkpoint = inventoryCheckpoint(world, actor);
    rules.add(world, actor, 'key', 1);
    rules.addGold(world, actor, 5);
    expect(inventoryOf(world, actor)).not.toEqual(before);
    checkpoint.rollback();
    expect(inventoryOf(world, actor)).toEqual(before);
  });

  it('commit keeps the changes', () => {
    const { world, actor } = setup();
    const checkpoint = inventoryCheckpoint(world, actor);
    rules.addGold(world, actor, 5);
    checkpoint.commit();
    expect(inventoryOf(world, actor)?.gold).toBe(15);
  });

  it('an actor without a pack has nothing to restore', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    const actor = world.spawn();
    expect(() => {
      inventoryCheckpoint(world, actor).rollback();
    }).not.toThrow();
  });
});
