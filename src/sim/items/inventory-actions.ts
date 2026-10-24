// Inventory screen actions (mw-e17.10): what the player does to one item from the inventory screen —
// use it, put it in a quick slot, drop or throw it, equip or unequip it — as one sim command, so the
// screen never changes sim state itself and every action is recorded in replays like any input.
//
// Each action goes through the rules that already own it: using is the consumables' use pipeline
// (mw-e17.6), quick slots are the consumables' slots, drop and throw are the world items' (mw-e17.7)
// and equipping is the equipment rules' (mw-e17.4). Nothing here decides what an item can do; it only
// routes. Two things are added on top:
//
// - Assigning an item to a quick slot moves it there: any other slot holding the same definition is
//   cleared, so one item never sits in two slots.
// - An item that leaves the pack (dropped or thrown) leaves its equipment slot too (`reconcile`).
//
// Every action emits one `item.inventoryAction` with whether it happened and, if not, why (the
// owning rules' refusal, e.g. `no-drop` for a quest item), so the screen can say so.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import {
  EQUIPMENT_SLOTS,
  equipmentOf,
  type EquipmentRules,
  type EquipRefusal,
  type SlotMap,
} from '../inventory/equipment';
import { inventoryOf } from '../inventory/inventory';
import type { StudyRefusal, StudyRules } from '../magic/study';
import { QUICK_SLOT_COUNT, quickSlotsOf, type Consumables, type UseRefusal } from './consumables';
import { handlerView, type DropRefusal, type ItemHandlerView } from './world-items';

/** One action on one item (or one quick slot). */
export type InventoryAction =
  | { readonly op: 'use'; readonly instanceId: number }
  | { readonly op: 'assign'; readonly instanceId: number; readonly slot: number }
  | { readonly op: 'clear-slot'; readonly slot: number }
  | { readonly op: 'drop'; readonly instanceId: number }
  | { readonly op: 'throw'; readonly instanceId: number }
  | { readonly op: 'equip'; readonly instanceId: number }
  | { readonly op: 'unequip'; readonly instanceId: number }
  /** Study a spellbook (mw-e07.2): starts or resumes a study session. */
  | { readonly op: 'study'; readonly instanceId: number };

/** The command carrying an inventory action. */
export const INVENTORY_ACTION_COMMAND = 'item.inventoryAction' as const;

export interface InventoryActionCommand {
  readonly kind: typeof INVENTORY_ACTION_COMMAND;
  readonly actor: EntityId;
  readonly action: InventoryAction;
}

/** Why an action did nothing. */
export type InventoryActionRefusal =
  | UseRefusal
  | DropRefusal
  | EquipRefusal
  | StudyRefusal
  /** Study on an item that teaches no spell, or without study rules installed. */
  | 'not-studyable'
  /** Not something a quick slot can hold (only usable consumables). */
  | 'not-assignable'
  /** Equip or unequip for an actor without equipment slots (no class yet). */
  | 'no-equipment'
  /** Unequip of an item that is not equipped. */
  | 'not-equipped';

/** An inventory action was carried out, or refused. */
export interface InventoryActionDone {
  readonly tick: number;
  readonly actor: EntityId;
  readonly action: InventoryAction;
  /** The item's definition, or null when there was no such item. */
  readonly defId: string | null;
  readonly ok: boolean;
  /** Why it was refused (absent when it happened). */
  readonly reason?: InventoryActionRefusal;
}

export const inventoryActionDone = defineEvent<InventoryActionDone>('item.inventoryAction');

export type InventoryActionResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: InventoryActionRefusal };

function checkInstance(instanceId: number): void {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) {
    throw new RangeError(`instance id must be a positive integer, got ${String(instanceId)}`);
  }
}

function checkSlot(slot: number): void {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= QUICK_SLOT_COUNT) {
    throw new RangeError(
      `quick slot must be 0–${String(QUICK_SLOT_COUNT - 1)}, got ${String(slot)}`,
    );
  }
}

/** A command carrying `action` for `actor`. @throws RangeError for a bad instance id or slot. */
export function inventoryActionCommand(
  actor: EntityId,
  action: InventoryAction,
): InventoryActionCommand {
  if ('instanceId' in action) checkInstance(action.instanceId);
  if ('slot' in action) checkSlot(action.slot);
  return { kind: INVENTORY_ACTION_COMMAND, actor, action };
}

/** Whether `input` is an inventory action command. */
export function isInventoryActionCommand(input: unknown): input is InventoryActionCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === INVENTORY_ACTION_COMMAND
  );
}

export interface InventoryActionsOptions {
  /** The consumable rules (they hold the world-item and inventory rules too). */
  readonly consumables: Consumables;
  /** The equipment rules; without them equip and unequip are refused with `no-equipment`. */
  readonly equipment?: EquipmentRules;
  /** The study rules (mw-e07.2); without them `study` is refused with `not-studyable`. */
  readonly study?: StudyRules;
  /** Where `actor` drops and throws from; defaults to `handlerView` (the player's). */
  readonly view?: (world: World<never>, actor: EntityId) => ItemHandlerView | undefined;
}

const OK: InventoryActionResult = Object.freeze({ ok: true });

/** Carries out inventory actions through the rules that own them (see the file header). */
export class InventoryActions {
  readonly #consumables: Consumables;
  readonly #equipment: EquipmentRules | undefined;
  readonly #study: StudyRules | undefined;
  readonly #view: (world: World<never>, actor: EntityId) => ItemHandlerView | undefined;

  constructor(options: InventoryActionsOptions) {
    this.#consumables = options.consumables;
    this.#equipment = options.equipment;
    this.#study = options.study;
    this.#view = options.view ?? handlerView;
  }

  /**
   * Carries out `action` for `actor` and emits `item.inventoryAction`. Refusals change nothing.
   * @throws RangeError for use, assign or clear-slot by an actor without quick slots.
   */
  apply(world: World<never>, actor: EntityId, action: InventoryAction): InventoryActionResult {
    const instance =
      'instanceId' in action
        ? inventoryOf(world, actor)?.items.find((item) => item.instanceId === action.instanceId)
        : undefined;
    const result = this.#apply(world, actor, action, instance?.defId);
    world.events.emit(inventoryActionDone, {
      tick: world.tick,
      actor,
      action,
      defId: instance?.defId ?? null,
      ...(result.ok ? { ok: true } : { ok: false, reason: result.reason }),
    });
    return result;
  }

  #apply(
    world: World<never>,
    actor: EntityId,
    action: InventoryAction,
    defId: string | undefined,
  ): InventoryActionResult {
    const consumables = this.#consumables;
    switch (action.op) {
      case 'use': {
        const used = consumables.use(world, actor, action.instanceId);
        return used.ok ? OK : used;
      }
      case 'assign':
        return this.#assign(world, actor, action.instanceId, action.slot, defId);
      case 'clear-slot':
        consumables.clear(world, actor, action.slot);
        return OK;
      case 'drop':
      case 'throw':
        return this.#release(world, actor, action.instanceId, action.op === 'throw');
      case 'equip': {
        const equipment = this.#equipmentFor(world, actor);
        if (equipment === undefined) return { ok: false, reason: 'no-equipment' };
        const equipped = equipment.rules.equip(world, actor, action.instanceId);
        return equipped.ok ? OK : equipped;
      }
      case 'study': {
        if (this.#study === undefined || defId === undefined) {
          return { ok: false, reason: 'not-studyable' };
        }
        const started = this.#study.start(world, actor, defId);
        return started.status === 'refused' ? { ok: false, reason: started.reason } : OK;
      }
      case 'unequip': {
        const equipment = this.#equipmentFor(world, actor);
        if (equipment === undefined) return { ok: false, reason: 'no-equipment' };
        const { slots } = equipment;
        const slot = EQUIPMENT_SLOTS.find((s) => slots[s]?.instanceId === action.instanceId);
        if (slot === undefined) return { ok: false, reason: 'not-equipped' };
        equipment.rules.unequip(world, actor, slot);
        return OK;
      }
    }
  }

  #assign(
    world: World<never>,
    actor: EntityId,
    instanceId: number,
    slot: number,
    defId: string | undefined,
  ): InventoryActionResult {
    const consumables = this.#consumables;
    if (!consumables.assign(world, actor, slot, instanceId)) {
      return { ok: false, reason: 'not-assignable' };
    }
    for (let other = 0; other < QUICK_SLOT_COUNT; other++) {
      if (other !== slot && consumables.slotView(world, actor, other)?.defId === defId) {
        consumables.clear(world, actor, other);
      }
    }
    return OK;
  }

  #release(
    world: World<never>,
    actor: EntityId,
    instanceId: number,
    thrown: boolean,
  ): InventoryActionResult {
    const view = this.#view(world, actor);
    if (view === undefined) return { ok: false, reason: 'no-view' };
    const items = this.#consumables.items;
    const released = thrown
      ? items.throw(world, actor, view, { instanceId })
      : items.drop(world, actor, view, { instanceId });
    if (!released.ok) return released;
    this.#equipmentFor(world, actor)?.rules.reconcile(world, actor);
    return OK;
  }

  /** The equipment rules and `actor`'s slots, when there are both. */
  #equipmentFor(
    world: World<never>,
    actor: EntityId,
  ): { readonly rules: EquipmentRules; readonly slots: SlotMap } | undefined {
    const state = equipmentOf(world, actor);
    const rules = this.#equipment;
    return state === undefined || rules === undefined ? undefined : { rules, slots: state.slots };
  }
}

/** Carries out this tick's inventory action commands, in command order. */
export function inventoryActionsSystem<TInput>(actions: InventoryActions): System<TInput> {
  return {
    name: 'inventoryActions',
    run({ world, inputs }) {
      const sim = world as unknown as World<never>; // inventory actions never read world inputs
      for (const input of inputs as readonly unknown[]) {
        if (!isInventoryActionCommand(input)) continue;
        if (inventoryOf(sim, input.actor) === undefined) continue;
        if (quickSlotsOf(sim, input.actor) === undefined) continue;
        actions.apply(sim, input.actor, input.action);
      }
    },
  };
}

/**
 * Adds the inventory action system to `world`. Call once, between steps, after consumables and world
 * items are installed (installConsumables, installWorldItems).
 */
export function installInventoryActions<TInput>(
  world: World<TInput>,
  actions: InventoryActions,
): void {
  world.addSystem(inventoryActionsSystem(actions));
}
