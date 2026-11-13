// mw-e39.13: books, notes and inscriptions. The schema's rules, the hymn, the page-key resolution and
// the per-entry tests (every shipped text is exercised by name for `pnpm content:coverage`).
import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { glossary } from '../narrative/glossary.ts';
import { describeContent } from '../testing.ts';
import {
  BOOK_MIN_WORDS,
  bookPageKey,
  bookPageText,
  bookTextSchema,
  DAMAGE_MARKERS,
  hymnProblems,
  inscriptionSchema,
  noteSchema,
  READABLE_MAX_WORDS,
  VESPER_HYMN,
  wordCount,
} from './readable.ts';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

const book = (overrides: Record<string, unknown> = {}) => ({
  id: 'book-test',
  title: 'A Test Book',
  author: 'Nobody',
  notes: 'Test.',
  locations: ['place-glen-well'],
  pages: [{ text: words(50) }],
  ...overrides,
});

const problems = (schema: typeof bookTextSchema, value: unknown) =>
  (schema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('readable schema', () => {
  it('accepts a book and defaults damaged to false', () => {
    expect(bookTextSchema.parse(book()).damaged).toBe(false);
  });

  it('wrong id prefix for the kind fails', () => {
    expect(problems(bookTextSchema, book({ id: 'note-test' }))).toEqual([
      'id: a book id starts with "book-"',
    ]);
    expect(
      problems(noteSchema, { ...book({ id: 'inscription-x' }), pages: [{ text: 'Hi' }] }),
    ).toEqual(['id: a note id starts with "note-"']);
  });

  it('a book needs an author; a note or inscription does not', () => {
    const anonymous: Record<string, unknown> = book();
    delete anonymous['author'];
    expect(problems(bookTextSchema, anonymous)).toEqual(['author: a book has an author']);
    expect(
      problems(inscriptionSchema, { ...anonymous, id: 'inscription-x', pages: [{ text: 'No.' }] }),
    ).toEqual([]);
  });

  it('AC-2: a book has between 40 and 400 words, a note may be one word', () => {
    expect(
      problems(bookTextSchema, book({ pages: [{ text: words(BOOK_MIN_WORDS - 1) }] })),
    ).toEqual([
      `pages: a book has at least ${String(BOOK_MIN_WORDS)} words, this has ${String(BOOK_MIN_WORDS - 1)}`,
    ]);
    expect(problems(bookTextSchema, book({ pages: [{ text: words(BOOK_MIN_WORDS) }] }))).toEqual(
      [],
    );
    expect(
      problems(bookTextSchema, book({ pages: [{ text: words(READABLE_MAX_WORDS) }] })),
    ).toEqual([]);
    expect(
      problems(bookTextSchema, book({ pages: [{ text: words(READABLE_MAX_WORDS + 1) }] })),
    ).toEqual([
      `pages: has at most ${String(READABLE_MAX_WORDS)} words, this has ${String(READABLE_MAX_WORDS + 1)}`,
    ]);
    expect(
      problems(noteSchema, { ...book({ id: 'note-x' }), pages: [{ text: 'Burn this.' }] }),
    ).toEqual([]);
  });

  it('counts words across pages', () => {
    const two = book({ pages: [{ text: words(25) }, { text: words(25) }] });
    expect(problems(bookTextSchema, two)).toEqual([]);
    expect(wordCount('  one  two\nthree ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });

  it('needs at least one location, each a place id, none twice', () => {
    expect(problems(bookTextSchema, book({ locations: [] }))).toHaveLength(1);
    expect(problems(bookTextSchema, book({ locations: ['glen-well'] }))).toHaveLength(1);
    expect(
      problems(bookTextSchema, book({ locations: ['place-glen-well', 'place-glen-well'] })),
    ).toEqual(['locations: lists a location twice']);
  });

  it('titles: a book at most 40 characters, a note up to 60', () => {
    const long = 'x'.repeat(41);
    expect(problems(bookTextSchema, book({ title: long }))).toHaveLength(1);
    expect(
      problems(noteSchema, { ...book({ id: 'note-x', title: long }), pages: [{ text: 'Hi' }] }),
    ).toEqual([]);
    expect(
      problems(noteSchema, {
        ...book({ id: 'note-x', title: 'x'.repeat(61) }),
        pages: [{ text: 'Hi' }],
      }),
    ).toHaveLength(1);
  });

  it('AC-5: damaged exactly when the text carries a marker', () => {
    const marked = { text: `${words(50)} ${DAMAGE_MARKERS.illegible}` };
    const torn = { text: `${words(50)} ${DAMAGE_MARKERS.missing}` };
    expect(problems(bookTextSchema, book({ damaged: true, pages: [marked] }))).toEqual([]);
    expect(problems(bookTextSchema, book({ damaged: true, pages: [torn] }))).toEqual([]);
    expect(problems(bookTextSchema, book({ damaged: true }))).toEqual([
      'damaged: a damaged text carries an [illegible] or [missing] marker',
    ]);
    expect(problems(bookTextSchema, book({ pages: [marked] }))).toEqual([
      'damaged: a text with [illegible] or [missing] markers is flagged damaged',
    ]);
  });

  it('AC-3: an altered hymn in a page fails, the exact hymn passes', () => {
    const page = (text: string) => book({ pages: [{ text: `${words(45)} ${text}` }] });
    expect(problems(bookTextSchema, page(VESPER_HYMN))).toEqual([]);
    expect(problems(bookTextSchema, page(VESPER_HYMN.replace('fell', 'fall')))).toHaveLength(1);
  });
});

describe('the Vesper hymn', () => {
  it('AC-3: is the bible text', () => {
    expect(VESPER_HYMN).toBe(
      'Sleep, you who were not born. Sleep, you who fell. The day is rung. The door is kept.',
    );
  });

  it('AC-3: finds copies that differ in any byte, or are cut short', () => {
    expect(hymnProblems(`He sang: ${VESPER_HYMN} And stopped.`)).toEqual([]);
    expect(hymnProblems('The day is rung.')).toEqual([]);
    for (const bad of [
      VESPER_HYMN.replace('Sleep, you', 'Sleep you'),
      VESPER_HYMN.replace('. The door', ', the door'),
      VESPER_HYMN.toLowerCase(),
      VESPER_HYMN.replace(' fell', '  fell'),
      VESPER_HYMN.slice(0, -1),
      'Sleep, you who were not born. Sleep, you who fell.',
    ]) {
      expect(hymnProblems(bad)).toHaveLength(1);
    }
  });
});

describe('book page keys', () => {
  const lookup = (id: string) =>
    id === 'book-a' ? { pages: [{ text: 'first' }, { text: 'second' }] } : undefined;

  it('names page n of a book `book.<id>.page-<n>` and resolves it', () => {
    expect(bookPageKey('book-a', 0)).toBe('book.book-a.page-1');
    expect(bookPageText('book.book-a.page-1', lookup)).toBe('first');
    expect(bookPageText(bookPageKey('book-a', 1), lookup)).toBe('second');
  });

  it('does not resolve other keys, other books or pages past the end', () => {
    expect(bookPageText('book.scroll-of-ember.text', lookup)).toBeUndefined();
    expect(bookPageText('book.book-b.page-1', lookup)).toBeUndefined();
    expect(bookPageText('book.book-a.page-3', lookup)).toBeUndefined();
    expect(bookPageText('book.book-a.page-0', lookup)).toBeUndefined();
  });
});

const places = new Set(glossary.places.map((place) => place.id));
const markers = Object.values(DAMAGE_MARKERS);

for (const type of ['book', 'note', 'inscription'] as const) {
  describeContent(type, 'AC-1: has a placement location from the glossary', (entry) => {
    expect(entry.locations.length).toBeGreaterThanOrEqual(1);
    for (const location of entry.locations) expect(places.has(location)).toBe(true);
  });

  describeContent(type, 'AC-5: is flagged damaged exactly when it carries markers', (entry) => {
    const text = entry.pages.map((page) => page.text).join('\n');
    expect(entry.damaged).toBe(markers.some((marker) => text.includes(marker)));
  });
}

describeContent('book', 'AC-2: the text is between 40 and 400 words', (entry) => {
  const count = entry.pages.reduce((sum, page) => sum + wordCount(page.text), 0);
  expect(count).toBeGreaterThanOrEqual(BOOK_MIN_WORDS);
  expect(count).toBeLessThanOrEqual(READABLE_MAX_WORDS);
});

describeContent('book', 'AC-2: pages are short enough to read in under a minute', (entry) => {
  // 100 to 300 words is the bible's norm (7.1); a page is never more than a short book.
  for (const page of entry.pages) expect(wordCount(page.text)).toBeLessThanOrEqual(300);
});

describe('the shipped texts', () => {
  const texts = (type: string): Set<string> =>
    new Set(
      gameContentSources()
        .filter((source) => source.path.includes(`/data/${type}/`))
        .map((source) => (JSON.parse(source.text) as { id: string }).id),
    );

  it('AC-1: every in-world text of the bible 7.2 list exists', () => {
    const have = new Set([...texts('book'), ...texts('note'), ...texts('inscription')]);
    for (const text of glossary.texts) expect(have.has(text.id), text.id).toBe(true);
  });

  it('AC-1: there are 8 bible books, 8 to 12 more, and notes and inscriptions', () => {
    const bible = new Set(glossary.texts.map((text) => text.id));
    const books = texts('book');
    const extra = [...books].filter((id) => !bible.has(id));
    expect(books.size - extra.length).toBe(8);
    expect(extra.length).toBeGreaterThanOrEqual(8);
    expect(extra.length).toBeLessThanOrEqual(12);
    for (const id of ['note-hale-list', 'note-duggan-instructions']) {
      expect(texts('note').has(id), id).toBe(true);
    }
    expect(texts('note').size).toBeGreaterThanOrEqual(8);
    expect(texts('inscription').size).toBeGreaterThanOrEqual(8);
  });

  it('AC-3: every occurrence of the Vesper hymn in game content is byte-identical', () => {
    let exact = 0;
    const walk = (value: unknown, file: string): void => {
      if (typeof value === 'string') {
        expect(hymnProblems(value), file).toEqual([]);
        exact += value.split(VESPER_HYMN).length - 1;
      } else if (Array.isArray(value)) {
        for (const v of value) walk(v, file);
      } else if (typeof value === 'object' && value !== null) {
        for (const v of Object.values(value)) walk(v, file);
      }
    };
    for (const source of gameContentSources()) walk(JSON.parse(source.text), source.path);
    expect(exact).toBeGreaterThanOrEqual(2);
  });

  it('AC-3: the Vesperine Hours is the hymnal and carries the hymn', () => {
    const hours = gameContentSources().find((s) =>
      s.path.endsWith('/book/book-vesperine-hours.json'),
    );
    expect(hours?.text).toContain(VESPER_HYMN);
  });

  it('AC-5: damaged books are the torn and the water-stained ones', () => {
    const damaged = gameContentSources()
      .filter((s) => s.path.includes('/data/book/'))
      .map((s) => JSON.parse(s.text) as { id: string; damaged?: boolean })
      .filter((b) => b.damaged === true)
      .map((b) => b.id);
    expect(damaged).toEqual(
      expect.arrayContaining([
        'book-ox-beneath-the-hill',
        'book-keepers-log',
        'book-abbots-letters',
      ]),
    );
  });
});
