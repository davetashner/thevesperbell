// The live reader of conditions (mw-e15.2): what the `entities`, `signal` and `sustained` leaves of
// the condition language (conditions.ts) read from a world. Entities are found by tag or by scene
// spawn id, tested with the same property/tag/element predicates trigger volumes use (signals/
// filter.ts) and located with the same volume shapes, so "a burning brazier" and "40 kg on the
// plate" mean here exactly what they mean in a signal graph. Everything is read from sim state and
// ordered by entity id, so a result depends only on the world.

import type { ComponentType, EntityId } from '../core/component';
import type { World } from '../core/world';
import { SceneSpawnComponent, SceneTransformComponent } from '../scene/loader';
import { SignalGraphComponent, signalOutput } from '../signals/runtime';
import { matchesFilter, TagsComponent } from '../signals/filter';
import type { SignalPredicate, VolumeShape } from '../signals/graph';
import { PlacementComponent } from '../stimulus/placement';
import { shapeFalloff } from '../stimulus/shapes';
import type { ConditionHost, EntitySelector, LiveReader } from './conditions';

/** The ids of every entity of the given component types that exists, ascending. */
function holders(world: World<never>, ...types: ComponentType<unknown>[]) {
  const ids = new Set<EntityId>();
  for (const type of types) {
    if (!world.isRegistered(type)) continue;
    for (const id of world.query(type).ids()) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Whether `entity` carries `tag` as an entity tag or as the tag of its scene spawn. */
function tagged(world: World<never>, entity: EntityId, tag: string): boolean {
  return (
    (world.isRegistered(TagsComponent) &&
      (world.get(entity, TagsComponent)?.includes(tag) ?? false)) ||
    (world.isRegistered(SceneSpawnComponent) &&
      (world.get(entity, SceneSpawnComponent)?.tags.includes(tag) ?? false))
  );
}

/** Where `entity` stands and how big it is: its placement, else its scene transform (a point). */
function positionOf(world: World<never>, entity: EntityId) {
  if (world.isRegistered(PlacementComponent)) {
    const at = world.get(entity, PlacementComponent);
    if (at !== undefined) return at;
  }
  if (world.isRegistered(SceneTransformComponent)) {
    const at = world.get(entity, SceneTransformComponent)?.position;
    if (at !== undefined) return { ...at, radius: 0 };
  }
  return undefined;
}

/** A `LiveReader` over `world` (components the world does not register are simply absent). */
export function worldLiveReader(world: World<never>): LiveReader {
  return {
    get tick() {
      return world.tick;
    },
    get hz() {
      return world.clock.hz;
    },
    get structure() {
      return world.structureVersion;
    },
    select: (selector: EntitySelector) => {
      const { tag, entity } = selector;
      const candidates =
        tag === undefined && entity === undefined
          ? holders(world, PlacementComponent)
          : holders(world, TagsComponent, SceneSpawnComponent);
      return candidates.filter(
        (id) =>
          (tag === undefined || tagged(world, id, tag)) &&
          (entity === undefined ||
            (world.isRegistered(SceneSpawnComponent) &&
              world.get(id, SceneSpawnComponent)?.id === entity)),
      );
    },
    passes: (
      entity: EntityId,
      where: readonly SignalPredicate[],
      inside: VolumeShape | undefined,
    ) => {
      if (!matchesFilter(world, entity, where)) return false;
      if (inside === undefined) return true;
      const at = positionOf(world, entity);
      return at !== undefined && shapeFalloff(inside, 'none', at, at.radius) !== undefined;
    },
    signal: (graph: string, node: string, port: string | undefined) => {
      if (!world.isRegistered(SignalGraphComponent)) return false;
      let found: EntityId | undefined;
      world.query(SignalGraphComponent).forEach((entity, instance) => {
        if (found === undefined && instance.graph.id === graph) found = entity;
      });
      return found !== undefined && safeOutput(world, found, node, port);
    },
  };
}

/** `signalOutput`, false for a node or port the graph does not have (it throws). */
function safeOutput(world: World<never>, graph: EntityId, node: string, port: string | undefined) {
  try {
    return signalOutput(world, graph, node, port);
  } catch {
    return false;
  }
}

/**
 * A `ConditionHost` for `world` with the live reader: pass it to `onConditionChanged` so goals can read
 * entities, signals and time as well as facts.
 */
export function conditionHost(world: World<never>): ConditionHost {
  return { facts: world.facts, events: world.events, live: worldLiveReader(world) };
}
