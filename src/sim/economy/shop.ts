// Merchant transactions (mw-e20.4): the player buys from, sells to and buys back from a merchant
// whose stock and gold are finite and remembered (docs/design/economy.md). `Shops` holds the merchant
// definitions and item definitions one game plays with; every transaction prices through `price()`
// (src/sim/economy/price.ts) and is atomic: it checks everything first, and on any failure returns a
// typed reason and changes nothing (expected failures never throw). Gold and items only move, never
// appear or vanish: a buy moves gold player -> merchant and units shelf -> pack, a sell the reverse
// with the units going to the buyback list, and the oldest buyback entry falls onto the shelf when
// the list is full (or when `clearBuyback` runs, the same step restocking takes).
//
// State: per merchant id, created the first time the merchant is touched from its definition (gold
// reserve and stock; a loot-table entry is rolled once with a stream derived from the world seed and
// the merchant id, so the result does not depend on the order shops are visited) and held in the
// world's merchant store (shop-state.ts), saved by the `merchants` section. Currency is `gold`.
// Events: `shop.bought`, `shop.sold`, `shop.bought-back`. Restocking is restock.ts (mw-e20.5). Out of scope: haggling (the
// caller passes a modifier), theft and dispositions (the caller passes a band).

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { equipmentOf } from '../inventory/equipment';
import {
  inventoryOf,
  type InventoryItemDef,
  type InventoryState,
  type InventoryRules,
  type ItemInstanceFlags,
} from '../inventory/inventory';
import type { LootTables } from '../loot/tables';
import { SpellLearning } from '../magic/learning';
import { Rng } from '../rng';
import {
  restBlocked,
  restCompleted,
  restUntilMorning,
  type RestOptions,
  type RestResult,
} from '../rest/rest';
import type { LearnRefusal, UnlockBook } from '../progression/unlocks';
import { price, type PriceInput, type PriceRefusal, type PriceResult } from './price';
import type { Condition } from '../facts/conditions';
import { DAY_FACT } from '../rest/day-clock';
import { openGatedStock, restockMerchant, type RestockDeps } from './restock';
import {
  BUYBACK_LIMIT,
  merchantStoreOf,
  shelve,
  type BuybackEntry,
  type MerchantState,
} from './shop-state';

/** Whether an equipment slot references pack instance `instanceId`. */
export function isEquipped(world: World, actor: EntityId, instanceId: number): boolean {
  const slots = equipmentOf(world, actor)?.slots;
  return slots !== undefined && Object.values(slots).some((ref) => ref?.instanceId === instanceId);
}

/** What shops read of an item definition: the inventory's view plus value and the no-sell flag. */
export interface ShopItemDef extends InventoryItemDef {
  /** Base value in gold. */
  readonly value: number;
  readonly flags: InventoryItemDef['flags'] & { readonly noSell?: boolean | undefined };
}

/** Capabilities that mean a spell are `spell.<id>` (src/content/data/capability/spells.json). */
const SPELL_CAPABILITY_PREFIX = 'spell.';

/** A service a merchant sells at a fixed price (mw-ju8.6; trainers and more follow in mw-e20.9). */
export interface ShopServiceDef {
  readonly id: string;
  readonly name: string;
  /** Whole gold, fixed by the merchant: no markup, disposition or haggle applies. */
  readonly price: number;
  /** `rest`: a room for the night (sleep until morning). `train`: a lesson (`teaches` a capability). */
  readonly kind: 'rest' | 'train';
  /** The capability a `train` service teaches (mw-ju8.13); absent for a `rest` service. */
  readonly teaches?: string | undefined;
}

/** What shops read of a merchant definition (a loaded `MerchantDef` is one). */
export interface ShopMerchantDef {
  readonly id: string;
  readonly buysCategories: readonly string[];
  readonly specialties?: readonly string[] | undefined;
  readonly goldReserve: number;
  /** Gold the till refills by each world day, up to `goldReserve` (mw-e20.5); absent = none. */
  readonly goldRestockPerDay?: number | undefined;
  readonly markup?: number | undefined;
  readonly buyRate?: number | undefined;
  readonly specialtyBonus?: number | undefined;
  readonly isFence?: boolean | undefined;
  readonly buysStolen?: boolean | undefined;
  readonly stolenFactor?: number | undefined;
  /** Services on offer (a room for the night); absent or empty = none. */
  readonly services?: readonly ShopServiceDef[] | undefined;
  readonly stock: readonly {
    readonly item?: { readonly id: string } | undefined;
    readonly lootTable?: { readonly id: string } | undefined;
    readonly count: number;
    /** Refill rule (mw-e20.5): `amount` per `everyHours` (rounded up to days), up to `count`. */
    readonly restock?: { readonly everyHours: number; readonly amount: number } | undefined;
    /** The entry is absent until this world-fact condition holds (mw-e20.5). */
    readonly when?: Condition | undefined;
  }[];
}

/** Things the caller may pass to the price model for a transaction. */
export type ShopPriceOptions = Pick<PriceInput, 'disposition' | 'haggleModifier' | 'worldFacts'>;

/** Why a buy failed. */
export type BuyFailure =
  /** The stock line is not on the shelf (stale id). */
  | 'no-such-item'
  /** Fewer units on the shelf than asked for (including none). */
  | 'out-of-stock'
  | 'cannot-afford'
  /** The pack refused the item (unit guard, a second unique). */
  | 'cannot-carry'
  /** The price model refused (a hostile merchant). */
  | PriceRefusal;

/** Why a sell failed. */
export type SellFailure =
  /** The player holds no such instance. */
  | 'no-such-item'
  /** The instance holds fewer units than asked for. */
  | 'not-enough'
  | 'merchant-cannot-afford'
  /** The units are worn or held in an equipment slot: unequip first (a slot would dangle). */
  | 'equipped'
  /** The payment would take the player's gold past the cap (so gold would be lost). */
  | 'gold-cap'
  | PriceRefusal;

/** Why a buyback failed. */
export type BuyBackFailure = BuyFailure;

export type BuyResult =
  | { readonly ok: true; readonly unitPrice: number; readonly total: number }
  | { readonly ok: false; readonly reason: BuyFailure };
export type SellResult =
  | { readonly ok: true; readonly unitPrice: number; readonly total: number }
  | { readonly ok: false; readonly reason: SellFailure };
export type BuyBackResult = BuyResult;

/** Payload shared by the three shop events. */
export interface ShopTransaction {
  readonly tick: number;
  readonly actor: EntityId;
  readonly merchantId: string;
  readonly defId: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
  /** Whole gold per unit. */
  readonly unitPrice: number;
  /** Gold that changed hands. */
  readonly total: number;
}

export const shopBought = defineEvent<ShopTransaction>('shop.bought');
export const shopSold = defineEvent<ShopTransaction>('shop.sold');
export const shopBoughtBack = defineEvent<ShopTransaction>('shop.bought-back');

/** Payload of `shop.service-bought`. */
export interface ServiceTransaction {
  readonly tick: number;
  readonly actor: EntityId;
  readonly merchantId: string;
  readonly serviceId: string;
  readonly kind: ShopServiceDef['kind'];
  /** Gold that changed hands. */
  readonly price: number;
}

export const shopServiceBought = defineEvent<ServiceTransaction>('shop.service-bought');

/** Why a service purchase failed. */
export type ServiceFailure =
  /** The merchant does not offer that service (stale id). */
  | 'no-such-service'
  | 'cannot-afford'
  /** Resting was vetoed (hostiles about); `detail` says why. */
  | 'unsafe';

export type ServiceResult =
  | {
      readonly ok: true;
      readonly price: number;
      /** The rest it bought (a `rest` service). */
      readonly rest: Extract<RestResult, { ok: true }>;
    }
  | { readonly ok: false; readonly reason: ServiceFailure; readonly detail?: string };

/** Why a lesson could not be bought. */
export type TrainFailure =
  /** The merchant does not offer that service (stale id), or it is not a lesson. */
  | 'no-such-lesson'
  /** The player already knows the technique: nothing is charged. */
  | 'already-known'
  /** The unlock rules refuse (a missing prerequisite, say): nothing is charged. */
  | 'refused'
  | 'cannot-afford';

export type TrainResult =
  | { readonly ok: true; readonly price: number; readonly capability: string }
  | {
      readonly ok: false;
      readonly reason: TrainFailure;
      /** Every reason the unlock rules gave, for `refused`. */
      readonly refusals?: readonly LearnRefusal[];
    };

/** What a service purchase needs besides the merchant: how and whether it is safe to rest. */
export type ServiceOptions = Pick<RestOptions, 'clock' | 'safety' | 'pools'>;

/** Name of the seed-derived stream a merchant's loot-table stock is rolled with. */
export const shopStockStream = (merchantId: string): string => `shop.stock.${merchantId}`;

const failure = <R extends string>(reason: R) => ({ ok: false, reason }) as const;

/** Takes `count` units off a shelf line (the line goes when it empties). */
function unshelve(state: MerchantState, lineId: number, count: number): MerchantState {
  const stock = state.stock.flatMap((line) =>
    line.id !== lineId
      ? [line]
      : line.count === count
        ? []
        : [{ ...line, count: line.count - count }],
  );
  return { ...state, stock };
}

export class Shops {
  readonly #merchants: ReadonlyMap<string, ShopMerchantDef>;
  readonly #items: ReadonlyMap<string, ShopItemDef>;
  readonly #rules: InventoryRules;
  readonly #loot: LootTables | undefined;

  /**
   * `merchants` and `items`: every definition (the content registry's); ids must be unique. `rules`
   * is the inventory rules the player's pack goes through. `loot` is needed only when a merchant's
   * stock names a loot table.
   */
  constructor(
    merchants: Iterable<ShopMerchantDef>,
    items: Iterable<ShopItemDef>,
    rules: InventoryRules,
    loot?: LootTables,
  ) {
    this.#merchants = byId(merchants, 'merchant');
    this.#items = byId(items, 'item');
    this.#rules = rules;
    this.#loot = loot;
  }

  /**
   * A merchant's runtime state, created from its definition on first use (gold reserve, authored
   * stock, loot tables rolled once). The returned value is a snapshot; do not keep it across calls.
   * @throws RangeError for an unknown merchant, or a loot-table stock entry without `loot`.
   */
  stateOf(world: World, merchantId: string): MerchantState {
    const store = merchantStoreOf(world);
    const existing = store.get(merchantId);
    if (existing === undefined) {
      const created = this.#create(world, this.#merchant(merchantId));
      store.set(merchantId, created);
      return created;
    }
    // Catch up days that passed while the merchant was not looked at (a long sleep, an old save).
    const day = this.#day(world);
    if (existing.restockedDay !== undefined && existing.restockedDay >= day) return existing;
    const caught = restockMerchant(existing, this.#merchant(merchantId), day, this.#deps(world));
    store.set(merchantId, caught);
    return caught;
  }

  /**
   * Restocks every merchant that has state to world `day` (mw-e20.5; rules in restock.ts). Call it
   * whenever the day advances: the game does on `rest.completed`, and mw-e27.12's clock will on its
   * day tick. Running it twice for a day changes nothing the second time; several days at once
   * apply every one of them. Merchants never touched are untouched: they start fresh later.
   */
  restock(world: World, day: number): void {
    const store = merchantStoreOf(world);
    const deps = this.#deps(world);
    for (const [id, state] of Object.entries(store.capture())) {
      const def = this.#merchants.get(id);
      if (def === undefined) continue;
      store.set(id, restockMerchant(state, def, day, deps));
    }
  }

  /**
   * Restocks the shops whenever a rest ends on a new day (`rest.completed`; mw-e20.5), so sleeping
   * refills the tills and shelves. Returns the unsubscribe function.
   */
  restockOnRest(world: World): () => void {
    return world.events.on(restCompleted, ({ wakes }) => {
      this.restock(world, wakes.day);
    });
  }

  /** The price of one unit of `defId` in `direction` (what a UI shows), or the refusal. */
  quote(
    merchantId: string,
    direction: PriceInput['direction'],
    defId: string,
    flags: ItemInstanceFlags = {},
    options: ShopPriceOptions = {},
  ): PriceResult {
    return price({
      item: this.#item(defId),
      instance: { flags },
      merchant: this.#merchant(merchantId),
      direction,
      ...options,
    });
  }

  /**
   * The player buys `count` units of shelf line `lineId`. Needs stock and gold; the units arrive in
   * the actor's pack with the line's flags.
   * @throws RangeError for an unknown merchant or an actor without an inventory.
   */
  buy(
    world: World,
    actor: EntityId,
    merchantId: string,
    lineId: number,
    count = 1,
    options: ShopPriceOptions = {},
  ): BuyResult {
    const state = this.stateOf(world, merchantId);
    const line = state.stock.find((l) => l.id === lineId);
    if (line === undefined) return failure('no-such-item');
    if (line.count < count) return failure('out-of-stock');
    const quoted = this.quote(merchantId, 'buy', line.defId, line.flags, options);
    if (!quoted.ok) return failure(quoted.refused);
    return this.#take(
      world,
      actor,
      merchantId,
      state,
      quoted.price,
      count,
      line,
      shopBought,
      unshelve(state, lineId, count),
    );
  }

  /**
   * The player buys back `count` units of buyback entry `entryId` at the price the merchant paid.
   * @throws RangeError for an unknown merchant or an actor without an inventory.
   */
  buyBack(
    world: World,
    actor: EntityId,
    merchantId: string,
    entryId: number,
    count?: number,
  ): BuyBackResult {
    const state = this.stateOf(world, merchantId);
    const entry = state.buyback.find((e) => e.id === entryId);
    if (entry === undefined) return failure('no-such-item');
    const units = count ?? entry.count;
    if (entry.count < units) return failure('out-of-stock');
    const buyback = state.buyback.flatMap((e) =>
      e.id !== entryId ? [e] : e.count === units ? [] : [{ ...e, count: e.count - units }],
    );
    return this.#take(
      world,
      actor,
      merchantId,
      state,
      entry.unitPrice,
      units,
      entry,
      shopBoughtBack,
      {
        ...state,
        buyback,
      },
    );
  }

  /**
   * The player sells `count` units of pack instance `instanceId`. The merchant must buy the
   * category, not refuse the item (`stolen`, `quest-item`, ...) and carry the gold; the units go to
   * the buyback list at the price paid.
   * @throws RangeError for an unknown merchant or an actor without an inventory.
   */
  sell(
    world: World,
    actor: EntityId,
    merchantId: string,
    instanceId: number,
    count = 1,
    options: ShopPriceOptions = {},
  ): SellResult {
    const state = this.stateOf(world, merchantId);
    const pack = this.#pack(world, actor);
    const instance = pack.items.find((i) => i.instanceId === instanceId);
    if (instance === undefined) return failure('no-such-item');
    if (instance.count < count) return failure('not-enough');
    if (count >= instance.count && isEquipped(world, actor, instanceId)) return failure('equipped');
    const quoted = this.quote(merchantId, 'sell', instance.defId, instance.flags, options);
    if (!quoted.ok) return failure(quoted.refused);
    const unitPrice = quoted.price;
    const total = unitPrice * count;
    if (state.gold < total) return failure('merchant-cannot-afford');
    if (pack.gold + total > this.#rules.goldMax) return failure('gold-cap');
    // Every check has passed, so the removal and payment below cannot fail.
    this.#rules.remove(world, actor, { instanceId, count });
    this.#rules.addGold(world, actor, total);
    const entry: BuybackEntry = {
      id: state.nextId,
      defId: instance.defId,
      count,
      flags: instance.flags,
      unitPrice,
    };
    let next: MerchantState = {
      ...state,
      gold: state.gold - total,
      nextId: state.nextId + 1,
      buyback: [...state.buyback, entry],
    };
    while (next.buyback.length > BUYBACK_LIMIT) next = this.#evictOldest(next);
    merchantStoreOf(world).set(merchantId, next);
    world.events.emit(shopSold, {
      tick: world.tick,
      actor,
      merchantId,
      defId: instance.defId,
      count,
      flags: instance.flags,
      unitPrice,
      total,
    });
    return { ok: true, unitPrice, total };
  }

  /**
   * The player buys service `serviceId` (a room for the night: sleep until morning, fully rested).
   * Checks first and changes nothing on a failure: refused as `unsafe` when the safety verdict
   * objects, `cannot-afford` when short of gold. The merchant keeps the gold; the rest then runs
   * (src/sim/rest/rest.ts) and emits `rest.completed` after `shop.service-bought`.
   * @throws RangeError for an unknown merchant or an actor without an inventory.
   */
  buyService(
    world: World,
    actor: EntityId,
    merchantId: string,
    serviceId: string,
    options: ServiceOptions = {},
  ): ServiceResult {
    const state = this.stateOf(world, merchantId);
    const service = this.#merchant(merchantId).services?.find((s) => s.id === serviceId);
    if (service?.kind !== 'rest') return failure('no-such-service');
    const detail = restBlocked(options);
    if (detail !== null) return { ok: false, reason: 'unsafe', detail };
    if (this.#pack(world, actor).gold < service.price) return failure('cannot-afford');
    this.#rules.spendGold(world, actor, service.price);
    merchantStoreOf(world).set(merchantId, { ...state, gold: state.gold + service.price });
    world.events.emit(shopServiceBought, {
      tick: world.tick,
      actor,
      merchantId,
      serviceId,
      kind: service.kind,
      price: service.price,
    });
    // The safety verdict was just taken, so the rest cannot be refused.
    const rest = restUntilMorning(world, actor, {
      ...options,
      kind: 'inn',
      point: merchantId,
    }) as Extract<RestResult, { ok: true }>;
    return { ok: true, price: service.price, rest };
  }

  /**
   * The player pays a trainer for a lesson (mw-ju8.13, ADR-0004 trainer channel): service `serviceId`
   * of kind `train` teaches its capability through channel `trainer:<merchant id>`. Everything is
   * checked first (the unlock rules, then the crowns), so a refusal charges nothing and teaches
   * nothing; on success the merchant keeps the crowns, the capability is learned for good and
   * `shop.service-bought` is emitted (kind `train`).
   * @throws RangeError for an unknown merchant or an actor without an inventory.
   */
  train(
    world: World,
    actor: EntityId,
    merchantId: string,
    serviceId: string,
    unlocks: UnlockBook,
  ): TrainResult {
    const state = this.stateOf(world, merchantId);
    const service = this.#merchant(merchantId).services?.find((s) => s.id === serviceId);
    const capability = service?.kind === 'train' ? service.teaches : undefined;
    if (service === undefined || capability === undefined) return failure('no-such-lesson');
    const channel = `trainer:${merchantId}`;
    const check = unlocks.check(world, actor, capability, channel);
    if (check.status === 'already-known') return failure('already-known');
    if (check.status === 'refused') {
      return { ok: false, reason: 'refused', refusals: check.refusals };
    }
    if (this.#pack(world, actor).gold < service.price) return failure('cannot-afford');
    this.#rules.spendGold(world, actor, service.price);
    merchantStoreOf(world).set(merchantId, { ...state, gold: state.gold + service.price });
    if (capability.startsWith(SPELL_CAPABILITY_PREFIX)) {
      // A spell lesson goes through the one door every teacher uses (mw-e07.13): the spell becomes
      // known, `spell.<id>` is granted through the unlock book and `SpellLearned {source: trainer}` fires.
      new SpellLearning({ unlocks }).learn(
        world,
        actor,
        capability.slice(SPELL_CAPABILITY_PREFIX.length),
        channel,
        channel,
      );
    } else {
      unlocks.learn(world, actor, capability, channel);
    }
    world.events.emit(shopServiceBought, {
      tick: world.tick,
      actor,
      merchantId,
      serviceId,
      kind: 'train',
      price: service.price,
    });
    return { ok: true, price: service.price, capability };
  }

  /**
   * Ends the buyback window (the restock hook): every buyback entry goes onto the shelf. Returns
   * the units moved.
   * @throws RangeError for an unknown merchant.
   */
  clearBuyback(world: World, merchantId: string): number {
    let state = this.stateOf(world, merchantId);
    let moved = 0;
    for (const entry of state.buyback) {
      state = shelve(state, entry.defId, entry.count, entry.flags, null);
      moved += entry.count;
    }
    merchantStoreOf(world).set(merchantId, { ...state, buyback: [] });
    return moved;
  }

  /** Shared tail of buy and buyBack: the player pays `unitPrice` x `count` for units of `source`. */
  #take(
    world: World,
    actor: EntityId,
    merchantId: string,
    state: MerchantState,
    unitPrice: number,
    count: number,
    source: { readonly defId: string; readonly flags: ItemInstanceFlags },
    event: typeof shopBought,
    next: MerchantState,
  ): BuyResult {
    const total = unitPrice * count;
    if (this.#pack(world, actor).gold < total) return failure('cannot-afford');
    // The pack may refuse (unit guard, a second unique); it changes nothing when it does.
    const added = this.#rules.add(world, actor, source.defId, count, source.flags);
    if (!added.ok) return failure('cannot-carry');
    this.#rules.spendGold(world, actor, total);
    merchantStoreOf(world).set(merchantId, { ...next, gold: state.gold + total });
    world.events.emit(event, {
      tick: world.tick,
      actor,
      merchantId,
      defId: source.defId,
      count,
      flags: source.flags,
      unitPrice,
      total,
    });
    return { ok: true, unitPrice, total };
  }

  #pack(world: World, actor: EntityId): InventoryState {
    const pack = inventoryOf(world, actor);
    if (pack === undefined) {
      throw new RangeError(`entity ${String(actor)} has no inventory: call addInventory`);
    }
    return pack;
  }

  #evictOldest(state: MerchantState): MerchantState {
    const [oldest, ...rest] = state.buyback as [BuybackEntry, ...BuybackEntry[]];
    return shelve({ ...state, buyback: rest }, oldest.defId, oldest.count, oldest.flags, null);
  }

  #day(world: World): number {
    return Number(world.facts.get(DAY_FACT) ?? 1);
  }

  #deps(world: World): RestockDeps {
    const loot = this.#loot;
    return {
      facts: world.facts,
      stream: (name) => Rng.create(world.seed).stream(name),
      roll: (tableId, rolls, rng) => {
        if (loot === undefined) {
          throw new RangeError(`a merchant stocks loot table "${tableId}": pass LootTables`);
        }
        const units = new Map<string, number>();
        for (let roll = 0; roll < rolls; roll++) {
          for (const { item, count } of loot.roll(tableId, rng, { facts: world.facts }).stacks) {
            units.set(item, (units.get(item) ?? 0) + count);
          }
        }
        return units;
      },
    };
  }

  #create(world: World, def: ShopMerchantDef): MerchantState {
    let state: MerchantState = {
      gold: def.goldReserve,
      nextId: 1,
      stock: [],
      buyback: [],
      restockedDay: this.#day(world),
    };
    const deps = this.#deps(world);
    const rng = Rng.create(world.seed).stream(shopStockStream(def.id));
    def.stock.forEach((entry, index) => {
      if (entry.when !== undefined) return; // gated entries open below, from their own streams
      if (entry.item !== undefined) {
        this.#item(entry.item.id);
        state = shelve(state, entry.item.id, entry.count, {}, index);
        return;
      }
      const tableId = (entry.lootTable as { readonly id: string }).id;
      for (const [item, count] of deps.roll(tableId, entry.count, rng)) {
        state = shelve(state, item, count, {}, index);
      }
    });
    return openGatedStock(state, def, deps);
  }

  #merchant(id: string): ShopMerchantDef {
    const def = this.#merchants.get(id);
    if (def === undefined) throw new RangeError(`merchant "${id}" is not defined`);
    return def;
  }

  #item(id: string): ShopItemDef {
    const def = this.#items.get(id);
    if (def === undefined) throw new RangeError(`item "${id}" is not defined`);
    return def;
  }
}

function byId<T extends { readonly id: string }>(
  defs: Iterable<T>,
  what: string,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const def of defs) {
    if (map.has(def.id)) throw new RangeError(`${what} "${def.id}" is defined twice`);
    map.set(def.id, def);
  }
  return map;
}
