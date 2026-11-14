// Creature drops in the game (mw-e01.5): the glue between content — each creature's loot table, each
// scene creature spawn's `carries`, the loot tables and items — and the sim's creature drops
// (src/sim/loot/drops.ts). Call `startCreatureDrops` once per world, after world items and the
// scene's creatures, before level deltas are taken: a dead creature's drops then persist with the
// level like any dropped item.

import type { GameContent } from '@content/index';
import {
  arrowLookup,
  classOf,
  installCreatureDrops,
  LootTables,
  type LootStack,
  type SceneSpawnPlacement,
  type World,
  type WorldItems,
} from '@sim/index';

type Content = Pick<GameContent, 'all'>;

/**
 * Makes every creature that dies in `world` drop what its spawn in `spawns` carries and roll its loot
 * table (see src/sim/loot/drops.ts), as world items of `items`, in level `level`. Returns a function
 * that uninstalls it.
 */
export function startCreatureDrops<T>(
  world: World<T>,
  content: Content,
  items: WorldItems,
  level: string,
  spawns: readonly SceneSpawnPlacement[],
): () => void {
  const tables = new Map<string, string>();
  for (const creature of content.all('creature')) {
    if (creature.loot !== undefined) tables.set(creature.id, creature.loot);
  }
  const carried = new Map<string, readonly LootStack[]>();
  for (const { id, carries } of spawns) if (carries !== undefined) carried.set(id, carries);
  // An arrow's world item is the ammo item that names it (mw-e05.7): a creature's intact arrows drop.
  const arrowItems = new Map<string, string>();
  for (const item of content.all('item')) {
    if (item.category === 'ammo') arrowItems.set(item.ammo.arrow.id, item.id);
  }
  return installCreatureDrops(world, {
    arrows: { lookup: arrowLookup(content.all('arrow')), itemOf: (arrow) => arrowItems.get(arrow) },
    level,
    items,
    loot: new LootTables(content.all('loot-table'), content.all('item')),
    tableOf: (creature) => tables.get(creature),
    carried: (point) => carried.get(point),
    classOf,
  });
}
