// World items (mw-e17.7, ADR-0003): items that lie in the world as physical objects, so a dropped key
// can fall through a grate and a thrown bottle can draw a guard. A world item is an entity with an
// `item.world` component (definition, units and instance flags), the item's world properties, a
// dynamic physics body (mw-e03.10) and one affordance, "Take <name>", on the one Interact verb
// (mw-e02.5).
//
// - Pick up: the `interacted` event for a world item's pick-up adds its units to the actor's
//   inventory (mw-e17.3) with the same flags and destroys the entity, in the tick the player
//   interacts (AC-1). There is no "full" (ADR-0003): only the inventory's own refusals (the 9,999-unit
//   guard, a second unique) leave the entity where it is, with `itemPickupRefused`. Gold goes to the
//   gold counter. Ownership (stolen on a witnessed take) is e18's, applied to the flags it carries.
// - Drop: a whole stack leaves the inventory and one world item carrying its count and flags spawns
//   in front of the actor, falling from hand height (AC-2).
// - Throw: one unit leaves and spawns at shoulder height with a velocity along the actor's look,
//   lofted a little, at a speed by weight class.
// - No-drop items (quest items by default, mw-e17.2 AC-5) are refused with reason `no-drop` for both
//   (AC-4), so the slice's gallery key can never be lost.
// - Impact noise: a world item's impacts are noises like any physics object's (src/sim/noise/impacts.ts:
//   energy × material, attributed to whoever dropped or threw it, mw-e03.25).
//
// Everything a world item does physically comes from properties, never from its type: its body's
// mass is its `weight` (from the weight class unless its world properties say otherwise), its
// friction and bounce come from its material, it has a `temperature` (the property's 20 °C default
// unless its data says otherwise) so heat stimuli and the element field reach it (a thrown oil flask
// catches fire from a torch, mw-e17.6), and its shape is a box sized by category, the
// placeholder the renderer also draws. The drop and throw buttons act on the selected item, the most
// recently acquired item that may be dropped; the inventory screen (mw-e17.10) drops or throws the
// item the player picks, through `drop` and `throw` (src/sim/items/inventory-actions.ts).

import type { ItemCategory, WeightClass } from '../../content/types/item';
import { CharacterController } from '../character/system';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { actionFrameOf, type ActionButton } from '../input/action-frame';
import { interactableOf, InteractableComponent, interacted } from '../interaction/system';
import {
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  type AddRefusal,
  type InventoryItemDef,
  type ItemInstance,
  type ItemInstanceFlags,
} from '../inventory/inventory';
import { cos, sin } from '../math';
import type { BreakableProfileLookup } from '../breakables/components';
import { makeBreakable } from '../breakables/system';
import { addPhysicsObject } from '../physics/objects';
import { PlayerLook } from '../player/player';
import {
  addMaterialProperties,
  resolveProperties,
  type MaterialPresets,
} from '../properties/materials';
import type { WorldPropertyInit } from '../properties/components';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';

/** A world item's body mass by weight class when its world properties set no `weight`, kg. */
export const WEIGHT_CLASS_KG: Readonly<Record<WeightClass, number>> = Object.freeze({
  light: 0.5,
  medium: 2,
  heavy: 8,
});

/** Throw speed by weight class, m/s. */
export const THROW_SPEED: Readonly<Record<WeightClass, number>> = Object.freeze({
  light: 9,
  medium: 7,
  heavy: 5,
});

/** How far in front of the actor's feet a dropped item appears, m (clear of the 0.35 m capsule). */
export const DROP_DISTANCE = 0.6;
/** Height above the feet a dropped item falls from, m. */
export const DROP_HEIGHT = 0.5;
/** Height above the feet a thrown item leaves from, m. */
export const THROW_HEIGHT = 1.4;
/** How far in front of the actor a thrown item leaves from, m. */
export const THROW_REACH = 0.5;
/** Loft added to the look pitch of a throw, radians (about 8.6°). */
export const THROW_LOFT = 0.15;

/**
 * A world item's box by category, half extents in metres: the placeholder the renderer draws too.
 * The thinnest side is 4 cm so a fast throw cannot tunnel through a 20 cm floor in one tick.
 */
export const ITEM_HALF_EXTENTS: Readonly<Record<ItemCategory, Vec3>> = Object.freeze({
  weapon: { x: 0.45, y: 0.04, z: 0.07 },
  armor: { x: 0.25, y: 0.1, z: 0.2 },
  shield: { x: 0.3, y: 0.05, z: 0.3 },
  ammo: { x: 0.2, y: 0.04, z: 0.04 },
  book: { x: 0.1, y: 0.04, z: 0.14 },
  key: { x: 0.08, y: 0.04, z: 0.04 },
  consumable: { x: 0.05, y: 0.08, z: 0.05 },
  tool: { x: 0.1, y: 0.04, z: 0.06 },
  quest: { x: 0.1, y: 0.1, z: 0.1 },
  artifact: { x: 0.08, y: 0.08, z: 0.08 },
  currency: { x: 0.06, y: 0.04, z: 0.06 },
  misc: { x: 0.1, y: 0.1, z: 0.1 },
});

/** An item lying in the world (`item.world`; a snapshot key, never renamed). */
export interface WorldItem {
  readonly defId: string;
  /** Units it carries (a dropped stack keeps its count). */
  readonly count: number;
  /** The instance flags it had in the pack (stolen, owner, bound), kept unchanged. */
  readonly flags: ItemInstanceFlags;
  /** Who dropped or threw it (impact noise is theirs), or null for a placed item. */
  readonly by: EntityId | null;
}

export const WorldItemComponent = defineComponent<WorldItem>('item.world');

/** What world items read from an item definition; a loaded `ItemEntry` (mw-e17.2) is one. */
export interface WorldItemDef extends InventoryItemDef {
  readonly weightClass: WeightClass;
  readonly flags: InventoryItemDef['flags'] & { readonly noDrop: boolean };
  /** Its world properties in the world (an oil flask is flammable); weight defaults by class. */
  readonly worldProperties?: WorldPropertyInit | undefined;
  /** Breaks when dropped or thrown hard (a jar): the breakable profile id (mw-ju8.4). */
  readonly breakable?: { readonly profile: string } | undefined;
}

/** A world item to place. */
export interface WorldItemSpec {
  readonly defId: string;
  /** Defaults to 1. */
  readonly count?: number;
  readonly flags?: ItemInstanceFlags;
  /** Centre of its box, metres. */
  readonly position: Vec3;
  /** Defaults to identity. */
  readonly rotation?: Quat;
  /** Initial velocity (a throw), m/s; defaults to at rest. */
  readonly velocity?: Vec3;
  /** Who dropped or threw it; defaults to null. */
  readonly by?: EntityId | null;
}

/** Why a pick-up was refused (the entity stays in the world). */
export type PickUpRefusal = Exclude<AddRefusal, 'currency'>;

/** Why a drop or throw was refused (nothing changed). */
export type DropRefusal =
  /** The item may not leave the pack: a quest item (AC-4) or one flagged `noDrop`. */
  | 'no-drop'
  /** No instance with that id, or nothing selected (an empty pack). */
  | 'no-instance'
  /** Fewer units held than asked for. */
  | 'not-enough';

export type PickUpResult =
  | { readonly ok: true; readonly instanceIds: readonly number[] }
  | { readonly ok: false; readonly reason: PickUpRefusal };

export type DropResult =
  | { readonly ok: true; readonly entity: EntityId }
  | { readonly ok: false; readonly reason: DropRefusal };

/** An actor took a world item. */
export interface ItemPickedUp {
  readonly tick: number;
  readonly actor: EntityId;
  /** The world item (destroyed at the end of this tick). */
  readonly entity: EntityId;
  readonly defId: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
}

/** A pick-up the inventory refused; the item stays where it is. */
export interface ItemPickupRefused {
  readonly tick: number;
  readonly actor: EntityId;
  readonly entity: EntityId;
  readonly defId: string;
  readonly reason: PickUpRefusal;
}

/** Units left an actor's pack as a world item. */
export interface ItemDropped {
  readonly tick: number;
  readonly actor: EntityId;
  /** The new world item (live from the next tick when spawned during a step). */
  readonly entity: EntityId;
  readonly defId: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
  readonly thrown: boolean;
  readonly position: Vec3;
}

/** A drop or throw that was refused. */
export interface ItemDropRefused {
  readonly tick: number;
  readonly actor: EntityId;
  /** The item asked for, or null when nothing was selected. */
  readonly defId: string | null;
  readonly thrown: boolean;
  readonly reason: DropRefusal;
}

export const itemPickedUp = defineEvent<ItemPickedUp>('item.pickedUp');
export const itemPickupRefused = defineEvent<ItemPickupRefused>('item.pickupRefused');
export const itemDropped = defineEvent<ItemDropped>('item.dropped');
export const itemDropRefused = defineEvent<ItemDropRefused>('item.dropRefused');

/** Where an actor drops from and which way it looks. */
export interface ItemHandlerView {
  /** Feet, metres. */
  readonly feet: Vec3;
  /** Look yaw, radians: 0 faces −z, positive turns left (as PlayerLook). */
  readonly yaw: number;
  /** Look pitch, radians above the horizon. */
  readonly pitch: number;
}

/** A character's feet (CharacterController) and look (PlayerLook); undefined without either. */
export function handlerView(world: World<never>, actor: EntityId): ItemHandlerView | undefined {
  const state = world.get(actor, CharacterController);
  const look = world.get(actor, PlayerLook);
  if (state === undefined || look === undefined) return undefined;
  return { feet: state.position, yaw: look.yaw, pitch: look.pitch };
}

/** "rusted-gallery-key" → "Rusted gallery key": the name until localisation lands. */
export function readableName(id: string): string {
  const words = id.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const frozenFlags = (flags: ItemInstanceFlags): ItemInstanceFlags =>
  Object.freeze({
    ...(flags.stolen === true && { stolen: true }),
    ...(flags.ownerId !== undefined && { ownerId: flags.ownerId }),
    ...(flags.bound === true && { bound: true }),
  });

const rotationOf = (yaw: number): Quat => ({ x: 0, y: sin(yaw / 2), z: 0, w: cos(yaw / 2) });

export interface WorldItemsOptions {
  /** The inventory rules (over the same definitions); defaults to `new InventoryRules(items)`. */
  readonly inventory?: InventoryRules;
  /** Material presets for items whose world properties name a material; defaults to none. */
  readonly materials?: MaterialPresets;
  /** An item's display name; defaults to `readableName` of its id. */
  readonly name?: (def: WorldItemDef) => string;
  /**
   * Breakable profiles by id. A world item whose definition names one is made breakable
   * (`makeBreakable`): with the breakables installed, a hard enough drop or throw breaks it. An
   * item naming a profile this lookup lacks stays an ordinary item.
   */
  readonly breakables?: BreakableProfileLookup;
}

/** Where a released item starts: its box centre, rotation and (for a throw) velocity. */
export interface ItemLaunch {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly velocity?: Vec3;
}

/** The unit vector ahead of `view` on the ground plane. */
const aheadOf = (view: ItemHandlerView) => ({ x: -sin(view.yaw), z: -cos(view.yaw) });

/** A drop in front of `view`: DROP_DISTANCE ahead of the feet, falling from DROP_HEIGHT, at rest. */
export function dropPlacement(view: ItemHandlerView): ItemLaunch {
  const ahead = aheadOf(view);
  const { feet } = view;
  return {
    position: {
      x: feet.x + ahead.x * DROP_DISTANCE,
      y: feet.y + DROP_HEIGHT,
      z: feet.z + ahead.z * DROP_DISTANCE,
    },
    rotation: rotationOf(view.yaw),
  };
}

/**
 * A throw along `view`'s look: from THROW_HEIGHT, THROW_REACH ahead, lofted by THROW_LOFT, at the
 * speed of `weightClass`. The drop and throw buttons and thrown consumables (mw-e17.6) share it.
 */
export function throwLaunch(
  view: ItemHandlerView,
  weightClass: WeightClass,
): ItemLaunch & { readonly velocity: Vec3 } {
  const ahead = aheadOf(view);
  const { feet } = view;
  const pitch = view.pitch + THROW_LOFT;
  const speed = THROW_SPEED[weightClass];
  const flat = cos(pitch) * speed;
  return {
    position: {
      x: feet.x + ahead.x * THROW_REACH,
      y: feet.y + THROW_HEIGHT,
      z: feet.z + ahead.z * THROW_REACH,
    },
    rotation: rotationOf(view.yaw),
    velocity: { x: ahead.x * flat, y: sin(pitch) * speed, z: ahead.z * flat },
  };
}

/** The world-item rules over a set of item definitions (see the file header). */
export class WorldItems {
  readonly inventory: InventoryRules;
  readonly #defs: ReadonlyMap<string, WorldItemDef>;
  readonly #materials: MaterialPresets;
  readonly #name: (def: WorldItemDef) => string;
  readonly #breakables: BreakableProfileLookup | undefined;

  /** `items`: every item definition (the content registry's). */
  constructor(items: Iterable<WorldItemDef>, options: WorldItemsOptions = {}) {
    const defs = [...items];
    this.inventory = options.inventory ?? new InventoryRules(defs);
    this.#defs = new Map(defs.map((def) => [def.id, def]));
    this.#materials = options.materials ?? new Map();
    this.#name = options.name ?? ((def) => readableName(def.id));
    this.#breakables = options.breakables;
  }

  /** Whether `defId` is a known item. */
  has(defId: string): boolean {
    return this.#defs.has(defId);
  }

  /** The definition of `defId`. @throws RangeError for an id it does not know. */
  def(defId: string): WorldItemDef {
    const def = this.#defs.get(defId);
    if (def === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return def;
  }

  /** The prompt label of a world item: "Take <name>", with the count when more than one. */
  label(defId: string, count: number): string {
    const name = this.#name(this.def(defId));
    return count > 1 ? `Take ${name} (${String(count)})` : `Take ${name}`;
  }

  /**
   * Places a world item: its properties, body, box and "Take" affordance. During a step the entity
   * goes live at the end of the tick (its body exists at once). Returns the entity.
   * @throws RangeError for an unknown item, a bad count or an unknown material.
   */
  spawn(world: World<never>, spec: WorldItemSpec): EntityId {
    const entity = world.spawn();
    this.#place(world, entity, spec);
    return entity;
  }

  /** Makes `entity` (e.g. a scene spawn marker) the world item `spec` describes. */
  place(world: World<never>, entity: EntityId, spec: WorldItemSpec): void {
    this.#place(world, entity, spec);
  }

  #place(world: World<never>, entity: EntityId, spec: WorldItemSpec): void {
    const def = this.def(spec.defId);
    const count = spec.count ?? 1;
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new RangeError(`count must be a positive integer, got ${String(count)}`);
    }
    const init: WorldPropertyInit = {
      weight: WEIGHT_CLASS_KG[def.weightClass],
      temperature: WORLD_PROPERTY_SPECS.temperature.default,
      ...def.worldProperties,
    };
    const { weight, friction, impactAbsorb } = resolveProperties(this.#materials, init);
    addMaterialProperties(world, entity, this.#materials, init);
    addPhysicsObject(world, entity, {
      shape: { kind: 'box', halfExtents: ITEM_HALF_EXTENTS[def.category] },
      position: spec.position,
      ...(spec.rotation !== undefined && { rotation: spec.rotation }),
      ...(spec.velocity !== undefined && { velocity: spec.velocity }),
      properties: { weight, friction, impactAbsorb },
    });
    world.add(
      entity,
      WorldItemComponent,
      Object.freeze({
        defId: def.id,
        count,
        flags: frozenFlags(spec.flags ?? {}),
        by: spec.by ?? null,
      }),
    );
    world.add(
      entity,
      InteractableComponent,
      interactableOf({ affordances: [{ verb: 'pick-up', label: this.label(def.id, count) }] }),
    );
    // A jar breaks like any breakable (mw-ju8.4): the breakables system tests the physics impact of
    // a hard drop or throw against its material's fragile threshold; nothing of it is left to pick up.
    const profile =
      def.breakable === undefined ? undefined : this.#breakables?.(def.breakable.profile);
    if (profile !== undefined) makeBreakable(world, entity, profile);
  }

  /**
   * `actor` takes world item `entity`: its units enter the inventory with its flags (gold the gold
   * counter) and the entity is destroyed (end of tick during a step). Refused, changing nothing,
   * when the inventory refuses the units. Emits `item.pickedUp` or `item.pickupRefused`.
   * @throws RangeError when `entity` is not a world item or `actor` has no inventory.
   */
  pickUp(world: World<never>, actor: EntityId, entity: EntityId): PickUpResult {
    const item = world.get(entity, WorldItemComponent);
    if (item === undefined) throw new RangeError(`entity ${String(entity)} is not a world item`);
    const { defId, count, flags } = item;
    let result: PickUpResult;
    if (this.def(defId).category === 'currency') {
      this.inventory.addGold(world, actor, count);
      result = { ok: true, instanceIds: [] };
    } else {
      result = this.inventory.add(world, actor, defId, count, flags) as PickUpResult;
    }
    if (!result.ok) {
      world.events.emit(itemPickupRefused, {
        tick: world.tick,
        actor,
        entity,
        defId,
        reason: result.reason,
      });
      return result;
    }
    world.destroy(entity);
    world.events.emit(itemPickedUp, { tick: world.tick, actor, entity, defId, count, flags });
    return result;
  }

  /**
   * The item the drop and throw buttons act on: the most recently acquired instance that may be
   * dropped, else (so the refusal can say why) the most recent of all; undefined for an empty pack.
   */
  selected(world: World<never>, actor: EntityId): ItemInstance | undefined {
    const items = inventoryOf(world, actor)?.items ?? [];
    return items.findLast((item) => !this.def(item.defId).flags.noDrop) ?? items.at(-1);
  }

  /**
   * Drops `count` units (default: the whole stack) of instance `instanceId` in front of `view`: one
   * world item with the instance's flags, falling from hand height (AC-2). Refused, changing
   * nothing, for a no-drop item (AC-4), an unknown instance or too few units.
   */
  drop(
    world: World<never>,
    actor: EntityId,
    view: ItemHandlerView,
    request: { readonly instanceId: number; readonly count?: number },
  ): DropResult {
    return this.#release(world, actor, view, request.instanceId, request.count, false);
  }

  /**
   * Throws one unit of instance `instanceId` along `view`'s look, lofted by THROW_LOFT, at the
   * speed of its weight class. Refused like `drop`.
   */
  throw(
    world: World<never>,
    actor: EntityId,
    view: ItemHandlerView,
    request: { readonly instanceId: number },
  ): DropResult {
    return this.#release(world, actor, view, request.instanceId, 1, true);
  }

  #release(
    world: World<never>,
    actor: EntityId,
    view: ItemHandlerView,
    instanceId: number,
    count: number | undefined,
    thrown: boolean,
  ): DropResult {
    const instance = inventoryOf(world, actor)?.items.find((i) => i.instanceId === instanceId);
    const refuse = (reason: DropRefusal, defId: string | null): DropResult => {
      world.events.emit(itemDropRefused, { tick: world.tick, actor, defId, thrown, reason });
      return { ok: false, reason };
    };
    if (instance === undefined) return refuse('no-instance', null);
    const def = this.def(instance.defId);
    if (def.flags.noDrop) return refuse('no-drop', def.id);
    const units = count ?? instance.count;
    if (units > instance.count) return refuse('not-enough', def.id);
    // A quest item a designer let go of (noDrop: false) still needs force past the inventory.
    this.inventory.remove(world, actor, {
      instanceId,
      count: units,
      ...(def.flags.questItem && { force: true }),
    });
    const { position, rotation, velocity } = thrown
      ? throwLaunch(view, def.weightClass)
      : dropPlacement(view);
    const entity = this.spawn(world, {
      defId: def.id,
      count: units,
      flags: instance.flags,
      position,
      rotation,
      ...(velocity !== undefined && { velocity }),
      by: actor,
    });
    world.events.emit(itemDropped, {
      tick: world.tick,
      actor,
      entity,
      defId: def.id,
      count: units,
      flags: instance.flags,
      thrown,
      position,
    });
    return { ok: true, entity };
  }
}

/** The drop and throw buttons for one actor this tick. */
export interface ItemButtons {
  readonly drop?: ActionButton | undefined;
  readonly throw?: ActionButton | undefined;
}

export interface WorldItemsInstallOptions<TInput> {
  /** Where `actor` drops from and looks; defaults to `handlerView` (the player's). */
  readonly view?: (world: World<TInput>, actor: EntityId) => ItemHandlerView | undefined;
  /** This tick's drop and throw buttons for `actor`; defaults to the tick's ActionFrame's. */
  readonly input?: (inputs: readonly TInput[], actor: EntityId) => ItemButtons | undefined;
  /**
   * Whether `actor`'s hands are busy with something else this tick (a carried crate: its Drop and
   * Throw buttons are the crate's, mw-e02.17), so the pack's drop and throw do nothing.
   */
  readonly busy?: (world: World<never>, actor: EntityId) => boolean;
}

/**
 * The drop and throw buttons: for every actor with an inventory and a view, a throw press throws one
 * unit of the selected item, else a drop press drops its stack. A press with an empty pack is
 * refused with `no-instance`.
 */
export function worldItemsSystem<TInput>(
  items: WorldItems,
  options: WorldItemsInstallOptions<TInput> = {},
): System<TInput> {
  const viewOf =
    options.view ?? ((world: World<TInput>, actor: EntityId) => handlerView(world, actor));
  const inputOf =
    options.input ??
    ((inputs: readonly TInput[]): ItemButtons | undefined => actionFrameOf(inputs));
  return {
    name: 'worldItems',
    run({ world, inputs }) {
      const sim = world as unknown as World<never>; // world items never read inputs from the world
      world.query(InventoryComponent).forEach((actor) => {
        if (options.busy?.(sim, actor) === true) return;
        const buttons = inputOf(inputs, actor);
        const thrown = buttons?.throw?.pressed === true;
        if (!thrown && buttons?.drop?.pressed !== true) return;
        const view = viewOf(world, actor);
        if (view === undefined) return;
        const selected = items.selected(sim, actor);
        if (selected === undefined) {
          world.events.emit(itemDropRefused, {
            tick: world.tick,
            actor,
            defId: null,
            thrown,
            reason: 'no-instance',
          });
          return;
        }
        const request = { instanceId: selected.instanceId };
        if (thrown) items.throw(sim, actor, view, request);
        else items.drop(sim, actor, view, request);
      });
    },
  };
}

/**
 * Sets up world items in `world`: registers `item.world` (and the inventory and interactable
 * components if they are not yet), picks items up on `interacted`, emits impact noise and adds the
 * drop/throw system. The world needs physics objects (installPhysicsObjects) and, for the player to
 * focus items, the interaction system (installInteraction). Call once, between steps, after the
 * systems that move actors.
 */
export function installWorldItems<TInput>(
  world: World<TInput>,
  items: WorldItems,
  options: WorldItemsInstallOptions<TInput> = {},
): void {
  const sim = world as unknown as World<never>;
  for (const type of [WorldItemComponent, InventoryComponent, InteractableComponent] as const) {
    if (!world.isRegistered(type)) world.register(type);
  }
  // Two actors taking one item in the same tick: the first wins (the entity goes at the end of it).
  const taken = new Set<EntityId>();
  let takenTick = -1;
  world.events.on(interacted, ({ actor, target, verb }) => {
    if (verb !== 'pick-up' || !world.has(target, WorldItemComponent)) return;
    if (inventoryOf(sim, actor) === undefined) return;
    if (takenTick !== world.tick) {
      taken.clear();
      takenTick = world.tick;
    }
    if (taken.has(target)) return;
    if (items.pickUp(sim, actor, target).ok) taken.add(target);
  });
  world.addSystem(worldItemsSystem(items, options));
}

/** A scene spawn that places an item, and its entity (as `LoadedScene.spawns` lists them). */
export interface ItemSpawnEntity {
  readonly entity: EntityId;
  readonly spawn: {
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly item?: { readonly id: string; readonly count: number } | undefined;
  };
}

/**
 * Makes every loaded spawn that names an item that world item, resting on the spawn's floor point.
 * Returns those entities, in scene order.
 */
export function addSceneItems(
  world: World<never>,
  items: WorldItems,
  spawns: readonly ItemSpawnEntity[],
): EntityId[] {
  const placed: EntityId[] = [];
  for (const { entity, spawn } of spawns) {
    if (spawn.item === undefined) continue;
    const half = ITEM_HALF_EXTENTS[items.def(spawn.item.id).category];
    const { x, y, z } = spawn.position;
    items.place(world, entity, {
      defId: spawn.item.id,
      count: spawn.item.count,
      position: { x, y: y + half.y, z },
      rotation: spawn.rotation,
    });
    placed.push(entity);
  }
  return placed;
}
