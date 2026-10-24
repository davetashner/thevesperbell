// mw-ju8.5: the Briar Glen shop lane (src/content/data/scene/briar-glen-lane.json) loaded headless
// as the game wires it (createGameWorld: Rapier physics, the player with interaction, creatures).
// AC-2: each counter prompts Trade and names a merchant whose stock the shop transactions can read;
// each keeper stands behind its counter, friendly and unarmed; the lane has an exit towards the
// bridge and one at Marsh's door. The browser run is e2e/briar-glen-lane.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  buildFactionTable,
  CreatureComponent,
  factionSpecFromDef,
  FactionMemberComponent,
  interactionPrompt,
  InventoryRules,
  PlacementComponent,
  PlayerLook,
  SceneSpawnComponent,
  Shops,
  teleportCommand,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
/** Facing east (+x), towards the counters: the mirror of yaw π/2, which faces west. */
const FACE_EAST = -Math.PI / 2;

const content = loadGameContent();
const SHOPS = [
  { merchant: 'brand-forge', keeper: 'npc-oswin', z: 16 },
  { merchant: 'fenn-fletchery-simples', keeper: 'npc-juniper', z: 24 },
  { merchant: 'pell-bakery', keeper: 'npc-hollis', z: 32 },
] as const;

function lane() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'briar-glen-lane' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no briar-glen-lane spawn ${id}`);
    return found;
  };
  const marker = (id: string): { position: Vec3; tags: readonly string[] } => {
    const found = game.scene.layout.spawns.find((s) => s.id === id);
    if (found === undefined) throw new Error(`no briar-glen-lane spawn ${id}`);
    return { position: found.position, tags: found.tags };
  };
  const keeper = (creature: string): EntityId => {
    const found = world
      .query(CreatureComponent)
      .ids()
      .find((entity) => world.get(entity, CreatureComponent)?.origin.creature === creature);
    if (found === undefined) throw new Error(`${creature} is not in the lane`);
    return found;
  };
  const where = (entity: EntityId): Vec3 => {
    const placement = world.get(entity, PlacementComponent);
    if (placement === undefined) throw new Error('not placed');
    return { x: placement.x, y: placement.y, z: placement.z };
  };
  const step = (ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([IDLE]);
  };
  const teleport = (to: Vec3, yaw: number): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(10);
  };
  return { game, world, sim, player, spawn, marker, keeper, where, step, teleport };
}

describe('the Briar Glen shop lane, headless (mw-ju8.5)', () => {
  it('AC-2: loads with the player on the street, an exit towards the bridge and one at Marsh’s door', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-lane');
    const t = lane();
    expect(t.marker('player-start').tags).toContain('player-start');
    expect(t.where(t.player).x).toBeCloseTo(0, 0);
    const bridge = t.marker('bridge-town-end');
    expect(bridge.tags).toContain('bridge');
    expect(
      content.get('scene', 'briar-glen-lane').transitions.map((t) => [t.id, t.scene.id]),
    ).toEqual([
      ['bridge-gate', 'valley-03'],
      ['marsh-store-door', 'marsh-store'],
      ['sleeping-ox-door', 'sleeping-ox'],
      ['bridgeward-college-door', 'bridgeward-college'],
    ]);
    expect(bridge.position.z).toBeLessThan(t.marker('marsh-store-door').position.z);
    const door = t.marker('marsh-store-door');
    expect(door.tags).toContain('building');
    expect(content.has('scene', 'marsh-store')).toBe(true);
    // The Sleeping Ox stands further up the west side than Marsh's, with its sign and lantern.
    const inn = t.marker('sleeping-ox-door');
    expect(inn.tags).toContain('building');
    expect(inn.position.x).toBeCloseTo(door.position.x, 5);
    expect(inn.position.z).toBeGreaterThan(door.position.z + 10);
    expect(t.marker('sign-sleeping-ox').tags).toContain('sign');
    expect(t.marker('lantern-sleeping-ox').tags).toContain('lantern');
    const innWay = content
      .get('scene', 'briar-glen-lane')
      .transitions.find((x) => x.id === 'sleeping-ox-door');
    expect(innWay?.spawn).toBe('arrive-from-briar-glen-lane');
    const arrival = t.marker('arrive-from-sleeping-ox').position;
    expect(arrival.x).toBeGreaterThan(-6);
    expect(Math.abs(arrival.z - inn.position.z)).toBeLessThan(2);
    // The Bridgeward College (mw-ju8.13) stands further up the west side still, with its sign and lantern.
    const college = t.marker('bridgeward-college-door');
    expect(college.tags).toContain('building');
    expect(college.position.x).toBeCloseTo(door.position.x, 5);
    expect(college.position.z).toBeGreaterThan(inn.position.z + 5);
    expect(t.marker('sign-bridgeward-college').tags).toContain('sign');
    expect(t.marker('lantern-bridgeward-college').tags).toContain('lantern');
    expect(
      content
        .get('scene', 'briar-glen-lane')
        .transitions.find((x) => x.id === 'bridgeward-college-door')?.spawn,
    ).toBe('arrive-from-briar-glen-lane');
    // The lane's far end is no further than ~40 m from the bridge.
    expect(t.marker('street-lantern-4').position.z).toBeGreaterThan(30);
  });

  for (const { merchant: id, keeper: npc } of SHOPS) {
    it(`AC-2: the ${id} counter prompts Trade and its merchant has its stock to hand`, ({
      task,
    }) => {
      markExercised(task, 'merchant', id);
      markExercised(task, 'creature', npc);
      const t = lane();
      const name = `${id}-counter`;
      const counter = t.spawn(name);
      const at = t.marker(name);
      t.teleport({ x: at.position.x - 0.5, y: 0, z: at.position.z }, FACE_EAST);
      expect(interactionPrompt(t.sim, t.player)).toMatchObject({
        target: counter,
        verb: 'talk',
        label: 'Trade',
        available: true,
      });
      const tag = at.tags.find((x) => x.startsWith('merchant:'));
      expect(tag).toBe(`merchant:${id}`);
      expect(at.tags).toContain('dev-crowns:400');
      const merchant = content.get('merchant', tag?.slice('merchant:'.length) ?? '');
      const shops = new Shops(
        content.all('merchant'),
        content.all('item'),
        new InventoryRules(content.all('item')),
      );
      const state = shops.stateOf(t.world, merchant.id);
      expect(state.gold).toBe(merchant.goldReserve);
      expect(state.stock.map((line) => line.defId).sort()).toEqual(
        merchant.stock.map((line) => line.item?.id ?? '').sort(),
      );
    });
  }

  for (const { keeper: npc, merchant: id, z } of SHOPS) {
    it(`AC-2: ${npc} stands behind the ${id} counter, friendly and unarmed`, ({ task }) => {
      markExercised(task, 'creature', npc);
      markExercised(task, 'behaviour', 'shopkeeper');
      markExercised(task, 'faction', 'townsfolk');
      const t = lane();
      const keeper = t.keeper(npc);
      const counterAt = t.marker(`${id}-counter`).position;
      // Behind: the customer's spot is west of the counter (x 4.5…5.5), the keeper east of it.
      expect(counterAt.x).toBeLessThan(4.5);
      expect(t.where(keeper).x).toBeGreaterThan(5.5);
      expect(Math.abs(t.where(keeper).z - z)).toBeLessThan(1);
      // She stays at her post.
      t.step(300);
      expect(Math.hypot(t.where(keeper).x - 7, t.where(keeper).z - z)).toBeLessThan(1);
      expect(t.world.get(keeper, FactionMemberComponent)).toMatchObject({
        faction: 'townsfolk',
        toward: { player: 'friendly' },
      });
      expect(content.get('creature', npc).attacks).toEqual([]);
    });
  }

  // mw-ju8.12: the Bridge Watch post at the town end of the bridge.
  const WATCH = [
    { id: 'npc-watchman-day-1', creature: 'npc-watchman-day', tag: 'watch:day' },
    { id: 'npc-watchman-day-2', creature: 'npc-watchman-day', tag: 'watch:day' },
    { id: 'npc-watchman-night-1', creature: 'npc-watchman-night', tag: 'watch:night' },
  ] as const;

  it('AC-2: the day watch and the night watch both keep guards at the post', ({ task }) => {
    markExercised(task, 'behaviour', 'watchman');
    markExercised(task, 'faction', 'bridge-watch');
    markExercised(task, 'creature', 'npc-watchman-day');
    markExercised(task, 'creature', 'npc-watchman-night');
    const t = lane();
    const post = t.marker('guard-post').position;
    for (const watch of ['watch:day', 'watch:night']) {
      const guards = WATCH.filter((g) => g.tag === watch);
      expect(guards.length).toBeGreaterThanOrEqual(1);
      for (const g of guards) {
        expect(t.marker(g.id).tags).toEqual(expect.arrayContaining(['guard', watch]));
        const entity = t.keeper(g.creature);
        expect(entity).toBeDefined();
      }
    }
    expect(content.get('creature', 'npc-watchman-day').tags).toContain('watch-day');
    expect(content.get('creature', 'npc-watchman-night').tags).toContain('watch-night');
    // Behind or at the post (town side of the bridge-end wall), clear of every arrival by 2 m.
    const arrivals = game_arrivals(t);
    for (const g of WATCH) {
      const at = t.marker(g.id).position;
      expect(Math.hypot(at.x - post.x, at.z - post.z)).toBeLessThan(6);
      expect(at.z).toBeGreaterThan(post.z - 1);
      for (const a of arrivals) expect(Math.hypot(at.x - a.x, at.z - a.z)).toBeGreaterThan(2);
    }
    for (const prop of ['guard-post', 'watch-brazier', 'watch-banner', 'watch-lamp']) {
      expect(t.marker(prop).position.z).toBeLessThan(5);
    }
    expect(t.marker('watch-brazier').tags).toContain('brazier');
  });

  it('AC-2: guards hold the post, friendly and unarmed', ({ task }) => {
    markExercised(task, 'creature', 'npc-watchman-day');
    const t = lane();
    t.step(300);
    const guards = t.world
      .query(CreatureComponent)
      .ids()
      .filter((e) => t.world.get(e, CreatureComponent)?.origin.creature.startsWith('npc-watchman'));
    expect(guards).toHaveLength(WATCH.length);
    for (const guard of guards) {
      expect(t.world.get(guard, FactionMemberComponent)).toMatchObject({
        faction: 'bridge-watch',
        toward: { player: 'friendly' },
      });
      expect(t.where(guard).z).toBeGreaterThan(1.5);
      expect(t.where(guard).z).toBeLessThan(5);
    }
  });

  it('AC-1: the Watch is hostile to monsters and no monster is in the lane or crosses', ({
    task,
  }) => {
    markExercised(task, 'faction', 'bridge-watch');
    markExercised(task, 'faction', 'townsfolk');
    markExercised(task, 'faction', 'unaligned');
    const table = buildFactionTable(content.all('faction').map(factionSpecFromDef));
    // The Forgotten name no faction, so they are unaligned: the Watch is hostile to them (and
    // they to it), and friendly to the player and the townsfolk.
    for (const id of ['forgotten-miner', 'forgotten-brute', 'forgotten-archer']) {
      expect(content.get('creature', id).faction).toBeUndefined();
    }
    expect(table.base('bridge-watch', 'unaligned')).toBe('hostile');
    expect(table.base('unaligned', 'bridge-watch')).toBe('hostile');
    expect(table.base('bridge-watch', 'townsfolk')).toBe('ally');
    expect(table.base('bridge-watch', 'player')).toBe('friendly');
    // Monsters never travel and none is placed in the town: every creature in the lane scenes
    // belongs to the Watch or the townsfolk.
    for (const scene of ['briar-glen-lane', 'marsh-store', 'sleeping-ox']) {
      for (const spawn of content.get('scene', scene).spawns) {
        if (spawn.creature === undefined) continue;
        const def = content.get('creature', spawn.creature.id);
        expect(['townsfolk', 'bridge-watch']).toContain(def.faction?.id);
        expect(def.tags).not.toContain('forgotten');
        expect(def.tags).not.toContain('undead');
      }
    }
  });
});

function game_arrivals(t: { marker: (id: string) => { position: Vec3 } }): Vec3[] {
  return [
    'arrive-from-valley-03',
    'arrive-from-marsh-store',
    'arrive-from-sleeping-ox',
    'arrive-from-bridgeward-college',
    'player-start',
  ].map((id) => t.marker(id).position);
}
