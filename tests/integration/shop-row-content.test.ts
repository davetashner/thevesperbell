// mw-ju8.5: the village shop row, the data side: every merchant file (identity, stock, buy list,
// economy bands) and the owner's shop list (2026-10-04) against the whole item catalogue. The scene
// they stand in is briar-glen-lane (briar-glen-lane.test.ts, e2e/briar-glen-lane.spec.ts).

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';

const content = loadGameContent();
// The college's instructors sell lessons, not goods (tests/integration/bridgeward-college.test.ts).
const merchants = content
  .all('merchant')
  .filter((merchant) => !merchant.services.some((service) => service.kind === 'train'));
const items = content.all('item');
const itemIds = new Set(items.map((item) => item.id));

/**
 * What a shop never sells: currency, keys, the slice's worthless oddity, and the salvage skeletons
 * drop (mw-ju8.19), which shops only buy.
 */
const NOT_FOR_SALE = new Set([
  'gold',
  'rusted-gallery-key',
  'testbed-closet-key',
  'valley-chest-key',
  'miners-tally-stick',
  'bent-pick-head',
  'rusted-lamp-hook',
  'rusted-knife',
  'rusted-arming-sword',
  'dented-iron-cap',
]);

/** The owner's shop list, as predicates over an item id and its definition. */
const CLOTHES = new Set([
  'peasant-tunic',
  'wool-cloak',
  'hooded-travelling-cloak',
  'merchants-coat',
  'travelling-robe',
]);
type Item = (typeof items)[number];
const OWNER_CATEGORIES: Record<string, (item: Item) => boolean> = {
  clothes: (i) => CLOTHES.has(i.id),
  staves: (i) => i.category === 'weapon' && i.id.endsWith('staff'),
  swords: (i) => i.category === 'weapon' && i.id.endsWith('sword'),
  armor: (i) => i.category === 'armor' && i.equip.slot === 'body' && !CLOTHES.has(i.id),
  helmets: (i) => i.category === 'armor' && i.equip.slot === 'head',
  gloves: (i) => i.category === 'armor' && i.equip.slot === 'hands',
  boots: (i) => i.category === 'armor' && i.equip.slot === 'feet',
  shields: (i) => i.category === 'shield',
  knives: (i) => i.category === 'weapon' && i.id.endsWith('knife'),
  bows: (i) => i.category === 'weapon' && /(bow)$/.test(i.id),
  arrows: (i) => i.category === 'ammo',
  food: (i) =>
    [
      'bread-loaf',
      'hot-pie',
      'hard-cheese-wedge',
      'smoked-sausage',
      'apple',
      'travelling-rations',
    ].includes(i.id),
  scrolls: (i) => i.category === 'book' && i.id.startsWith('scroll-'),
  potions: (i) => /(draught|tonic)$/.test(i.id),
  ingredients: (i) =>
    [
      'bellwort-root',
      'dried-nightshade',
      'glenstone-dust',
      'mushroom-caps',
      'red-clay',
      'spider-silk',
    ].includes(i.id),
  jars: (i) => i.id.endsWith('jar') || i.id.startsWith('jar-of'),
};

const stockedBy = (itemId: string): string[] =>
  merchants.filter((m) => m.stock.some((line) => line.item?.id === itemId)).map((m) => m.id);

const SHOPS = [
  ['brand-forge', 'npc-oswin', 'Oswin Brand', "Brand's Forge"],
  ['fenn-fletchery-simples', 'npc-juniper', 'Juniper Fenn', "Fenn's Fletchery & Simples"],
  ['pell-bakery', 'npc-hollis', 'Hollis Pell', "Pell's Bakery"],
  ['marsh-general-store', 'npc-ottilie', 'Ottilie Marsh', "Marsh's General Store"],
] as const;

describe('the village shop row merchants (mw-ju8.5)', () => {
  for (const [id, npc, name, shop] of SHOPS) {
    it(`AC-1: ${id} speaks through ${npc} and is named ${name} (${shop})`, ({ task }) => {
      markExercised(task, 'merchant', id);
      markExercised(task, 'creature', npc);
      const merchant = content.get('merchant', id);
      expect(merchant.npcId).toBe(npc);
      expect(content.has('creature', npc)).toBe(true);
      expect(merchant.displayName).toBe(name);
      expect(merchant.shopName).toBe(shop);
    });
  }

  it('AC-1: every stocked item exists, is sellable and is stocked in a positive count', () => {
    for (const merchant of merchants) {
      expect(merchant.stock.length, merchant.id).toBeGreaterThan(0);
      for (const line of merchant.stock) {
        const id = line.item?.id ?? '';
        expect(itemIds.has(id), `${merchant.id} stocks unknown ${id}`).toBe(true);
        expect(NOT_FOR_SALE.has(id), `${merchant.id} stocks ${id}`).toBe(false);
        expect(line.count).toBeGreaterThan(0);
        if (line.restock) expect(line.restock.amount).toBeLessThanOrEqual(line.count);
      }
      const ids = merchant.stock.map((line) => line.item?.id);
      expect(new Set(ids).size, `${merchant.id} stocks an item twice`).toBe(ids.length);
    }
  });

  it('AC-1: prices sit in the economy bands and every specialty is a bought category', () => {
    for (const merchant of merchants) {
      expect(merchant.markup).toBeGreaterThanOrEqual(1.1);
      expect(merchant.markup).toBeLessThanOrEqual(1.5);
      expect(merchant.buyRate).toBeGreaterThanOrEqual(0.3);
      expect(merchant.buyRate).toBeLessThanOrEqual(0.6);
      expect(merchant.goldReserve).toBeGreaterThan(0);
      expect(merchant.isFence).toBe(false);
      expect(merchant.buysCategories).not.toContain('key');
      expect(merchant.buysCategories).not.toContain('quest');
      for (const specialty of merchant.specialties) {
        expect(merchant.buysCategories).toContain(specialty);
      }
    }
  });

  it('AC-1: every catalogue item is stocked by at least one shop', () => {
    const unstocked = items
      .filter((item) => !NOT_FOR_SALE.has(item.id) && stockedBy(item.id).length === 0)
      .map((item) => item.id);
    expect(unstocked).toEqual([]);
  });

  it.each(Object.keys(OWNER_CATEGORIES))(
    'AC-1: the owner’s %s are on sale, every one of them',
    (category) => {
      const matching = items
        .filter(OWNER_CATEGORIES[category] ?? (() => false))
        .filter((item) => !NOT_FOR_SALE.has(item.id));
      expect(matching.length, `no ${category} in the catalogue`).toBeGreaterThan(0);
      for (const item of matching) {
        expect(stockedBy(item.id), `${item.id} (${category}) has no shop`).not.toEqual([]);
      }
    },
  );

  it('AC-1: each specialist shop sells what its keeper is known for', () => {
    const sells = (shop: string, itemId: string) => stockedBy(itemId).includes(shop);
    expect(sells('brand-forge', 'longsword')).toBe(true);
    expect(sells('brand-forge', 'kettle-helm')).toBe(true);
    expect(sells('fenn-fletchery-simples', 'yew-longbow')).toBe(true);
    expect(sells('fenn-fletchery-simples', 'scroll-of-firebolt')).toBe(true);
    expect(sells('fenn-fletchery-simples', 'empty-glass-jar')).toBe(true);
    expect(sells('pell-bakery', 'bread-loaf')).toBe(true);
    expect(content.get('merchant', 'brand-forge').specialties).toEqual(['weapon', 'armor']);
    expect(content.get('merchant', 'fenn-fletchery-simples').specialties).toEqual([
      'ammo',
      'consumable',
    ]);
    expect(content.get('merchant', 'pell-bakery').buysCategories).toEqual(['consumable']);
  });

  it('AC-1: Marsh’s original stock is all still there', () => {
    const marsh = content.get('merchant', 'marsh-general-store');
    const ids = marsh.stock.map((line) => line.item?.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'arming-sword',
        'hunting-knife',
        'shortbow',
        'ash-staff',
        'standard-arrow',
        'leather-jerkin',
        'mail-hauberk',
        'wooden-shield',
        'travelling-robe',
        'healing-draught',
        'mana-draught',
        'oil-flask',
        'lockpicks',
      ]),
    );
  });
});
