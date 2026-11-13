// In-world readable text (mw-e39.13): books, loose notes and carved or painted inscriptions. One file
// per text at `src/content/data/<book|note|inscription>/<id>.json`, the id `book-<slug>`,
// `note-<slug>` or `inscription-<slug>` (docs/narrative/content-conventions.md). The three types share
// one shape: the full text is content data, validated here, so the narrative lint reads it
// (src/tools/narrative-lint/extract.ts) and checks its names and canon numbers.
//
// A book's file is the text of the inventory item with the same id (`book-vesperine-hours`): the item
// carries the pack-side facts (icon, value, legality, study) and its `book.pages[n].textKey` is
// `book.<id>.page-<n+1>` (`bookPageKey`), which `bookPageText` resolves to the page's text. The item is
// added by whichever bead places the book (its icon is art work); `checkReadables`
// (src/content/readable-checks.ts) holds the pair together once both exist.
//
// Damaged texts carry the markers the reader UI renders (`DAMAGE_MARKERS`): `[illegible]` for words
// that cannot be read and `[missing]` for a lost passage or page. A text is `damaged` exactly when it
// has a marker.
//
// The Vesper hymn (story bible 7.2) is quoted from `VESPER_HYMN` only: any text that opens it must
// give the whole hymn, byte for byte (`hymnProblems`).

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { FACT_KEY_PATTERN } from './fact.ts';
import { MAX_BOOK_PAGES, MAX_ITEM_NAME_LENGTH } from './item.ts';

/** The three kinds of readable, which are also their content type names. */
export const READABLE_KINDS = ['book', 'note', 'inscription'] as const;
export type ReadableKind = (typeof READABLE_KINDS)[number];

/** Fewest and most words a book may have (mw-e39.13 AC-2); a note or inscription may be as short as it likes. */
export const BOOK_MIN_WORDS = 40;
export const READABLE_MAX_WORDS = 400;

/** Longest heading of a note or inscription (a notice's full title is longer than a cover's). */
export const MAX_HEADING_LENGTH = 60;

/** What the reader UI renders for unreadable words and for a lost passage or page. */
export const DAMAGE_MARKERS = { illegible: '[illegible]', missing: '[missing]' } as const;

/** The Vesper hymn, story bible 7.2. Every occurrence in the game is exactly this string. */
export const VESPER_HYMN =
  'Sleep, you who were not born. Sleep, you who fell. The day is rung. The door is kept.';

/** Where a hymn begins and, if the text is whole, ends (looser than the hymn so a wrong copy is found). */
const HYMN_SPAN = /sleep\W+you\s+who\s+were\s+not\s+born(?:[\s\S]*?door\s+is\s+kept\.?)?/gi;

/** Every occurrence of the hymn in `text` that is not exactly `VESPER_HYMN` (altered, cut short). */
export function hymnProblems(text: string): string[] {
  return [...text.matchAll(HYMN_SPAN)]
    .map((match) => match[0])
    .filter((found) => found !== VESPER_HYMN)
    .map((found) => `the Vesper hymn must read exactly "${VESPER_HYMN}", not "${found}"`);
}

/** Words in `text` (runs of non-space), the count AC-2 measures. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** The localisation key an item's `book.pages[index]` uses for page `index` (zero-based) of book `id`. */
export function bookPageKey(id: string, index: number): string {
  return `book.${id}.page-${String(index + 1)}`;
}

const PAGE_KEY = /^book\.(book-[a-z0-9]+(?:-[a-z0-9]+)*)\.page-([1-9]\d*)$/;

/**
 * The text a book item's page `textKey` stands for: `lookup` finds a book entry by id. Undefined when
 * the key is not a story book's page key or the page does not exist.
 */
export function bookPageText(
  textKey: string,
  lookup: (id: string) => { readonly pages: readonly { readonly text: string }[] } | undefined,
): string | undefined {
  const match = PAGE_KEY.exec(textKey);
  if (match === null) return undefined;
  return lookup(String(match[1]))?.pages[Number(match[2]) - 1]?.text;
}

/** A glossary place id: where the text can be found. */
const placeId = z
  .string()
  .regex(/^place-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a glossary place id, e.g. "place-glen-well"');

const pageSchema = z
  .strictObject({
    text: z
      .string()
      .min(1)
      .describe('The page as the reader shows it; plain text, paragraphs split by a blank line.'),
  })
  .describe('One page of a readable.');

/** Schema of one `kind` of readable (`id` must carry the kind's prefix). */
function readableSchema(kind: ReadableKind) {
  return z
    .strictObject({
      id: contentId.describe(`\`${kind}-<slug>\`; for a book, the id of its inventory item.`),
      title: z
        .string()
        .min(1)
        .max(kind === 'book' ? MAX_ITEM_NAME_LENGTH : MAX_HEADING_LENGTH)
        .describe(
          `Title on the cover (at most ${String(MAX_ITEM_NAME_LENGTH)} characters, as the item's), or heading of a note or inscription (at most ${String(MAX_HEADING_LENGTH)}).`,
        ),
      author: z
        .string()
        .min(1)
        .max(MAX_ITEM_NAME_LENGTH)
        .optional()
        .describe('Who wrote it, in the world; required for a book, optional for the others.'),
      notes: z
        .string()
        .min(1)
        .describe('Author-facing: bible section it comes from, who it contradicts, what it hints.'),
      locations: z
        .array(placeId)
        .min(1)
        .describe('Where it can be found: one or more glossary place ids (at least one).'),
      pages: z
        .array(pageSchema)
        .min(1)
        .max(MAX_BOOK_PAGES)
        .describe('The text, in page order; a note or inscription is usually one page.'),
      evidence: z
        .array(
          z.string().regex(FACT_KEY_PATTERN, 'must be a fact key, e.g. "evidence.honest-manifest"'),
        )
        .min(1)
        .optional()
        .describe(
          'Evidence tags (mw-e39.23): the `evidence.*` facts that holding this text proves. Quest and dialogue conditions read the fact; the text names it so the two stay together.',
        ),
      damaged: z
        .boolean()
        .default(false)
        .describe('True exactly when the text carries `[illegible]` or `[missing]` markers.'),
    })
    .superRefine((readable, ctx) => {
      const issue = (path: (string | number)[], message: string) => {
        ctx.addIssue({ code: 'custom', path, message });
      };
      if (!readable.id.startsWith(`${kind}-`)) issue(['id'], `a ${kind} id starts with "${kind}-"`);
      if (kind === 'book' && readable.author === undefined)
        issue(['author'], 'a book has an author');
      if (readable.evidence?.some((key) => !key.startsWith('evidence.')) === true) {
        issue(['evidence'], 'evidence tags are `evidence.*` facts');
      }
      if (new Set(readable.locations).size !== readable.locations.length) {
        issue(['locations'], 'lists a location twice');
      }
      const words = readable.pages.reduce((sum, page) => sum + wordCount(page.text), 0);
      if (kind === 'book' && words < BOOK_MIN_WORDS) {
        issue(
          ['pages'],
          `a book has at least ${String(BOOK_MIN_WORDS)} words, this has ${String(words)}`,
        );
      }
      if (words > READABLE_MAX_WORDS) {
        issue(
          ['pages'],
          `has at most ${String(READABLE_MAX_WORDS)} words, this has ${String(words)}`,
        );
      }
      const marked = readable.pages.some((page) =>
        Object.values(DAMAGE_MARKERS).some((marker) => page.text.includes(marker)),
      );
      if (readable.damaged && !marked) {
        issue(['damaged'], 'a damaged text carries an [illegible] or [missing] marker');
      }
      if (!readable.damaged && marked) {
        issue(['damaged'], 'a text with [illegible] or [missing] markers is flagged damaged');
      }
      readable.pages.forEach((page, index) => {
        for (const message of hymnProblems(page.text)) issue(['pages', index, 'text'], message);
      });
    });
}

/** A book's text (`src/content/data/book/`). */
export const bookTextSchema = readableSchema('book').describe(
  'The text of an in-world book (mw-e39.13); the file id is the inventory item id.',
);
/** A loose note, letter or notice (`src/content/data/note/`). */
export const noteSchema = readableSchema('note').describe(
  'A loose note, letter or notice (mw-e39.13).',
);
/** A carved, painted or chalked inscription (`src/content/data/inscription/`). */
export const inscriptionSchema = readableSchema('inscription').describe(
  'A carved, painted or chalked inscription (mw-e39.13).',
);

/** A validated readable (all three kinds share the shape). */
export type Readable = z.output<typeof bookTextSchema>;
