import { describe, expect, it } from 'vitest';
import { loadDevContent } from '../dev-content.ts';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { ContentRef, serializeContent } from '../schema.ts';
import {
  BUY_RATE_BAND,
  MARKUP_BAND,
  MERCHANT_PERSONALITIES,
  merchantSchema,
  SPECIALTY_BONUS_BAND,
  STOLEN_FACTOR_BAND,
  type MerchantDefInput,
} from './merchant.ts';

const general = {
  id: 'test-general',
  notes: 'A test merchant.',
  npcId: 'test-npc',
  buysCategories: ['weapon', 'armor'],
  goldReserve: 100,
  markup: 1.3,
  buyRate: 0.4,
} satisfies MerchantDefInput;

const file = (json: unknown, id = 'test-general'): ContentSource => ({
  path: `src/content/data/merchant/${id}.json`,
  text: JSON.stringify(json),
});

/** Every problem loading the game content plus one merchant file. */
function loadIssues(json: unknown): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), file(json)], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.pointer}: ${i.message}`);
  }
  return [];
}

const problems = (value: unknown) =>
  (merchantSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('merchant schema', () => {
  it('fills defaults: no tags, specialties, stock or services, not a fence, no restock gold', () => {
    expect(merchantSchema.parse(general)).toEqual({
      ...general,
      personalityTags: [],
      specialties: [],
      stock: [],
      services: [],
      goldRestockPerDay: 0,
      isFence: false,
      buysStolen: false,
    });
  });

  it('lists the personality tags the design names', () => {
    expect(MERCHANT_PERSONALITIES).toEqual(
      expect.arrayContaining(['greedy', 'gossipy', 'suspicious']),
    );
  });

  it('round-trips stock refs through serialize → parse', () => {
    const def = merchantSchema.parse({
      ...general,
      stock: [
        { item: 'arming-sword', count: 2, restock: { everyHours: 24, amount: 1 } },
        { lootTable: 'testbed-sundries', count: 1 },
      ],
    } satisfies MerchantDefInput);
    expect(def.stock[0]?.item).toEqual(new ContentRef('item', 'arming-sword'));
    expect(def.stock[1]?.lootTable).toEqual(new ContentRef('loot-table', 'testbed-sundries'));
    expect(merchantSchema.parse(JSON.parse(serializeContent(def)))).toEqual(def);
  });

  it('rejects a stock entry naming both or neither of item and lootTable', () => {
    expect(problems({ ...general, stock: [{ item: 'a', lootTable: 'b', count: 1 }] })).toEqual([
      'stock.0: a stock entry names exactly one of `item` or `lootTable`',
    ]);
    expect(problems({ ...general, stock: [{ count: 1 }] })).toEqual([
      'stock.0: a stock entry names exactly one of `item` or `lootTable`',
    ]);
  });

  it('rejects equal open and close hours and an empty buysCategories', () => {
    expect(problems({ ...general, hours: { open: 8, close: 8 } })).toEqual([
      'hours.close: open and close must differ (omit `hours` for always open)',
    ]);
    expect(problems({ ...general, hours: { open: 20, close: 4 } })).toEqual([]);
    expect(problems({ ...general, buysCategories: [] })).toHaveLength(1);
  });

  it('rejects a specialty the merchant does not buy', () => {
    expect(problems({ ...general, specialties: ['tool'] })).toEqual([
      'specialties.0: merchant "test-general": specialty "tool" must also be in buysCategories',
    ]);
    expect(problems({ ...general, specialties: ['weapon'] })).toEqual([]);
  });

  it('AC-4: isFence false with buysStolen true fails, naming the merchant and field', () => {
    expect(problems({ ...general, buysStolen: true })).toEqual([
      'buysStolen: merchant "test-general": only a fence (isFence: true) may buy stolen goods',
    ]);
    expect(problems({ ...general, isFence: true, buysStolen: true })).toEqual([]);
    expect(problems({ ...general, isFence: true })).toEqual([]);
  });

  it('rejects stolenFactor on a merchant that does not buy stolen goods', () => {
    expect(problems({ ...general, isFence: true, stolenFactor: 0.6 })).toEqual([
      'stolenFactor: merchant "test-general": stolenFactor needs buysStolen: true',
    ]);
  });
});

describe('merchant checks', () => {
  it('AC-1: the two fixture merchants validate (and load with their item and loot-table refs)', () => {
    const merchants = loadDevContent()
      .all('merchant')
      .filter((m) => m.id.startsWith('fixture-'));
    expect(merchants.map((m) => m.id)).toEqual(['fixture-fence', 'fixture-general-goods']);
    const [fence, shop] = merchants;
    expect(fence?.isFence && fence.buysStolen).toBe(true);
    expect(shop?.isFence).toBe(false);
  });

  it('AC-1: a valid merchant file loads with the game content', () => {
    expect(loadIssues(general)).toEqual([]);
  });

  it('AC-2: a markup outside the economy band fails naming the merchant and field', () => {
    expect(loadIssues({ ...general, markup: 1.8 })).toEqual([
      '/markup: merchant:test-general markup 1.8 is outside the economy band 1.1-1.5 (docs/design/economy.md)',
    ]);
    expect(loadIssues({ ...general, markup: 1.05 })).toHaveLength(1);
  });

  it('AC-2: buyRate, specialtyBonus and stolenFactor are held to their bands too', () => {
    expect(loadIssues({ ...general, buyRate: 0.7 })).toEqual([
      '/buyRate: merchant:test-general buyRate 0.7 is outside the economy band 0.3-0.6 (docs/design/economy.md)',
    ]);
    expect(loadIssues({ ...general, specialties: ['weapon'], specialtyBonus: 2 })).toEqual([
      '/specialtyBonus: merchant:test-general specialtyBonus 2 is outside the economy band 1.1-1.3 (docs/design/economy.md)',
    ]);
    expect(loadIssues({ ...general, isFence: true, buysStolen: true, stolenFactor: 0.95 })).toEqual(
      [
        '/stolenFactor: merchant:test-general stolenFactor 0.95 is outside the economy band 0.5-0.8 (docs/design/economy.md)',
      ],
    );
  });

  it('mw-ju8.6: a room for the night is held to the inn-bed band, and service ids are unique', () => {
    const room = { id: 'room', name: 'Room', price: 12, kind: 'rest' };
    expect(loadIssues({ ...general, services: [room] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...room, price: 8 }] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...room, price: 15 }] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...room, price: 16 }] })).toEqual([
      '/services/0/price: merchant:test-general service room costs 16, outside the inn-bed band 8-15 (docs/design/economy.md)',
    ]);
    expect(loadIssues({ ...general, services: [{ ...room, price: 7 }] })).toHaveLength(1);
    expect(problems({ ...general, services: [room, room] })).toEqual([
      'services.1.id: merchant "test-general": service "room" is listed twice',
    ]);
    expect(problems({ ...general, services: [{ ...room, kind: 'bribe' }] })).toHaveLength(1);
  });

  it('AC-1: a train service names its capability and costs 100-400 crowns (mw-ju8.13)', () => {
    const lesson = {
      id: 'riposte',
      name: 'Riposte',
      price: 150,
      kind: 'train',
      teaches: 'technique.riposte',
    };
    expect(loadIssues({ ...general, services: [lesson] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...lesson, price: 100 }] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...lesson, price: 400 }] })).toEqual([]);
    expect(loadIssues({ ...general, services: [{ ...lesson, price: 401 }] })).toEqual([
      '/services/0/price: merchant:test-general service riposte costs 401, outside the trainer band 100-400 (docs/design/economy.md)',
    ]);
    expect(loadIssues({ ...general, services: [{ ...lesson, price: 99 }] })).toHaveLength(1);
    expect(problems({ ...general, services: [{ ...lesson, teaches: undefined }] })).toEqual([
      'services.0.teaches: merchant "test-general": lesson "riposte" must name the capability it teaches',
    ]);
    expect(
      problems({
        ...general,
        services: [
          { id: 'room', name: 'Room', price: 12, kind: 'rest', teaches: 'technique.parry' },
        ],
      }),
    ).toEqual([
      'services.0.teaches: merchant "test-general": only a train service teaches (service "room")',
    ]);
  });

  it('AC-2: a markup just inside or outside the band edge', () => {
    expect(loadIssues({ ...general, markup: 1.1 })).toEqual([]);
    expect(loadIssues({ ...general, markup: 1.0999 })).toHaveLength(1);
  });

  it('AC-2: band edges are inside the band', () => {
    for (const [field, band] of [
      ['markup', MARKUP_BAND],
      ['buyRate', BUY_RATE_BAND],
    ] as const) {
      expect(loadIssues({ ...general, [field]: band.min })).toEqual([]);
      expect(loadIssues({ ...general, [field]: band.max })).toEqual([]);
    }
    expect(
      loadIssues({
        ...general,
        specialties: ['weapon'],
        specialtyBonus: SPECIALTY_BONUS_BAND.max,
        isFence: true,
        buysStolen: true,
        stolenFactor: STOLEN_FACTOR_BAND.min,
      }),
    ).toEqual([]);
  });

  it('AC-3: stock naming a missing item or loot table fails with the reference', () => {
    expect(loadIssues({ ...general, stock: [{ item: 'no-such-item', count: 1 }] })).toEqual([
      '/stock/0/item: merchant:test-general references missing item:no-such-item',
    ]);
    expect(loadIssues({ ...general, stock: [{ lootTable: 'no-such-table', count: 1 }] })).toEqual([
      '/stock/0/lootTable: merchant:test-general references missing loot-table:no-such-table',
    ]);
  });

  it('refuses currency and quest items in stock', () => {
    expect(loadIssues({ ...general, stock: [{ item: 'gold', count: 5 }] })).toEqual([
      '/stock/0/item: merchant:test-general stocks currency item "gold", which a merchant cannot sell',
    ]);
    expect(
      loadIssues({ ...general, stock: [{ lootTable: 'testbed-sundries', count: 1 }] }),
    ).toEqual([]);
  });

  it('refuses a quest item in stock', () => {
    const questItem: ContentSource = {
      path: 'src/content/data/item/test-quest-thing.json',
      text: JSON.stringify({
        id: 'test-quest-thing',
        category: 'quest',
        notes: 'A test quest item.',
        icon: 'icon-item-test-quest-thing-01',
        value: 0,
      }),
    };
    try {
      loadContent(
        contentTypes,
        [
          ...gameContentSources(),
          questItem,
          file({ ...general, stock: [{ item: 'test-quest-thing', count: 1 }] }),
        ],
        contentChecks,
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ContentLoadError).issues.map((i) => i.message)).toContain(
        'merchant:test-general stocks quest item "test-quest-thing", which a merchant cannot sell',
      );
    }
  });
});
