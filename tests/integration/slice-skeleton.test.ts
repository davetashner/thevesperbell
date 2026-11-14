// mw-e01.5: the Forgotten skeleton fight in the slice arena (docs/design/vertical-slice.md B4–B5, §6
// F5). The slice is built headless as the game wires it (createGameWorld: Rapier physics, the player,
// perception by the light field, awareness and AI with the Forgotten's content behaviour on the
// slice's navmesh, world items and creature drops) and driven with ActionFrames and debug commands.
// The skeleton is the one placed in slice.json: spawn `skeleton`, a forgotten-miner at its post by
// pillar B, (2.5, 0, 32.5), facing the doorway, leashed 25 m and carrying the rusted gallery key.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { markExercised } from '@content/testing';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  actionButton,
  actionFrame,
  actionVector,
  AlertStateChanged,
  BrainComponent,
  CreatureComponent,
  DamageApplied,
  Died,
  hashWorld,
  HealthComponent,
  interactionPrompt,
  inventoryOf,
  itemDropped,
  killCommand,
  PlacementComponent,
  PhysicsObjectComponent,
  PlayerLook,
  teleportCommand,
  WorldItemComponent,
  type ActionFrame,
  type AlertStateChange,
  type EntityId,
  type ItemDropped,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const HZ = 60;
const POST: Vec3 = { x: 2.5, y: 0, z: 32.5 };
const LEASH_M = 25;
/** Inside the arena doorway, in the skeleton's view (7.9 m from its post, vertical-slice §4). */
const ARENA_DOORWAY: Vec3 = { x: 0, y: 0, z: 26 };
/** Yaw π faces +z (north: into the arena). */
const FACE_NORTH = Math.PI;
/** How fast the player flees, m/s: a jog, a little quicker than the skeleton's 2.6 m/s lurch. */
const FLEE_SPEED = 3;

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(...pressed: string[]): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame();
const INTERACT = frame('interact');

const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

/** The point `metres` along `path` (its end once past it). */
function along(path: readonly Vec3[], metres: number): Vec3 {
  let left = metres;
  let [a = ARENA_DOORWAY] = path;
  for (const b of path.slice(1)) {
    const leg = flat(a, b);
    if (left <= leg) {
      const k = left / leg;
      return { x: a.x + (b.x - a.x) * k, y: 0, z: a.z + (b.z - a.z) * k };
    }
    left -= leg;
    a = b;
  }
  return a;
}

/** The slice headless as the game wires it, with what the tests watch. */
function slice() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: HZ, scene: 'slice' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const skeleton = (): EntityId => {
    const found = world
      .query(CreatureComponent)
      .ids()
      .find((entity) => world.get(entity, CreatureComponent)?.origin.point === 'skeleton');
    if (found === undefined) throw new Error('the skeleton is not in the slice');
    return found;
  };
  const at = (entity: EntityId): Vec3 => {
    const p = world.get(entity, PlacementComponent);
    if (p === undefined) throw new Error(`entity ${String(entity)} is not placed`);
    return { x: p.x, y: p.y, z: p.z };
  };
  const brain = () => {
    const found = world.get(skeleton(), BrainComponent);
    if (found === undefined) throw new Error('the skeleton has no brain');
    return found;
  };
  const health = () => world.get(skeleton(), HealthComponent);
  const changes: AlertStateChange[] = [];
  sim.events.on(AlertStateChanged, (e) => {
    if (e.entity === skeleton()) changes.push(e);
  });
  const step = (input: unknown = IDLE, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const teleport = (to: Vec3, yaw = FACE_NORTH): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
  };
  /** Steps until `done` holds (at most `limit` ticks); the ticks it took. */
  const until = (done: () => boolean, limit: number, input: unknown = IDLE): number => {
    for (let n = 0; n < limit; n++) {
      if (done()) return n;
      step(input);
    }
    throw new Error(`gave up after ${String(limit)} ticks (alert state ${brain().state})`);
  };
  /** Every world item: its item, units and box centre. */
  const worldItems = () =>
    world
      .query(WorldItemComponent, PhysicsObjectComponent)
      .ids()
      .map((entity) => {
        const body = world.get(entity, PhysicsObjectComponent);
        return {
          entity,
          item: world.get(entity, WorldItemComponent)?.defId,
          at: { x: body?.position.x ?? 0, y: body?.position.y ?? 0, z: body?.position.z ?? 0 },
        };
      });
  const pack = () => (inventoryOf(sim, player)?.items ?? []).map(({ defId }) => defId);
  return {
    game,
    world,
    sim,
    player,
    skeleton,
    at,
    brain,
    health,
    changes,
    step,
    teleport,
    until,
    worldItems,
    pack,
  };
}

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };

describe('the Forgotten skeleton fight in the slice arena (mw-e01.5)', () => {
  it('rests at its post by pillar B facing the doorway, Unaware, leashed 25 m, with no key on the floor', ({
    task,
  }) => {
    markExercised(task, 'scene', 'slice');
    markExercised(task, 'creature', 'forgotten-miner');
    const t = slice();
    const skeleton = t.skeleton();
    expect(t.game.sceneCreatures.entities).toEqual([skeleton]);
    expect(t.game.sceneCreatures.errors).toEqual([]);
    const { origin } = t.world.get(skeleton, CreatureComponent) ?? {};
    expect(origin).toMatchObject({
      creature: 'forgotten-miner',
      point: 'skeleton',
      at: POST,
      facing: { x: 0, y: 0, z: -1 },
      leash: { radius: LEASH_M, post: POST },
    });
    t.step(IDLE, HZ);
    expect(t.brain().state).toBe('unaware');
    expect(flat(t.at(skeleton), POST)).toBeLessThan(0.1);
    // The key exists only on the skeleton: nothing lies in the slice yet.
    expect(t.worldItems()).toEqual([]);
  });

  it('AC-1: the player enters the arena in view of the skeleton; within 2 s it is in Combat and has targeted the player', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'forgotten');
    const t = slice();
    t.step(IDLE, 30);
    expect(t.brain().state).toBe('unaware');
    t.teleport(ARENA_DOORWAY);
    const entered = t.sim.tick;
    t.step(IDLE, 2 * HZ);
    expect(t.sim.tick - entered).toBe(2 * HZ);
    expect(t.brain().state).toBe('combat');
    expect(t.brain().blackboard.target).toBe(t.player);
    // It woke on sight: Unaware → Suspicious → Combat, nothing else.
    expect(t.changes.map((c) => c.to)).toEqual(['suspicious', 'combat']);
  });

  it('AC-1: a clatter in the arena wakes it with the player out of its sight', ({ task }) => {
    markExercised(task, 'sense', 'undead');
    markExercised(task, 'item', 'wooden-shield');
    const t = slice();
    // Far down the corridor, 22 m from the post: beyond its 15 m sight.
    t.teleport({ x: 0, y: 0, z: 10 });
    t.step(IDLE, 30);
    expect(t.brain().state).toBe('unaware');
    // A shield falls to the arena floor a few steps in front of it: its impact is the noise.
    t.game.items.spawn(t.sim, { defId: 'wooden-shield', position: { x: 1, y: 1.5, z: 30.5 } });
    t.until(() => t.brain().state !== 'unaware', 5 * HZ);
    expect(t.brain().state).toBe('suspicious');
    expect(t.brain().blackboard.target).toBeNull();
  });

  it('AC-2: killed, its Died event drops the exit key as a world item within 1 m of its body', ({
    task,
  }) => {
    markExercised(task, 'item', 'rusted-gallery-key');
    const t = slice();
    const skeleton = t.skeleton();
    // A fight first, so it dies away from its post.
    t.teleport(ARENA_DOORWAY);
    t.until(() => t.brain().state === 'combat', 10 * HZ);
    t.until(() => flat(t.at(skeleton), POST) > 1.5, 10 * HZ);
    const died: unknown[] = [];
    const dropped: ItemDropped[] = [];
    let itemsAtDeath = -1;
    t.sim.events.on(Died, (e) => {
      if (e.target !== skeleton) return;
      died.push(e);
      itemsAtDeath = t.worldItems().length;
    });
    t.sim.events.on(itemDropped, (e) => dropped.push(e));
    t.world.step([IDLE, killCommand(skeleton)]);
    expect(died).toHaveLength(1);
    const body = t.at(skeleton);
    expect(t.health()?.current).toBe(0);
    // The key is dropped in the tick it dies, by the skeleton.
    expect(itemsAtDeath).toBe(0);
    // What it carries first (the key), then its tier 1 table's crowns (and maybe scrap, mw-ju8.19).
    expect(dropped[0]).toEqual(
      expect.objectContaining({
        actor: skeleton,
        defId: 'rusted-gallery-key',
        count: 1,
        thrown: false,
      }),
    );
    expect(dropped.slice(1).map((d) => d.defId)).toContain('gold');
    expect(dropped.every((d) => d.actor === skeleton)).toBe(true);
    t.step(IDLE, HZ);
    const items = t.worldItems();
    expect(items.map((i) => i.item)).toEqual(dropped.map((d) => d.defId));
    const [key] = items;
    for (const item of items) {
      expect(flat(item.at, body)).toBeLessThanOrEqual(1);
      expect(Math.abs(item.at.y - body.y)).toBeLessThan(0.5);
    }
    expect(t.world.facts.get('entity:slice/skeleton.slain')).toBe(true);

    // Interact by the body takes what lies there; the key goes onto the keyring.
    const keyEntity = key?.entity ?? -1;
    t.teleport({ x: body.x, y: 0, z: body.z - 1.1 });
    t.step(IDLE, 10);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ verb: 'pick-up', available: true });
    for (let n = 0; n < 6 && t.world.isAlive(keyEntity); n++) {
      t.step(INTERACT);
      t.step(IDLE, 10);
    }
    expect(t.pack()).toContain('rusted-gallery-key');
    expect(t.world.isAlive(keyEntity)).toBe(false);
  });

  it('AC-2: the key it dropped is saved with the level, and the dead skeleton never drops it again', ({
    task,
  }) => {
    markExercised(task, 'item', 'rusted-gallery-key');
    const t = slice();
    t.world.step([IDLE, killCommand(t.skeleton())]);
    t.step(IDLE, HZ);
    const afterKill = t.worldItems().map((i) => i.item);
    expect(afterKill[0]).toBe('rusted-gallery-key');
    expect(afterKill).toContain('gold'); // its tier 1 crowns lie beside the key (mw-ju8.19)
    const registry = createGameSaveRegistry();
    const bytes = registry.write(t.world, { build, wallClockSavedAt: 1_790_000_000_000 });

    const back = slice();
    const loaded = registry.read(back.world, bytes);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.warnings).toEqual([]);
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));
    back.step(IDLE, HZ);
    expect(back.worldItems().map((i) => i.item)).toEqual(afterKill); // nothing dropped twice
    expect(back.health()?.current).toBe(0);
  });

  it('a save taken mid-fight loads into a fresh slice with the same state, and the fight goes on exactly as before', () => {
    const t = slice();
    t.teleport(ARENA_DOORWAY);
    t.until(() => t.brain().state === 'combat', 10 * HZ);
    t.step(IDLE, 3 * HZ); // it has walked the navmesh to the player by now
    const registry = createGameSaveRegistry();
    const bytes = registry.write(t.world, { build, wallClockSavedAt: 1_790_000_000_000 });
    const back = slice();
    const loaded = registry.read(back.world, bytes);
    if (!loaded.ok) throw loaded.error;
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));
    expect(back.brain().state).toBe('combat');
    t.step(IDLE, 5 * HZ);
    back.step(IDLE, 5 * HZ);
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));
  });

  it('AC-3: edge: the player flees beyond the 25 m leash; within 10 s it gives up through Searching into Unaware, walks home and keeps its damage', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'forgotten');
    const t = slice();
    const skeleton = t.skeleton();
    // Walking home down the corridor it passes the wall torch, which burns it like anyone (mw-aps).
    let scorched = 0;
    t.sim.events.on(DamageApplied, (r) => {
      if (r.target === skeleton && r.packet.tags.includes('hazard')) scorched += r.total;
    });
    t.teleport({ x: 1.5, y: 0, z: 29 });
    t.until(() => t.brain().state === 'combat', 10 * HZ);
    // Wounded before the chase.
    const hit = t.game.combat.damage.apply(t.sim, skeleton, {
      amounts: { slash: 40 },
      instigator: t.player,
    });
    expect(hit?.healthAfter).toBe(60);

    // The player flees out of the arena, down the corridor, into the spawn room.
    const path: Vec3[] = [
      { x: 1.5, y: 0, z: 29 },
      { x: 0, y: 0, z: 24.5 },
      { x: 0, y: 0, z: -2 },
    ];
    let fled = 0;
    let beyond = -1;
    let southmost = Infinity;
    for (let tick = 0; ; tick++) {
      if (tick > 30 * HZ) throw new Error('the player never got away');
      fled += FLEE_SPEED / HZ;
      const to = along(path, fled);
      t.world.step([teleportCommand(t.player, to)]);
      southmost = Math.min(southmost, t.at(skeleton).z);
      if (beyond < 0 && flat(to, POST) > LEASH_M) beyond = t.sim.tick;
      if (to.z <= -2) break;
    }
    expect(beyond).toBeGreaterThan(0);
    // 10 s after the player passed the leash: it has given up and stood down, on its way home.
    t.until(() => t.sim.tick - beyond >= 10 * HZ, 10 * HZ);
    const states = t.changes.map((c) => [c.from, c.to, c.cause]);
    const leash = states.findIndex(([, , cause]) => cause === 'leash');
    expect(states[leash]).toEqual(['combat', 'searching', 'leash']);
    expect(states.slice(leash).map(([, to]) => to)).toEqual(['searching', 'unaware']);
    expect(t.brain().state).toBe('unaware');
    expect(southmost).toBeGreaterThan(5); // it never entered the spawn room
    // Home, at its post, still 40 below its maximum (and whatever the torch took).
    t.until(() => flat(t.at(skeleton), POST) <= 0.5, 15 * HZ);
    t.step(IDLE, HZ);
    expect(t.brain().state).toBe('unaware');
    const health = t.health();
    expect((health?.max ?? 0) - (health?.current ?? 0)).toBe(40 + scorched);
    expect(scorched).toBeLessThanOrEqual(8); // a torch's pulse or two, not a bonfire
  });
});
