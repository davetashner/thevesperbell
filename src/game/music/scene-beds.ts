// Floor-aware music beds (mw-ju8.11): Marsh's General Store plays its shop theme on the ground floor
// and the quieter upstairs variant (Ottilie's home) on the upper floor, crossfading when the player
// changes floor. The scene has no room or zone data for its floors, so the floor is the player's
// height: the home floor is 3 m up, the stair climbs 0 to 3 m, and the switch has hysteresis so
// standing on the stair never flips the music back and forth. Presentation only: it reads the
// player's placement and never writes to the sim. Nothing is requested before the audio context is
// running (the autoplay policy).
import type { PlayOptions, SoundHandle } from '@audio/index';
import { PlacementComponent, type EntityId, type World } from '@sim/index';

/** A scene whose music bed depends on the floor the player is on. */
export interface SceneBed {
  readonly scene: string;
  /** Looping cue for the ground floor. */
  readonly ground: string;
  /** Looping cue for the upper floor. */
  readonly upper: string;
  /** The player's feet at or above this height (metres) are upstairs. */
  readonly upperFromY: number;
  /** ... and below this height they are downstairs again (lower than `upperFromY`: hysteresis). */
  readonly groundBelowY: number;
}

/** The scenes that have floor beds. */
export const SCENE_BEDS: readonly SceneBed[] = [
  {
    scene: 'marsh-store',
    ground: 'music-marsh-store',
    upper: 'music-marsh-home',
    upperFromY: 2.5,
    groundBelowY: 2,
  },
];

/** Seconds the old floor's bed fades out and the new one fades in over. */
export const BED_CROSSFADE_S = 2;

export type BedFloor = 'ground' | 'upper';

/** The engine as the beds use it (the AudioEngine satisfies it). */
export interface BedEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

export interface SceneBedsOptions {
  readonly world: World<never>;
  readonly engine: BedEngine;
  /** The scene being played. */
  readonly scene: string;
  /** The player's entity, once there is one. */
  readonly player: () => EntityId | undefined;
  /** Defaults to the game's beds. */
  readonly beds?: readonly SceneBed[];
}

export class SceneBeds {
  readonly #world: World<never>;
  readonly #engine: BedEngine;
  readonly #player: () => EntityId | undefined;
  readonly #bed: SceneBed | undefined;
  #floor: BedFloor | undefined;
  #handle: SoundHandle | null = null;

  constructor(options: SceneBedsOptions) {
    this.#world = options.world;
    this.#engine = options.engine;
    this.#player = options.player;
    this.#bed = (options.beds ?? SCENE_BEDS).find((bed) => bed.scene === options.scene);
  }

  /** The floor the bed is playing for, once it has started (for tests and debug overlays). */
  get floor(): BedFloor | undefined {
    return this.#floor;
  }

  /** Once per frame: starts the bed when audio can run, and crossfades when the player changes floor. */
  update(): void {
    const bed = this.#bed;
    if (bed === undefined || this.#engine.context?.state !== 'running') return;
    const entity = this.#player();
    const y = entity === undefined ? undefined : this.#world.get(entity, PlacementComponent)?.y;
    if (y === undefined) return;
    if (this.#floor === undefined) {
      this.#start(bed, y >= bed.upperFromY ? 'upper' : 'ground');
    } else if (this.#floor === 'ground' && y >= bed.upperFromY) {
      this.#crossfade(bed, 'upper');
    } else if (this.#floor === 'upper' && y < bed.groundBelowY) {
      this.#crossfade(bed, 'ground');
    }
  }

  /** Stops the bed (leaving the scene). */
  dispose(): void {
    this.#handle?.stop(BED_CROSSFADE_S);
    this.#handle = null;
    this.#floor = undefined;
  }

  #start(bed: SceneBed, floor: BedFloor): void {
    this.#floor = floor;
    this.#handle = this.#engine.play(floor === 'upper' ? bed.upper : bed.ground);
  }

  #crossfade(bed: SceneBed, floor: BedFloor): void {
    this.#floor = floor;
    this.#handle?.stop(BED_CROSSFADE_S);
    this.#handle = this.#engine.play(floor === 'upper' ? bed.upper : bed.ground, { volume: 0 });
    this.#handle?.fade(1, BED_CROSSFADE_S);
  }
}
