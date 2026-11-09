// Containers in the game (mw-e18.3): the glue between content's loot tables, items and locks, the
// sim's lootable containers (src/sim/loot/containers.ts) and the e2e.
//
// - `startContainers` installs containers in a world and makes a loaded scene's container spawns
//   containers, rolling loot for the opener's class. Call after world items (it shares their
//   inventory rules) and after mechanisms (they unlock a locked chest), before level deltas are
//   taken, so a looted chest is measured against the level as built.
// - `ContainerWatch` publishes what is in each container and whether it has been opened, for the
//   e2e (#app[data-containers]).
//
// Interact on a chest opens it; the container window (mw-e18.4, container-window.ts) takes from it.

import type { GameContent } from '@content/index';
import {
  addSceneContainers,
  classOf,
  containerFact,
  ContainerComponent,
  Containers,
  installContainers,
  inventoryOf,
  LootTables,
  SceneSpawnComponent,
  type EntityId,
  type InventoryRules,
  type ItemSpawner,
  type LoadedScene,
  type SceneLayout,
  type World,
} from '@sim/index';
import { lockSpecs } from '../mechanisms/index';

type Content = Pick<GameContent, 'all' | 'get' | 'has'>;

/** Whether a scene has containers. */
export function hasContainers(layout: SceneLayout): boolean {
  return layout.spawns.some((spawn) => spawn.container !== undefined);
}

/** Container rules over content's loot tables and items, moving items through `inventory`. */
export function prepareContainers(
  content: Content,
  inventory: InventoryRules,
  spawner?: ItemSpawner,
): Containers {
  return new Containers(inventory, new LootTables(content.all('loot-table'), content.all('item')), {
    classOf,
    // A container that breaks spills what it holds as pickups (mw-e03.23).
    ...(spawner !== undefined && { items: spawner }),
  });
}

/**
 * Installs `containers` in `world` and makes `loaded`'s container spawns containers. Call between
 * steps, once, after world items and mechanisms. Returns the containers, in scene order.
 */
export function startContainers<T>(
  world: World<T>,
  containers: Containers,
  loaded: LoadedScene,
  content: Content,
): EntityId[] {
  const sim = world as unknown as World<never>;
  installContainers(world, containers);
  return addSceneContainers(sim, containers, loaded.id, loaded.spawns, lockSpecs(content));
}

/** One stack, as the readout reports it. */
export interface ContainerStack {
  readonly item: string;
  readonly count: number;
}

/** One container, as the readout reports it. */
export interface ContainerReading {
  /** Opened at least once (its loot table, if any, has been rolled). */
  readonly opened: boolean;
  readonly items: readonly ContainerStack[];
  readonly gold: number;
}

/** Reads a scene's containers, by spawn id. */
export class ContainerWatch {
  constructor(
    private readonly world: World<never>,
    private readonly containers: readonly EntityId[],
  ) {}

  /** The readout now; containers that are gone (a chest smashed) are left out. */
  readout(): Readonly<Record<string, ContainerReading>> {
    const { world } = this;
    const readings: Record<string, ContainerReading> = {};
    for (const entity of this.containers) {
      const container = world.get(entity, ContainerComponent);
      const pack = inventoryOf(world, entity);
      if (container === undefined || pack === undefined) continue;
      const name = world.get(entity, SceneSpawnComponent)?.id ?? String(entity);
      readings[name] = {
        opened: world.facts.get(containerFact(container, 'opened')) === true,
        items: pack.items.map(({ defId, count }) => ({ item: defId, count })),
        gold: pack.gold,
      };
    }
    return readings;
  }
}
