// Study data from content (mw-e07.2): turns book items and their spells into the `BookStudyDef`s the
// sim's study rules read, and wires the rules to the running game's inventory and capabilities.
//
// Who may learn from a book. ADR-0004 makes the sorcerer's books hers, with one door left open: a
// knight may read an easy spellbook. The first-cut rule here, until the shared cross-class rule lands in
// the learn API (mw-e19.16, which adds the unlock's `crossClass` flag and the class signature lists), is
// the ADR's channel bound for books: the spell is the first step of its chain (tier 1), the book is
// plain (`comprehensionDifficulty` at most 0.3), the spell costs at most 20 mana and its school is
// licensed. Anything else is sorcerer-only. Replacing this with the shared rule means changing
// `learnersOf` only.

import type { EntityId, World } from '@sim/index';
import {
  inventoryOf,
  SpellLearning,
  StudyRules,
  type BookStudyDef,
  type CapabilityRegistry,
  type UnlockBook,
} from '@sim/index';
import { SCHOOL_LEGALITY, type SpellEntry } from '@content/index';
import type { GameContent } from '@content/index';

/** The one class that learns every spellbook. */
export const BOOK_CLASS = 'sorcerer';
/** The ADR-0004 bound for a book a non-sorcerer may learn from. */
export const CROSS_CLASS_BOOK = Object.freeze({ maxDifficulty: 0.3, maxManaCost: 20, maxTier: 1 });

/** Who may learn `spell` from a book of the given difficulty (see the file header). */
export function learnersOf(spell: SpellEntry, difficulty: number): readonly string[] | 'any' {
  const simple =
    spell.tier <= CROSS_CLASS_BOOK.maxTier &&
    difficulty <= CROSS_CLASS_BOOK.maxDifficulty &&
    spell.cost.mana <= CROSS_CLASS_BOOK.maxManaCost &&
    SCHOOL_LEGALITY[spell.school] === 'licensed';
  return simple ? 'any' : [BOOK_CLASS];
}

/** Study data for every book that teaches a spell, by item id. */
export function bookStudyDefs(
  content: Pick<GameContent, 'all'>,
): ReadonlyMap<string, BookStudyDef> {
  const spells = new Map(content.all('spell').map((spell) => [spell.id, spell]));
  const defs = new Map<string, BookStudyDef>();
  for (const item of content.all('item')) {
    if (item.category !== 'book' || item.book.teaches.kind !== 'spell') continue;
    const spell = spells.get(item.book.teaches.spell.id);
    if (spell === undefined) continue; // the loader refuses a book naming a missing spell
    defs.set(item.id, {
      id: item.id,
      spell: spell.id,
      studyMinutes: item.book.studyMinutes,
      learners: learnersOf(spell, item.book.comprehensionDifficulty),
    });
  }
  return defs;
}

/** Whether `actor` carries an item of definition `bookId`. */
export function carriesBook(world: World<never>, actor: EntityId, bookId: string): boolean {
  return inventoryOf(world, actor)?.items.some((item) => item.defId === bookId) ?? false;
}

/** The study rules for the running game: content's books, the unlock book, the inventory. */
export function createStudyRules(
  content: Pick<GameContent, 'all'>,
  capabilities: CapabilityRegistry,
  unlocks: UnlockBook,
): StudyRules {
  const defs = bookStudyDefs(content);
  return new StudyRules({
    books: (id) => defs.get(id),
    learning: new SpellLearning({ capabilities, unlocks }),
    carries: carriesBook,
  });
}
