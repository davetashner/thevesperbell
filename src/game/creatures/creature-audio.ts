// Creature idle loops (mw-e28.8): the looping `audio.idleLoop` slot of every live creature, a
// spatial cue that follows it, started on the first frame audio can run and stopped when the creature
// dies (within IDLE_STOP_S, so a corpse is not still breathing) or is gone. The rest of a creature's
// voice (barks, hurt, poise break, death, footsteps, telegraphs) is cue sheet rules (cue-sheet
// `creature`, `combat`); only a loop needs a handle to stop, so it lives here. Presentation only: it
// reads creatures and Died and never writes to the sim. A cue the sound manifest lacks (a placeholder
// id) yields no handle, and the creature is simply silent.
import type { PlayOptions, SoundHandle } from '@audio/index';
import type { CreatureDef } from '@content/index';
import { CreatureComponent, Died, type EntityId, type World } from '@sim/index';

/** Seconds the idle loop fades out over when its creature dies (the bead allows up to 200 ms). */
export const IDLE_STOP_S = 0.1;

/** The engine as the idle loops use it (the AudioEngine satisfies it). */
export interface IdleLoopEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

export interface CreatureIdleLoopsOptions {
  readonly world: World<never>;
  readonly engine: IdleLoopEngine;
  /** Creatures, for their `audio.idleLoop`. */
  readonly creatures: readonly Pick<CreatureDef, 'id' | 'audio'>[];
}

export class CreatureIdleLoops {
  readonly #world: World<never>;
  readonly #engine: IdleLoopEngine;
  readonly #loops: ReadonlyMap<string, string>;
  readonly #playing = new Map<EntityId, SoundHandle | null>();
  readonly #dead = new Set<EntityId>();
  readonly #off: () => void;

  constructor(options: CreatureIdleLoopsOptions) {
    this.#world = options.world;
    this.#engine = options.engine;
    const loops = new Map<string, string>();
    for (const { id, audio } of options.creatures) {
      if (audio?.idleLoop !== undefined) loops.set(id, audio.idleLoop);
    }
    this.#loops = loops;
    this.#off = options.world.events.on(Died, ({ target }) => {
      this.#dead.add(target);
      this.#stop(target);
    });
  }

  /** How many loops are sounding (for tests and debug overlays). */
  get count(): number {
    return [...this.#playing.values()].filter((handle) => handle !== null).length;
  }

  /** Once per frame: starts a loop on each live creature that has one, stops those that are gone. */
  update(): void {
    if (this.#loops.size === 0 || this.#engine.context?.state !== 'running') return;
    const alive = new Set<EntityId>();
    this.#world.query(CreatureComponent).forEach((entity, { origin }) => {
      alive.add(entity);
      if (this.#playing.has(entity) || this.#dead.has(entity)) return;
      const cue = this.#loops.get(origin.creature);
      if (cue !== undefined) this.#playing.set(entity, this.#engine.play(cue, { entity }));
    });
    for (const entity of [...this.#playing.keys()]) if (!alive.has(entity)) this.#stop(entity);
    for (const entity of this.#dead) if (!alive.has(entity)) this.#dead.delete(entity);
  }

  /** Stops every loop and unsubscribes (leaving the scene). */
  dispose(): void {
    this.#off();
    for (const entity of [...this.#playing.keys()]) this.#stop(entity);
    this.#dead.clear();
  }

  #stop(entity: EntityId): void {
    this.#playing.get(entity)?.stop(IDLE_STOP_S);
    this.#playing.delete(entity);
  }
}
