// The shop screen in the game (mw-e20.10): the glue between the sim's `Shops` engine
// (src/sim/economy/shop.ts), content's merchants and items, and the UI's shop window
// (src/ui/shop-window.ts).
//
// - `ShopViews` derives the window's model: the merchant's name and greeting, the player's crowns,
//   and the Buy, Sell and Buyback rows with prices, the tooltip's price steps (from `quote()`), the
//   specialty badge, the stolen marker, the refusal a merchant gives an item, and, for equipment,
//   how it compares with what the player has equipped.
// - `ShopController` opens the window when the player talks to a counter (an interactable whose
//   scene spawn is tagged `merchant:<merchant id>` and whose affordance is `talk`), after the step
//   that did it, or by `open(merchantId)`. A deal is done at once with `Shops` (the sim is paused
//   while the screen is open, so there is no step to queue it for); the engine's own events
//   (`shop.bought`, `shop.sold`, `shop.bought-back`) report it. The window refreshes after every
//   deal and step, and says the outcome (or the refusal) on its status line.
// - A counter tagged `dev-crowns:<n>` tops the player up to `n` crowns the first time it opens (the
//   grey-box shop room, so a fresh player can trade).
// - `startShopUi` wires it into a running game and publishes `#app[data-shop]` (JSON: whether the
//   shop is open, the merchant and the player's crowns) for the e2e.
// - Services (mw-ju8.6): the Services tab lists the merchant's `services`; booking "a room for the
//   night" runs `Shops.buyService` (pay, sleep until morning, fully rested; refused when short of
//   crowns or when a safety veto objects), closes the shop and shows "You sleep until morning." as a
//   toast. `rest.completed` is published as `#app[data-rest]` for the e2e; the game's autosave hears
//   the same event (src/game/save/autosave/game.ts) and writes a `rest` autosave.

import type { GameContent, ItemEntry } from '@content/index';
import {
  equipmentOf,
  interacted,
  InventoryRules,
  inventoryOf,
  LootTables,
  restCompleted,
  SceneSpawnComponent,
  isEquipped,
  Shops,
  type BuyFailure,
  type EntityId,
  type MerchantState,
  type PriceRefusal,
  type PriceResult,
  type LearnRefusal,
  type UnlockBook,
  type PriceStep,
  type SellFailure,
  type ServiceFailure,
  type TrainFailure,
  type ShopServiceDef,
  type World,
} from '@sim/index';
import {
  crownsText,
  openShopWindow,
  ToastHost,
  type ShopDeal,
  type ShopModel,
  type ShopRowModel,
  type ShopWindow,
  type UiRoot,
} from '@ui/index';
import { itemLabel } from '../classes';
import { ICON_KIND, itemName } from '../items/inventory-screen';

/** The content the shop reads. */
export type ShopContent = Pick<GameContent, 'all'>;

/** Prefix of the scene-spawn tag that names a counter's merchant. */
export const MERCHANT_TAG = 'merchant:';
/** Prefix of the dev tag that tops the player up to this many crowns on first opening. */
export const DEV_CROWNS_TAG = 'dev-crowns:';

/** What the shop reads of a merchant entry. */
interface MerchantEntry {
  readonly id: string;
  readonly npcId: string;
  readonly displayName?: string | undefined;
  readonly personalityTags: readonly string[];
  readonly services?: readonly ShopServiceDef[];
}

/** The greeting for a personality, until barks (E22) give merchants their own lines. */
const GREETINGS: Readonly<Record<string, string>> = Object.freeze({
  greedy: 'Coin talks. What have you got?',
  gossipy: 'Come in, come in. You will not believe what I have heard.',
  suspicious: 'State your business.',
  generous: 'Welcome. You look as if you could use a bargain.',
  gruff: 'Make it quick.',
  friendly: 'Welcome. Take your time.',
  shrewd: 'Let us see what we can do for each other.',
  nervous: 'Oh, hello. Do be quick, will you?',
});
const DEFAULT_GREETING = 'What can I do for you?';

/** The greeting for a merchant: its first personality tag with a line, else the default. */
export function greetingFor(merchant: Pick<MerchantEntry, 'personalityTags'>): string {
  for (const tag of merchant.personalityTags) {
    const line = GREETINGS[tag];
    if (line !== undefined) return line;
  }
  return DEFAULT_GREETING;
}

/** Why a service could not be booked, in the keeper's terms. */
const SERVICE_FAILURES: Readonly<Record<ServiceFailure, string>> = Object.freeze({
  'no-such-service': 'That is no longer on offer.',
  'cannot-afford': 'Not enough crowns.',
  unsafe: 'You cannot sleep with danger about.',
});

/** Why a lesson could not be bought, in the instructor's terms (mw-ju8.13). */
const TRAIN_FAILURES: Readonly<Record<TrainFailure, string>> = Object.freeze({
  'no-such-lesson': 'That is no longer on offer.',
  'already-known': 'You already know that.',
  refused: 'You are not ready for that yet.',
  'cannot-afford': 'Not enough crowns.',
});

/** The line for a lesson refused for lack of an earlier technique, else the generic one. */
export function lessonRefusalText(
  refusals: readonly LearnRefusal[] | undefined,
  nameOf: (capability: string) => string,
): string {
  const missing = refusals?.find((r) => r.reason === 'missing-prerequisite');
  return missing === undefined
    ? TRAIN_FAILURES.refused
    : `Learn ${nameOf(missing.capability)} first.`;
}

/** The toast after a night's rest. */
export const SLEEP_TOAST = 'You sleep until morning.';

/** Why a price was refused, in the merchant's terms. */
const REFUSALS: Readonly<Record<PriceRefusal, string>> = Object.freeze({
  hostile: 'They will not deal with you.',
  'quest-item': 'Quest items cannot be sold.',
  'no-sell': 'That cannot be sold.',
  bound: 'That is bound to you.',
  stolen: 'Only a fence buys stolen goods.',
  'not-bought': 'They do not buy that.',
});

const FAILURES: Readonly<Record<Exclude<BuyFailure | SellFailure, PriceRefusal>, string>> =
  Object.freeze({
    'no-such-item': 'That is no longer here.',
    'out-of-stock': 'There is not enough in stock.',
    'cannot-afford': 'Not enough crowns.',
    'cannot-carry': 'You cannot carry any more of that.',
    'not-enough': 'You do not have that many.',
    'merchant-cannot-afford': 'They cannot afford that just now.',
    equipped: 'Unequip that first.',
    'gold-cap': 'You cannot carry that many crowns.',
  });

/** The status line for a failed deal. */
export function failureText(reason: BuyFailure | SellFailure): string {
  return reason in REFUSALS
    ? REFUSALS[reason as PriceRefusal]
    : FAILURES[reason as keyof typeof FAILURES];
}

/** "×1.3", "×0.95": a factor with up to two decimals. */
const factorText = (factor: number): string => `×${String(Math.round(factor * 100) / 100)}`;

const STEP_LABELS: Readonly<Record<Exclude<PriceStep['kind'], 'base'>, string>> = Object.freeze({
  markup: 'Merchant’s markup',
  'buy-rate': 'Merchant’s buying rate',
  specialty: 'Specialty bonus',
  disposition: 'Their opinion of you',
  stolen: 'Stolen goods',
  world: 'Local prices',
  haggle: 'Haggling',
  cap: 'Capped at their selling price',
  floor: 'Minimum price',
});

/** The tooltip lines for a price: the base value, each step and the result. */
export function breakdownLines(result: Extract<PriceResult, { ok: true }>): string[] {
  const lines = result.breakdown.map((step) => {
    if (step.kind === 'base') return `Base value ${crownsText(Math.round(step.amount))}`;
    const label = STEP_LABELS[step.kind];
    if (step.factor !== undefined) return `${label} ${factorText(step.factor)}`;
    return `${label} ${crownsText(Math.round(step.amount))}`;
  });
  return [...lines, `Price ${crownsText(result.price)}`];
}

/** The player's crowns. */
const crownsOf = (world: World<never>, player: EntityId): number =>
  inventoryOf(world, player)?.gold ?? 0;

/** Derives the shop window's model. */
export class ShopViews {
  readonly #items: ReadonlyMap<string, ItemEntry>;
  readonly #merchants: ReadonlyMap<string, MerchantEntry>;
  readonly #shops: Shops;
  readonly #content: ShopContent;

  constructor(content: ShopContent, shops: Shops) {
    this.#content = content;
    this.#items = new Map(content.all('item').map((item) => [item.id, item]));
    this.#merchants = new Map(content.all('merchant').map((merchant) => [merchant.id, merchant]));
    this.#shops = shops;
  }

  /** Whether content has a merchant `id`. */
  has(merchantId: string): boolean {
    return this.#merchants.has(merchantId);
  }

  #item(defId: string): ItemEntry {
    const item = this.#items.get(defId);
    if (item === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return item;
  }

  /** The display name of item `defId`. */
  nameOf(defId: string | undefined): string {
    const item = defId === undefined ? undefined : this.#items.get(defId);
    return item === undefined ? itemLabel(defId ?? 'item') : itemName(item);
  }

  /** The window's model for `merchantId` as `player` sees it. */
  model(world: World<never>, player: EntityId, merchantId: string): ShopModel {
    const merchant = this.#merchants.get(merchantId);
    if (merchant === undefined) throw new RangeError(`merchant "${merchantId}" is not defined`);
    const state = this.#shops.stateOf(world, merchantId);
    return {
      merchant: {
        name: merchant.displayName ?? itemLabel(merchant.npcId),
        greeting: greetingFor(merchant),
      },
      crowns: crownsOf(world, player),
      merchantCrowns: state.gold,
      buy: this.#buyRows(world, player, merchantId, state),
      sell: this.#sellRows(world, player, merchantId),
      buyback: this.#buybackRows(state),
      services: this.#serviceRows(merchant),
    };
  }

  /**
   * The service at `index` in `merchantId`'s list (the row id the window deals on).
   * @throws RangeError when there is none: the window only deals on rows the model listed.
   */
  serviceAt(merchantId: string, index: number): ShopServiceDef {
    const service = this.#merchants.get(merchantId)?.services?.[index];
    if (service === undefined) {
      throw new RangeError(`merchant "${merchantId}" has no service ${String(index)}`);
    }
    return service;
  }

  /** The display name of a capability the content declares (the id when it does not). */
  capabilityName(id: string): string {
    for (const group of this.#content.all('capability')) {
      const found = group.capabilities.find((c) => c.id === id);
      if (found !== undefined) return found.name;
    }
    return id;
  }

  #serviceRows(merchant: MerchantEntry): ShopRowModel[] {
    return (merchant.services ?? []).map((service, index) => ({
      id: index,
      name: service.name,
      icon: 'misc',
      count: 1,
      unitPrice: service.price,
      specialty: false,
      stolen: false,
      ...(service.kind === 'train' && { verb: 'Learn' }),
      breakdown: [
        `Fixed price ${crownsText(service.price)}`,
        ...(service.teaches === undefined
          ? []
          : [`Teaches ${this.capabilityName(service.teaches)}`]),
      ],
    }));
  }

  #row(
    quote: PriceResult,
    id: number,
    defId: string,
    count: number,
    flags: { readonly stolen?: boolean },
    comparison: string | undefined,
  ): ShopRowModel {
    const item = this.#item(defId);
    const base = {
      id,
      name: itemName(item),
      icon: ICON_KIND[item.category],
      count,
      stolen: flags.stolen === true,
      ...(comparison !== undefined && { comparison }),
    };
    if (!quote.ok) {
      return { ...base, specialty: false, refusal: REFUSALS[quote.refused], breakdown: [] };
    }
    return {
      ...base,
      unitPrice: quote.price,
      specialty: quote.breakdown.some((step) => step.kind === 'specialty'),
      breakdown: breakdownLines(quote),
    };
  }

  #buyRows(
    world: World<never>,
    player: EntityId,
    merchantId: string,
    state: MerchantState,
  ): ShopRowModel[] {
    return state.stock.map((line) =>
      this.#row(
        this.#shops.quote(merchantId, 'buy', line.defId, line.flags),
        line.id,
        line.defId,
        line.count,
        line.flags,
        this.comparison(world, player, line.defId),
      ),
    );
  }

  /**
   * The player's stacks the merchant would deal in, best price first with the refused ones (quest
   * items, stolen goods, equipped gear) last; a category it does not buy is not listed. Equipped
   * single items are refused: unequip them first.
   */
  #sellRows(world: World<never>, player: EntityId, merchantId: string): ShopRowModel[] {
    const pack = inventoryOf(world, player)?.items ?? [];
    const rows = [...pack].reverse().flatMap((instance) => {
      const quote = this.#shops.quote(merchantId, 'sell', instance.defId, instance.flags);
      if (!quote.ok && quote.refused === 'not-bought') return [];
      const row = this.#row(
        quote,
        instance.instanceId,
        instance.defId,
        instance.count,
        instance.flags,
        undefined,
      );
      if (instance.count === 1 && isEquipped(world, player, instance.instanceId)) {
        return [{ ...row, refusal: FAILURES.equipped, breakdown: [] }];
      }
      return [row];
    });
    const refused = (row: ShopRowModel): number => (row.refusal === undefined ? 0 : 1);
    // Array.sort is stable, so equal prices keep the pack's newest-first order.
    return rows.sort((a, b) => refused(a) - refused(b) || (b.unitPrice ?? 0) - (a.unitPrice ?? 0));
  }

  #buybackRows(state: MerchantState): ShopRowModel[] {
    return [...state.buyback].reverse().map((entry) => ({
      id: entry.id,
      name: itemName(this.#item(entry.defId)),
      icon: ICON_KIND[this.#item(entry.defId).category],
      count: entry.count,
      unitPrice: entry.unitPrice,
      specialty: false,
      stolen: entry.flags.stolen === true,
      breakdown: [`Sold for ${crownsText(entry.unitPrice)}`],
    }));
  }

  /** How `defId` compares with what the player has in the same slot, or undefined. */
  comparison(world: World<never>, player: EntityId, defId: string): string | undefined {
    const item = this.#items.get(defId);
    if (item === undefined || !('equip' in item) || item.equip === undefined) return undefined;
    const equipment = equipmentOf(world, player);
    if (equipment === undefined) return undefined;
    const wanted = SLOT_FOR[item.equip.slot];
    const worn = wanted.map((slot) => equipment.slots[slot]).find((ref) => ref != null);
    if (worn == null) return 'Nothing equipped there.';
    const other = this.#items.get(worn.defId);
    const name = this.nameOf(worn.defId);
    if (worn.defId === defId) return `Same as your ${name}.`;
    const weight = (entry: ItemEntry | undefined): number | undefined =>
      entry?.category === 'armor'
        ? entry.armor.weightKg
        : entry?.category === 'shield'
          ? entry.shield.weightKg
          : undefined;
    const mine = weight(item);
    const theirs = weight(other);
    if (mine === undefined || theirs === undefined || mine === theirs) {
      return `Equipped: ${name}.`;
    }
    const diff = Math.round(Math.abs(mine - theirs) * 10) / 10;
    return `Equipped: ${name}; ${String(diff)} kg ${mine > theirs ? 'heavier' : 'lighter'}.`;
  }
}

/** The equipment slots to look in for an item slot (the first one held wins). */
const SLOT_FOR = Object.freeze({
  'main-hand': ['main-hand'],
  'off-hand': ['off-hand'],
  'both-hands': ['main-hand', 'off-hand'],
  head: ['head'],
  body: ['body'],
  hands: ['hands'],
  feet: ['feet'],
  trinket: ['trinket-1', 'trinket-2'],
  'tool-belt': ['tool-belt-1', 'tool-belt-2'],
} as const);

export interface ShopControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly views: ShopViews;
  readonly shops: Shops;
  /** Rules for granting `dev-crowns`. */
  readonly rules: InventoryRules;
  /** Null when it is safe to sleep, else why not (the autosave veto registry's verdict). */
  readonly safety?: () => string | null;
  /** The learn API trainers teach through (mw-ju8.13); absent = lessons cannot be bought. */
  readonly unlocks?: Pick<UnlockBook, 'check' | 'learn'>;
  /** A lesson was bought: the capability it taught (the e2e's readout). */
  readonly onLearned?: (capability: string) => void;
  /** Shows a toast (the night's "You sleep until morning."). */
  readonly toast?: (text: string) => void;
  /** The shop opened or closed (or its crowns changed): what the e2e reads. */
  readonly onChange?: (reading: ShopReading) => void;
}

/** What the e2e reads of the shop. */
export interface ShopReading {
  readonly open: boolean;
  readonly merchant: string | null;
  readonly crowns: number;
  /** The player's pack (the item readout lags while the shop pauses the sim). */
  readonly pack: readonly { readonly item: string; readonly count: number }[];
}

/** The e2e's reading of the shop now. */
export function readingOf(
  world: World<never>,
  player: EntityId,
  open: boolean,
  merchant: string | null,
): ShopReading {
  const pack = inventoryOf(world, player)?.items ?? [];
  return {
    open,
    merchant,
    crowns: crownsOf(world, player),
    pack: pack.map(({ defId, count }) => ({ item: defId, count })),
  };
}

/** Opens, refreshes and closes the shop screen for the player. Call `afterStep` each step. */
export class ShopController {
  readonly #options: ShopControllerOptions;
  readonly #off: () => void;
  readonly #granted = new Set<string>();
  #pending: { merchantId: string; devCrowns: number | undefined } | undefined;
  #session: { readonly merchantId: string; readonly window: ShopWindow } | undefined;
  #shown = '';

  constructor(options: ShopControllerOptions) {
    this.#options = options;
    const { world, player, views } = options;
    this.#off = world.events.on(interacted, ({ actor, target, verb }) => {
      if (actor !== player || verb !== 'talk') return;
      const tags = world.get(target, SceneSpawnComponent)?.tags ?? [];
      const merchantId = tags
        .find((tag) => tag.startsWith(MERCHANT_TAG))
        ?.slice(MERCHANT_TAG.length);
      if (merchantId === undefined || !views.has(merchantId)) return;
      const crowns = tags.find((tag) => tag.startsWith(DEV_CROWNS_TAG));
      const devCrowns =
        crowns === undefined ? undefined : Number(crowns.slice(DEV_CROWNS_TAG.length));
      this.#pending = { merchantId, devCrowns: Number.isFinite(devCrowns) ? devCrowns : undefined };
    });
  }

  /** The open window, if any. */
  get window(): ShopWindow | undefined {
    return this.#session?.window;
  }

  get isOpen(): boolean {
    return this.#session !== undefined;
  }

  /** Opens `merchantId`'s shop unless a screen is open. Returns whether it opened. */
  open(merchantId: string, devCrowns?: number): boolean {
    const { ui, world, player, views } = this.#options;
    if (this.#session !== undefined || ui.top !== undefined || !views.has(merchantId)) return false;
    if (devCrowns !== undefined && !this.#granted.has(merchantId)) {
      this.#granted.add(merchantId);
      const have = crownsOf(world, player);
      if (have < devCrowns) this.#options.rules.addGold(world, player, devCrowns - have);
    }
    const model = views.model(world, player, merchantId);
    this.#shown = JSON.stringify(model);
    const window = openShopWindow(ui, {
      model,
      onDeal: (deal) => {
        this.#deal(deal);
      },
      onClose: () => {
        this.#session = undefined;
        this.#report(false, null);
      },
    });
    this.#session = { merchantId, window };
    this.#report(true, merchantId);
    return true;
  }

  /** Opens a shop the player just talked to, and refreshes the open one. */
  afterStep(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) this.open(pending.merchantId, pending.devCrowns);
    this.#refresh();
  }

  close(): void {
    this.#session?.window.close();
  }

  dispose(): void {
    this.#off();
    this.close();
  }

  #refresh(): void {
    const session = this.#session;
    if (session === undefined) return;
    const { merchantId, window } = session;
    const { world, player, views } = this.#options;
    const model = views.model(world, player, merchantId);
    const json = JSON.stringify(model);
    if (json === this.#shown) return;
    this.#shown = json;
    window.update(model);
    this.#report(true, merchantId);
  }

  #book(merchantId: string, window: ShopWindow, index: number): void {
    const { world, player, shops, views, safety, toast } = this.#options;
    const service = views.serviceAt(merchantId, index);
    if (service.kind === 'train') {
      this.#learn(merchantId, window, service);
      return;
    }
    const result = shops.buyService(world, player, merchantId, service.id, {
      ...(safety !== undefined && { safety }),
    });
    if (!result.ok) {
      window.say(SERVICE_FAILURES[result.reason]);
      return;
    }
    this.close();
    toast?.(SLEEP_TOAST);
  }

  #learn(merchantId: string, window: ShopWindow, service: ShopServiceDef): void {
    const { world, player, shops, views, unlocks, toast } = this.#options;
    if (unlocks === undefined) {
      window.say(TRAIN_FAILURES['no-such-lesson']);
      return;
    }
    const result = shops.train(world, player, merchantId, service.id, unlocks);
    if (!result.ok) {
      window.say(
        result.reason === 'refused'
          ? lessonRefusalText(result.refusals, (id) => views.capabilityName(id))
          : TRAIN_FAILURES[result.reason],
      );
      return;
    }
    this.#options.onLearned?.(result.capability);
    window.say(`You learn ${service.name} for ${crownsText(result.price)}.`);
    toast?.(`You learn ${service.name}.`);
    this.#refresh();
  }

  #deal({ tab, id, count }: ShopDeal): void {
    const { world, player, shops, views } = this.#options;
    const session = this.#session;
    if (session === undefined) return;
    const { merchantId, window } = session;
    if (tab === 'services') {
      this.#book(merchantId, window, id);
      return;
    }
    const name = views.nameOf(
      tab === 'buy'
        ? shops.stateOf(world, merchantId).stock.find((l) => l.id === id)?.defId
        : tab === 'buyback'
          ? shops.stateOf(world, merchantId).buyback.find((e) => e.id === id)?.defId
          : inventoryOf(world, player)?.items.find((i) => i.instanceId === id)?.defId,
    );
    const result =
      tab === 'buy'
        ? shops.buy(world, player, merchantId, id, count)
        : tab === 'sell'
          ? shops.sell(world, player, merchantId, id, count)
          : shops.buyBack(world, player, merchantId, id, count);
    const units = count > 1 ? ` ×${String(count)}` : '';
    window.say(
      result.ok
        ? `${tab === 'sell' ? 'Sold' : 'Bought'} ${name}${units} for ${crownsText(result.total)}.`
        : failureText(result.reason),
    );
    this.#refresh();
  }

  #report(open: boolean, merchant: string | null): void {
    const { world, player, onChange } = this.#options;
    onChange?.(readingOf(world, player, open, merchant));
  }
}

export interface ShopUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly content: ShopContent;
  readonly player: EntityId;
  /** Publishes a readout for the e2e: `shop` (JSON of a `ShopReading`), `rest` (a night's sleep). */
  readonly publish?: (key: 'shop' | 'rest' | 'learned', value: string) => void;
  /** The learn API trainers teach through (mw-ju8.13). */
  readonly unlocks?: Pick<UnlockBook, 'check' | 'learn'>;
  /** Null when it is safe to sleep, else why not (the autosave veto registry's verdict). */
  readonly safety?: () => string | null;
}

/** The shop in a running game. */
export interface ShopUi {
  readonly controller: ShopController;
  readonly shops: Shops;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Builds the shops engine over content and readies the shop screen for the player. */
export function startShopUi(options: ShopUiOptions): ShopUi {
  const { ui, world, content, player, publish, safety, unlocks } = options;
  const items = content.all('item');
  const rules = new InventoryRules(items);
  const shops = new Shops(
    content.all('merchant'),
    items,
    rules,
    new LootTables(content.all('loot-table'), items),
  );
  shops.restockOnRest(world); // sleeping refills tills and shelves (mw-e20.5)
  const views = new ShopViews(content, shops);
  const toasts = new ToastHost();
  ui.hud.append(toasts.element);
  world.events.on(restCompleted, ({ kind, hours, point, wakes }) => {
    publish?.('rest', JSON.stringify({ kind, hours, point, day: wakes.day, minute: wakes.minute }));
  });
  const learned: string[] = [];
  const controller = new ShopController({
    ui,
    world,
    player,
    views,
    shops,
    rules,
    ...(safety !== undefined && { safety }),
    ...(unlocks !== undefined && { unlocks }),
    onLearned: (capability) => {
      learned.push(capability);
      publish?.('learned', JSON.stringify(learned));
    },
    toast: (text) => {
      toasts.show(text, { durationMs: 6000 });
    },
    onChange: (reading) => publish?.('shop', JSON.stringify(reading)),
  });
  publish?.('shop', JSON.stringify(readingOf(world, player, false, null)));
  return {
    controller,
    shops,
    afterStep: () => {
      controller.afterStep();
    },
  };
}
