// The rumour system (mw-e22.11): conversation turns into exploration. A teller's `rumor.told` emit
// (or a `revealRumor` effect) records the rumour as heard; its target becomes a lead; going there
// resolves it ("investigated", event `rumor.resolved`); a false or half-true rumour can be debunked,
// by seeing for oneself or by asking the debunker; Dot trades the follow-up line back once, after a
// visit (her dialogue reads the facts below and sets `followed`).
//
// Everything lives in permanent facts, `entity:rumours/<rumour id>.<state>`, written only when the
// player hears a rumour: a new game has none, and a save carries the whole journal state. The book
// reads the facts on demand (`entries`, `leads`), so the journal (mw-e23.6) renders it with no
// state of its own.
//
// What counts as visiting a target is the `VISIT_TRIGGERS` table: an arrival volume (a signal-graph
// volume node id or graph id the player enters), talking to an NPC, or starting a quest. A target
// with no trigger stays a lead until one exists (mw-8n3j lists them). Visits before a rumour is
// heard are not remembered: only the rumours already heard are listening.

import type { GameContent } from '@content/index';
import type { Rumor } from '@content/types/rumor';
import {
  entityFactKey,
  DialogueStarted,
  volumeEntered,
  type EntityId,
  type QuestRuntime,
  type World,
} from '@sim/index';
import { logicEmitted, rumorRevealed } from '../logic/host';

/** Emitted by a teller (data `rumor`: the bible number, `source`: the teller's NPC id). */
export const RUMOUR_TOLD_EVENT = 'rumor.told';
/** Emitted by a debunker's dialogue (data `rumor`: the bible number). */
export const RUMOUR_CORRECTED_EVENT = 'rumor.corrected';
/** Published when a heard rumour's target is visited (data `rumor`: the rumour id). */
export const RUMOUR_RESOLVED_EVENT = 'rumor.resolved';
/** Published when a rumour is learned to be wrong (data `rumor`: the rumour id). */
export const RUMOUR_DEBUNKED_EVENT = 'rumor.debunked';

/** The level segment of every rumour fact. */
export const RUMOUR_FACT_LEVEL = 'rumours';

export type RumourState = 'heard' | 'investigated' | 'debunked' | 'followed';

/** The permanent fact that holds `state` of `rumourId`. */
export const rumourFactKey = (rumourId: string, state: RumourState): string =>
  entityFactKey(RUMOUR_FACT_LEVEL, rumourId, state);

/** How the player visits a target: enters an area, speaks to an NPC or starts a quest. */
export type VisitTrigger =
  { readonly area: string } | { readonly talk: string } | { readonly quest: string };

/**
 * Visit triggers by glossary or quest id. Absent: no arrival volume exists yet (bead mw-8n3j adds
 * them for briarwood, mooring-watch, glen-well, lamplit-stacks, millweir, standing-horn,
 * weeping-adit and breakwater), so those rumours stay leads.
 */
export const VISIT_TRIGGERS: Readonly<Record<string, readonly VisitTrigger[]>> = {
  'term-vesper-bell': [{ area: 'belfry' }],
  'place-fold': [{ area: 'the-fold' }],
  'place-deepworks': [{ area: 'mine-gate' }],
  'place-bay-nine': [{ area: 'bonded-warehouse' }],
  'place-undertow': [{ area: 'undertow' }],
  'npc-vane': [{ talk: 'npc-vane' }],
  'npc-clatter': [{ talk: 'npc-clatter' }],
  'npc-quillon': [{ talk: 'npc-quillon' }],
  'npc-cray': [{ talk: 'npc-cray' }],
  'npc-hesketh': [{ talk: 'npc-hesketh' }],
  'quest-framed-in-brass': [{ quest: 'quest-framed-in-brass' }],
  'quest-captains-boots': [{ quest: 'quest-captains-boots' }],
};

/** The content's rumours, in file order. Content entries are deeply readonly; the book never writes them. */
export function rumoursOf(content: Pick<GameContent, 'all'>): readonly Rumor[] {
  return content.all('rumor') as unknown as readonly Rumor[];
}

/** What a journal shows of one heard rumour. */
export interface RumourEntry {
  readonly id: string;
  readonly text: string;
  readonly target: string;
  readonly truth: Rumor['truth'];
  /** `lead` until the target is visited, then `investigated`. */
  readonly status: 'lead' | 'investigated';
  readonly debunked: boolean;
  /** The line Dot trades back: set once visited and not yet traded. */
  readonly followUp: string | undefined;
}

export interface RumourBookOptions {
  readonly world: World<never>;
  readonly rumours: readonly Rumor[];
  /** Absent when the content has no quests: quest triggers then never fire. */
  readonly quests: QuestRuntime | undefined;
  readonly triggers?: Readonly<Record<string, readonly VisitTrigger[]>>;
  /** The player's entity: only the player enters areas. */
  readonly player: () => EntityId | undefined;
  /** Called when the book changes (heard, investigated, debunked, followed). */
  readonly onChange?: () => void;
}

const NUMBERED = /^rumor-(\d{2})-/;

/** The rumour with bible number `n` (data `rumor` of a `rumor.told` emit). */
function byNumber(rumours: readonly Rumor[], n: unknown): Rumor | undefined {
  return rumours.find((r) => Number(NUMBERED.exec(r.id)?.[1]) === n);
}

/** Records heard rumours, resolves them on visits and debunks the false ones. */
export class RumourBook {
  readonly #options: RumourBookOptions;
  readonly #off: (() => void)[];

  constructor(options: RumourBookOptions) {
    this.#options = options;
    const { world } = options;
    this.#off = [
      world.events.on(logicEmitted, ({ event, data }) => {
        if (event === RUMOUR_TOLD_EVENT) {
          const rumour = byNumber(options.rumours, data['rumor']);
          if (rumour !== undefined) this.hear(rumour.id);
        } else if (event === RUMOUR_CORRECTED_EVENT) {
          const rumour = byNumber(options.rumours, data['rumor']);
          if (rumour !== undefined) this.debunk(rumour.id);
        }
      }),
      world.events.on(rumorRevealed, ({ rumor }) => {
        this.hear(rumor);
      }),
      world.events.on(volumeEntered, ({ graphId, node, entity }) => {
        if (entity === options.player())
          this.#visit((t) => 'area' in t && (t.area === node || t.area === graphId));
      }),
      world.events.on(DialogueStarted, ({ npc }) => {
        this.#visit((t) => 'talk' in t && t.talk === npc);
      }),
    ];
  }

  #has(id: string, state: RumourState): boolean {
    return this.#options.world.facts.get(rumourFactKey(id, state)) === true;
  }

  #set(id: string, state: RumourState): void {
    this.#options.world.facts.set(rumourFactKey(id, state), true);
    this.#options.onChange?.();
  }

  #triggers(target: string): readonly VisitTrigger[] {
    return (this.#options.triggers ?? VISIT_TRIGGERS)[target] ?? [];
  }

  /** Records `id` as heard (once); its target is a lead from now on. Unknown ids are ignored. */
  hear(id: string): boolean {
    const rumour = this.#options.rumours.find((r) => r.id === id);
    if (rumour === undefined || this.#has(id, 'heard')) return false;
    this.#set(id, 'heard');
    // A quest the player already started is a visit now: nothing else would tell the book.
    this.update();
    return true;
  }

  /** Marks `id` as debunked when the player has heard it and it is not true. */
  debunk(id: string): boolean {
    const rumour = this.#options.rumours.find((r) => r.id === id);
    if (rumour === undefined || rumour.truth === 'true') return false;
    if (!this.#has(id, 'heard') || this.#has(id, 'debunked')) return false;
    this.#set(id, 'debunked');
    this.#options.world.events.emit(logicEmitted, {
      event: RUMOUR_DEBUNKED_EVENT,
      data: { rumor: id },
    });
    return true;
  }

  /** A visit that matches `hit` investigates heard targets and debunks heard rumours seen through. */
  #visit(hit: (trigger: VisitTrigger) => boolean): void {
    for (const rumour of this.#options.rumours) {
      if (!this.#has(rumour.id, 'heard')) continue;
      if (!this.#has(rumour.id, 'investigated') && this.#triggers(rumour.target).some(hit)) {
        this.#set(rumour.id, 'investigated');
        this.#options.world.events.emit(logicEmitted, {
          event: RUMOUR_RESOLVED_EVENT,
          data: { rumor: rumour.id },
        });
      }
      for (const way of rumour.debunk ?? []) {
        if (way.via === 'dive' && this.#triggers(way.place).some(hit)) this.debunk(rumour.id);
      }
    }
  }

  /** Quest triggers have no event; call each step (cheap: only heard, uninvestigated rumours). */
  update(): void {
    const { quests } = this.#options;
    if (quests === undefined) return;
    this.#visit((t) => 'quest' in t && quests.questState(t.quest) !== 'unstarted');
  }

  /** The heard rumours, in content order, as a journal lists them. */
  entries(): RumourEntry[] {
    const entries: RumourEntry[] = [];
    for (const rumour of this.#options.rumours) {
      if (!this.#has(rumour.id, 'heard')) continue;
      const investigated = this.#has(rumour.id, 'investigated');
      entries.push({
        id: rumour.id,
        text: rumour.text,
        target: rumour.target,
        truth: rumour.truth,
        status: investigated ? 'investigated' : 'lead',
        debunked: this.#has(rumour.id, 'debunked'),
        followUp:
          investigated && !this.#has(rumour.id, 'followed') ? rumour.followUp?.text : undefined,
      });
    }
    return entries;
  }

  /** Targets still worth a trip: heard, not yet visited. */
  leads(): string[] {
    return this.entries()
      .filter((e) => e.status === 'lead')
      .map((e) => e.target);
  }

  dispose(): void {
    for (const off of this.#off) off();
  }
}

/** What the e2e reads: `#app[data-rumours]`. */
export interface RumourReading {
  readonly heard: readonly string[];
  readonly leads: readonly string[];
  readonly investigated: readonly string[];
  readonly debunked: readonly string[];
}

/** The readout of `book`. */
export function rumourReading(book: RumourBook): RumourReading {
  const entries = book.entries();
  return {
    heard: entries.map((e) => e.id),
    leads: book.leads(),
    investigated: entries.filter((e) => e.status === 'investigated').map((e) => e.id),
    debunked: entries.filter((e) => e.debunked).map((e) => e.id),
  };
}

export interface RumourUiOptions extends Omit<RumourBookOptions, 'onChange'> {
  /** Publishes a readout for the e2e: `rumours` (JSON of a `RumourReading`). */
  readonly publish?: (key: 'rumours', value: string) => void;
}

/** The rumour book in a running game. */
export interface RumourUi {
  readonly book: RumourBook;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Starts the rumour book over `options`; it opens no UI, so a debug boot is never blocked. */
export function startRumourUi(options: RumourUiOptions): RumourUi {
  const { publish, ...rest } = options;
  const report = (): void => {
    publish?.('rumours', JSON.stringify(rumourReading(book)));
  };
  const book: RumourBook = new RumourBook({ ...rest, onChange: report });
  report();
  return {
    book,
    afterStep: () => {
      book.update();
    },
  };
}
