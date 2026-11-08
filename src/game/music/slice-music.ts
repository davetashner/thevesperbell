// The slice's music (mw-0j5): a deliberately small stand-in for the adaptive music controller
// (mw-e28.11). The explore bed plays once (the mine gallery's ambience bed is the slice-gallery
// ambience zone now, mw-e28.13), and the combat loop crossfades in when any creature enters the combat alert state and
// out again once none has been in combat for a while (audio bible §2.1: entering combat is
// immediate, leaving waits 4 s so a brief break in the fight doesn't flip the score). Presentation
// only: it reads sim events and never writes to the sim. Nothing is requested before the audio
// context is running (the autoplay policy), so the beds start on the first gesture.
import type { BusId, PlayOptions, SoundHandle } from '@audio/index';
import { AlertStateChanged, Died, type EntityId, type World } from '@sim/index';

/** Cue ids in the sound manifest. */
export const SLICE_MUSIC_CUES = {
  explore: 'music-slice-explore',
  combat: 'music-slice-combat',
} as const;

/** How long no creature may be in combat before the combat loop fades out (audio bible §2.1). */
export const COMBAT_EXIT_DELAY_MS = 4000;
/** Crossfade lengths, in seconds. */
export const COMBAT_FADE_IN_S = 1.5;
export const COMBAT_FADE_OUT_S = 2.5;
export const EXPLORE_DUCK_S = 1.5;
export const EXPLORE_RESTORE_S = 3;

/** The engine as the music uses it (the AudioEngine satisfies it). */
export interface MusicEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
  setBusGain(bus: BusId, gain: number, rampSeconds?: number): void;
}

export interface SliceMusicOptions {
  readonly world: World<never>;
  readonly engine: MusicEngine;
  /** Presentation clock in ms. */
  readonly now: () => number;
}

/** What the music is doing, for the e2e probe and debug overlays. */
export interface SliceMusicState {
  readonly started: boolean;
  readonly inCombat: boolean;
}

export class SliceMusic {
  readonly #engine: MusicEngine;
  readonly #now: () => number;
  readonly #fighting = new Set<EntityId>();
  readonly #offEvents: readonly (() => void)[];
  #started = false;
  #inCombat = false;
  #quietSince: number | undefined;
  #explore: SoundHandle | null = null;
  #combat: SoundHandle | null = null;

  constructor(options: SliceMusicOptions) {
    this.#engine = options.engine;
    this.#now = options.now;
    this.#offEvents = [
      options.world.events.on(AlertStateChanged, ({ entity, from, to }) => {
        if (to === 'combat') this.#fighting.add(entity);
        else if (from === 'combat') this.#fighting.delete(entity);
      }),
      options.world.events.on(Died, ({ target }) => {
        this.#fighting.delete(target);
      }),
    ];
  }

  get state(): SliceMusicState {
    return { started: this.#started, inCombat: this.#inCombat };
  }

  /** Once per frame: starts the beds when audio can run, and moves between explore and combat. */
  update(): void {
    if (!this.#started) {
      if (this.#engine.context?.state !== 'running') return;
      this.#started = true;
      this.#explore = this.#engine.play(SLICE_MUSIC_CUES.explore);
    }
    if (this.#fighting.size > 0) {
      this.#quietSince = undefined;
      if (!this.#inCombat) this.#enterCombat();
    } else if (this.#inCombat) {
      this.#quietSince ??= this.#now();
      if (this.#now() - this.#quietSince >= COMBAT_EXIT_DELAY_MS) this.#leaveCombat();
    }
  }

  /** Stops everything and unsubscribes (leaving the scene). */
  dispose(): void {
    for (const off of this.#offEvents) off();
    for (const handle of [this.#explore, this.#combat]) handle?.stop(1);
    this.#explore = this.#combat = null;
    this.#fighting.clear();
    this.#started = this.#inCombat = false;
  }

  #enterCombat(): void {
    this.#inCombat = true;
    this.#explore?.fade(0, EXPLORE_DUCK_S);
    this.#combat?.stop(0);
    this.#combat = this.#engine.play(SLICE_MUSIC_CUES.combat, { volume: 0 });
    this.#combat?.fade(1, COMBAT_FADE_IN_S);
  }

  #leaveCombat(): void {
    this.#inCombat = false;
    this.#quietSince = undefined;
    this.#combat?.stop(COMBAT_FADE_OUT_S);
    this.#combat = null;
    this.#explore?.fade(1, EXPLORE_RESTORE_S);
  }
}
