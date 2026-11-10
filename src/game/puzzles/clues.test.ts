import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { clueRead, ScrollRead, World, type ClueRead } from '@sim/index';
import { attachBookClues, bookClues } from './clues.ts';

const content = loadGameContent();

/** The shipped content with one scroll bound to puzzles, as a content lookup. */
function bound(): Parameters<typeof bookClues>[0] {
  return {
    all: ((type: string) =>
      type === 'item'
        ? content.all('item').map((item) =>
            item.id === 'scroll-of-ember' && item.category === 'book'
              ? {
                  ...item,
                  book: { ...item.book, clueFor: [{ id: 'sunbeam-chapel' }, { id: 'bell-tower' }] },
                }
              : item,
          )
        : content.all(type as 'item')) as never,
  };
}

describe('readable clue binding (mw-e15.5)', () => {
  it('maps each book that names puzzles to them, and no other item', () => {
    expect(bookClues(content).size).toBe(0); // nothing shipped is a clue yet
    expect([...bookClues(bound())]).toEqual([
      ['scroll-of-ember', ['sunbeam-chapel', 'bell-tower']],
    ]);
  });

  it('announces a read to every bound puzzle, from the reader or a scroll read, until detached', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    const seen: ClueRead[] = [];
    world.events.on(clueRead, (e) => seen.push(e));
    const clues = attachBookClues(world, bound());
    const actor = world.spawn();
    clues.read(actor, 'scroll-of-ember');
    clues.read(actor, 'scroll-of-mage-hand'); // not a clue
    world.events.emit(ScrollRead, { tick: 0, actor, scroll: 'scroll-of-ember', spell: 'ember' });
    world.step();
    expect(seen.map((e) => `${e.puzzle}:${e.item}`)).toEqual([
      'sunbeam-chapel:scroll-of-ember',
      'bell-tower:scroll-of-ember',
      'sunbeam-chapel:scroll-of-ember',
      'bell-tower:scroll-of-ember',
    ]);
    expect(clues.puzzlesOf('scroll-of-ember')).toEqual(['sunbeam-chapel', 'bell-tower']);
    expect(clues.puzzlesOf('apple')).toEqual([]);
    clues.detach();
    world.events.emit(ScrollRead, { tick: 1, actor, scroll: 'scroll-of-ember', spell: 'ember' });
    world.step();
    expect(seen).toHaveLength(4);
  });
});
