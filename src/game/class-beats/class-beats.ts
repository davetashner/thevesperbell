// Class arrival and class beats in the game (mw-aw1y): the glue between the class-beat narration
// (narration-class-beats.json, mw-e39.17, looked up by `player.class`) and the narration window
// (the epilogue slideshow, generalised: src/ui/epilogue-slideshow.ts).
//
// - New game: when the player confirms a class on the class-selection screen, the next step with no
//   other screen open plays the class's arrival pages ("Why you came") and then its first journal
//   entry. A boot straight into a class (`?class=`, restart, load) does not: it is not a new game
//   chosen at the title, and the e2e and the slice goldens boot that way.
// - There is no journal screen yet, so the first entry is shown here as the last page, once. The main
//   quest's arrival stage text is not replaced (follow-up bead).
// - Beats with a trigger that already exists show their class text once when it fires, and set
//   `class-beat.<beat>.shown` so a save and load does not repeat it: getting-in (the player's own class
//   route into the Deepworks: its enter-by objective completes, or the Vane House roof is entered) and
//   wendmouth (`wendmouth.visited`). The other beats wait for their encounters (follow-up bead).
// - The sim is paused while the window is open (the UI's `pausesSim`). Nothing here changes game state
//   but the `shown` facts.

import type { GameContent } from '@content/index';
import { classBeat, findSequence, type Narration } from '@content/types/narration';
import type { QuestRuntime, World } from '@sim/index';
import {
  openEpilogueSlideshow,
  type EpilogueEnd,
  type EpilogueSlideModel,
  type EpilogueSlideshow,
  type UiRoot,
} from '@ui/index';

/** The id the opening reports as its beat. */
export const OPENING_BEAT = 'opening';
/** `data-screen` of the narration window. */
export const CLASS_BEAT_SCREEN = 'class-beat';
/** The fact that records a beat's text has been shown. */
export const beatShownFact = (beat: string): string => `class-beat.${beat}.shown`;

const MAIN_QUEST = 'quest-labyrinth-beneath-briar-glen';

/** One beat that fires from a trigger the world already has. */
interface BeatTrigger {
  readonly beat: string;
  readonly fires: (
    world: World<never>,
    quests: Pick<QuestRuntime, 'objectiveState'>,
    playerClass: unknown,
  ) => boolean;
}

/** The objective each class completes by taking its own way into the Deepworks. */
const GETTING_IN_OBJECTIVE: Readonly<Record<string, string>> = {
  knight: 'enter-by-supply-tunnel',
  archer: 'enter-by-winch-cage',
  sorcerer: 'enter-by-inner-bar',
};

export const BEAT_TRIGGERS: readonly BeatTrigger[] = [
  {
    beat: 'getting-in',
    fires: (world, quests, playerClass) => {
      if (playerClass === 'thief') return world.facts.get('world.vane-house.roof-entered') === true;
      const objective = GETTING_IN_OBJECTIVE[String(playerClass)];
      return objective !== undefined && quests.objectiveState(MAIN_QUEST, objective) === 'complete';
    },
  },
  { beat: 'wendmouth', fires: (world) => world.facts.get('wendmouth.visited') === true },
];

/** What the e2e reads of the window. */
export interface ClassBeatReading {
  readonly open: boolean;
  /** The beat showing (`opening` or a beat id), or null. */
  readonly beat: string | null;
  /** The beats shown so far, in order. */
  readonly shown: readonly string[];
  /** How the last window ended, or null. */
  readonly ended: EpilogueEnd | null;
}

export interface ClassBeatControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly quests: Pick<QuestRuntime, 'objectiveState'>;
  readonly content: Pick<GameContent, 'all'>;
  readonly onChange?: (reading: ClassBeatReading) => void;
}

/** Plays the class arrival and the class beats. Call `afterStep` each step. */
export class ClassBeatController {
  readonly #options: ClassBeatControllerOptions;
  #window: EpilogueSlideshow | undefined;
  #beat: string | null = null;
  #opening = false;
  #shown: string[] = [];
  #ended: EpilogueEnd | null = null;

  constructor(options: ClassBeatControllerOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#window !== undefined;
  }

  /** A class was just chosen on the class-selection screen: play the arrival at the next free step. */
  startNewGame(): void {
    this.#opening = true;
  }

  /** Opens the opening or a beat whose trigger has fired, once nothing else is on screen. */
  afterStep(): void {
    const { ui, world, quests } = this.#options;
    if (this.#window !== undefined || ui.top !== undefined) return;
    const playerClass = world.facts.get('player.class');
    if (this.#opening) {
      this.#opening = false;
      this.#play(OPENING_BEAT, this.#openingSlides(playerClass));
      return;
    }
    for (const trigger of BEAT_TRIGGERS) {
      if (world.facts.get(beatShownFact(trigger.beat)) === true) continue;
      if (!trigger.fires(world, quests, playerClass)) continue;
      world.facts.set(beatShownFact(trigger.beat), true);
      this.#play(trigger.beat, this.#beatSlides(trigger.beat, playerClass));
      return;
    }
  }

  close(): void {
    this.#window?.skip();
  }

  dispose(): void {
    this.close();
  }

  #narrations(): readonly Narration[] {
    return this.#options.content.all('narration') as readonly Narration[];
  }

  /** The pages of `beat` for the class, one slide each; the first carries the sequence's title. */
  #beatSlides(beat: string, playerClass: unknown): EpilogueSlideModel[] {
    const narrations = this.#narrations();
    const pages = classBeat(narrations, beat, String(playerClass))?.pages ?? [];
    const title = findSequence(narrations, 'class-beat', beat)?.title;
    return pages.map((page, index) => ({
      id: `${beat}-${String(index)}`,
      title: index === 0 ? title : undefined,
      text: page.text,
    }));
  }

  /** The arrival pages, then the first journal entry as the last page. */
  #openingSlides(playerClass: unknown): EpilogueSlideModel[] {
    return [
      ...this.#beatSlides('arrival', playerClass),
      ...this.#beatSlides('first-journal', playerClass),
    ];
  }

  #play(beat: string, slides: readonly EpilogueSlideModel[]): void {
    this.#shown.push(beat);
    if (slides.length === 0) {
      this.#ended = 'finished';
      this.#report();
      return;
    }
    this.#beat = beat;
    this.#window = openEpilogueSlideshow(this.#options.ui, {
      slides,
      screenId: CLASS_BEAT_SCREEN,
      label: 'Narration',
      unit: 'Page',
      onEnd: (end) => {
        this.#window = undefined;
        this.#beat = null;
        this.#ended = end;
        this.#report();
      },
    });
    this.#report();
  }

  #report(): void {
    this.#options.onChange?.({
      open: this.#window !== undefined,
      beat: this.#beat,
      shown: [...this.#shown],
      ended: this.#ended,
    });
  }
}

export interface ClassBeatUiOptions extends Omit<ClassBeatControllerOptions, 'onChange'> {
  /** Publishes a readout for the e2e: `classBeat` (JSON of a `ClassBeatReading`). */
  readonly publish?: (key: 'classBeat', value: string) => void;
}

/** The class arrival and beats in a running game. */
export interface ClassBeatUi {
  readonly controller: ClassBeatController;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Readies the class arrival and class beats. */
export function startClassBeatUi(options: ClassBeatUiOptions): ClassBeatUi {
  const { publish, ...rest } = options;
  const controller = new ClassBeatController({
    ...rest,
    onChange: (reading) => publish?.('classBeat', JSON.stringify(reading)),
  });
  publish?.('classBeat', JSON.stringify({ open: false, beat: null, shown: [], ended: null }));
  return {
    controller,
    afterStep: () => {
      controller.afterStep();
    },
  };
}
