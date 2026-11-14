// mw-e39.13: a book item and its text file agree, and a story book item cannot lack its text.
import { describe, expect, it } from 'vitest';
import type { LoadedEntry } from './loader.ts';
import { checkReadables } from './readable-checks.ts';

const text = (overrides: Record<string, unknown> = {}): LoadedEntry => ({
  type: 'book',
  file: 'data/book/book-a.json',
  value: {
    id: 'book-a',
    title: 'A Book',
    author: 'An Author',
    notes: 'n',
    locations: ['place-glen-well'],
    pages: [{ text: 'one' }, { text: 'two' }],
    damaged: false,
    ...overrides,
  } as never,
});

const item = (
  id = 'book-a',
  book: Record<string, unknown> = {},
  category = 'book',
): LoadedEntry => ({
  type: 'item',
  file: `data/item/${id}.json`,
  value: {
    id,
    category,
    book: {
      title: 'A Book',
      author: 'An Author',
      pages: [{ textKey: `book.${id}.page-1` }, { textKey: `book.${id}.page-2` }],
      condition: { state: 'intact' },
      ...book,
    },
  } as never,
});

const messages = (entries: LoadedEntry[]) =>
  checkReadables(entries).map((i) => `${i.pointer}: ${i.message}`);

describe('checkReadables', () => {
  it('passes a matching book item and text, and ignores everything else', () => {
    expect(messages([text(), item()])).toEqual([]);
    expect(messages([item('spell-book', {}, 'book')])).toEqual([]);
    expect(messages([item('rope', {}, 'tool')])).toEqual([]);
    expect(messages([{ type: 'note', file: 'n.json', value: { id: 'note-x' } }])).toEqual([]);
  });

  it('a story book item with no text file fails; a spellbook with none is not ours', () => {
    expect(messages([item('book-b')])).toEqual(['/id: item:book-b has no text file in data/book/']);
  });

  it('title, author and page count must agree', () => {
    expect(messages([text(), item('book-a', { title: 'Other' })])).toEqual([
      `/book/title: item:book-a title differs from the text's "A Book"`,
    ]);
    expect(messages([text(), item('book-a', { author: 'Other' })])).toEqual([
      `/book/author: item:book-a author differs from the text's "An Author"`,
    ]);
    expect(
      messages([text({ author: undefined }), item('book-a', { author: 'An Author' })]),
    ).toEqual([`/book/author: item:book-a author differs from the text's "undefined"`]);
    expect(
      messages([text(), item('book-a', { pages: [{ textKey: 'book.book-a.page-1' }] })]),
    ).toEqual(['/book/pages: item:book-a has 1 pages, the text has 2']);
  });

  it('every page textKey must be the key that resolves to its page', () => {
    expect(
      messages([
        text(),
        item('book-a', {
          pages: [{ textKey: 'book.book-a.page-2' }, { textKey: 'book.book-a.page-2' }],
        }),
      ]),
    ).toEqual([
      '/book/pages/0/textKey: item:book-a must be "book.book-a.page-1" to resolve to the text',
    ]);
    expect(
      messages([
        text({ pages: [{ text: 'one' }] }),
        item('book-a', {
          pages: [{ textKey: 'book.book-a.page-1' }, { textKey: 'book.book-a.page-2' }],
        }),
      ]),
    ).toEqual([
      '/book/pages: item:book-a has 2 pages, the text has 1',
      '/book/pages/1/textKey: item:book-a must be "book.book-a.page-2" to resolve to the text',
    ]);
  });

  it('the item is damaged exactly when its text is', () => {
    const torn = { condition: { state: 'damaged', missingPages: [1] } };
    expect(messages([text(), item('book-a', torn)])).toEqual([
      '/book/condition: item:book-a is damaged exactly when its text is flagged damaged',
    ]);
    expect(messages([text({ damaged: true }), item()])).toHaveLength(1);
    expect(messages([text({ damaged: true }), item('book-a', torn)])).toEqual([]);
  });
});
