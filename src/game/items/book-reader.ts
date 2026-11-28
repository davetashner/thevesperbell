// Reading a book in the reader (mw-e07.9): the glue between a book item in the pack, the story book text
// in content (`book-*`, src/content/data/book), the sim's study rules and the UI's book reader
// (src/ui/book-reader.ts).
//
// - `bookModel` turns a book item into what the reader shows: its pages (text by `bookPageText`, a page
//   named in `condition.missingPages` torn out, a page with no text yet shown as `[illegible]`), the
//   forbidden warning, runes for a language the reader does not know, and the Study button's state.
// - `studyView` words that state from the sim: the minutes still needed (the desk bonus included, as
//   `StudyRules.start` computes it), "already known", or why studying is blocked now (an Alerted or
//   fighting creature near, a class that cannot learn it, a session running).
// - `BookReaderController` opens the reader from the pack's Open action. Study submits the same inventory
//   command the pack's Study does (so it is in the replay); the reader's status line follows the sim's
//   study events and its estimate follows the world after every step.

import {
  classOf,
  inventoryActionCommand,
  inventoryOf,
  knowsSpell,
  SpellLearned,
  StudyEnded,
  StudyStarted,
  type EntityId,
  type InventoryActionCommand,
  type StudyRules,
  type World,
} from '@sim/index';
import type { GameContent } from '@content/index';
import { bookPageText, DAMAGE_MARKERS } from '@content/types/readable';
import {
  openBookReader,
  type BookModel,
  type BookPage,
  type BookReader,
  type BookStudyView,
  type UiRoot,
} from '@ui/index';
import { STUDY_INTERRUPTIONS } from './inventory-screen';
import { isOpenableBook, learnersOf, type BookItem } from './book-study';

/** The words the reader says when studying is not possible. */
export const BOOK_READER_REASONS = Object.freeze({
  unsafe: 'Not with danger so close.',
  class: 'The runes swim before your eyes.',
  busy: 'You are already studying.',
});

/** The languages the reader can read: everyone reads `common` (the rest need learning, mw-e07.3). */
export const READABLE_LANGUAGES: readonly string[] = ['common'];

/** The content the reader reads. */
export type BookReaderContent = Pick<GameContent, 'all' | 'get'>;

/** The Study button's state for `book`, or undefined when it teaches no spell. */
export function studyView(
  world: World<never>,
  actor: EntityId,
  book: BookItem,
  rules: StudyRules,
  content: BookReaderContent,
): BookStudyView | undefined {
  const { teaches } = book.book;
  if (teaches.kind !== 'spell') return undefined;
  const spell = teaches.spell.id;
  const minutes = rules.minutesLeft(world, actor, book.id);
  if (rules.isKnownBook(world, actor, book.id) || knowsSpell(world, actor, spell)) {
    return { minutes, known: true };
  }
  const learners = learnersOf(content.get('spell', spell), book.book.comprehensionDifficulty);
  if (learners !== 'any' && !learners.includes(classOf(world, actor) ?? '')) {
    return { minutes, blocked: BOOK_READER_REASONS.class };
  }
  if (rules.studying(world, actor) !== undefined)
    return { minutes, blocked: BOOK_READER_REASONS.busy };
  if (rules.unsafe(world, actor)) return { minutes, blocked: BOOK_READER_REASONS.unsafe };
  return { minutes };
}

/** What the reader shows for `book`, with the study state the caller worked out. */
export function bookModel(
  book: BookItem,
  content: BookReaderContent,
  study: BookStudyView | undefined,
  languages: readonly string[] = READABLE_LANGUAGES,
): BookModel {
  const { book: data } = book;
  const missing = new Set(data.condition.state === 'damaged' ? data.condition.missingPages : []);
  const lookup = (id: string) => content.all('book').find((entry) => entry.id === id);
  const pages: BookPage[] = data.pages.map((page, index) => {
    if (missing.has(index)) return { missing: true };
    return { text: bookPageText(page.textKey, lookup) ?? DAMAGE_MARKERS.illegible };
  });
  return {
    title: data.title,
    author: data.author,
    pages,
    ...(!languages.includes(data.language) && { garbled: true }),
    ...(data.legality === 'forbidden' && {
      warning: 'Forbidden. The Lantern Court burns books like this at the port.',
    }),
    ...(study !== undefined && { study }),
  };
}

export interface BookReaderControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly content: BookReaderContent;
  readonly study: StudyRules;
  /** Queues a sim command for the next step. */
  readonly submit: (command: InventoryActionCommand) => void;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  /** The reader opened or closed. */
  readonly onChange?: (open: boolean) => void;
}

/** Opens the book reader for the player's books and keeps its Study button true. Call `afterStep` each step. */
export class BookReaderController {
  readonly #options: BookReaderControllerOptions;
  readonly #off: readonly (() => void)[];
  #session: { readonly item: BookItem; readonly reader: BookReader; shown: string } | undefined;

  constructor(options: BookReaderControllerOptions) {
    this.#options = options;
    const { events } = options.world;
    const mine = (actor: EntityId, book: string): boolean =>
      actor === options.player && this.#session?.item.id === book;
    this.#off = [
      events.on(StudyStarted, (e) => {
        if (!mine(e.actor, e.book)) return;
        this.#say(
          e.progress > 0
            ? 'You pick up where you left off. Close the book to let the time pass.'
            : 'You settle down to study. Close the book to let the time pass.',
        );
      }),
      events.on(StudyEnded, (e) => {
        if (!mine(e.actor, e.book) || e.outcome === 'learned' || e.outcome === 'cancelled') return;
        this.#say(
          e.outcome === 'known'
            ? 'You already know what this book teaches.'
            : (STUDY_INTERRUPTIONS[e.reason ?? ''] ?? 'You stop studying.'),
        );
      }),
      events.on(SpellLearned, (e) => {
        if (e.actor === options.player) this.#say('You have learned what it teaches.');
      }),
    ];
  }

  get isOpen(): boolean {
    return this.#session !== undefined;
  }

  /** Opens the pack's book `instanceId` unless a reader is open or it is not an openable book. */
  open(instanceId: number): boolean {
    const { ui, world, player, content, study, submit } = this.#options;
    const defId = inventoryOf(world, player)?.items.find((i) => i.instanceId === instanceId)?.defId;
    if (this.#session !== undefined || defId === undefined) return false;
    const item = content.get('item', defId);
    if (!isOpenableBook(item)) return false;
    const view = studyView(world, player, item, study, content);
    const reader = openBookReader(ui, {
      model: bookModel(item, content, view),
      onStudy: () => {
        submit(inventoryActionCommand(player, { op: 'study', instanceId }));
      },
      onClose: () => {
        this.#session = undefined;
        this.#options.onChange?.(false);
      },
      ...(this.#options.matchMedia !== undefined && { matchMedia: this.#options.matchMedia }),
    });
    this.#session = { item, reader, shown: JSON.stringify(view) };
    this.#options.onChange?.(true);
    return true;
  }

  /** Refreshes the open reader's Study button when what it shows changed. */
  afterStep(): void {
    const session = this.#session;
    if (session === undefined) return;
    const { world, player, study, content } = this.#options;
    const view = studyView(world, player, session.item, study, content);
    const shown = JSON.stringify(view);
    if (shown === session.shown) return;
    session.shown = shown;
    session.reader.setStudy(view);
  }

  close(): void {
    this.#session?.reader.close();
  }

  dispose(): void {
    for (const off of this.#off) off();
    this.close();
  }

  #say(text: string): void {
    this.#session?.reader.say(text);
  }
}
