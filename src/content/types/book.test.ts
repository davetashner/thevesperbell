// The book item schema (mw-e07.1): spell, language, condition and legality.

import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import {
  fixtureContentSources,
  itemFixtureSources,
  loadItemFixtureContent,
  spellFixtureSources,
} from '../test-fixtures.ts';
import {
  BOOK_LANGUAGES,
  bookCoverArtId,
  itemSchema,
  SCHOOL_LEGALITY,
  type ItemDef,
} from './item.ts';
import { SPELL_SCHOOLS } from './spell.ts';

const book = (overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  id: 'test-book',
  category: 'book',
  notes: 'Test.',
  icon: 'icon-item-test-book-01',
  value: 10,
  book: {
    title: 'A Test Book',
    author: 'Nobody',
    school: 'fire',
    teaches: { kind: 'spell', spell: 'fixture-bolt' },
    pages: [{ textKey: 'b.1' }, { textKey: 'b.2' }, { textKey: 'b.3' }],
    studyMinutes: 20,
    legality: 'licensed',
    rarity: 'common',
    ...overrides,
  },
  ...item,
});

const problems = (value: unknown): string[] =>
  (itemSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

const files = (...items: Record<string, unknown>[]): ContentSource[] =>
  items.map((item) => ({
    path: `src/content/data/item/${String(item['id'])}.json`,
    text: JSON.stringify(item),
  }));

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(
      contentTypes,
      [
        ...gameContentSources(),
        ...fixtureContentSources(),
        ...itemFixtureSources(),
        ...spellFixtureSources(),
        ...extra,
      ],
      contentChecks,
    );
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('book items (mw-e07.1)', () => {
  it('AC-1: a valid book teaching a known spell parses and registers as a book item', () => {
    expect(problems(book())).toEqual([]);
    const parsed: ItemDef = itemSchema.parse(book());
    expect(parsed.category).toBe('book');
    if (parsed.category !== 'book') throw new Error('not a book');
    expect(parsed.book).toMatchObject({
      kind: 'tome',
      language: 'common',
      comprehensionDifficulty: 0,
      condition: { state: 'intact' },
      cursedWhispers: false,
    });
    expect(loadIssues(files(book()))).toEqual([]);
    const content = loadItemFixtureContent();
    expect(content.get('item', 'fixture-primer').category).toBe('book');
    expect(content.all('item').some((item) => item.id === 'test-book')).toBe(false);
  });

  it('AC-2: a book that teaches an unknown spell fails, naming the book and the spell', () => {
    const bad = book({ teaches: { kind: 'spell', spell: 'no-such-spell' } }, { id: 'lost-book' });
    expect(loadIssues(files(bad))).toEqual([
      'src/content/data/item/lost-book.json#/book/teaches/spell: item:lost-book references missing spell:no-such-spell',
    ]);
  });

  it('AC-3: a damaged book whose missingPages index exceeds its page count fails', () => {
    const damaged = (missingPages: number[]) =>
      book({ condition: { state: 'damaged', missingPages } });
    expect(problems(damaged([1]))).toEqual([]);
    expect(problems(damaged([3]))).toEqual([
      'book.condition.missingPages.0: item "test-book": missing page 3 is past the book\'s 3 pages',
    ]);
    expect(problems(damaged([1, 1]))).toEqual([
      'book.condition.missingPages: item "test-book": lists a missing page twice',
    ]);
    expect(problems(damaged([0, 1, 2]))).toEqual([
      'book.condition.missingPages: item "test-book": cannot be missing every page',
    ]);
    expect(problems(damaged([]))).not.toEqual([]);
  });

  it('AC-4: two books may teach the same spell', () => {
    const second = book({}, { id: 'second-test-book' });
    expect(loadIssues(files(book(), second))).toEqual([]);
  });

  it('teaches insight or lore, and an insight names a registry capability', () => {
    expect(problems(book({ teaches: { kind: 'lore' }, studyMinutes: 0 }))).toEqual([]);
    expect(
      problems(
        book({ teaches: { kind: 'insight', capability: 'spell.mage-hand' }, studyMinutes: 0 }),
      ),
    ).toEqual([]);
    expect(problems(book({ teaches: { kind: 'spell', spell: 'a' }, studyMinutes: 0 }))).toEqual([
      'book.studyMinutes: item "test-book": a book that teaches a spell needs studyMinutes above 0',
    ]);
  });

  it('scrolls: one page, no teaching, stackable; only scrolls cast or stack', () => {
    const scroll = (o: Record<string, unknown> = {}, i: Record<string, unknown> = {}) =>
      book(
        {
          kind: 'scroll',
          teaches: { kind: 'lore' },
          studyMinutes: 0,
          pages: [{ textKey: 's' }],
          ...o,
        },
        { stackable: true, maxStack: 5, ...i },
      );
    expect(problems(scroll())).toEqual([]);
    expect(problems(scroll({ pages: [{ textKey: 'a' }, { textKey: 'b' }] }))).toEqual([
      'book.pages: item "test-book": a scroll has exactly one page',
    ]);
    expect(problems(scroll({ teaches: { kind: 'spell', spell: 'a' } }))).toContain(
      'book.teaches: item "test-book": a scroll casts, it does not teach',
    );
    expect(problems(scroll({ condition: { state: 'damaged', missingPages: [0] } }))).toContain(
      'book.condition: item "test-book": a scroll cannot be damaged',
    );
    expect(problems(book({}, { stackable: true, maxStack: 2 }))).toEqual([
      'stackable: item "test-book": only scrolls stack; a tome or note is one object',
    ]);
    expect(problems(book({ casts: 'fixture-bolt' }))).toEqual([
      'book.casts: item "test-book": only a scroll casts a spell when read',
    ]);
    expect(loadIssues(files(scroll({ casts: 'fixture-bolt' })))).toEqual([]);
    expect(loadIssues(files(scroll({ casts: 'missing' }, { id: 'bad-scroll' })))).toEqual([
      'src/content/data/item/bad-scroll.json#/book/casts: item:bad-scroll references missing spell:missing',
    ]);
  });

  it('legality is never looser than the school’s (story bible §3.3)', () => {
    expect(SCHOOL_LEGALITY.somnomancy).toBe('forbidden');
    expect(SCHOOL_LEGALITY.illusion).toBe('restricted');
    expect(Object.keys(SCHOOL_LEGALITY).sort()).toEqual([...SPELL_SCHOOLS].sort());
    const teaches = { kind: 'lore' } as const;
    expect(
      problems(
        book({
          school: 'somnomancy',
          teaches,
          studyMinutes: 0,
          legality: 'forbidden',
          rarity: 'rare',
        }),
      ),
    ).toEqual([]);
    expect(
      problems(book({ school: 'somnomancy', teaches, studyMinutes: 0, legality: 'restricted' })),
    ).toEqual([
      'book.legality: item "test-book": restricted is looser than the somnomancy school\'s forbidden (story bible §3.3)',
    ]);
    // Stricter than the school is allowed (a confiscated book).
    expect(problems(book({ legality: 'forbidden' }))).toEqual([]);
  });

  it('rarity is unique exactly when the item is flagged unique', () => {
    expect(problems(book({ rarity: 'unique' }, { flags: { unique: true } }))).toEqual([]);
    expect(problems(book({ rarity: 'unique' }))).toHaveLength(1);
    expect(problems(book({}, { flags: { unique: true } }))).toHaveLength(1);
  });

  it('cover art follows ui-book-cover-<id>', () => {
    expect(bookCoverArtId('test-book')).toBe('ui-book-cover-test-book');
    expect(problems(book({ coverArtId: 'ui-book-cover-test-book' }))).toEqual([]);
    expect(problems(book({ coverArtId: 'ui-book-cover-other' }))).toEqual([
      'book.coverArtId: item "test-book": must be "ui-book-cover-test-book" (asset convention)',
    ]);
  });

  it('books have a language, and a school-matching spell', () => {
    expect(BOOK_LANGUAGES).toContain('dreamtongue');
    expect(problems(book({ language: 'klingon' }))).not.toEqual([]);
    expect(problems(book({ language: 'hornfolk', comprehensionDifficulty: 0.8 }))).toEqual([]);
    expect(problems(book({ comprehensionDifficulty: 1.5 }))).not.toEqual([]);
    expect(loadIssues(files(book({ school: 'frost' }, { id: 'frost-book' })))).toEqual([
      'src/content/data/item/frost-book.json#/book/school: item:frost-book is frost but its spell "fixture-bolt" is fire',
    ]);
  });

  it('a spell’s bookId must name a book that teaches it', () => {
    const spell = (bookId: string): ContentSource => {
      const base = spellFixtureSources().find((s) => s.path.endsWith('fixture-bolt.json'));
      if (base === undefined) throw new Error('no fixture');
      return {
        path: 'src/content/data/spell/bound-bolt.json',
        text: JSON.stringify({ ...JSON.parse(base.text), id: 'bound-bolt', bookId }),
      };
    };
    const teachesBound = book(
      { teaches: { kind: 'spell', spell: 'bound-bolt' } },
      { id: 'bolt-book' },
    );
    expect(loadIssues([spell('bolt-book'), ...files(teachesBound)])).toEqual([]);
    expect(loadIssues([spell('nothing')])).toEqual([
      'src/content/data/spell/bound-bolt.json#/bookId: spell:bound-bolt names bookId "nothing", which is not a book item',
    ]);
    expect(loadIssues([spell('fixture-primer')])).toEqual([
      'src/content/data/spell/bound-bolt.json#/bookId: spell:bound-bolt names bookId "fixture-primer", which does not teach it',
    ]);
  });
});
