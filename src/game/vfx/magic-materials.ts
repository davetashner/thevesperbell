// Corpses dissolving (mw-e29.7 AC-3): the clock behind a creature's death dissolve, with no renderer
// in sight so it is unit tested (the rules of the looks are in src/render/magic-materials/rules.ts).
// A dissolve is applied the first frame after a death, runs for its duration after the collapse
// delay, and the render entity is removed once it is over. The sim is never told: it may have
// dropped the entity long ago.

import { DEATH_DISSOLVE, dissolveProgress, type DissolveSpec } from '@render/magic-materials/rules';

interface Running {
  readonly spec: DissolveSpec;
  elapsed: number;
}

/** Dissolves running over time, each started by key and forgotten once it is over. */
export class DissolveTimeline<K> {
  readonly #running = new Map<K, Running>();

  /** Dissolves not yet over. */
  get size(): number {
    return this.#running.size;
  }

  has(key: K): boolean {
    return this.#running.has(key);
  }

  /** Starts a dissolve for `key` (no-op if it already has one). */
  begin(key: K, spec: DissolveSpec = DEATH_DISSOLVE): void {
    if (!this.#running.has(key)) this.#running.set(key, { spec, elapsed: 0 });
  }

  /** Advances every dissolve by `seconds`, calling `visit` with each one's progress. */
  update(seconds: number, visit: (key: K, progress: number, finished: boolean) => void): void {
    for (const [key, run] of [...this.#running]) {
      run.elapsed += Math.max(seconds, 0);
      const progress = dissolveProgress(run.spec, run.elapsed);
      const finished = progress >= 1;
      if (finished) this.#running.delete(key);
      visit(key, progress, finished);
    }
  }

  /** Forgets `key`'s dissolve without finishing it (its thing went away). */
  cancel(key: K): void {
    this.#running.delete(key);
  }
}

/** What a corpse's dissolve needs from the renderer. */
export interface CorpseHooks<K, H> {
  /** Makes `key`'s body dissolvable and returns the handle that sets how far it has gone. */
  readonly apply: (key: K) => H;
  /** Sets how far the body has dissolved, 0 whole … 1 gone. */
  readonly progress: (handle: H, progress: number) => void;
  /** Takes the body away: it is gone, so its render entity is removed. */
  readonly remove: (key: K, handle: H) => void;
}

/**
 * Creature deaths drawn as a dissolve (mw-e29.7 AC-3): `died` starts a corpse's clock, `update` runs
 * it. The dissolve is applied the first frame after the death (so anything else that dresses the
 * body this frame has settled), runs for its duration after the collapse delay, and the render entity
 * is removed once it is over. The sim is never told: it may have dropped the entity long ago.
 */
export class CorpseDissolves<K, H> {
  readonly #timeline = new DissolveTimeline<K>();
  readonly #handles = new Map<K, H>();
  readonly #hooks: CorpseHooks<K, H>;
  readonly #spec: DissolveSpec;

  constructor(hooks: CorpseHooks<K, H>, spec: DissolveSpec = DEATH_DISSOLVE) {
    this.#hooks = hooks;
    this.#spec = spec;
  }

  /** Bodies still dissolving or waiting to. */
  get size(): number {
    return this.#timeline.size;
  }

  /** Whether `key` died and has not yet been removed. */
  dying(key: K): boolean {
    return this.#timeline.has(key);
  }

  /** `key` died: its collapse is drawn elsewhere, this starts the dissolve that follows. */
  died(key: K): void {
    this.#timeline.begin(key, this.#spec);
  }

  /** Advances every corpse by `seconds`. */
  update(seconds: number): void {
    this.#timeline.update(seconds, (key, progress, finished) => {
      let handle = this.#handles.get(key);
      if (handle === undefined) {
        handle = this.#hooks.apply(key);
        this.#handles.set(key, handle);
      }
      this.#hooks.progress(handle, progress);
      if (!finished) return;
      this.#handles.delete(key);
      this.#hooks.remove(key, handle);
    });
  }
}
