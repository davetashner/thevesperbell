// The journal window (mw-e23.6): the player's quests, heard rumours and notes in prose, on the kit's
// tokens. Tabs (Active, Completed or Failed, Rumours, Notes) hold entries; each entry is a titled
// block of paragraphs, with a checklist of objectives for a quest. Every entry takes focus, so the
// arrows, d-pad and left stick walk the list and scroll the long ones into view (the panel scrolls
// rather than clips, at any text size); Q/E, PageUp/PageDown and LB/RB switch tabs.
//
// - Closes with Esc or B (the UI's `back`), the Close button, or the journal key (J: the UI's
//   `tabNext` is the tab switch here, so the key is handled by the game, src/game/journal).
// - Pauses the sim and captures input while open. It never changes game state.

import { button } from './components/controls';
import { h } from './components/dom';
import { tabs, type Tabs } from './components/tabs';
import type { Screen, UiRoot } from './screens';

/** `data-screen` of the journal window. */
export const JOURNAL_SCREEN = 'journal';

export const JOURNAL_TEXT = Object.freeze({
  title: 'Journal',
  tabs: 'Journal sections',
  close: 'Close',
  done: 'Done',
  todo: 'To do',
  optional: 'optional',
  hint: 'Q / E or LB / RB: Switch section. Esc or B: Close.',
  unread: 'new',
});

/** The sections, in tab order. */
export const JOURNAL_TABS = [
  { id: 'active', label: 'Active', empty: 'Nothing is pressing. Walk on, and listen.' },
  {
    id: 'done',
    label: 'Completed / Failed',
    empty: 'Nothing is finished yet, one way or the other.',
  },
  { id: 'rumours', label: 'Rumours', empty: 'You have heard nothing worth writing down.' },
  { id: 'notes', label: 'Notes', empty: 'No notes yet.' },
] as const;

export type JournalTabId = (typeof JOURNAL_TABS)[number]['id'];

/** One objective of a quest, as a line of prose with a check. */
export interface JournalObjectiveModel {
  readonly text: string;
  readonly done: boolean;
  readonly optional: boolean;
}

/** One entry: a quest, a rumour or a note. */
export interface JournalEntryModel {
  readonly id: string;
  readonly title: string;
  /** A short state word shown beside the title (`Failed`, `Resolved`, `Lead`...). */
  readonly status?: string;
  /** Paragraphs, split further on blank lines. */
  readonly paragraphs: readonly string[];
  readonly objectives?: readonly JournalObjectiveModel[];
}

export type JournalModel = Readonly<Record<JournalTabId, readonly JournalEntryModel[]>>;

export interface JournalWindowOptions {
  readonly model: JournalModel;
  /** The tab to open on (default: Active). */
  readonly tab?: JournalTabId;
  /** The window closed (Esc, B or Close). */
  readonly onClose?: () => void;
  /**
   * Entry ids not yet seen, by tab (mw-e23.6.1 AC-3): the tab carries a mark and the entry a "new"
   * tag until its tab is viewed. Viewing the tab (opening on it, or switching to it) reports it.
   */
  readonly unread?: Readonly<Partial<Record<JournalTabId, readonly string[]>>>;
  /** A tab was viewed: its unread entries are read. */
  readonly onViewed?: (tab: JournalTabId) => void;
}

export interface JournalWindow {
  readonly screen: Screen;
  /** The tab showing. */
  readonly tab: JournalTabId;
  select(tab: JournalTabId): void;
  close(): void;
}

function entryElement(entry: JournalEntryModel, unread: boolean): HTMLElement {
  const head = h('h2', { text: entry.title });
  if (unread) {
    head.append(' ', h('span', { className: 'vb-journal-new', text: `(${JOURNAL_TEXT.unread})` }));
  }
  const article = h(
    'article',
    {
      className: 'vb-journal-entry vb-stack',
      attrs: { tabindex: '0', 'aria-label': entry.title },
      data: { entry: entry.id },
    },
    head,
  );
  if (entry.status !== undefined) {
    article.append(h('p', { className: 'vb-journal-status', text: entry.status }));
  }
  for (const paragraph of entry.paragraphs.flatMap((p) => p.split(/\n\s*\n/))) {
    article.append(h('p', { text: paragraph.trim() }));
  }
  if (entry.objectives !== undefined && entry.objectives.length > 0) {
    const list = h('ul', { className: 'vb-journal-objectives' });
    for (const o of entry.objectives) {
      const mark = o.done ? JOURNAL_TEXT.done : JOURNAL_TEXT.todo;
      list.append(
        h(
          'li',
          { data: { done: String(o.done) } },
          h('span', { className: 'vb-journal-check', text: o.done ? '[x] ' : '[ ] ' }),
          h('span', { className: 'vb-journal-sr', text: `${mark}: ` }),
          o.text,
          o.optional ? ` (${JOURNAL_TEXT.optional})` : '',
        ),
      );
    }
    article.append(list);
  }
  return article;
}

/** Opens the journal window on `ui`. */
export function openJournalWindow(ui: UiRoot, options: JournalWindowOptions): JournalWindow {
  const panels = JOURNAL_TABS.map((spec) => {
    const entries = options.model[spec.id];
    const panel = h('div', {
      className: 'vb-journal-panel vb-stack',
      data: { panel: spec.id, testid: `journal-${spec.id}` },
    });
    panel.append(
      ...(entries.length === 0
        ? [h('p', { className: 'vb-journal-empty', text: spec.empty })]
        : entries.map((entry) =>
            entryElement(entry, options.unread?.[spec.id]?.includes(entry.id) === true),
          )),
    );
    return panel;
  });
  const strip: Tabs = tabs({
    label: JOURNAL_TEXT.tabs,
    tabs: JOURNAL_TABS.map((spec, i) => ({
      id: spec.id,
      label: spec.label,
      panel: panels[i] as HTMLElement,
    })),
    ...(options.tab !== undefined && { selected: options.tab }),
    onChange: (id) => {
      viewed(id as JournalTabId);
    },
  });
  const tabButton = (id: string): HTMLElement | null =>
    strip.element.querySelector<HTMLElement>(`[role="tab"][data-tab="${id}"]`);
  for (const spec of JOURNAL_TABS) {
    if ((options.unread?.[spec.id]?.length ?? 0) > 0) {
      const button = tabButton(spec.id);
      button?.setAttribute('data-unread', 'true');
      button?.append(h('span', { className: 'vb-journal-sr', text: ` (${JOURNAL_TEXT.unread})` }));
    }
  }
  function viewed(id: JournalTabId): void {
    const button = tabButton(id);
    if (button?.dataset['unread'] === 'true') {
      delete button.dataset['unread'];
      button.querySelector('.vb-journal-sr')?.remove();
      options.onViewed?.(id);
    }
  }
  const closeButton = button({
    label: JOURNAL_TEXT.close,
    onPress: () => {
      screen.close();
    },
  });
  closeButton.dataset['action'] = 'close';
  // The opening tab's first entry takes focus (its tab when empty): a pad reaches the text with one
  // press, and Esc or B closes from anywhere.
  const shown = Math.max(
    0,
    JOURNAL_TABS.findIndex((spec) => spec.id === options.tab),
  );
  (
    panels[shown]?.querySelector<HTMLElement>('[tabindex]') ??
    strip.element.querySelectorAll<HTMLElement>('[role="tab"]')[shown]
  )?.setAttribute('data-autofocus', '');
  const content = h(
    'div',
    { className: 'vb-panel vb-stack vb-journal', data: { testid: 'journal-window' } },
    h('h1', { text: JOURNAL_TEXT.title }),
    strip.element,
    h('p', { className: 'vb-journal-hint', text: JOURNAL_TEXT.hint }),
    h('div', { className: 'vb-row' }, closeButton),
  );
  viewed(options.tab ?? 'active');
  const screen = ui.push({
    id: JOURNAL_SCREEN,
    label: JOURNAL_TEXT.title,
    content,
    pausesSim: true,
    ...(options.onClose !== undefined && { onClose: options.onClose }),
  });
  return {
    screen,
    get tab() {
      return strip.selected as JournalTabId;
    },
    select: (tab) => {
      strip.select(tab);
    },
    close() {
      screen.close();
    },
  };
}
