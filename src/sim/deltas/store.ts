// The world's level deltas (mw-e27.4): what persists of every level the player has visited, kept
// between visits and carried by saves. One level at a time is loaded ("current"): its deltas are
// live, computed from its baseline whenever they are captured. Every other visited level's deltas
// are stored as plain data and applied only when that level is entered again (lazily: a save never
// touches a level the player is not in).
//
// - `enter` takes the baseline of a freshly spawned level and applies its stored deltas, if any,
//   before its first tick. A level with no (or damaged, dropped on load) deltas stays as authored.
// - `leave` captures the current level into the store (on level unload).
// - `capture` is every level's deltas for a save: the stored ones plus the current level's, now.
// - `restore` replaces the stored deltas with a save's. The current level is left alone: the save's
//   world section restores its entities exactly, so its saved deltas are not applied a second time.
//
// The store is held per world (`levelDeltasOf`), outside the snapshot, so save sections and tools
// reach it through the world they are given.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { encodeCanonical, xxHash32 } from '../snapshot';
import type {
  DeltaApplyReport,
  LevelBaseline,
  LevelDeltas,
  SettleReport,
  WorldPersistence,
} from './persistence';

/** A level just entered: its baseline (for later captures) and what applying its deltas did. */
export interface EnteredLevel {
  readonly baseline: LevelBaseline;
  /** Undefined when the store held no deltas for the level. */
  readonly report: DeltaApplyReport | undefined;
}

interface CurrentLevel {
  readonly persistence: WorldPersistence;
  readonly baseline: LevelBaseline;
}

/** Code-unit order (level ids are unique), without locale rules. */
const byLevel = (a: LevelDeltas, b: LevelDeltas): number =>
  Number(a.level > b.level) - Number(a.level < b.level);

/** A stable content hash of level deltas (8 hex digits), for round-trip and determinism checks. */
export function hashLevelDeltas(levels: readonly LevelDeltas[]): string {
  return xxHash32(encodeCanonical([...levels].sort(byLevel)))
    .toString(16)
    .padStart(8, '0');
}

/** Every visited level's deltas, one of them live (see the file header). */
export class LevelDeltaStore {
  readonly #stored = new Map<string, LevelDeltas>();
  #current: CurrentLevel | undefined;
  /** The persistence of the level entered last: the one that reads the stored levels' deltas. */
  #lastPersistence: WorldPersistence | undefined;

  /** The id of the loaded level, if any. */
  get current(): string | undefined {
    return this.#current?.baseline.level;
  }

  /** Ids of the levels with stored deltas, in code-unit order. */
  levels(): string[] {
    return [...this.#stored.values()].sort(byLevel).map(({ level }) => level);
  }

  /** The stored deltas of `level` (undefined for the current level or one never left). */
  deltas(level: string): LevelDeltas | undefined {
    return this.#stored.get(level);
  }

  /**
   * Makes `level` current: takes its baseline from the freshly spawned `authored` entities (see
   * WorldPersistence.baseline), then applies its stored deltas. Call between steps, before the
   * level's first tick.
   * @throws Error when a level is already current (leave it first).
   */
  enter(
    world: World<never>,
    persistence: WorldPersistence,
    level: string,
    authored: Iterable<readonly [string, EntityId]>,
  ): EnteredLevel {
    if (this.#current !== undefined) {
      throw new Error(
        `level "${level}" entered while "${this.#current.baseline.level}" is still loaded`,
      );
    }
    const baseline = persistence.baseline(world, level, authored);
    this.#current = { persistence, baseline };
    this.#lastPersistence = persistence;
    const stored = this.#stored.get(level);
    this.#stored.delete(level);
    return { baseline, report: stored && persistence.apply(world, baseline, stored) };
  }

  /**
   * Captures the current level into the store and unloads it from the store's view (call before the
   * level's entities are removed).
   * @throws Error when no level is current.
   */
  leave(world: World<never>): LevelDeltas {
    const deltas = this.#captureCurrent(world);
    this.#stored.set(deltas.level, deltas);
    this.#current = undefined;
    return deltas;
  }

  /** Every visited level's deltas now, in level order (call between steps). */
  capture(world: World<never>): LevelDeltas[] {
    const levels = [...this.#stored.values()];
    if (this.#current !== undefined) levels.push(this.#captureCurrent(world));
    return levels.sort(byLevel);
  }

  /**
   * Replaces the stored deltas of a level that is not loaded (repopulation drops the entries of
   * creatures that returned before the level is entered, mw-ju8.29).
   * @throws Error when `deltas.level` is the loaded level (its entities are live).
   */
  replace(deltas: LevelDeltas): void {
    if (deltas.level === this.current) throw new Error(`level "${deltas.level}" is loaded`);
    this.#stored.set(deltas.level, deltas);
  }

  /**
   * Settles the loaded level after its entities were restored from a save: transient properties
   * start over and fires burn out (WorldPersistence.settle). Nothing when no level is loaded.
   */
  settle(world: World<never>): SettleReport | undefined {
    if (this.#current === undefined) return undefined;
    return this.#current.persistence.settle(world, this.#current.baseline);
  }

  /**
   * The player rests (persistence policies, mw-e27.7): `rest-reset` state of every level that is not
   * loaded is dropped from its stored deltas, and the loaded level's goes back to its baseline.
   * Returns the levels whose stored deltas changed and the aspects reset live.
   */
  rest(world: World<never>): { readonly stored: readonly string[]; readonly live: number } {
    const stored: string[] = [];
    const persistence = this.#current?.persistence ?? this.#lastPersistence;
    if (persistence !== undefined) {
      for (const deltas of [...this.#stored.values()].sort(byLevel)) {
        const reset = persistence.resetOnRest(deltas);
        if (reset === deltas) continue;
        this.#stored.set(deltas.level, reset);
        stored.push(deltas.level);
      }
    }
    const live = this.#current?.persistence.restLive(world, this.#current.baseline) ?? 0;
    return { stored, live };
  }

  /** Replaces the stored deltas with `levels`, except the current level's (file header). */
  restore(levels: readonly LevelDeltas[]): void {
    this.#stored.clear();
    for (const deltas of levels) {
      if (deltas.level !== this.current) this.#stored.set(deltas.level, deltas);
    }
  }

  #captureCurrent(world: World<never>): LevelDeltas {
    if (this.#current === undefined) throw new Error('no level is loaded');
    const { persistence, baseline } = this.#current;
    return persistence.capture(world, baseline);
  }
}

const stores = new WeakMap<object, LevelDeltaStore>();

/** The level deltas of `world`, created empty on first use. */
export function levelDeltasOf(world: World<never>): LevelDeltaStore {
  let store = stores.get(world);
  if (store === undefined) {
    store = new LevelDeltaStore();
    stores.set(world, store);
  }
  return store;
}
