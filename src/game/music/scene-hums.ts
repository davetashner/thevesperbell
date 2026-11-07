// Diegetic hums (mw-ju8.40): a looping spatial cue that follows a placed creature, so the sound comes
// from where she stands and fades with distance (the engine's inverse-distance panner, audio bible
// §7.8). Ottilie hums at her counter in Marsh's General Store. Presentation only: it reads which
// creature came from which scene spawn point and never writes to the sim. Nothing is requested before
// the audio context is running (the autoplay policy), and a creature that is absent (it keeps to some
// hours of the day) is simply silent until it appears.
import type { PlayOptions, SoundHandle } from '@audio/index';
import { CreatureComponent, type EntityId, type World } from '@sim/index';

/** One creature that hums where it stands. */
export interface SceneHum {
  /** Scene the hum belongs to. */
  readonly scene: string;
  /** Scene spawn point of the creature (`CreatureOrigin.point`). */
  readonly point: string;
  /** Cue id in the sound manifest (spatial, looping). */
  readonly cue: string;
}

/** The hums the game has. */
export const SCENE_HUMS: readonly SceneHum[] = [
  { scene: 'marsh-store', point: 'npc-ottilie', cue: 'hum-ottilie' },
];

/** Seconds the hum fades out over when its creature leaves or the scene ends. */
export const HUM_FADE_OUT_S = 1;

/** The engine as the hums use it (the AudioEngine satisfies it). */
export interface HumEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

export interface SceneHumsOptions {
  readonly world: World<never>;
  readonly engine: HumEngine;
  /** The scene being played. */
  readonly scene: string;
  /** Defaults to the game's hums. */
  readonly hums?: readonly SceneHum[];
}

interface Playing {
  readonly entity: EntityId;
  readonly handle: SoundHandle | null;
}

export class SceneHums {
  readonly #world: World<never>;
  readonly #engine: HumEngine;
  readonly #hums: readonly SceneHum[];
  readonly #playing = new Map<SceneHum, Playing>();

  constructor(options: SceneHumsOptions) {
    this.#world = options.world;
    this.#engine = options.engine;
    this.#hums = (options.hums ?? SCENE_HUMS).filter((hum) => hum.scene === options.scene);
  }

  /** How many hums are sounding (for tests and debug overlays). */
  get count(): number {
    return [...this.#playing.values()].filter((p) => p.handle !== null).length;
  }

  /** Once per frame: starts a hum on its creature when audio can run, and moves it if it respawned. */
  update(): void {
    if (this.#hums.length === 0 || this.#engine.context?.state !== 'running') return;
    const found = this.#creatures();
    for (const hum of this.#hums) {
      const entity = found.get(hum.point);
      const current = this.#playing.get(hum);
      if (current?.entity === entity) continue;
      current?.handle?.stop(HUM_FADE_OUT_S);
      if (entity === undefined) this.#playing.delete(hum);
      else this.#playing.set(hum, { entity, handle: this.#engine.play(hum.cue, { entity }) });
    }
  }

  /** Stops every hum (leaving the scene). */
  dispose(): void {
    for (const { handle } of this.#playing.values()) handle?.stop(HUM_FADE_OUT_S);
    this.#playing.clear();
  }

  /** Spawn point → entity of every live scene creature. */
  #creatures(): Map<string, EntityId> {
    const found = new Map<string, EntityId>();
    for (const entity of this.#world.query(CreatureComponent).ids()) {
      const point = this.#world.get(entity, CreatureComponent)?.origin.point;
      if (point !== undefined) found.set(point, entity);
    }
    return found;
  }
}
