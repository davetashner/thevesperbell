// The epilogue slideshow in the game (mw-e39.40): the glue between the epilogue quest
// (`quest-briar-glen-epilogue`, mw-e39.4), the narration content (mw-e39.16) and the UI's slideshow
// (src/ui/epilogue-slideshow.ts).
//
// - When the main quest resolves, the epilogue quest starts (its `startWhen`) and `afterStep` opens the
//   slideshow once no other screen is open (a save loaded mid-epilogue opens it too). It shows the
//   headline ending's card (`ending.headline`), then one slide per active objective of the epilogue
//   quest, in the quest's order: the objectives' `activeWhen` is the selection rule, the prose is the
//   narration file's, keyed by objective id.
// - Each slide shown publishes the logic event `epilogue-slide-<objective id>`, which completes its
//   objective. Finishing or skipping publishes the slides not yet shown, then writes
//   `epilogue.finished`, which resolves the epilogue quest. The player then walks on in free roam.
// - `preview(ending)` (queued by the debug console's `epilogue.preview` until its screen closes) plays the card and every slide an ending
//   can show, with no events and no facts, so it changes nothing in the world.
// - The sim is paused while the slideshow is open (the UI's `pausesSim`).

import type { GameContent } from '@content/index';
import {
  endingCard,
  epilogueSlide,
  findSequence,
  HEADLINE_ENDINGS,
  type HeadlineEnding,
  type Narration,
} from '@content/types/narration';
import type { QuestRuntime, World } from '@sim/index';
import {
  openEpilogueSlideshow,
  type EpilogueEnd,
  type EpilogueSlideModel,
  type EpilogueSlideshow,
  type UiRoot,
} from '@ui/index';
import { logicEmitted } from '../logic/host';

/** The quest whose active objectives are the slides. */
export const EPILOGUE_QUEST = 'quest-briar-glen-epilogue';
/** The fact the slideshow sets when it ends; it resolves the epilogue quest. */
export const EPILOGUE_FINISHED_FACT = 'epilogue.finished';
/** The fact that holds the headline ending the main quest resolved with. */
export const ENDING_FACT = 'ending.headline';
/** The event that completes a slide's objective. */
export const epilogueSlideEvent = (objective: string): string => `epilogue-slide-${objective}`;

/** What the e2e reads of the slideshow. */
export interface EpilogueReading {
  readonly open: boolean;
  /** The id showing (`ending-<ending>` or an objective id), or null. */
  readonly slide: string | null;
  readonly preview: boolean;
  /** How the last real slideshow ended, or null while it has not. */
  readonly ended: EpilogueEnd | null;
}

export interface EpilogueControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly quests: Pick<QuestRuntime, 'questState' | 'activeObjectives'>;
  readonly content: Pick<GameContent, 'all' | 'get'>;
  readonly onChange?: (reading: EpilogueReading) => void;
}

interface Session {
  readonly window: EpilogueSlideshow;
  readonly preview: boolean;
  slide: string | null;
}

/** Plays the slideshow for the epilogue quest. Call `afterStep` each step. */
export class EpilogueController {
  readonly #options: EpilogueControllerOptions;
  #session: Session | undefined;
  #ended: EpilogueEnd | null = null;
  #queued: HeadlineEnding | undefined;

  constructor(options: EpilogueControllerOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#session !== undefined;
  }

  /** Opens the slideshow when the epilogue quest is active and nothing else is on screen. */
  afterStep(): void {
    const { ui, world, quests } = this.#options;
    if (this.#session !== undefined || ui.top !== undefined) return;
    if (this.#queued !== undefined) {
      const ending = this.#queued;
      this.#queued = undefined;
      this.preview(ending);
      return;
    }
    if (quests.questState(EPILOGUE_QUEST) !== 'active') return;
    if (world.facts.get(EPILOGUE_FINISHED_FACT) === true) return;
    const ending = world.facts.get(ENDING_FACT);
    const objectives = quests
      .activeObjectives()
      .filter((active) => active.quest === EPILOGUE_QUEST)
      .map((active) => active.objective.id);
    this.#play(this.#slides(ending, objectives), objectives, false);
  }

  /** Plays the card and every slide `ending` can show, changing nothing. Returns whether it opened. */
  preview(ending: HeadlineEnding): boolean {
    if (this.#session !== undefined || this.#options.ui.top !== undefined) return false;
    const narrations = this.#narrations();
    const order = this.#options.content.get('quest', EPILOGUE_QUEST).objectives.map((o) => o.id);
    const objectives = order.filter((id) =>
      findSequence(narrations, 'epilogue', id)?.endings?.includes(ending),
    );
    this.#play(this.#slides(ending, objectives), [], true);
    return true;
  }

  /** Plays `preview(ending)` at the next step once no screen is open (the console is one). */
  queuePreview(ending: HeadlineEnding): void {
    this.#queued = ending;
  }

  close(): void {
    this.#session?.window.skip();
  }

  dispose(): void {
    this.close();
  }

  #narrations(): readonly Narration[] {
    return this.#options.content.all('narration') as readonly Narration[];
  }

  /** The ending's card, then the slide of each objective that has text. */
  #slides(ending: unknown, objectives: readonly string[]): EpilogueSlideModel[] {
    const narrations = this.#narrations();
    const slides: EpilogueSlideModel[] = [];
    const known = HEADLINE_ENDINGS.find((e) => e === ending);
    const card = known === undefined ? undefined : endingCard(narrations, known);
    if (card !== undefined) {
      slides.push({ id: `ending-${String(known)}`, title: card.title, text: card.text });
    }
    for (const id of objectives) {
      const text = epilogueSlide(narrations, id);
      if (text !== undefined) {
        slides.push({ id, title: findSequence(narrations, 'epilogue', id)?.title, text });
      }
    }
    return slides;
  }

  #play(slides: readonly EpilogueSlideModel[], objectives: readonly string[], preview: boolean) {
    const { ui, world } = this.#options;
    const shown = new Set<string>();
    const emit = (id: string): void => {
      if (preview || shown.has(id) || !objectives.includes(id)) return;
      shown.add(id);
      world.events.emit(logicEmitted, { event: epilogueSlideEvent(id), data: { slide: id } });
    };
    const finish = (end: EpilogueEnd): void => {
      this.#session = undefined;
      if (!preview) {
        for (const id of objectives) emit(id);
        world.facts.set(EPILOGUE_FINISHED_FACT, true);
        this.#ended = end;
      }
      this.#report();
    };
    if (slides.length === 0) {
      finish('finished');
      return;
    }
    const session = {
      preview,
      slide: null as string | null,
      window: undefined as unknown as EpilogueSlideshow,
    };
    this.#session = session;
    session.window = openEpilogueSlideshow(ui, {
      slides,
      onSlide: (slide) => {
        session.slide = slide.id;
        emit(slide.id);
        this.#report();
      },
      onEnd: finish,
    });
  }

  #report(): void {
    this.#options.onChange?.({
      open: this.#session !== undefined,
      slide: this.#session?.slide ?? null,
      preview: this.#session?.preview ?? false,
      ended: this.#ended,
    });
  }
}

export interface EpilogueUiOptions extends Omit<EpilogueControllerOptions, 'onChange'> {
  /** Publishes a readout for the e2e: `epilogue` (JSON of an `EpilogueReading`). */
  readonly publish?: (key: 'epilogue', value: string) => void;
}

/** The slideshow in a running game. */
export interface EpilogueUi {
  readonly controller: EpilogueController;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Readies the epilogue slideshow over the world's epilogue quest. */
export function startEpilogueUi(options: EpilogueUiOptions): EpilogueUi {
  const { publish, ...rest } = options;
  const controller = new EpilogueController({
    ...rest,
    onChange: (reading) => publish?.('epilogue', JSON.stringify(reading)),
  });
  publish?.('epilogue', JSON.stringify({ open: false, slide: null, preview: false, ended: null }));
  return {
    controller,
    afterStep: () => {
      controller.afterStep();
    },
  };
}
