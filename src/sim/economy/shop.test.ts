import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addInventory,
  inventoryOf,
  InventoryRules,
  type InventoryItemDef,
} from '../inventory/inventory';
import { addEquipment, EquipmentComponent } from '../inventory/equipment';
import { LootTables, type LootTableDef } from '../loot/tables';
import { Rng } from '../rng';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { giveStamina, StaminaComponent } from '../combat/stamina';
import { DAY_CLOCK_FACTS, factDayClock, MORNING_MINUTE } from '../rest/day-clock';
import { restCompleted, type RestCompleted } from '../rest/rest';
import { addCapabilities, CapabilityRegistry } from '../progression/capabilities';
import { UnlockBook } from '../progression/unlocks';
import { KnownSpellsComponent, knowsSpell, MAGIC_COMPONENTS } from '../magic/components';
import { BUYBACK_LIMIT } from './shop-state';
import {
  shopBought,
  shopBoughtBack,
  shopServiceBought,
  shopSold,
  Shops,
  type ShopItemDef,
  type ShopMerchantDef,
  type ServiceTransaction,
  type ShopTransaction,
} from './shop';

const item = (
  id: string,
  category: InventoryItemDef['category'],
  value: number,
  extra: Partial<Omit<ShopItemDef, 'flags'>> & {
    unique?: boolean;
    questItem?: boolean;
    noSell?: boolean;
  } = {},
): ShopItemDef => {
  const { unique = false, questItem = category === 'quest', noSell, ...rest } = extra;
  return {
    id,
    category,
    value,
    stackable: false,
    flags: { unique, questItem, ...(noSell !== undefined && { noSell }) },
    ...rest,
  };
};

const ITEMS: readonly ShopItemDef[] = [
  item('sword', 'weapon', 80),
  item('dagger', 'weapon', 40),
  item('apple', 'consumable', 4, { stackable: true, maxStack: 5 }),
  item('gem', 'misc', 200, { stackable: true, maxStack: 3 }),
  item('idol', 'misc', 50, { unique: true }),
  item('bell-tongue', 'quest', 0, { unique: true }),
  item('sealed-note', 'misc', 5, { noSell: true }),
  item('book', 'book', 30),
];

const smith: ShopMerchantDef = {
  id: 'smith',
  buysCategories: ['weapon', 'consumable', 'misc'],
  goldReserve: 1000,
  markup: 1,
  buyRate: 0.5,
  stock: [
    { item: { id: 'sword' }, count: 1 },
    { item: { id: 'apple' }, count: 12 },
  ],
};
const fence: ShopMerchantDef = {
  id: 'fence',
  buysCategories: ['weapon', 'consumable', 'misc'],
  goldReserve: 300,
  markup: 1.2,
  buyRate: 0.5,
  isFence: true,
  buysStolen: true,
  stock: [],
};
const pauper: ShopMerchantDef = { ...smith, id: 'pauper', goldReserve: 30, stock: [] };
const hunter: ShopMerchantDef = {
  id: 'hunter',
  buysCategories: ['weapon'],
  goldReserve: 100,
  stock: [{ lootTable: { id: 'hunter-pack' }, count: 3 }],
};
const dealer: ShopMerchantDef = {
  id: 'dealer',
  buysCategories: ['weapon'],
  goldReserve: 100,
  stock: [{ lootTable: { id: 'hunter-pack' }, count: 1 }],
};

const PACK: LootTableDef = {
  id: 'hunter-pack',
  guaranteed: [{ item: { id: 'dagger' }, count: 1 }],
  rolls: { min: 1, max: 1 },
  noDuplicates: false,
  entries: [
    { item: { id: 'apple' }, weight: 3, count: { min: 1, max: 4 } },
    { item: { id: 'gem' }, weight: 1, count: { min: 1, max: 2 } },
  ],
};

const innkeeper: ShopMerchantDef = {
  id: 'inn',
  buysCategories: ['consumable'],
  goldReserve: 50,
  markup: 1,
  buyRate: 0.5,
  stock: [],
  services: [{ id: 'room', name: 'Room for the night', price: 12, kind: 'rest' }],
};

const MERCHANTS = [smith, fence, pauper, hunter, dealer, innkeeper];

function setup(gold = 100, options: { goldMax?: number; unitGuard?: number } = {}) {
  const world = new World({ seed: 7 });
  const actor = world.spawn();
  addInventory(world, actor, gold);
  const rules = new InventoryRules(ITEMS, options);
  const shops = new Shops(MERCHANTS, ITEMS, rules, new LootTables([PACK], ITEMS));
  const events: [string, ShopTransaction][] = [];
  world.events.on(shopBought, (e) => events.push(['bought', e]));
  world.events.on(shopSold, (e) => events.push(['sold', e]));
  world.events.on(shopBoughtBack, (e) => events.push(['bought-back', e]));
  return { world, actor, rules, shops, events };
}

const lineOf = (s: ReturnType<typeof setup>, merchant: string, defId: string) =>
  s.shops.stateOf(s.world, merchant).stock.find((l) => l.defId === defId)?.id ?? -1;

/** Everything the transaction engine must leave alone on a failure. */
const fingerprint = (s: ReturnType<typeof setup>, merchant: string): string =>
  JSON.stringify([inventoryOf(s.world, s.actor), s.shops.stateOf(s.world, merchant)]);

describe('merchant transactions (mw-e20.4)', () => {
  it('AC-1: buying an 80-gold item with 100 gold leaves 20, the item in the pack, merchant +80 and stock 0', () => {
    const s = setup(100);
    const line = lineOf(s, 'smith', 'sword');
    expect(s.shops.buy(s.world, s.actor, 'smith', line)).toEqual({
      ok: true,
      unitPrice: 80,
      total: 80,
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(20);
    expect(s.rules.count(s.world, s.actor, { defId: 'sword' })).toBe(1);
    const state = s.shops.stateOf(s.world, 'smith');
    expect(state.gold).toBe(1080);
    expect(state.stock.some((l) => l.defId === 'sword')).toBe(false);
    s.world.events.flush();
    expect(s.events).toEqual([
      [
        'bought',
        {
          tick: 0,
          actor: s.actor,
          merchantId: 'smith',
          defId: 'sword',
          count: 1,
          flags: {},
          unitPrice: 80,
          total: 80,
        },
      ],
    ]);
  });

  it('AC-2: a buy of an item with no stock fails with out-of-stock and nothing changes', () => {
    const s = setup(500);
    const line = lineOf(s, 'smith', 'sword');
    s.shops.buy(s.world, s.actor, 'smith', line);
    const before = fingerprint(s, 'smith');
    s.events.length = 0;
    expect(s.shops.buy(s.world, s.actor, 'smith', line)).toEqual({
      ok: false,
      reason: 'no-such-item',
    });
    const apples = lineOf(s, 'smith', 'apple');
    expect(s.shops.buy(s.world, s.actor, 'smith', apples, 13)).toEqual({
      ok: false,
      reason: 'out-of-stock',
    });
    expect(fingerprint(s, 'smith')).toBe(before);
    expect(s.events).toEqual([]);
  });

  it('AC-2: cannot-afford, cannot-carry and a hostile merchant change nothing', () => {
    const s = setup(10);
    const sword = lineOf(s, 'smith', 'sword');
    const before = fingerprint(s, 'smith');
    expect(s.shops.buy(s.world, s.actor, 'smith', sword)).toEqual({
      ok: false,
      reason: 'cannot-afford',
    });
    expect(s.shops.buy(s.world, s.actor, 'smith', sword, 1, { disposition: 'hostile' })).toEqual({
      ok: false,
      reason: 'hostile',
    });
    expect(fingerprint(s, 'smith')).toBe(before);

    const guarded = setup(1000, { unitGuard: 2 });
    const apples = lineOf(guarded, 'smith', 'apple');
    const guardedBefore = fingerprint(guarded, 'smith');
    expect(guarded.shops.buy(guarded.world, guarded.actor, 'smith', apples, 3)).toEqual({
      ok: false,
      reason: 'cannot-carry',
    });
    expect(fingerprint(guarded, 'smith')).toBe(guardedBefore);
  });

  it('buying several stacked units takes them from the line and charges per unit', () => {
    const s = setup(100);
    const apples = lineOf(s, 'smith', 'apple');
    expect(s.shops.buy(s.world, s.actor, 'smith', apples, 7)).toEqual({
      ok: true,
      unitPrice: 4,
      total: 28,
    });
    expect(s.rules.query(s.world, s.actor).map((i) => i.count)).toEqual([5, 2]);
    expect(s.shops.stateOf(s.world, 'smith').stock.find((l) => l.defId === 'apple')?.count).toBe(5);
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(72);
  });

  it('AC-3: a sell priced above the merchant gold fails with merchant-cannot-afford, nothing changes', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'sword', 1);
    const before = fingerprint(s, 'pauper');
    expect(s.shops.quote('pauper', 'sell', 'sword')).toMatchObject({ ok: true, price: 40 });
    s.rules.add(s.world, s.actor, 'gem', 1);
    const gem = s.rules.query(s.world, s.actor, { defId: 'gem' })[0]?.instanceId ?? 0;
    expect(s.shops.quote('pauper', 'sell', 'gem')).toMatchObject({ ok: true, price: 100 });
    const gemBefore = fingerprint(s, 'pauper');
    expect(s.shops.sell(s.world, s.actor, 'pauper', gem)).toEqual({
      ok: false,
      reason: 'merchant-cannot-afford',
    });
    expect(fingerprint(s, 'pauper')).toBe(gemBefore);
    expect(before).not.toBe(gemBefore); // the gem added to the pack since
    expect(s.events).toEqual([]);
  });

  it('selling pays the player, takes the instance and queues the buyback entry', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'dagger', 1);
    const dagger = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    expect(s.shops.sell(s.world, s.actor, 'smith', dagger)).toEqual({
      ok: true,
      unitPrice: 20,
      total: 20,
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(20);
    expect(s.rules.count(s.world, s.actor)).toBe(0);
    const state = s.shops.stateOf(s.world, 'smith');
    expect(state.gold).toBe(980);
    expect(state.buyback).toMatchObject([{ defId: 'dagger', count: 1, unitPrice: 20 }]);
    expect(state.stock.some((l) => l.defId === 'dagger')).toBe(false);
    s.world.events.flush();
    expect(s.events.map(([kind]) => kind)).toEqual(['sold']);
  });

  it('an equipped item cannot be sold until it is unequipped; nothing changes', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'dagger', 1);
    const dagger = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    addEquipment(s.world, s.actor, 'warrior');
    const worn = s.world.get(s.actor, EquipmentComponent);
    if (worn === undefined) throw new Error('no equipment');
    s.world.set(s.actor, EquipmentComponent, {
      ...worn,
      slots: { ...worn.slots, 'main-hand': { instanceId: dagger, defId: 'dagger' } },
    });
    expect(s.shops.sell(s.world, s.actor, 'smith', dagger)).toEqual({
      ok: false,
      reason: 'equipped',
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(0);
    expect(s.rules.count(s.world, s.actor)).toBe(1);
    s.world.set(s.actor, EquipmentComponent, worn);
    expect(s.shops.sell(s.world, s.actor, 'smith', dagger)).toMatchObject({ ok: true });
  });

  it('selling part of a stack leaves the rest; selling more than held fails not-enough', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'apple', 5);
    const apples = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    const before = fingerprint(s, 'smith');
    expect(s.shops.sell(s.world, s.actor, 'smith', apples, 6)).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(fingerprint(s, 'smith')).toBe(before);
    expect(s.shops.sell(s.world, s.actor, 'smith', apples, 2)).toEqual({
      ok: true,
      unitPrice: 2,
      total: 4,
    });
    expect(s.rules.count(s.world, s.actor)).toBe(3);
  });

  it('refuses what the price model refuses, with its reason, changing nothing', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'book', 1);
    s.rules.add(s.world, s.actor, 'sealed-note', 1);
    s.rules.add(s.world, s.actor, 'bell-tongue', 1);
    s.rules.add(s.world, s.actor, 'dagger', 1, { stolen: true });
    s.rules.add(s.world, s.actor, 'gem', 1, { bound: true });
    const id = (defId: string) => s.rules.query(s.world, s.actor, { defId })[0]?.instanceId ?? 0;
    const before = fingerprint(s, 'smith');
    const reason = (defId: string) => {
      const result = s.shops.sell(s.world, s.actor, 'smith', id(defId));
      return result.ok ? 'sold' : result.reason;
    };
    expect(reason('book')).toBe('not-bought');
    expect(reason('sealed-note')).toBe('no-sell');
    expect(reason('bell-tongue')).toBe('quest-item');
    expect(reason('dagger')).toBe('stolen');
    expect(reason('gem')).toBe('bound');
    expect(s.shops.sell(s.world, s.actor, 'smith', 999)).toEqual({
      ok: false,
      reason: 'no-such-item',
    });
    expect(fingerprint(s, 'smith')).toBe(before);
  });

  it('a fence buys stolen goods, and the flags travel to the shelf and back to the buyer', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'dagger', 1, { stolen: true, ownerId: 'miller' });
    const dagger = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    const sold = s.shops.sell(s.world, s.actor, 'fence', dagger);
    expect(sold).toMatchObject({ ok: true });
    s.shops.clearBuyback(s.world, 'fence');
    const state = s.shops.stateOf(s.world, 'fence');
    expect(state.stock).toMatchObject([
      { defId: 'dagger', flags: { stolen: true, ownerId: 'miller' } },
    ]);
    s.rules.addGold(s.world, s.actor, 100);
    expect(s.shops.buy(s.world, s.actor, 'fence', state.stock[0]?.id ?? 0)).toMatchObject({
      ok: true,
    });
    expect(s.rules.query(s.world, s.actor)[0]?.flags).toEqual({ stolen: true, ownerId: 'miller' });
  });

  it('a payment that would pass the gold cap is refused as gold-cap', () => {
    const s = setup(95, { goldMax: 100 });
    s.rules.add(s.world, s.actor, 'sword', 1);
    const sword = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    const before = fingerprint(s, 'smith');
    expect(s.shops.sell(s.world, s.actor, 'smith', sword)).toEqual({
      ok: false,
      reason: 'gold-cap',
    });
    expect(fingerprint(s, 'smith')).toBe(before);
  });

  it('AC-4: an item just sold is bought back at the price it was sold for', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'sword', 1);
    const sword = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    const sold = s.shops.sell(s.world, s.actor, 'smith', sword);
    const entry = s.shops.stateOf(s.world, 'smith').buyback[0];
    expect(sold).toMatchObject({ ok: true, unitPrice: 40 });
    // The sell price is below what the shelf would charge (80): buyback is not the buy price.
    expect(s.shops.quote('smith', 'buy', 'sword')).toMatchObject({ price: 80 });
    expect(s.shops.buyBack(s.world, s.actor, 'smith', 12345)).toEqual({
      ok: false,
      reason: 'no-such-item',
    });
    expect(s.shops.buyBack(s.world, s.actor, 'smith', entry?.id ?? 0, 2)).toEqual({
      ok: false,
      reason: 'out-of-stock',
    });
    s.rules.addGold(s.world, s.actor, 100);
    const gold = inventoryOf(s.world, s.actor)?.gold ?? 0;
    expect(s.shops.buyBack(s.world, s.actor, 'smith', entry?.id ?? 0)).toEqual({
      ok: true,
      unitPrice: 40,
      total: 40,
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(gold - 40);
    expect(s.rules.count(s.world, s.actor, { defId: 'sword' })).toBe(1);
    const state = s.shops.stateOf(s.world, 'smith');
    expect(state.buyback).toEqual([]);
    expect(state.gold).toBe(1000);
    s.world.events.flush();
    expect(s.events.map(([kind]) => kind)).toEqual(['sold', 'bought-back']);
  });

  it('buyback of part of an entry, and of what the player cannot afford or carry', () => {
    const s = setup(0, { unitGuard: 3 });
    s.rules.add(s.world, s.actor, 'apple', 3);
    const apples = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
    s.shops.sell(s.world, s.actor, 'smith', apples, 3);
    const entry = s.shops.stateOf(s.world, 'smith').buyback[0];
    const id = entry?.id ?? 0;
    s.rules.spendGold(s.world, s.actor, inventoryOf(s.world, s.actor)?.gold ?? 0);
    const before = fingerprint(s, 'smith');
    expect(s.shops.buyBack(s.world, s.actor, 'smith', id, 3)).toEqual({
      ok: false,
      reason: 'cannot-afford',
    });
    s.rules.addGold(s.world, s.actor, 100);
    s.rules.add(s.world, s.actor, 'apple', 1);
    const guarded = fingerprint(s, 'smith');
    expect(before).not.toBe(guarded);
    expect(s.shops.buyBack(s.world, s.actor, 'smith', id, 3)).toEqual({
      ok: false,
      reason: 'cannot-carry',
    });
    expect(fingerprint(s, 'smith')).toBe(guarded);
    expect(s.shops.buyBack(s.world, s.actor, 'smith', id, 2)).toMatchObject({ ok: true, total: 4 });
    expect(s.shops.stateOf(s.world, 'smith').buyback).toMatchObject([{ count: 1 }]);
  });

  it('the buyback list keeps the last 10 sales; older ones fall onto the shelf', () => {
    const s = setup(0);
    for (let i = 0; i < BUYBACK_LIMIT + 2; i++) s.rules.add(s.world, s.actor, 'dagger', 1);
    for (let i = 0; i < BUYBACK_LIMIT + 2; i++) {
      const next = s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0;
      s.shops.sell(s.world, s.actor, 'smith', next);
    }
    const state = s.shops.stateOf(s.world, 'smith');
    expect(state.buyback).toHaveLength(BUYBACK_LIMIT);
    // The two oldest sales merged into one dagger line on the shelf.
    expect(state.stock.find((l) => l.defId === 'dagger')).toMatchObject({ count: 2, entry: null });
  });

  it('clearBuyback moves every buyback entry onto the shelf and reports the units', () => {
    const s = setup(0);
    s.rules.add(s.world, s.actor, 'apple', 4);
    s.shops.sell(s.world, s.actor, 'smith', s.rules.query(s.world, s.actor)[0]?.instanceId ?? 0, 4);
    expect(s.shops.clearBuyback(s.world, 'smith')).toBe(4);
    const state = s.shops.stateOf(s.world, 'smith');
    expect(state.buyback).toEqual([]);
    expect(state.stock.filter((l) => l.defId === 'apple').map((l) => [l.entry, l.count])).toEqual([
      [1, 12],
      [null, 4],
    ]);
    expect(s.shops.clearBuyback(s.world, 'smith')).toBe(0);
  });

  it('loot-table stock is rolled once, deterministically, and kept', () => {
    const a = setup();
    const first = a.shops.stateOf(a.world, 'hunter');
    expect(a.shops.stateOf(a.world, 'hunter')).toBe(first);
    expect(first.stock.find((l) => l.defId === 'dagger')?.count).toBe(3);
    expect(first.stock.every((l) => l.entry === 0)).toBe(true);
    const b = setup();
    // The order other merchants are visited in does not change the roll.
    b.shops.stateOf(b.world, 'dealer');
    b.shops.stateOf(b.world, 'smith');
    expect(b.shops.stateOf(b.world, 'hunter')).toEqual(first);
  });

  it('needs LootTables for a loot-table entry, and rejects unknown merchants and items', () => {
    const s = setup();
    const bare = new Shops(MERCHANTS, ITEMS, s.rules);
    expect(() => bare.stateOf(s.world, 'hunter')).toThrow(/pass LootTables/);
    expect(() => s.shops.stateOf(s.world, 'nobody')).toThrow(/not defined/);
    const odd = new Shops(
      [{ ...smith, stock: [{ item: { id: 'ghost' }, count: 1 }] }],
      ITEMS,
      s.rules,
    );
    expect(() => odd.stateOf(s.world, 'smith')).toThrow(/item "ghost"/);
    expect(() => new Shops([smith, smith], ITEMS, s.rules)).toThrow(/defined twice/);
  });

  it('throws for an actor without an inventory', () => {
    const s = setup();
    const bare = s.world.spawn();
    expect(() => s.shops.buy(s.world, bare, 'smith', 1)).toThrow(/no inventory/);
    expect(() => s.shops.sell(s.world, bare, 'smith', 1)).toThrow(/no inventory/);
  });

  it('prices through the model, including the options a caller passes', () => {
    const s = setup(1000);
    expect(s.shops.quote('smith', 'buy', 'sword', {}, { haggleModifier: 0.1 })).toMatchObject({
      price: 72,
    });
    const sword = lineOf(s, 'smith', 'sword');
    expect(s.shops.buy(s.world, s.actor, 'smith', sword, 1, { haggleModifier: 0.1 })).toMatchObject(
      {
        unitPrice: 72,
      },
    );
  });

  it('AC-5: 1,000 seeded random buy/sell/buyback sequences conserve gold and item count', () => {
    const outcomes = { bought: 0, sold: 0, boughtBack: 0, refused: 0 };
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = Rng.create(seed).stream('shop-fuzz');
      const world = new World({ seed });
      const actor = world.spawn();
      const start = rng.int(0, 600);
      addInventory(world, actor, start);
      const rules = new InventoryRules(ITEMS, { goldMax: 2000 });
      const shops = new Shops(MERCHANTS, ITEMS, rules, new LootTables([PACK], ITEMS));
      for (const id of [
        'sword',
        'apple',
        'apple',
        'dagger',
        'gem',
        'idol',
        'book',
        'bell-tongue',
      ]) {
        const unique = id === 'idol' || id === 'bell-tongue';
        rules.add(
          world,
          actor,
          id,
          unique ? 1 : rng.int(1, 4),
          rng.chance(0.3) ? { stolen: true } : {},
        );
      }
      const merchantIds = MERCHANTS.map((m) => m.id);
      const totals = () => {
        let gold = inventoryOf(world, actor)?.gold ?? 0;
        let units = rules.count(world, actor);
        for (const id of merchantIds) {
          const state = shops.stateOf(world, id);
          gold += state.gold;
          units += state.stock.reduce((n, l) => n + l.count, 0);
          units += state.buyback.reduce((n, e) => n + e.count, 0);
        }
        return { gold, units };
      };
      const before = totals();
      for (let op = 0; op < 25; op++) {
        const merchant = rng.pick(merchantIds);
        const state = shops.stateOf(world, merchant);
        const roll = rng.float();
        let ok: boolean;
        if (roll < 0.4 && state.stock.length > 0) {
          const line = rng.pick(state.stock);
          ok = shops.buy(world, actor, merchant, line.id, rng.int(1, line.count + 1)).ok;
          outcomes.bought += Number(ok);
        } else if (roll < 0.8) {
          const held = rules.query(world, actor);
          const inst = held.length === 0 ? undefined : rng.pick(held);
          ok = shops.sell(
            world,
            actor,
            merchant,
            inst?.instanceId ?? 0,
            rng.int(1, (inst?.count ?? 1) + 1),
          ).ok;
          outcomes.sold += Number(ok);
        } else if (roll < 0.97 && state.buyback.length > 0) {
          const entry = rng.pick(state.buyback);
          ok = shops.buyBack(world, actor, merchant, entry.id, rng.int(1, entry.count)).ok;
          outcomes.boughtBack += Number(ok);
        } else {
          shops.clearBuyback(world, merchant);
          ok = true;
        }
        outcomes.refused += Number(!ok);
        expect(totals(), `seed ${String(seed)} op ${String(op)}`).toEqual(before);
      }
    }
    for (const [what, n] of Object.entries(outcomes)) expect(n, what).toBeGreaterThan(0);
  });
});

describe('merchant services: a room for the night (mw-ju8.6)', () => {
  /** A hurt, tired player who has gold and a day clock at 21:00, ready to rent a room. */
  function inn(gold = 100) {
    const s = setup(gold);
    for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) s.world.facts.declare(key, spec);
    s.world.register(...DAMAGE_COMPONENTS, StaminaComponent);
    giveCombatant(s.world, s.actor, { health: 80 });
    s.world.set(s.actor, HealthComponent, { max: 80, current: 20 });
    giveStamina(s.world, s.actor);
    const clock = factDayClock(s.world.facts);
    clock.set({ day: 1, minute: 21 * 60 });
    const bought: ServiceTransaction[] = [];
    const rests: RestCompleted[] = [];
    s.world.events.on(shopServiceBought, (e) => bought.push(e));
    s.world.events.on(restCompleted, (e) => rests.push(e));
    const state = () =>
      JSON.stringify([
        inventoryOf(s.world, s.actor),
        s.shops.stateOf(s.world, 'inn'),
        clock.now(),
        s.world.get(s.actor, HealthComponent),
      ]);
    return { ...s, clock, bought, rests, state };
  }

  it('AC-1: with enough gold, buying the room costs its price, passes time to morning and heals fully', () => {
    const s = inn(100);
    const result = s.shops.buyService(s.world, s.actor, 'inn', 'room');
    expect(result).toMatchObject({ ok: true, price: 12, rest: { hours: 9 } });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(88);
    expect(s.shops.stateOf(s.world, 'inn').gold).toBe(62);
    expect(s.clock.now()).toEqual({ day: 2, minute: MORNING_MINUTE });
    expect(s.world.get(s.actor, HealthComponent)).toEqual({ max: 80, current: 80 });
    s.world.events.flush();
    expect(s.bought).toEqual([
      { tick: 0, actor: s.actor, merchantId: 'inn', serviceId: 'room', kind: 'rest', price: 12 },
    ]);
    expect(s.rests).toMatchObject([{ kind: 'inn', hours: 9, point: 'inn' }]);
  });

  it('AC-2: with too little gold the purchase is refused and nothing changes', () => {
    const s = inn(11);
    const before = s.state();
    expect(s.shops.buyService(s.world, s.actor, 'inn', 'room')).toEqual({
      ok: false,
      reason: 'cannot-afford',
    });
    expect(s.state()).toBe(before);
    s.world.events.flush();
    expect(s.bought).toEqual([]);
    expect(s.rests).toEqual([]);
  });

  it('an unsafe verdict refuses the room with the reason and charges nothing', () => {
    const s = inn(100);
    const before = s.state();
    expect(
      s.shops.buyService(s.world, s.actor, 'inn', 'room', { safety: () => 'enemies nearby' }),
    ).toEqual({ ok: false, reason: 'unsafe', detail: 'enemies nearby' });
    expect(s.state()).toBe(before);
    s.world.events.flush();
    expect(s.rests).toEqual([]);
  });

  it('a service the merchant does not offer is refused (stale id, or no services at all)', () => {
    const s = inn(100);
    const before = s.state();
    expect(s.shops.buyService(s.world, s.actor, 'inn', 'nope')).toEqual({
      ok: false,
      reason: 'no-such-service',
    });
    expect(s.shops.buyService(s.world, s.actor, 'smith', 'room')).toEqual({
      ok: false,
      reason: 'no-such-service',
    });
    expect(s.state()).toBe(before);
  });
});

describe('merchant services: a trainer sells lessons (mw-ju8.13)', () => {
  const trainer: ShopMerchantDef = {
    id: 'college',
    buysCategories: [],
    goldReserve: 0,
    markup: 1,
    buyRate: 0.5,
    stock: [],
    services: [
      { id: 'riposte', name: 'Riposte', price: 150, kind: 'train', teaches: 'technique.riposte' },
      { id: 'disarm', name: 'Disarm', price: 400, kind: 'train', teaches: 'technique.disarm' },
      { id: 'bed', name: 'A bed', price: 10, kind: 'rest' },
      { id: 'bad', name: 'No capability', price: 10, kind: 'train' },
    ],
  };

  function school(gold: number) {
    const world = new World({ seed: 7 });
    const actor = world.spawn();
    addInventory(world, actor, gold);
    const registry = new CapabilityRegistry([
      'technique.parry',
      'technique.riposte',
      'technique.disarm',
    ]);
    addCapabilities(world, actor);
    registry.grant(world, actor, 'technique.parry', 'class');
    const book = new UnlockBook(registry, [
      {
        capability: 'technique.riposte',
        prerequisites: ['technique.parry'],
        channels: ['trainer'],
      },
      {
        capability: 'technique.disarm',
        prerequisites: ['technique.riposte'],
        channels: ['trainer'],
      },
    ]);
    const shops = new Shops([trainer], ITEMS, new InventoryRules(ITEMS));
    const bought: ServiceTransaction[] = [];
    world.events.on(shopServiceBought, (e) => bought.push(e));
    return { world, actor, book, shops, bought, registry };
  }

  it('AC-1: with enough crowns the lesson teaches the technique and takes its price', () => {
    const s = school(200);
    expect(s.shops.train(s.world, s.actor, 'college', 'riposte', s.book)).toEqual({
      ok: true,
      price: 150,
      capability: 'technique.riposte',
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(50);
    expect(s.shops.stateOf(s.world, 'college').gold).toBe(150);
    expect(s.book.knows(s.world, s.actor, 'technique.riposte')).toBe(true);
    s.world.events.flush();
    expect(s.bought).toEqual([
      {
        tick: 0,
        actor: s.actor,
        merchantId: 'college',
        serviceId: 'riposte',
        kind: 'train',
        price: 150,
      },
    ]);
  });

  it('too few crowns refuses the lesson and teaches nothing', () => {
    const s = school(149);
    expect(s.shops.train(s.world, s.actor, 'college', 'riposte', s.book)).toEqual({
      ok: false,
      reason: 'cannot-afford',
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(149);
    expect(s.book.knows(s.world, s.actor, 'technique.riposte')).toBe(false);
  });

  it('a technique whose prerequisite is unknown is refused with the reasons and charges nothing', () => {
    const s = school(1000);
    const result = s.shops.train(s.world, s.actor, 'college', 'disarm', s.book);
    expect(result).toEqual({
      ok: false,
      reason: 'refused',
      refusals: [{ reason: 'missing-prerequisite', capability: 'technique.riposte' }],
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(1000);
  });

  it('a technique already known is not sold twice', () => {
    const s = school(1000);
    s.shops.train(s.world, s.actor, 'college', 'riposte', s.book);
    expect(s.shops.train(s.world, s.actor, 'college', 'riposte', s.book)).toEqual({
      ok: false,
      reason: 'already-known',
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(850);
  });

  it('only train services with a capability are lessons, and a lesson is not a room', () => {
    const s = school(1000);
    for (const id of ['bed', 'bad', 'nope']) {
      expect(s.shops.train(s.world, s.actor, 'college', id, s.book)).toEqual({
        ok: false,
        reason: 'no-such-lesson',
      });
    }
    expect(s.shops.buyService(s.world, s.actor, 'college', 'riposte')).toEqual({
      ok: false,
      reason: 'no-such-service',
    });
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(1000);
  });
});

describe('merchant services: a spell lesson (mw-ju8.14)', () => {
  const teacher: ShopMerchantDef = {
    id: 'bridge',
    buysCategories: [],
    goldReserve: 0,
    markup: 1,
    buyRate: 0.5,
    stock: [],
    services: [{ id: 'ember', name: 'Ember', price: 200, kind: 'train', teaches: 'spell.ember' }],
  };

  function lesson(withMagic: boolean) {
    const world = new World({ seed: 7 });
    if (withMagic) world.register(...MAGIC_COMPONENTS);
    const actor = world.spawn();
    addInventory(world, actor, 250);
    const registry = new CapabilityRegistry(['spell.ember']);
    addCapabilities(world, actor);
    const book = new UnlockBook(registry, [
      { capability: 'spell.ember', prerequisites: [], channels: ['trainer'] },
    ]);
    const shops = new Shops([teacher], ITEMS, new InventoryRules(ITEMS));
    return { world, actor, book, shops };
  }

  it('AC-2: paying for Ember teaches the capability and puts the spell on the known list', () => {
    const s = lesson(true);
    expect(s.shops.train(s.world, s.actor, 'bridge', 'ember', s.book)).toEqual({
      ok: true,
      price: 200,
      capability: 'spell.ember',
    });
    expect(s.book.knows(s.world, s.actor, 'spell.ember')).toBe(true);
    expect(knowsSpell(s.world, s.actor, 'ember')).toBe(true);
    expect(inventoryOf(s.world, s.actor)?.gold).toBe(50);
  });

  it('AC-2: a world without the spell pipeline still learns the capability', () => {
    const s = lesson(false);
    expect(s.shops.train(s.world, s.actor, 'bridge', 'ember', s.book).ok).toBe(true);
    expect(s.book.knows(s.world, s.actor, 'spell.ember')).toBe(true);
    expect(s.world.isRegistered(KnownSpellsComponent)).toBe(false);
  });
});
