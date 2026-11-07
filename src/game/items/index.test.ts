import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  addInventory,
  addPhysicsObject,
  addQuickSlots,
  inventoryOf,
  PlayerClassComponent,
  RapierCollisionWorld,
  addProperties,
  quickSlotsOf,
  RapierPhysics,
  registerSceneComponents,
  World,
  WorldItemComponent,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync } from '../loop/render-sync';
import { installGamePhysics } from '../physics-objects';
import { SceneLoader } from '../scene/scene-loader';
import {
  bindWorldItems,
  ItemWatch,
  prepareConsumables,
  prepareWorldItems,
  startCarry,
  startConsumables,
  startWorldItems,
  worldItemDef,
} from './index';

/** The testbed loaded headless with world items, and a player-like entity with nothing else. */
function testbed(withPlayer = true) {
  const content = loadGameContent();
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(registerSceneComponents(new World<never>({ seed: 3, physics })));
  const sync = new RenderSync(world);
  const loader = new SceneLoader({
    world,
    sync,
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  });
  const loaded = loader.load('testbed');
  const items = prepareWorldItems(content);
  const player = withPlayer ? world.spawn() : undefined;
  // The draught alone: the closet key (mw-e17.5, tests/integration/keyring.test.ts) is left out.
  const spawns = loaded.spawns.filter(({ spawn }) => spawn.id !== 'closet-key');
  const placed = startWorldItems(world, items, spawns, player);
  return { content, world, sync, items, player, placed, loaded };
}

/** `value`, or a thrown error when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const headless = (entity: EntityId) => ({
  object: entity,
  read: () => undefined,
  apply: () => undefined,
  dispose: () => undefined,
});

describe('world items in the game (mw-e17.7)', () => {
  it('turns content items into the sim’s, with world properties keyed by material id', () => {
    const content = loadGameContent();
    const draught = worldItemDef(content.get('item', 'healing-draught'));
    expect(draught.worldProperties).toEqual({ material: 'glass' });
    expect(draught.flags.noDrop).toBe(false);
    expect(draught.weightClass).toBe('light');
    const bare = { ...content.get('item', 'lockpicks'), worldProperties: undefined };
    expect(worldItemDef(bare as never).worldProperties).toBeUndefined();
  });

  it('places the testbed’s draught as a world item and gives the player an inventory', () => {
    const { world, player, placed, loaded } = testbed();
    const spawn = loaded.spawns.find(({ spawn: s }) => s.id === 'testbed-draught');
    expect(placed).toEqual([spawn?.entity]);
    expect(world.get(must(placed[0]), WorldItemComponent)).toMatchObject({
      defId: 'healing-draught',
      count: 1,
    });
    expect(inventoryOf(world, must(player))).toEqual({ gold: 0, nextInstanceId: 1, items: [] });
  });

  it('keeps an inventory the player already has, and works without a player', () => {
    const content = loadGameContent();
    const physics = new RapierPhysics(RAPIER);
    const world = installGamePhysics(
      registerSceneComponents(new World<never>({ seed: 3, physics })),
    );
    const items = prepareWorldItems(content);
    const player = world.spawn();
    addInventory(world, player, 40);
    expect(startWorldItems(world, items, [], player)).toEqual([]);
    expect(inventoryOf(world, player)?.gold).toBe(40);
    expect(testbed(false).placed).toHaveLength(1);
  });

  it('binds a box the size of its body to each world item once, with its category', () => {
    const { world, sync, items, placed } = testbed();
    const made: [EntityId, Vec3, string][] = [];
    const create = (entity: EntityId, size: Vec3, category: string) => {
      made.push([entity, size, category]);
      return headless(entity);
    };
    expect(bindWorldItems(world, sync, items, create)).toBe(1);
    expect(made).toEqual([[placed[0], { x: 0.1, y: 0.16, z: 0.1 }, 'consumable']]);
    expect(bindWorldItems(world, sync, items, create)).toBe(0);
    // A world item whose body is not a box (none are yet) is left alone.
    const ball = world.spawn();
    addPhysicsObject(world, ball, {
      shape: { kind: 'sphere', radius: 0.1 },
      position: { x: 0, y: 1, z: 0 },
      properties: { weight: 1, friction: 0.5, impactAbsorb: 0 },
    });
    world.add(ball, WorldItemComponent, { defId: 'gold', count: 1, flags: {}, by: null });
    expect(bindWorldItems(world, sync, items, create)).toBe(0);
  });

  it('watches takes, drops, throws and refusals for the e2e readout', () => {
    const { world, items, player, placed } = testbed();
    const watch = new ItemWatch(world, player);
    expect(watch.readout()).toEqual({
      pack: [],
      world: [{ item: 'healing-draught', count: 1, flags: {} }],
      taken: 0,
      dropped: 0,
      thrown: 0,
      refused: [],
    });
    const view = { feet: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
    items.pickUp(world, must(player), must(placed[0]));
    items.inventory.add(world, must(player), 'healing-draught', 2);
    items.throw(world, must(player), view, { instanceId: 1 });
    items.drop(world, must(player), view, { instanceId: 1 });
    items.drop(world, must(player), view, { instanceId: 99 });
    items.throw(world, must(player), view, { instanceId: 99 });
    items.inventory.add(world, must(player), 'healing-draught', 9999);
    items.pickUp(world, must(player), must(world.query(WorldItemComponent).ids()[0]));
    world.events.flush();
    // Six takes, drops, throws and refusals, and five changes to the pack (mw-e18.3).
    expect(watch.version).toBe(11);
    // Another actor's pack changing does not move it.
    const stranger = world.spawn();
    addInventory(world, stranger);
    items.inventory.add(world, stranger, 'healing-draught', 1);
    world.events.flush();
    expect(watch.version).toBe(11);
    const readout = watch.readout();
    expect(readout).toMatchObject({
      taken: 1,
      dropped: 1,
      thrown: 1,
      refused: ['drop:no-instance', 'throw:no-instance', 'pick-up:stack-limit'],
    });
    expect(readout.pack[0]).toEqual({ item: 'healing-draught', count: 10, flags: {} });
    expect(readout.world.map((w) => w.count).sort()).toEqual([1, 2]);
    watch.dispose();
    items.drop(world, must(player), view, { instanceId: 99 });
    world.events.flush();
    expect(watch.version).toBe(11);
    expect(new ItemWatch(world, undefined).readout().pack).toEqual([]);
    expect(new ItemWatch(world, world.spawn()).readout().pack).toEqual([]);
  });
});

describe('consumables in the game (mw-e17.6)', () => {
  it('maps use effects, a coating’s properties keyed by material id', () => {
    const content = loadGameContent();
    expect(worldItemDef(content.get('item', 'oil-flask')).use).toEqual([{ op: 'throw' }]);
    expect(worldItemDef(content.get('item', 'arming-sword')).use).toBeUndefined();
    const oil = content.get('item', 'oil-flask');
    const coated = worldItemDef({
      ...oil,
      use: [{ op: 'coat', properties: { ...oil.worldProperties, flammable: true }, seconds: 30 }],
    } as never);
    expect(coated.use).toEqual([
      { op: 'coat', properties: { material: 'oil', flammable: true, liquid: true }, seconds: 30 },
    ]);
  });

  it('gives the player quick slots once; without a player it only installs', () => {
    const { content, world, items, player } = testbed();
    const consumables = prepareConsumables(content, items);
    expect(consumables.items).toBe(items);
    expect(consumables.usable(consumables.def('oil-flask'))).toBe(true);
    addQuickSlots(world, must(player));
    const slots = quickSlotsOf(world, must(player));
    startConsumables(world, consumables, player);
    expect(quickSlotsOf(world, must(player))).toBe(slots); // kept, not replaced
    const fresh = testbed();
    startConsumables(fresh.world, prepareConsumables(content, fresh.items), fresh.player);
    expect(quickSlotsOf(fresh.world, must(fresh.player))?.slots).toEqual([null, null, null, null]);
    const alone = testbed(false);
    startConsumables(alone.world, prepareConsumables(content, alone.items), undefined);
    expect(alone.world.query(WorldItemComponent).ids()).toHaveLength(1);
  });
});

describe('carrying in the game (mw-e02.17)', () => {
  it('lifts by the player class carry limit from content, 25 kg before a class is chosen', () => {
    const { world, player, content } = testbed();
    const physics = world.physics as RapierPhysics;
    const strong = {
      has: (_kind: string, id: string) => id === 'brute',
      get: () => ({ carryLimitKg: 40 }),
    };
    const carry = startCarry(world, strong as never, new RapierCollisionWorld(physics));
    const who = must(player);
    const crate = world.spawn();
    addProperties(world, crate, { liftable: true, weight: 30 });
    addPhysicsObject(world, crate, {
      shape: { kind: 'box', halfExtents: { x: 0.2, y: 0.2, z: 0.2 } },
      position: { x: 0, y: 0.2, z: -1 },
    });
    world.step();
    expect(carry.pickUp(who, crate)).toEqual({ ok: false, reason: 'too-heavy' });
    world.register(PlayerClassComponent);
    world.add(who, PlayerClassComponent, { classId: 'brute' });
    world.step();
    expect(carry.pickUp(who, crate)).toEqual({ ok: true });
    for (const id of ['knight', 'archer', 'sorcerer', 'thief'] as const) {
      expect(content.get('class', id).carryLimitKg).toBe(25);
    }
  });

  it('a class the content does not know falls back to the default limit', () => {
    const { world, player, content } = testbed();
    const physics = world.physics as RapierPhysics;
    const carry = startCarry(world, content, new RapierCollisionWorld(physics));
    const who = must(player);
    world.register(PlayerClassComponent);
    world.add(who, PlayerClassComponent, { classId: 'nobody' });
    const crate = world.spawn();
    addProperties(world, crate, { liftable: true, weight: 10 });
    addPhysicsObject(world, crate, {
      shape: { kind: 'box', halfExtents: { x: 0.2, y: 0.2, z: 0.2 } },
      position: { x: 0, y: 0.2, z: -1 },
    });
    world.step();
    expect(carry.pickUp(who, crate)).toEqual({ ok: true });
  });
});
