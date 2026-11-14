import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent, markExercised } from '../testing.ts';
import {
  CLASS_CARD_VERBS,
  CLASS_CHANNELS,
  CLASS_PITCH_MAX,
  CLASS_VERB_MAX,
  checkClasses,
  classKeys,
  classSchema,
  STAT_CAP,
  type ClassDefInput,
} from './class.ts';
import { PLAYER_CLASSES } from './controller.ts';

const content = loadContent(contentTypes, gameContentSources(), contentChecks);

/** A valid class file to vary per test (the thief, by default, so it replaces the shipped one). */
const thief = (over: Partial<ClassDefInput> = {}): ClassDefInput => ({
  id: 'thief',
  name: 'Thief',
  notes: 'Test.',
  pitch: 'A test thief.',
  verbs: ['Pick locks', 'Pickpocket', 'Climb'],
  dialogueTag: 'thief',
  iconId: 'ui-emblem-class-thief-01',
  portraitId: 'keyart-class-card-thief-01',
  startingCapabilities: ['verb.climb.ledge', 'verb.climb.rough'],
  mvpCapabilities: ['verb.climb.ledge', 'verb.climb.rough', 'tool.lockpick'],
  signature: ['tool.lockpick'],
  startingKit: { gold: 10, items: [{ item: 'lockpicks', equip: true }] },
  proficiencies: ['daggers', 'blades', 'light-armor'],
  armorCapacityKg: 23,
  stats: { health: 90, stamina: 110, mana: 30 },
  unlockChannels: ['tool', 'trick', 'deed'],
  ...over,
});

const THIEF_FILE = 'src/content/data/class/thief.json';

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

/** Issues from loading the game's content with the thief file replaced and `extra` files added. */
function loadIssues(def: unknown, extra: readonly ContentSource[] = []): string[] {
  const sources = gameContentSources().filter((s) => s.path !== THIEF_FILE);
  try {
    loadContent(contentTypes, [...sources, source(THIEF_FILE, def), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    // The world map's classesHint check (mw-e24.1) reacts to a broken thief too; it has its own tests.
    return error.issues
      .filter((i) => !i.file.startsWith('src/content/data/world/'))
      .map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const problems = (value: unknown): string[] =>
  (classSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('class data (mw-e19.4)', () => {
  it('AC-1: there is one class file per playable class, with unique dialogue tags', ({ task }) => {
    const classes = content.all('class');
    for (const { id } of classes) markExercised(task, 'class', id);
    expect(classes.map(({ id }) => id).sort()).toEqual([...PLAYER_CLASSES].sort());
    const tags = classes.map(({ dialogueTag }) => dialogueTag);
    expect(new Set(tags).size).toBe(4);
  });

  describeContent(
    'class',
    'AC-1: has ≥ 2 starting capabilities, a resolving kit and its icon ids',
    (def, loaded) => {
      expect(def.startingCapabilities.length).toBeGreaterThanOrEqual(2);
      const declared = new Set(
        loaded.all('capability').flatMap((g) => g.capabilities.map(({ id }) => id)),
      );
      for (const id of [...def.startingCapabilities, ...def.signature]) {
        expect(declared.has(id), id).toBe(true);
      }
      for (const { item } of def.startingKit.items) {
        expect(loaded.resolve(item).id).toBe(item.id);
      }
      expect(def.iconId).toBe(`ui-emblem-class-${def.id}-01`);
      expect(def.portraitId).toBe(`keyart-class-card-${def.id}-01`);
      expect(def.unlockChannels.length).toBeGreaterThan(0);
      expect(classSchema.parse(JSON.parse(serializeContent(def)))).toEqual(def);
    },
  );

  it('matches the ADR-0004 stats table and the ADR-0003 armor capacities', ({ task }) => {
    const rows = Object.fromEntries(
      content.all('class').map((def) => {
        markExercised(task, 'class', def.id);
        return [def.id, [def.stats.health, def.stats.stamina, def.stats.mana, def.armorCapacityKg]];
      }),
    );
    expect(rows).toEqual({
      knight: [120, 100, 20, 30],
      archer: [100, 100, 30, 23],
      thief: [90, 110, 30, 23],
      sorcerer: [80, 80, 100, 23],
    });
  });

  it('gives each class its fantasy: thief rough climbing, archer tracking, ADR-0004 signatures', ({
    task,
  }) => {
    const get = (id: (typeof PLAYER_CLASSES)[number]) => {
      markExercised(task, 'class', id);
      return content.get('class', id);
    };
    expect(get('thief').startingCapabilities).toContain('verb.climb.rough');
    expect(get('archer').startingCapabilities).toContain('sense.tracking');
    expect(get('knight').signature).toContain('technique.parry');
    expect(get('archer').signature).toContain('arrow.rope');
    expect(get('thief').signature).toEqual(['tool.lockpick', 'trick.pickpocket']);
    expect(get('sorcerer').signature).toEqual([
      'spell.firebolt',
      'spell.flame-jet',
      'spell.fire-wall',
    ]);
    // The thief's lockpicks grant the lock signature while carried.
    const lockpicks = content.get('item', 'lockpicks');
    expect(lockpicks.grants).toEqual([{ capability: 'tool.lockpick', while: 'carried' }]);
    expect(get('thief').startingKit.items.map(({ item }) => item.id)).toContain('lockpicks');
    expect(get('knight').unlockChannels[0]).toBe('trainer');
    expect(get('sorcerer').unlockChannels[0]).toBe('book');
    expect(get('archer').unlockChannels[0]).toBe('schematic');
    expect(get('thief').unlockChannels[0]).toBe('tool');
  });

  it('AC-2: fails when a starting capability is not in the registry, naming class and id', () => {
    const issues = loadIssues(
      thief({
        startingCapabilities: ['verb.climb.ledge', 'verb.climb.walls'],
        mvpCapabilities: ['verb.climb.ledge', 'verb.climb.walls'],
      }),
    );
    // The MVP profile names the same unknown capability; one issue per field.
    expect(issues).toEqual([
      `${THIEF_FILE}#/startingCapabilities/1: class:thief names unknown capability "verb.climb.walls": declare it in src/content/data/capability/`,
      `${THIEF_FILE}#/mvpCapabilities/1: class:thief names unknown capability "verb.climb.walls": declare it in src/content/data/capability/`,
    ]);
  });

  it("mw-e15.8: the MVP milestone profile must hold the starting capabilities, declared and the class's own", () => {
    const issues = loadIssues(thief({ mvpCapabilities: ['verb.climb.ledge', 'verb.climb.walls'] }));
    expect(issues).toEqual([
      `${THIEF_FILE}#/mvpCapabilities/1: class:thief names unknown capability "verb.climb.walls": declare it in src/content/data/capability/`,
      `${THIEF_FILE}#/mvpCapabilities: class:thief mvpCapabilities lacks its starting capability "verb.climb.rough": the milestone profile includes everything the class starts with`,
    ]);
    expect(
      loadIssues(
        thief({
          mvpCapabilities: ['verb.climb.ledge', 'verb.climb.rough', 'technique.riposte'],
        }),
      ).filter((m) => m.includes('riposte')),
    ).toEqual([
      `${THIEF_FILE}#/mvpCapabilities/2: class:thief holds "technique.riposte" at the MVP milestone, a knight capability`,
      `${THIEF_FILE}#/mvpCapabilities/2: class:thief holds "technique.riposte" at the MVP milestone without its prerequisite "technique.parry"`,
    ]);
  });

  it('AC-3: fails when a class has no unlock channel (every class must be able to progress)', () => {
    expect(problems(thief({ unlockChannels: [] }))).toEqual([
      'unlockChannels: a class needs at least one unlock channel: every class must be able to progress',
    ]);
    const without: Partial<ClassDefInput> = thief();
    delete without.unlockChannels;
    expect(problems(without)).toEqual([
      'unlockChannels: Invalid input: expected array, received undefined',
    ]);
    expect(loadIssues(thief({ unlockChannels: [] }))).toEqual([
      `${THIEF_FILE}#/unlockChannels: a class needs at least one unlock channel: every class must be able to progress (at unlockChannels)`,
      // The broken class file loads as missing, so a loot entry conditioned on it fails too.
      'src/content/data/loot-table/testbed-supply-crate.json#/entries/1/conditions/class/0: loot-table:testbed-supply-crate references missing class:thief',
    ]);
    expect(CLASS_CHANNELS).toEqual(['book', 'trainer', 'schematic', 'trick', 'deed', 'tool']);
  });
});

describe('class schema (mw-e19.4)', () => {
  it('accepts a full class and defaults the kit items', () => {
    expect(problems(thief())).toEqual([]);
    const parsed = classSchema.parse(
      thief({ startingKit: { gold: 0, items: [{ item: 'lockpicks' }] } }),
    );
    expect(parsed.startingKit.items[0]).toMatchObject({ count: 1, equip: false });
    expect(classSchema.parse(thief({ startingKit: { gold: 0 } })).startingKit.items).toEqual([]);
  });

  it('rejects too few capabilities, repeats, bad asset ids and stats over the cap', () => {
    expect(
      problems(
        thief({
          startingCapabilities: ['verb.climb.ledge'],
          signature: [],
          iconId: 'icon-thief',
          portraitId: 'portrait-thief',
          stats: { health: STAT_CAP + 1, stamina: 0, mana: 30 },
          armorCapacityKg: 0,
        }),
      ),
    ).toEqual([
      'iconId: must be a class emblem asset id, e.g. "ui-emblem-class-thief-01"',
      'portraitId: must be a class card asset id, e.g. "keyart-class-card-thief-01"',
      'startingCapabilities: a class starts with at least 2 capabilities',
      'signature: a class needs at least one signature capability',
      'armorCapacityKg: Too small: expected number to be >0',
      'stats.health: Too big: expected number to be <=200',
      'stats.stamina: Too small: expected number to be >=1',
    ]);
    expect(
      problems(
        thief({
          startingCapabilities: ['verb.climb.ledge', 'verb.climb.ledge'],
          mvpCapabilities: ['verb.climb.ledge', 'verb.climb.ledge'],
          signature: ['tool.lockpick', 'tool.lockpick'],
          proficiencies: ['blades', 'blades'],
          unlockChannels: ['tool', 'tool'],
          startingKit: { gold: 0, items: [{ item: 'lockpicks' }, { item: 'lockpicks' }] },
        }),
      ),
    ).toEqual([
      'startingCapabilities.1: "verb.climb.ledge" is listed twice',
      'mvpCapabilities.1: "verb.climb.ledge" is listed twice',
      'signature.1: "tool.lockpick" is listed twice',
      'proficiencies.1: "blades" is listed twice',
      'unlockChannels.1: "tool" is listed twice',
      'startingKit.items.1.item: "lockpicks" is listed twice: raise its count instead',
    ]);
    expect(problems(thief({ id: 'bard' as 'thief' }))[0]).toMatch(/^id: Invalid option/);
  });

  it('needs a short card pitch and exactly three card verbs (mw-e19.5)', () => {
    expect(
      problems(
        thief({
          pitch: 'x'.repeat(CLASS_PITCH_MAX + 1),
          verbs: ['Pick locks', 'x'.repeat(CLASS_VERB_MAX + 1)],
        }),
      ),
    ).toEqual([
      `pitch: Too big: expected string to have <=${String(CLASS_PITCH_MAX)} characters`,
      `verbs.1: Too big: expected string to have <=${String(CLASS_VERB_MAX)} characters`,
      `verbs: Too small: expected array to have exactly ${String(CLASS_CARD_VERBS)} items`,
    ]);
    for (const def of content.all('class')) expect(def.verbs).toHaveLength(CLASS_CARD_VERBS);
  });

  it('names its localisation keys by convention unless set', () => {
    expect(classKeys({ id: 'thief' })).toEqual({
      nameKey: 'class.thief.name',
      descKey: 'class.thief.desc',
    });
    expect(classKeys({ id: 'thief', nameKey: 'a.b', descKey: 'c.d' })).toEqual({
      nameKey: 'a.b',
      descKey: 'c.d',
    });
  });
});

describe('class content checks (mw-e19.4)', () => {
  const T = `${THIEF_FILE}#`;

  it('rejects another class’s starting capability and unknown or foreign signatures', () => {
    const issues = loadIssues(
      thief({
        startingCapabilities: ['verb.climb.ledge', 'technique.parry'],
        mvpCapabilities: ['verb.climb.ledge', 'technique.parry'],
        signature: ['tool.lockpick', 'trick.vanish', 'spell.mage-hand', 'arrow.rope'],
      }),
    );
    expect(issues).toEqual([
      `${T}/startingCapabilities/1: class:thief starts with "technique.parry", a knight capability: a class starts with its own or shared capabilities`,
      `${T}/mvpCapabilities/1: class:thief holds "technique.parry" at the MVP milestone, a knight capability`,
      `${T}/signature/1: class:thief names unknown capability "trick.vanish": declare it in src/content/data/capability/`,
      `${T}/signature/2: class:thief signature "spell.mage-hand" needs classAffinity "thief" (it has none)`,
      `${T}/signature/3: class:thief signature "arrow.rope" needs classAffinity "thief" (it has archer)`,
    ]);
  });

  it('rejects a crossClass signature (ADR-0004 P6)', () => {
    const caps = source('src/content/data/capability/zz-test.json', {
      id: 'zz-test',
      name: 'Test',
      notes: 'Test.',
      capabilities: [
        {
          id: 'tool.zz-crowbar',
          name: 'Pry',
          description: 'Test.',
          classAffinity: 'thief',
          crossClass: true,
        },
      ],
    });
    expect(loadIssues(thief({ signature: ['tool.zz-crowbar'] }), [caps])).toEqual([
      `${T}/signature/0: class:thief signature "tool.zz-crowbar" is crossClass: signatures are never shared (ADR-0004 P6)`,
    ]);
  });

  it('rejects a dialogue tag another class already has', () => {
    expect(loadIssues(thief({ dialogueTag: 'archer' }))).toEqual([
      `${T}/dialogueTag: class:thief dialogueTag "archer" is already class:archer's`,
    ]);
  });

  it('rejects equipping what has no slot, several units, a filled slot or a lacking proficiency', () => {
    const issues = loadIssues(
      thief({
        proficiencies: ['daggers', 'light-armor'],
        startingKit: {
          gold: 0,
          items: [
            { item: 'healing-draught', equip: true },
            { item: 'hunting-knife', count: 2, equip: true },
            { item: 'shortbow', equip: true },
            { item: 'leather-jerkin', equip: true },
            { item: 'travelling-robe', equip: true },
            { item: 'mail-hauberk' },
          ],
        },
      }),
    );
    expect(issues).toEqual([
      `${T}/startingKit/items/0/equip: class:thief equips item:healing-draught, which has no equip slot`,
      `${T}/startingKit/items/1/count: class:thief equips item:hunting-knife with count 2: an equipped item is one unit`,
      `${T}/startingKit/items/2/equip: class:thief equips item:shortbow in main-hand, already filled by item:hunting-knife`,
      `${T}/startingKit/items/2/item: class:thief starts with item:shortbow equipped, which calls for proficiency "bows" the class lacks (equip.proficiencies/0)`,
      `${T}/startingKit/items/4/equip: class:thief equips item:travelling-robe in body, already filled by item:leather-jerkin`,
    ]);
  });

  it('rejects an item proficiency tag no class has, once classes are loaded', () => {
    const item = {
      id: 'zz-flail',
      category: 'weapon',
      notes: 'Test.',
      icon: 'icon-item-zz-flail-01',
      value: 1,
      equip: { slot: 'main-hand', proficiencies: ['blades', 'flails'] },
      weapon: { reach: 'medium' },
    };
    const file = 'src/content/data/item/zz-flail.json';
    expect(loadIssues(thief(), [source(file, item)])).toEqual([
      `${file}#/equip/proficiencies/1: item:zz-flail calls for proficiency "flails", which no class has: add it to a class in src/content/data/class/`,
    ]);
    // Without class data (a tool's subset of content) item tags are not checked.
    expect(checkClasses([{ type: 'item', file, value: { ...item, grants: [] } as never }])).toEqual(
      [],
    );
    // Run alone, a kit item the entries lack is left to the loader's reference check.
    expect(
      checkClasses([{ type: 'class', file: THIEF_FILE, value: classSchema.parse(thief()) }]).map(
        ({ pointer }) => pointer,
      ),
    ).toEqual([
      '/startingCapabilities/0',
      '/startingCapabilities/1',
      '/mvpCapabilities/0',
      '/mvpCapabilities/1',
      '/mvpCapabilities/2',
      '/signature/0',
    ]);
  });
});
