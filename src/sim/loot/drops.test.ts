// Creature drops (mw-e01.5): a dying creature drops what its spawn point carries, then its table's
// roll, as world items lying at its body, each with an `item.dropped` from the creature; the roll
// draws from the creature's own sub-stream of the loot stream; nothing else drops anything.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { ArrowRestComponent, type ArrowRest } from '../combat/arrows/components';
import { Died } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CREATURE_COMPONENTS, CreatureComponent, type Creature } from '../creatures/components';
import {
  installWorldItems,
  ITEM_HALF_EXTENTS,
  itemDropped,
  WorldItemComponent,
  WorldItems,
  type ItemDropped,
  type WorldItemDef,
} from '../items/world-items';
import { installPhysicsObjects, PhysicsObjectComponent } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { registerWorldProperties } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli } from '../stimulus/stimulus';
import {
  dropCreatureLoot,
  dropSpot,
  DROP_SCATTER_RADIUS,
  installCreatureDrops,
  type CreatureDropsOptions,
} from './drops';
import { TEST_ARROWS } from '../testing/arrows';
import { LootTables, type LootStack, type LootTableDef } from './tables';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

const item = (id: string, category: WorldItemDef['category'], unique = false): WorldItemDef => ({
  id,
  category,
  stackable: category !== 'key',
  weightClass: 'light',
  flags: { unique, questItem: category === 'key', noDrop: category === 'key' },
});
const ITEMS = [
  item('gallery-key', 'key', true),
  item('bone', 'misc'),
  item('gold', 'currency'),
  item('lockpicks', 'tool'),
  item('standard-arrow', 'ammo'),
  item('rope-arrow', 'ammo'),
];

const ref = (id: string) => ({ id });
const TABLES: LootTableDef[] = [
  {
    // Random enough that two streams would almost surely differ.
    id: 'miner-scraps',
    guaranteed: [{ item: ref('bone'), count: 1 }],
    rolls: { min: 1, max: 1 },
    entries: [
      { item: ref('gold'), weight: 1, count: { min: 1, max: 999 } },
      // Only for a thief who did the killing.
      {
        item: ref('lockpicks'),
        weight: 1000000,
        count: { min: 1, max: 1 },
        conditions: { class: [ref('thief')] },
      },
    ],
    noDuplicates: false,
  },
];

function creature(point?: string): Creature {
  return Object.freeze({
    origin: Object.freeze({
      creature: 'forgotten-miner',
      at: Object.freeze(v(2.5, 0, 32.5)),
      facing: Object.freeze(v(0, 0, -1)),
      ...(point !== undefined && { point }),
    }),
    behaviour: 'forgotten',
    tuning: Object.freeze({}),
    needs: Object.freeze({}),
  });
}

/** A world on a floor (top at y = 0) with physics objects and world items. */
function setup(seed = 7) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed, physics })));
  world.register(...CREATURE_COMPONENTS);
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  const items = new WorldItems(ITEMS);
  installWorldItems(world, items);
  const dropped: ItemDropped[] = [];
  world.events.on(itemDropped, (e) => dropped.push(e));
  const spawnCreature = (at: Vec3, point?: string): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.35);
    world.add(entity, CreatureComponent, creature(point));
    return entity;
  };
  const die = (target: EntityId, killer: EntityId | null = null): void => {
    world.step([]);
    world.events.emit(Died, { tick: world.tick, target, killer, source: null, tags: [] });
    world.events.flush();
  };
  const lying = () =>
    world
      .query(WorldItemComponent, PhysicsObjectComponent)
      .ids()
      .map((entity) => {
        const at = world.get(entity, PhysicsObjectComponent)?.position ?? v(99, 99, 99);
        const { defId, count, by } = world.get(entity, WorldItemComponent) ?? {};
        return { entity, item: defId, count, by, at: v(at.x, at.y, at.z) };
      });
  return { world, items, dropped, spawnCreature, die, lying };
}

const CARRIED = new Map<string, readonly LootStack[]>([
  ['skeleton', [{ item: 'gallery-key', count: 1 }]],
]);

function options(items: WorldItems, extra: Partial<CreatureDropsOptions> = {}) {
  return {
    level: 'slice',
    items,
    loot: new LootTables(TABLES, ITEMS),
    tableOf: (id: string) => (id === 'forgotten-miner' ? 'miner-scraps' : undefined),
    carried: (point: string) => CARRIED.get(point),
    ...extra,
  } satisfies CreatureDropsOptions;
}

describe('creature drops (mw-e01.5)', () => {
  it('lays the first drop at the feet and the rest on a ring within 1 m', () => {
    const feet = v(2, 0.5, -3);
    expect(dropSpot(feet, 0, 3)).toEqual(feet);
    expect(dropSpot(feet, 1, 1)).toEqual(feet);
    for (let i = 1; i < 6; i++) {
      const spot = dropSpot(feet, i, 6);
      expect(flat(spot, feet)).toBeCloseTo(DROP_SCATTER_RADIUS, 9);
      expect(spot.y).toBe(feet.y);
    }
    expect(dropSpot(feet, 1, 3)).not.toEqual(dropSpot(feet, 2, 3));
    expect(DROP_SCATTER_RADIUS).toBeLessThan(1);
  });

  it('AC-2: on Died a placed creature drops what it carries, then its table’s roll, as world items at its body', () => {
    const s = setup();
    installCreatureDrops(s.world, options(s.items));
    const skeleton = s.spawnCreature(v(1.5, 0, 4), 'skeleton');
    s.die(skeleton);
    const items = s.lying();
    expect(items.map((i) => i.item)).toEqual(['gallery-key', 'bone', 'gold']);
    // The key first, at its feet, resting on the floor; everything within 1 m.
    expect(items[0]?.at).toEqual(v(1.5, ITEM_HALF_EXTENTS.key.y, 4));
    for (const lying of items) {
      expect(flat(lying.at, v(1.5, 0, 4))).toBeLessThanOrEqual(1);
      expect(lying.by).toBe(skeleton);
    }
    expect(s.dropped.map((e) => [e.actor, e.entity, e.defId, e.thrown])).toEqual(
      items.map((i) => [skeleton, i.entity, i.item, false]),
    );
    expect(s.dropped[0]).toMatchObject({ count: 1, flags: {}, tick: s.world.tick });
    // They settle where they were laid.
    for (let i = 0; i < 60; i++) s.world.step([]);
    for (const lying of s.lying()) expect(flat(lying.at, v(1.5, 0, 4))).toBeLessThanOrEqual(1);
  });

  it('rolls from the creature’s own sub-stream: the same death drops the same loot, and other draws never shift', () => {
    const roll = (spawnFirst: boolean) => {
      const s = setup(11);
      installCreatureDrops(s.world, options(s.items));
      if (spawnFirst) s.world.random('loot').float();
      const skeleton = s.spawnCreature(v(0, 0, 0), 'skeleton');
      s.die(skeleton);
      return s.lying().map((i) => [i.item, i.count]);
    };
    expect(roll(false)).toEqual(roll(true));
    // An unplaced creature (a console spawn) rolls from a stream named for its entity instead.
    const s = setup(11);
    installCreatureDrops(s.world, options(s.items));
    const stray = s.spawnCreature(v(0, 0, 0));
    s.die(stray);
    const strayLoot = s.lying().map((i) => [i.item, i.count]);
    expect(strayLoot.map(([id]) => id)).toEqual(['bone', 'gold']);
    expect(strayLoot).not.toEqual(roll(false).slice(1));
  });

  it('class-conditioned entries read the killer’s class', () => {
    const s = setup();
    const killers: (EntityId | null)[] = [];
    installCreatureDrops(
      s.world,
      options(s.items, {
        classOf: (_world, killer) => {
          killers.push(killer);
          return 'thief';
        },
      }),
    );
    const thief = s.world.spawn();
    s.die(s.spawnCreature(v(0, 0, 0)), thief);
    expect(s.lying().map((i) => i.item)).toEqual(['bone', 'lockpicks']);
    // With no killer the class is never asked for.
    s.die(s.spawnCreature(v(5, 0, 0)));
    expect(killers).toEqual([thief]);
  });

  it('drops only what it carries without a table or loot tables, and nothing at all when it carries nothing', () => {
    const s = setup();
    const noTable = options(s.items, { tableOf: () => undefined });
    expect(
      dropCreatureLoot(s.world, noTable, s.spawnCreature(v(0, 0, 0), 'skeleton')),
    ).toHaveLength(1);
    const { level, items, tableOf, carried } = options(s.items);
    const noLoot = { level, items, tableOf, carried };
    expect(dropCreatureLoot(s.world, noLoot, s.spawnCreature(v(2, 0, 0), 'skeleton'))).toHaveLength(
      1,
    );
    const bare = { level: 'slice', items: s.items };
    expect(dropCreatureLoot(s.world, bare, s.spawnCreature(v(4, 0, 0), 'skeleton'))).toEqual([]);
    expect(dropCreatureLoot(s.world, noTable, s.spawnCreature(v(6, 0, 0), 'nobody'))).toEqual([]);
    expect(s.lying().map((i) => i.item)).toEqual(['gallery-key', 'gallery-key']);
  });

  it('nothing drops for something that is not a placed creature, or in a world without creatures', () => {
    const s = setup();
    const stop = installCreatureDrops(s.world, options(s.items));
    const rock = s.world.spawn();
    placeEntity(s.world, rock, v(0, 0, 0), 0.2);
    s.die(rock);
    const ghost = s.world.spawn();
    s.world.add(ghost, CreatureComponent, creature('skeleton'));
    s.die(ghost); // no placement
    expect(s.lying()).toEqual([]);
    // Uninstalled, a death drops nothing.
    stop();
    s.die(s.spawnCreature(v(0, 0, 0), 'skeleton'));
    expect(s.lying()).toEqual([]);

    const bare = new World<never>({ seed: 1 });
    const thing = bare.spawn();
    expect(dropCreatureLoot(bare, options(s.items), thing)).toEqual([]);
  });
});

describe('arrows in a dying creature (mw-e05.7)', () => {
  const ARROWS = TEST_ARROWS;
  const ITEM_OF = new Map([
    ['standard', 'standard-arrow'],
    ['rope', 'rope-arrow'],
  ]);
  const arrowOptions = (items: WorldItems) =>
    options(items, {
      arrows: { lookup: ARROWS, itemOf: (arrow) => ITEM_OF.get(arrow) },
    });
  const stick = (
    t: ReturnType<typeof setup>,
    host: EntityId | null,
    arrow = 'standard',
    over: Partial<ArrowRest> = {},
  ): EntityId => {
    const entity = t.world.spawn();
    t.world.add(entity, ArrowRestComponent, {
      arrow,
      shooter: null,
      state: 'stuck',
      position: v(2.5, 1, 32.5),
      direction: v(0, 0, 1),
      in: host,
      tick: 0,
      intact: true,
      ...over,
    });
    return entity;
  };
  const registered = () => {
    const t = setup();
    t.world.register(ArrowRestComponent);
    return t;
  };
  const arrowsLying = (t: ReturnType<typeof setup>) =>
    t.lying().filter((drop) => drop.item === 'standard-arrow' || drop.item === 'rope-arrow');

  it('AC-4: a creature with 2 arrows in it drops those that were intact, and none of the broken', () => {
    const t = registered();
    installCreatureDrops(t.world, arrowOptions(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    const a = stick(t, miner);
    const b = stick(t, miner);
    const broken = stick(t, miner, 'standard', { intact: false });
    const elsewhere = stick(t, null);
    t.die(miner);
    t.world.step([]);
    expect(arrowsLying(t)).toMatchObject([{ item: 'standard-arrow', count: 2, by: miner }]);
    for (const arrow of [a, b, broken]) expect(t.world.isAlive(arrow)).toBe(false);
    expect(t.world.isAlive(elsewhere)).toBe(true);
    expect(
      t.dropped.filter((d) => d.defId === 'standard-arrow').map((d) => [d.actor, d.count]),
    ).toEqual([[miner, 2]]);
  });

  it('a spent trick arrow drops as the standard arrow it comes back as; a rope arrow stays a rope arrow', () => {
    const t = registered();
    installCreatureDrops(t.world, arrowOptions(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    stick(t, miner, 'water');
    stick(t, miner, 'standard');
    stick(t, miner, 'rope');
    stick(t, miner, 'broadhead'); // no item for it: it does not drop
    t.die(miner);
    t.world.step([]);
    expect(
      arrowsLying(t)
        .map((d) => [d.item, d.count])
        .sort(),
    ).toEqual([
      ['rope-arrow', 1],
      ['standard-arrow', 2],
    ]);
  });

  it('a shattered creature gives the same result: its death is the same Died', () => {
    const run = (tags: string[]) => {
      const t = registered();
      installCreatureDrops(t.world, arrowOptions(t.items));
      const miner = t.spawnCreature(v(2.5, 0, 32.5));
      stick(t, miner);
      stick(t, miner);
      t.world.step([]);
      t.world.events.emit(Died, {
        tick: t.world.tick,
        target: miner,
        killer: null,
        source: null,
        tags,
      });
      t.world.events.flush();
      t.world.step([]);
      return arrowsLying(t).map((d) => [d.item, d.count]);
    };
    expect(run(['shatter'])).toEqual([['standard-arrow', 2]]);
    expect(run(['shatter'])).toEqual(run([]));
  });

  it('the arrow that kills lands after the death and drops a tick later, beside the rest of the loot', () => {
    const t = registered();
    installCreatureDrops(t.world, arrowOptions(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    const early = stick(t, miner);
    t.world.step([]);
    t.world.events.emit(Died, {
      tick: t.world.tick,
      target: miner,
      killer: null,
      source: null,
      tags: [],
    });
    t.world.events.flush();
    // The killing arrow comes to rest in the corpse in the same tick, after Died: not yet visible.
    const killing = stick(t, miner);
    expect(arrowsLying(t)).toMatchObject([{ item: 'standard-arrow', count: 1 }]);
    t.world.step([]);
    expect(arrowsLying(t)).toMatchObject([
      { item: 'standard-arrow', count: 1 },
      { item: 'standard-arrow', count: 1 },
    ]);
    const [first, second] = arrowsLying(t);
    // Not stacked on the first spot: it lies on the ring around the feet, still within 1 m.
    expect(flat(first?.at ?? v(0, 0, 0), second?.at ?? v(0, 0, 0))).toBeGreaterThan(0.1);
    expect(flat(second?.at ?? v(0, 0, 0), v(2.5, 0, 32.5))).toBeLessThanOrEqual(1);
    expect(t.world.isAlive(early)).toBe(false);
    expect(t.world.isAlive(killing)).toBe(false);
    // Nothing more comes of it.
    t.world.step([]);
    expect(arrowsLying(t)).toHaveLength(2);
  });

  it('a creature whose arrows were all broken drops none, and the killing one is left alone if broken', () => {
    const t = registered();
    installCreatureDrops(t.world, arrowOptions(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    stick(t, miner, 'standard', { intact: false });
    t.die(miner);
    stick(t, miner, 'standard', { intact: false });
    t.world.step([]);
    expect(arrowsLying(t)).toEqual([]);
    expect(t.world.query(ArrowRestComponent).ids()).toEqual([]);
  });

  it('without arrow options arrows stay stuck in the corpse, and uninstalling stops the late drops', () => {
    const t = registered();
    installCreatureDrops(t.world, options(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    const arrow = stick(t, miner);
    t.die(miner);
    t.world.step([]);
    expect(t.world.isAlive(arrow)).toBe(true);
    expect(arrowsLying(t)).toEqual([]);

    const u = registered();
    const off = installCreatureDrops(u.world, arrowOptions(u.items));
    const other = u.spawnCreature(v(2.5, 0, 32.5));
    u.world.step([]);
    u.world.events.emit(Died, {
      tick: u.world.tick,
      target: other,
      killer: null,
      source: null,
      tags: [],
    });
    u.world.events.flush();
    stick(u, other);
    off();
    u.world.step([]);
    expect(arrowsLying(u)).toEqual([]);
    // Dead creatures nobody drops for stay quiet.
    u.world.events.emit(Died, {
      tick: u.world.tick,
      target: other,
      killer: null,
      source: null,
      tags: [],
    });
    u.world.events.flush();
    u.world.step([]);
    expect(arrowsLying(u)).toEqual([]);
  });

  it('a creature gone before the late drop, or with no placement, drops nothing and does not throw', () => {
    const t = registered();
    installCreatureDrops(t.world, arrowOptions(t.items));
    const miner = t.spawnCreature(v(2.5, 0, 32.5));
    t.world.step([]);
    t.world.events.emit(Died, {
      tick: t.world.tick,
      target: miner,
      killer: null,
      source: null,
      tags: [],
    });
    t.world.events.flush();
    t.world.destroy(miner);
    t.world.step([]);
    t.world.step([]);
    expect(arrowsLying(t)).toEqual([]);
    const plain = t.world.spawn(); // not a creature at all: dropCreatureLoot ignores it
    const own = stick(t, plain);
    t.world.step([]);
    t.world.events.emit(Died, {
      tick: t.world.tick,
      target: plain,
      killer: null,
      source: null,
      tags: [],
    });
    t.world.events.flush();
    t.world.step([]);
    t.world.step([]);
    expect(t.world.isAlive(own)).toBe(true);
  });
});
