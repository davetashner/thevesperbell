import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { inventoryCheckpoint } from './checkpoint';
import { addInventory, InventoryRules, inventoryOf, itemAdded, itemRemoved } from './inventory';

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

describe('inventoryCheckpoint events (mw-e22.16)', () => {
  const heard = (world: World<never>) => {
    const log: string[] = [];
    world.events.on(itemAdded, (e) => log.push(`added:${e.defId}`));
    world.events.on(itemRemoved, (e) => log.push(`removed:${e.defId}`));
    return log;
  };

  it('holds events until commit and publishes them in order', () => {
    const { world, actor } = setup();
    const log = heard(world);
    const checkpoint = inventoryCheckpoint(world, actor);
    rules.add(world, actor, 'key', 1);
    rules.remove(world, actor, { defId: 'key', count: 1 });
    world.events.flush();
    expect(log).toEqual([]);
    checkpoint.commit();
    world.events.flush();
    expect(log).toEqual(['added:key', 'removed:key']);
  });

  it('drops them on rollback', () => {
    const { world, actor } = setup();
    const log = heard(world);
    const checkpoint = inventoryCheckpoint(world, actor);
    rules.add(world, actor, 'key', 1);
    checkpoint.rollback();
    world.events.flush();
    expect(log).toEqual([]);
  });

  it('nested commits fold into the parent, which can still roll back', () => {
    const { world, actor } = setup();
    const log = heard(world);
    const outer = inventoryCheckpoint(world, actor);
    rules.add(world, actor, 'key', 1);
    const inner = inventoryCheckpoint(world, actor);
    rules.remove(world, actor, { defId: 'key', count: 1 });
    inner.commit();
    world.events.flush();
    expect(log).toEqual([]);
    outer.commit();
    world.events.flush();
    expect(log).toEqual(['added:key', 'removed:key']);

    const outer2 = inventoryCheckpoint(world, actor);
    const inner2 = inventoryCheckpoint(world, actor);
    rules.add(world, actor, 'key', 1);
    inner2.commit();
    outer2.rollback();
    world.events.flush();
    expect(log).toEqual(['added:key', 'removed:key']);
  });

  it('emits at once outside a checkpoint', () => {
    const { world, actor } = setup();
    const log = heard(world);
    rules.add(world, actor, 'key', 1);
    world.events.flush();
    expect(log).toEqual(['added:key']);
  });
});
