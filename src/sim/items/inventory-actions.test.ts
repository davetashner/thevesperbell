// Inventory screen actions (mw-e17.10): one command per action, routed through the consumables,
// world items and equipment rules, on the real deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import { PlayerLook } from '../player/player';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addEquipment, equipmentOf, EquipmentRules } from '../inventory/equipment';
import { addInventory, inventoryOf } from '../inventory/inventory';
import { installPhysicsObjects } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { registerWorldProperties } from '../properties/components';
import { installGameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';
import { ScrollRules } from '../magic/scroll';
import { SpellLearning } from '../magic/learning';
import { addStudent, installStudy, StudyRules } from '../magic/study';
import { installStimuli } from '../stimulus/stimulus';
import {
  addQuickSlots,
  Consumables,
  installConsumables,
  quickSlotsOf,
  type ConsumableDef,
} from './consumables';
import { giveItemCommand } from './give-command';
import {
  installInventoryActions,
  inventoryActionCommand,
  inventoryActionDone,
  InventoryActions,
  isInventoryActionCommand,
  type InventoryActionDone,
} from './inventory-actions';
import { installWorldItems, WorldItemComponent, WorldItems } from './world-items';

const item = (
  id: string,
  category: ConsumableDef['category'],
  extra: Partial<ConsumableDef> = {},
): ConsumableDef => ({
  id,
  category,
  stackable: category === 'consumable',
  ...(category === 'consumable' && { maxStack: 10 }),
  weightClass: 'light',
  flags: { unique: false, questItem: false, noDrop: false },
  ...extra,
});

const DEFS = [
  item('healing-draught', 'consumable', { use: [{ op: 'restore', pool: 'health', amount: 30 }] }),
  item('oil-flask', 'consumable', { use: [{ op: 'throw' }] }),
  item('arming-sword', 'weapon', {
    equip: {
      slot: 'main-hand',
      proficiencies: [],
      nonProficient: { drawTimeMultiplier: 1, staminaCostMultiplier: 1, noiseMultiplier: 1 },
    },
  } as Partial<ConsumableDef>),
  item('field-primer', 'book'),
  item('spark-scroll', 'book', { stackable: true, maxStack: 5 }),
  item('gallery-key', 'key', { flags: { unique: true, questItem: true, noDrop: true } }),
];

const VIEW = { feet: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };

function setup(
  options: {
    equipment?: boolean;
    view?: boolean;
    study?: StudyRules;
    scrolls?: boolean;
    giver?: boolean;
  } = {},
) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<unknown>({ seed: 5, physics })));
  const sim = world as unknown as World<never>;
  world.register(...DAMAGE_COMPONENTS);
  installPhysicsObjects(sim);
  physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
  const items = new WorldItems(DEFS);
  installWorldItems(world, items, { view: () => VIEW });
  const consumables = new Consumables(DEFS, { items, view: () => VIEW });
  installConsumables(world, consumables);
  const equipment = new EquipmentRules(DEFS as never, [
    { id: 'knight', proficiencies: [], armorCapacityKg: 30 },
  ]);
  const actions = new InventoryActions({
    consumables,
    ...(options.equipment !== false && { equipment }),
    ...(options.study !== undefined && { study: options.study }),
    ...(options.scrolls === true && {
      scrolls: new ScrollRules({
        casts: (id) => (id === 'spark-scroll' ? 'spark' : undefined),
        pipeline: { cast: () => ({ status: 'cast', delivery: 1 }) },
        inventory: items.inventory,
      }),
    }),
    ...(options.giver === true && {
      giver: { inventory: items.inventory, known: (id: string) => id === 'spark-scroll' },
    }),
    ...(options.view === false ? { view: () => undefined } : { view: () => VIEW }),
  });
  installInventoryActions(world, actions);
  const actor: EntityId = world.spawn();
  giveCombatant(sim, actor, { health: 100 });
  world.set(actor, HealthComponent, { max: 100, current: 40 });
  addInventory(sim, actor);
  addQuickSlots(sim, actor);
  const done: InventoryActionDone[] = [];
  world.events.on(inventoryActionDone, (e) => done.push(e));
  const give = (defId: string, count = 1): number => {
    const result = items.inventory.add(sim, actor, defId, count);
    if (!result.ok) throw new Error(result.reason);
    return result.instanceIds[0] ?? 0;
  };
  const units = (defId: string): number => items.inventory.count(sim, actor, { defId });
  return { world, sim, actor, done, give, units, actions, equipment };
}

describe('studying from the inventory (mw-e07.2)', () => {
  const studyRules = (): StudyRules =>
    new StudyRules({
      books: (id) =>
        id === 'field-primer'
          ? { id, spell: 'spark', studyMinutes: 10, learners: 'any' }
          : undefined,
      learning: new SpellLearning(),
    });

  it('starts a study session for a spellbook and passes the rules’ refusals through', () => {
    const rules = studyRules();
    const { world, sim, actor, give, actions } = setup({ study: rules });
    installGameClock(world, DEFAULT_CLOCK_CONFIG);
    installStudy(world, rules);
    addStudent(sim, actor);
    world.step();
    const primer = give('field-primer');
    const draught = give('healing-draught');
    expect(actions.apply(sim, actor, { op: 'study', instanceId: draught })).toEqual({
      ok: false,
      reason: 'unknown-book',
    });
    expect(actions.apply(sim, actor, { op: 'study', instanceId: primer })).toEqual({ ok: true });
    expect(rules.studying(sim, actor)).toBe('field-primer');
    expect(actions.apply(sim, actor, { op: 'study', instanceId: primer })).toEqual({
      ok: false,
      reason: 'busy',
    });
  });

  it('is refused without study rules, or for an instance that is not there', () => {
    const bare = setup();
    const primer = bare.give('field-primer');
    expect(bare.actions.apply(bare.sim, bare.actor, { op: 'study', instanceId: primer })).toEqual({
      ok: false,
      reason: 'not-studyable',
    });
    const ruled = setup({ study: studyRules() });
    expect(ruled.actions.apply(ruled.sim, ruled.actor, { op: 'study', instanceId: 99 })).toEqual({
      ok: false,
      reason: 'not-studyable',
    });
  });
});

describe('reading a scroll from the inventory (mw-ju8.17)', () => {
  it('AC-3: casts the scroll’s spell and spends one scroll; other items are not readable', () => {
    const { sim, actor, give, units, actions } = setup({ scrolls: true });
    const scroll = give('spark-scroll', 2);
    const primer = give('field-primer');
    const read = { op: 'read', instanceId: scroll, aim: { x: 1, y: 0, z: 0 } } as const;
    expect(actions.apply(sim, actor, read)).toEqual({ ok: true });
    expect(units('spark-scroll')).toBe(1);
    expect(actions.apply(sim, actor, { op: 'read', instanceId: primer })).toEqual({
      ok: false,
      reason: 'not-readable',
    });
    expect(actions.apply(sim, actor, { op: 'read', instanceId: scroll, target: 9 })).toEqual({
      ok: true,
    });
    expect(units('spark-scroll')).toBe(0);
  });

  it('is refused without scroll rules', () => {
    const { sim, actor, give, actions } = setup();
    const scroll = give('spark-scroll');
    expect(actions.apply(sim, actor, { op: 'read', instanceId: scroll })).toEqual({
      ok: false,
      reason: 'not-readable',
    });
  });
});

describe('give-item commands in the action system (mw-ju8.17)', () => {
  it('are carried out when a giver is installed and ignored without one', () => {
    const withGiver = setup({ giver: true });
    withGiver.world.step([giveItemCommand(withGiver.actor, 'spark-scroll', 2)]);
    expect(withGiver.units('spark-scroll')).toBe(2);
    const bare = setup();
    bare.world.step([giveItemCommand(bare.actor, 'spark-scroll', 2)]);
    expect(bare.units('spark-scroll')).toBe(0);
  });
});

describe('inventory action commands', () => {
  it('builds and recognises commands, rejecting bad instance ids and slots', () => {
    const command = inventoryActionCommand(3, { op: 'assign', instanceId: 2, slot: 1 });
    expect(command).toEqual({
      kind: 'item.inventoryAction',
      actor: 3,
      action: { op: 'assign', instanceId: 2, slot: 1 },
    });
    expect(isInventoryActionCommand(command)).toBe(true);
    expect(isInventoryActionCommand({ kind: 'other' })).toBe(false);
    expect(isInventoryActionCommand(null)).toBe(false);
    expect(isInventoryActionCommand('item.inventoryAction')).toBe(false);
    expect(() => inventoryActionCommand(3, { op: 'use', instanceId: 0 })).toThrow(/instance id/);
    expect(() => inventoryActionCommand(3, { op: 'clear-slot', slot: 4 })).toThrow(/quick slot/);
    expect(() => inventoryActionCommand(3, { op: 'clear-slot', slot: 1.5 })).toThrow(/quick slot/);
  });
});

describe('InventoryActions', () => {
  it('uses a consumable through the use pipeline, as a command applied on the next step', () => {
    const { world, actor, give, units, done } = setup();
    const draught = give('healing-draught', 2);
    world.step([inventoryActionCommand(actor, { op: 'use', instanceId: draught })]);
    expect(units('healing-draught')).toBe(1);
    expect(world.get(actor, HealthComponent)?.current).toBe(70);
    expect(done).toEqual([
      {
        tick: 0,
        actor,
        action: { op: 'use', instanceId: draught },
        defId: 'healing-draught',
        ok: true,
      },
    ]);
  });

  it('reports a refused use with the pipeline’s reason and changes nothing', () => {
    const { sim, actor, give, units, actions } = setup();
    const sword = give('arming-sword');
    expect(actions.apply(sim, actor, { op: 'use', instanceId: sword })).toEqual({
      ok: false,
      reason: 'not-usable',
    });
    expect(units('arming-sword')).toBe(1);
  });

  it('assigns a consumable to a quick slot, moving it out of any other slot', () => {
    const { sim, actor, give, actions } = setup();
    const draught = give('healing-draught', 3);
    const oil = give('oil-flask');
    expect(actions.apply(sim, actor, { op: 'assign', instanceId: draught, slot: 0 })).toEqual({
      ok: true,
    });
    actions.apply(sim, actor, { op: 'assign', instanceId: oil, slot: 2 });
    actions.apply(sim, actor, { op: 'assign', instanceId: draught, slot: 1 });
    expect(quickSlotsOf(sim, actor)?.slots).toEqual([
      null,
      { defId: 'healing-draught', instanceId: draught },
      { defId: 'oil-flask', instanceId: oil },
      null,
    ]);
    actions.apply(sim, actor, { op: 'clear-slot', slot: 2 });
    expect(quickSlotsOf(sim, actor)?.slots[2]).toBeNull();
  });

  it('refuses to put an item that is not usable in a quick slot', () => {
    const { sim, actor, give, actions, done } = setup();
    const sword = give('arming-sword');
    expect(actions.apply(sim, actor, { op: 'assign', instanceId: sword, slot: 0 })).toEqual({
      ok: false,
      reason: 'not-assignable',
    });
    sim.events.flush();
    expect(done.at(-1)).toMatchObject({
      ok: false,
      reason: 'not-assignable',
      defId: 'arming-sword',
    });
  });

  it('drops and throws through the world items, refusing quest items and a missing view', () => {
    const { sim, actor, give, units, actions } = setup();
    const draught = give('healing-draught', 3);
    const oil = give('oil-flask', 2);
    const key = give('gallery-key');
    expect(actions.apply(sim, actor, { op: 'drop', instanceId: draught })).toEqual({ ok: true });
    expect(units('healing-draught')).toBe(0);
    expect(actions.apply(sim, actor, { op: 'throw', instanceId: oil })).toEqual({ ok: true });
    expect(units('oil-flask')).toBe(1);
    expect(actions.apply(sim, actor, { op: 'drop', instanceId: key })).toEqual({
      ok: false,
      reason: 'no-drop',
    });
    let lying = 0;
    sim.query(WorldItemComponent).forEach(() => (lying += 1));
    expect(lying).toBe(2);

    const blind = setup({ view: false });
    const flask = blind.give('oil-flask');
    expect(blind.actions.apply(blind.sim, blind.actor, { op: 'drop', instanceId: flask })).toEqual({
      ok: false,
      reason: 'no-view',
    });
  });

  it('equips and unequips through the equipment rules; a dropped item leaves its slot', () => {
    const { sim, actor, give, actions } = setup();
    addEquipment(sim, actor, 'knight');
    const sword = give('arming-sword');
    const draught = give('healing-draught');
    expect(actions.apply(sim, actor, { op: 'equip', instanceId: sword })).toEqual({ ok: true });
    expect(equipmentOf(sim, actor)?.slots['main-hand']).toEqual({
      instanceId: sword,
      defId: 'arming-sword',
    });
    expect(actions.apply(sim, actor, { op: 'unequip', instanceId: draught })).toEqual({
      ok: false,
      reason: 'not-equipped',
    });
    expect(actions.apply(sim, actor, { op: 'unequip', instanceId: sword })).toEqual({ ok: true });
    expect(equipmentOf(sim, actor)?.slots['main-hand']).toBeNull();
    expect(actions.apply(sim, actor, { op: 'equip', instanceId: draught })).toEqual({
      ok: false,
      reason: 'not-equippable',
    });

    actions.apply(sim, actor, { op: 'equip', instanceId: sword });
    actions.apply(sim, actor, { op: 'drop', instanceId: sword });
    expect(equipmentOf(sim, actor)?.slots['main-hand']).toBeNull();
    expect(inventoryOf(sim, actor)?.items.map((i) => i.defId)).toEqual(['healing-draught']);
  });

  it('refuses equip and unequip without equipment slots or rules', () => {
    const classless = setup();
    const sword = classless.give('arming-sword');
    const { sim, actor, actions } = classless;
    expect(actions.apply(sim, actor, { op: 'equip', instanceId: sword })).toEqual({
      ok: false,
      reason: 'no-equipment',
    });
    expect(actions.apply(sim, actor, { op: 'unequip', instanceId: sword })).toEqual({
      ok: false,
      reason: 'no-equipment',
    });

    const ruleless = setup({ equipment: false });
    addEquipment(ruleless.sim, ruleless.actor, 'knight');
    const blade = ruleless.give('arming-sword');
    expect(
      ruleless.actions.apply(ruleless.sim, ruleless.actor, { op: 'equip', instanceId: blade }),
    ).toEqual({ ok: false, reason: 'no-equipment' });
    // A drop without equipment rules has nothing to reconcile.
    expect(
      ruleless.actions.apply(ruleless.sim, ruleless.actor, { op: 'drop', instanceId: blade }),
    ).toEqual({ ok: true });
  });

  it('drops from the handler’s own view by default (none without a character)', () => {
    const { sim, actor, give, units } = setup();
    sim.register(CharacterController, PlayerLook);
    const actions = new InventoryActions({ consumables: new Consumables(DEFS) });
    const flask = give('oil-flask');
    expect(actions.apply(sim, actor, { op: 'drop', instanceId: flask })).toEqual({
      ok: false,
      reason: 'no-view',
    });
    expect(units('oil-flask')).toBe(1);
  });

  it('reports an unknown instance with defId null', () => {
    const { sim, actor, actions, done } = setup();
    actions.apply(sim, actor, { op: 'drop', instanceId: 99 });
    sim.events.flush();
    expect(done).toEqual([
      {
        tick: 0,
        actor,
        action: { op: 'drop', instanceId: 99 },
        defId: null,
        ok: false,
        reason: 'no-instance',
      },
    ]);
  });

  it('the system skips other inputs and actors without an inventory or quick slots', () => {
    const { world, sim, actor, give, units, done } = setup();
    const draught = give('healing-draught');
    const stranger = world.spawn();
    const packOnly = world.spawn();
    addInventory(sim, packOnly);
    world.step([]); // structural adds land
    world.step([
      { kind: 'something-else' },
      inventoryActionCommand(stranger, { op: 'use', instanceId: 1 }),
      inventoryActionCommand(packOnly, { op: 'use', instanceId: 1 }),
      inventoryActionCommand(actor, { op: 'use', instanceId: draught }),
    ]);
    expect(units('healing-draught')).toBe(0);
    expect(done.map((e) => e.actor)).toEqual([actor]);
  });
});
