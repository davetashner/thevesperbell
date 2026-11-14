// Presence by phase of the day (mw-ju8.14): a scene spawn may say which clock phases it is there for
// (`presence.phases`, the ids of `time.phase`: dawn, day, dusk, night). Its creature is not spawned
// when the scene loads in another phase, and its `interact` (a counter to talk to) is switched off;
// `syncPresence` brings both in or takes both out when the clock crosses a boundary while the player is
// there. Stateless: it finds the creature by the spawn point it came from (`origin.point`) and the
// counter by its scene spawn component, so a creature a save restored is treated like a fresh one.

import type { EntityId } from '../core/component';
import { isConversing } from '../ai/conversing';
import { endErrand, errandOf, sendOnErrand } from '../ai/errand';
import { straightDistance } from '../ai/navigation';
import { aiNavigation } from '../ai/runtime';
import type { World } from '../core/world';
import { addInteractable, InteractableComponent } from '../interaction/system';
import { SceneSpawnComponent } from '../scene/loader';
import type { SceneLayout, SceneSpawnPlacement } from '../scene/layout';
import { MINUTE_FACT } from '../rest/day-clock';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
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
  /** Spawns whose creature or interaction came back (an arrival on foot counts when it is made). */
  readonly arrived: readonly string[];
  /** Spawns whose creature or interaction went away (a person who sets off to walk out counts). */
  readonly left: readonly string[];
  readonly errors: readonly { readonly point: string; readonly error: SpawnError }[];
}

/** The hour of the day, 0 to 24, from the world clock's minute fact; undefined without a clock. */
export function hourNow(world: World<never>): number | undefined {
  const minute = world.facts.get(MINUTE_FACT);
  return typeof minute === 'number' ? minute / 60 : undefined;
}

/** What waits a change out (see `syncPresence`). */
export interface PresenceHold {
  /** Whether a point is on the player's screen: nobody pops in or out there (mw-e24.13 AC-3). */
  readonly inView?: (at: Vec3) => boolean;
  /**
   * Where people may come and go on foot (`sceneExits`). A leaver walks to the nearest one it can
   * reach and is gone there; an arrival is made at the nearest and walks to its spot. Without any
   * (or where none can be reached) people arrive and leave in place, held while their spot is in
   * view.
   */
  readonly exits?: readonly Vec3[];
}

/** Name prefix of a scene spawn that marks a place people come and go (no creature, no door). */
export const EXIT_MARKER_PREFIX = 'exit-';

/**
 * The places people come and go on foot in `layout` (mw-8551), in a fixed order: doors, authored
 * exit markers (spawns whose id starts with `exit-`), then ways into other scenes (the floor at the
 * middle of the box).
 */
export function sceneExits(layout: Pick<SceneLayout, 'spawns' | 'transitions'>): Vec3[] {
  const doors = layout.spawns.filter((s) => s.door !== undefined).map((s) => s.position);
  const markers = layout.spawns
    .filter((s) => s.door === undefined && s.id.startsWith(EXIT_MARKER_PREFIX))
    .map((s) => s.position);
  const transitions = layout.transitions.map((t) => ({
    x: (t.min.x + t.max.x) / 2,
    y: t.min.y,
    z: (t.min.z + t.max.z) / 2,
  }));
  return [...doors, ...markers, ...transitions];
}

/** The nearest of `exits` by `measure` (ties: the earlier), or undefined when none can be reached. */
function nearest(exits: readonly Vec3[], measure: (exit: Vec3) => number): Vec3 | undefined {
  let best: Vec3 | undefined;
  let bestDistance = Infinity;
  for (const exit of exits) {
    const d = measure(exit);
    if (d < bestDistance) {
      best = exit;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Makes every presence-gated spawn of `spawns` match `phase` and `hour`: spawns the creatures that
 * should be there and are not, removes those that should not be, and switches the spawn's
 * interaction on or off. Spawns without a `presence` are left alone. A creature in a conversation
 * stays until it ends, and a creature does not arrive or leave while its spot is `inView`
 * (`hold`): the next sync, a game minute on, tries again, so nobody teleports in front of the
 * player (mw-e24.13 AC-3). Interactions switch at once: a shut counter is not a creature.
 */
export function syncPresence(
  world: World<never>,
  options: CreatureSpawnOptions,
  spawns: readonly SceneSpawnPlacement[],
  phase: string,
  hour?: number,
  hold: PresenceHold = {},
): PresenceChange {
  const arrived = new Set<string>();
  const left = new Set<string>();
  const exits = hold.exits ?? [];
  const errors: { point: string; error: SpawnError }[] = [];
  for (const spawn of spawns) {
    if (spawn.presence === undefined) continue;
    const present = presentIn(spawn, phase, hour);
    if (spawn.creature !== undefined && creaturesInstalled(world)) {
      const here = [...world.query(CreatureComponent).ids()].filter(
        (entity) => world.get(entity, CreatureComponent)?.origin.point === spawn.id,
      );
      if (present && here.length === 0) {
        const door = nearest(exits, (exit) => flat(exit, spawn.position));
        // Through a door when there is one, held while that door is on screen; else in place,
        // held while the spot is.
        if (hold.inView?.(door ?? spawn.position) === true) continue;
        const origin = originOfSpawn(spawn, spawn.creature);
        const result = spawnCreature(
          world,
          options,
          door === undefined ? origin : { ...origin, from: door },
        );
        if (!result.ok) errors.push({ point: spawn.id, error: result.error });
        else {
          if (door !== undefined) sendOnErrand(world, result.entity, spawn.position, false);
          arrived.add(spawn.id);
        }
      } else if (!present && here.length > 0) {
        for (const entity of here) {
          if (isConversing(world, entity) || errandOf(world, entity)?.leave === true) continue;
          const navigation = aiNavigation(world);
          const measure = navigation?.distance ?? straightDistance;
          const exit = nearest(exits, (point) => measure(world, entity, point));
          if (exit !== undefined) {
            sendOnErrand(world, entity, exit, true);
            left.add(spawn.id);
          } else if (!heldInView(world, entity, hold)) {
            despawnCreature(world, entity);
            left.add(spawn.id);
          }
        }
      } else if (present) {
        // Back in its window before it reached the door: it turns round and takes up its place.
        for (const entity of here)
          if (errandOf(world, entity)?.leave === true) endErrand(world, entity);
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

/** Whether `entity` stands on the player's screen. */
function heldInView(world: World<never>, entity: EntityId, hold: PresenceHold): boolean {
  const here = world.get(entity, PlacementComponent);
  return here !== undefined && hold.inView?.(here) === true;
}

/** Horizontal metres between two points. */
function flat(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}
