// Reading texts in the world (mw-kf4c): the glue between a scene spawn tagged `readable` plus a text
// id (`note-cargo-manifest`, `inscription-kestrel-lock-toll-board`; the pattern the harbour
// placements follow, with a `read` affordance), content's readable texts, and the UI's reader window
// (src/ui/reader-window.ts).
//
// - `ReaderController` opens the window when the player reads such a spawn, after the step that did
//   it, or by `open(textId)`. The sim is paused while it is open.
// - The first read of a text (remembered in the permanent fact `entity:readables/<text id>.read`, so a
//   save keeps it) writes the text's `evidence.*` facts and publishes two logic events a quest
//   objective of kind `event` can bind with no new code: `readable.read` (data `text`, `kind`) for
//   "any text", and an event named by the text id itself, e.g. `note-friend-below-door`, for "this
//   text". A text's optional `emits` (content) names further events published the same way, e.g.
//   `friend-note-found` for the friend-below notes. Later reads open the window and change nothing.
// - `startReaderUi` wires it into a running game and publishes `#app[data-reader]` (JSON: whether
//   the reader is open, the text, and the texts read so far) for the e2e.

import type { GameContent } from '@content/index';
import {
  entityFactKey,
  interacted,
  SceneSpawnComponent,
  type EntityId,
  type World,
} from '@sim/index';
import { openReaderWindow, type ReaderWindow, type UiRoot } from '@ui/index';
import { logicEmitted } from '../logic/host';

/** The tag that marks a spawn as readable; the spawn's other tag naming a text is the text. */
export const READABLE_TAG = 'readable';
/** The event every first read publishes (data: `text`, `kind`). */
export const READABLE_READ_EVENT = 'readable.read';
/** The level segment of a text's read-state fact. */
export const READ_FACT_LEVEL = 'readables';

/** The permanent fact that holds whether the player has read `textId`. */
export const readFactKey = (textId: string): string =>
  entityFactKey(READ_FACT_LEVEL, textId, 'read');

/** A readable text with the kind its id names. */
export interface ReaderText {
  readonly kind: 'book' | 'note' | 'inscription';
  readonly text: {
    readonly id: string;
    readonly title: string;
    readonly author?: string | undefined;
    readonly pages: readonly { readonly text: string }[];
    readonly evidence?: readonly string[] | undefined;
    readonly emits?: readonly string[] | undefined;
  };
}

/** The content the reader reads. */
export type ReaderContent = Pick<GameContent, 'all'>;

/** Every readable text in `content` by id. */
export function readableTexts(content: ReaderContent): Map<string, ReaderText> {
  const texts = new Map<string, ReaderText>();
  for (const kind of ['book', 'note', 'inscription'] as const) {
    for (const text of content.all(kind)) texts.set(text.id, { kind, text });
  }
  return texts;
}

/** What the e2e reads of the reader. */
export interface ReaderReading {
  readonly open: boolean;
  readonly text: string | null;
  /** Texts read so far, in the order they were first read. */
  readonly read: readonly string[];
}

export interface ReaderControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly texts: ReadonlyMap<string, ReaderText>;
  readonly onChange?: (reading: ReaderReading) => void;
}

/** Opens the reader for the player's reads and records first reads. Call `afterStep` each step. */
export class ReaderController {
  readonly #options: ReaderControllerOptions;
  readonly #off: () => void;
  readonly #read: string[] = [];
  #pending: string | undefined;
  #session: { readonly textId: string; readonly window: ReaderWindow } | undefined;

  constructor(options: ReaderControllerOptions) {
    this.#options = options;
    const { world, player, texts } = options;
    this.#off = world.events.on(interacted, ({ actor, target, verb }) => {
      if (actor !== player || verb !== 'read') return;
      const tags = world.get(target, SceneSpawnComponent)?.tags ?? [];
      if (!tags.includes(READABLE_TAG)) return;
      this.#pending = tags.find((tag) => texts.has(tag));
    });
  }

  get isOpen(): boolean {
    return this.#session !== undefined;
  }

  /** Opens `textId` unless a screen is open or the text is unknown. Returns whether it opened. */
  open(textId: string): boolean {
    const { ui, world, texts } = this.#options;
    const entry = texts.get(textId);
    if (this.#session !== undefined || ui.top !== undefined || entry === undefined) return false;
    const { text } = entry;
    const window = openReaderWindow(ui, {
      model: {
        title: text.title,
        ...(text.author !== undefined && { byline: text.author }),
        pages: text.pages.map((page) => page.text),
      },
      onClose: () => {
        this.#session = undefined;
        this.#report();
      },
    });
    this.#session = { textId, window };
    const key = readFactKey(textId);
    if (world.facts.get(key) !== true) {
      world.facts.set(key, true);
      for (const fact of text.evidence ?? []) world.facts.set(fact, true);
      this.#read.push(textId);
      world.events.emit(logicEmitted, {
        event: READABLE_READ_EVENT,
        data: { text: textId, kind: entry.kind },
      });
      world.events.emit(logicEmitted, { event: textId, data: { text: textId, kind: entry.kind } });
      for (const event of text.emits ?? []) {
        world.events.emit(logicEmitted, { event, data: { text: textId, kind: entry.kind } });
      }
    }
    this.#report();
    return true;
  }

  /** Opens a text the player just read. */
  afterStep(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) this.open(pending);
  }

  close(): void {
    this.#session?.window.close();
  }

  dispose(): void {
    this.#off();
    this.close();
  }

  #report(): void {
    this.#options.onChange?.({
      open: this.#session !== undefined,
      text: this.#session?.textId ?? null,
      read: this.#read,
    });
  }
}

export interface ReaderUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly content: ReaderContent;
  readonly player: EntityId;
  /** Publishes a readout for the e2e: `reader` (JSON of a `ReaderReading`). */
  readonly publish?: (key: 'reader', value: string) => void;
}

/** The reader in a running game. */
export interface ReaderUi {
  readonly controller: ReaderController;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Readies the reader for the player over `content`'s texts. */
export function startReaderUi(options: ReaderUiOptions): ReaderUi {
  const { ui, world, content, player, publish } = options;
  const controller = new ReaderController({
    ui,
    world,
    player,
    texts: readableTexts(content),
    onChange: (reading) => publish?.('reader', JSON.stringify(reading)),
  });
  publish?.('reader', JSON.stringify({ open: false, text: null, read: [] }));
  return {
    controller,
    afterStep: () => {
      controller.afterStep();
    },
  };
}
