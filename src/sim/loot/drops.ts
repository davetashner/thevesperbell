// Creature drops (mw-e01.5): what a creature leaves where it dies, so the slice's skeleton drops the
// gallery key from its body (docs/design/vertical-slice.md B5). Data-driven on two levels:
//
// - What a placed creature carries: its scene spawn's `carries` list (the key the skeleton by pillar
//   B carries). Always dropped, in order.
// - Its definition's loot table (creature `loot`, E18): rolled on its death, after what it carries,
//   from a sub-stream of the world's `loot` stream named for the creature
//   (`creature:<level>/<spawn point>`, or `creature:<entity>` for one with no spawn point), so a
//   death rolls the same loot whenever it happens and never shifts any other draw. Class-conditioned
//   entries read the killer's class.
//
// On a creature's Died (emitted once per entity, never by a save load) each stack becomes one world
// item lying at the body: the first at the creature's feet, the rest on a DROP_SCATTER_RADIUS ring
// around them, each resting on the floor the creature stood on, so every drop is within 1 m of the
// body (AC-2). Each fires `item.dropped` with the creature as the actor, so dropped items persist
// with their level (`persistDroppedItems`) exactly like the player's. Gold drops as a gold world item
// (taking it fills the gold counter). The sim never imports content: the game passes the items, the
// loot tables, each creature's table and each spawn point's carried items in.

import { returnsAs, takeStuckArrows } from '../combat/arrows/retrieval';
import type { ArrowLookup } from '../combat/arrows/system';
import { Died } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { CreatureComponent, type CreatureOrigin } from '../creatures/components';
import { ITEM_HALF_EXTENTS, itemDropped, type WorldItems } from '../items/world-items';
import { cos, sin } from '../math';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { LOOT_RNG_STREAM, type LootStack, type LootTables } from './tables';

/** How far from the feet the second and later drops lie, metres (well inside 1 m). */
export const DROP_SCATTER_RADIUS = 0.3;

/** What creature drops read; the game builds it from content and the loaded scene. */
export interface CreatureDropsOptions {
  /** The level the creatures belong to (their roll's sub-stream is named for it). */
  readonly level: string;
  /** The world-item rules the drops are placed with. */
  readonly items: WorldItems;
  /** The loot tables creature tables roll against; without them no table is rolled. */
  readonly loot?: LootTables;
  /** A creature definition's loot table id, by creature id (none: it rolls nothing). */
  readonly tableOf?: (creature: string) => string | undefined;
  /** What the creature placed at a scene spawn point carries, by spawn point id. */
  readonly carried?: (point: string) => readonly LootStack[] | undefined;
  /**
   * Arrows stuck in a creature when it dies (mw-e05.7): the intact ones drop with its loot, as the
   * item `itemOf` names for the arrow they come back as; the broken ones go with the body. Without
   * it, arrows stay stuck in the corpse.
   */
  readonly arrows?: {
    readonly lookup: ArrowLookup;
    /** The world item of an arrow type, or undefined for an arrow with none (it is not dropped). */
    readonly itemOf: (arrow: string) => string | undefined;
  };
  /** The killer's class, which class-conditioned loot entries read (none: those never drop). */
  readonly classOf?: (world: World<never>, killer: EntityId) => string | undefined;
}

/** Where the `index`-th of `count` drops lies around `feet`, on the floor the feet stand on. */
export function dropSpot(feet: Vec3, index: number, count: number): Vec3 {
  if (index === 0 || count < 2) return { x: feet.x, y: feet.y, z: feet.z };
  const angle = (2 * Math.PI * (index - 1)) / (count - 1);
  return {
    x: feet.x + sin(angle) * DROP_SCATTER_RADIUS,
    y: feet.y,
    z: feet.z + cos(angle) * DROP_SCATTER_RADIUS,
  };
}

/** The origin of creature `entity`, or undefined for anything that is not a creature. */
function originOf(world: World<never>, entity: EntityId): CreatureOrigin | undefined {
  if (!world.isRegistered(CreatureComponent)) return undefined;
  return world.get(entity, CreatureComponent)?.origin;
}

/** What a creature from `origin` drops: what it carries, then its table's roll. */
function dropsOf(
  world: World<never>,
  options: CreatureDropsOptions,
  entity: EntityId,
  origin: CreatureOrigin,
  killer: EntityId | null,
): LootStack[] {
  const { point } = origin;
  const stacks = [...(point === undefined ? [] : (options.carried?.(point) ?? []))];
  const table = options.tableOf?.(origin.creature);
  const { loot } = options;
  if (table === undefined || loot === undefined) return stacks;
  const name = point === undefined ? String(entity) : `${options.level}/${point}`;
  const rng = world.random(LOOT_RNG_STREAM).stream(`creature:${name}`);
  const classId = killer === null ? undefined : options.classOf?.(world, killer);
  const rolled = loot.roll(
    table,
    rng,
    { facts: world.facts, ...(classId !== undefined && { classId }) },
    world,
  );
  return [...stacks, ...rolled.stacks];
}

/** The intact arrows stuck in `entity` as loot stacks (and every arrow in it removed). */
function arrowStacks(
  world: World<never>,
  options: CreatureDropsOptions,
  entity: EntityId,
): LootStack[] {
  const { arrows } = options;
  if (arrows === undefined) return [];
  const comesBack = (arrow: string): string => returnsAs({ arrows: arrows.lookup }, arrow);
  const stacks: LootStack[] = [];
  for (const { arrow, count } of takeStuckArrows(world, entity, comesBack)) {
    const item = arrows.itemOf(arrow);
    if (item !== undefined) stacks.push({ item, count });
  }
  return stacks;
}

/** Lays `stacks` at `feet` as world items (the `first`-th of `total` drop spots on), dropped by `entity`. */
function placeStacks(
  world: World<never>,
  options: CreatureDropsOptions,
  entity: EntityId,
  feet: Vec3,
  stacks: readonly LootStack[],
  first: number,
  total: number,
): EntityId[] {
  const { items } = options;
  return stacks.map(({ item, count }, index) => {
    const half = ITEM_HALF_EXTENTS[items.def(item).category];
    const spot = dropSpot(feet, first + index, total);
    const position = { x: spot.x, y: spot.y + half.y, z: spot.z };
    const dropped = items.spawn(world, { defId: item, count, position, by: entity });
    world.events.emit(itemDropped, {
      tick: world.tick,
      actor: entity,
      entity: dropped,
      defId: item,
      count,
      flags: {},
      thrown: false,
      position,
    });
    return dropped;
  });
}

/**
 * Drops what creature `entity` carries and rolls where it stands (see the file header), and the
 * intact arrows already stuck in it (those landing this very tick, the killing arrow among them, are
 * not yet visible: `installCreatureDrops` drops them a tick later). Returns the world items, in
 * order (none for something that is not a placed creature).
 */
export function dropCreatureLoot(
  world: World<never>,
  options: CreatureDropsOptions,
  entity: EntityId,
  killer: EntityId | null = null,
): EntityId[] {
  const origin = originOf(world, entity);
  const feet = origin === undefined ? undefined : world.get(entity, PlacementComponent);
  if (origin === undefined || feet === undefined) return [];
  const stacks = [
    ...dropsOf(world, options, entity, origin, killer),
    ...arrowStacks(world, options, entity),
  ];
  return placeStacks(world, options, entity, feet, stacks, 0, stacks.length);
}

/**
 * Makes every creature that dies in `world` drop its loot (see the file header). Needs world items
 * installed (`installWorldItems`). With `arrows`, the arrows that land in a creature on the tick it
 * dies (the killing one) drop the next tick, beside its other loot. Returns a function that
 * uninstalls it.
 */
export function installCreatureDrops(
  world: World<never>,
  options: CreatureDropsOptions,
): () => void {
  const late = new Set<EntityId>();
  if (options.arrows !== undefined) {
    world.addSystem({
      name: 'creature-arrow-drops',
      run: () => {
        for (const entity of [...late]) {
          late.delete(entity);
          // A creature that is gone leaves its arrows to fall where it stood (arrows/retrieval.ts).
          const feet = world.isAlive(entity) ? world.get(entity, PlacementComponent) : undefined;
          if (feet === undefined) continue;
          const stacks = arrowStacks(world, options, entity);
          if (stacks.length > 0) {
            // Beside whatever else it dropped, never on top of the first drop spot.
            placeStacks(world, options, entity, feet, stacks, 1, stacks.length + 1);
          }
        }
      },
    });
  }
  const off = world.events.on(Died, ({ target, killer }) => {
    dropCreatureLoot(world, options, target, killer);
    if (options.arrows !== undefined && originOf(world, target) !== undefined) late.add(target);
  });
  return () => {
    late.clear();
    off();
  };
}
