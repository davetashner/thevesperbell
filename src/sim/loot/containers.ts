// Lootable containers (mw-e18.3): chests, barrels, bookshelves and corpses that hold things. A
// container is an entity with a `loot.container` component (its loot table, and the level and id its
// world facts are scoped to) and an inventory pack (`inventory.pack`, mw-e17.3) holding what is in it,
// so its contents are the same plain data as an actor's and persist the same way: a level delta's
// `container` aspect records the pack whenever it differs from the level as built (mw-e27.3).
//
// - Contents are a fixed list placed at spawn, plus a loot table rolled into the pack on the first
//   open and never again. The roll draws from a sub-stream of the world's `loot` stream named for the
//   container (`container:<level>/<id>`), derived from the world seed and the container's id alone,
//   so a container rolls the same loot whenever it is first opened and opening it never shifts any
//   other draw. That it has been opened is the world fact `entity:<level>/<id>.opened`, which saves
//   carry (mw-e27.4): after a reload the table is not rolled again (AC-1).
// - Take: `takeAll` and `take` move stacks into the actor's inventory with their flags (gold to the
//   gold counter); a stack the inventory refuses (a second unique, the unit guard) stays inside.
//   Quest items move too: taking one is not losing it. When a take leaves the container empty, the
//   fact `entity:<level>/<id>.looted` is set and `container.looted` fires (AC-2).
// - Put: `put` moves a stack from the actor's inventory into the container (AC-4); quest items are
//   refused (ADR-0003: only effects take them).
// - Locks: a container may carry a lock (`mechanisms.lock`, mw-e03.18), unlocked and picked through
//   the same keyring and lockpick path as a door: while it is locked, its prompt offers Unlock and
//   Pick lock instead of Search, and every open, take and put is refused with `lockRefused` reason
//   `locked`, without rolling its table (AC-3).
// - Interact: an unlocked container offers Search; Interact opens it and fires `container.searched`,
//   which the game answers with the container window (mw-e18.4). An opened, empty container's Search
//   is greyed with the reason "Empty".
// - Window actions (mw-e18.4): the window's Take, Take gold and Take All reach the sim as one
//   `loot.containerAction` command each (`containerActionCommand`), so looting is in the replay like
//   any input. Every take that moved something fires `container.taken` with what moved (the pickup
//   toasts read it); every command fires `container.action` with whether it worked and, if not, why.
//
// - Bodies (mw-e03.23): a container with a `loot.stash` (src/sim/loot/stash.ts) takes bodies up to a
//   capacity in kg. The Stash affordance is offered, ahead of Search, to an actor carrying a bulky
//   thing (a body); one over the room left is greyed "Too heavy". Stashing destroys the body
//   entity and records it in the stash, so it saves with the container.
// - Breaking (mw-e03.23): a container that breaks (`breakableBroken`) or burns away spills everything
//   it holds that tick as world pickups on a ring around it (gold as `gold`), and its stashed
//   bodies as bodies on the floor. Occupants of a hiding spot are ejected by the hiding rules.
//
// Trap (mw-e10) and ownership (e18 stolen items) hooks are later beads. The sim never imports
// content: the game passes loot tables, items and locks in.

import { breakableBroken } from '../breakables/events';
import { CarryBulkyComponent, holdOf } from '../carry/state';
import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { fireBurntOut } from '../elements/fire';
import { entityFactKey } from '../facts/store';
import {
  addAffordanceGate,
  addInteractable,
  InteractableComponent,
  interactableOf,
  interacted,
  type AffordanceGate,
} from '../interaction/system';
import type { AffordanceSpec } from '../interaction/affordance';
import {
  InventoryComponent,
  inventoryOf,
  type AddRefusal,
  type InventoryRules,
  type InventoryState,
  type ItemInstance,
} from '../inventory/inventory';
import { LockComponent, type Lock, type LockSpec } from '../mechanisms/components';
import type { WorldItemSpec } from '../items/world-items';
import { lockRefused, lockUnlocked } from '../mechanisms/events';
import { lockAffordances } from '../mechanisms/system';
import { cos, sin } from '../math';
import { readProperty } from '../properties/components';
import { placeEntity, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  containerSpilled,
  containerStashed,
  containerStashRefused,
  spawnStashedBody,
  StashComponent,
  stashRoom,
  type StashRefusal,
} from './stash';
import { LOOT_RNG_STREAM, type LootStack, type LootTables } from './tables';

/** A container (`loot.container`; a snapshot and save key, never renamed). */
export interface Container {
  /** The loot table rolled into it on its first open; null: only what it holds from the start. */
  readonly loot: string | null;
  /** The level it belongs to: its facts are `entity:<level>/<id>.*`. */
  readonly level: string;
  /** Its id in the level (a scene spawn id). */
  readonly id: string;
}

export const ContainerComponent = defineComponent<Container>('loot.container');

/** The prompt of an unlocked container: Interact opens it and takes everything. */
export const SEARCH_AFFORDANCE: AffordanceSpec = Object.freeze({ verb: 'search', label: 'Search' });

/** The prompt of a container with room for bodies, for an actor carrying one. */
export const STASH_AFFORDANCE: AffordanceSpec = Object.freeze({
  verb: 'stash',
  label: 'Stash body',
});

/** Why Stash is greyed: nothing bulky in the hands, or more than the room left. */
export const NO_BODY_REASON = 'Carry a body';
export const TOO_HEAVY_REASON = 'Too heavy';

/** Radius of the ring a spilled container drops its contents on, and how high above it, metres. */
export const SPILL_RADIUS = 0.5;
export const SPILL_HEIGHT = 0.3;

/** What a container needs to spill pickups: `WorldItems` does this. */
export interface ItemSpawner {
  spawn(world: World<never>, spec: WorldItemSpec): EntityId;
}

/** Why an opened container's Search is greyed. */
export const EMPTY_REASON = 'Empty';

/** Where a container's prompt sits above its spawn point, metres, and its focus radius. */
export const CONTAINER_ANCHOR: readonly [number, number, number] = Object.freeze([0, 0.35, 0]);
export const CONTAINER_RADIUS = 0.4;

/** How a container is placed. */
export interface ContainerSpec {
  readonly level: string;
  readonly id: string;
  /** Where it stands (its prompt sits CONTAINER_ANCHOR above). */
  readonly position: Vec3;
  /** The loot table rolled on the first open. */
  readonly loot?: string;
  /** What it holds from the start. */
  readonly contents?: readonly LootStack[];
  readonly lock?: LockSpec;
  /** Starts locked; defaults to whether it has a lock. */
  readonly locked?: boolean;
  /** Room for bodies, kg (mw-e03.23); without it the container takes none. */
  readonly stashKg?: number;
}

/** A container was opened. */
export interface ContainerOpened {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
  /** Its first open (its table, if any, was rolled). */
  readonly first: boolean;
  /** What the roll put in (empty unless `first` and it has a table). */
  readonly rolled: readonly LootStack[];
}

/** A take left a container empty. */
export interface ContainerLooted {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
  /** The fact now true, `entity:<level>/<id>.looted`. */
  readonly fact: string;
}

/** Interact's Search opened a container: the game shows its window. */
export interface ContainerSearched {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
}

/** A take moved something out of a container into an actor's inventory. */
export interface ContainerTaken {
  readonly tick: number;
  readonly entity: EntityId;
  readonly actor: EntityId;
  /** What moved, in order (gold as item `gold`). Never empty. */
  readonly moved: readonly LootStack[];
}

export const containerOpened = defineEvent<ContainerOpened>('container.opened');
export const containerLooted = defineEvent<ContainerLooted>('container.looted');
export const containerSearched = defineEvent<ContainerSearched>('container.searched');
export const containerTaken = defineEvent<ContainerTaken>('container.taken');

/** Why a container refused. */
export type ContainerRefusal =
  /** It is locked (and its table was not rolled). */
  | 'locked'
  /** No such stack in the container (take) or the actor's inventory (put). */
  | 'no-instance'
  /** Fewer units in the stack than asked for. */
  | 'not-enough'
  /** A quest item cannot be put away. */
  | 'quest-item'
  /** The receiving inventory refused the units. */
  | AddRefusal;

export type OpenResult =
  | { readonly ok: true; readonly first: boolean; readonly items: readonly ItemInstance[] }
  | { readonly ok: false; readonly reason: 'locked' };

export type MoveResult =
  | { readonly ok: true; readonly moved: readonly LootStack[] }
  | { readonly ok: false; readonly reason: ContainerRefusal };

/** The fact `fact` of a container. */
export function containerFact(container: Container, fact: 'opened' | 'looted'): string {
  return entityFactKey(container.level, container.id, fact);
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

/** Whether a pack holds nothing: no items and no gold. */
const isEmpty = (pack: InventoryState): boolean => pack.items.length === 0 && pack.gold === 0;

function lockOf(world: World<never>, entity: EntityId): Lock | undefined {
  return world.isRegistered(LockComponent) ? world.get(entity, LockComponent) : undefined;
}

/**
 * Brings a container's prompt in line with its lock (when interaction is installed): Unlock and Pick
 * lock while locked, Search otherwise. Containers call it when their lock opens; level deltas call
 * it after restoring a lock.
 */
export function refreshContainerAffordances(world: World<never>, entity: EntityId): void {
  if (!world.isRegistered(ContainerComponent) || !world.isRegistered(InteractableComponent)) return;
  if (!world.has(entity, ContainerComponent) || !world.has(entity, InteractableComponent)) return;
  const lock = lockOf(world, entity);
  const stash = world.isRegistered(StashComponent) && world.has(entity, StashComponent);
  const affordances =
    lock?.locked === true
      ? lockAffordances(lock)
      : stash
        ? [STASH_AFFORDANCE, SEARCH_AFFORDANCE]
        : [SEARCH_AFFORDANCE];
  world.set(entity, InteractableComponent, interactableOf({ affordances }));
}

/**
 * Whether container `entity` is empty: nothing inside and nothing left to roll (false for anything
 * that is not a container). Needs containers installed.
 */
export function containerEmpty(world: World<never>, entity: EntityId): boolean {
  const container = world.get(entity, ContainerComponent);
  if (container === undefined) return false;
  if (!isEmpty(known(world.get(entity, InventoryComponent)))) return false; // it has one
  return container.loot === null || world.facts.get(containerFact(container, 'opened')) === true;
}

/** Container rules: the inventory items move through and the loot tables containers roll. */
export class Containers {
  readonly inventory: InventoryRules;
  readonly loot: LootTables;
  readonly #classOf: (world: World<never>, actor: EntityId) => string | undefined;
  readonly #items: ItemSpawner | undefined;

  /**
   * `classOf`: the opener's class, which class-conditioned loot entries read (mw-e19); none: those
   * entries never drop. `items`: what spills a broken container's contents as pickups; none: they
   * are lost with it.
   */
  constructor(
    inventory: InventoryRules,
    loot: LootTables,
    options: {
      readonly classOf?: (world: World<never>, actor: EntityId) => string | undefined;
      readonly items?: ItemSpawner;
    } = {},
  ) {
    this.inventory = inventory;
    this.loot = loot;
    this.#classOf = options.classOf ?? (() => undefined);
    this.#items = options.items;
  }

  /**
   * Makes `entity` a container (see the file header): its pack with `contents`, its lock, and its
   * prompt (when interaction is installed). Call between steps, with containers installed (and
   * mechanisms, for a lock).
   * @throws RangeError for an unknown item in `contents`.
   */
  make(world: World<never>, entity: EntityId, spec: ContainerSpec): void {
    world.add(entity, ContainerComponent, {
      loot: spec.loot ?? null,
      level: spec.level,
      id: spec.id,
    });
    world.add(entity, InventoryComponent, { gold: 0, nextInstanceId: 1, items: [] });
    for (const { item, count } of spec.contents ?? []) this.#store(world, entity, item, count);
    const { lock } = spec;
    if (lock !== undefined) {
      const { id, ...rest } = lock;
      world.add(entity, LockComponent, {
        ...rest,
        tags: [...rest.tags],
        lock: id,
        locked: spec.locked ?? true,
      });
    }
    if (spec.stashKg !== undefined) {
      world.add(entity, StashComponent, { capacityKg: spec.stashKg, bodies: [] });
    }
    if (world.isRegistered(InteractableComponent)) {
      addInteractable(
        world,
        entity,
        { affordances: [SEARCH_AFFORDANCE], anchor: CONTAINER_ANCHOR, radius: CONTAINER_RADIUS },
        spec.position,
      );
      refreshContainerAffordances(world, entity);
    } else {
      const [ax, ay, az] = CONTAINER_ANCHOR;
      const { x, y, z } = spec.position;
      placeEntity(world, entity, { x: x + ax, y: y + ay, z: z + az }, CONTAINER_RADIUS);
    }
  }

  /**
   * `actor` opens `entity`. The first open rolls its loot table into it (once: the `opened` fact
   * remembers) and fires `container.opened`; later opens only fire it. A locked container refuses
   * with `lockRefused` reason `locked` and rolls nothing.
   * @throws RangeError when `entity` is not a container.
   */
  open(world: World<never>, entity: EntityId, actor: EntityId): OpenResult {
    const container = this.#container(world, entity);
    const lock = lockOf(world, entity);
    if (lock?.locked === true) {
      world.events.emit(lockRefused, {
        tick: world.tick,
        entity,
        lock: lock.lock,
        reason: 'locked',
        hint: lock.hint,
        source: actor,
      });
      return { ok: false, reason: 'locked' };
    }
    const opened = containerFact(container, 'opened');
    const first = world.facts.get(opened) !== true;
    let rolled: readonly LootStack[] = [];
    if (first) {
      world.facts.set(opened, true);
      if (container.loot !== null) rolled = this.#roll(world, entity, actor, container.loot);
    }
    world.events.emit(containerOpened, { tick: world.tick, entity, actor, first, rolled });
    return { ok: true, first, items: this.#pack(world, entity).items };
  }

  /**
   * Why container `entity` would refuse `body` (a carried, bulky thing) from `actor`, or undefined.
   * Reads only: the prompt's gate asks it too.
   */
  stashRefusal(world: World<never>, entity: EntityId, body: EntityId): StashRefusal | undefined {
    const stash = world.isRegistered(StashComponent)
      ? world.get(entity, StashComponent)
      : undefined;
    if (stash === undefined) return 'no-stash';
    if (lockOf(world, entity)?.locked === true) return 'locked';
    if (!world.has(body, CarryBulkyComponent)) return 'not-a-body';
    return readProperty(world, body, 'weight') > stashRoom(stash) ? 'too-heavy' : undefined;
  }

  /**
   * `actor` puts the body `body` into container `entity`: the body is destroyed and recorded in the
   * stash (it saves with the container). Refused, changing nothing, with `container.stashRefused`,
   * when `stashRefusal` says so.
   * @throws RangeError when `entity` is not a container.
   */
  stash(
    world: World<never>,
    entity: EntityId,
    actor: EntityId,
    body: EntityId,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: StashRefusal } {
    this.#container(world, entity);
    const reason = this.stashRefusal(world, entity, body);
    if (reason !== undefined) {
      world.events.emit(containerStashRefused, { tick: world.tick, entity, actor, reason });
      return { ok: false, reason };
    }
    const stash = known(world.get(entity, StashComponent)); // stashRefusal found it
    const record = {
      kind: known(world.get(body, CarryBulkyComponent)).kind,
      weight: readProperty(world, body, 'weight'),
    };
    world.set(entity, StashComponent, { ...stash, bodies: [...stash.bodies, record] });
    world.destroy(body);
    world.events.emit(containerStashed, { tick: world.tick, entity, actor, body: record });
    return { ok: true };
  }

  /**
   * Spills everything `entity` holds around it: its stacks and gold as world pickups, its stashed
   * bodies as bodies, all on a ring above its place (what a break or a burn-out does). Needs an item
   * spawner (without one the items are lost with the container) and a placement.
   */
  spill(world: World<never>, entity: EntityId): void {
    const at = placementOf(world, entity);
    const pack = inventoryOf(world, entity);
    const stash = world.isRegistered(StashComponent)
      ? world.get(entity, StashComponent)
      : undefined;
    if (at === undefined || pack === undefined) return;
    const stacks: LootStack[] = pack.items.map(({ defId, count }) => ({ item: defId, count }));
    if (pack.gold > 0) stacks.push({ item: 'gold', count: pack.gold });
    const bodies = stash?.bodies ?? [];
    const total = stacks.length + bodies.length;
    if (total === 0) return;
    const spawned: EntityId[] = [];
    const where = (i: number) => {
      const angle = (2 * Math.PI * i) / total;
      return {
        x: at.x + SPILL_RADIUS * cos(angle),
        y: at.y + SPILL_HEIGHT,
        z: at.z + SPILL_RADIUS * sin(angle),
      };
    };
    const items = this.#items;
    if (items !== undefined) {
      stacks.forEach(({ item, count }, i) => {
        spawned.push(items.spawn(world, { defId: item, count, position: where(i) }));
      });
    }
    bodies.forEach((body, i) => {
      spawned.push(spawnStashedBody(world, body, where(stacks.length + i)));
    });
    // Emptied, so nothing is spilled twice (a break and a burn-out in one tick).
    world.set(entity, InventoryComponent, { ...pack, gold: 0, items: [] });
    if (stash !== undefined) world.set(entity, StashComponent, { ...stash, bodies: [] });
    world.events.emit(containerSpilled, {
      tick: world.tick,
      entity,
      spawned,
      bodies: bodies.length,
    });
  }

  /**
   * `actor` opens `entity` and takes everything it can: every stack (in order) and the gold. A stack
   * the actor's inventory refuses stays inside. Refused only while locked.
   * @throws RangeError when `entity` is not a container or `actor` has no inventory.
   */
  takeAll(world: World<never>, entity: EntityId, actor: EntityId): MoveResult {
    const open = this.open(world, entity, actor);
    if (!open.ok) return open;
    const moved: LootStack[] = [...this.#moveGold(world, entity, actor)];
    for (const { instanceId, defId, count } of open.items) {
      if (this.#transfer(world, entity, actor, instanceId, count) === undefined) {
        moved.push({ item: defId, count });
      }
    }
    this.#takenBy(world, entity, actor, moved);
    return { ok: true, moved };
  }

  /**
   * `actor` opens `entity` and takes the gold in it (moved is empty when there is none). Refused
   * only while locked.
   * @throws RangeError when `entity` is not a container or `actor` has no inventory.
   */
  takeGold(world: World<never>, entity: EntityId, actor: EntityId): MoveResult {
    const open = this.open(world, entity, actor);
    if (!open.ok) return open;
    const moved = this.#moveGold(world, entity, actor);
    this.#takenBy(world, entity, actor, moved);
    return { ok: true, moved };
  }

  /** Moves all of `entity`'s gold to `actor`: what moved (nothing when it has none). */
  #moveGold(world: World<never>, entity: EntityId, actor: EntityId): LootStack[] {
    const { gold } = this.#pack(world, entity);
    if (gold === 0) return [];
    this.inventory.spendGold(world, entity, gold);
    this.inventory.addGold(world, actor, gold);
    return [{ item: 'gold', count: gold }];
  }

  /**
   * `actor` opens `entity` and takes `count` units (default: all) of its stack `instanceId`.
   * @throws RangeError when `entity` is not a container, `actor` has no inventory or `count` is bad.
   */
  take(
    world: World<never>,
    entity: EntityId,
    actor: EntityId,
    instanceId: number,
    count?: number,
  ): MoveResult {
    const open = this.open(world, entity, actor);
    if (!open.ok) return open;
    const result = this.#move(world, entity, actor, instanceId, count);
    if (result.ok) this.#takenBy(world, entity, actor, result.moved);
    return result;
  }

  /**
   * `actor` opens `entity` and puts `count` units (default: all) of its own stack `instanceId` in.
   * Quest items are refused.
   * @throws RangeError when `entity` is not a container, `actor` has no inventory or `count` is bad.
   */
  put(
    world: World<never>,
    entity: EntityId,
    actor: EntityId,
    instanceId: number,
    count?: number,
  ): MoveResult {
    const open = this.open(world, entity, actor);
    if (!open.ok) return open;
    const instance = inventoryOf(world, actor)?.items.find((i) => i.instanceId === instanceId);
    if (instance !== undefined && this.inventory.def(instance.defId).flags.questItem) {
      return { ok: false, reason: 'quest-item' };
    }
    return this.#move(world, actor, entity, instanceId, count);
  }

  /** Moves units of `from`'s stack `instanceId` to `to`, checking the stack and count first. */
  #move(
    world: World<never>,
    from: EntityId,
    to: EntityId,
    instanceId: number,
    count: number | undefined,
  ): MoveResult {
    const instance = inventoryOf(world, from)?.items.find((i) => i.instanceId === instanceId);
    if (instance === undefined) return { ok: false, reason: 'no-instance' };
    const units = count ?? instance.count;
    if (!Number.isSafeInteger(units) || units < 1) {
      throw new RangeError(`count must be a positive integer, got ${String(units)}`);
    }
    if (units > instance.count) return { ok: false, reason: 'not-enough' };
    const refused = this.#transfer(world, from, to, instanceId, units);
    if (refused !== undefined) return { ok: false, reason: refused };
    return { ok: true, moved: [{ item: instance.defId, count: units }] };
  }

  /**
   * Adds the units to `to` with the stack's flags, then takes them from `from` (forced: moving a
   * quest item is not losing it). Returns the add's refusal, when `to` refused them.
   */
  #transfer(
    world: World<never>,
    from: EntityId,
    to: EntityId,
    instanceId: number,
    count: number,
  ): AddRefusal | undefined {
    const instance = this.#pack(world, from).items.find((i) => i.instanceId === instanceId);
    const { defId, flags } = known(instance); // callers found it
    const added = this.inventory.add(world, to, defId, count, flags);
    if (!added.ok) return added.reason;
    this.inventory.remove(world, from, { instanceId, count, force: true });
    return undefined;
  }

  /**
   * After a take: fires `container.taken` when something moved, then sets the looted fact and fires
   * `container.looted` when the take left `entity` empty.
   */
  #takenBy(
    world: World<never>,
    entity: EntityId,
    actor: EntityId,
    moved: readonly LootStack[],
  ): void {
    if (moved.length > 0) {
      world.events.emit(containerTaken, { tick: world.tick, entity, actor, moved });
    }
    if (!isEmpty(this.#pack(world, entity))) return;
    const fact = containerFact(this.#container(world, entity), 'looted');
    world.facts.set(fact, true);
    world.events.emit(containerLooted, { tick: world.tick, entity, actor, fact });
  }

  /** Rolls `table` into container `entity` from the container's own sub-stream of the loot stream. */
  #roll(
    world: World<never>,
    entity: EntityId,
    actor: EntityId,
    table: string,
  ): readonly LootStack[] {
    const { level, id } = this.#container(world, entity);
    const rng = world.random(LOOT_RNG_STREAM).stream(`container:${level}/${id}`);
    const classId = this.#classOf(world, actor);
    const { stacks } = this.loot.roll(
      table,
      rng,
      { facts: world.facts, ...(classId !== undefined && { classId }) },
      world,
    );
    return stacks.filter(({ item, count }) => this.#store(world, entity, item, count));
  }

  /** Puts units into a container's pack (currency into its gold); false when the pack refused them. */
  #store(world: World<never>, entity: EntityId, item: string, count: number): boolean {
    if (this.inventory.def(item).category === 'currency') {
      this.inventory.addGold(world, entity, count);
      return true;
    }
    return this.inventory.add(world, entity, item, count).ok;
  }

  #container(world: World<never>, entity: EntityId): Container {
    const container = world.get(entity, ContainerComponent);
    if (container === undefined) {
      throw new RangeError(`entity ${String(entity)} is not a container`);
    }
    return container;
  }

  #pack(world: World<never>, entity: EntityId): InventoryState {
    return known(world.get(entity, InventoryComponent)); // every container has one
  }
}

/** One container window action (mw-e18.4). */
export type ContainerAction =
  | { readonly op: 'take-all' }
  | { readonly op: 'take'; readonly instanceId: number; readonly count?: number }
  | { readonly op: 'take-gold' };

/** The command carrying a container window action. */
export const CONTAINER_ACTION_COMMAND = 'loot.containerAction' as const;

export interface ContainerActionCommand {
  readonly kind: typeof CONTAINER_ACTION_COMMAND;
  readonly actor: EntityId;
  /** The container. */
  readonly entity: EntityId;
  readonly action: ContainerAction;
}

/** A container action command was carried out, or refused. */
export interface ContainerActionDone {
  readonly tick: number;
  readonly actor: EntityId;
  readonly entity: EntityId;
  readonly action: ContainerAction;
  readonly ok: boolean;
  /** Why it was refused (absent when it happened). */
  readonly reason?: ContainerRefusal;
}

export const containerActionDone = defineEvent<ContainerActionDone>('container.action');

const checkPositive = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
};

/**
 * A command carrying `action` on container `entity` for `actor`.
 * @throws RangeError for a bad instance id or count.
 */
export function containerActionCommand(
  actor: EntityId,
  entity: EntityId,
  action: ContainerAction,
): ContainerActionCommand {
  if (action.op === 'take') {
    checkPositive('instance id', action.instanceId);
    if (action.count !== undefined) checkPositive('count', action.count);
  }
  return { kind: CONTAINER_ACTION_COMMAND, actor, entity, action };
}

/** Whether `input` is a container action command. */
export function isContainerActionCommand(input: unknown): input is ContainerActionCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === CONTAINER_ACTION_COMMAND
  );
}

/** Carries out one container action through `containers`. */
function applyContainerAction(
  containers: Containers,
  world: World<never>,
  { actor, entity, action }: ContainerActionCommand,
): MoveResult {
  switch (action.op) {
    case 'take-all':
      return containers.takeAll(world, entity, actor);
    case 'take-gold':
      return containers.takeGold(world, entity, actor);
    case 'take':
      return containers.take(world, entity, actor, action.instanceId, action.count);
  }
}

/**
 * Carries out this tick's container action commands, in command order, and fires `container.action`
 * for each. A command whose container is gone (or never was one) or whose actor has no inventory is
 * skipped. `active`: false once the containers are uninstalled.
 */
export function containerActionsSystem<TInput>(
  containers: Containers,
  active: () => boolean,
): System<TInput> {
  return {
    name: 'containerActions',
    run({ world, inputs }) {
      if (!active()) return;
      const sim = world as unknown as World<never>; // container actions never read world inputs
      for (const input of inputs as readonly unknown[]) {
        if (!isContainerActionCommand(input)) continue;
        if (!sim.has(input.entity, ContainerComponent)) continue;
        if (inventoryOf(sim, input.actor) === undefined) continue;
        const result = applyContainerAction(containers, sim, input);
        sim.events.emit(containerActionDone, {
          tick: sim.tick,
          actor: input.actor,
          entity: input.entity,
          action: input.action,
          ...(result.ok ? { ok: true } : { ok: false, reason: result.reason }),
        });
      }
    },
  };
}

/** The body `actor` carries, if it is a bulky thing. */
function carriedBody(world: World<never>, actor: EntityId): EntityId | undefined {
  const hold = holdOf(world, actor);
  return hold !== undefined && world.has(hold.target, CarryBulkyComponent)
    ? hold.target
    : undefined;
}

/**
 * The gate that greys an opened, empty container's Search with EMPTY_REASON, and a container's Stash
 * unless the actor carries a body that fits.
 */
const containerGate =
  (containers: Containers): AffordanceGate =>
  (world, actor, target, affordance) => {
    if (affordance.verb === 'stash') {
      const body = carriedBody(world, actor);
      if (body === undefined) return NO_BODY_REASON;
      return containers.stashRefusal(world, target, body) === 'too-heavy'
        ? TOO_HEAVY_REASON
        : undefined;
    }
    return affordance.verb === 'search' && containerEmpty(world, target) ? EMPTY_REASON : undefined;
  };

/**
 * Sets up containers in `world`: registers `loot.container` (and the inventory component if it is
 * not yet), opens a container on Interact's Search (`container.searched`), carries out container
 * action commands each step, greys an empty container's Search, and brings a container's prompt up
 * to date when its lock opens. For locked containers install mechanisms first
 * (they unlock and pick locks); for prompts, interaction. Call once at setup, between steps. Returns
 * a function that removes the subscriptions.
 */
export function installContainers<TInput>(
  world: World<TInput>,
  containers: Containers,
): () => void {
  const sim: World<never> = world;
  world.register(ContainerComponent, StashComponent);
  if (!world.isRegistered(InventoryComponent)) world.register(InventoryComponent);
  // A stashed body comes back bulky (carrying installs the marker too, whichever comes first).
  if (!world.isRegistered(CarryBulkyComponent)) world.register(CarryBulkyComponent);
  let active = true;
  world.addSystem(containerActionsSystem(containers, () => active));
  const offs = [
    addAffordanceGate(world, containerGate(containers)),
    world.events.on(interacted, ({ actor, target, verb }) => {
      if (!sim.has(target, ContainerComponent)) return;
      if (verb === 'stash') {
        const body = carriedBody(sim, actor);
        if (body !== undefined) containers.stash(sim, target, actor, body);
        return;
      }
      if (verb !== 'search') return;
      if (inventoryOf(sim, actor) === undefined) return;
      if (!containers.open(sim, target, actor).ok) return;
      world.events.emit(containerSearched, { tick: world.tick, entity: target, actor });
    }),
    world.events.on(lockUnlocked, ({ entity }) => {
      refreshContainerAffordances(sim, entity);
    }),
    // A container that breaks or burns away spills what it holds the same tick (mw-e03.23).
    world.events.on(breakableBroken, ({ entity }) => {
      if (active && sim.has(entity, ContainerComponent)) containers.spill(sim, entity);
    }),
    world.events.on(fireBurntOut, ({ entity, becomes }) => {
      if (active && becomes === null && sim.has(entity, ContainerComponent)) {
        containers.spill(sim, entity);
      }
    }),
  ];
  return () => {
    active = false;
    for (const off of offs) off();
  };
}

/** A scene spawn that may be a container, and its entity (as `LoadedScene.spawns` lists them). */
export interface ContainerSpawnEntity {
  readonly entity: EntityId;
  readonly spawn: {
    readonly id: string;
    readonly position: Vec3;
    readonly container?:
      | {
          readonly loot?: string;
          readonly contents: readonly LootStack[];
          readonly lock?: string;
          readonly locked?: boolean;
          readonly stashKg?: number;
        }
      | undefined;
  };
}

/**
 * Makes every loaded spawn of `level` that declares a container that container, with its lock from
 * `locks`. Call between steps, with containers installed. Returns those entities, in scene order.
 * @throws RangeError for an unknown lock or item.
 */
export function addSceneContainers(
  world: World<never>,
  containers: Containers,
  level: string,
  spawns: readonly ContainerSpawnEntity[],
  locks: (id: string) => LockSpec | undefined,
): EntityId[] {
  const made: EntityId[] = [];
  for (const { entity, spawn } of spawns) {
    const own = spawn.container;
    if (own === undefined) continue;
    let lock: LockSpec | undefined;
    if (own.lock !== undefined) {
      lock = locks(own.lock);
      if (lock === undefined) throw new RangeError(`unknown lock "${own.lock}"`);
    }
    containers.make(world, entity, {
      level,
      id: spawn.id,
      position: spawn.position,
      contents: own.contents,
      ...(own.loot !== undefined && { loot: own.loot }),
      ...(lock !== undefined && { lock }),
      ...(own.locked !== undefined && { locked: own.locked }),
      ...(own.stashKg !== undefined && { stashKg: own.stashKg }),
    });
    made.push(entity);
  }
  return made;
}
