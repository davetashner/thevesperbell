// Consumables and quick slots (mw-e17.6): drinking a draught, throwing an oil flask, coating a blade,
// fast enough to do mid-fight. One use pipeline for every consumable, wherever the use comes from (a
// quick slot now, the inventory screen in mw-e17.10):
//
//   validate → apply the use effects → consume one unit → emit `item.used`.
//
// - Validate: the item is a consumable whose every effect this module can apply, the actor is not
//   use-locked (`busy`), and each effect can happen (a throw needs somewhere to throw from and an item
//   that may leave the pack; a coating needs a weapon in the main hand). A refusal emits
//   `item.useRefused` and changes nothing: no unit is spent, no lock is set.
// - Effects are the item's data (`use` in src/content/data/item/<id>.json), never per-item code
//   (contract §5, properties not pairings): `restore` refills a pool (health, stamina; mana once the
//   spell pipeline gives actors one, e06), `status` puts a timed status on the user, `coat` makes the
//   main-hand weapon carry world properties for a time (oil: flammable), and `throw` emits a spawn
//   request carrying the item's world properties exactly. `installConsumables` turns that request
//   into a world item through the world-item throw path (mw-e17.7): a thrown oil flask is a flammable
//   liquid wherever it lands, and the e03 fire rules do the rest.
// - Consume: one unit of the used instance leaves the inventory (`item.removed`).
// - Use lock: every use locks the user for `lockSeconds` (DEFAULT_USE_LOCK_SECONDS, the drink or
//   throw animation), and an optional `busy` hook (an attack in progress, a stagger) locks it too. A
//   use asked for while locked is refused with `busy`.
//
// Quick slots: four per actor, each bound to one inventory instance of a definition. Using a slot
// uses its instance; when that stack is gone (used up, dropped, thrown) the slot refills from the
// first other stack of the same definition in acquisition order, and when there is none the slot
// keeps its definition and reports itself depleted until more arrive. Every rebind and depletion
// emits `quickSlot.changed`. Slots and the lock are plain data on the actor (`item.quickSlots`), so
// snapshots, replays and saves (mw-e17.8) carry them like any component. The HUD that draws them is
// the inventory UI's (mw-e17.10); nothing here draws.

import { HealthComponent } from '../combat/damage/components';
import { fromUnits, toUnits } from '../combat/damage/types';
import { STAMINA_QUANTA_PER_POINT, StaminaComponent } from '../combat/stamina';
import { defineComponent, type ComponentType, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { actionFrameOf, type ActionButton } from '../input/action-frame';
import { equipmentOf, type EquippedRef } from '../inventory/equipment';
import { inventoryOf, type ItemInstance, type ItemInstanceFlags } from '../inventory/inventory';
import type { WorldPropertyInit } from '../properties/components';
import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';
import {
  handlerView,
  itemDropped,
  throwLaunch,
  WorldItems,
  type ItemHandlerView,
  type WorldItemDef,
} from './world-items';

/** Quick slots per actor. */
export const QUICK_SLOT_COUNT = 4;

/** How long a use locks its user (drinking, throwing), seconds. */
export const DEFAULT_USE_LOCK_SECONDS = 0.5;

/** The pools a consumable can restore (content's ITEM_POOLS). */
export type ItemPool = 'health' | 'stamina' | 'mana';

/** A use effect, as item data writes it (content's `use`, mw-e17.2). */
export type UseEffect =
  | { readonly op: 'restore'; readonly pool: ItemPool; readonly amount: number }
  | { readonly op: 'status'; readonly status: string; readonly seconds: number }
  | { readonly op: 'coat'; readonly properties: WorldPropertyInit; readonly seconds: number }
  | { readonly op: 'throw' }
  /** Progression's effects (a boon step, learning): not applied by using a consumable. */
  | { readonly op: 'stat-step' | 'learn' };

/** What consumables read from an item definition; a loaded item, mapped by the game, is one. */
export interface ConsumableDef extends WorldItemDef {
  readonly use?: readonly UseEffect[] | undefined;
}

/** Adds up to `amount` points to `actor`'s pool; returns the points actually restored. */
export type PoolRestorer = (world: World<never>, actor: EntityId, amount: number) => number;

/** Heals `actor` (`combat.health`), never past max and never the dead (0 stays 0). */
export const restoreHealth: PoolRestorer = (world, actor, amount) => {
  const health = world.isRegistered(HealthComponent)
    ? world.get(actor, HealthComponent)
    : undefined;
  if (health === undefined || health.current === 0) return 0;
  const before = toUnits(health.current);
  const after = Math.min(toUnits(health.max), before + toUnits(amount));
  if (after === before) return 0;
  world.set(actor, HealthComponent, Object.freeze({ ...health, current: fromUnits(after) }));
  return fromUnits(after - before);
};

/**
 * Refills `actor`'s stamina (`combat.stamina`), never past max. The regen pause is untouched, and the
 * stamina system ends exhaustion on its next tick if the pool is back over the recovery threshold.
 */
export const restoreStamina: PoolRestorer = (world, actor, amount) => {
  const pool = world.isRegistered(StaminaComponent)
    ? world.get(actor, StaminaComponent)
    : undefined;
  if (pool === undefined) return 0;
  const q = STAMINA_QUANTA_PER_POINT;
  const before = Math.round(pool.current * q);
  const after = Math.min(Math.round(pool.profile.max * q), before + Math.round(amount * q));
  if (after === before) return 0;
  world.set(actor, StaminaComponent, Object.freeze({ ...pool, current: after / q }));
  return (after - before) / q;
};

/** The pools restored by default. Mana joins when actors have a mana pool (e06). */
export const DEFAULT_POOLS: Readonly<Partial<Record<ItemPool, PoolRestorer>>> = Object.freeze({
  health: restoreHealth,
  stamina: restoreStamina,
});

/** One quick slot: the definition it holds and the stack it uses, or null once depleted. */
export interface QuickSlot {
  readonly defId: string;
  readonly instanceId: number | null;
}

/** An actor's quick slots and use lock (`item.quickSlots`; a snapshot and save key). */
export interface QuickSlotsState {
  /** QUICK_SLOT_COUNT entries; null = nothing assigned. */
  readonly slots: readonly (QuickSlot | null)[];
  /** The first tick on which the actor may use an item again. */
  readonly busyUntil: number;
}

export const QuickSlotsComponent = defineComponent<QuickSlotsState>('item.quickSlots');

/** A timed status on an actor. */
export interface ActiveStatus {
  readonly id: string;
  /** The first tick it no longer holds. */
  readonly until: number;
}

/** Statuses consumables put on an actor (`item.statuses`), in the order first applied. */
export const StatusesComponent = defineComponent<readonly ActiveStatus[]>('item.statuses');

/** A coating on an actor's main-hand weapon. */
export interface WeaponCoating {
  /** The weapon it is on; it lapses when that weapon leaves the main hand. */
  readonly weapon: EquippedRef;
  /** World properties the weapon's strikes carry (combat reads them, e04). */
  readonly properties: WorldPropertyInit;
  /** The first tick it no longer holds. */
  readonly until: number;
}

/** The coating on an actor's weapon (`item.coating`). */
export const CoatingComponent = defineComponent<WeaponCoating>('item.coating');

/** Why a use was refused (nothing changed). */
export type UseRefusal =
  /** The use lock or the busy hook is holding the actor. */
  | 'busy'
  /** The quick slot's item has no units left. */
  | 'depleted'
  /** Nothing is assigned to the quick slot. */
  | 'empty-slot'
  /** No instance with that id. */
  | 'no-instance'
  /** Not a consumable, or it has an effect using it cannot apply. */
  | 'not-usable'
  /** A throw of an item that may not leave the pack (noDrop). */
  | 'no-drop'
  /** A throw with nowhere to throw from (no position or look). */
  | 'no-view'
  /** A coating with no weapon in the main hand. */
  | 'no-weapon';

export type UseResult =
  | { readonly ok: true; readonly instanceId: number }
  | { readonly ok: false; readonly reason: UseRefusal };

/** An actor used one unit of a consumable. */
export interface ItemUsed {
  readonly tick: number;
  readonly actor: EntityId;
  readonly defId: string;
  /** The instance the unit came from (gone when that was its last unit). */
  readonly instanceId: number;
  /** The quick slot it was used from, or null. */
  readonly slot: number | null;
  /** The effects applied, as data. */
  readonly effects: readonly UseEffect[];
  /** Points each restored pool actually gained (0 at full, or for a pool the actor lacks). */
  readonly restored: Readonly<Partial<Record<ItemPool, number>>>;
  /** Units of the definition left in the pack. */
  readonly remaining: number;
}

/** A use that was refused. */
export interface ItemUseRefused {
  readonly tick: number;
  readonly actor: EntityId;
  /** The item asked for, or null when there was none (an empty slot, an unknown instance). */
  readonly defId: string | null;
  readonly slot: number | null;
  readonly reason: UseRefusal;
}

/** A thrown consumable to spawn: one unit carrying the item's world properties exactly. */
export interface ItemSpawnRequest {
  readonly tick: number;
  readonly actor: EntityId;
  readonly defId: string;
  readonly flags: ItemInstanceFlags;
  /** The item's `worldProperties`, unchanged. */
  readonly worldProperties: WorldPropertyInit;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly velocity: Vec3;
}

/** A quick slot was rebound to another stack, or depleted (instanceId null). */
export interface QuickSlotChanged {
  readonly tick: number;
  readonly actor: EntityId;
  readonly slot: number;
  readonly defId: string;
  readonly instanceId: number | null;
}

export const itemUsed = defineEvent<ItemUsed>('item.used');
export const itemUseRefused = defineEvent<ItemUseRefused>('item.useRefused');
export const itemSpawnRequested = defineEvent<ItemSpawnRequest>('item.spawnRequested');
export const quickSlotChanged = defineEvent<QuickSlotChanged>('quickSlot.changed');

/**
 * Gives `actor` empty quick slots and no use lock, and registers the components using items writes
 * (statuses, coatings). Call once, at install (like addInventory): adding them is structural, so
 * during a step a first status or coating lands at the end of the tick.
 */
export function addQuickSlots(world: World<never>, actor: EntityId): void {
  for (const type of [QuickSlotsComponent, StatusesComponent, CoatingComponent] as const) {
    if (!world.isRegistered(type)) world.register(type);
  }
  world.add(actor, QuickSlotsComponent, {
    slots: Array<QuickSlot | null>(QUICK_SLOT_COUNT).fill(null),
    busyUntil: 0,
  });
}

/** `actor`'s quick slots, or undefined when it has none. */
export function quickSlotsOf(world: World<never>, actor: EntityId): QuickSlotsState | undefined {
  return world.isRegistered(QuickSlotsComponent)
    ? world.get(actor, QuickSlotsComponent)
    : undefined;
}

/** The statuses holding on `actor` now, in the order first applied. */
export function statusesOf(world: World<never>, actor: EntityId): readonly ActiveStatus[] {
  const all = world.isRegistered(StatusesComponent) ? world.get(actor, StatusesComponent) : [];
  return (all ?? []).filter((status) => status.until > world.tick);
}

/** Whether status `id` holds on `actor` now. */
export function hasStatus(world: World<never>, actor: EntityId, id: string): boolean {
  return statusesOf(world, actor).some((status) => status.id === id);
}

/** `def`'s use effects (none when it has no use). */
const effectsOf = (def: ConsumableDef): readonly UseEffect[] => def.use ?? [];

/** `actor`'s inventory instance `instanceId`, or undefined. */
function instanceOf(world: World<never>, actor: EntityId, instanceId: number) {
  return inventoryOf(world, actor)?.items.find((item) => item.instanceId === instanceId);
}

/** Replaces `actor`'s `type` value, or adds it (deferred during a step) when it has none. */
function setOrAdd<T>(world: World<never>, actor: EntityId, type: ComponentType<T>, value: T): void {
  if (world.has(actor, type)) world.set(actor, type, value);
  else world.add(actor, type, value);
}

/** The main-hand weapon `actor` holds, or undefined. */
function mainHand(world: World<never>, actor: EntityId): EquippedRef | undefined {
  return equipmentOf(world, actor)?.slots['main-hand'] ?? undefined;
}

/**
 * The coating on `actor`'s weapon now: undefined when there is none, it has run out, or its weapon
 * is no longer in the main hand.
 */
export function coatingOf(world: World<never>, actor: EntityId): WeaponCoating | undefined {
  const coating = world.isRegistered(CoatingComponent)
    ? world.get(actor, CoatingComponent)
    : undefined;
  if (coating === undefined || coating.until <= world.tick) return undefined;
  return mainHand(world, actor)?.instanceId === coating.weapon.instanceId ? coating : undefined;
}

/** What a quick slot shows: its item, the units of it held, and whether it is depleted. */
export interface QuickSlotView {
  readonly defId: string;
  readonly count: number;
  readonly depleted: boolean;
}

/** The command that uses a quick slot (until the game binds buttons to the slots). */
export const USE_QUICK_SLOT_COMMAND = 'item.useQuickSlot' as const;

export interface UseQuickSlotCommand {
  readonly kind: typeof USE_QUICK_SLOT_COMMAND;
  readonly actor: EntityId;
  /** 0 … QUICK_SLOT_COUNT − 1. */
  readonly slot: number;
}

function checkSlot(slot: number): void {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= QUICK_SLOT_COUNT) {
    throw new RangeError(
      `quick slot must be 0–${String(QUICK_SLOT_COUNT - 1)}, got ${String(slot)}`,
    );
  }
}

/** A command using `actor`'s quick slot `slot`. @throws RangeError for a bad slot. */
export function useQuickSlotCommand(actor: EntityId, slot: number): UseQuickSlotCommand {
  checkSlot(slot);
  return { kind: USE_QUICK_SLOT_COMMAND, actor, slot };
}

/** Whether `input` is a quick-slot command. */
export function isUseQuickSlotCommand(input: unknown): input is UseQuickSlotCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === USE_QUICK_SLOT_COMMAND
  );
}

export interface ConsumablesOptions {
  /** The world-item rules (over the same definitions); defaults to `new WorldItems(items)`. */
  readonly items?: WorldItems;
  /** Pool → how to restore it; defaults to DEFAULT_POOLS. A pool not listed restores nothing. */
  readonly pools?: Readonly<Partial<Record<ItemPool, PoolRestorer>>>;
  /** How long using `def` locks its user, seconds; defaults to DEFAULT_USE_LOCK_SECONDS. */
  readonly lockSeconds?: (def: ConsumableDef) => number;
  /** Another lock on using items (an attack or a stagger in progress); defaults to never. */
  readonly busy?: (world: World<never>, actor: EntityId) => boolean;
  /** Where `actor` throws from and looks; defaults to `handlerView` (the player's). */
  readonly view?: (world: World<never>, actor: EntityId) => ItemHandlerView | undefined;
}

/** Where a use comes from. */
interface UseSource {
  readonly slot: number | null;
}

/** The consumable rules over a set of item definitions (see the file header). */
export class Consumables {
  readonly items: WorldItems;
  readonly #defs: ReadonlyMap<string, ConsumableDef>;
  readonly #pools: Readonly<Partial<Record<ItemPool, PoolRestorer>>>;
  readonly #lockSeconds: (def: ConsumableDef) => number;
  readonly #busy: (world: World<never>, actor: EntityId) => boolean;
  readonly #view: (world: World<never>, actor: EntityId) => ItemHandlerView | undefined;

  /** `items`: every item definition (the content registry's); `items` must share them. */
  constructor(items: Iterable<ConsumableDef>, options: ConsumablesOptions = {}) {
    const defs = [...items];
    this.items = options.items ?? new WorldItems(defs);
    this.#defs = new Map(defs.map((def) => [def.id, def]));
    this.#pools = options.pools ?? DEFAULT_POOLS;
    this.#lockSeconds = options.lockSeconds ?? (() => DEFAULT_USE_LOCK_SECONDS);
    this.#busy = options.busy ?? (() => false);
    this.#view = options.view ?? handlerView;
  }

  /** The definition of `defId`. @throws RangeError for an id it does not know. */
  def(defId: string): ConsumableDef {
    const def = this.#defs.get(defId);
    if (def === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return def;
  }

  /** Whether `def` is a consumable that using can apply in full. */
  usable(def: ConsumableDef): boolean {
    const use = effectsOf(def);
    return (
      def.category === 'consumable' &&
      use.length > 0 &&
      use.every((effect) => effect.op !== 'stat-step' && effect.op !== 'learn')
    );
  }

  /**
   * Binds quick slot `slot` to instance `instanceId`. Returns false, changing nothing, for an
   * unknown instance or an item that is not usable.
   * @throws RangeError for a bad slot or an actor without quick slots.
   */
  assign(world: World<never>, actor: EntityId, slot: number, instanceId: number): boolean {
    checkSlot(slot);
    const state = this.#slots(world, actor);
    const instance = instanceOf(world, actor, instanceId);
    if (instance === undefined || !this.usable(this.def(instance.defId))) return false;
    this.#setSlot(world, actor, state, slot, { defId: instance.defId, instanceId });
    return true;
  }

  /** Empties quick slot `slot`. @throws RangeError for a bad slot or an actor without quick slots. */
  clear(world: World<never>, actor: EntityId, slot: number): void {
    checkSlot(slot);
    this.#setSlot(world, actor, this.#slots(world, actor), slot, null);
  }

  /**
   * What quick slot `slot` shows: its item and the units held of it (depleted at 0), or null when
   * nothing is assigned. @throws RangeError for a bad slot.
   */
  slotView(world: World<never>, actor: EntityId, slot: number): QuickSlotView | null {
    checkSlot(slot);
    const bound = quickSlotsOf(world, actor)?.slots[slot] ?? null;
    if (bound === null) return null;
    const count = this.items.inventory.count(world, actor, { defId: bound.defId });
    return { defId: bound.defId, count, depleted: count === 0 };
  }

  /**
   * Uses one unit from quick slot `slot`: its stack, or (when that is gone) the first other stack of
   * its definition, which the slot then keeps. Afterwards a slot whose stack ran out refills from
   * the next one, or is depleted. Refused with `empty-slot`, `depleted` or a use refusal.
   * @throws RangeError for a bad slot or an actor without quick slots.
   */
  useSlot(world: World<never>, actor: EntityId, slot: number): UseResult {
    checkSlot(slot);
    const bound = this.#slots(world, actor).slots[slot] ?? null;
    if (bound === null) return this.#refuse(world, actor, null, slot, 'empty-slot');
    const instance = this.#refill(world, actor, slot, bound);
    if (instance === undefined) return this.#refuse(world, actor, bound.defId, slot, 'depleted');
    const result = this.#use(world, actor, instance, { slot });
    if (!result.ok) return result;
    this.#refill(world, actor, slot, { defId: bound.defId, instanceId: instance.instanceId });
    return result;
  }

  /**
   * Uses one unit of instance `instanceId` (the inventory screen's Use): validate, apply its
   * effects, spend the unit, emit `item.used`. Refused, changing nothing, with a UseRefusal.
   * @throws RangeError for an actor without quick slots.
   */
  use(world: World<never>, actor: EntityId, instanceId: number): UseResult {
    const instance = instanceOf(world, actor, instanceId);
    if (instance === undefined) return this.#refuse(world, actor, null, null, 'no-instance');
    return this.#use(world, actor, instance, { slot: null });
  }

  #use(
    world: World<never>,
    actor: EntityId,
    instance: ItemInstance,
    { slot }: UseSource,
  ): UseResult {
    const def = this.def(instance.defId);
    const restored: Partial<Record<ItemPool, number>> = {};
    // Validate: every effect is checked (and planned) before any applies.
    const plan = this.#plan(world, actor, def, instance, restored);
    if (typeof plan === 'string') return this.#refuse(world, actor, def.id, slot, plan);
    for (const apply of plan) apply();
    // A quest item a designer made consumable still needs force past the inventory.
    this.items.inventory.remove(world, actor, {
      instanceId: instance.instanceId,
      count: 1,
      ...(def.flags.questItem && { force: true }),
    });
    const lockTicks = Math.round(this.#lockSeconds(def) * world.clock.hz);
    world.set(actor, QuickSlotsComponent, {
      ...this.#slots(world, actor),
      busyUntil: world.tick + lockTicks,
    });
    world.events.emit(itemUsed, {
      tick: world.tick,
      actor,
      defId: def.id,
      instanceId: instance.instanceId,
      slot,
      effects: effectsOf(def),
      restored,
      remaining: this.items.inventory.count(world, actor, { defId: def.id }),
    });
    return { ok: true, instanceId: instance.instanceId };
  }

  /**
   * The use of one unit of `def`, as one step per effect, or why it cannot happen now. Nothing
   * changes until the steps run; restore steps add what they restored to `restored`.
   */
  #plan(
    world: World<never>,
    actor: EntityId,
    def: ConsumableDef,
    instance: ItemInstance,
    restored: Partial<Record<ItemPool, number>>,
  ): UseRefusal | (() => void)[] {
    const effects = effectsOf(def);
    if (def.category !== 'consumable' || effects.length === 0) return 'not-usable';
    const { busyUntil } = this.#slots(world, actor);
    if (world.tick < busyUntil || this.#busy(world, actor)) return 'busy';
    const until = (seconds: number) => world.tick + Math.round(seconds * world.clock.hz);
    const steps: (() => void)[] = [];
    for (const effect of effects) {
      switch (effect.op) {
        case 'restore':
          steps.push(() => {
            const gained = this.#pools[effect.pool]?.(world, actor, effect.amount) ?? 0;
            restored[effect.pool] = (restored[effect.pool] ?? 0) + gained;
          });
          break;
        case 'status':
          steps.push(() => {
            // Lapsed statuses drop out; one already holding is refreshed in place.
            const held = statusesOf(world, actor);
            const status = Object.freeze({ id: effect.status, until: until(effect.seconds) });
            const next = held.some((s) => s.id === status.id)
              ? held.map((s) => (s.id === status.id ? status : s))
              : [...held, status];
            setOrAdd(world, actor, StatusesComponent, Object.freeze(next));
          });
          break;
        case 'coat': {
          const weapon = mainHand(world, actor);
          if (weapon === undefined) return 'no-weapon';
          steps.push(() => {
            setOrAdd(world, actor, CoatingComponent, {
              weapon,
              properties: Object.freeze({ ...effect.properties }),
              until: until(effect.seconds),
            });
          });
          break;
        }
        case 'throw': {
          if (def.flags.noDrop) return 'no-drop';
          const view = this.#view(world, actor);
          if (view === undefined) return 'no-view';
          steps.push(() => {
            const launch = throwLaunch(view, def.weightClass);
            world.events.emit(itemSpawnRequested, {
              tick: world.tick,
              actor,
              defId: def.id,
              flags: instance.flags,
              worldProperties: def.worldProperties ?? {},
              position: launch.position,
              rotation: launch.rotation,
              velocity: launch.velocity,
            });
          });
          break;
        }
        default:
          return 'not-usable'; // progression's effects (a boon step, learning)
      }
    }
    return steps;
  }

  /**
   * The instance slot `slot` uses now: its own stack while it has units, else the first stack of
   * the same definition, which the slot is rebound to (or, with none, marked depleted). Emits
   * `quickSlot.changed` when the binding changes.
   */
  #refill(
    world: World<never>,
    actor: EntityId,
    slot: number,
    bound: QuickSlot,
  ): ItemInstance | undefined {
    const own = bound.instanceId === null ? undefined : instanceOf(world, actor, bound.instanceId);
    if (own !== undefined) return own;
    const next = this.items.inventory.query(world, actor, { defId: bound.defId })[0];
    const instanceId = next?.instanceId ?? null;
    if (bound.instanceId !== instanceId) {
      this.#setSlot(world, actor, this.#slots(world, actor), slot, {
        defId: bound.defId,
        instanceId,
      });
      world.events.emit(quickSlotChanged, {
        tick: world.tick,
        actor,
        slot,
        defId: bound.defId,
        instanceId,
      });
    }
    return next;
  }

  #setSlot(
    world: World<never>,
    actor: EntityId,
    state: QuickSlotsState,
    slot: number,
    value: QuickSlot | null,
  ): void {
    const slots = state.slots.map((s, i) => (i === slot ? value : s));
    world.set(actor, QuickSlotsComponent, { ...state, slots });
  }

  #refuse(
    world: World<never>,
    actor: EntityId,
    defId: string | null,
    slot: number | null,
    reason: UseRefusal,
  ): UseResult {
    world.events.emit(itemUseRefused, { tick: world.tick, actor, defId, slot, reason });
    return { ok: false, reason };
  }

  #slots(world: World<never>, actor: EntityId): QuickSlotsState {
    const state = quickSlotsOf(world, actor);
    if (state === undefined) {
      throw new RangeError(
        `entity ${String(actor)} has no quick slots: call addQuickSlots when installing it`,
      );
    }
    return state;
  }
}

export interface ConsumablesInstallOptions<TInput> {
  /** This tick's quick-slot uses: `{ actor, slot }` pairs; defaults to the tick's quick-slot commands. */
  readonly input?: (inputs: readonly TInput[]) => readonly UseQuickSlotCommand[];
  /**
   * This tick's quick-slot buttons for `actor`, one per slot (`quickSlot1` … `quickSlot4`, mw-e17.17):
   * a press uses that slot. Defaults to the tick's ActionFrame's.
   */
  readonly buttons?: (inputs: readonly TInput[], actor: EntityId) => QuickSlotButtons | undefined;
}

/** The quick-slot buttons of one actor this tick: an ActionFrame satisfies it. */
export type QuickSlotButtons = Readonly<
  Partial<Record<'quickSlot1' | 'quickSlot2' | 'quickSlot3' | 'quickSlot4', ActionButton>>
>;

const QUICK_SLOT_BUTTONS = ['quickSlot1', 'quickSlot2', 'quickSlot3', 'quickSlot4'] as const;

/**
 * Uses the quick slots this tick's commands ask for, in command order, then the slots whose buttons
 * were pressed (mw-e17.17), in slot order.
 */
export function consumablesSystem<TInput>(
  consumables: Consumables,
  options: ConsumablesInstallOptions<TInput> = {},
): System<TInput> {
  const inputOf =
    options.input ??
    ((inputs: readonly TInput[]) => (inputs as readonly unknown[]).filter(isUseQuickSlotCommand));
  const buttonsOf =
    options.buttons ??
    ((inputs: readonly TInput[]): QuickSlotButtons | undefined => actionFrameOf(inputs));
  return {
    name: 'consumables',
    run({ world, inputs }) {
      const sim = world as unknown as World<never>; // consumables never read inputs from the world
      for (const { actor, slot } of inputOf(inputs)) {
        if (quickSlotsOf(sim, actor) !== undefined) consumables.useSlot(sim, actor, slot);
      }
      world.query(QuickSlotsComponent).forEach((actor) => {
        const buttons = buttonsOf(inputs, actor);
        QUICK_SLOT_BUTTONS.forEach((name, slot) => {
          if (buttons?.[name]?.pressed === true) consumables.useSlot(sim, actor, slot);
        });
      });
    },
  };
}

/**
 * Sets up consumables in `world`: registers the quick-slot, status and coating components, spawns a
 * world item for every `item.spawnRequested` (through the world items' spawn, attributed to the
 * thrower, with an `item.dropped` as a throw) and adds the quick-slot system. The world needs world
 * items installed (installWorldItems). Call once, between steps, after the systems that move actors.
 */
export function installConsumables<TInput>(
  world: World<TInput>,
  consumables: Consumables,
  options: ConsumablesInstallOptions<TInput> = {},
): void {
  const sim = world as unknown as World<never>;
  for (const type of [QuickSlotsComponent, StatusesComponent, CoatingComponent] as const) {
    if (!world.isRegistered(type)) world.register(type);
  }
  world.events.on(itemSpawnRequested, (request) => {
    const { actor, defId, flags, position, rotation, velocity } = request;
    const entity = consumables.items.spawn(sim, {
      defId,
      flags,
      position,
      rotation,
      velocity,
      by: actor,
    });
    world.events.emit(itemDropped, {
      tick: world.tick,
      actor,
      entity,
      defId,
      count: 1,
      flags,
      thrown: true,
      position,
    });
  });
  world.addSystem(consumablesSystem(consumables, options));
}
