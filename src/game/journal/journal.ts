// The journal in the game (mw-e23.6, mw-1myt): the model the journal window shows, and the controller
// that opens it.
//
// - Quests: Active lists every active quest with its current stage text and its objectives as a
//   checklist (a hidden objective shows once done; an inactive one never). Completed / Failed lists
//   resolved quests with their resolution entry and failed ones with their failure entry, so a failure
//   that continues reads as a story: its successor, started in the same tick, is under Active.
// - The class's first journal entry (narration `class-beat` `first-journal`, keyed by `player.class`)
//   is the opening of the main quest's journal: it stands in for the generic arrival stage text while
//   the quest is in that stage, and stays under Notes afterwards with every class beat shown so far
//   (`class-beat.<beat>.shown`, written by the arrival glue when a beat plays).
// - Rumours: the heard rumours as leads, from `JournalRumours`, the interface the rumour book
//   (src/game/rumours, mw-e22.11) satisfies with `entries()`. Without a source the tab stays empty.
// - `JournalController` opens the window on the journal key (J) or from the pause menu, when no other
//   screen is open and the game can pause. It never opens by itself. The sim is paused while it is
//   open (the UI's `pausesSim`).

import type { GameContent } from '@content/index';
import { classBeat, CLASS_BEAT_IDS, findSequence, type Narration } from '@content/types/narration';
import type { QuestDef } from '@content/types/quest';
import type { FactValue, QuestRuntime } from '@sim/index';
import {
  openJournalWindow,
  type JournalEntryModel,
  type JournalModel,
  type JournalTabId,
  type JournalWindow,
  type UiRoot,
} from '@ui/index';
import { beatShownFact } from '../class-beats/class-beats';

/** The main quest, whose arrival stage the class's first journal entry stands in for. */
export const MAIN_QUEST = 'quest-labyrinth-beneath-briar-glen';
/** The class beat that is the first journal entry. */
export const FIRST_JOURNAL_BEAT = 'first-journal';
/** The fact that holds the player's class. */
export const PLAYER_CLASS_FACT = 'player.class';
/** `player.class` before a class is chosen. */
const NO_CLASS = 'none';
/** The fact that records a class beat has been shown. */
export const classBeatShownFact = beatShownFact;

/** One heard rumour as the journal lists it (the rumour book's `RumourEntry` satisfies this). */
export interface JournalRumour {
  readonly id: string;
  readonly text: string;
  readonly target: string;
  /** `lead` until the target is visited, then `investigated`. */
  readonly status: 'lead' | 'investigated';
  readonly debunked: boolean;
  readonly followUp?: string | undefined;
}

/** What the journal reads of the rumour book. */
export interface JournalRumours {
  entries(): readonly JournalRumour[];
}

export const JOURNAL_STATUS = Object.freeze({
  failed: 'Failed',
  resolved: 'Resolved',
  lead: 'A lead',
  investigated: 'Looked into',
  debunked: 'Nothing in it',
});

export interface JournalSources {
  readonly quests: Pick<
    QuestRuntime,
    'questState' | 'objectiveState' | 'stage' | 'resolution' | 'failure'
  >;
  readonly defs: readonly QuestDef[];
  readonly facts: {
    has(key: string): boolean;
    get(key: string): FactValue | undefined;
  };
  readonly narrations: readonly Narration[];
  readonly rumours?: JournalRumours | undefined;
}

function questEntry(
  sources: JournalSources,
  def: QuestDef,
  firstJournal: readonly string[] | undefined,
): JournalEntryModel | undefined {
  const { quests } = sources;
  const state = quests.questState(def.id);
  if (state === 'unstarted') return undefined;
  const objectives = def.objectives
    .filter((o) => {
      const s = quests.objectiveState(def.id, o.id);
      return s === 'complete' || (s === 'active' && state === 'active' && !o.hidden);
    })
    .map((o) => ({
      text: o.text,
      done: quests.objectiveState(def.id, o.id) === 'complete',
      optional: o.optional,
    }));
  const base = { id: def.id, title: def.title, objectives };
  if (state === 'failed') {
    const id = quests.failure(def.id);
    const failure = def.failures.find((f) => f.id === id);
    return {
      ...base,
      status: JOURNAL_STATUS.failed,
      paragraphs: [failure?.journal ?? def.summary],
    };
  }
  if (state === 'resolved') {
    const id = quests.resolution(def.id);
    const resolution = def.resolutions.find((r) => r.id === id);
    return {
      ...base,
      status: JOURNAL_STATUS.resolved,
      paragraphs: [resolution?.journal ?? def.summary],
    };
  }
  const stage = quests.stage(def.id);
  const stageText = def.stages.find((s) => s.id === stage)?.text;
  const current = stageText ?? def.summary;
  // The main quest reads as the class's own account: its first entry stands in for the generic arrival
  // stage text, and the stage that follows is written after it.
  const paragraphs =
    def.id !== MAIN_QUEST || firstJournal === undefined
      ? [current]
      : stage === def.initialStage
        ? firstJournal
        : [...firstJournal, current];
  return { ...base, paragraphs };
}

function noteEntries(
  sources: JournalSources,
  playerClass: string | undefined,
): { notes: JournalEntryModel[]; firstJournal: readonly string[] | undefined } {
  const { narrations, facts } = sources;
  if (playerClass === undefined) return { notes: [], firstJournal: undefined };
  const notes: JournalEntryModel[] = [];
  let firstJournal: readonly string[] | undefined;
  for (const beat of CLASS_BEAT_IDS) {
    const shown =
      beat === FIRST_JOURNAL_BEAT ||
      (facts.has(classBeatShownFact(beat)) && facts.get(classBeatShownFact(beat)) === true);
    const text = shown ? classBeat(narrations, beat, playerClass) : undefined;
    if (text === undefined) continue;
    const paragraphs = text.pages.map((page) => page.text);
    if (beat === FIRST_JOURNAL_BEAT) firstJournal = paragraphs;
    notes.push({
      id: `class-beat-${beat}`,
      title: findSequence(narrations, 'class-beat', beat)?.title ?? 'A note',
      paragraphs,
    });
  }
  return { notes, firstJournal };
}

/** The journal's entries for the world as it stands. */
export function buildJournal(sources: JournalSources): JournalModel {
  const playerClass = sources.facts.get(PLAYER_CLASS_FACT);
  const { notes, firstJournal } = noteEntries(
    sources,
    typeof playerClass === 'string' && playerClass !== NO_CLASS ? playerClass : undefined,
  );
  const active: JournalEntryModel[] = [];
  const done: JournalEntryModel[] = [];
  for (const def of sources.defs) {
    const entry = questEntry(sources, def, firstJournal);
    if (entry === undefined) continue;
    (entry.status === undefined ? active : done).push(entry);
  }
  const rumours = (sources.rumours?.entries() ?? []).map((r): JournalEntryModel => ({
    id: r.id,
    title: r.target,
    status: r.debunked
      ? JOURNAL_STATUS.debunked
      : r.status === 'lead'
        ? JOURNAL_STATUS.lead
        : JOURNAL_STATUS.investigated,
    paragraphs: [r.text],
  }));
  return { active, done, rumours, notes };
}

/** The journal's sources from the game's content and running world. */
export function journalSources(
  content: Pick<GameContent, 'all'>,
  parts: Omit<JournalSources, 'defs' | 'narrations'>,
): JournalSources {
  return {
    ...parts,
    defs: content.all('quest') as unknown as readonly QuestDef[],
    narrations: content.all('narration') as readonly Narration[],
  };
}

export interface JournalControllerOptions {
  readonly ui: UiRoot;
  /** Builds the model each time the window opens. */
  readonly model: () => JournalModel;
  /** Whether the game may open it now: a living player in play. */
  readonly canOpen: () => boolean;
  /** Keyboard codes bound to the Journal action (the sampler's bindings: J). */
  readonly keys: () => readonly string[];
  /** Publishes `open` or `closed` for the e2e. */
  readonly publish?: (state: 'open' | 'closed') => void;
}

/** Opens and closes the journal window. */
export class JournalController {
  readonly #options: JournalControllerOptions;
  #window: JournalWindow | undefined;

  constructor(options: JournalControllerOptions) {
    this.#options = options;
    options.publish?.('closed');
  }

  get isOpen(): boolean {
    return this.#window !== undefined;
  }

  /**
   * Opens the journal unless it or another screen is open or the game cannot open it now. `over`
   * opens it above the screen on top (the pause menu's Journal option).
   */
  open(tab?: JournalTabId, over = false): boolean {
    const { ui, model, canOpen, publish } = this.#options;
    if (this.#window !== undefined || (!over && ui.top !== undefined) || !canOpen()) return false;
    this.#window = openJournalWindow(ui, {
      model: model(),
      ...(tab !== undefined && { tab }),
      onClose: () => {
        this.#window = undefined;
        publish?.('closed');
      },
    });
    publish?.('open');
    return true;
  }

  /** The journal key: closes the journal when it is the screen on top, else opens it. */
  toggle(): void {
    if (this.#window === undefined) this.open();
    else if (this.#options.ui.top === this.#window.screen) this.#window.close();
  }

  /**
   * A key went down on the window while the journal is open: the journal key closes it. (With a
   * screen open the pointer is free, so the sampler no longer sees the key.) Returns whether it
   * was handled.
   */
  keydown(event: { readonly code: string; readonly repeat: boolean }): boolean {
    if (event.repeat || !this.#options.keys().includes(event.code)) return false;
    if (this.#window === undefined) return false;
    this.toggle();
    return true;
  }

  close(): void {
    this.#window?.close();
  }
}
