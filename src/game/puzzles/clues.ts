// Readable clue binding (mw-e15.5): a book, note or scroll whose item data lists `book.clueFor`
// puzzles is a clue to them. Reading it tells the puzzle runtime (`readClue`), which adds
// `clue.<item id>` to the puzzle's trail, so the solve (`puzzleSolved.trail`) and hint attribution
// (mw-e15.11) can say a book helped. Reading a scroll is wired here; the book reader (mw-e07.9) calls
// the returned `read` when a page is opened. The text of a clue is the item's own pages: nothing here
// shows or edits it.

import type { GameContent } from '@content/index';
import { readClue, ScrollRead, type EntityId, type World } from '@sim/index';

type Content = Pick<GameContent, 'all'>;

/** Item definition id → the puzzles it is a clue to, for every readable bound to at least one. */
export function bookClues(content: Content): ReadonlyMap<string, readonly string[]> {
  return new Map(
    content
      .all('item')
      .flatMap((item) =>
        item.category === 'book' && item.book.clueFor.length > 0
          ? [[item.id, item.book.clueFor.map((puzzle) => puzzle.id)] as const]
          : [],
      ),
  );
}

/** What `attachBookClues` gives the reader and the debug surface. */
export interface BookClues {
  /** `actor` read readable `item`: announces it to each puzzle it is bound to (none: nothing happens). */
  read(actor: EntityId, item: string): void;
  /** The puzzles `item` is a clue to. */
  puzzlesOf(item: string): readonly string[];
  /** Stops listening. */
  detach(): void;
}

/** Connects readables to puzzles in `world`: scrolls announce themselves when read. */
export function attachBookClues(world: World<never>, content: Content): BookClues {
  const clues = bookClues(content);
  const puzzlesOf = (item: string): readonly string[] => clues.get(item) ?? [];
  const read = (actor: EntityId, item: string): void => {
    readClue(world, actor, item, puzzlesOf(item));
  };
  const off = world.events.on(ScrollRead, ({ actor, scroll }) => {
    read(actor, scroll);
  });
  return { read, puzzlesOf, detach: off };
}
