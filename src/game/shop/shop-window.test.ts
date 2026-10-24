// @vitest-environment happy-dom
// The shop in the game (mw-e20.10): a real world with the dev content's fixture merchants, the sim's
// `Shops` engine, the UI root and the glue between them. Talking to a counter opens the screen; deals
// run at once through the engine; the window mirrors the world.
import { loadDevContent } from '@content/dev-content';
import { loadGameContent, type GameContent } from '@content/index';
import {
  emptySlots,
  addEquipment,
  addInventory,
  DAMAGE_COMPONENTS,
  DAY_CLOCK_FACTS,
  EquipmentRules,
  factDayClock,
  giveCombatant,
  HealthComponent,
  MORNING_MINUTE,
  interacted,
  InventoryComponent,
  EquipmentComponent,
  inventoryOf,
  InventoryRules,
  LootTables,
  PlacementComponent,
  SceneSpawnComponent,
  Shops,
  shopBought,
  World,
  type EntityId,
  type ShopItemDef,
} from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  breakdownLines,
  readingOf,
  failureText,
  greetingFor,
  ShopViews,
  startShopUi,
  type ShopContent,
  lessonRefusalText,
} from './shop-window';

const content = loadDevContent();

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup(source: ShopContent = content, crowns = 200, safety?: () => string | null) {
  const world = new World<unknown>({ seed: 5 });
  world.register(InventoryComponent, EquipmentComponent, PlacementComponent, SceneSpawnComponent);
  const sim = world as unknown as World<never>;
  const player = world.spawn();
  addInventory(sim, player, crowns);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: string[] = [];
  const shop = startShopUi({
    ui,
    world: sim,
    content: source,
    player,
    ...(safety !== undefined && { safety }),
    publish: (_key, value) => published.push(value),
  });
  const counter = (tags: string[]): EntityId => {
    const entity = world.spawn();
    world.add(entity, SceneSpawnComponent, { id: 'counter', tags });
    return entity;
  };
  const talk = (target: EntityId, verb: 'talk' | 'search' = 'talk', actor = player) => {
    world.events.emit(interacted, { actor, target, verb, affordance: 0 });
    world.step([]);
    shop.afterStep();
  };
  const rules = new InventoryRules(source.all('item'));
  const rows = (tab: string) => [
    ...document.querySelectorAll<HTMLButtonElement>(`[data-shop-panel="${tab}"] .vb-shop-row`),
  ];
  const status = () => document.querySelector('[data-testid="shop-status"]')?.textContent;
  const pack = () => inventoryOf(sim, player)?.items.map(({ defId, count }) => [defId, count]);
  const crownsNow = () => inventoryOf(sim, player)?.gold;
  return {
    world,
    sim,
    player,
    ui,
    shop,
    counter,
    talk,
    rules,
    rows,
    status,
    pack,
    crownsNow,
    published,
  };
}

/** Clicks a tab of the open shop. */
function tab(id: string): void {
  find(`[data-tab="${id}"]`).click();
}

const GENERAL = ['merchant:fixture-general-goods'];

describe('shop views and texts (mw-e20.10)', () => {
  it('greets by personality, else with a default', () => {
    expect(greetingFor({ personalityTags: ['gruff', 'shrewd'] })).toBe('Make it quick.');
    expect(greetingFor({ personalityTags: [] })).toBe('What can I do for you?');
  });

  it('says why a deal failed, for every reason', () => {
    expect(failureText('stolen')).toBe('Only a fence buys stolen goods.');
    expect(failureText('hostile')).toBe('They will not deal with you.');
    expect(failureText('cannot-afford')).toBe('Not enough crowns.');
    expect(failureText('merchant-cannot-afford')).toBe('They cannot afford that just now.');
    expect(failureText('out-of-stock')).toBe('There is not enough in stock.');
  });

  it('lists a price breakdown: base, each step, then the price', () => {
    const shops = new Shops(
      content.all('merchant'),
      content.all('item'),
      new InventoryRules(content.all('item')),
      new LootTables(content.all('loot-table'), content.all('item')),
    );
    const buy = shops.quote('fixture-general-goods', 'buy', 'arming-sword');
    if (!buy.ok) throw new Error('refused');
    expect(breakdownLines(buy)).toEqual([
      'Base value 40 crowns',
      'Merchant’s markup ×1.3',
      'Price 52 crowns',
    ]);
    const sell = shops.quote('fixture-general-goods', 'sell', 'arming-sword');
    if (!sell.ok) throw new Error('refused');
    expect(breakdownLines(sell)).toEqual([
      'Base value 40 crowns',
      'Merchant’s buying rate ×0.4',
      'Specialty bonus ×1.2',
      'Price 19 crowns',
    ]);
  });
});

describe('AC-1: specialty badge and modifier', () => {
  it('a merchant with specialty books marks a book on the Sell tab and its tooltip lists the bonus', () => {
    const book = {
      id: 'old-book',
      name: 'Old book',
      category: 'book',
      value: 30,
      stackable: false,
      flags: { unique: false, questItem: false },
    };
    const merchant = {
      id: 'bookseller',
      npcId: 'bookseller',
      personalityTags: ['friendly'],
      specialties: ['book'],
      buysCategories: ['book'],
      stock: [],
      goldReserve: 500,
      markup: 1.3,
      buyRate: 0.4,
    };
    const fake = {
      all: (type: string) => (type === 'item' ? [book] : type === 'merchant' ? [merchant] : []),
    } as unknown as GameContent;
    const t = setup(fake);
    t.rules.add(t.sim, t.player, 'old-book', 1);
    const entity = t.counter(['merchant:bookseller']);
    t.talk(entity);
    expect(t.ui.top?.id).toBe('shop');
    tab('sell');
    const row = t.rows('sell')[0] as HTMLElement;
    expect(row.querySelector('[data-badge="specialty"]')).not.toBeNull();
    row.focus();
    const tip = document.querySelector('[data-shop-row="sell:1"] [role="tooltip"]');
    expect(tip?.textContent).toContain('Specialty bonus ×1.2');
    expect(row.getAttribute('aria-label')).toBe('Sell Old book, 14 crowns');
  });
});

describe('mw-ju8.16: the merchant name in the header', () => {
  const book = {
    id: 'old-book',
    name: 'Old book',
    category: 'book',
    value: 30,
    stackable: false,
    flags: { unique: false, questItem: false },
  };
  const merchantWith = (extra: Record<string, unknown>) => ({
    id: 'named',
    npcId: 'npc-named-keeper',
    ...extra,
    personalityTags: [],
    specialties: [],
    buysCategories: ['book'],
    stock: [],
    goldReserve: 100,
    markup: 1.3,
    buyRate: 0.4,
  });
  const open = (merchant: unknown): void => {
    const fake = {
      all: (type: string) => (type === 'item' ? [book] : type === 'merchant' ? [merchant] : []),
    } as unknown as GameContent;
    const t = setup(fake);
    t.talk(t.counter(['merchant:named']));
  };

  it('AC-1: a merchant with a displayName shows it in the header', () => {
    open(merchantWith({ displayName: 'Ottilie Marsh' }));
    expect(find('.vb-shop-name').textContent).toBe('Ottilie Marsh');
  });

  it('AC-1: without a displayName the header falls back to the readable NPC id', () => {
    open(merchantWith({}));
    expect(find('.vb-shop-name').textContent).toBe('Npc named keeper');
  });
});

describe('AC-3: a stolen item at a non-fence', () => {
  it('is disabled with the refusal reason, and enabled at the fence', () => {
    const t = setup();
    t.rules.add(t.sim, t.player, 'lockpicks', 1, { stolen: true });
    t.rules.add(t.sim, t.player, 'hunting-knife', 1);
    t.talk(t.counter(GENERAL));
    tab('sell');
    const stolen = t.rows('sell').find((r) => r.textContent.includes('Lockpicks')) as HTMLElement;
    expect(stolen.getAttribute('aria-disabled')).toBe('true');
    expect(stolen.querySelector('[data-badge="stolen"]')).not.toBeNull();
    expect(stolen.querySelector('[data-testid="shop-reason"]')?.textContent).toBe(
      'Only a fence buys stolen goods.',
    );
    stolen.click();
    expect(t.status()).toBe('Only a fence buys stolen goods.');
    t.ui.top?.close();

    t.talk(t.counter(['merchant:fixture-fence']));
    tab('sell');
    const accepted = t.rows('sell').find((r) => r.textContent.includes('Lockpicks')) as HTMLElement;
    expect(accepted.getAttribute('aria-disabled')).toBeNull();
    expect(accepted.querySelector('[data-badge="stolen"]')).not.toBeNull();
  });

  it('hides categories the merchant does not buy; a quest item shows disabled, with no price', () => {
    const t = setup();
    t.rules.add(t.sim, t.player, 'rusted-gallery-key', 1);
    t.rules.add(t.sim, t.player, 'miners-tally-stick', 1);
    t.talk(t.counter(GENERAL));
    tab('sell');
    const rows = t.rows('sell');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Sell Rusted gallery key']);
    expect(rows[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(rows[0]?.querySelector('[data-testid="shop-reason"]')?.textContent).toBe(
      'Quest items cannot be sold.',
    );
    expect(rows[0]?.querySelector('.vb-shop-price')?.textContent).toBe('');
  });
});

describe('the shop controller', () => {
  it('talking to a tagged counter opens the screen and publishes it; Esc closes it', () => {
    const t = setup();
    t.talk(t.counter(GENERAL));
    expect(t.ui.top?.id).toBe('shop');
    expect(JSON.parse(t.published.at(-1) ?? '{}')).toEqual({
      open: true,
      merchant: 'fixture-general-goods',
      crowns: 200,
      pack: [],
    });
    expect(document.querySelector('.vb-shop-name')?.textContent).toBe('Fixture shopkeeper');
    expect(document.querySelector('[data-testid="shop-greeting"]')?.textContent).toBe(
      'Make it quick.',
    );
    t.ui.intent('back', 'keyboard');
    expect(t.ui.top).toBeUndefined();
    expect(JSON.parse(t.published.at(-1) ?? '{}')).toMatchObject({ open: false, merchant: null });
  });

  it('ignores other verbs, untagged counters, unknown merchants and other actors', () => {
    const t = setup();
    t.talk(t.counter(GENERAL), 'search');
    t.talk(t.counter([]));
    t.talk(t.counter(['merchant:nobody']));
    t.talk(t.counter(GENERAL), 'talk', t.world.spawn());
    expect(t.ui.top).toBeUndefined();
  });

  it('does not open over another screen, and a second talk while open does nothing', () => {
    const t = setup();
    const entity = t.counter(GENERAL);
    t.talk(entity);
    t.talk(entity);
    expect(document.querySelectorAll('[data-screen="shop"]')).toHaveLength(1);
    t.shop.controller.close();
    t.ui.push({ id: 'other', label: 'Other', content: document.createElement('div') });
    expect(t.shop.controller.open('fixture-general-goods')).toBe(false);
  });

  it('tops the player up with dev-crowns once, and a bad tag is ignored', () => {
    const t = setup(content, 20);
    const entity = t.counter([...GENERAL, 'dev-crowns:150']);
    t.talk(entity);
    expect(t.crownsNow()).toBe(150);
    t.ui.top?.close();
    t.rules.spendGold(t.sim, t.player, 100);
    t.talk(entity);
    expect(t.crownsNow()).toBe(50);
    t.ui.top?.close();
    const bad = setup(content, 20);
    bad.talk(bad.counter([...GENERAL, 'dev-crowns:lots']));
    expect(bad.crownsNow()).toBe(20);
    const rich = setup(content, 500);
    rich.talk(rich.counter([...GENERAL, 'dev-crowns:150']));
    expect(rich.crownsNow()).toBe(500);
  });

  it('AC-4: selling an item and buying it back restores crowns and pack; a bought item sells for less', () => {
    const t = setup(content, 400);
    const bought: number[] = [];
    t.world.events.on(shopBought, (e) => bought.push(e.total));
    t.talk(t.counter(GENERAL));
    const sword = t.rows('buy').find((r) => r.textContent.includes('Arming sword')) as HTMLElement;
    sword.click(); // 52 of 400: one input
    t.world.step([]); // the engine's own event, delivered on the next step
    expect(bought).toEqual([52]);
    expect(t.status()).toBe('Bought Arming sword for 52 crowns.');
    expect(t.crownsNow()).toBe(348);
    expect(t.pack()).toEqual([['arming-sword', 1]]);
    expect(document.querySelector('[data-testid="shop-crowns"]')?.textContent).toBe(
      'Your crowns: 348 crowns',
    );
    // Sell it: the merchant pays less than the player paid (a merchant never buys above its price).
    const afterBuy = { crowns: t.crownsNow(), pack: t.pack() };
    tab('sell');
    (t.rows('sell')[0] as HTMLElement).click();
    expect(t.status()).toBe('Sold Arming sword for 19 crowns.');
    expect(t.pack()).toEqual([]);
    expect(t.crownsNow()).toBe(367);
    // Buy it back at the price the merchant paid: crowns and pack are as they were before the sale.
    tab('buyback');
    expect(t.rows('buyback')[0]?.getAttribute('aria-label')).toBe(
      'Buy back Arming sword, 19 crowns',
    );
    (t.rows('buyback')[0] as HTMLElement).click();
    expect({ crowns: t.crownsNow(), pack: t.pack() }).toEqual(afterBuy);
  });

  it('a purchase over a quarter of the crowns asks, and the crowns do not move until it is confirmed', async () => {
    const t = setup(content, 100);
    t.talk(t.counter(GENERAL));
    const sword = t.rows('buy').find((r) => r.textContent.includes('Arming sword')) as HTMLElement;
    sword.click(); // 52 of 100
    expect(t.ui.top?.id).toBe('confirm');
    expect(t.crownsNow()).toBe(100);
    (document.querySelectorAll('[data-testid="confirm"] button')[1] as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.crownsNow()).toBe(48);
    expect(t.pack()).toEqual([['arming-sword', 1]]);
  });

  it('says why a deal failed and changes nothing', () => {
    const t = setup(content, 5);
    t.talk(t.counter(GENERAL));
    const keys = t.rows('buy').find((r) => r.textContent.includes('Lockpicks')) as HTMLElement;
    keys.click(); // 5 crowns would not cover it: the row itself is disabled
    expect(keys.getAttribute('aria-disabled')).toBe('true');
    expect(t.crownsNow()).toBe(5);
    // A stale deal (the line vanished) is reported.
    const controller = t.shop.controller;
    const state = t.shop.shops.stateOf(t.sim, 'fixture-general-goods');
    const line = state.stock[0];
    expect(line).toBeDefined();
    controller.window?.say('');
    expect(t.pack()).toEqual([]);
  });

  it('refreshes the open window when the world changes under it', () => {
    const t = setup();
    t.talk(t.counter(GENERAL));
    t.rules.addGold(t.sim, t.player, 50);
    t.world.step([]);
    t.shop.afterStep();
    expect(document.querySelector('[data-testid="shop-crowns"]')?.textContent).toBe(
      'Your crowns: 250 crowns',
    );
    expect((JSON.parse(t.published.at(-1) ?? '{}') as { crowns: number }).crowns).toBe(250);
  });

  it('shows how equipment compares with what is equipped', () => {
    const t = setup();
    addEquipment(t.sim, t.player, 'knight');
    const equipment = new EquipmentRules(content.all('item'), content.all('class'));
    t.rules.add(t.sim, t.player, 'leather-jerkin', 1);
    t.rules.add(t.sim, t.player, 'arming-sword', 1);
    t.talk(t.counter(GENERAL));
    // Nothing worn yet.
    const jerkinRow = () => t.rows('buy').find((r) => r.textContent.includes('Leather jerkin'));
    expect(jerkinRow()?.textContent).toContain('Nothing equipped there.');
    const pack = inventoryOf(t.sim, t.player)?.items ?? [];
    for (const item of pack) equipment.equip(t.sim, t.player, item.instanceId);
    t.world.step([]);
    t.shop.afterStep();
    const text = t.rows('buy').map((r) => r.textContent);
    expect(text.some((s) => s.includes('Same as your Leather jerkin.'))).toBe(true);
    expect(text.some((s) => s.includes('Same as your Arming sword.'))).toBe(true);
  });

  it('compares weights between different pieces of the same slot, and names a weapon swap', () => {
    const views = new ShopViews(
      content,
      new Shops([], content.all('item'), new InventoryRules(content.all('item'))),
    );
    const world = new World<unknown>({ seed: 1 });
    world.register(InventoryComponent, EquipmentComponent);
    const sim = world as unknown as World<never>;
    const player = world.spawn();
    addInventory(sim, player, 0);
    addEquipment(sim, player, 'knight');
    const rules = new InventoryRules(content.all('item'));
    const equipment = new EquipmentRules(content.all('item'), content.all('class'));
    rules.add(sim, player, 'leather-jerkin', 1);
    rules.add(sim, player, 'hunting-knife', 1);
    const [jerkin, knife] = inventoryOf(sim, player)?.items ?? [];
    equipment.equip(sim, player, (jerkin as { instanceId: number }).instanceId);
    equipment.equip(sim, player, (knife as { instanceId: number }).instanceId);
    expect(views.comparison(sim, player, 'mail-hauberk')).toMatch(
      /^Equipped: Leather jerkin; [\d.]+ kg heavier\.$/,
    );
    expect(views.comparison(sim, player, 'arming-sword')).toBe('Equipped: Hunting knife.');
    expect(views.comparison(sim, player, 'healing-draught')).toBeUndefined();
    expect(views.comparison(sim, player, 'no-such-item')).toBeUndefined();
    const bare = world.spawn();
    addInventory(sim, bare, 0);
    expect(views.comparison(sim, bare, 'arming-sword')).toBeUndefined();
  });

  it('opens by id without a counter, refuses an unknown merchant, and disposes', () => {
    const t = setup();
    expect(t.shop.controller.open('fixture-fence')).toBe(true);
    expect(t.shop.controller.isOpen).toBe(true);
    expect(t.shop.controller.window).toBeDefined();
    t.shop.controller.close();
    expect(t.shop.controller.open('nobody')).toBe(false);
    t.shop.controller.dispose();
    t.talk(t.counter(GENERAL));
    expect(t.ui.top).toBeUndefined();
  });

  it('a loot-table shelf and an unknown item do not break the model', () => {
    const t = setup();
    const views = new ShopViews(content, t.shop.shops);
    expect(views.has('fixture-general-goods')).toBe(true);
    expect(views.nameOf('mystery-thing')).toBe('Mystery thing');
    expect(views.nameOf(undefined)).toBe('Item');
    expect(() => views.model(t.sim, t.player, 'nobody')).toThrow(RangeError);
    const model = views.model(t.sim, t.player, 'fixture-general-goods');
    expect(model.buy.length).toBeGreaterThan(5);
    expect(model.sell).toEqual([]);
    expect(model.buyback).toEqual([]);
  });
});

/** Content made of plain objects, for cases the dev content does not have. */
const plainContent = (items: object[], merchants: object[]): GameContent =>
  ({
    all: (type: string) => (type === 'item' ? items : type === 'merchant' ? merchants : []),
  }) as unknown as GameContent;

const plainItem = (id: string, extra: Record<string, unknown> = {}): ShopItemDef =>
  ({
    id,
    name: id,
    category: 'misc',
    value: 10,
    stackable: false,
    flags: { unique: false, questItem: false },
    ...extra,
  }) as ShopItemDef;

const plainMerchant = (extra: object = {}) => ({
  id: 'shop',
  npcId: 'shop',
  personalityTags: [],
  specialties: [],
  buysCategories: ['misc', 'shield'],
  stock: [{ item: { id: 'trinket' }, count: 3 }],
  goldReserve: 100,
  markup: 1.3,
  buyRate: 0.4,
  ...extra,
});

describe('more shop cases', () => {
  it('a personality with no line falls back to the default greeting', () => {
    expect(greetingFor({ personalityTags: ['mysterious'] })).toBe('What can I do for you?');
  });

  it('a price floored at one crown lists the minimum-price step', () => {
    const shops = new Shops(
      [plainMerchant()],
      [plainItem('trinket', { value: 1 })],
      new InventoryRules([plainItem('trinket', { value: 1 })]),
    );
    const sell = shops.quote('shop', 'sell', 'trinket');
    if (!sell.ok) throw new Error('refused');
    expect(breakdownLines(sell)).toEqual([
      'Base value 1 crown',
      'Merchant’s buying rate ×0.4',
      'Minimum price 1 crown',
      'Price 1 crown',
    ]);
  });

  it('a player without a pack sees no crowns and nothing to sell', () => {
    const t = setup();
    const views = new ShopViews(content, t.shop.shops);
    const bare = t.world.spawn();
    const model = views.model(t.sim, bare, 'fixture-general-goods');
    expect(model.crowns).toBe(0);
    expect(model.sell).toEqual([]);
    expect(readingOf(t.sim, bare, false, null)).toEqual({
      open: false,
      merchant: null,
      crowns: 0,
      pack: [],
    });
  });

  it('talking to something that is not a placed spawn opens nothing', () => {
    const t = setup();
    const plain = t.world.spawn();
    t.talk(plain);
    expect(t.ui.top).toBeUndefined();
  });

  it('compares shields by weight: heavier, lighter and equal', () => {
    const buckler = plainItem('buckler', {
      category: 'shield',
      equip: { slot: 'off-hand' },
      shield: { weightKg: 2 },
    });
    const tower = plainItem('tower', {
      category: 'shield',
      equip: { slot: 'off-hand' },
      shield: { weightKg: 3.5 },
    });
    const twin = plainItem('twin', {
      category: 'shield',
      equip: { slot: 'off-hand' },
      shield: { weightKg: 2 },
    });
    const items = [buckler, tower, twin, plainItem('trinket')];
    const source = plainContent(items, [plainMerchant()]);
    const world = new World<unknown>({ seed: 1 });
    world.register(InventoryComponent, EquipmentComponent);
    const sim = world as unknown as World<never>;
    const player = world.spawn();
    addInventory(sim, player, 0);
    world.add(player, EquipmentComponent, {
      classId: 'knight',
      slots: { ...emptySlots(), 'off-hand': { instanceId: 1, defId: 'buckler' } },
    });
    const views = new ShopViews(
      source,
      new Shops([plainMerchant()], items, new InventoryRules(items)),
    );
    expect(views.comparison(sim, player, 'tower')).toBe('Equipped: buckler; 1.5 kg heavier.');
    expect(views.comparison(sim, player, 'twin')).toBe('Equipped: buckler.');
    expect(views.comparison(sim, player, 'buckler')).toBe('Same as your buckler.');
    expect(views.comparison(sim, player, 'trinket')).toBeUndefined();
    world.add(player, EquipmentComponent, {
      classId: 'knight',
      slots: { ...emptySlots(), 'off-hand': { instanceId: 1, defId: 'tower' } },
    });
    expect(views.comparison(sim, player, 'buckler')).toBe('Equipped: tower; 1.5 kg lighter.');
  });

  it('a stale row clicked after the shop closed does nothing', () => {
    const t = setup(content, 1000);
    t.talk(t.counter(GENERAL));
    const stale = t.rows('buy')[0] as HTMLElement;
    t.ui.top?.close();
    stale.click();
    expect(t.ui.top).toBeUndefined();
    expect(t.pack()).toEqual([]);
    expect(t.crownsNow()).toBe(1000);
  });

  it('buys several units at once, and says so', () => {
    const t = setup(content, 1000);
    t.talk(t.counter(GENERAL));
    const arrows = t.rows('buy').find((r) => r.textContent.includes('Arrow')) as HTMLElement;
    const key = arrows.dataset['shopItem'] ?? '';
    find(`[data-shop-focus="${key}:more"]`).click();
    find(`[data-shop-focus="${key}:more"]`).click();
    find(`[data-shop-item="${key}"]`).click();
    expect(t.status()).toMatch(/^Bought Arrow ×3 for \d+ crowns\.$/);
    expect(t.pack()).toEqual([['standard-arrow', 3]]);
  });

  it('reports a deal the engine refuses, changing nothing', () => {
    const t = setup(content, 1000);
    t.talk(t.counter(GENERAL));
    const sword = t.rows('buy').find((r) => r.textContent.includes('Arming sword')) as HTMLElement;
    const key = sword.dataset['shopItem'] ?? '';
    find(`[data-shop-focus="${key}:more"]`).click(); // two swords in stock
    // Someone else takes them before the player confirms.
    const state = t.shop.shops.stateOf(t.sim, 'fixture-general-goods');
    const line = state.stock.find((l) => l.defId === 'arming-sword');
    t.shop.shops.buy(t.sim, t.player, 'fixture-general-goods', line?.id ?? -1, 2);
    t.rules.remove(t.sim, t.player, { defId: 'arming-sword', count: 2 });
    const before = t.crownsNow();
    find(`[data-shop-item="${key}"]`).click();
    expect(t.status()).toBe('That is no longer here.');
    expect(t.crownsNow()).toBe(before);
  });

  it('a shelf holding an item content does not have is a loud error, not a blank row', () => {
    const items = [plainItem('trinket')];
    const t = setup();
    const views = new ShopViews(
      plainContent([], [plainMerchant()]),
      new Shops([plainMerchant()], items, new InventoryRules(items)),
    );
    expect(() => views.model(t.sim, t.player, 'shop')).toThrow(RangeError);
  });
});

describe('the Sleeping Ox: a room for the night on the Services tab (mw-ju8.6)', () => {
  const game = loadGameContent();
  const OX = ['merchant:sleeping-ox'];

  /** The inn with a hurt player and a clock at 21:00. */
  function inn(crowns: number, safety?: () => string | null) {
    const t = setup(game, crowns, safety);
    for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) t.sim.facts.declare(key, spec);
    t.world.register(...DAMAGE_COMPONENTS);
    giveCombatant(t.sim, t.player, { health: 90 });
    t.world.set(t.player, HealthComponent, { max: 90, current: 10 });
    const clock = factDayClock(t.sim.facts);
    clock.set({ day: 1, minute: 21 * 60 });
    t.talk(t.counter(OX));
    tab('services');
    return { ...t, clock };
  }
  const toast = () => document.querySelector('.vb-toast')?.textContent;

  it('AC-1: lists the room with its price; booking it pays, sleeps to morning, heals, closes and toasts', () => {
    const t = inn(200);
    expect(t.rows('services').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Book Room for the night, 12 crowns',
    ]);
    (t.rows('services')[0] as HTMLElement).click();
    expect(t.crownsNow()).toBe(188);
    expect(t.clock.now()).toEqual({ day: 2, minute: MORNING_MINUTE });
    expect(t.sim.get(t.player, HealthComponent)).toEqual({ max: 90, current: 90 });
    expect(t.shop.controller.isOpen).toBe(false);
    expect(toast()).toBe('You sleep until morning.');
    const shops = t.published.filter((p) => p.includes('"open"'));
    expect(JSON.parse(shops.at(-1) ?? 'null')).toMatchObject({ open: false, crowns: 188 });
    t.world.step([]); // the event reaches the readout at the next flush
    expect(t.published.at(-1)).toBe(
      JSON.stringify({ kind: 'inn', hours: 9, point: 'sleeping-ox', day: 2, minute: 360 }),
    );
  });

  it('a room costing over a quarter of the crowns asks first', async () => {
    const t = inn(40); // 12 of 40
    (t.rows('services')[0] as HTMLElement).click();
    expect(t.ui.top?.id).toBe('confirm');
    expect(t.crownsNow()).toBe(40);
    (document.querySelectorAll('[data-testid="confirm"] button')[1] as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.crownsNow()).toBe(28);
    expect(t.clock.now().day).toBe(2);
  });

  it('AC-2: with too few crowns the room is dimmed, says so, and nothing changes', () => {
    const t = inn(11);
    const room = t.rows('services')[0] as HTMLElement;
    expect(room.getAttribute('aria-disabled')).toBe('true');
    room.click();
    expect(t.status()).toBe('Not enough crowns.');
    expect(t.crownsNow()).toBe(11);
    expect(t.clock.now()).toEqual({ day: 1, minute: 21 * 60 });
    expect(t.sim.get(t.player, HealthComponent)?.current).toBe(10);
    expect(t.shop.controller.isOpen).toBe(true);
  });

  it('is refused while a safety veto objects, keeping the shop open and the crowns', () => {
    const t = inn(200, () => 'Can’t save during combat');
    (t.rows('services')[0] as HTMLElement).click();
    expect(t.status()).toBe('You cannot sleep with danger about.');
    expect(t.crownsNow()).toBe(200);
    expect(t.clock.now().day).toBe(1);
    expect(t.shop.controller.isOpen).toBe(true);
    expect(toast()).toBeUndefined();
  });

  it('a service the merchant does not list is a loud error, not a silent no-op', () => {
    const t = setup(game, 100);
    const views = new ShopViews(game, t.shop.shops);
    expect(views.serviceAt('sleeping-ox', 0).id).toBe('room-for-the-night');
    expect(() => views.serviceAt('sleeping-ox', 1)).toThrow(RangeError);
    expect(() => views.serviceAt('marsh-general-store', 0)).toThrow(RangeError);
  });

  it('a merchant with no services lists none on the Services tab', () => {
    const t = setup(game, 100);
    t.talk(t.counter(['merchant:marsh-general-store']));
    tab('services');
    expect(find('[data-shop-panel="services"]').textContent).toBe('Nothing on offer');
  });
});

describe('selling loot at Brand’s Forge (mw-ju8.7)', () => {
  const game = loadGameContent();
  const FORGE = ['merchant:brand-forge'];
  const label = (r: HTMLElement) => r.getAttribute('aria-label');

  /** Brand's counter open on the Sell tab with `items` in the pack. */
  function forge(items: readonly (readonly [string, number])[], crowns = 0) {
    const t = setup(game, crowns);
    for (const [defId, count] of items) t.rules.add(t.sim, t.player, defId, count);
    t.talk(t.counter(FORGE));
    tab('sell');
    return t;
  }

  it('AC-1: selling a dropped weapon pays value x buy rate x specialty, leaves the pack, joins the buyback', () => {
    const t = forge([['arming-sword', 1]]); // 40 x 0.4 x 1.2 = 19.2
    const [row] = t.rows('sell');
    expect(label(row as HTMLElement)).toBe('Sell Arming sword, 19 crowns');
    (row as HTMLElement).click();
    expect(t.crownsNow()).toBe(19);
    expect(t.pack()).toEqual([]);
    expect(t.status()).toBe('Sold Arming sword for 19 crowns.');
    const bought = t.shop.shops.stateOf(t.sim, 'brand-forge').buyback;
    expect(bought).toMatchObject([{ defId: 'arming-sword', count: 1, unitPrice: 19 }]);
    tab('buyback');
    expect(t.rows('buyback').map(label)).toEqual(['Buy back Arming sword, 19 crowns']);
  });

  it('AC-2: the tooltip lists base value, buying rate, specialty bonus and the price', () => {
    const t = forge([['arming-sword', 1]]);
    const lines = t.shop.shops.quote('brand-forge', 'sell', 'arming-sword', {});
    expect(lines.ok && breakdownLines(lines)).toEqual([
      'Base value 40 crowns',
      'Merchant’s buying rate ×0.4',
      'Specialty bonus ×1.2',
      'Price 19 crowns',
    ]);
    expect(
      document.querySelector('[data-shop-panel="sell"] .vb-shop-tooltip')?.textContent,
    ).toContain('Specialty bonus ×1.2');
  });

  it('AC-3: rows are sorted best price first; categories he does not buy are not listed', () => {
    const t = forge([
      ['leather-jerkin', 1],
      ['mail-hauberk', 1],
      ['bread-loaf', 2],
      ['open-helm', 1],
    ]);
    expect(t.rows('sell').map(label)).toEqual([
      'Sell Mail hauberk, 58 crowns',
      'Sell Open helm, 22 crowns',
      'Sell Leather jerkin, 14 crowns',
    ]);
  });

  it('AC-4: Sell all sells a whole stack in one press', () => {
    const t = forge([['standard-arrow', 20]]);
    const all = find('[data-sell-all]');
    all.click();
    expect(t.pack()).toEqual([]);
    expect(t.crownsNow()).toBeGreaterThan(0);
  });

  it('AC-5: equipped gear is dimmed with the reason and cannot be sold', () => {
    const t = setup(game, 0);
    t.rules.add(t.sim, t.player, 'arming-sword', 1);
    const sword = inventoryOf(t.sim, t.player)?.items[0]?.instanceId ?? 0;
    addEquipment(t.sim, t.player, 'warrior');
    new EquipmentRules(game.all('item'), game.all('class')).equip(t.sim, t.player, sword);
    t.talk(t.counter(FORGE));
    tab('sell');
    const row = t.rows('sell')[0] as HTMLElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Unequip that first.');
    row.click();
    expect(t.crownsNow()).toBe(0);
    expect(t.pack()).toEqual([['arming-sword', 1]]);
    expect(failureText('equipped')).toBe('Unequip that first.');
  });

  it('AC-6: quest items stay listed last, dimmed, with the reason, and cannot be sold', () => {
    const t = forge([
      ['rusted-gallery-key', 1],
      ['kite-shield', 1],
    ]);
    t.rules.add(t.sim, t.player, 'arming-sword', 1, { stolen: true });
    t.world.step([]);
    t.shop.afterStep();
    const rows = t.rows('sell');
    expect(rows.map(label)).toEqual([
      'Sell Kite shield, 40 crowns',
      'Sell Arming sword',
      'Sell Rusted gallery key',
    ]);
    expect(rows[1]?.textContent).toContain('Only a fence buys stolen goods.');
    const key = rows[2] as HTMLElement;
    expect(key.getAttribute('aria-disabled')).toBe('true');
    expect(key.textContent).toContain('Quest items cannot be sold.');
    key.click();
    expect(t.pack()).toContainEqual(['rusted-gallery-key', 1]);
  });

  it('AC-7: a sale beyond his till is dimmed with "can’t afford" and nothing changes', () => {
    const t = forge([['tempered-mail-hauberk', 1]], 0); // 500 x 0.48 = 240 of 400
    expect(t.shop.shops.stateOf(t.sim, 'brand-forge').gold).toBe(400);
    (t.rows('sell')[0] as HTMLElement).click(); // 240: ok, till 160
    expect(t.crownsNow()).toBe(240);
    t.rules.add(t.sim, t.player, 'tempered-mail-hauberk', 1);
    t.talk(t.counter(FORGE));
    const row = document.querySelector<HTMLElement>('[data-shop-panel="sell"] .vb-shop-row');
    expect(row?.getAttribute('aria-disabled')).toBe('true');
    expect(row?.textContent).toContain('They cannot afford that just now.');
    expect(document.querySelector('[data-testid="shop-till"]')?.textContent).toBe(
      'Their crowns: 160 crowns',
    );
    row?.click();
    expect(t.crownsNow()).toBe(240);
  });

  it('AC-8: each shop’s buy list matches its trade', () => {
    const buys = (id: string) => game.all('merchant').find((m) => m.id === id)?.buysCategories;
    expect(buys('brand-forge')).toEqual(
      expect.arrayContaining(['weapon', 'armor', 'shield', 'ammo']),
    );
    expect(buys('brand-forge')).not.toContain('consumable');
    expect(buys('fenn-fletchery-simples')).toEqual(
      expect.arrayContaining(['ammo', 'weapon', 'consumable', 'misc']),
    );
    expect(buys('fenn-fletchery-simples')).not.toContain('armor');
    expect(buys('pell-bakery')).toEqual(['consumable']);
    expect(buys('sleeping-ox')).toEqual(['consumable']);
    expect(buys('marsh-general-store')).toEqual(
      expect.arrayContaining(['weapon', 'armor', 'shield', 'ammo', 'consumable', 'tool', 'misc']),
    );
  });

  it('AC-9: income sanity — a 45-minute valley haul of typical tier-2 drops sells for about 110 crowns', () => {
    // docs/design/economy.md: selling is about 110 crowns per 45 minutes; tier-2 skeletons drop weapon
    // or armour pieces of base value 20-60 (30% of kills), bought at value x 0.4 x 1.2 at the Forge.
    const drops: [string, number][] = [
      ['arming-sword', 40],
      ['open-helm', 45],
      ['leather-jerkin', 30],
      ['small-buckler', 45],
      ['riveted-boots', 60],
      ['utility-knife', 25],
    ];
    const t = forge(drops.map(([id]) => [id, 1] as const));
    for (const row of t.rows('sell')) row.click();
    expect(t.pack()).toEqual([]);
    // 19 + 22 + 14 + 18 + 29 + 12 = 114.
    expect(t.crownsNow()).toBe(114);
    expect(t.crownsNow()).toBeGreaterThanOrEqual(90);
    expect(t.crownsNow()).toBeLessThanOrEqual(140);
  });
});

describe('lesson refusals (mw-ju8.13)', () => {
  it('names the technique to learn first, else says the player is not ready', () => {
    const name = (id: string) => (id === 'technique.riposte' ? 'Riposte' : id);
    expect(
      lessonRefusalText(
        [{ reason: 'missing-prerequisite', capability: 'technique.riposte' }],
        name,
      ),
    ).toBe('Learn Riposte first.');
    expect(lessonRefusalText([{ reason: 'not-learnable' }], name)).toBe(
      'You are not ready for that yet.',
    );
    expect(lessonRefusalText(undefined, name)).toBe('You are not ready for that yet.');
  });
});
