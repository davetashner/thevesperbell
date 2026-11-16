// Consumables and quick slots (mw-e17.6): the use pipeline (validate, apply effects, consume one unit,
// emit item.used), four auto-refilling quick slots, the use lock, and thrown consumables spawning as
// world items that carry their world properties, on the real deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { DEFAULT_STAMINA_PROFILE, giveStamina, StaminaComponent } from '../combat/stamina';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addEquipment, EquipmentComponent, emptySlots } from '../inventory/equipment';
import { addInventory, inventoryOf } from '../inventory/inventory';
import { installPhysicsObjects } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { PlayerLook } from '../player/player';
import { readProperty, registerWorldProperties } from '../properties/components';
import type { Vec3 } from '../stimulus/shapes';
import { actionFrame, actionButton, type ButtonAction } from '../input/action-frame';
import { installStimuli } from '../stimulus/stimulus';
import {
  addQuickSlots,
  coatingOf,
  Consumables,
  DEFAULT_USE_LOCK_SECONDS,
  hasStatus,
  installConsumables,
  isUseQuickSlotCommand,
  itemSpawnRequested,
  itemUsed,
  itemUseRefused,
  QUICK_SLOT_COUNT,
  quickSlotChanged,
  quickSlotsOf,
  restoreHealth,
  restoreStamina,
  statusesOf,
  useQuickSlotCommand,
  type ConsumableDef,
  type ConsumablesOptions,
  type ItemSpawnRequest,
  type ItemUsed,
  type ItemUseRefused,
  type QuickSlotChanged,
} from './consumables';
import {
  installWorldItems,
  itemDropped,
  throwLaunch,
  WorldItemComponent,
  WorldItems,
  type ItemDropped,
  type ItemHandlerView,
} from './world-items';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const def = (
  id: string,
  category: ConsumableDef['category'],
  extra: Partial<Omit<ConsumableDef, 'flags'>> & { questItem?: boolean; noDrop?: boolean } = {},
): ConsumableDef => {
  const { questItem = false, noDrop = questItem, ...rest } = extra;
  return {
    id,
    category,
    stackable: true,
    maxStack: 10,
    weightClass: 'light',
    flags: { unique: false, questItem, noDrop },
    ...rest,
  };
};

const DEFS: readonly ConsumableDef[] = [
  def('healing-draught', 'consumable', {
    worldProperties: { material: 'glass' },
    use: [{ op: 'restore', pool: 'health', amount: 30 }],
  }),
  // Two-unit stacks, so a few units make several stacks.
  def('small-draught', 'consumable', {
    maxStack: 2,
    use: [{ op: 'restore', pool: 'health', amount: 10 }],
  }),
  def('oil-flask', 'consumable', {
    worldProperties: { flammable: true, liquid: true },
    use: [{ op: 'throw' }],
  }),
  // Data always gives a thrown item world properties (content's check); the sim copes without.
  def('throwing-stone', 'consumable', { use: [{ op: 'throw' }] }),
  def('blade-oil', 'consumable', {
    use: [{ op: 'coat', properties: { flammable: true }, seconds: 2 }],
  }),
  def('ward-tonic', 'consumable', {
    use: [
      { op: 'status', status: 'warded', seconds: 1 },
      { op: 'restore', pool: 'stamina', amount: 15 },
      { op: 'restore', pool: 'stamina', amount: 15 },
      { op: 'restore', pool: 'mana', amount: 20 },
    ],
  }),
  def('haste-tonic', 'consumable', { use: [{ op: 'status', status: 'hasted', seconds: 3 }] }),
  def('seal-of-office', 'consumable', {
    questItem: true,
    noDrop: false,
    use: [{ op: 'restore', pool: 'health', amount: 1 }],
  }),
  def('bound-relic', 'consumable', {
    questItem: true,
    worldProperties: { weight: 1 },
    use: [{ op: 'throw' }],
  }),
  def('scroll-of-trick', 'consumable', {
    use: [{ op: 'learn' }],
  }),
  def('arming-sword', 'weapon', { stackable: false }),
  def('rusty-sword', 'weapon', { stackable: false }),
];

/** Facing −z, at the origin, eyes level. */
const VIEW: ItemHandlerView = { feet: v(0, 0, 0), yaw: 0, pitch: 0 };

interface Setup {
  readonly world: World;
  readonly sim: World<never>;
  readonly consumables: Consumables;
  readonly actor: EntityId;
  readonly used: ItemUsed[];
  readonly refused: ItemUseRefused[];
  readonly requests: ItemSpawnRequest[];
  readonly changes: QuickSlotChanged[];
  readonly dropped: ItemDropped[];
  /** Adds `count` units of `defId`; returns the instances that received them. */
  give(defId: string, count?: number): readonly number[];
  units(defId: string): number;
}

/**
 * A world on a stone floor with physics objects, world items and consumables, and an actor at the
 * origin facing −z with 100 health (at 50), a stamina pool, an inventory and quick slots.
 */
function setup(options: ConsumablesOptions = {}): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<unknown>({ seed: 3, physics })));
  const sim = world as unknown as World<never>;
  world.register(CharacterController, PlayerLook, ...DAMAGE_COMPONENTS, StaminaComponent);
  installPhysicsObjects(sim);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  const items = new WorldItems(DEFS);
  installWorldItems(world, items);
  const consumables = new Consumables(DEFS, { items, ...options });
  installConsumables(world, consumables);
  const actor = world.spawn();
  world.add(actor, CharacterController, initialCharacterState(v(0, 0, 0)));
  world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
  giveCombatant(sim, actor, { health: 100 });
  world.set(actor, HealthComponent, { max: 100, current: 50 });
  giveStamina(sim, actor);
  addInventory(sim, actor);
  addQuickSlots(sim, actor);
  const used: ItemUsed[] = [];
  const refused: ItemUseRefused[] = [];
  const requests: ItemSpawnRequest[] = [];
  const changes: QuickSlotChanged[] = [];
  const dropped: ItemDropped[] = [];
  world.events.on(itemUsed, (e) => used.push(e));
  world.events.on(itemUseRefused, (e) => refused.push(e));
  world.events.on(itemSpawnRequested, (e) => requests.push(e));
  world.events.on(quickSlotChanged, (e) => changes.push(e));
  world.events.on(itemDropped, (e) => dropped.push(e));
  const give = (defId: string, count = 1): readonly number[] => {
    const result = items.inventory.add(sim, actor, defId, count);
    if (!result.ok) throw new Error(result.reason);
    return result.instanceIds;
  };
  const units = (defId: string): number => items.inventory.count(sim, actor, { defId });
  return { world, sim, consumables, actor, used, refused, requests, changes, dropped, give, units };
}

/** A world without combat pools or physics: just an inventory and quick slots. */
function bare() {
  const world = new World<never>({ seed: 1 });
  const consumables = new Consumables(DEFS);
  const actor = world.spawn();
  addInventory(world, actor);
  addQuickSlots(world, actor);
  return { world, consumables, actor };
}

/** The first instance id of `ids`, or a thrown error. */
function first(ids: readonly number[]): number {
  const id = ids[0];
  if (id === undefined) throw new Error('expected an instance');
  return id;
}

/** Steps `world` `n` idle ticks. */
function idle(world: World, n: number): void {
  for (let i = 0; i < n; i++) world.step([]);
}

const LOCK_TICKS = Math.round(DEFAULT_USE_LOCK_SECONDS * 60);

describe('consumables (mw-e17.6)', () => {
  it('AC-1: a healing draught in quick slot 1 with 3 in stock heals per data, leaves 2 and emits item.used', () => {
    const s = setup();
    const [stack] = s.give('healing-draught', 3);
    expect(s.consumables.assign(s.sim, s.actor, 0, stack ?? -1)).toBe(true);
    expect(s.consumables.slotView(s.sim, s.actor, 0)).toEqual({
      defId: 'healing-draught',
      count: 3,
      depleted: false,
    });
    const tick = s.world.tick;
    s.world.step([useQuickSlotCommand(s.actor, 0)]);
    expect(s.world.get(s.actor, HealthComponent)).toEqual({ max: 100, current: 80 });
    expect(s.units('healing-draught')).toBe(2);
    expect(s.used).toEqual([
      {
        tick,
        actor: s.actor,
        defId: 'healing-draught',
        instanceId: stack,
        slot: 0,
        effects: [{ op: 'restore', pool: 'health', amount: 30 }],
        restored: { health: 30 },
        remaining: 2,
      },
    ]);
    expect(s.refused).toEqual([]);
  });

  it('AC-2: using the last unit in a quick slot refills it from another stack of the same item', () => {
    const s = setup();
    const [full, single] = s.give('small-draught', 3); // stacks of 2 and 1
    s.consumables.assign(s.sim, s.actor, 1, single ?? -1);
    s.world.step([useQuickSlotCommand(s.actor, 1)]);
    expect(s.used.map((e) => e.instanceId)).toEqual([single]);
    expect(quickSlotsOf(s.sim, s.actor)?.slots[1]).toEqual({
      defId: 'small-draught',
      instanceId: full,
    });
    expect(s.changes).toEqual([
      expect.objectContaining({ slot: 1, defId: 'small-draught', instanceId: full }),
    ]);
    expect(s.consumables.slotView(s.sim, s.actor, 1)).toMatchObject({ count: 2, depleted: false });
  });

  it('AC-2: a slot with no stack left reports depleted, refuses, and refills when more arrive', () => {
    const s = setup({ lockSeconds: () => 0 });
    s.consumables.assign(s.sim, s.actor, 2, first(s.give('small-draught', 1)));
    s.world.step([useQuickSlotCommand(s.actor, 2)]);
    expect(s.consumables.slotView(s.sim, s.actor, 2)).toEqual({
      defId: 'small-draught',
      count: 0,
      depleted: true,
    });
    expect(s.changes.at(-1)).toMatchObject({ slot: 2, instanceId: null });
    s.world.step([useQuickSlotCommand(s.actor, 2)]);
    expect(s.refused).toEqual([
      expect.objectContaining({ defId: 'small-draught', slot: 2, reason: 'depleted' }),
    ]);
    expect(s.changes).toHaveLength(1); // still depleted: no change to report
    const fresh = first(s.give('small-draught', 2));
    s.world.step([useQuickSlotCommand(s.actor, 2)]);
    expect(s.used.map((e) => e.instanceId)).toEqual([expect.any(Number), fresh]);
    expect(quickSlotsOf(s.sim, s.actor)?.slots[2]).toEqual({
      defId: 'small-draught',
      instanceId: fresh,
    });
  });

  it('AC-2: a slot whose stack was dropped uses the next stack; a slot keeps its stack while it lasts', () => {
    const s = setup({ lockSeconds: () => 0 });
    const [a, b] = s.give('small-draught', 4); // two full stacks
    s.consumables.assign(s.sim, s.actor, 0, b ?? -1);
    s.consumables.items.inventory.remove(s.sim, s.actor, { instanceId: b ?? -1, count: 2 });
    s.world.step([useQuickSlotCommand(s.actor, 0)]);
    expect(s.used.map((e) => e.instanceId)).toEqual([a]);
    // Stack a has one unit left: the slot stays on it rather than jumping to a newer stack.
    const c = first(s.give('small-draught', 2));
    s.world.step([useQuickSlotCommand(s.actor, 0)]);
    expect(s.used.map((e) => e.instanceId)).toEqual([a, a]);
    expect(quickSlotsOf(s.sim, s.actor)?.slots[0]).toEqual({
      defId: 'small-draught',
      instanceId: c,
    });
  });

  it('AC-3: a throwable with worldProperties [flammable, liquid] emits a spawn request carrying exactly those', () => {
    const s = setup();
    s.consumables.assign(s.sim, s.actor, 3, first(s.give('oil-flask', 2)));
    const tick = s.world.tick;
    s.world.step([useQuickSlotCommand(s.actor, 3)]);
    const launch = throwLaunch(VIEW, 'light');
    expect(s.requests).toEqual([
      {
        tick,
        actor: s.actor,
        defId: 'oil-flask',
        flags: {},
        worldProperties: { flammable: true, liquid: true },
        position: launch.position,
        rotation: launch.rotation,
        velocity: launch.velocity,
      },
    ]);
    expect(s.units('oil-flask')).toBe(1);
    // The request becomes a world item through the world-item throw path, carrying the properties.
    const [flask] = s.world.query(WorldItemComponent).ids();
    expect(s.world.get(flask ?? -1, WorldItemComponent)).toMatchObject({
      defId: 'oil-flask',
      count: 1,
      by: s.actor,
    });
    expect(readProperty(s.sim, flask ?? -1, 'flammable')).toBe(true);
    expect(readProperty(s.sim, flask ?? -1, 'liquid')).toBe(true);
    expect(s.dropped).toEqual([
      expect.objectContaining({ entity: flask, defId: 'oil-flask', thrown: true, count: 1 }),
    ]);
    expect(s.used[0]?.effects).toEqual([{ op: 'throw' }]);
    idle(s.world, LOCK_TICKS);
    s.consumables.use(s.sim, s.actor, first(s.give('throwing-stone')));
    s.world.events.flush();
    expect(s.requests[1]).toMatchObject({ defId: 'throwing-stone', worldProperties: {} });
  });

  it('AC-4: a second use while the use lock holds is refused as busy and spends nothing', () => {
    const s = setup();
    s.consumables.assign(s.sim, s.actor, 0, first(s.give('healing-draught', 3)));
    s.world.step([useQuickSlotCommand(s.actor, 0), useQuickSlotCommand(s.actor, 0)]);
    expect(s.used).toHaveLength(1);
    expect(s.refused).toEqual([
      expect.objectContaining({ defId: 'healing-draught', slot: 0, reason: 'busy' }),
    ]);
    expect(s.units('healing-draught')).toBe(2);
    expect(s.world.get(s.actor, HealthComponent)?.current).toBe(80);
    idle(s.world, LOCK_TICKS - 2);
    s.world.step([useQuickSlotCommand(s.actor, 0)]); // last locked tick
    expect(s.refused).toHaveLength(2);
    expect(s.units('healing-draught')).toBe(2);
    s.world.step([useQuickSlotCommand(s.actor, 0)]); // the lock is over
    expect(s.used).toHaveLength(2);
    expect(s.units('healing-draught')).toBe(1);
  });

  it('AC-4: the busy hook (an attack, a stagger) locks uses too', () => {
    let attacking = true;
    const s = setup({ busy: () => attacking });
    s.consumables.assign(s.sim, s.actor, 0, first(s.give('healing-draught', 1)));
    s.world.step([useQuickSlotCommand(s.actor, 0)]);
    expect(s.refused.map((e) => e.reason)).toEqual(['busy']);
    expect(s.units('healing-draught')).toBe(1);
    attacking = false;
    s.world.step([useQuickSlotCommand(s.actor, 0)]);
    expect(s.units('healing-draught')).toBe(0);
  });

  it('a use from the pack (the inventory screen) runs the same pipeline with no slot', () => {
    const s = setup();
    const id = first(s.give('healing-draught', 1));
    expect(s.consumables.use(s.sim, s.actor, id)).toEqual({ ok: true, instanceId: id });
    s.world.events.flush(); // between steps, events wait for the next flush
    expect(s.used[0]).toMatchObject({ slot: null, remaining: 0 });
    expect(s.consumables.use(s.sim, s.actor, id)).toEqual({ ok: false, reason: 'no-instance' });
    expect(s.consumables.def('healing-draught').id).toBe('healing-draught');
    expect(() => s.consumables.def('nope')).toThrow(RangeError);
  });

  it('refuses what cannot be used, changing nothing', () => {
    const s = setup({ view: () => undefined });
    const refuse = (defId: string) => {
      const result = s.consumables.use(s.sim, s.actor, first(s.give(defId)));
      expect(s.units(defId)).toBe(1);
      return result.ok ? 'ok' : result.reason;
    };
    expect(refuse('arming-sword')).toBe('not-usable');
    expect(refuse('scroll-of-trick')).toBe('not-usable');
    expect(refuse('bound-relic')).toBe('no-drop');
    expect(refuse('oil-flask')).toBe('no-view');
    expect(refuse('blade-oil')).toBe('no-weapon');
    s.world.events.flush();
    expect(s.used).toEqual([]);
    expect(s.refused.map((e) => e.reason)).toEqual([
      'not-usable',
      'not-usable',
      'no-drop',
      'no-view',
      'no-weapon',
    ]);
    expect(quickSlotsOf(s.sim, s.actor)?.busyUntil).toBe(0); // a refusal sets no lock
  });

  it('an unassigned quick slot refuses as empty; assigning checks the item; clearing empties', () => {
    const s = setup();
    expect(s.consumables.slotView(s.sim, s.actor, 0)).toBeNull();
    expect(s.consumables.useSlot(s.sim, s.actor, 0)).toEqual({ ok: false, reason: 'empty-slot' });
    s.world.events.flush();
    expect(s.refused).toEqual([
      expect.objectContaining({ defId: null, slot: 0, reason: 'empty-slot' }),
    ]);
    expect(s.consumables.assign(s.sim, s.actor, 0, 999)).toBe(false);
    expect(s.consumables.assign(s.sim, s.actor, 0, first(s.give('arming-sword')))).toBe(false);
    const draught = first(s.give('healing-draught'));
    expect(s.consumables.assign(s.sim, s.actor, 0, draught)).toBe(true);
    s.consumables.clear(s.sim, s.actor, 0);
    expect(quickSlotsOf(s.sim, s.actor)?.slots).toEqual(Array(QUICK_SLOT_COUNT).fill(null));
    expect(() => s.consumables.assign(s.sim, s.actor, QUICK_SLOT_COUNT, draught)).toThrow(
      'quick slot must be 0–3',
    );
    expect(() => s.consumables.slotView(s.sim, s.actor, -1)).toThrow(RangeError);
  });

  it('a quest item a designer made consumable is spent with force', () => {
    const s = setup();
    s.consumables.use(s.sim, s.actor, first(s.give('seal-of-office')));
    expect(s.units('seal-of-office')).toBe(0);
  });

  it('coating: oil on the main-hand weapon holds for its time and lapses with another weapon', () => {
    const s = setup({ lockSeconds: () => 0 });
    addEquipment(s.sim, s.actor, 'knight');
    const sword = first(s.give('arming-sword'));
    const wield = (instanceId: number, defId: string) => {
      s.world.set(s.actor, EquipmentComponent, {
        classId: 'knight',
        slots: { ...emptySlots(), 'main-hand': { instanceId, defId } },
      });
    };
    wield(sword, 'arming-sword');
    expect(coatingOf(s.sim, s.actor)).toBeUndefined();
    s.consumables.use(s.sim, s.actor, first(s.give('blade-oil', 2)));
    const tick = s.world.tick;
    expect(coatingOf(s.sim, s.actor)).toEqual({
      weapon: { instanceId: sword, defId: 'arming-sword' },
      properties: { flammable: true },
      until: tick + 120,
    });
    // A second coat replaces the first.
    s.world.step([]);
    s.consumables.use(
      s.sim,
      s.actor,
      first(
        s.consumables.items.inventory
          .query(s.sim, s.actor, {
            defId: 'blade-oil',
          })
          .map((i) => i.instanceId),
      ),
    );
    expect(coatingOf(s.sim, s.actor)?.until).toBe(tick + 121);
    wield(first(s.give('rusty-sword')), 'rusty-sword');
    expect(coatingOf(s.sim, s.actor)).toBeUndefined();
    wield(sword, 'arming-sword');
    idle(s.world, 120);
    expect(coatingOf(s.sim, s.actor)).toBeUndefined(); // run out
  });

  it('statuses: applied for their time, refreshed in place, gone when they lapse', () => {
    const s = setup({ lockSeconds: () => 0 });
    s.consumables.use(s.sim, s.actor, first(s.give('ward-tonic')));
    s.world.step([]); // a first status lands at the end of the tick during a step; here at once
    s.consumables.use(s.sim, s.actor, first(s.give('haste-tonic')));
    const tick = s.world.tick;
    expect(statusesOf(s.sim, s.actor)).toEqual([
      { id: 'warded', until: tick - 1 + 60 },
      { id: 'hasted', until: tick + 180 },
    ]);
    idle(s.world, 30);
    s.consumables.use(s.sim, s.actor, first(s.give('ward-tonic')));
    expect(statusesOf(s.sim, s.actor).map((x) => x.id)).toEqual(['warded', 'hasted']);
    expect(statusesOf(s.sim, s.actor)[0]?.until).toBe(s.world.tick + 60);
    idle(s.world, 60);
    expect(hasStatus(s.sim, s.actor, 'warded')).toBe(false);
    expect(hasStatus(s.sim, s.actor, 'hasted')).toBe(true);
    idle(s.world, 100);
    s.consumables.use(s.sim, s.actor, first(s.give('ward-tonic')));
    expect(statusesOf(s.sim, s.actor).map((x) => x.id)).toEqual(['warded']);
  });

  it('restores add up per pool; a pool the actor lacks (mana, until e06) restores nothing', () => {
    const s = setup();
    const pool = s.world.get(s.actor, StaminaComponent);
    if (pool === undefined) throw new Error('no stamina');
    s.world.set(s.actor, StaminaComponent, { ...pool, current: 50 });
    s.consumables.use(s.sim, s.actor, first(s.give('ward-tonic')));
    s.world.events.flush();
    expect(s.used[0]?.restored).toEqual({ stamina: 30, mana: 0 });
    expect(s.world.get(s.actor, StaminaComponent)?.current).toBe(80);
  });

  it('pools: health never past max nor for the dead; stamina never past max; none without pools', () => {
    const s = setup();
    expect(restoreHealth(s.sim, s.actor, 70)).toBe(50);
    expect(restoreHealth(s.sim, s.actor, 10)).toBe(0);
    s.world.set(s.actor, HealthComponent, { max: 100, current: 0 });
    expect(restoreHealth(s.sim, s.actor, 10)).toBe(0);
    expect(restoreStamina(s.sim, s.actor, 10)).toBe(0); // full
    const pool = s.world.get(s.actor, StaminaComponent);
    if (pool === undefined) throw new Error('no stamina');
    s.world.set(s.actor, StaminaComponent, { ...pool, current: DEFAULT_STAMINA_PROFILE.max - 5 });
    expect(restoreStamina(s.sim, s.actor, 10)).toBe(5);
    const other = s.world.spawn();
    expect(restoreHealth(s.sim, other, 10)).toBe(0);
    expect(restoreStamina(s.sim, other, 10)).toBe(0);
    const b = bare();
    expect(restoreHealth(b.world, b.actor, 10)).toBe(0);
    expect(restoreStamina(b.world, b.actor, 10)).toBe(0);
  });

  it('custom pools and lock times come from the options', () => {
    const mana: number[] = [];
    const s = setup({
      pools: { mana: (_w, _a, amount) => (mana.push(amount), amount) },
      lockSeconds: (d) => (d.id === 'ward-tonic' ? 2 : 0),
    });
    s.consumables.use(s.sim, s.actor, first(s.give('ward-tonic')));
    expect(mana).toEqual([20]);
    s.world.events.flush();
    expect(s.used[0]?.restored).toEqual({ stamina: 0, mana: 20 });
    expect(quickSlotsOf(s.sim, s.actor)?.busyUntil).toBe(s.world.tick + 120);
  });

  it('without the components: no quick slots, statuses or coating; using needs quick slots', () => {
    const world = new World<never>({ seed: 1 });
    const actor = world.spawn();
    expect(quickSlotsOf(world, actor)).toBeUndefined();
    expect(statusesOf(world, actor)).toEqual([]);
    expect(coatingOf(world, actor)).toBeUndefined();
    addInventory(world, actor);
    const consumables = new Consumables(DEFS);
    expect(() => consumables.useSlot(world, actor, 0)).toThrow('has no quick slots');
    const b = bare();
    expect(statusesOf(b.world, b.actor)).toEqual([]);
    expect(b.consumables.slotView(b.world, b.actor, 0)).toBeNull();
    expect(new Consumables(DEFS).slotView(world, actor, 0)).toBeNull();
  });

  it('quick-slot commands: validated, recognised, and only for actors with quick slots', () => {
    expect(useQuickSlotCommand(4, 3)).toEqual({ kind: 'item.useQuickSlot', actor: 4, slot: 3 });
    expect(() => useQuickSlotCommand(4, 1.5)).toThrow(RangeError);
    expect(isUseQuickSlotCommand(useQuickSlotCommand(1, 0))).toBe(true);
    expect(isUseQuickSlotCommand({ kind: 'input.actions' })).toBe(false);
    expect(isUseQuickSlotCommand(null)).toBe(false);
    expect(isUseQuickSlotCommand('item.useQuickSlot')).toBe(false);
    const s = setup();
    const stranger = s.world.spawn();
    s.world.step([useQuickSlotCommand(stranger, 0)]);
    expect(s.refused).toEqual([]);
  });

  it('AC-1: pressing the quick slot 1 binding uses quick slot 1 (item.used with slot 0)', () => {
    const s = setup();
    const [id] = s.give('healing-draught', 2);
    s.consumables.assign(s.sim, s.actor, 0, id ?? -1);
    const press = (action: ButtonAction, pressed: boolean) =>
      actionFrame({
        move: { x: 0, y: 0 },
        look: { x: 0, y: 0 },
        buttons: (a) => actionButton(a === action && pressed, a === action && pressed, false),
      });
    s.world.step([press('quickSlot2', true)]); // an empty slot refuses, quietly
    expect(s.used).toEqual([]);
    s.world.step([press('quickSlot1', false)]);
    expect(s.used).toEqual([]);
    s.world.step([press('quickSlot1', true)]);
    expect(s.used.map((e) => e.slot)).toEqual([0]);
  });

  it('a custom buttons option feeds the quick-slot buttons', () => {
    const world = new World<{ readonly press: number }>({ seed: 1 });
    const sim = world as unknown as World<never>;
    const consumables = new Consumables(DEFS);
    const actor = world.spawn();
    addInventory(sim, actor);
    addQuickSlots(sim, actor);
    const added = consumables.items.inventory.add(sim, actor, 'healing-draught', 2);
    consumables.assign(sim, actor, 3, added.ok ? first(added.instanceIds) : -1);
    installConsumables(world, consumables, {
      buttons: (inputs) => ({
        quickSlot4: actionButton(
          inputs.some(({ press }) => press === 4),
          false,
          false,
        ),
      }),
    });
    world.step([{ press: 4 }]);
    expect(consumables.items.inventory.count(sim, actor)).toBe(1);
  });

  it('a custom input feeds the quick-slot system', () => {
    const world = new World<{ readonly slot: number }>({ seed: 1 });
    const sim = world as unknown as World<never>;
    const consumables = new Consumables(DEFS);
    const actor = world.spawn();
    addInventory(sim, actor);
    addQuickSlots(sim, actor);
    const added = consumables.items.inventory.add(sim, actor, 'healing-draught', 2);
    consumables.assign(sim, actor, 1, added.ok ? first(added.instanceIds) : -1);
    installConsumables(world, consumables, {
      input: (inputs) => inputs.map(({ slot }) => ({ kind: 'item.useQuickSlot', actor, slot })),
    });
    world.step([{ slot: 1 }]);
    expect(consumables.items.inventory.count(sim, actor)).toBe(1);
    expect(inventoryOf(sim, actor)?.items).toHaveLength(1);
  });
});
