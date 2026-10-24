// Study data from content (mw-e07.2): who may learn from a book, and which books teach a spell.
import { loadItemFixtureContent } from '@content/test-fixtures';
import type { GameContent } from '@content/index';
import { addInventory, InventoryRules, World } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { bookStudyDefs, carriesBook, learnersOf } from './book-study';

const content = loadItemFixtureContent();
const bolt = content.get('spell', 'fixture-bolt');

describe('who may learn from a book (mw-e07.2, ADR-0004)', () => {
  it('AC-5: a plain first-step spell of a licensed school is open to every class', () => {
    expect(learnersOf(bolt, 0)).toBe('any');
    expect(learnersOf(bolt, 0.3)).toBe('any');
  });

  it('AC-5: a harder book, a deeper or dearer spell, or an unlicensed school is sorcerer-only', () => {
    expect(learnersOf(bolt, 0.31)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, tier: 2 }, 0)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, cost: { mana: 21 } }, 0)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, school: 'shadow' }, 0)).toEqual(['sorcerer']);
  });
});

describe('study data from content', () => {
  it('lists only books that teach a spell the content has', () => {
    const defs = bookStudyDefs(content);
    expect(defs.get('fixture-primer')).toEqual({
      id: 'fixture-primer',
      spell: 'fixture-bolt',
      studyMinutes: 30,
      learners: 'any',
    });
    expect(defs.has('fixture-sword')).toBe(false);
    // A book whose spell is missing from content (the loader forbids it) is skipped, not fatal.
    const missing: Pick<GameContent, 'all'> = {
      all: ((type: string) => (type === 'spell' ? [] : content.all('item'))) as GameContent['all'],
    };
    expect(bookStudyDefs(missing).size).toBe(0);
  });

  it('knows whether a pack holds a book, and an actor with no pack holds none', () => {
    const world = new World<never>({ seed: 1 });
    const actor = world.spawn();
    expect(carriesBook(world, actor, 'fixture-primer')).toBe(false);
    addInventory(world, actor);
    world.step();
    expect(carriesBook(world, actor, 'fixture-primer')).toBe(false);
    new InventoryRules(content.all('item')).add(world, actor, 'fixture-primer', 1);
    expect(carriesBook(world, actor, 'fixture-primer')).toBe(true);
  });
});
