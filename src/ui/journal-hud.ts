// The journal's HUD pieces (mw-e23.6.1): the "new entry" toast, the unread mark and the pinned quest
// tracker. HUD widget: it takes view models and the draw clock and never reads game state. Sizes are
// in em, so they follow the text size setting. Nothing here takes focus or opens a screen.
//
// - A toast shows for at least JOURNAL_TOAST_MS (3 s) from the `nowMs` it was pushed; toasts queue in
//   order, at most MAX_JOURNAL_TOASTS at once, the oldest making way when the stack is full.
// - The unread mark ("Journal (J): new") shows while `setUnread` holds a count above zero.
// - The tracker lists the pinned quest's title and its open objectives. It renders nothing while it is
//   disabled (the Quest tracker setting) or nothing is pinned.

import { h } from './components/dom';

/** How long a new-entry toast shows, at least (AC-3: 3 s). */
export const JOURNAL_TOAST_MS = 4000;
/** Toasts visible at once. */
export const MAX_JOURNAL_TOASTS = 3;

export const JOURNAL_HUD_TEXT = Object.freeze({
  region: 'Journal notices',
  tracker: 'Quest tracker',
  unread: 'New in the journal',
  todo: 'To do',
});

/** The quest the tracker shows. */
export interface TrackerView {
  readonly title: string;
  /** The objectives still open, as prose. */
  readonly objectives: readonly string[];
}

interface Toast {
  readonly key: string | undefined;
  readonly element: HTMLElement;
  until: number;
}

/** Toasts, the unread mark and the tracker (put `element` in `ui.hud`). */
export class JournalHud {
  readonly element: HTMLElement;
  readonly #toasts: HTMLElement;
  readonly #mark: HTMLElement;
  readonly #tracker: HTMLElement;
  #shown: Toast[] = [];
  #enabled: boolean;
  #view: TrackerView | undefined;

  constructor(options: { readonly trackerEnabled?: boolean } = {}) {
    this.#enabled = options.trackerEnabled ?? true;
    this.#toasts = h('div', {
      className: 'vb-journal-toasts',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': JOURNAL_HUD_TEXT.region },
      data: { testid: 'journal-toasts' },
    });
    this.#mark = h('p', {
      className: 'vb-journal-unread',
      text: JOURNAL_HUD_TEXT.unread,
      attrs: { hidden: '' },
      data: { testid: 'journal-unread' },
    });
    this.#tracker = h('section', {
      className: 'vb-quest-tracker',
      attrs: { 'aria-label': JOURNAL_HUD_TEXT.tracker },
      data: { testid: 'quest-tracker' },
    });
    this.element = h(
      'div',
      { className: 'vb-journal-hud', data: { uiComponent: 'journal-hud' } },
      this.#tracker,
      this.#mark,
      this.#toasts,
    );
    this.#renderTracker();
  }

  /** Whether the tracker is allowed to render. */
  setTrackerEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#renderTracker();
  }

  /** Pins `view` to the tracker; undefined clears it. */
  track(view: TrackerView | undefined): void {
    this.#view = view;
    this.#renderTracker();
  }

  /** Shows the unread mark when `count` is above zero. */
  setUnread(count: number): void {
    this.#mark.hidden = count <= 0;
    this.#mark.dataset['count'] = String(Math.max(0, count));
  }

  /**
   * Shows a new-entry toast with `text`, `nowMs` on the draw clock. A toast with the same `key`
   * already showing keeps its text and starts its time again (a quest that starts, enters a stage and
   * completes an objective in one tick is one notice).
   */
  toast(text: string, nowMs: number, key?: string): void {
    const same = key === undefined ? undefined : this.#shown.find((toast) => toast.key === key);
    if (same !== undefined) {
      same.until = nowMs + JOURNAL_TOAST_MS;
      return;
    }
    const element = h('p', {
      className: 'vb-journal-toast',
      text,
      data: { testid: 'journal-toast' },
    });
    this.#shown.push({ key, element, until: nowMs + JOURNAL_TOAST_MS });
    this.#toasts.append(element);
    while (this.#shown.length > MAX_JOURNAL_TOASTS) this.#shown.shift()?.element.remove();
  }

  /** Expires toasts. Call once per draw. */
  frame(nowMs: number): void {
    this.#shown = this.#shown.filter((toast) => {
      if (toast.until > nowMs) return true;
      toast.element.remove();
      return false;
    });
  }

  /** The toasts showing, oldest first. */
  get toasts(): readonly string[] {
    return this.#shown.map((toast) => toast.element.textContent);
  }

  #renderTracker(): void {
    const view = this.#view;
    this.#tracker.replaceChildren();
    this.#tracker.hidden = !this.#enabled || view === undefined;
    if (!this.#enabled || view === undefined) return;
    this.#tracker.append(h('h2', { text: view.title }));
    if (view.objectives.length > 0) {
      this.#tracker.append(
        h(
          'ul',
          {},
          ...view.objectives.map((text) =>
            h(
              'li',
              {},
              h('span', { className: 'vb-journal-sr', text: `${JOURNAL_HUD_TEXT.todo}: ` }),
              text,
            ),
          ),
        ),
      );
    }
  }
}
