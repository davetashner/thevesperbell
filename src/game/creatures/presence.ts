// Spawns that keep to some phases of the day, in the running game (mw-ju8.14): when the game clock
// writes a new `time.phase`, the loaded scene's presence-gated creatures and counters arrive or leave
// (src/sim/creatures/presence.ts); with `presence.hours` they follow the clock's minute too (mw-e24.13). The render side needs nothing: a new creature is bound by the
// next `bindCreatures` and a removed one is disposed by RenderSync like any destroyed entity.

import {
  factChanged,
  hourNow,
  MINUTE_FACT,
  MINUTES_PER_DAY,
  PHASE_FACT,
  syncPresence,
  type CreatureSpawnOptions,
  type PresenceHold,
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
  hold: PresenceHold = {},
): () => void {
  if (!spawns.some((spawn) => spawn.presence !== undefined)) return () => undefined;
  // A jump of the clock (`time set`, rest, wait: any minute that is not the last one plus one) is not
  // the world going by: it re-syncs at once, whatever the player is looking at, since nobody "pops in"
  // when the whole day moved. Ordinary ticking keeps to `hold`.
  let lastMinute = Number(world.facts.get(MINUTE_FACT));
  let jumped = false;
  // A creature made during a step is not seen by a query until the step ends, so a phase change and a
  // minute change in one tick (the usual case) would each make it: a spawn that arrived this tick is
  // left alone until the next.
  const arrivedAt = new Map<string, number>();
  const sync = (phase: unknown, hour: number | undefined): void => {
    if (typeof phase !== 'string') return;
    const held = jumped ? {} : hold;
    const tick = world.tick;
    const settled = spawns.filter((spawn) => arrivedAt.get(spawn.id) !== tick);
    const change = syncPresence(world, options, settled, phase, hour, held);
    for (const id of change.arrived) arrivedAt.set(id, tick);
    for (const { point, error } of change.errors)
      onError(`creature spawn "${point}": ${error.kind}`);
  };
  // Now (a counter the scene loader made interactable is switched off for a phase or hour it is not
  // there for), then at every phase change and every game minute (a schedule window, mw-e24.13; one
  // held back by a conversation or the player's view tries again a minute on).
  sync(world.facts.get(PHASE_FACT), hourNow(world));
  return world.events.on(factChanged, ({ key, new: value }) => {
    if (key === PHASE_FACT) sync(value, hourNow(world));
    else if (key === MINUTE_FACT) {
      const minute = Number(value);
      jumped = minute !== (lastMinute + 1) % MINUTES_PER_DAY;
      lastMinute = minute;
      sync(world.facts.get(PHASE_FACT), minute / 60);
    }
  });
}
