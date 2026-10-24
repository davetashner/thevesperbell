// Reading a spell scroll (mw-ju8.17): the rules with a recording pipeline and the real inventory rules.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addInventory, inventoryOf, InventoryRules } from '../inventory/inventory';
import type { CastRequest } from './registry';
import type { CastResult } from './pipeline';
import { ScrollRead, ScrollRules } from './scroll';

const ITEMS = [
  {
    id: 'spark-scroll',
    category: 'book',
    stackable: true,
    maxStack: 5,
    flags: { unique: false, questItem: false },
  },
  {
    id: 'plain-book',
    category: 'book',
    stackable: false,
    flags: { unique: false, questItem: false },
  },
] as const;

function setup(result: CastResult = { status: 'cast', delivery: 1 }) {
  const world = new World<never>({ seed: 1 });
  const inventory = new InventoryRules(ITEMS);
  const player = world.spawn();
  addInventory(world, player);
  const requests: CastRequest[] = [];
  const rules = new ScrollRules({
    casts: (id) => (id === 'spark-scroll' ? 'spark' : undefined),
    pipeline: {
      cast: (_w, request) => {
        requests.push(request);
        return result;
      },
    },
    inventory,
  });
  const reads: string[] = [];
  world.events.on(ScrollRead, (e) => reads.push(`${e.scroll}>${e.spell}`));
  const give = (id: string, count = 1): number => {
    const added = inventory.add(world, player, id, count);
    if (!added.ok) throw new Error(added.reason);
    return added.instanceIds[0] ?? 0;
  };
  const held = (id: string): number =>
    (inventoryOf(world, player)?.items ?? [])
      .filter((i) => i.defId === id)
      .reduce((n, i) => n + i.count, 0);
  return { world, player, rules, requests, reads, give, held };
}

describe('ScrollRules', () => {
  it('AC-3: reading casts the spell once, free, at the aim, and spends one scroll', () => {
    const { world, player, rules, requests, reads, give, held } = setup();
    const id = give('spark-scroll', 2);
    const aim = { x: 1, y: 0, z: 2 };
    expect(rules.read(world, player, id, { aim, target: 7 })).toEqual({ ok: true });
    expect(requests).toEqual([{ caster: player, spell: 'spark', source: 'free', aim, target: 7 }]);
    expect(held('spark-scroll')).toBe(1);
    world.step();
    expect(reads).toEqual(['spark-scroll>spark']);
    expect(rules.read(world, player, id)).toEqual({ ok: true });
    expect(requests[1]).toEqual({ caster: player, spell: 'spark', source: 'free' });
    expect(held('spark-scroll')).toBe(0);
    expect(rules.read(world, player, id)).toEqual({ ok: false, reason: 'not-readable' });
  });

  it('keeps the scroll when the cast fizzles', () => {
    const { world, player, rules, give, held, reads } = setup({
      status: 'fizzled',
      reason: 'unsupported-delivery',
      stage: 'validate',
    });
    const id = give('spark-scroll');
    expect(rules.read(world, player, id)).toEqual({ ok: false, reason: 'fizzled' });
    expect(held('spark-scroll')).toBe(1);
    world.step();
    expect(reads).toEqual([]);
  });

  it('refuses an item that casts nothing, and reports which items are castable', () => {
    const { world, player, rules, give, requests } = setup();
    const id = give('plain-book');
    expect(rules.read(world, player, id)).toEqual({ ok: false, reason: 'not-readable' });
    expect(requests).toEqual([]);
    expect(rules.castable('spark-scroll')).toBe(true);
    expect(rules.castable('plain-book')).toBe(false);
  });
});
