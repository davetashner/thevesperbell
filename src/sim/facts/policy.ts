// Fact persistence policies on load (mw-e27.7): what a save's facts become when a game loads them.
// Saving drops the `transient` facts (FactStore.persistentSnapshot); loading settles the rest:
// - `transient` facts a save holds anyway (an older build wrote them) are dropped: default.
// - `reset-after` facts whose time ran out while the game was not loaded are dropped: default. Their
//   written-at stamp rides in the save as the fact it is, so it counts real sim ticks.
// - `decays-to` facts holding a value in `from` load as `to`.
// `reset-on-rest` facts load as saved: no rest has happened yet.
// Pure data in, data out: equal saves settle equally.

import type { FactSnapshot, FactStore, FactValue } from './store';
import { factWrittenKey } from './store';

/** What `settleSavedFacts` changed. */
export interface SettledFacts {
  /** The facts to restore, in the order given. */
  readonly facts: FactSnapshot;
  /** Transient facts the save held, dropped. */
  readonly transient: readonly string[];
  /** `reset-after` facts whose time was up, dropped. */
  readonly expired: readonly string[];
  /** `decays-to` facts that decayed, with the value they were saved with. */
  readonly decayed: readonly {
    readonly key: string;
    readonly from: FactValue;
    readonly to: FactValue;
  }[];
}

/** Applies the load policies of `store`'s declarations to saved facts; `tick` is the world's sim tick on load. */
export function settleSavedFacts(
  store: FactStore,
  saved: FactSnapshot,
  tick: number,
): SettledFacts {
  const facts: Record<string, FactValue> = {};
  const transient: string[] = [];
  const expired: string[] = [];
  const decayed: { key: string; from: FactValue; to: FactValue }[] = [];
  const spent = new Set<string>();
  for (const key of Object.keys(saved)) {
    const spec = store.spec(key);
    if (spec?.persistence === 'reset-after') {
      const stamp = saved[factWrittenKey(key)];
      if (typeof stamp === 'number' && tick - stamp >= Number(spec.resetAfter)) {
        expired.push(key);
        spent.add(factWrittenKey(key));
      }
    }
  }
  for (const [key, value] of Object.entries(saved)) {
    if (spent.has(key)) continue;
    const spec = store.spec(key);
    if (spec?.persistence === 'transient') transient.push(key);
    else if (expired.includes(key)) continue;
    else if (spec?.persistence === 'decays-to' && spec.decaysTo?.from.includes(value) === true) {
      decayed.push({ key, from: value, to: spec.decaysTo.to });
      facts[key] = spec.decaysTo.to;
    } else facts[key] = value;
  }
  return { facts, transient, expired, decayed };
}
