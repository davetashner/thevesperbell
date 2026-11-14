// The four playable classes as data (mw-e19.4): `src/content/data/class/<class>.json`, one file per
// class in PLAYER_CLASSES. Classes change possibilities (CONSTITUTION §2), and keeping what a class
// starts with, what it is proficient in and how it grows in data keeps class checks out of code and
// lets dialogue and quests gate on the same tag (`dialogueTag`, the [Thief] options of mw-e22.6).
//
// A class file holds:
// - `startingCapabilities`: registry ids granted at new game with the permanent `class` source
//   (ADR-0004). Applying them, the kit and the stats to a fresh player is mw-e19.5
//   (src/sim/progression/classes.ts).
// - `mvpCapabilities`: the class's capability profile at the MVP progression milestone (mw-e15.8): the
//   starting capabilities plus the first unlocks the slice offers (trainer, book, tool). The puzzle
//   coverage audit (src/tools/puzzle/coverage.ts) judges what each class can solve with exactly these.
// - `signature`: the capabilities that define the class fantasy and are never shared (ADR-0004's
//   "simple" rule, point 4): the knight's Parry, the archer's Rope Arrow, the thief's Lockpicks and
//   Pickpocket, the sorcerer's chains past their roots. Each must carry this class's affinity and
//   must not be `crossClass`.
// - `startingKit`: gold plus items (refs into src/content/data/item/), each optionally equipped.
//   Grey-box kits; the final kits are tuned during m2/m3.
// - `proficiencies`: the proficiency tags items call for in `equip.proficiencies` (weapon tags such as
//   "blades", armor tags such as "heavy-armor"). Soft (mw-e17.4): any class may equip anything, so the
//   tags only decide how well. Armor proficiency proper is `armorCapacityKg` (ADR-0003: knight 30,
//   everyone else 23), a class constant nothing raises.
// - `stats`: start values of the three supporting stats (ADR-0004 table), each at most the 200 cap.
// - `unlockChannels`: the progression channels that apply, the primary one first (ADR-0004: books,
//   trainers, schematics, tools, tricks, deeds). Every class needs one (ADR-0004 P8).
// - `iconId`, `portraitId`: the class emblem and class card art (`ui-emblem-class-…`,
//   `keyart-class-card-…`, style bible §15.1); placeholders until mw-e37 lands them.
//
// `checkClasses` runs across files at load: every capability a class names is declared (and, for a
// starting one, is not another class's), signatures belong to their class, dialogue tags are unique,
// equipped kit items are equippable, fit their slots and call only for the class's proficiencies,
// and every proficiency tag an item calls for is held by some class.

import { z } from 'zod';
import type { ContentCheck, ContentIssue, Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { capabilityId, localisationKey, type CapabilityGroup } from './capability.ts';
import { PLAYER_CLASSES, type PlayerClass } from './controller.ts';
import { ITEM_STACK_GUARD, type EquipSlot, type ItemDef } from './item.ts';
import { UNLOCK_CHANNELS, type UnlockGroup } from './unlock.ts';

/** The progression channels a class may grow through: the unlock channels plus carried tools. */
export const CLASS_CHANNELS = [...UNLOCK_CHANNELS, 'tool'] as const;
export type ClassChannel = (typeof CLASS_CHANNELS)[number];

/** Longest class card pitch, characters (it must fit the card at 2× text scale). */
export const CLASS_PITCH_MAX = 120;
/** How many signature verbs a class card lists (mw-e19.5). */
export const CLASS_CARD_VERBS = 3;
/** Longest class card verb, characters. */
export const CLASS_VERB_MAX = 24;

/** Hard cap of every supporting stat (ADR-0004). */
export const STAT_CAP = 200;

/** Upper bound for a class's armor capacity, kg (ADR-0003's knight has 30). */
export const MAX_ARMOR_CAPACITY_KG = 60;

/** The hand-carry limit of a class that does not say, kg (ADR-0003). */
export const DEFAULT_CARRY_LIMIT_KG = 25;

/** Upper bound for a class's hand-carry limit, kg. */
export const MAX_CARRY_LIMIT_KG = 60;

/** Class emblem asset ids (style bible §15.1), e.g. "ui-emblem-class-thief-01". */
export const CLASS_ICON_PATTERN = /^ui-emblem-class-[a-z0-9]+(?:-[a-z0-9]+)*-\d{2}$/;
/** Class card art asset ids (style bible §15.1), e.g. "keyart-class-card-thief-01". */
export const CLASS_PORTRAIT_PATTERN = /^keyart-class-card-[a-z0-9]+(?:-[a-z0-9]+)*-\d{2}$/;

/** Equip slots that hold one item; both-hands fills main-hand and off-hand. */
const SLOT_FILLS: Partial<Record<EquipSlot, readonly EquipSlot[]>> = {
  'main-hand': ['main-hand'],
  'off-hand': ['off-hand'],
  'both-hands': ['main-hand', 'off-hand'],
  head: ['head'],
  body: ['body'],
  hands: ['hands'],
  feet: ['feet'],
};

const statValue = (stat: string) =>
  z
    .int()
    .min(1)
    .max(STAT_CAP)
    .describe(`Starting ${stat} (ADR-0004 stats table); grows only in +10 steps up to the cap.`);

const kitItemSchema = z.strictObject({
  item: ref('item').describe('The item, from src/content/data/item/.'),
  count: z
    .int()
    .min(1)
    .max(ITEM_STACK_GUARD)
    .default(1)
    .describe('How many the player starts with.'),
  equip: z
    .boolean()
    .default(false)
    .describe('Starts equipped in its slot (a single unit of an equippable item).'),
});

/** Adds an issue for every repeated value in `list`, at `path.<index>`. */
function noRepeats(list: readonly string[], path: string, ctx: z.core.$RefinementCtx): void {
  const seen = new Set<string>();
  list.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: 'custom', path: [path, index], message: `"${value}" is listed twice` });
    }
    seen.add(value);
  });
}

/** Schema of one class file, `src/content/data/class/<class>.json`. */
export const classSchema = z
  .strictObject({
    id: z.enum(PLAYER_CLASSES).describe('The class: knight, archer, sorcerer or thief.'),
    name: z.string().min(1).describe('Display name, e.g. "Thief" (docs and debug tools).'),
    notes: z.string().min(1).describe('The class fantasy and where its data comes from.'),
    pitch: z
      .string()
      .min(1)
      .max(CLASS_PITCH_MAX)
      .describe(
        'The class card pitch on the new-game screen (mw-e19.5), until descKey text lands.',
      ),
    verbs: z
      .array(z.string().min(1).max(CLASS_VERB_MAX))
      .length(CLASS_CARD_VERBS)
      .describe('The three signature verbs the class card lists, e.g. "Parry" (mw-e19.5).'),
    nameKey: localisationKey
      .optional()
      .describe('Localisation key of the display name; absent = "class.<id>.name".'),
    descKey: localisationKey
      .optional()
      .describe('Localisation key of the class card pitch; absent = "class.<id>.desc".'),
    dialogueTag: contentId.describe(
      'Tag on class-gated dialogue options, shown as e.g. [Thief] (mw-e22.6). Unique per class.',
    ),
    iconId: z
      .string()
      .regex(CLASS_ICON_PATTERN, 'must be a class emblem asset id, e.g. "ui-emblem-class-thief-01"')
      .describe('Class emblem asset id (style bible §15.1); a placeholder until the art lands.'),
    portraitId: z
      .string()
      .regex(
        CLASS_PORTRAIT_PATTERN,
        'must be a class card asset id, e.g. "keyart-class-card-thief-01"',
      )
      .describe('Class card illustration asset id (style bible §15.1).'),
    startingCapabilities: z
      .array(capabilityId)
      .min(2, 'a class starts with at least 2 capabilities')
      .describe('Capabilities granted at new game, with the permanent class source (ADR-0004).'),
    mvpCapabilities: z
      .array(capabilityId)
      .min(2, 'the MVP milestone holds at least the starting capabilities')
      .describe(
        'The capability profile at the MVP progression milestone (mw-e15.8): the starting capabilities plus what the first trainers, books and tools give. The puzzle coverage audit (docs/design/puzzle-coverage.md) asks what a class with exactly these can solve.',
      ),
    signature: z
      .array(capabilityId)
      .min(1, 'a class needs at least one signature capability')
      .describe(
        'Capabilities that define the class and are never shared (ADR-0004 "simple" rule).',
      ),
    startingKit: z
      .strictObject({
        gold: z.int().nonnegative().describe('Starting gold.'),
        items: z.array(kitItemSchema).default([]).describe('Starting items.'),
      })
      .describe('What the player starts with (grey-box; tuned during m2/m3).'),
    proficiencies: z
      .array(contentId)
      .min(1)
      .describe(
        'Proficiency tags the class has, matching items’ equip.proficiencies, e.g. "blades", ' +
          '"heavy-armor", "shields". Soft (mw-e17.4).',
      ),
    armorCapacityKg: z
      .number()
      .positive()
      .max(MAX_ARMOR_CAPACITY_KG)
      .describe('Equipped armor weight at 100% load (ADR-0003: knight 30, others 23). Kilograms.'),
    carryLimitKg: z
      .number()
      .positive()
      .max(MAX_CARRY_LIMIT_KG)
      .default(DEFAULT_CARRY_LIMIT_KG)
      .describe(
        'Heaviest world object the class hand-carries, kilograms (ADR-0003, mw-e02.17: 25 by default); a class constant nothing raises.',
      ),
    stats: z
      .strictObject({
        health: statValue('health'),
        stamina: statValue('stamina'),
        mana: statValue('mana'),
      })
      .describe('Start values of the supporting stats.'),
    unlockChannels: z
      .array(z.enum(CLASS_CHANNELS))
      .min(1, 'a class needs at least one unlock channel: every class must be able to progress')
      .describe('Progression channels that apply, the primary one first (ADR-0004).'),
  })
  .superRefine((def, ctx) => {
    noRepeats(def.startingCapabilities, 'startingCapabilities', ctx);
    noRepeats(def.mvpCapabilities, 'mvpCapabilities', ctx);
    noRepeats(def.signature, 'signature', ctx);
    noRepeats(def.proficiencies, 'proficiencies', ctx);
    noRepeats(def.unlockChannels, 'unlockChannels', ctx);
    const items = def.startingKit.items.map(({ item }) => item.id);
    const seen = new Set<string>();
    items.forEach((id, index) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['startingKit', 'items', index, 'item'],
          message: `"${id}" is listed twice: raise its count instead`,
        });
      }
      seen.add(id);
    });
  });

/** A class as written in JSON. */
export type ClassDefInput = z.input<typeof classSchema>;
/** A validated class. */
export type ClassDef = z.output<typeof classSchema>;
/** A loaded (deeply frozen) class. */
export type ClassEntry = Frozen<ClassDef>;

/** The localisation keys of a class's name and card pitch (explicit or by convention). */
export function classKeys(def: Pick<ClassDef, 'id' | 'nameKey' | 'descKey'>): {
  nameKey: string;
  descKey: string;
} {
  return {
    nameKey: def.nameKey ?? `class.${def.id}.name`,
    descKey: def.descKey ?? `class.${def.id}.desc`,
  };
}

/** The class source's capabilities checked against the registry: declared and not another class's. */
function capabilityIssues(
  def: ClassDef,
  affinity: ReadonlyMap<string, { affinity?: PlayerClass; crossClass: boolean }>,
  prerequisites: ReadonlyMap<string, readonly string[]>,
): { pointer: string; message: string }[] {
  const at = `class:${def.id}`;
  const issues: { pointer: string; message: string }[] = [];
  const unknown = (id: string) =>
    `${at} names unknown capability "${id}": declare it in src/content/data/capability/`;
  def.startingCapabilities.forEach((id, i) => {
    const pointer = `/startingCapabilities/${String(i)}`;
    const cap = affinity.get(id);
    if (cap === undefined) issues.push({ pointer, message: unknown(id) });
    else if (cap.affinity !== undefined && cap.affinity !== def.id) {
      issues.push({
        pointer,
        message: `${at} starts with "${id}", a ${cap.affinity} capability: a class starts with its own or shared capabilities`,
      });
    }
  });
  def.mvpCapabilities.forEach((id, i) => {
    const pointer = `/mvpCapabilities/${String(i)}`;
    const cap = affinity.get(id);
    if (cap === undefined) issues.push({ pointer, message: unknown(id) });
    else if (cap.affinity !== undefined && cap.affinity !== def.id) {
      issues.push({
        pointer,
        message: `${at} holds "${id}" at the MVP milestone, a ${cap.affinity} capability`,
      });
    }
    for (const needed of prerequisites.get(id) ?? []) {
      if (!def.mvpCapabilities.includes(needed)) {
        issues.push({
          pointer,
          message: `${at} holds "${id}" at the MVP milestone without its prerequisite "${needed}"`,
        });
      }
    }
  });
  for (const id of def.startingCapabilities) {
    if (!def.mvpCapabilities.includes(id)) {
      issues.push({
        pointer: '/mvpCapabilities',
        message: `${at} mvpCapabilities lacks its starting capability "${id}": the milestone profile includes everything the class starts with`,
      });
    }
  }
  def.signature.forEach((id, i) => {
    const pointer = `/signature/${String(i)}`;
    const cap = affinity.get(id);
    if (cap === undefined) issues.push({ pointer, message: unknown(id) });
    else if (cap.affinity !== def.id) {
      issues.push({
        pointer,
        message: `${at} signature "${id}" needs classAffinity "${def.id}" (it has ${cap.affinity ?? 'none'})`,
      });
    } else if (cap.crossClass) {
      issues.push({
        pointer,
        message: `${at} signature "${id}" is crossClass: signatures are never shared (ADR-0004 P6)`,
      });
    }
  });
  return issues;
}

/** Equipped kit items: equippable, one unit, one per slot, calling only for the class's tags. */
function kitIssues(
  def: ClassDef,
  items: ReadonlyMap<string, ItemDef>,
): { pointer: string; message: string }[] {
  const at = `class:${def.id}`;
  const issues: { pointer: string; message: string }[] = [];
  const filled = new Map<EquipSlot, string>();
  const proficiencies = new Set(def.proficiencies);
  def.startingKit.items.forEach(({ item: target, count, equip }, i) => {
    const pointer = `/startingKit/items/${String(i)}`;
    const item = items.get(target.id);
    if (!equip || item === undefined) return;
    const equipDef = 'equip' in item ? item.equip : undefined;
    if (equipDef === undefined) {
      issues.push({
        pointer: `${pointer}/equip`,
        message: `${at} equips item:${item.id}, which has no equip slot`,
      });
      return;
    }
    if (count !== 1) {
      issues.push({
        pointer: `${pointer}/count`,
        message: `${at} equips item:${item.id} with count ${String(count)}: an equipped item is one unit`,
      });
    }
    for (const fill of SLOT_FILLS[equipDef.slot] ?? []) {
      const other = filled.get(fill);
      if (other !== undefined) {
        issues.push({
          pointer: `${pointer}/equip`,
          message: `${at} equips item:${item.id} in ${fill}, already filled by item:${other}`,
        });
      }
      filled.set(fill, item.id);
    }
    equipDef.proficiencies.forEach((tag, t) => {
      if (!proficiencies.has(tag)) {
        issues.push({
          pointer: `${pointer}/item`,
          message: `${at} starts with item:${item.id} equipped, which calls for proficiency "${tag}" the class lacks (equip.proficiencies/${String(t)})`,
        });
      }
    });
  });
  return issues;
}

/**
 * The load check for classes (mw-e19.4 AC-1, AC-2): capabilities against the registry, signatures,
 * unique dialogue tags, equipped kit items and, once any class is loaded, every item proficiency tag
 * against the tags the classes hold.
 */
export const checkClasses: ContentCheck = (entries) => {
  const affinity = new Map<string, { affinity?: PlayerClass; crossClass: boolean }>();
  const items = new Map<string, ItemDef>();
  const prerequisites = new Map<string, readonly string[]>();
  const classes: { file: string; def: ClassDef }[] = [];
  for (const { type, file, value } of entries) {
    if (type === 'capability') {
      for (const cap of (value as CapabilityGroup).capabilities) {
        affinity.set(cap.id, {
          ...(cap.classAffinity !== undefined && { affinity: cap.classAffinity }),
          crossClass: cap.crossClass === true,
        });
      }
    } else if (type === 'unlock') {
      for (const unlock of (value as UnlockGroup).unlocks) {
        prerequisites.set(unlock.capability, unlock.prerequisites);
      }
    } else if (type === 'item') items.set(value.id, value as ItemDef);
    else if (type === 'class') classes.push({ file, def: value as ClassDef });
  }

  const issues: ContentIssue[] = [];
  const tags = new Map<string, string>();
  for (const { file, def } of classes) {
    for (const issue of [
      ...capabilityIssues(def, affinity, prerequisites),
      ...kitIssues(def, items),
    ]) {
      issues.push({ file, ...issue });
    }
    const other = tags.get(def.dialogueTag);
    if (other === undefined) tags.set(def.dialogueTag, def.id);
    else {
      issues.push({
        file,
        pointer: '/dialogueTag',
        message: `class:${def.id} dialogueTag "${def.dialogueTag}" is already class:${other}'s`,
      });
    }
  }

  if (classes.length === 0) return issues;
  const held = new Set(classes.flatMap(({ def }) => def.proficiencies));
  for (const { type, file, value } of entries) {
    if (type !== 'item') continue;
    const item = value as ItemDef;
    if (!('equip' in item) || item.equip === undefined) continue;
    item.equip.proficiencies.forEach((tag, i) => {
      if (!held.has(tag)) {
        issues.push({
          file,
          pointer: `/equip/proficiencies/${String(i)}`,
          message: `item:${item.id} calls for proficiency "${tag}", which no class has: add it to a class in src/content/data/class/`,
        });
      }
    });
  }
  return issues;
};
