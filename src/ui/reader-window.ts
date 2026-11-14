// The reader window (mw-kf4c): a note, notice or inscription read in the world, on the kit's tokens.
// It is the seed of the book reader (mw-e07.9): the model already takes pages, so the two-page
// spread, the study button and the garbled and torn-page states grow from here rather than replace it.
//
// - Shows a title, an optional byline and one page of text at a time (paragraphs split by a blank
//   line, damage markers such as `[illegible]` kept as written). More than one page adds Previous and
//   Next buttons and a "Page 1 of 3" line; Left/Right and Q also turn the page.
// - Closes with Esc or B (the UI's `back`), the Close button, or the interact key (E on a keyboard,
//   X on a pad: the UI's `tabNext` and `secondary` intents), so the key that opened the text also
//   puts it away.
// - Pauses the sim and captures input while open. It never changes game state: it reports the
//   close, and the game decides what reading a text does.

import { button } from './components/controls';
import { h } from './components/dom';
import { UI_INTENT_GLYPHS } from './components/overlays';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the reader window. */
export const READER_SCREEN = 'reader';

export const READER_TEXT = Object.freeze({
  previous: 'Previous page',
  next: 'Next page',
  close: 'Close',
  hint: `${UI_INTENT_GLYPHS.keyboard.tabNext}, ${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Close.`,
});

/** What the reader shows. */
export interface ReaderModel {
  /** The heading: a note's title, a book's cover title. */
  readonly title: string;
  /** Who wrote it, shown under the title. */
  readonly byline?: string;
  /** The text in page order, at least one page. */
  readonly pages: readonly string[];
}

export interface ReaderWindowOptions {
  readonly model: ReaderModel;
  /** The window closed (Esc, B, the interact key or Close). */
  readonly onClose?: () => void;
}

export interface ReaderWindow {
  readonly screen: Screen;
  /** The page showing, from 0. */
  readonly page: number;
  /** Shows page `index` (clamped to the pages there are). */
  turn(index: number): void;
  close(): void;
}

/** "Page 2 of 3". */
export const pageLabel = (page: number, total: number): string =>
  `Page ${String(page + 1)} of ${String(total)}`;

/** Opens the reader window on `ui`. */
export function openReaderWindow(ui: UiRoot, options: ReaderWindowOptions): ReaderWindow {
  const { model } = options;
  const last = model.pages.length - 1;
  let page = 0;

  const title = h('h1', { text: model.title });
  const byline = h('p', {
    className: 'vb-reader-byline',
    text: model.byline ?? '',
    data: { testid: 'reader-byline' },
  });
  byline.hidden = model.byline === undefined;
  const body = h('div', {
    className: 'vb-stack vb-reader-body',
    attrs: { role: 'document' },
    data: { testid: 'reader-body' },
  });
  const counter = h('p', {
    className: 'vb-reader-page',
    attrs: { role: 'status' },
    data: { testid: 'reader-page' },
  });
  const previous = button({
    label: READER_TEXT.previous,
    onPress: () => {
      turn(page - 1);
    },
  });
  previous.dataset['action'] = 'previous';
  const next = button({
    label: READER_TEXT.next,
    onPress: () => {
      turn(page + 1);
    },
  });
  next.dataset['action'] = 'next';
  const closeButton = button({
    label: READER_TEXT.close,
    autofocus: true,
    onPress: () => {
      screen.close();
    },
  });
  closeButton.dataset['action'] = 'close';
  const pager = h('div', { className: 'vb-row vb-reader-actions' }, previous, next);
  pager.hidden = last === 0;
  counter.hidden = last === 0;
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-reader', data: { testid: 'reader-window' } },
    title,
    byline,
    body,
    counter,
    h('div', { className: 'vb-row vb-reader-actions' }, pager, closeButton),
    h('p', { className: 'vb-reader-hint', text: READER_TEXT.hint }),
  );

  function render(): void {
    body.replaceChildren(
      ...String(model.pages[page])
        .split(/\n\s*\n/)
        .map((paragraph) => h('p', { text: paragraph.trim() })),
    );
    counter.textContent = pageLabel(page, model.pages.length);
    previous.disabled = page === 0;
    next.disabled = page === last;
  }

  function turn(index: number): void {
    page = Math.max(0, Math.min(last, index));
    render();
  }

  render();
  const screen = ui.push({
    id: READER_SCREEN,
    label: model.title,
    content,
    pausesSim: true,
    onIntent: (intent) => {
      if (intent === 'tabNext' || intent === 'secondary') {
        screen.close();
        return true;
      }
      if (intent === 'tabPrev' || intent === 'left' || intent === 'right') {
        turn(page + (intent === 'right' ? 1 : -1));
        return true;
      }
      return false;
    },
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });

  return {
    screen,
    get page() {
      return page;
    },
    turn,
    close() {
      screen.close();
    },
  };
}
