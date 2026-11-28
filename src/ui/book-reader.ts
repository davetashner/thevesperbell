// The book reader (mw-e07.9): a book opened into a two-page spread on the kit's tokens, with a Study
// button. It grows from the reader window (./reader-window.ts, a note read in the world): the same close
// keys, the same paging keys, but pages turn in pairs and the book can be damaged, garbled or forbidden.
//
// - The spread shows pages 2n and 2n+1 (a book with an odd page count ends on a blank right page).
//   Next and Previous, the arrows (Right/Left) and Q turn a spread and stop at the first and the last.
//   Turning plays a short page-turn animation unless motion is reduced (`data-motion`, the OS setting).
// - A page torn out or unreadable (`missing`) shows a torn-page placeholder reading "Pages missing". A
//   book in a language the reader cannot read (`garbled`) shows its text as runes. A forbidden book
//   carries the Lantern Court's warning.
// - Study (when the book teaches something) shows the time it still needs. It is disabled, with the
//   reason as a tooltip and as a line of text (a pad has no hover), when the reader is already past it
//   (`known`) or cannot study now (`blocked`: in combat or alert, the wrong class). Pressing it reports
//   `onStudy`; the game starts the sim's study action and says what happened through `say`.
// - Text sizes follow `--ui-text-scale` and the dyslexia font like every kit screen. Closes with Esc or
//   B (back), the Close button, or the interact key (E, X on a pad). Pauses the sim and captures input.
//   It never changes game state.

import { button } from './components/controls';
import { h } from './components/dom';
import { UI_INTENT_GLYPHS } from './components/overlays';
import { reducedMotion, type MediaQuery } from './comfort';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the book reader. */
export const BOOK_READER_SCREEN = 'book-reader';

export const BOOK_READER_TEXT = Object.freeze({
  previous: 'Previous pages',
  next: 'Next pages',
  close: 'Close',
  study: 'Study',
  known: 'Already known',
  missing: 'Pages missing',
  blank: '',
  forbidden: 'Forbidden. The Lantern Court burns books like this at the port.',
  hint: `${UI_INTENT_GLYPHS.keyboard.tabNext}, ${UI_INTENT_GLYPHS.keyboard.back} or ${UI_INTENT_GLYPHS.gamepad.back}: Close.`,
});

/** One page: its text, or `missing` for a page torn out or unreadable. */
export type BookPage = { readonly text: string } | { readonly missing: true };

/** What the Study button shows. */
export interface BookStudyView {
  /** Game minutes of study still needed (the sim's figure), shown on the button. */
  readonly minutes: number;
  /** The spell is already known: nothing left to study. */
  readonly known?: boolean;
  /** Why studying is not possible now; the button is disabled and says so. */
  readonly blocked?: string;
}

export interface BookModel {
  readonly title: string;
  readonly author?: string;
  readonly pages: readonly BookPage[];
  /** The text is in a language the reader cannot read: it shows as runes. */
  readonly garbled?: boolean;
  /** A warning shown above the pages (a forbidden book). */
  readonly warning?: string;
  /** Present when the book teaches something the reader can study. */
  readonly study?: BookStudyView;
}

export interface BookReaderOptions {
  readonly model: BookModel;
  /** The Study button was pressed. */
  readonly onStudy?: () => void;
  /** The reader closed (Esc, B, the interact key or Close). */
  readonly onClose?: () => void;
  /** `window.matchMedia.bind(window)`, for the OS reduced-motion setting (absent: full motion). */
  readonly matchMedia?: MediaQuery;
}

export interface BookReader {
  readonly screen: Screen;
  /** The spread showing, from 0 (pages 2n+1 and 2n+2 in a reader's words). */
  readonly spread: number;
  /** Shows spread `index` (clamped to the spreads there are). */
  turn(index: number): void;
  /** Replaces what the Study button shows (the estimate moves as the book is studied). */
  setStudy(study: BookStudyView | undefined): void;
  /** Writes a line on the status line (what studying did). */
  say(text: string): void;
  close(): void;
}

/** "Pages 1-2 of 6", or "Page 5 of 5" when the last spread has one page. */
export function spreadLabel(spread: number, total: number): string {
  const first = spread * 2 + 1;
  return first >= total
    ? `Page ${String(total)} of ${String(total)}`
    : `Pages ${String(first)}-${String(first + 1)} of ${String(total)}`;
}

/** "20 min", "1 h 30 min", "2 h". */
export function studyTimeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

/** Text as runes: each letter or digit becomes a rune chosen by the character, spaces and punctuation stay. */
export function garble(text: string): string {
  return text.replace(/[\p{L}\p{N}]/gu, (letter) =>
    RUNES.charAt(letter.charCodeAt(0) % RUNES.length),
  );
}

/** Opens the book reader on `ui`. */
export function openBookReader(ui: UiRoot, options: BookReaderOptions): BookReader {
  const { model } = options;
  const spreads = Math.ceil(model.pages.length / 2);
  const last = spreads - 1;
  let spread = 0;
  let study = model.study;

  const title = h('h1', { text: model.title });
  const byline = h('p', {
    className: 'vb-reader-byline',
    text: model.author ?? '',
    data: { testid: 'book-byline' },
  });
  byline.hidden = model.author === undefined;
  const warning = h('p', {
    className: 'vb-book-warning',
    text: model.warning ?? '',
    attrs: { role: 'note' },
    data: { testid: 'book-warning' },
  });
  warning.hidden = model.warning === undefined;
  const left = h('div', { className: 'vb-book-page', data: { testid: 'book-page-left' } });
  const right = h('div', { className: 'vb-book-page', data: { testid: 'book-page-right' } });
  const pagesEl = h(
    'div',
    { className: 'vb-book-spread', data: { testid: 'book-spread' } },
    left,
    right,
  );
  const counter = h('p', {
    className: 'vb-reader-page',
    attrs: { role: 'status' },
    data: { testid: 'book-pages' },
  });
  const status = h('p', {
    className: 'vb-book-status',
    attrs: { role: 'status' },
    data: { testid: 'book-status' },
  });
  const previous = button({
    label: BOOK_READER_TEXT.previous,
    onPress: () => {
      turn(spread - 1);
    },
  });
  previous.dataset['action'] = 'previous';
  const next = button({
    label: BOOK_READER_TEXT.next,
    onPress: () => {
      turn(spread + 1);
    },
  });
  next.dataset['action'] = 'next';
  const studyButton = button({
    label: BOOK_READER_TEXT.study,
    onPress: () => {
      options.onStudy?.();
    },
  });
  studyButton.dataset['action'] = 'study';
  const reason = h('p', {
    className: 'vb-book-reason',
    attrs: { role: 'status' },
    data: { testid: 'book-study-reason' },
  });
  const closeButton = button({
    label: BOOK_READER_TEXT.close,
    autofocus: true,
    onPress: () => {
      screen.close();
    },
  });
  closeButton.dataset['action'] = 'close';
  const pager = h(
    'div',
    { className: 'vb-row vb-reader-actions', data: { testid: 'book-pager' } },
    previous,
    next,
  );
  pager.hidden = last === 0;
  const studyRow = h(
    'div',
    { className: 'vb-stack vb-book-study', data: { testid: 'book-study' } },
    studyButton,
    reason,
  );
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-reader vb-book', data: { testid: 'book-reader' } },
    title,
    byline,
    warning,
    pagesEl,
    counter,
    h('div', { className: 'vb-row vb-reader-actions' }, pager, studyRow, closeButton),
    status,
    h('p', { className: 'vb-reader-hint', text: BOOK_READER_TEXT.hint }),
  );
  reason.id = 'vb-book-reason';
  studyButton.setAttribute('aria-describedby', reason.id);

  function fill(el: HTMLElement, index: number): void {
    const page = model.pages[index];
    el.classList.toggle('vb-book-torn', page !== undefined && 'missing' in page);
    if (page === undefined) {
      el.replaceChildren(h('p', { text: BOOK_READER_TEXT.blank }));
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.removeAttribute('aria-hidden');
    if ('missing' in page) {
      el.replaceChildren(
        h('p', { className: 'vb-book-torn-text', text: BOOK_READER_TEXT.missing }),
      );
      return;
    }
    const text = model.garbled === true ? garble(page.text) : page.text;
    el.replaceChildren(
      ...text.split(/\n\s*\n/).map((paragraph) => h('p', { text: paragraph.trim() })),
    );
    if (model.garbled === true) el.setAttribute('lang', 'x-runic');
  }

  function renderStudy(): void {
    studyRow.hidden = study === undefined;
    if (study === undefined) return;
    const blocked = study.known === true ? undefined : study.blocked;
    studyButton.textContent =
      study.known === true
        ? BOOK_READER_TEXT.known
        : `${BOOK_READER_TEXT.study} (${studyTimeLabel(study.minutes)})`;
    studyButton.disabled = study.known === true || blocked !== undefined;
    reason.textContent = blocked ?? '';
    reason.hidden = blocked === undefined;
    if (blocked === undefined) studyButton.removeAttribute('title');
    else studyButton.title = blocked;
  }

  function render(): void {
    fill(left, spread * 2);
    fill(right, spread * 2 + 1);
    counter.textContent = spreadLabel(spread, model.pages.length);
    previous.disabled = spread === 0;
    next.disabled = spread === last;
  }

  function turn(index: number): void {
    const to = Math.max(0, Math.min(last, index));
    if (to === spread) return;
    const direction = to > spread ? 'next' : 'prev';
    spread = to;
    render();
    if (reducedMotion(ui.element, options.matchMedia)) return;
    // Restart the animation by clearing and re-adding the class on the spread.
    pagesEl.removeAttribute('data-turn');
    pagesEl.getBoundingClientRect();
    pagesEl.dataset['turn'] = direction;
  }
  pagesEl.addEventListener('animationend', () => {
    pagesEl.removeAttribute('data-turn');
  });

  render();
  renderStudy();
  const screen = ui.push({
    id: BOOK_READER_SCREEN,
    label: model.title,
    content,
    pausesSim: true,
    onIntent: (intent) => {
      if (intent === 'tabNext' || intent === 'secondary') {
        screen.close();
        return true;
      }
      if (intent === 'tabPrev' || intent === 'left' || intent === 'right') {
        turn(spread + (intent === 'right' ? 1 : -1));
        return true;
      }
      return false;
    },
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });

  return {
    screen,
    get spread() {
      return spread;
    },
    turn,
    setStudy(view) {
      study = view;
      renderStudy();
    },
    say(text) {
      status.textContent = text;
    },
    close() {
      screen.close();
    },
  };
}
