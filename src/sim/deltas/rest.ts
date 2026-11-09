// Rest resets (mw-e27.7): when the player finishes resting (`rest.completed`), what persistence
// policies say resets on rest goes back: `reset-on-rest` facts to their defaults and `reset-after`
// facts whose time is up, `rest-reset` entity state of every visited level (deltas of levels that
// are not loaded, live state of the loaded one). Permanent state (a looted chest, a dead boss, an
// opened door) is untouched however often the player rests. Resting itself, and the rest points,
// are src/sim/rest (mw-ju8.6) and mw-e27.13.

import type { World } from '../core/world';
import { restCompleted } from '../rest/rest';
import { levelDeltasOf } from './store';

/** What one rest reset. */
export interface RestResets {
  /** Facts put back to their defaults, in key order. */
  readonly facts: readonly string[];
  /** Levels (not loaded) whose stored deltas lost `rest-reset` state. */
  readonly levels: readonly string[];
  /** Aspects of the loaded level's entities put back to the baseline. */
  readonly live: number;
}

/** Applies the rest policies of `world` now (between steps). */
export function applyRestPolicies(world: World<never>): RestResets {
  const facts = world.facts.applyResets('rest');
  const { stored, live } = levelDeltasOf(world).rest(world);
  return { facts, levels: stored, live };
}

/** Applies them on every `rest.completed`. Returns an uninstaller. */
export function installRestPolicies(
  world: World<never>,
  onReset?: (resets: RestResets) => void,
): () => void {
  return world.events.on(restCompleted, () => {
    onReset?.(applyRestPolicies(world));
  });
}
