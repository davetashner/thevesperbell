// Presence by phase of the day (mw-ju8.14): a scene spawn may say which clock phases it is there for
// (`presence.phases`, the ids of `time.phase`: dawn, day, dusk, night). Its creature is not spawned
// when the scene loads in another phase, and its `interact` (a counter to talk to) is switched off;
// `syncPresence` brings both in or takes both out when the clock crosses a boundary while the player is
// there. Stateless: it finds the creature by the spawn point it came from (`origin.point`) and the
// counter by its scene spawn component, so a creature a save restored is treated like a fresh one.

import type { World } from '../core/world';
import { addInteractable, InteractableComponent } from '../interaction/system';
import { SceneSpawnComponent } from '../scene/loader';
import type { SceneSpawnPlacement } from '../scene/layout';
import { CreatureComponent } from './components';
import {
  creaturesInstalled,
  despawnCreature,
  originOfSpawn,
  presentIn,
  spawnCreature,
  type CreatureSpawnOptions,
  type SpawnError,
} from './spawn';

/** What `syncPresence` changed, as spawn point ids, and any spawn that failed. */
export interface PresenceChange {
  /** Spawns whose creature or interaction came back. */
  readonly arrived: readonly string[];
  /** Spawns whose creature or interaction went away. */
  readonly left: readonly string[];
  readonly errors: readonly { readonly point: string; readonly error: SpawnError }[];
}

/**
 * Makes every presence-gated spawn of `spawns` match `phase`: spawns the creatures that should be
 * there and are not, removes those that should not be, and switches the spawn's interaction on or
 * off. Spawns without a `presence` are left alone.
 */
export function syncPresence(
  world: World<never>,
  options: CreatureSpawnOptions,
  spawns: readonly SceneSpawnPlacement[],
  phase: string,
): PresenceChange {
  const arrived = new Set<string>();
  const left = new Set<string>();
  const errors: { point: string; error: SpawnError }[] = [];
  for (const spawn of spawns) {
    if (spawn.presence === undefined) continue;
    const present = presentIn(spawn, phase);
    if (spawn.creature !== undefined && creaturesInstalled(world)) {
      const here = [...world.query(CreatureComponent).ids()].filter(
        (entity) => world.get(entity, CreatureComponent)?.origin.point === spawn.id,
      );
      if (present && here.length === 0) {
        const result = spawnCreature(world, options, originOfSpawn(spawn, spawn.creature));
        if (result.ok) arrived.add(spawn.id);
        else errors.push({ point: spawn.id, error: result.error });
      } else if (!present && here.length > 0) {
        for (const entity of here) despawnCreature(world, entity);
        left.add(spawn.id);
      }
    }
    if (spawn.interact !== undefined && world.isRegistered(InteractableComponent)) {
      world.query(SceneSpawnComponent).forEach((entity, point) => {
        if (point.id !== spawn.id || spawn.interact === undefined) return;
        const has = world.has(entity, InteractableComponent);
        if (present && !has) {
          addInteractable(world, entity, spawn.interact, spawn.position);
          arrived.add(spawn.id);
        } else if (!present && has) {
          world.remove(entity, InteractableComponent);
          left.add(spawn.id);
        }
      });
    }
  }
  return { arrived: [...arrived], left: [...left], errors };
}
