// Scene music beds (mw-ju8.11): a looping, non-spatial track that plays for the whole scene.
// Marsh's General Store plays its shop theme on both floors (one bed for the interior). Presentation
// only. Nothing is requested before the audio context is running (the autoplay policy).
import type { PlayOptions, SoundHandle } from '@audio/index';

/** A scene's music bed. */
export interface SceneBed {
  readonly scene: string;
  /** Looping cue in the sound manifest. */
  readonly cue: string;
}

/** The scenes that have a bed. */
export const SCENE_BEDS: readonly SceneBed[] = [{ scene: 'marsh-store', cue: 'music-marsh-store' }];

/** Seconds the bed fades out over when the scene ends. */
export const BED_FADE_OUT_S = 2;

/** The engine as the beds use it (the AudioEngine satisfies it). */
export interface BedEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

export interface SceneBedsOptions {
  readonly engine: BedEngine;
  /** The scene being played. */
  readonly scene: string;
  /** Defaults to the game's beds. */
  readonly beds?: readonly SceneBed[];
}

export class SceneBeds {
  readonly #engine: BedEngine;
  readonly #bed: SceneBed | undefined;
  #started = false;
  #handle: SoundHandle | null = null;

  constructor(options: SceneBedsOptions) {
    this.#engine = options.engine;
    this.#bed = (options.beds ?? SCENE_BEDS).find((bed) => bed.scene === options.scene);
  }

  /** Whether the bed has started (for tests and debug overlays). */
  get started(): boolean {
    return this.#started;
  }

  /** Once per frame: starts the bed the first time audio can run. */
  update(): void {
    if (this.#bed === undefined || this.#started || this.#engine.context?.state !== 'running') {
      return;
    }
    this.#started = true;
    this.#handle = this.#engine.play(this.#bed.cue);
  }

  /** Fades the bed out (leaving the scene). */
  dispose(): void {
    this.#handle?.stop(BED_FADE_OUT_S);
    this.#handle = null;
    this.#started = false;
  }
}
