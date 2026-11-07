// The shop's stingers (mw-ju8.11): a short greeting when a merchant's window opens, a cadence when a
// deal goes through and a farewell when it closes. Non-spatial one-shots on the music bus (so the
// Music slider covers them); only one sounds at a time (a new one fades the last), and the deal
// stinger is rate limited so a run of quick purchases is not a run of cadences. A deal counts whichever
// way it goes: buying, selling to the merchant, buying back and a lesson all jingle. Presentation only:
// the shop reports what happened and this never touches the sim.
import type { PlayOptions, SoundHandle } from '@audio/index';

/** The stingers one merchant has. */
export interface ShopStingerSet {
  readonly merchant: string;
  readonly greeting: string;
  readonly sale: string;
  readonly farewell: string;
}

/** The merchants that have stingers. */
export const SHOP_STINGERS: readonly ShopStingerSet[] = [
  {
    merchant: 'marsh-general-store',
    greeting: 'stinger-marsh-greeting',
    sale: 'stinger-marsh-sale',
    farewell: 'stinger-marsh-farewell',
  },
];

/** Least time between two deal stingers, ms. */
export const SALE_MIN_GAP_MS = 1500;
/** Seconds the previous stinger fades out over when another starts. */
export const STINGER_FADE_S = 0.25;

/** What the shop reports (the shop window's `ShopEvent`). */
export interface ShopStingerEvent {
  readonly kind: 'opened' | 'closed' | 'deal';
  readonly merchantId: string;
}

/** The engine as the stingers use it (the AudioEngine satisfies it). */
export interface StingerEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

export interface ShopStingersOptions {
  readonly engine: StingerEngine;
  /** Presentation clock in ms. */
  readonly now: () => number;
  /** Defaults to the game's stingers. */
  readonly sets?: readonly ShopStingerSet[];
}

export class ShopStingers {
  readonly #engine: StingerEngine;
  readonly #now: () => number;
  readonly #sets: readonly ShopStingerSet[];
  #current: SoundHandle | null = null;
  #lastSale = -Infinity;

  constructor(options: ShopStingersOptions) {
    this.#engine = options.engine;
    this.#now = options.now;
    this.#sets = options.sets ?? SHOP_STINGERS;
  }

  /** Plays the stinger for what happened, if the merchant has one and audio can run. */
  handle(event: ShopStingerEvent): void {
    const set = this.#sets.find((s) => s.merchant === event.merchantId);
    if (set === undefined || this.#engine.context?.state !== 'running') return;
    if (event.kind === 'deal') {
      const now = this.#now();
      if (now - this.#lastSale < SALE_MIN_GAP_MS) return;
      this.#lastSale = now;
    }
    this.#play(
      event.kind === 'opened' ? set.greeting : event.kind === 'deal' ? set.sale : set.farewell,
    );
  }

  /** Fades out whatever is sounding (leaving the scene). */
  dispose(): void {
    this.#current?.stop(STINGER_FADE_S);
    this.#current = null;
  }

  #play(cue: string): void {
    this.#current?.stop(STINGER_FADE_S);
    this.#current = this.#engine.play(cue);
  }
}
