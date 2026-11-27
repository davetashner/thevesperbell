// The barge ride card (mw-e25.15): the narrated ride on Mags Oakum's Patient Ann, shown on arrival.
//
// A barge fare (data/service barge-*) sets the `barge.ride` fact, jumps the clock and asks to travel;
// the scene swaps in place, the fact is carried over, and the first step the new scene has no other
// screen open the card plays the matching narration-barge sequence as pages on the narration window
// (the epilogue slideshow, src/ui/epilogue-slideshow.ts), then the fact goes back to `none`. Boarding
// at Kestrel Lock skips the page that casts off from Briar Glen Quay. Skipping the card (Esc) still
// ends the ride. The sim is paused while it is open; nothing else changes game state.

import type { GameContent } from '@content/index';
import { findSequence, type Narration } from '@content/types/narration';
import type { World } from '@sim/index';
import {
  openEpilogueSlideshow,
  type EpilogueEnd,
  type EpilogueSlideModel,
  type EpilogueSlideshow,
  type UiRoot,
} from '@ui/index';

/** `data-screen` of the ride card. */
export const BARGE_RIDE_SCREEN = 'barge-ride';
/** The fact the fares set and the card resets. */
export const BARGE_RIDE_FACT = 'barge.ride';

/** The narration-barge sequence each `barge.ride` value plays, and how many opening pages to skip. */
const RIDES: Readonly<Record<string, { readonly sequence: string; readonly skip: number }>> = {
  downriver: { sequence: 'downriver-to-wendmouth', skip: 0 },
  'lock-downriver': { sequence: 'downriver-to-wendmouth', skip: 1 },
  upriver: { sequence: 'upriver-to-briar-glen', skip: 0 },
};

/** What the e2e reads of the card. */
export interface BargeRideReading {
  readonly open: boolean;
  /** The ride showing (`downriver`, `lock-downriver`, `upriver`), or null. */
  readonly ride: string | null;
  /** The rides shown so far, in order. */
  readonly shown: readonly string[];
  readonly ended: EpilogueEnd | null;
}

export interface BargeRideOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly content: Pick<GameContent, 'all'>;
  readonly onChange?: (reading: BargeRideReading) => void;
}

/** Plays the ride card for a ride just taken. Call `afterStep` each step. */
export class BargeRideCard {
  readonly #options: BargeRideOptions;
  #window: EpilogueSlideshow | undefined;
  #ride: string | null = null;
  #shown: string[] = [];
  #ended: EpilogueEnd | null = null;

  constructor(options: BargeRideOptions) {
    this.#options = options;
  }

  get isOpen(): boolean {
    return this.#window !== undefined;
  }

  /** Opens the card when a ride is waiting and nothing else is on screen. */
  afterStep(): void {
    const { ui, world } = this.#options;
    if (this.#window !== undefined || ui.top !== undefined) return;
    const ride = world.facts.get(BARGE_RIDE_FACT);
    if (typeof ride !== 'string' || ride === 'none') return;
    world.facts.set(BARGE_RIDE_FACT, 'none');
    this.#play(ride, this.#slides(ride));
  }

  close(): void {
    this.#window?.skip();
  }

  #slides(ride: string): EpilogueSlideModel[] {
    const found = RIDES[ride];
    if (found === undefined) return [];
    const narrations = this.#options.content.all('narration') as readonly Narration[];
    const sequence = findSequence(narrations, 'barge', found.sequence);
    return (sequence?.pages ?? []).slice(found.skip).map((page, index) => ({
      id: `${found.sequence}-${String(index + found.skip)}`,
      title: index === 0 ? sequence?.title : undefined,
      text: page.text,
    }));
  }

  #play(ride: string, slides: readonly EpilogueSlideModel[]): void {
    this.#shown.push(ride);
    if (slides.length === 0) {
      this.#ended = 'finished';
      this.#report();
      return;
    }
    this.#ride = ride;
    this.#window = openEpilogueSlideshow(this.#options.ui, {
      slides,
      screenId: BARGE_RIDE_SCREEN,
      label: 'The Patient Ann',
      unit: 'Page',
      onEnd: (end) => {
        this.#window = undefined;
        this.#ride = null;
        this.#ended = end;
        this.#report();
      },
    });
    this.#report();
  }

  #report(): void {
    this.#options.onChange?.({
      open: this.#window !== undefined,
      ride: this.#ride,
      shown: [...this.#shown],
      ended: this.#ended,
    });
  }
}

export interface BargeRideUiOptions extends Omit<BargeRideOptions, 'onChange'> {
  /** Publishes a readout for the e2e: `bargeRide` (JSON of a `BargeRideReading`). */
  readonly publish?: (key: 'bargeRide', value: string) => void;
}

/** Readies the ride card in a running game. */
export function startBargeRideUi(options: BargeRideUiOptions): BargeRideCard {
  const { publish, ...rest } = options;
  const card = new BargeRideCard({
    ...rest,
    onChange: (reading) => publish?.('bargeRide', JSON.stringify(reading)),
  });
  publish?.('bargeRide', JSON.stringify({ open: false, ride: null, shown: [], ended: null }));
  return card;
}
