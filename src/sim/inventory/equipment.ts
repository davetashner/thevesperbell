// Equipment slots (mw-e17.4, ADR-0003): what an actor wears and holds, and what that adds up to.
//
// Slots: main-hand, off-hand, head, body, hands, feet, trinket-1, trinket-2, ammo (the quiver),
// tool-belt-1 and tool-belt-2. An item's `equip.slot` decides where it goes: `both-hands` fills
// main-hand and off-hand with the same item, `trinket` and `tool-belt` take the first free one of
// their pair (else the first), and ammo, which has no equip block, goes in the quiver. Anything else
// without an equip block is refused with `not-equippable`.
//
// Equipped items stay in the inventory: a slot references an inventory instance (`instanceId` and
// `defId`), so the pack remains the one list of what the actor owns (saves, tabs and the keyring read
// it) and unequipping just clears the reference. Equipping into an occupied slot displaces what was
// there, back to the pack only; a displaced two-handed item leaves both hands. Every change, however
// many slots it touches, emits exactly one `equip.changed` with the slot maps before and after; a
// request that changes nothing emits nothing.
//
// Proficiency is soft: any class may equip anything. When the wearer's class lacks a proficiency tag
// the item calls for, the equip still succeeds and the derived state lists the item's data-defined
// `equip.nonProficient` penalty (slower draw, dearer stamina, optionally louder). Combat reads the
// draw and stamina terms (mw-e04, mw-e05); the noise term multiplies into the noise modifier here.
//
// The derived EquipmentState (`state`) is computed on demand from the slots, the inventory and the
// content, so it is never stale and adds nothing to snapshots. It holds:
//   armorKg, loadRatio, loadClass  equipped armor (head, body, hands, feet) plus an off-hand shield,
//                                  over the class's armor capacity (ADR-0003: knight 30 kg, others
//                                  23 kg): Light ≤ 30%, Medium ≤ 70%, Heavy ≤ 100%, else Overloaded.
//   loadNoiseMultiplier            the load class's noise (1.0 / 1.3 / 1.6 / 1.8), applied once.
//   noiseModifier                  that, times every equipped item's own `noiseMultiplier` (soft
//                                  boots, a bell charm) and every non-proficiency noise penalty,
//                                  clamped to [0.5, 2.0]. CharacterEncumbrance (mw-e02.10) and noise
//                                  propagation (mw-e09.5) read it.
//   light                          the strongest light an equipped item emits (a lantern on the belt).
//   capabilities                   what equipped items grant `while: equipped` (sorted). Granting
//                                  them through the capability registry is mw-e17.9.
//   penalties                      one entry per equipped item the class is not proficient with.
//
// What the load class does to movement, stamina and armor swaps (mw-e17.13), what granted
// capabilities do (mw-e17.9), the paper-doll (mw-e17.11) and combat's use of weapons (mw-e04, mw-e05)
// are not here.
//
// State is plain data on the actor (`equipment.slots`), so snapshots, saves, replays and the state
// hash carry it like any component. The component is added once (`addEquipment`, at install), and
// operations then replace its value immediately.

import type { EquipSlot, ItemCategory } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { inventoryOf, type ItemInstance } from './inventory';

/** The equipment slots, in a fixed order (stable snapshots, hashes and event payloads). */
export const EQUIPMENT_SLOTS = [
  'main-hand',
  'off-hand',
  'head',
  'body',
  'hands',
  'feet',
  'trinket-1',
  'trinket-2',
  'ammo',
  'tool-belt-1',
  'tool-belt-2',
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** The slots whose items count towards the load (ADR-0003), with a shield in the off hand. */
const LOAD_SLOTS: ReadonlySet<EquipmentSlot> = new Set([
  'off-hand',
  'head',
  'body',
  'hands',
  'feet',
]);

/** For each item slot, the slot sets it may fill, in preference order. */
const SLOT_OPTIONS: Readonly<Record<EquipSlot | 'ammo', readonly (readonly EquipmentSlot[])[]>> = {
  'main-hand': [['main-hand']],
  'off-hand': [['off-hand']],
  'both-hands': [['main-hand', 'off-hand']],
  head: [['head']],
  body: [['body']],
  hands: [['hands']],
  feet: [['feet']],
  trinket: [['trinket-1'], ['trinket-2']],
  'tool-belt': [['tool-belt-1'], ['tool-belt-2']],
  ammo: [['ammo']],
};

/** An equipped inventory instance. */
export interface EquippedRef {
  readonly instanceId: number;
  readonly defId: string;
}

/** Every slot and what it holds (null = empty); a two-handed item is in both hands. */
export type SlotMap = Readonly<Record<EquipmentSlot, EquippedRef | null>>;

/** An actor's equipment (`equipment.slots`; a snapshot and save key, never renamed). */
export interface EquipmentSlotsState {
  /** The wearer's class, whose proficiencies and armor capacity apply (class data, mw-e19.4). */
  readonly classId: string;
  readonly slots: SlotMap;
}

export const EquipmentComponent = defineComponent<EquipmentSlotsState>('equipment.slots');

/** ADR-0003's load classes, lightest first. */
export const LOAD_CLASSES = ['light', 'medium', 'heavy', 'overloaded'] as const;
export type LoadClass = (typeof LOAD_CLASSES)[number];

/** Load-class thresholds and noise (ADR-0003; mw-e17.13 adds the movement multipliers). */
export interface LoadTuning {
  /** The highest load ratio of each class below overloaded (inclusive). */
  readonly maxRatio: Readonly<Record<Exclude<LoadClass, 'overloaded'>, number>>;
  /** Footstep and landing noise multiplier of each class. */
  readonly noise: Readonly<Record<LoadClass, number>>;
  /** The clamp on an actor's total noise modifier, [min, max]. */
  readonly noiseRange: readonly [number, number];
}

/** ADR-0003's table: Light ≤ 30%, Medium ≤ 70%, Heavy ≤ 100%; noise 1.0 / 1.3 / 1.6 / 1.8. */
export const DEFAULT_LOAD_TUNING: LoadTuning = {
  maxRatio: { light: 0.3, medium: 0.7, heavy: 1 },
  noise: { light: 1, medium: 1.3, heavy: 1.6, overloaded: 1.8 },
  noiseRange: [0.5, 2],
};

/** A non-proficiency penalty (the item's `equip.nonProficient`). */
export interface ProficiencyPenalty {
  readonly drawTimeMultiplier: number;
  readonly staminaCostMultiplier: number;
  readonly noiseMultiplier: number;
}

/**
 * What equipment reads from an item definition. A loaded item (`ItemEntry`, mw-e17.2) is one; tests
 * may pass smaller literals.
 */
export interface EquipmentItemDef {
  readonly id: string;
  readonly category: ItemCategory;
  readonly equip?:
    | {
        readonly slot: EquipSlot;
        readonly proficiencies: readonly string[];
        /** The schema fills it (DEFAULT_NON_PROFICIENT_PENALTY when the file sets none). */
        readonly nonProficient: ProficiencyPenalty;
      }
    | undefined;
  readonly armor?: { readonly weightKg: number };
  readonly shield?: { readonly weightKg: number };
  readonly worldProperties?:
    | {
        readonly noiseMultiplier?: number | undefined;
        readonly lightEmitter?: LightEmitted | undefined;
      }
    | undefined;
  readonly grants?: readonly { readonly capability: string; readonly while: string }[];
}

/** What equipment reads from a class definition (a loaded `ClassEntry`, mw-e19.4, is one). */
export interface EquipmentClassDef {
  readonly id: string;
  readonly proficiencies: readonly string[];
  readonly armorCapacityKg: number;
}

/** Light an equipped item emits (its `lightEmitter` world property). */
export interface LightEmitted {
  readonly intensity: number;
  readonly radius: number;
}

/** A penalty the wearer pays for an item its class is not proficient with. */
export interface EquippedPenalty {
  /** The first slot the item is in. */
  readonly slot: EquipmentSlot;
  readonly defId: string;
  /** The item's proficiency tags the class lacks. */
  readonly missing: readonly string[];
  readonly penalty: ProficiencyPenalty;
}

/** The derived equipment state (see the file header). */
export interface EquipmentState {
  readonly classId: string;
  readonly slots: SlotMap;
  /** Equipped armor and shield weight, kg. */
  readonly armorKg: number;
  /** The class's armor capacity, kg. */
  readonly capacityKg: number;
  /** armorKg ÷ capacityKg. */
  readonly loadRatio: number;
  readonly loadClass: LoadClass;
  /** The load class's noise multiplier. */
  readonly loadNoiseMultiplier: number;
  /** The actor's total equipment noise multiplier, clamped to the tuning's range. */
  readonly noiseModifier: number;
  /** The strongest light an equipped item emits; null when none does. */
  readonly light: LightEmitted | null;
  /** Capabilities equipped items grant while equipped, sorted, without repeats. */
  readonly capabilities: readonly string[];
  /** One entry per equipped item the class is not proficient with, in slot order. */
  readonly penalties: readonly EquippedPenalty[];
}

/** Why an equip or unequip was refused. */
export type EquipRefusal =
  /** No inventory instance with that id. */
  | 'no-instance'
  /** The item has no equip block (and is not ammo). */
  | 'not-equippable'
  /** The requested slot is not one the item fits. */
  | 'wrong-slot'
  /** Unequip of an empty slot. */
  | 'empty';

export type EquipResult =
  | {
      readonly ok: true;
      /** False when the request matched the current equipment (no event). */
      readonly changed: boolean;
      /** Items that left every slot, in slot order (they stay in the inventory). */
      readonly unequipped: readonly EquippedRef[];
    }
  | { readonly ok: false; readonly reason: EquipRefusal };

/** An actor's equipment changed. */
export interface EquipChanged {
  readonly tick: number;
  readonly actor: EntityId;
  readonly before: SlotMap;
  readonly after: SlotMap;
}

export const equipChanged = defineEvent<EquipChanged>('equip.changed');

/** A slot map with every slot empty. */
export function emptySlots(): SlotMap {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])) as Record<
    EquipmentSlot,
    null
  >;
}

/**
 * Gives `actor` empty equipment, worn as `classId`. Call once per actor, when it is installed, after
 * `addInventory`: adding it is a structural change, deferred to the end of the tick in a step.
 */
export function addEquipment(world: World, actor: EntityId, classId: string): void {
  if (!world.isRegistered(EquipmentComponent)) world.register(EquipmentComponent);
  world.add(actor, EquipmentComponent, { classId, slots: emptySlots() });
}

/** `actor`'s equipment slots, or undefined when it has none. */
export function equipmentOf(world: World, actor: EntityId): EquipmentSlotsState | undefined {
  return world.isRegistered(EquipmentComponent) ? world.get(actor, EquipmentComponent) : undefined;
}

/** The distinct items in `slots`, each with the first slot it is in, in slot order. */
function equipped(slots: SlotMap): { slot: EquipmentSlot; ref: EquippedRef }[] {
  const seen = new Set<number>();
  const out: { slot: EquipmentSlot; ref: EquippedRef }[] = [];
  for (const slot of EQUIPMENT_SLOTS) {
    const ref = slots[slot];
    if (ref === null || seen.has(ref.instanceId)) continue;
    seen.add(ref.instanceId);
    out.push({ slot, ref });
  }
  return out;
}

const sameSlots = (a: SlotMap, b: SlotMap): boolean =>
  EQUIPMENT_SLOTS.every((slot) => a[slot]?.instanceId === b[slot]?.instanceId);

/** Items in `before` that are in no slot of `after`, in slot order. */
function leftBetween(before: SlotMap, after: SlotMap): EquippedRef[] {
  const kept = new Set(equipped(after).map(({ ref }) => ref.instanceId));
  return equipped(before)
    .map(({ ref }) => ref)
    .filter((ref) => !kept.has(ref.instanceId));
}

/** The item definitions, classes and load tuning every equipment operation goes through. */
export class EquipmentRules {
  readonly #items: ReadonlyMap<string, EquipmentItemDef>;
  readonly #classes: ReadonlyMap<string, EquipmentClassDef>;
  readonly load: LoadTuning;

  /** `items`, `classes`: every item and class definition (the content registry's). */
  constructor(
    items: Iterable<EquipmentItemDef>,
    classes: Iterable<EquipmentClassDef>,
    options: { readonly load?: LoadTuning } = {},
  ) {
    this.#items = new Map([...items].map((def) => [def.id, def]));
    this.#classes = new Map([...classes].map((def) => [def.id, def]));
    this.load = options.load ?? DEFAULT_LOAD_TUNING;
  }

  /** The definition of `defId`. @throws RangeError for an id it does not know. */
  def(defId: string): EquipmentItemDef {
    const def = this.#items.get(defId);
    if (def === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return def;
  }

  /** The class `classId`. @throws RangeError for an id it does not know. */
  classDef(classId: string): EquipmentClassDef {
    const def = this.#classes.get(classId);
    if (def === undefined) throw new RangeError(`class "${classId}" is not defined`);
    return def;
  }

  /** The slots `defId` may fill, in preference order; empty when it is not equippable. */
  slotsFor(defId: string): readonly (readonly EquipmentSlot[])[] {
    const def = this.def(defId);
    const slot = def.equip?.slot ?? (def.category === 'ammo' ? 'ammo' : undefined);
    return slot === undefined ? [] : SLOT_OPTIONS[slot];
  }

  /**
   * Equips inventory instance `instanceId`: into `slot` when given (it must be one the item fits),
   * else into the first free slot it fits, else the first. What was there is displaced back to the
   * pack (a two-handed item from both hands); an item already equipped elsewhere moves. Emits one
   * `equip.changed` when anything changed. Soft proficiency: a class's missing proficiency never
   * refuses an equip (see `state`).
   * @throws RangeError for an actor without an inventory or equipment, or an unknown item.
   */
  equip(world: World, actor: EntityId, instanceId: number, slot?: EquipmentSlot): EquipResult {
    const current = this.#state(world, actor);
    const instance = this.#instance(world, actor, instanceId);
    if (instance === undefined) return { ok: false, reason: 'no-instance' };
    const options = this.slotsFor(instance.defId);
    if (options.length === 0) return { ok: false, reason: 'not-equippable' };
    const before = current.slots;
    const targets =
      slot !== undefined
        ? options.find((option) => option.includes(slot))
        : (options.find((option) => option.every((s) => before[s]?.instanceId === instanceId)) ??
          options.find((option) => option.every((s) => before[s] === null)) ??
          options[0]);
    if (targets === undefined) return { ok: false, reason: 'wrong-slot' };

    const displaced = new Set(
      targets.map((s) => before[s]?.instanceId).filter((id) => id !== undefined),
    );
    displaced.add(instanceId);
    const ref: EquippedRef = { instanceId, defId: instance.defId };
    const after = Object.fromEntries(
      EQUIPMENT_SLOTS.map((s) => {
        if (targets.includes(s)) return [s, ref];
        const held = before[s];
        return [s, held !== null && displaced.has(held.instanceId) ? null : held];
      }),
    ) as SlotMap;
    return this.#commit(world, actor, current, after);
  }

  /**
   * Empties `slot` (both hands for a two-handed item); the item stays in the pack. Emits one
   * `equip.changed`; refused with `empty` when nothing is there.
   * @throws RangeError for an actor without equipment.
   */
  unequip(world: World, actor: EntityId, slot: EquipmentSlot): EquipResult {
    const current = this.#state(world, actor);
    const held = current.slots[slot];
    if (held === null) return { ok: false, reason: 'empty' };
    return this.#commit(world, actor, current, this.#without(current.slots, [held.instanceId]));
  }

  /**
   * Empties every slot whose item has left the inventory (dropped, sold, stolen, used up), with one
   * `equip.changed`. The derived state already ignores such items; this clears the slots.
   * @throws RangeError for an actor without equipment.
   */
  reconcile(world: World, actor: EntityId): EquipResult {
    const current = this.#state(world, actor);
    const gone = equipped(current.slots)
      .map(({ ref }) => ref.instanceId)
      .filter((id) => this.#instance(world, actor, id) === undefined);
    return this.#commit(world, actor, current, this.#without(current.slots, gone));
  }

  /**
   * What `actor` wears, kg: its equipped armour and shield (the weight pressure plates add, mw-e03.19).
   * 0 for an actor without equipment.
   */
  wornKg(world: World, actor: EntityId): number {
    return equipmentOf(world, actor) === undefined ? 0 : this.state(world, actor).armorKg;
  }

  /**
   * The derived equipment state of `actor` (see the file header). Items no longer in the inventory
   * count as not equipped.
   * @throws RangeError for an actor without equipment, or an unknown class or item.
   */
  state(world: World, actor: EntityId): EquipmentState {
    const { classId, slots } = this.#state(world, actor);
    const wearer = this.classDef(classId);
    const proficient = new Set(wearer.proficiencies);
    let armorKg = 0;
    let itemNoise = 1;
    let light: LightEmitted | null = null;
    const capabilities = new Set<string>();
    const penalties: EquippedPenalty[] = [];
    for (const { slot, ref } of equipped(slots)) {
      if (this.#instance(world, actor, ref.instanceId) === undefined) continue;
      const def = this.def(ref.defId);
      if (LOAD_SLOTS.has(slot)) armorKg += def.armor?.weightKg ?? def.shield?.weightKg ?? 0;
      itemNoise *= def.worldProperties?.noiseMultiplier ?? 1;
      const emitter = def.worldProperties?.lightEmitter;
      if (emitter !== undefined && (light === null || emitter.intensity > light.intensity)) {
        light = { intensity: emitter.intensity, radius: emitter.radius };
      }
      for (const grant of def.grants ?? []) {
        if (grant.while === 'equipped') capabilities.add(grant.capability);
      }
      const missing = (def.equip?.proficiencies ?? []).filter((tag) => !proficient.has(tag));
      if (def.equip !== undefined && missing.length > 0) {
        const penalty = def.equip.nonProficient;
        itemNoise *= penalty.noiseMultiplier;
        penalties.push({ slot, defId: ref.defId, missing, penalty: { ...penalty } });
      }
    }
    const loadRatio = armorKg / wearer.armorCapacityKg;
    const loadClass = this.loadClassOf(loadRatio);
    const loadNoiseMultiplier = this.load.noise[loadClass];
    const [minNoise, maxNoise] = this.load.noiseRange;
    return {
      classId,
      slots,
      armorKg,
      capacityKg: wearer.armorCapacityKg,
      loadRatio,
      loadClass,
      loadNoiseMultiplier,
      noiseModifier: Math.min(maxNoise, Math.max(minNoise, loadNoiseMultiplier * itemNoise)),
      light,
      capabilities: [...capabilities].sort(),
      penalties,
    };
  }

  /** The load class of a load ratio (ADR-0003 thresholds, inclusive). */
  loadClassOf(loadRatio: number): LoadClass {
    const { maxRatio } = this.load;
    if (loadRatio <= maxRatio.light) return 'light';
    if (loadRatio <= maxRatio.medium) return 'medium';
    return loadRatio <= maxRatio.heavy ? 'heavy' : 'overloaded';
  }

  #without(slots: SlotMap, instanceIds: readonly number[]): SlotMap {
    return Object.fromEntries(
      EQUIPMENT_SLOTS.map((s) => {
        const held = slots[s];
        return [s, held !== null && instanceIds.includes(held.instanceId) ? null : held];
      }),
    ) as SlotMap;
  }

  #commit(
    world: World,
    actor: EntityId,
    current: EquipmentSlotsState,
    after: SlotMap,
  ): EquipResult {
    const before = current.slots;
    if (sameSlots(before, after)) return { ok: true, changed: false, unequipped: [] };
    world.set(actor, EquipmentComponent, { ...current, slots: after });
    world.events.emit(equipChanged, { tick: world.tick, actor, before, after });
    return { ok: true, changed: true, unequipped: leftBetween(before, after) };
  }

  #instance(world: World, actor: EntityId, instanceId: number): ItemInstance | undefined {
    const inventory = inventoryOf(world, actor);
    if (inventory === undefined) {
      throw new RangeError(
        `entity ${String(actor)} has no inventory: call addInventory when installing it`,
      );
    }
    return inventory.items.find((item) => item.instanceId === instanceId);
  }

  #state(world: World, actor: EntityId): EquipmentSlotsState {
    const state = equipmentOf(world, actor);
    if (state === undefined) {
      throw new RangeError(
        `entity ${String(actor)} has no equipment: call addEquipment when installing it`,
      );
    }
    return state;
  }
}
