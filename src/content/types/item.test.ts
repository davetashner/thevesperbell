import { describe, expect, expectTypeOf, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  FIXTURE_ITEM_IDS,
  ITEM_FIXTURE_ROOT,
  itemFixtureSources,
  loadItemFixtureContent,
} from '../test-fixtures.ts';
import {
  DEFAULT_NON_PROFICIENT_PENALTY,
  ITEM_CATEGORIES,
  ITEM_STACK_GUARD,
  itemIconProblems,
  itemKeys,
  itemSchema,
  MAX_PENALTY_MULTIPLIER,
  MAX_USE_SECONDS,
  type ItemDef,
  type ItemDefInput,
  type ItemEntry,
  type ItemOf,
} from './item.ts';

const content = loadItemFixtureContent();

/** A minimal valid misc item, extended per test. */
const misc = {
  id: 'test-item',
  category: 'misc',
  notes: 'Test.',
  icon: 'icon-item-test-01',
  value: 1,
} satisfies ItemDefInput;

const problems = (value: unknown): string[] =>
  (itemSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

const parse = (value: unknown): ItemDef => itemSchema.parse(value);

const file = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

/** Issues from loading the game's content plus `extra` files, or [] when it loads. */
function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('item fixtures (mw-e17.2)', () => {
  it('has one fixture file per category, read from its own root', () => {
    expect(Object.keys(FIXTURE_ITEM_IDS)).toEqual([...ITEM_CATEGORIES]);
    expect(
      itemFixtureSources()
        .map((s) => s.path)
        .filter((path) => path.startsWith(`${ITEM_FIXTURE_ROOT}/item/`))
        .sort(),
    ).toEqual(
      Object.values(FIXTURE_ITEM_IDS)
        .map((id) => `${ITEM_FIXTURE_ROOT}/item/${id}.json`)
        .sort(),
    );
  });

  it('AC-1: a valid fixture for each category validates, with its cross-references resolved', () => {
    for (const source of itemFixtureSources()) {
      if (!source.path.startsWith(`${ITEM_FIXTURE_ROOT}/item/`)) continue; // the locks keys open
      const json = JSON.parse(source.text) as Record<string, unknown>;
      delete json['$schema'];
      expect(problems(json), source.path).toEqual([]);
    }
    for (const [category, id] of Object.entries(FIXTURE_ITEM_IDS)) {
      expect(content.get('item', id).category).toBe(category);
    }
  });

  it('AC-1: the inferred type exposes category-specific fields once narrowed on category', () => {
    expectTypeOf<ItemOf<'armor'>['armor']['weightKg']>().toEqualTypeOf<number>();
    expectTypeOf<ItemOf<'shield'>['shield']['weightKg']>().toEqualTypeOf<number>();
    expectTypeOf<ItemOf<'key'>['key']['opens']>().toEqualTypeOf<string[]>();
    expectTypeOf<ItemOf<'book'>['book']['teaches']['kind']>().toEqualTypeOf<
      'spell' | 'insight' | 'lore'
    >();
    expectTypeOf<ItemOf<'misc'>>().not.toHaveProperty('armor');
    expectTypeOf<ItemOf<'currency'>>().not.toHaveProperty('equip');

    const read = (item: ItemEntry) => {
      switch (item.category) {
        case 'armor':
          return `${item.equip.slot} ${String(item.armor.weightKg)} kg`;
        case 'shield':
          return `${item.shield.profile.id} ${String(item.shield.weightKg)} kg`;
        case 'weapon':
          return item.weapon.moves.map((move) => move.id).join(',');
        case 'ammo':
          return item.ammo.arrow.id;
        case 'book':
          return item.book.teaches.kind;
        case 'key':
          return `${item.key.opens.join(',')} single-use ${String(item.key.singleUse)}`;
        default:
          return item.category;
      }
    };
    const fixtures = content.all('item').filter(({ id }) => id.startsWith('fixture-'));
    expect(fixtures.map(read)).toEqual([
      'standard',
      'quest',
      'tool',
      'currency',
      'artifact',
      'body 8 kg',
      'consumable',
      'misc',
      'spell',
      'sword-light-1,sword-light-2,sword-light-3',
      'fixture-tower-door single-use true',
      'wood-shield 3 kg',
    ]);
  });

  it('fills defaults: light weight class, no grants, plain flags, keys by convention', () => {
    const item = parse(misc);
    expect(item).toMatchObject({
      stackable: false,
      weightClass: 'light',
      grants: [],
      flags: { unique: false, questItem: false, noSell: false, noDrop: false },
    });
    expect(itemKeys(item)).toEqual({
      nameKey: 'item.test-item.name',
      descKey: 'item.test-item.desc',
    });
    expect(itemKeys({ ...item, nameKey: 'a.name', descKey: 'a.desc' })).toEqual({
      nameKey: 'a.name',
      descKey: 'a.desc',
    });
  });
});

describe('item schema: stacking (ADR-0003)', () => {
  it('AC-2: stackable false with maxStack 5 fails, naming the item id and the field', () => {
    expect(problems({ ...misc, stackable: false, maxStack: 5 })).toEqual([
      'maxStack: item "test-item": maxStack is only for stackable items (stackable is false)',
    ]);
    const issues = loadIssues([
      file('src/content/data/item/test-item.json', { ...misc, maxStack: 5 }),
    ]);
    expect(issues).toEqual([
      'src/content/data/item/test-item.json#/maxStack: item "test-item": maxStack is only for stackable items (stackable is false) (at maxStack)',
    ]);
  });

  it('a stackable item needs maxStack, at most the 9,999-unit technical guard', () => {
    expect(problems({ ...misc, stackable: true })).toEqual([
      'maxStack: item "test-item": a stackable item needs maxStack',
    ]);
    expect(problems({ ...misc, stackable: true, maxStack: ITEM_STACK_GUARD })).toEqual([]);
    expect(problems({ ...misc, stackable: true, maxStack: ITEM_STACK_GUARD + 1 })).toHaveLength(1);
  });

  it('unique items and equipment never stack; ammo and currency always do', () => {
    expect(problems({ ...misc, stackable: true, maxStack: 2, flags: { unique: true } })).toEqual([
      'stackable: item "test-item": a unique item cannot stack',
    ]);
    const charm = { ...misc, category: 'artifact', equip: { slot: 'trinket' } };
    expect(problems({ ...charm, stackable: true, maxStack: 2 })).toEqual([
      'stackable: item "test-item": equipment cannot stack (ADR-0003)',
    ]);
    expect(problems({ ...misc, category: 'currency' })).toEqual([
      'stackable: item "test-item": currency must be stackable',
    ]);
    expect(problems({ ...misc, category: 'ammo', ammo: { arrow: 'standard' } })).toEqual([
      'stackable: item "test-item": ammo must be stackable',
    ]);
  });
});

describe('item schema: weight (ADR-0003)', () => {
  const armor = {
    ...misc,
    category: 'armor',
    equip: { slot: 'head' },
    armor: { weightKg: 4 },
  } satisfies ItemDefInput;

  it('armor and shields carry kilograms; other categories cannot', () => {
    expect(problems(armor)).toEqual([]);
    expect(problems({ ...armor, armor: { weightKg: 0 } })).toHaveLength(1);
    expect(problems({ ...armor, armor: { weightKg: 21 } })).toHaveLength(1);
    expect(problems({ ...misc, weightKg: 1 })).toEqual([': Unrecognized key: "weightKg"']);
    const weapon = { ...misc, category: 'weapon', equip: { slot: 'main-hand' }, weapon: {} };
    expect(problems({ ...weapon, weapon: { weightKg: 2 } })).toEqual([
      'weapon: Unrecognized key: "weightKg"',
    ]);
  });

  it('armor goes in an armor slot and sets no noise multiplier of its own', () => {
    expect(problems({ ...armor, equip: { slot: 'off-hand' } })).toHaveLength(1);
    expect(problems({ ...armor, worldProperties: { noiseMultiplier: 1.6 } })).toEqual([
      'worldProperties.noiseMultiplier: item "test-item": armor sets noise through the load class, not per piece (ADR-0003)',
    ]);
    expect(problems({ ...misc, worldProperties: { noiseMultiplier: 1.5 } })).toEqual([]);
  });

  it('weightClass is light, medium or heavy', () => {
    expect(parse({ ...misc, weightClass: 'heavy' }).weightClass).toBe('heavy');
    expect(problems({ ...misc, weightClass: 'huge' })).toHaveLength(1);
  });
});

describe('item schema: non-proficiency penalty (mw-e17.4)', () => {
  const plate = {
    ...misc,
    category: 'armor',
    equip: { slot: 'body', proficiencies: ['heavy-armor'] },
    armor: { weightKg: 12 },
  } satisfies ItemDefInput;

  const penalty = (value: ItemDefInput) => {
    const item = parse(value);
    return 'equip' in item ? item.equip?.nonProficient : undefined;
  };

  it('defaults to DEFAULT_NON_PROFICIENT_PENALTY, field by field', () => {
    expect(penalty(plate)).toEqual(DEFAULT_NON_PROFICIENT_PENALTY);
    expect(
      penalty({ ...plate, equip: { ...plate.equip, nonProficient: { noiseMultiplier: 1.2 } } }),
    ).toEqual({ ...DEFAULT_NON_PROFICIENT_PENALTY, noiseMultiplier: 1.2 });
  });

  it('every multiplier is between 1 (no penalty) and the maximum', () => {
    const withPenalty = (nonProficient: unknown) => ({
      ...plate,
      equip: { ...plate.equip, nonProficient },
    });
    expect(problems(withPenalty({ drawTimeMultiplier: 1 }))).toEqual([]);
    expect(problems(withPenalty({ drawTimeMultiplier: MAX_PENALTY_MULTIPLIER }))).toEqual([]);
    expect(problems(withPenalty({ staminaCostMultiplier: 0.9 }))).toHaveLength(1);
    expect(problems(withPenalty({ noiseMultiplier: MAX_PENALTY_MULTIPLIER + 0.1 }))).toHaveLength(
      1,
    );
    expect(problems(withPenalty({ louder: 2 }))).toHaveLength(1);
  });
});

describe('item schema: categories and rules', () => {
  it('rejects an unknown category', () => {
    expect(problems({ ...misc, category: 'trophy' })).toHaveLength(1);
  });

  it('a consumable needs at least one use effect; boon steps are exactly +10', () => {
    const potion = { ...misc, category: 'consumable' };
    expect(problems(potion)).toEqual([
      'use: item "test-item": a consumable needs at least one use effect',
    ]);
    expect(problems({ ...potion, use: [] })).toHaveLength(1);
    const boon = { op: 'stat-step', pool: 'health', amount: 10 };
    expect(problems({ ...potion, use: [boon] })).toEqual([]);
    expect(problems({ ...potion, use: [{ ...boon, amount: 20 }] })).toHaveLength(1);
  });

  it('statuses and coatings are timed; a thrown item needs world properties (mw-e17.6)', () => {
    const potion = { ...misc, category: 'consumable' };
    const status = { op: 'status', status: 'warded', seconds: 30 };
    expect(problems({ ...potion, use: [status] })).toEqual([]);
    expect(problems({ ...potion, use: [{ ...status, seconds: 0 }] })).toHaveLength(1);
    expect(
      problems({ ...potion, use: [{ ...status, seconds: MAX_USE_SECONDS + 1 }] }),
    ).toHaveLength(1);
    const coat = { op: 'coat', properties: { flammable: true }, seconds: 60 };
    expect(problems({ ...potion, use: [coat] })).toEqual([]);
    expect(problems({ ...potion, use: [{ ...coat, properties: { wet: 1 } }] })).toHaveLength(1);
    expect(problems({ ...potion, use: [{ op: 'throw' }] })).toEqual([
      'use.0: item "test-item": a thrown item needs worldProperties (what it does where it lands)',
    ]);
    expect(
      problems({
        ...potion,
        worldProperties: { flammable: true, liquid: true },
        use: [{ op: 'throw' }],
      }),
    ).toEqual([]);
  });

  it('a key opens locks by id or by tag', () => {
    const key = { ...misc, category: 'key', key: {} };
    expect(problems(key)).toEqual(['key: item "test-item": a key needs opens or opensTag']);
    expect(problems({ ...key, key: { opensTag: 'tower' } })).toEqual([]);
  });

  it('only an equippable item grants while equipped', () => {
    const grants = [{ capability: 'verb.climb.rough', while: 'equipped' }];
    expect(problems({ ...misc, grants })).toEqual([
      'grants.0.while: item "test-item": only an equippable item can grant while equipped',
    ]);
    expect(problems({ ...misc, grants: [{ ...grants[0], while: 'carried' }] })).toEqual([]);
    expect(problems({ ...misc, grants: [{ capability: 'climb', while: 'carried' }] })).toHaveLength(
      1,
    );
  });

  it('names its icon by an item icon asset id', () => {
    expect(problems({ ...misc, icon: 'pebble' })).toHaveLength(1);
  });

  it('reports items whose icon the icon manifest does not list', () => {
    const items = [
      { id: 'a', icon: 'icon-item-a-01' },
      { id: 'b', icon: 'icon-item-b-01' },
    ];
    expect(itemIconProblems(items, ['icon-item-a-01'])).toEqual([
      'item:b uses icon "icon-item-b-01", which the icon manifest does not list',
    ]);
  });
});

describe('item loading (mw-e17.2)', () => {
  it('AC-3: two items with the same id fail to load, listing both source files', () => {
    const issues = loadIssues([
      file('src/content/data/item/a.json', misc),
      file('src/content/data/item/b.json', misc),
    ]);
    expect(issues).toEqual([
      'src/content/data/item/b.json#/id: duplicate id item:test-item: already defined in src/content/data/item/a.json',
    ]);
  });

  it('AC-4: an item granting an unknown capability fails validation against the registry, naming it', () => {
    const issues = loadIssues([
      file('src/content/data/item/test-item.json', {
        ...misc,
        category: 'artifact',
        equip: { slot: 'trinket' },
        grants: [
          { capability: 'spell.mage-hand', while: 'equipped' },
          { capability: 'verb.fly', while: 'equipped' },
        ],
      }),
    ]);
    expect(issues).toEqual([
      'src/content/data/item/test-item.json#/grants/1/capability: item:test-item names unknown capability "verb.fly": declare it in src/content/data/capability/',
    ]);
  });

  it('mw-e03.18: a key’s locks must be declared lock content, and a master key’s tag carried by one', () => {
    const lock = file('src/content/data/lock/tower.json', {
      id: 'tower',
      name: 'Tower',
      notes: 'Test.',
      tier: 1,
      tags: ['warden'],
    });
    const key = (data: unknown) =>
      file('src/content/data/item/test-item.json', { ...misc, category: 'key', key: data });
    expect(loadIssues([lock, key({ opens: ['tower'], opensTag: 'warden' })])).toEqual([]);
    expect(loadIssues([lock, key({ opens: ['tower', 'cellar'], opensTag: 'crypt' })])).toEqual([
      'src/content/data/item/test-item.json#/key/opens/1: item:test-item opens unknown lock "cellar": declare it in src/content/data/lock/',
      'src/content/data/item/test-item.json#/key/opensTag: item:test-item opens locks tagged "crypt", but no lock carries that tag',
    ]);
  });

  it('AC-4: books and learn effects name registry capabilities too', () => {
    const issues = loadIssues([
      file('src/content/data/item/book.json', {
        ...misc,
        id: 'book',
        category: 'book',
        book: {
          title: 'Book',
          author: 'Anon',
          pages: [{ textKey: 'item.book.text' }],
          teaches: { kind: 'insight', capability: 'spell.unknown-lore' },
          legality: 'licensed',
          rarity: 'common',
        },
      }),
      file('src/content/data/item/scroll.json', {
        ...misc,
        id: 'scroll',
        category: 'consumable',
        use: [
          { op: 'restore', pool: 'mana', amount: 5 },
          { op: 'learn', capability: 'trick.unknown-trick' },
        ],
      }),
    ]);
    expect(issues).toEqual([
      'src/content/data/item/book.json#/book/teaches/capability: item:book names unknown capability "spell.unknown-lore": declare it in src/content/data/capability/',
      'src/content/data/item/scroll.json#/use/1/capability: item:scroll names unknown capability "trick.unknown-trick": declare it in src/content/data/capability/',
    ]);
  });

  it('references other content: a shield profile, an arrow and moves must exist', () => {
    const issues = loadIssues([
      file('src/content/data/item/test-item.json', {
        ...misc,
        category: 'shield',
        equip: { slot: 'off-hand' },
        shield: { weightKg: 6, profile: 'kite-shield' },
      }),
    ]);
    expect(issues).toEqual([
      'src/content/data/item/test-item.json#/shield/profile: item:test-item references missing shield:kite-shield',
    ]);
  });
});

describe('item flags: quest items (ADR-0003)', () => {
  it('AC-5: questItem true without noSell and noDrop defaults both to true', () => {
    expect(parse({ ...misc, flags: { questItem: true } }).flags).toEqual({
      unique: false,
      questItem: true,
      noSell: true,
      noDrop: true,
    });
    expect(content.get('item', FIXTURE_ITEM_IDS.quest).flags).toEqual({
      unique: true,
      questItem: true,
      noSell: true,
      noDrop: true,
    });
  });

  it('AC-5: an explicit noSell or noDrop on a quest item is kept', () => {
    expect(parse({ ...misc, flags: { questItem: true, noSell: false } }).flags).toMatchObject({
      noSell: false,
      noDrop: true,
    });
  });

  it('an item of category quest is a quest item', () => {
    expect(parse({ ...misc, category: 'quest' }).flags.questItem).toBe(true);
    expect(problems({ ...misc, category: 'quest', flags: { questItem: false } })).toEqual([
      'flags.questItem: item "test-item": an item of category quest is a quest item',
    ]);
  });
});

describe('the shipped items (mw-e19.4 starting kits)', () => {
  describeContent('item', 'AC-1: validates and round-trips', (entry) => {
    expect(itemSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});
