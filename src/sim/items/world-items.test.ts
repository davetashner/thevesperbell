// World items (mw-e17.7) on the real deterministic Rapier build: taking an item with Interact,
// dropping and throwing from the pack, impact noise by weight class, and no-drop quest items.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { box } from '../character/greybox';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { cos } from '../math';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import { interacted, interactionPrompt } from '../interaction/system';
import { addInteractor, installInteraction } from '../interaction/system';
import {
  addInventory,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  type ItemInstanceFlags,
} from '../inventory/inventory';
import {
  BREAKABLE_COMPONENTS,
  BreakableComponent,
  type BreakableProfile,
} from '../breakables/components';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { installImpactNoise, ITEM_IMPACT_NOISE } from '../noise/impacts';
import { DEFAULT_NOISE_TUNING } from '../noise/propagation';
import { installPhysicsObjects, PhysicsObjectComponent, physicsImpact } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { PlayerLook } from '../player/player';
import { readProperty, registerWorldProperties } from '../properties/components';
import { hashWorld } from '../snapshot';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli } from '../stimulus/stimulus';
import {
  addSceneItems,
  DROP_DISTANCE,
  DROP_HEIGHT,
  handlerView,
  installWorldItems,
  ITEM_HALF_EXTENTS,
  itemDropped,
  itemDropRefused,
  itemPickedUp,
  itemPickupRefused,
  readableName,
  THROW_HEIGHT,
  THROW_LOFT,
  THROW_SPEED,
  WEIGHT_CLASS_KG,
  WorldItemComponent,
  WorldItems,
  worldItemsSystem,
  type ItemDropped,
  type ItemDropRefused,
  type ItemHandlerView,
  type ItemPickedUp,
  type ItemPickupRefused,
  type WorldItemDef,
  type WorldItemsInstallOptions,
} from './world-items';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** `value`, or a thrown error when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);

/** A frame with the given buttons pressed this tick. */
function frame(...pressed: ('interact' | 'drop' | 'throw')[]): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => ((pressed as string[]).includes(action) ? DOWN : UP),
  });
}
const IDLE = frame();

const item = (
  id: string,
  category: WorldItemDef['category'],
  extra: Partial<Omit<WorldItemDef, 'flags'>> & {
    unique?: boolean;
    questItem?: boolean;
    noDrop?: boolean;
  } = {},
): WorldItemDef => {
  const { unique = false, questItem = category === 'quest', noDrop = questItem, ...rest } = extra;
  return {
    id,
    category,
    stackable: false,
    weightClass: 'light',
    flags: { unique, questItem, noDrop },
    ...rest,
  };
};

const ITEMS: readonly WorldItemDef[] = [
  item('healing-draught', 'consumable', {
    stackable: true,
    maxStack: 10,
    worldProperties: { material: 'glass' },
  }),
  item('arming-sword', 'weapon', { weightClass: 'medium' }),
  item('anvil', 'misc', { weightClass: 'heavy', worldProperties: { weight: 40 } }),
  item('rusted-gallery-key', 'key', { questItem: true }),
  item('old-relic', 'quest', { noDrop: false }),
  item('crown', 'artifact', { unique: true }),
  item('gold', 'currency', { stackable: true, maxStack: 9999 }),
];

const MATERIALS = new Map([['glass', { material: 'glass', friction: 0.4, impactAbsorb: 0.5 }]]);

interface Setup {
  readonly world: World<ActionFrame>;
  readonly sim: World<never>;
  readonly physics: RapierPhysics;
  readonly items: WorldItems;
  readonly actor: EntityId;
  readonly picked: ItemPickedUp[];
  readonly refusedPickups: ItemPickupRefused[];
  readonly dropped: ItemDropped[];
  readonly refusedDrops: ItemDropRefused[];
  readonly noises: NoiseEvent[];
}

/**
 * A world on a stone floor (top at y = 0) with physics objects, interaction and world items, and a
 * player-like actor at the origin facing −z with an empty inventory.
 */
function setup(
  options: { install?: WorldItemsInstallOptions<ActionFrame>; items?: WorldItems } = {},
): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(new World<ActionFrame>({ seed: 7, physics })),
  );
  world.register(CharacterController, PlayerLook);
  const sim = world as unknown as World<never>;
  installPhysicsObjects(sim);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  installInteraction(world);
  const items = options.items ?? new WorldItems(ITEMS, { materials: MATERIALS });
  installWorldItems(world, items, options.install);
  const actor = world.spawn();
  world.add(actor, CharacterController, initialCharacterState(v(0, 0, 0)));
  world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(sim, actor);
  addInventory(sim, actor);
  const picked: ItemPickedUp[] = [];
  const refusedPickups: ItemPickupRefused[] = [];
  const dropped: ItemDropped[] = [];
  const refusedDrops: ItemDropRefused[] = [];
  const noises: NoiseEvent[] = [];
  world.events.on(itemPickedUp, (e) => picked.push(e));
  world.events.on(itemPickupRefused, (e) => refusedPickups.push(e));
  world.events.on(itemDropped, (e) => dropped.push(e));
  world.events.on(itemDropRefused, (e) => refusedDrops.push(e));
  world.events.on(noiseEmitted, (e) => noises.push(e));
  return {
    world,
    sim,
    physics,
    items,
    actor,
    picked,
    refusedPickups,
    dropped,
    refusedDrops,
    noises,
  };
}

/** Places `defId` resting on the floor `d` m in front of the actor (−z). */
function placeAhead(s: Setup, defId: string, d = 1, extra: { count?: number } = {}): EntityId {
  const half = ITEM_HALF_EXTENTS[s.items.def(defId).category];
  return s.items.spawn(s.sim, { defId, position: v(0, half.y, -d), ...extra });
}

const pack = (s: Setup) => inventoryOf(s.sim, s.actor)?.items ?? [];
const worldItems = (s: Setup) => s.world.query(WorldItemComponent).ids();

describe('world items while the hands are busy (mw-e02.17)', () => {
  it('the pack ignores Drop and Throw while the actor carries something else', () => {
    let busy = true;
    const s = setup({ install: { busy: () => busy } });
    s.items.inventory.add(s.sim, s.actor, 'arming-sword', 1);
    s.world.step([frame('drop')]);
    s.world.step([frame('throw')]);
    expect(s.dropped).toEqual([]);
    expect(pack(s)).toHaveLength(1);
    busy = false;
    s.world.step([frame('drop')]);
    expect(pack(s)).toHaveLength(0);
  });
});

describe('world items (mw-e17.7)', () => {
  it('AC-1: interacting with an item in range adds it to the inventory and despawns it in the same tick', () => {
    const s = setup();
    const entity = placeAhead(s, 'healing-draught');
    s.world.step([IDLE]); // focus settles on the draught
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({
      target: entity,
      verb: 'pick-up',
      label: 'Take Healing draught',
      available: true,
    });
    const tick = s.world.tick;
    s.world.step([frame('interact')]);
    expect(s.picked).toEqual([
      { tick, actor: s.actor, entity, defId: 'healing-draught', count: 1, flags: {} },
    ]);
    expect(pack(s)).toEqual([{ instanceId: 1, defId: 'healing-draught', count: 1, flags: {} }]);
    expect(s.world.isAlive(entity)).toBe(false);
    expect(worldItems(s)).toEqual([]);
  });

  it('AC-1: a stack lying in the world joins the pack whole, and its prompt shows the count', () => {
    const s = setup();
    placeAhead(s, 'healing-draught', 1, { count: 3 });
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)?.label).toBe('Take Healing draught (3)');
    s.world.step([frame('interact')]);
    expect(s.items.inventory.count(s.sim, s.actor, { defId: 'healing-draught' })).toBe(3);
  });

  it('AC-2: a dropped stack spawns in front of the player as one world item with identical flags', () => {
    const s = setup();
    const flags: ItemInstanceFlags = { stolen: true, ownerId: 'abbey' };
    s.items.inventory.add(s.sim, s.actor, 'healing-draught', 4, flags);
    s.items.inventory.add(s.sim, s.actor, 'healing-draught', 1);
    // The stolen stack was acquired first; drop it by its instance id.
    const stolen = must(pack(s)[0]);
    const tick = s.world.tick;
    const result = s.items.drop(s.sim, s.actor, must(handlerView(s.sim, s.actor)), {
      instanceId: stolen.instanceId,
    });
    expect(result.ok).toBe(true);
    s.world.events.flush();
    const entity = (result as { entity: EntityId }).entity;
    expect(s.dropped).toEqual([
      {
        tick,
        actor: s.actor,
        entity,
        defId: 'healing-draught',
        count: 4,
        flags,
        thrown: false,
        position: v(0, DROP_HEIGHT, -DROP_DISTANCE),
      },
    ]);
    expect(s.world.get(entity, WorldItemComponent)).toEqual({
      defId: 'healing-draught',
      count: 4,
      flags,
      by: s.actor,
    });
    expect(pack(s)).toEqual([{ instanceId: 2, defId: 'healing-draught', count: 1, flags: {} }]);
    // Its world properties come from the item: glass, light.
    expect(readProperty(s.sim, entity, 'material')).toBe('glass');
    expect(readProperty(s.sim, entity, 'weight')).toBe(WEIGHT_CLASS_KG.light);
    // Taken back, the stolen units stay apart from the clean one.
    s.world.step([IDLE]);
    s.world.step([frame('interact')]);
    expect(pack(s)).toEqual([
      { instanceId: 2, defId: 'healing-draught', count: 1, flags: {} },
      { instanceId: 3, defId: 'healing-draught', count: 4, flags },
    ]);
  });

  it('AC-2: the drop button drops the selected stack in front of the player, turned to face', () => {
    const s = setup();
    s.world.set(s.actor, PlayerLook, { yaw: Math.PI / 2, pitch: 0 }); // facing −x
    s.items.inventory.add(s.sim, s.actor, 'arming-sword', 1, { bound: true });
    s.world.step([frame('drop')]);
    expect(s.dropped).toHaveLength(1);
    const { entity, position, flags } = must(s.dropped[0]);
    expect(flags).toEqual({ bound: true });
    expect(position.x).toBeCloseTo(-DROP_DISTANCE, 12);
    expect(position.z).toBeCloseTo(0, 12);
    expect(pack(s)).toEqual([]);
    expect(s.world.isAlive(entity)).toBe(true); // live from the end of the drop's tick
    expect(s.world.get(entity, PhysicsObjectComponent)?.rotation.y).toBeCloseTo(Math.SQRT1_2, 12);
    for (let i = 0; i < 60; i++) s.world.step([IDLE]);
    // It fell to the floor in front of the player.
    expect(placementOf(s.sim, entity)?.y).toBeCloseTo(ITEM_HALF_EXTENTS.weapon.y, 2);
  });

  it('AC-3: a thrown item that hits a surface makes a noise attributed to the thrower', () => {
    for (const defId of ['healing-draught', 'arming-sword', 'anvil']) {
      const s = setup();
      installImpactNoise(s.world, { curve: DEFAULT_NOISE_TUNING.impact });
      s.items.inventory.add(s.sim, s.actor, defId, 1);
      s.world.step([frame('throw')]);
      expect(s.dropped).toMatchObject([{ defId, count: 1, thrown: true }]);
      const { entity } = must(s.dropped[0]);
      const impacts: number[] = [];
      s.world.events.on(physicsImpact, (impact) => {
        if (impact.entity === entity) impacts.push(s.world.tick);
      });
      for (let i = 0; i < 120 && impacts.length === 0; i++) s.world.step([IDLE]);
      expect(impacts.length).toBeGreaterThan(0);
      expect(s.noises[0]).toMatchObject({
        tick: impacts[0],
        kind: ITEM_IMPACT_NOISE,
        entity,
        source: s.actor,
      });
    }
  });

  it('a throw takes one unit and leaves at shoulder height along the look, lofted, at its class speed', () => {
    const s = setup();
    s.items.inventory.add(s.sim, s.actor, 'healing-draught', 3);
    const view: ItemHandlerView = { feet: v(1, 0, 2), yaw: 0, pitch: 0.2 };
    const result = s.items.throw(s.sim, s.actor, view, { instanceId: 1 });
    expect(result.ok).toBe(true);
    s.world.events.flush();
    expect(s.dropped[0]).toMatchObject({
      count: 1,
      thrown: true,
      position: v(1, THROW_HEIGHT, 1.5),
    });
    expect(pack(s)[0]?.count).toBe(2);
    const entity = (result as { entity: EntityId }).entity;
    s.world.step([IDLE]);
    const { linvel } = s.physics.motionOf(
      must(s.world.get(entity, PhysicsObjectComponent)).body as never,
    );
    const pitch = 0.2 + THROW_LOFT;
    expect(linvel.z).toBeLessThan(0);
    expect(-linvel.z).toBeCloseTo(cos(pitch) * THROW_SPEED.light, 0);
    expect(linvel.x).toBeCloseTo(0, 6);
  });

  it('AC-4: dropping or throwing a quest item is refused with reason no-drop and changes nothing', () => {
    const s = setup();
    s.items.inventory.add(s.sim, s.actor, 'rusted-gallery-key', 1);
    const before = hashWorld(s.sim);
    const view = must(handlerView(s.sim, s.actor));
    expect(s.items.drop(s.sim, s.actor, view, { instanceId: 1 })).toEqual({
      ok: false,
      reason: 'no-drop',
    });
    expect(s.items.throw(s.sim, s.actor, view, { instanceId: 1 })).toEqual({
      ok: false,
      reason: 'no-drop',
    });
    expect(hashWorld(s.sim)).toBe(before);
    s.world.events.flush();
    expect(s.refusedDrops).toEqual([
      { tick: 0, actor: s.actor, defId: 'rusted-gallery-key', thrown: false, reason: 'no-drop' },
      { tick: 0, actor: s.actor, defId: 'rusted-gallery-key', thrown: true, reason: 'no-drop' },
    ]);
    // The buttons are refused the same way: the key is all there is to select.
    s.world.step([frame('drop')]);
    s.world.step([frame('throw')]);
    expect(s.refusedDrops.slice(2).map((e) => [e.thrown, e.reason])).toEqual([
      [false, 'no-drop'],
      [true, 'no-drop'],
    ]);
    expect(pack(s)).toHaveLength(1);
    expect(worldItems(s)).toEqual([]);
  });

  it('AC-4: the buttons skip a no-drop item for the most recent one that may be dropped', () => {
    const s = setup();
    s.items.inventory.add(s.sim, s.actor, 'arming-sword', 1);
    s.items.inventory.add(s.sim, s.actor, 'rusted-gallery-key', 1);
    expect(s.items.selected(s.sim, s.actor)?.defId).toBe('arming-sword');
    s.world.step([frame('drop')]);
    expect(s.dropped.map((e) => e.defId)).toEqual(['arming-sword']);
    expect(pack(s).map((i) => i.defId)).toEqual(['rusted-gallery-key']);
  });

  it('AC-5: picking up, dropping and taking the same item again leaves one unit and no duplicate', () => {
    const s = setup();
    placeAhead(s, 'healing-draught');
    const total = (): number =>
      s.items.inventory.count(s.sim, s.actor) +
      s.world
        .query(WorldItemComponent)
        .ids()
        .reduce((sum, e) => sum + (s.world.get(e, WorldItemComponent)?.count ?? 0), 0);
    s.world.step([IDLE]);
    s.world.step([frame('interact')]);
    expect([s.items.inventory.count(s.sim, s.actor), worldItems(s).length]).toEqual([1, 0]);
    s.world.step([frame('drop')]);
    expect([s.items.inventory.count(s.sim, s.actor), worldItems(s).length]).toEqual([0, 1]);
    for (let i = 0; i < 30; i++) s.world.step([IDLE]);
    s.world.step([frame('interact')]);
    expect([s.items.inventory.count(s.sim, s.actor), worldItems(s).length]).toEqual([1, 0]);
    expect(total()).toBe(1);
  });

  it('a pick-up the inventory refuses leaves the item where it is', () => {
    const s = setup();
    s.items.inventory.add(s.sim, s.actor, 'crown', 1);
    const entity = placeAhead(s, 'crown');
    s.world.step([IDLE]);
    s.world.step([frame('interact')]);
    expect(s.refusedPickups).toEqual([
      { tick: 1, actor: s.actor, entity, defId: 'crown', reason: 'unique-held' },
    ]);
    expect(s.world.isAlive(entity)).toBe(true);
    expect(s.items.inventory.count(s.sim, s.actor, { defId: 'crown' })).toBe(1);
  });

  it('gold lying in the world goes to the gold counter', () => {
    const s = setup();
    placeAhead(s, 'gold', 1, { count: 25 });
    s.world.step([IDLE]);
    s.world.step([frame('interact')]);
    expect(inventoryOf(s.sim, s.actor)).toMatchObject({ gold: 25, items: [] });
    expect(worldItems(s)).toEqual([]);
  });

  it('a quest item content lets go of (noDrop false) can be dropped', () => {
    const s = setup();
    s.items.inventory.add(s.sim, s.actor, 'old-relic', 1);
    s.world.step([frame('drop')]);
    expect(s.dropped.map((e) => e.defId)).toEqual(['old-relic']);
    expect(pack(s)).toEqual([]);
  });

  it('refuses a drop of an unknown instance, more units than held, or from an empty pack', () => {
    const s = setup();
    const view = must(handlerView(s.sim, s.actor));
    expect(s.items.drop(s.sim, s.actor, view, { instanceId: 9 })).toEqual({
      ok: false,
      reason: 'no-instance',
    });
    s.items.inventory.add(s.sim, s.actor, 'healing-draught', 2);
    expect(s.items.drop(s.sim, s.actor, view, { instanceId: 1, count: 3 })).toEqual({
      ok: false,
      reason: 'not-enough',
    });
    expect(s.items.drop(s.sim, s.actor, view, { instanceId: 1, count: 1 }).ok).toBe(true);
    expect(pack(s)[0]?.count).toBe(1);
    const empty = setup();
    empty.world.step([frame('throw')]);
    expect(empty.refusedDrops).toEqual([
      { tick: 0, actor: empty.actor, defId: null, thrown: true, reason: 'no-instance' },
    ]);
  });

  it('only the first of two actors taking one item in a tick gets it', () => {
    const s = setup();
    const other = s.world.spawn();
    addInventory(s.sim, other);
    const entity = placeAhead(s, 'healing-draught');
    // Both reach for it during one step, so it is still there for the second.
    s.world.addSystem({
      name: 'both',
      run: ({ world }) => {
        for (const actor of [s.actor, other]) {
          world.events.emit(interacted, { actor, target: entity, verb: 'pick-up', affordance: 0 });
        }
      },
    });
    s.world.step([IDLE]);
    expect(s.picked.map((e) => e.actor)).toEqual([s.actor]);
    expect(s.world.isAlive(entity)).toBe(false);
    expect(s.items.inventory.count(s.sim, other)).toBe(0);
  });

  it('ignores other verbs, other targets and actors without an inventory', () => {
    const s = setup();
    const entity = placeAhead(s, 'healing-draught');
    const crate = s.world.spawn();
    const stranger = s.world.spawn();
    s.world.events.emit(interacted, {
      actor: s.actor,
      target: entity,
      verb: 'push',
      affordance: 0,
    });
    s.world.events.emit(interacted, {
      actor: s.actor,
      target: crate,
      verb: 'pick-up',
      affordance: 0,
    });
    s.world.events.emit(interacted, {
      actor: stranger,
      target: entity,
      verb: 'pick-up',
      affordance: 0,
    });
    s.world.events.flush();
    expect(s.picked).toEqual([]);
    expect(s.world.isAlive(entity)).toBe(true);
  });

  it('actors without a view or a press do nothing; views and buttons can come from elsewhere', () => {
    const s = setup();
    const npc = s.world.spawn();
    addInventory(s.sim, npc);
    s.items.inventory.add(s.sim, npc, 'arming-sword', 1);
    s.world.step([frame('drop')]); // the npc has no CharacterController or PlayerLook
    s.world.step([]); // no frame at all
    expect(s.dropped).toEqual([]);
    expect(handlerView(s.sim, npc)).toBeUndefined();

    const custom = setup({
      install: {
        view: () => ({ feet: v(5, 0, 5), yaw: 0, pitch: 0 }),
        input: (_inputs, actor) => (actor === 3 ? {} : { drop: DOWN }),
      },
    });
    custom.items.inventory.add(custom.sim, custom.actor, 'arming-sword', 1);
    custom.world.step([]);
    expect(custom.dropped[0]?.position).toEqual(v(5, DROP_HEIGHT, 5 - DROP_DISTANCE));
  });

  it('places scene item spawns as world items resting on their floor point', () => {
    const s = setup();
    const marker = s.world.spawn();
    const plain = s.world.spawn();
    const rotation = { x: 0, y: 1, z: 0, w: 0 };
    const placed = addSceneItems(s.sim, s.items, [
      { entity: plain, spawn: { position: v(0, 0, 0), rotation } },
      {
        entity: marker,
        spawn: { position: v(2, 0, 3), rotation, item: { id: 'arming-sword', count: 1 } },
      },
    ]);
    expect(placed).toEqual([marker]);
    expect(s.world.get(marker, WorldItemComponent)).toEqual({
      defId: 'arming-sword',
      count: 1,
      flags: {},
      by: null,
    });
    expect(placementOf(s.sim, marker)).toMatchObject(v(2, ITEM_HALF_EXTENTS.weapon.y, 3));
    expect(s.world.get(marker, PhysicsObjectComponent)?.rotation).toEqual(rotation);
    expect(readProperty(s.sim, marker, 'weight')).toBe(WEIGHT_CLASS_KG.medium);
  });

  it('validates definitions and counts, and names items readably', () => {
    const s = setup();
    expect(() => s.items.def('nope')).toThrow(RangeError);
    expect(() => s.items.spawn(s.sim, { defId: 'gold', count: 0, position: v(0, 0, 0) })).toThrow(
      RangeError,
    );
    expect(() => s.items.pickUp(s.sim, s.actor, s.actor)).toThrow(/not a world item/);
    expect(readableName('rusted-gallery-key')).toBe('Rusted gallery key');
    expect(s.items.label('anvil', 1)).toBe('Take Anvil');
    const named = new WorldItems(ITEMS, {
      name: (def) => def.id.toUpperCase(),
      inventory: new InventoryRules(ITEMS),
    });
    expect(named.label('anvil', 2)).toBe('Take ANVIL (2)');
    expect(named.selected(s.sim, s.world.spawn())).toBeUndefined();
  });

  it('installs into a world that already has the inventory and interaction components', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1, physics })));
    installPhysicsObjects(world);
    world.register(InventoryComponent, WorldItemComponent);
    installInteraction(world);
    expect(() => {
      installWorldItems(world, new WorldItems(ITEMS));
    }).not.toThrow();
    expect(worldItemsSystem(new WorldItems(ITEMS)).name).toBe('worldItems');
  });

  it('is deterministic: the same throws replay to the same state', () => {
    const run = (): string => {
      const s = setup();
      s.items.inventory.add(s.sim, s.actor, 'healing-draught', 5);
      for (let i = 0; i < 5; i++) {
        s.world.set(s.actor, PlayerLook, { yaw: i * 0.4, pitch: 0.1 * i });
        s.world.step([frame('throw')]);
        for (let j = 0; j < 20; j++) s.world.step([IDLE]);
      }
      return hashWorld(s.sim);
    };
    expect(run()).toBe(run());
  });
});

describe('breakable world items (mw-ju8.4)', () => {
  const JAR: WorldItemDef = item('jar', 'misc', {
    worldProperties: { material: 'glass' },
    breakable: { profile: 'pottery' },
  });
  const POTTERY: BreakableProfile = {
    id: 'pottery',
    resistances: {},
    debris: { count: 2, size: 0.1 },
    breakLoudness: 70,
  };
  const place = (breakables?: (id: string) => BreakableProfile | undefined) => {
    const s = setup({
      items: new WorldItems([JAR], {
        materials: MATERIALS,
        ...(breakables !== undefined && { breakables }),
      }),
    });
    s.sim.register(...BREAKABLE_COMPONENTS);
    return { s, entity: placeAhead(s, 'jar') };
  };

  it('a world item whose definition names a known profile is made breakable', () => {
    const { s, entity } = place((id) => (id === 'pottery' ? POTTERY : undefined));
    expect(s.sim.get(entity, BreakableComponent)).toMatchObject({ profile: 'pottery' });
  });

  it('without a profile lookup, or for an unknown profile, it stays an ordinary item', () => {
    for (const lookup of [undefined, () => undefined]) {
      const { s, entity } = place(lookup);
      expect(s.sim.has(entity, BreakableComponent)).toBe(false);
    }
  });
});
