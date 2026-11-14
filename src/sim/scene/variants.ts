// Fact-gated spawns and variant groups (mw-e27.8): a scene spawn may exist only while a world
// condition holds (`spawnIf`), vanish while another does (`despawnIf`), or be one variant of a group
// of which exactly one is active (`variant: { group, when? }`: the first listed in the scene whose
// `when` holds, a variant without `when` being the fallback that always matches). The world then
// reacts to what the player did, without scripting: help the miller and he is back in his mill.
//
// - `presentSpawnIds` is the pure rule: from the facts, which spawns exist. The scene loader uses it
//   to leave the others out when a scene loads (every system that reads `layout.spawns` then simply
//   never sees them).
// - `SpawnVariants` keeps a loaded scene in step: it watches the facts the gates read and reports each
//   spawn that should now exist or not (`apply`). A change waits while the spawn is on the player's
//   screen (`inView`) unless the spawn says `swapInView`, so nothing pops in or out in front of the
//   player; `step` (once per frame, between sim steps) applies what became out of view.
// Everything is a function of the facts and the spawn order: no clock, no randomness. `inView` is the
// only outside input, and it only decides when, never what.

import type { Vec3 } from '../stimulus/shapes';
import { compileCondition, type CompiledCondition, type FactReader } from '../facts/conditions';
import { factChanged } from '../facts/store';
import type { EventHandler, EventType } from '../core/events';
import type { SceneSpawnPlacement } from './layout';

/** The compiled conditions of one gated spawn. */
interface Gate {
  readonly spawn: SceneSpawnPlacement;
  readonly spawnIf: CompiledCondition | undefined;
  readonly despawnIf: CompiledCondition | undefined;
  readonly group: string | undefined;
  readonly when: CompiledCondition | undefined;
}

const compiled = (c: Parameters<typeof compileCondition>[0] | undefined) =>
  c === undefined ? undefined : compileCondition(c);

/** The gates of the spawns that have one, in scene order. */
function gatesOf(spawns: readonly SceneSpawnPlacement[]): Gate[] {
  const gates: Gate[] = [];
  for (const spawn of spawns) {
    const { gate } = spawn;
    if (gate === undefined) continue;
    gates.push({
      spawn,
      spawnIf: compiled(gate.spawnIf),
      despawnIf: compiled(gate.despawnIf),
      group: gate.variant?.group,
      when: compiled(gate.variant?.when),
    });
  }
  return gates;
}

/** The ids of the gated spawns that exist for `facts`. Ungated spawns always exist. */
function presentGates(gates: readonly Gate[], facts: FactReader): Set<string> {
  // Each group's chosen variant: the first member whose `when` holds (no `when` always holds).
  const chosen = new Map<string, string>();
  for (const { spawn, group, when } of gates) {
    if (group === undefined || chosen.has(group)) continue;
    if (when === undefined || when.evaluate(facts)) chosen.set(group, spawn.id);
  }
  const present = new Set<string>();
  for (const { spawn, spawnIf, despawnIf, group } of gates) {
    if (group !== undefined && chosen.get(group) !== spawn.id) continue;
    if (spawnIf !== undefined && !spawnIf.evaluate(facts)) continue;
    if (despawnIf?.evaluate(facts) === true) continue;
    present.add(spawn.id);
  }
  return present;
}

/** The ids of the spawns of `spawns` that exist for `facts`, in scene order. */
export function presentSpawnIds(
  spawns: readonly SceneSpawnPlacement[],
  facts: FactReader,
): string[] {
  const gated = presentGates(gatesOf(spawns), facts);
  return spawns.filter(({ id, gate }) => gate === undefined || gated.has(id)).map(({ id }) => id);
}

/** What a `SpawnVariants` needs from a world. */
export interface SpawnVariantsHost {
  readonly facts: FactReader;
  readonly events: { on<T>(type: EventType<T>, handler: EventHandler<T>): () => void };
}

export interface SpawnVariantsOptions {
  /** Whether a point is on the player's screen now; absent = never (headless, tools). */
  readonly inView?: (position: Vec3) => boolean;
  /** Makes spawn `spawn` exist (`present`) or not; it is only ever called with a change. */
  readonly apply: (spawn: SceneSpawnPlacement, present: boolean) => void;
}

/** Keeps a loaded scene's gated spawns in step with the facts (see the file header). */
export class SpawnVariants {
  readonly #gates: readonly Gate[];
  readonly #present: Set<string>;
  readonly #options: SpawnVariantsOptions;
  readonly #off: () => void;
  readonly #facts: FactReader;
  #dirty = false;
  #waiting = false;

  /**
   * @param spawns every spawn of the scene, those that were left out at load included.
   * @param initial the ids of the gated spawns that exist now (what the load produced).
   */
  constructor(
    host: SpawnVariantsHost,
    spawns: readonly SceneSpawnPlacement[],
    initial: Iterable<string>,
    options: SpawnVariantsOptions,
  ) {
    this.#gates = gatesOf(spawns);
    this.#present = new Set(initial);
    this.#options = options;
    this.#facts = host.facts;
    this.#off = host.events.on(factChanged, ({ key }) => {
      if (this.#dirty) return;
      this.#dirty = this.#gates.some((g) =>
        [g.spawnIf, g.despawnIf, g.when].some((c) => c?.dependsOn(key) === true),
      );
    });
  }

  /** Whether gated spawn `id` exists now. */
  isPresent(id: string): boolean {
    return this.#present.has(id);
  }

  /** The ids of the gated spawns whose change has not been applied yet (it waits for them to leave the screen). */
  pending(): string[] {
    const want = presentGates(this.#gates, this.#facts);
    return this.#gates
      .filter(({ spawn }) => want.has(spawn.id) !== this.#present.has(spawn.id))
      .map(({ spawn }) => spawn.id);
  }

  /**
   * Applies every change the facts call for, except those of spawns on screen (they wait for a later
   * step). Call between sim steps; cheap when no fact the gates read changed and nothing waits.
   * Returns the ids it applied, in scene order.
   */
  step(): string[] {
    if (!this.#dirty && !this.#waiting) return [];
    this.#dirty = false;
    const want = presentGates(this.#gates, this.#facts);
    const applied: string[] = [];
    this.#waiting = false;
    for (const { spawn } of this.#gates) {
      const present = want.has(spawn.id);
      if (present === this.#present.has(spawn.id)) continue;
      if (spawn.gate?.swapInView !== true && this.#options.inView?.(spawn.position) === true) {
        this.#waiting = true;
        continue;
      }
      if (present) this.#present.add(spawn.id);
      else this.#present.delete(spawn.id);
      this.#options.apply(spawn, present);
      applied.push(spawn.id);
    }
    return applied;
  }

  /** Stops watching the facts. */
  dispose(): void {
    this.#off();
  }
}
