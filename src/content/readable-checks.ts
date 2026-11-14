// Load-time checks of readables (mw-e39.13): a book's inventory item (an item with the same id) agrees with its
// text: same title and author, one page per item page, every `textKey` resolving to that page's text
// (`bookPageText`), and damaged exactly when the item's condition is damaged. A story book
// (`book-<slug>`) item with no text file is an error: nothing could resolve its pages. That a location
// is a place in the canon glossary is checked by src/content/types/readable.test.ts (AC-1): the
// glossary is a JSON module the Node content tools cannot import, so the load does not.

import type { ContentCheck, ContentIssue, Frozen } from './loader.ts';
import type { ItemDef } from './types/item.ts';
import { bookPageKey, bookPageText, type Readable } from './types/readable.ts';

/** The content check for readables: the book-item pairing. */
export const checkReadables: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  const books = new Map<string, Frozen<Readable>>();
  for (const { type, value } of entries) {
    if (type === 'book') books.set((value as Readable).id, value as Frozen<Readable>);
  }
  for (const { type, file, value } of entries) {
    if (type !== 'item') continue;
    const item = value as Frozen<ItemDef>;
    if (item.category !== 'book') continue;
    const text = books.get(item.id);
    const issue = (pointer: string, message: string) => {
      issues.push({ file, pointer, message: `item:${item.id} ${message}` });
    };
    if (text === undefined) {
      if (item.id.startsWith('book-')) issue('/id', 'has no text file in data/book/');
      continue;
    }
    if (item.book.title !== text.title)
      issue('/book/title', `title differs from the text's "${text.title}"`);
    if (item.book.author !== text.author) {
      issue('/book/author', `author differs from the text's "${String(text.author)}"`);
    }
    if (item.book.pages.length !== text.pages.length) {
      issue(
        '/book/pages',
        `has ${String(item.book.pages.length)} pages, the text has ${String(text.pages.length)}`,
      );
    }
    item.book.pages.forEach((page, i) => {
      if (
        page.textKey !== bookPageKey(item.id, i) ||
        bookPageText(page.textKey, (id) => books.get(id)) === undefined
      ) {
        issue(
          `/book/pages/${String(i)}/textKey`,
          `must be "${bookPageKey(item.id, i)}" to resolve to the text`,
        );
      }
    });
    if ((item.book.condition.state === 'damaged') !== text.damaged) {
      issue('/book/condition', 'is damaged exactly when its text is flagged damaged');
    }
  }
  return issues;
};
