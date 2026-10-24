// Spawns that keep to some phases of the day, in the running game (mw-ju8.14): when the game clock
// writes a new `time.phase`, the loaded scene's presence-gated creatures and counters arrive or leave
// (src/sim/creatures/presence.ts). The render side needs nothing: a new creature is bound by the
// next `bindCreatures` and a removed one is disposed by RenderSync like any destroyed entity.

import {
  factChanged,
  PHASE_FACT,
  syncPresence,
  type CreatureSpawnOptions,
  type SceneSpawnPlacement,
  type World,
} from '@sim/index';

/**
 * Keeps the scene's presence-gated creatures in step with the clock's phase. Returns the
 * unsubscribe. `onError` hears a spawn that failed.
 */
export function watchPresence(
  world: World<never>,
  options: CreatureSpawnOptions,
  spawns: readonly SceneSpawnPlacement[],
  onError: (line: string) => void = (line) => {
    console.error(line);
  },
): () => void {
  if (!spawns.some((spawn) => spawn.presence !== undefined)) return () => undefined;
  const sync = (phase: unknown): void => {
    if (typeof phase !== 'string') return;
    for (const { point, error } of syncPresence(world, options, spawns, phase).errors) {
      onError(`creature spawn "${point}": ${error.kind}`);
    }
  };
  // Now (a counter the scene loader made interactable is switched off for a phase it is not there
  // for), then at every phase change.
  sync(world.facts.get(PHASE_FACT));
  return world.events.on(factChanged, ({ key, new: value }) => {
    if (key === PHASE_FACT) sync(value);
  });
}
