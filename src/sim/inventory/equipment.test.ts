import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import {
  addEquipment,
  DEFAULT_LOAD_TUNING,
  emptySlots,
  EQUIPMENT_SLOTS,
  equipChanged,
  equipmentOf,
  EquipmentRules,
  type EquipChanged,
  type EquipmentClassDef,
  type EquipmentItemDef,
  type SlotMap,
} from './equipment';
import { addInventory, InventoryRules, type InventoryItemDef } from './inventory';

type Def = EquipmentItemDef & Omit<InventoryItemDef, 'grants'>;

/** The item schema's default penalty (content's DEFAULT_NON_PROFICIENT_PENALTY). */
const DEFAULT_PENALTY = {
  drawTimeMultiplier: 1.5,
  staminaCostMultiplier: 1.25,
  noiseMultiplier: 1,
};

const item = (
  id: string,
  category: Def['category'],
  extra: Partial<Omit<Def, 'id' | 'category'>> = {},
): Def => ({
  id,
  category,
  stackable: false,
  flags: { unique: false, questItem: false },
  ...extra,
});

const equip = (slot: NonNullable<Def['equip']>['slot'], proficiencies: string[] = []) => ({
  equip: { slot, proficiencies, nonProficient: DEFAULT_PENALTY },
});

const ITEMS: readonly Def[] = [
  item('sword', 'weapon', equip('main-hand', ['blades'])),
  item('dagger', 'weapon', equip('off-hand', ['daggers'])),
  item('greatsword', 'weapon', equip('both-hands', ['blades'])),
  item('kite-shield', 'shield', { ...equip('off-hand', ['shields']), shield: { weightKg: 6 } }),
  item('buckler', 'shield', { ...equip('off-hand', ['shields']), shield: { weightKg: 1 } }),
  item('plate-helm', 'armor', { ...equip('head', ['heavy-armor']), armor: { weightKg: 4 } }),
  item('plate-cuirass', 'armor', {
    equip: {
      slot: 'body',
      proficiencies: ['heavy-armor'],
      nonProficient: { drawTimeMultiplier: 1, staminaCostMultiplier: 1.4, noiseMultiplier: 1.1 },
    },
    armor: { weightKg: 12 },
  }),
  item('plate-gauntlets', 'armor', { ...equip('hands', ['heavy-armor']), armor: { weightKg: 3 } }),
  item('plate-sabatons', 'armor', { ...equip('feet', ['heavy-armor']), armor: { weightKg: 3 } }),
  item('leather-jerkin', 'armor', { ...equip('body', ['light-armor']), armor: { weightKg: 3 } }),
  item('soft-boots', 'armor', {
    ...equip('feet', ['light-armor']),
    armor: { weightKg: 1 },
    worldProperties: { noiseMultiplier: 0.7 },
  }),
  item('bell-charm', 'artifact', {
    ...equip('trinket'),
    worldProperties: { noiseMultiplier: 1.5 },
  }),
  item('owl-charm', 'artifact', {
    ...equip('trinket'),
    grants: [
      { capability: 'sense.night-eyes', while: 'equipped' },
      { capability: 'spell.mage-hand', while: 'carried' },
    ],
  }),
  item('fox-charm', 'artifact', {
    ...equip('trinket'),
    grants: [{ capability: 'sense.night-eyes', while: 'equipped' }],
  }),
  item('lantern', 'tool', {
    ...equip('tool-belt'),
    worldProperties: { lightEmitter: { intensity: 60, radius: 6 } },
  }),
  item('glowstone', 'tool', {
    ...equip('tool-belt'),
    worldProperties: { lightEmitter: { intensity: 20, radius: 3 } },
  }),
  item('arrow', 'ammo', { stackable: true, maxStack: 50 }),
  item('apple', 'consumable', { stackable: true, maxStack: 5 }),
];

const CLASSES: readonly EquipmentClassDef[] = [
  {
    id: 'knight',
    proficiencies: ['blades', 'shields', 'light-armor', 'heavy-armor'],
    armorCapacityKg: 30,
  },
  { id: 'sorcerer', proficiencies: ['staves', 'daggers', 'light-armor'], armorCapacityKg: 23 },
  { id: 'thief', proficiencies: ['blades', 'daggers', 'light-armor'], armorCapacityKg: 23 },
];

const PLATE = ['plate-helm', 'plate-cuirass', 'plate-gauntlets', 'plate-sabatons'];

/** A world with one actor of `classId` holding one of each `defIds`, the rules and its events. */
function setup(classId: string, defIds: readonly string[] = []) {
  const world = new World({ seed: 1 });
  const actor = world.spawn();
  addInventory(world, actor);
  addEquipment(world, actor, classId);
  const inventory = new InventoryRules(ITEMS);
  const rules = new EquipmentRules(ITEMS, CLASSES);
  const ids = new Map<string, number>();
  for (const defId of defIds) {
    const added = inventory.add(world, actor, defId, defId === 'arrow' ? 20 : 1);
    if (!added.ok) throw new Error(`could not add ${defId}`);
    ids.set(defId, added.instanceIds[0] ?? 0);
  }
  const id = (defId: string): number => ids.get(defId) ?? -1;
  const events: EquipChanged[] = [];
  world.events.on(equipChanged, (e) => events.push(e));
  const flush = () => {
    world.events.flush();
    return events.splice(0);
  };
  const wear = (...defIds: string[]) => {
    for (const defId of defIds) expect(rules.equip(world, actor, id(defId)).ok).toBe(true);
  };
  const held = (): Partial<Record<string, string>> =>
    Object.fromEntries(
      EQUIPMENT_SLOTS.flatMap((slot) => {
        const ref = equipmentOf(world, actor)?.slots[slot] ?? null;
        return ref === null ? [] : [[slot, ref.defId]];
      }),
    );
  return { world, actor, inventory, rules, id, flush, wear, held };
}

describe('equipment slots (mw-e17.4)', () => {
  it('AC-1: a two-handed greatsword displaces the sword and the shield and fills both hands', () => {
    const { world, actor, rules, id, wear, held, inventory, flush } = setup('knight', [
      'sword',
      'kite-shield',
      'greatsword',
    ]);
    wear('sword', 'kite-shield');
    flush();
    const result = rules.equip(world, actor, id('greatsword'));
    expect(result).toEqual({
      ok: true,
      changed: true,
      unequipped: [
        { instanceId: id('sword'), defId: 'sword' },
        { instanceId: id('kite-shield'), defId: 'kite-shield' },
      ],
    });
    const greatsword = { instanceId: id('greatsword'), defId: 'greatsword' };
    expect(equipmentOf(world, actor)?.slots['main-hand']).toEqual(greatsword);
    expect(equipmentOf(world, actor)?.slots['off-hand']).toEqual(greatsword);
    expect(held()).toEqual({ 'main-hand': 'greatsword', 'off-hand': 'greatsword' });
    // Both are back in the pack only: still in the inventory, in no slot.
    expect(inventory.query(world, actor).map((i) => i.defId)).toEqual([
      'sword',
      'kite-shield',
      'greatsword',
    ]);
    expect(flush()).toHaveLength(1);
  });

  it('AC-1: a one-handed item or a shield takes a two-handed item out of both hands', () => {
    const { world, actor, rules, id, wear, held } = setup('knight', [
      'sword',
      'kite-shield',
      'greatsword',
    ]);
    wear('greatsword');
    expect(rules.equip(world, actor, id('kite-shield'))).toMatchObject({
      unequipped: [{ defId: 'greatsword' }],
    });
    expect(held()).toEqual({ 'off-hand': 'kite-shield' });
    wear('greatsword', 'sword');
    expect(held()).toEqual({ 'main-hand': 'sword' });
  });

  it('AC-1: unequipping either hand of a two-handed item empties both', () => {
    const { world, actor, rules, wear, held } = setup('knight', ['greatsword']);
    wear('greatsword');
    expect(rules.unequip(world, actor, 'off-hand')).toMatchObject({ ok: true, changed: true });
    expect(held()).toEqual({});
    expect(rules.unequip(world, actor, 'main-hand')).toEqual({ ok: false, reason: 'empty' });
  });

  it('AC-2: a sorcerer in heavy plate equips it and pays the data-defined penalty', () => {
    const { world, actor, rules, id } = setup('sorcerer', PLATE);
    expect(rules.equip(world, actor, id('plate-cuirass'))).toMatchObject({
      ok: true,
      changed: true,
    });
    const state = rules.state(world, actor);
    expect(state.penalties).toEqual([
      {
        slot: 'body',
        defId: 'plate-cuirass',
        missing: ['heavy-armor'],
        penalty: { drawTimeMultiplier: 1, staminaCostMultiplier: 1.4, noiseMultiplier: 1.1 },
      },
    ]);
    // 12 kg of 23: Medium (1.3), times the cuirass's own non-proficiency noise (1.1).
    expect(state.loadClass).toBe('medium');
    expect(state.noiseModifier).toBeCloseTo(1.3 * 1.1, 10);
  });

  it('AC-2: each item pays its own penalty; a proficient class pays none', () => {
    const sorcerer = setup('sorcerer', ['plate-helm', 'greatsword']);
    sorcerer.wear('plate-helm', 'greatsword');
    expect(sorcerer.rules.state(sorcerer.world, sorcerer.actor).penalties).toEqual([
      {
        slot: 'main-hand',
        defId: 'greatsword',
        missing: ['blades'],
        penalty: DEFAULT_PENALTY,
      },
      {
        slot: 'head',
        defId: 'plate-helm',
        missing: ['heavy-armor'],
        penalty: DEFAULT_PENALTY,
      },
    ]);
    const knight = setup('knight', PLATE);
    knight.wear(...PLATE);
    expect(knight.rules.state(knight.world, knight.actor).penalties).toEqual([]);
  });

  it('AC-3: an item without an equip block fails with not-equippable', () => {
    const { world, actor, rules, id, flush } = setup('thief', ['apple']);
    expect(rules.equip(world, actor, id('apple'))).toEqual({
      ok: false,
      reason: 'not-equippable',
    });
    expect(rules.slotsFor('apple')).toEqual([]);
    expect(equipmentOf(world, actor)?.slots).toEqual(emptySlots());
    expect(flush()).toEqual([]);
  });

  it('AC-3: ammo, which has no equip block, goes in the quiver', () => {
    const { world, actor, rules, id, held } = setup('thief', ['arrow']);
    expect(rules.equip(world, actor, id('arrow')).ok).toBe(true);
    expect(held()).toEqual({ ammo: 'arrow' });
  });

  it('AC-3: other refusals: no such instance, a slot the item does not fit', () => {
    const { world, actor, rules, id } = setup('knight', ['sword']);
    expect(rules.equip(world, actor, 999)).toEqual({ ok: false, reason: 'no-instance' });
    expect(rules.equip(world, actor, id('sword'), 'off-hand')).toEqual({
      ok: false,
      reason: 'wrong-slot',
    });
    expect(rules.equip(world, actor, id('sword'), 'main-hand').ok).toBe(true);
  });

  it('AC-4: every change emits exactly one equip.changed with the slot maps before and after', () => {
    const { world, actor, rules, id, wear, flush } = setup('knight', [
      'sword',
      'kite-shield',
      'greatsword',
    ]);
    wear('sword', 'kite-shield');
    const before = equipmentOf(world, actor)?.slots;
    flush();
    rules.equip(world, actor, id('greatsword'));
    const events = flush();
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.actor).toBe(actor);
    expect(event?.tick).toBe(0);
    expect(event?.before).toEqual(before);
    expect(event?.after).toEqual(equipmentOf(world, actor)?.slots);
    expect(event?.before['off-hand']?.defId).toBe('kite-shield');
    expect(event?.after['off-hand']?.defId).toBe('greatsword');

    rules.unequip(world, actor, 'main-hand');
    expect(flush()).toHaveLength(1);
  });

  it('AC-4: a request that changes nothing emits nothing', () => {
    const { world, actor, rules, id, wear, flush } = setup('knight', ['sword', 'greatsword']);
    wear('sword', 'greatsword');
    flush();
    expect(rules.equip(world, actor, id('greatsword'))).toEqual({
      ok: true,
      changed: false,
      unequipped: [],
    });
    expect(rules.equip(world, actor, id('greatsword'), 'off-hand')).toMatchObject({
      changed: false,
    });
    expect(flush()).toEqual([]);
  });

  it('AC-5: heavy body armor makes the load class heavy with its data noise value', () => {
    const { world, actor, rules, wear } = setup('knight', PLATE);
    wear(...PLATE);
    const state = rules.state(world, actor);
    // ADR-0003: a 22 kg plate set is 73% of a knight's 30 kg, Heavy, noise ×1.6.
    expect(state.armorKg).toBe(22);
    expect(state.capacityKg).toBe(30);
    expect(state.loadRatio).toBeCloseTo(22 / 30, 10);
    expect(state.loadClass).toBe('heavy');
    expect(state.loadNoiseMultiplier).toBe(DEFAULT_LOAD_TUNING.noise.heavy);
    expect(state.noiseModifier).toBe(1.6);
  });

  it('wornKg is what the actor wears, 0 without equipment (mw-e03.19)', () => {
    const { world, actor, rules, wear } = setup('knight', PLATE);
    expect(rules.wornKg(world, actor)).toBe(0);
    wear(...PLATE);
    expect(rules.wornKg(world, actor)).toBe(22);
    expect(rules.wornKg(world, world.spawn())).toBe(0);
  });

  it('AC-5: load classes follow ADR-0003 thresholds and class capacity', () => {
    const { rules } = setup('knight');
    expect(rules.loadClassOf(0)).toBe('light');
    expect(rules.loadClassOf(0.3)).toBe('light');
    expect(rules.loadClassOf(0.31)).toBe('medium');
    expect(rules.loadClassOf(0.7)).toBe('medium');
    expect(rules.loadClassOf(0.71)).toBe('heavy');
    expect(rules.loadClassOf(1)).toBe('heavy');
    expect(rules.loadClassOf(1.01)).toBe('overloaded');

    // Plate with a kite shield: 28 kg is Heavy for a knight (93%), Overloaded for a thief (122%).
    const knight = setup('knight', [...PLATE, 'kite-shield']);
    knight.wear(...PLATE, 'kite-shield');
    expect(knight.rules.state(knight.world, knight.actor).loadClass).toBe('heavy');
    const thief = setup('thief', [...PLATE, 'kite-shield', 'buckler']);
    thief.wear(...PLATE, 'kite-shield');
    const overloaded = thief.rules.state(thief.world, thief.actor);
    expect(overloaded.loadClass).toBe('overloaded');
    expect(overloaded.loadNoiseMultiplier).toBe(1.8);
    // Plate with a buckler (23 kg) is exactly 100% for a thief: still Heavy.
    thief.wear('buckler');
    expect(thief.rules.state(thief.world, thief.actor).armorKg).toBe(23);
    expect(thief.rules.state(thief.world, thief.actor).loadClass).toBe('heavy');
  });

  it('AC-5: weapons, trinkets, tools and ammo weigh nothing; item noise multiplies in, clamped', () => {
    const { world, actor, rules, wear } = setup('thief', [
      'sword',
      'dagger',
      'leather-jerkin',
      'soft-boots',
      'bell-charm',
      'arrow',
      'lantern',
    ]);
    wear('sword', 'dagger', 'arrow', 'lantern', 'leather-jerkin');
    let state = rules.state(world, actor);
    expect(state.armorKg).toBe(3);
    expect(state.loadClass).toBe('light');
    expect(state.noiseModifier).toBe(1);
    wear('soft-boots');
    state = rules.state(world, actor);
    expect(state.armorKg).toBe(4);
    expect(state.noiseModifier).toBeCloseTo(0.7, 10);
    wear('bell-charm');
    expect(rules.state(world, actor).noiseModifier).toBeCloseTo(0.7 * 1.5, 10);

    const loud = setup('thief', [...PLATE, 'kite-shield', 'bell-charm']);
    loud.wear(...PLATE, 'kite-shield', 'bell-charm');
    // 1.8 × 1.5 × the default helm/gauntlet/sabaton penalties (×1 noise) × the cuirass's 1.1.
    expect(loud.rules.state(loud.world, loud.actor).noiseModifier).toBe(2);
  });

  it('derives the strongest light and the capabilities granted while equipped', () => {
    const { world, actor, rules, wear } = setup('thief', [
      'glowstone',
      'lantern',
      'owl-charm',
      'fox-charm',
    ]);
    expect(rules.state(world, actor)).toMatchObject({ light: null, capabilities: [] });
    wear('glowstone', 'lantern', 'owl-charm', 'fox-charm');
    const state = rules.state(world, actor);
    expect(state.light).toEqual({ intensity: 60, radius: 6 });
    expect(state.capabilities).toEqual(['sense.night-eyes']);

    const dim = setup('thief', ['lantern', 'glowstone']);
    dim.wear('lantern', 'glowstone');
    expect(dim.rules.state(dim.world, dim.actor).light).toEqual({ intensity: 60, radius: 6 });
  });

  it('paired slots take the first free one, else the first; an equipped item can move', () => {
    const { world, actor, rules, id, wear, held } = setup('thief', [
      'bell-charm',
      'owl-charm',
      'fox-charm',
    ]);
    wear('bell-charm', 'owl-charm');
    expect(held()).toEqual({ 'trinket-1': 'bell-charm', 'trinket-2': 'owl-charm' });
    expect(rules.equip(world, actor, id('fox-charm'))).toMatchObject({
      unequipped: [{ defId: 'bell-charm' }],
    });
    expect(held()).toEqual({ 'trinket-1': 'fox-charm', 'trinket-2': 'owl-charm' });
    expect(rules.equip(world, actor, id('fox-charm'), 'trinket-2')).toMatchObject({
      unequipped: [{ defId: 'owl-charm' }],
    });
    expect(held()).toEqual({ 'trinket-2': 'fox-charm' });
  });

  it('an item that left the inventory counts as unequipped and reconcile clears its slot', () => {
    const { world, actor, rules, inventory, id, wear, held, flush } = setup('knight', [
      'plate-cuirass',
      'sword',
    ]);
    wear('plate-cuirass', 'sword');
    flush();
    expect(rules.reconcile(world, actor)).toEqual({ ok: true, changed: false, unequipped: [] });
    inventory.remove(world, actor, { instanceId: id('plate-cuirass'), count: 1 });
    expect(rules.state(world, actor).armorKg).toBe(0);
    expect(rules.reconcile(world, actor)).toEqual({
      ok: true,
      changed: true,
      unequipped: [{ instanceId: id('plate-cuirass'), defId: 'plate-cuirass' }],
    });
    expect(held()).toEqual({ 'main-hand': 'sword' });
    expect(flush().filter((e) => e.actor === actor)).toHaveLength(1);
  });

  it('is plain data on the actor: snapshots and hashes carry it', () => {
    const a = setup('knight', ['sword']);
    const b = setup('knight', ['sword']);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    a.wear('sword');
    expect(hashWorld(a.world)).not.toBe(hashWorld(b.world));
    b.wear('sword');
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    const slots: SlotMap | undefined = equipmentOf(a.world, a.actor)?.slots;
    expect(Object.keys(slots ?? {})).toEqual([...EQUIPMENT_SLOTS]);
  });

  it('throws for an actor without equipment or inventory, or unknown ids', () => {
    const world = new World({ seed: 1 });
    const actor = world.spawn();
    const rules = new EquipmentRules(ITEMS, CLASSES);
    expect(equipmentOf(world, actor)).toBeUndefined();
    expect(() => rules.state(world, actor)).toThrow(/has no equipment/);
    addEquipment(world, actor, 'knight');
    expect(() => rules.equip(world, actor, 1)).toThrow(/has no inventory/);
    expect(() => rules.def('nope')).toThrow(/item "nope" is not defined/);
    const stranger = world.spawn();
    addEquipment(world, stranger, 'bard');
    expect(() => rules.state(world, stranger)).toThrow(/class "bard" is not defined/);
  });

  it('accepts its own load tuning', () => {
    const rules = new EquipmentRules(ITEMS, CLASSES, {
      load: { ...DEFAULT_LOAD_TUNING, maxRatio: { light: 0.1, medium: 0.2, heavy: 0.3 } },
    });
    expect(rules.loadClassOf(0.25)).toBe('heavy');
  });
});
