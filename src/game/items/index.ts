// World items in the game (mw-e17.7): the glue between content items, the sim's world items
// (src/sim/items) and the renderer.
//
// - `prepareWorldItems` builds the sim's world-item rules over content's items and materials.
// - `prepareConsumables` and `startConsumables` do the same for consumables and quick slots
//   (mw-e17.6): the use pipeline, and thrown consumables spawning as world items.
// - `startWorldItems` installs them in a world after the player (so the drop and throw buttons act on
//   this tick's position), gives the player an inventory and turns the scene's item spawns into
//   world items.
// - `bindWorldItems` gives every world item without one a placeholder box the size of its body, by
//   category (call after each step); render sync drops it when the item is picked up.
// - `ItemWatch` keeps what the e2e reads (#app[data-items]): the player's pack, the world items
//   lying about, and counts of takes, drops and refusals.

import {
  DEFAULT_CARRY_LIMIT_KG,
  toPropertyInit,
  type GameContent,
  materialPresets,
  type ItemEntry,
} from '@content/index';
import {
  addInventory,
  CarryBulkyComponent,
  addQuickSlots,
  addSceneItems,
  Consumables,
  installCarry,
  installPush,
  installConsumables,
  classOf,
  holdOf,
  installWorldItems,
  inventoryOf,
  itemAdded,
  itemDropped,
  itemDropRefused,
  itemPickedUp,
  itemPickupRefused,
  itemRemoved,
  PhysicsObjectComponent,
  quickSlotsOf,
  WorldItemComponent,
  WorldItems,
  type ConsumableDef,
  type CarryController,
  type CollisionWorld,
  type EntityId,
  type ItemInstanceFlags,
  type ItemSpawnEntity,
  type Vec3,
  type World,
} from '@sim/index';
import { breakableProfiles } from '../breakables';
import type { RenderSync, SceneBinding } from '../loop/render-sync';

/**
 * The sim's view of a content item: its world properties (and a coating's) with the material as an
 * id. It is both a world item's and a consumable's definition.
 */
export function worldItemDef(item: ItemEntry): ConsumableDef {
  const { worldProperties, use, breakable, ...rest } = item;
  return {
    ...rest,
    ...(breakable !== undefined && { breakable: { profile: breakable.profile.id } }),
    ...(worldProperties !== undefined && { worldProperties: toPropertyInit(worldProperties) }),
    ...(use !== undefined && {
      use: use.map((effect) =>
        effect.op === 'coat'
          ? { ...effect, properties: toPropertyInit(effect.properties) }
          : effect,
      ),
    }),
  };
}

/** World-item rules over every content item, with content's material presets. */
export function prepareWorldItems(content: Pick<GameContent, 'all' | 'get' | 'has'>): WorldItems {
  return new WorldItems(content.all('item').map(worldItemDef), {
    materials: materialPresets(content.all('material')),
    breakables: breakableProfiles(content),
  });
}

/** Consumable rules (mw-e17.6) over every content item, sharing `items`' world-item rules. */
export function prepareConsumables(
  content: Pick<GameContent, 'all'>,
  items: WorldItems,
): Consumables {
  return new Consumables(content.all('item').map(worldItemDef), { items });
}

/**
 * Installs consumables in `world` (after world items: thrown consumables spawn as world items) and
 * gives `player` quick slots when there is one. Nothing binds buttons to the slots yet: the
 * quick-slot command uses them (see docs/design/controls.md).
 */
export function startConsumables<T>(
  world: World<T>,
  consumables: Consumables,
  player: EntityId | undefined,
): void {
  const sim = world as unknown as World<never>;
  installConsumables(world, consumables);
  if (player !== undefined && quickSlotsOf(sim, player) === undefined) addQuickSlots(sim, player);
}

/**
 * Installs world items in `world` (after the player's systems), gives `player` an inventory when
 * there is one, and makes the scene's item spawns world items. Call once, between steps, after
 * physics objects and the player's interaction are installed. Returns the placed items.
 */
export function startWorldItems<T>(
  world: World<T>,
  items: WorldItems,
  spawns: readonly ItemSpawnEntity[],
  player: EntityId | undefined,
): EntityId[] {
  const sim = world as unknown as World<never>;
  installWorldItems(world, items, { busy: (w, actor) => holdOf(w, actor) !== undefined });
  if (player !== undefined && inventoryOf(sim, player) === undefined) addInventory(sim, player);
  return addSceneItems(sim, items, spawns);
}

/** A scene spawn that may be a shoulder-carry, and its entity (as `LoadedScene.spawns` lists them). */
export interface BulkySpawn {
  readonly entity: EntityId;
  readonly spawn: { readonly bulky?: string | undefined };
}

/**
 * Installs carrying (mw-e02.17) after the world items: Interact picks up a liftable object up to the
 * class's carry limit (class data, 25 kg by default), Drop and Throw (held to charge) let it go.
 * `collision` stops a held object at walls. Returns the controller (the throw arc preview).
 */
export function startCarry<T>(
  world: World<T>,
  content: Pick<GameContent, 'get' | 'has'>,
  collision: CollisionWorld,
  spawns: readonly BulkySpawn[] = [],
): CarryController {
  installPush(world, { collision });
  const carry = installCarry(world, {
    collision,
    limit: (w, actor) => {
      const id = classOf(w, actor);
      return id !== undefined && content.has('class', id)
        ? content.get('class', id).carryLimitKg
        : DEFAULT_CARRY_LIMIT_KG;
    },
  });
  // Props the scene calls bulky (a body) are shoulder-carries (mw-e03.23).
  for (const { entity, spawn } of spawns) {
    if (spawn.bulky !== undefined) world.add(entity, CarryBulkyComponent, { kind: spawn.bulky });
  }
  return carry;
}

/**
 * Binds an object to every world item not bound yet (call after each sim step); `create` builds one
 * for a box of `size` metres of item category `category`. Returns how many it bound.
 */
export function bindWorldItems<TObject>(
  world: World<never>,
  sync: RenderSync,
  items: WorldItems,
  create: (entity: EntityId, size: Vec3, category: string) => SceneBinding<TObject>,
): number {
  let bound = 0;
  world.query(WorldItemComponent, PhysicsObjectComponent).forEach((entity, item, body) => {
    if (sync.has(entity) || body.shape.kind !== 'box') return;
    const { x, y, z } = body.shape.halfExtents;
    const size = { x: 2 * x, y: 2 * y, z: 2 * z };
    sync.bind(entity, create(entity, size, items.def(item.defId).category));
    bound += 1;
  });
  return bound;
}

/** One stack, as the readout reports it. */
export interface ItemStackReadout {
  readonly item: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
}

/** What the e2e reads: the player's pack, the world items and what happened so far. */
export interface ItemReadout {
  readonly pack: readonly ItemStackReadout[];
  readonly world: readonly ItemStackReadout[];
  readonly taken: number;
  readonly dropped: number;
  readonly thrown: number;
  /** Refusals so far, oldest first (e.g. "drop:no-drop", "pick-up:stack-limit"). */
  readonly refused: readonly string[];
}

/** Counts takes, drops, throws and refusals from the moment it is made. */
export class ItemWatch {
  private taken = 0;
  private dropped = 0;
  private thrown = 0;
  private readonly refused: string[] = [];
  private readonly offs: (() => void)[];
  /**
   * Bumped by every take, drop, throw and refusal, and every change to the player's pack: publish the
   * readout only when it moves.
   */
  version = 0;

  constructor(
    private readonly world: World<never>,
    private readonly player: EntityId | undefined,
  ) {
    this.offs = [
      world.events.on(itemPickedUp, () => {
        this.taken += 1;
        this.version += 1;
      }),
      world.events.on(itemDropped, ({ thrown }) => {
        if (thrown) this.thrown += 1;
        else this.dropped += 1;
        this.version += 1;
      }),
      world.events.on(itemPickupRefused, ({ reason }) => {
        this.refused.push(`pick-up:${reason}`);
        this.version += 1;
      }),
      world.events.on(itemDropRefused, ({ reason, thrown }) => {
        this.refused.push(`${thrown ? 'throw' : 'drop'}:${reason}`);
        this.version += 1;
      }),
      // The pack also changes without a take or a drop: looting a chest (mw-e18.3), using an item.
      world.events.on(itemAdded, this.#packChanged),
      world.events.on(itemRemoved, this.#packChanged),
    ];
  }

  readonly #packChanged = ({ actor }: { readonly actor: EntityId }): void => {
    if (actor === this.player) this.version += 1;
  };

  /** The readout now. */
  readout(): ItemReadout {
    const pack =
      this.player === undefined ? [] : (inventoryOf(this.world, this.player)?.items ?? []);
    const world: ItemStackReadout[] = [];
    this.world.query(WorldItemComponent).forEach((_entity, { defId, count, flags }) => {
      world.push({ item: defId, count, flags });
    });
    return {
      pack: pack.map(({ defId, count, flags }) => ({ item: defId, count, flags })),
      world,
      taken: this.taken,
      dropped: this.dropped,
      thrown: this.thrown,
      refused: [...this.refused],
    };
  }

  /** Stops listening. */
  dispose(): void {
    for (const off of this.offs) off();
  }
}
