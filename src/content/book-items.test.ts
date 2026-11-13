// mw-e39.44: every story book text (data/book/) has its inventory item (data/item/<same id>), so the player can carry and read it.
// The load-time pairing (title, author, pages, keys, damage) is checkReadables; these tests name the ACs on top of it.

import { expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';
import { describeContent } from './testing.ts';
import { bookPageKey, bookPageText } from './types/readable.ts';

describeContent('book', 'AC-1: has a loading inventory item of the same id', (entry, content) => {
  const item = content.all('item').find((candidate) => candidate.id === entry.id);
  expect(item?.category).toBe('book');
  if (item?.category !== 'book') return;
  expect(item.book.title).toBe(entry.title);
  expect(item.book.pages).toHaveLength(entry.pages.length);
  item.book.pages.forEach((page, i) => {
    expect(page.textKey).toBe(bookPageKey(entry.id, i));
    expect(bookPageText(page.textKey, (id) => (id === entry.id ? entry : undefined))).toBe(
      entry.pages[i]?.text,
    );
  });
  expect(item.book.condition.state === 'damaged').toBe(entry.damaged);
});

describeContent('item', 'AC-1: a story book item is licensed or forbidden and priced', (entry) => {
  if (entry.category !== 'book' || !entry.id.startsWith('book-')) return;
  expect(entry.value).toBeGreaterThan(0);
  expect(entry.book.kind).toBe('tome');
});

it('AC-1: Nine Sleeps is forbidden, unique and never sold', () => {
  const item = loadGameContent()
    .all('item')
    .find((candidate) => candidate.id === 'book-nine-sleeps');
  expect(item?.flags).toMatchObject({ unique: true, noSell: true });
  if (item?.category !== 'book') throw new Error('book-nine-sleeps is not a book item');
  expect(item.book.legality).toBe('forbidden');
  expect(item.book.rarity).toBe('unique');
});
