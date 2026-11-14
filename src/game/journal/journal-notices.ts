// The journal's notices (mw-e23.6.1): quest events and newly heard rumours make a journal entry, which
// shows a toast and counts as unread until its tab is viewed (AC-3), and the quest being followed is
// pinned to the HUD tracker (AC-5).
//
// - A quest that starts, moves to a new stage or completes an objective updates its Active entry; one
//   that resolves or fails moves its entry to Completed / Failed. Each is one toast and one unread
//   entry under that tab. A heard rumour is a Rumours entry. Rumours already heard when the notices
//   start (a loaded game) are not news.
// - The pinned quest is the one that last moved. When it resolves or fails the first active quest takes
//   its place; with none active the tracker is empty. The Quest tracker setting hides the tracker
//   (the HUD widget renders nothing while disabled); it never changes what is pinned.
// - Unread state is kept for the session only: it adds nothing to the save.

import type { QuestDef } from '@content/types/quest';
import {
  QuestFailed,
  QuestObjectiveChanged,
  QuestResolved,
  QuestStageChanged,
  QuestStarted,
  type EventBus,
} from '@sim/index';
import type { JournalHud, JournalModel, JournalTabId } from '@ui/index';
import type { JournalRumour } from './journal';

export const JOURNAL_NOTICE_TEXT = Object.freeze({
  added: 'New journal entry',
  updated: 'Journal updated',
  rumour: 'You heard a rumour',
});

export interface JournalNoticesOptions {
  readonly events: Pick<EventBus, 'on'>;
  readonly defs: readonly QuestDef[];
  /** The journal as it stands now (the same model the window opens on). */
  readonly model: () => JournalModel;
  readonly hud: Pick<JournalHud, 'toast' | 'track' | 'setUnread' | 'frame'>;
  /** The draw clock, ms. */
  readonly now: () => number;
  /** The heard rumours (the rumour book), seeded without a toast. */
  readonly rumours?: { entries(): readonly JournalRumour[] } | undefined;
}

/** Toasts, unread marks and the pinned quest, fed by quest events and the rumour book. */
export class JournalNotices {
  readonly #options: JournalNoticesOptions;
  readonly #unread = new Map<JournalTabId, Set<string>>();
  readonly #knownRumours: Set<string>;
  #pinned: string | undefined;
  readonly #off: (() => void)[];

  constructor(options: JournalNoticesOptions) {
    this.#options = options;
    this.#knownRumours = new Set((options.rumours?.entries() ?? []).map((r) => r.id));
    const { events } = options;
    this.#off = [
      events.on(QuestStarted, ({ quest }) => {
        this.#moved(quest, 'active', JOURNAL_NOTICE_TEXT.added);
      }),
      events.on(QuestStageChanged, ({ quest }) => {
        this.#moved(quest, 'active', JOURNAL_NOTICE_TEXT.updated);
      }),
      events.on(QuestObjectiveChanged, ({ quest, state }) => {
        if (state === 'complete') this.#moved(quest, 'active', JOURNAL_NOTICE_TEXT.updated);
      }),
      events.on(QuestResolved, ({ quest }) => {
        this.#ended(quest);
      }),
      events.on(QuestFailed, ({ quest }) => {
        this.#ended(quest);
      }),
    ];
    this.refresh();
  }

  /** Entry ids not yet viewed, by tab. */
  unread(): Readonly<Partial<Record<JournalTabId, readonly string[]>>> {
    const out: Partial<Record<JournalTabId, readonly string[]>> = {};
    for (const [tab, ids] of this.#unread) if (ids.size > 0) out[tab] = [...ids];
    return out;
  }

  /** A tab was viewed. */
  viewed(tab: JournalTabId): void {
    this.#unread.delete(tab);
    this.#syncUnread();
  }

  /** Call when the rumour book changes: each newly heard rumour is a notice. */
  syncRumours(): void {
    for (const rumour of this.#options.rumours?.entries() ?? []) {
      if (this.#knownRumours.has(rumour.id)) continue;
      this.#knownRumours.add(rumour.id);
      this.#add('rumours', rumour.id, `${JOURNAL_NOTICE_TEXT.rumour}: ${rumour.target}`);
    }
  }

  /** Expires toasts; call once per step. */
  afterStep(): void {
    this.#options.hud.frame(this.#options.now());
  }

  /** Re-reads the pinned quest into the tracker. */
  refresh(): void {
    const active = this.#options.model().active;
    const entry = active.find((e) => e.id === this.#pinned) ?? active[0];
    this.#pinned = entry?.id;
    this.#options.hud.track(
      entry === undefined
        ? undefined
        : {
            title: entry.title,
            objectives: (entry.objectives ?? []).filter((o) => !o.done).map((o) => o.text),
          },
    );
  }

  dispose(): void {
    for (const off of this.#off) off();
  }

  #title(quest: string): string {
    return this.#options.defs.find((d) => d.id === quest)?.title ?? quest;
  }

  #moved(quest: string, tab: JournalTabId, lead: string): void {
    this.#pinned = quest;
    this.#add(tab, quest, `${lead}: ${this.#title(quest)}`);
    this.refresh();
  }

  #ended(quest: string): void {
    this.#unread.get('active')?.delete(quest);
    this.#add('done', quest, `${JOURNAL_NOTICE_TEXT.updated}: ${this.#title(quest)}`);
    if (this.#pinned === quest) this.#pinned = undefined;
    this.refresh();
  }

  #add(tab: JournalTabId, id: string, text: string): void {
    const ids = this.#unread.get(tab) ?? new Set<string>();
    ids.add(id);
    this.#unread.set(tab, ids);
    this.#options.hud.toast(text, this.#options.now(), `${tab}:${id}`);
    this.#syncUnread();
  }

  #syncUnread(): void {
    let count = 0;
    for (const ids of this.#unread.values()) count += ids.size;
    this.#options.hud.setUnread(count);
  }
}
