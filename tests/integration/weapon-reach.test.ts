// Weapon reach and wall recoil (mw-e04.15): the shipped moves (spear, sword, mace, halberd) from
// content, swung by a knight in a 2 m-wide greybox corridor and in the open.
import {
  compileMoves,
  compileReachClasses,
  compileSocketTracks,
  loadGameContent,
  REACH_CLASS_TABLE_ID,
  type ReachTable,
} from '@content/index';
import { markExercised } from '@content/testing';
import { describe, expect, it } from 'vitest';
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { ActionSampler } from '@game/input/index';
import { createGameWorld, createTestbedWorld } from '@tools/replay/testbed-player-scenario';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionEnded,
  ActionStarted,
  ActionTimelineComponent,
  actionTimelineSystem,
  box,
  DAMAGE_COMPONENTS,
  DamageModel,
  FakeCollisionWorld,
  giveActionTimeline,
  giveCombatant,
  giveFacing,
  giveHitboxes,
  giveHurtboxes,
  giveStamina,
  HealthComponent,
  HIT_VOLUME_COMPONENTS,
  HitboxComponent,
  HitboxHit,
  HitStopComponent,
  hitVolumeSystem,
  IDENTITY_POSE,
  installMeleeStrikes,
  MELEE_COMPONENTS,
  noAllies,
  PlacementComponent,
  placeEntity,
  PlayerLook,
  teleportCommand,
  actCommand,
  RapierCollisionWorld,
  RapierPhysics,
  recoilWindowTicks,
  requestMove,
  StaminaComponent,
  staminaSystem,
  wallRecoilSystem,
  WallRecoil,
  World,
  type CollisionWorld,
  type ActionFrame,
  type EntityId,
  type GreyboxShape,
  type Hurtbox,
  type LiveHitbox,
  type Vec3,
  type WallRecoilInfo,
  type WallRecoilOptions,
} from '@sim/index';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const content = loadGameContent();
const MOVES = compileMoves(content.all('move'));
const TRACKS = compileSocketTracks(content.all('socket-track'));
const REACH = compileReachClasses(content.get('reach-class', REACH_CLASS_TABLE_ID));
/** The shipped table with the medium class recoiling too: what turning the sword's clang on would do. */
const WITH_MEDIUM: ReachTable = Object.freeze({
  ...REACH,
  wallRecoil: Object.freeze({
    ticks: REACH.wallRecoil.ticks,
    reaches: new Set([...REACH.wallRecoil.reaches, 'medium' as const]),
  }),
});

/** A 2 m-wide corridor running along +z: walls 1 m either side of the knight, and a floor. */
const FLOOR = box(v3(-5, -1, -5), v3(5, 0, 12));
const LEFT_WALL = box(v3(-2, 0, -5), v3(-1, 3, 12));
const RIGHT_WALL = box(v3(1, 0, -5), v3(2, 3, 12));
const CORRIDOR: readonly GreyboxShape[] = [FLOOR, LEFT_WALL, RIGHT_WALL];
/** The same hall with the walls 6 m apart: a halberd has room. */
const HALL: readonly GreyboxShape[] = [
  FLOOR,
  box(v3(-7, 0, -5), v3(-6, 3, 12)),
  box(v3(6, 0, -5), v3(7, 3, 12)),
];

const target = (radius: number): Hurtbox => ({
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'sphere', center: v3(0, 1.2, 0), radius },
});

interface Options {
  readonly walls?: readonly GreyboxShape[];
  readonly collision?: WallRecoilOptions['collision'];
  readonly reach?: ReachTable;
  readonly recoils?: WallRecoilOptions['recoils'];
  /** Run the hit-volume system (default); false leaves the hitboxes to the test. */
  readonly sweep?: boolean;
}

function setup(options: Options = {}) {
  const world = new World<never>({ seed: 1 }).register(
    ...ACTION_TIMELINE_COMPONENTS,
    ...MELEE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    HitStopComponent,
    StaminaComponent,
  );
  const collision = options.collision ?? new FakeCollisionWorld(options.walls ?? CORRIDOR);
  world.addSystem(staminaSystem()).addSystem(actionTimelineSystem({ moves: MOVES }));
  if (options.sweep !== false) world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  world.addSystem(
    wallRecoilSystem({
      moves: MOVES,
      reach: options.reach ?? REACH,
      collision,
      ...(options.recoils !== undefined && { recoils: options.recoils }),
    }),
  );
  installMeleeStrikes(world, { moves: MOVES, tracks: TRACKS, damage: new DamageModel() });
  const knight = world.spawn();
  placeEntity(world, knight, v3(0, 0, 0), 0.35);
  giveActionTimeline(world, knight);
  giveFacing(world, knight);
  giveStamina(world, knight);
  giveHitboxes(world, knight);
  giveCombatant(world, knight, { health: 100, poise: 50 });
  const recoils: WallRecoilInfo[] = [];
  const hits: { target: EntityId; tick: number }[] = [];
  const started: { move: string; tick: number }[] = [];
  const ended: { move: string; reason: string; tick: number }[] = [];
  world.events.on(WallRecoil, (e) => recoils.push(e));
  world.events.on(HitboxHit, (e) => hits.push({ target: e.target, tick: e.tick }));
  world.events.on(ActionStarted, (e) => started.push({ move: e.move, tick: e.tick }));
  world.events.on(ActionEnded, (e) =>
    ended.push({ move: e.move, reason: e.reason, tick: world.tick }),
  );
  /** A creature with a hurtbox sphere of `radius` at `at`. */
  const creature = (at: Vec3, radius = 0.4): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.4);
    giveHurtboxes(world, entity, { boxes: [target(radius)] });
    giveCombatant(world, entity, { health: 500 });
    return entity;
  };
  const swing = (move: string, ticks = 90) => {
    requestMove(world, knight, move);
    for (let i = 0; i < ticks; i++) world.step([]);
  };
  const lock = () => world.get(knight, ActionTimelineComponent)?.lockTicks;
  return { world, knight, creature, swing, lock, recoils, hits, started, ended };
}

describe('weapon reach (mw-e04.15)', () => {
  it('AC-1: a spear thrust reaches a target 2.8 m away; a sword swing does not', ({ task }) => {
    for (const id of ['spear-thrust', 'sword-light-1', 'sword-heavy'])
      markExercised(task, 'move', id);
    markExercised(task, 'reach-class', REACH_CLASS_TABLE_ID);
    const thin = 0.05; // a hurtbox as thin as the bead's "target at 2.8 m"
    const spear = setup({ walls: HALL });
    const mark = spear.creature(v3(0.1, 0, 2.8), thin);
    spear.swing('spear-thrust');
    expect(spear.hits.map((h) => h.target)).toEqual([mark]);
    for (const move of ['sword-light-1', 'sword-heavy']) {
      const sword = setup({ walls: HALL });
      sword.creature(v3(0.1, 0, 2.8), thin);
      sword.swing(move);
      expect(sword.hits).toEqual([]);
    }
    // The spear is bounded by its class too: a target at 3.2 m is out of its reach.
    const far = setup({ walls: HALL });
    far.creature(v3(0.1, 0, 3.2), thin);
    far.swing('spear-thrust');
    expect(far.hits).toEqual([]);
  });

  it('reach class metres are the table’s: short 1.2, medium 2.0, long 3.0', () => {
    expect(REACH.metres).toMatchObject({ short: 1.2, medium: 2.0, long: 3.0 });
    expect(REACH.wallRecoil).toMatchObject({ ticks: 30 });
    // Long only, pending the owner's decision on the sword (mw-d4n).
    expect([...REACH.wallRecoil.reaches]).toEqual(['long']);
  });

  it('the mace is a fast short swing: 8/3/12 ticks', ({ task }) => {
    markExercised(task, 'move', 'mace-light');
    expect(MOVES.get('mace-light')).toMatchObject({ startup: 8, active: 3, recovery: 12 });
  });
});

describe('wall recoil (mw-e04.15)', () => {
  it('AC-2: a halberd sweep in a 2 m corridor clangs off the wall and locks the knight for 30 ticks', ({
    task,
  }) => {
    markExercised(task, 'move', 'halberd-sweep');
    const s = setup();
    requestMove(s.world, s.knight, 'halberd-sweep');
    while (s.recoils.length === 0) s.world.step([]);
    const [recoil] = s.recoils;
    expect(recoil).toMatchObject({
      entity: s.knight,
      move: 'halberd-sweep',
      activeTick: 1,
      ticks: 30,
    });
    // The first active tick of a 22/6/30 move started on tick 0 is tick 22.
    expect(recoil?.tick).toBe(22);
    // The blade met a side wall (x = ±1), pointing back into the corridor.
    expect(Math.abs(recoil?.point.x ?? 0)).toBeCloseTo(1, 3);
    expect(Math.abs(recoil?.normal.x ?? 0)).toBeCloseTo(1, 3);
    expect(s.lock()).toBe(30);
    expect(s.ended.at(-1)).toMatchObject({
      move: 'halberd-sweep',
      reason: 'interrupted',
      tick: 22,
    });
    // Locked out for exactly 30 ticks (23 to 52): the first move that can start does so on tick 53.
    for (let i = 0; i < 60 && s.started.length < 2; i++) {
      requestMove(s.world, s.knight, 'mace-light');
      s.world.step([]);
    }
    expect(s.started.at(-1)).toEqual({ move: 'mace-light', tick: 22 + 30 + 1 });
    // And the swing is over: its hitbox closed and it struck nothing, now or later.
    expect(s.hits).toEqual([]);
    expect(s.recoils).toHaveLength(1);
  });

  it('AC-2: the same halberd sweep in a hall recoils from nothing', () => {
    const s = setup({ walls: HALL });
    s.swing('halberd-sweep');
    expect(s.recoils).toEqual([]);
    expect(s.ended.at(-1)).toMatchObject({ move: 'halberd-sweep', reason: 'completed' });
  });

  it('the shipped sword does not clang off a corridor wall; with medium enabled in an injected table it does, and a short mace still does not', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-light-1');
    const shipped = setup();
    shipped.swing('sword-light-1');
    expect(shipped.recoils).toEqual([]);
    expect(shipped.ended.at(-1)).toMatchObject({ move: 'sword-light-1', reason: 'completed' });
    const sword = setup({ reach: WITH_MEDIUM });
    sword.swing('sword-light-1');
    expect(sword.recoils.map((r) => r.move)).toEqual(['sword-light-1']);
    const mace = setup({ reach: WITH_MEDIUM });
    mace.swing('mace-light');
    expect(mace.recoils).toEqual([]);
    expect(mace.ended.at(-1)).toMatchObject({ move: 'mace-light', reason: 'completed' });
  });

  it('AC-3: a spear thrust in the corridor never recoils', () => {
    const s = setup();
    s.swing('spear-thrust');
    expect(s.recoils).toEqual([]);
    expect(s.ended.at(-1)).toMatchObject({ move: 'spear-thrust', reason: 'completed' });
  });

  it('AC-3: a vertical sword swing and a vertical halberd chop in the corridor never recoil', ({
    task,
  }) => {
    markExercised(task, 'move', 'halberd-chop');
    for (const move of ['sword-heavy', 'halberd-chop']) {
      const s = setup();
      s.swing(move, 120);
      expect(s.recoils).toEqual([]);
      expect(s.ended.at(-1)).toMatchObject({ move, reason: 'completed' });
    }
  });

  it('AC-4: a sweep that hits a creature on the tick it meets the wall hits it and does not recoil', () => {
    const s = setup();
    // At the first active tick the blade crosses both this creature and the right wall.
    const beside = s.creature(v3(0.9, 0, 0.85));
    s.swing('halberd-sweep');
    expect(s.hits[0]).toEqual({ target: beside, tick: 22 });
    expect(s.recoils).toEqual([]);
    expect(s.ended.at(-1)).toMatchObject({ move: 'halberd-sweep', reason: 'completed' });
  });

  it('a creature struck on an earlier tick keeps the swing from recoiling later; one struck later does not', () => {
    // The wall is only on the left, which the sweep (right to left) reaches after the creature.
    const left = [FLOOR, LEFT_WALL];
    const early = setup({ walls: left });
    early.creature(v3(0.9, 0, 0.85));
    early.swing('halberd-sweep');
    expect(early.hits).toHaveLength(1);
    expect(early.recoils).toEqual([]);
    // The wall at tick 1 beats a creature the blade would only reach later.
    const late = setup();
    late.creature(v3(-0.5, 0, 2.4), 0.3);
    late.swing('halberd-sweep');
    expect(late.recoils).toHaveLength(1);
    expect(late.hits).toEqual([]);
  });

  it('a wall first met after the first half of the window does not recoil', () => {
    // 6 active ticks: the first half is ticks 1 to 3. A wall only 2.2 m to the left is reached after.
    expect(recoilWindowTicks(6)).toBe(3);
    expect(recoilWindowTicks(3)).toBe(2);
    expect(recoilWindowTicks(1)).toBe(1);
    const s = setup({ walls: [FLOOR, box(v3(-4, 0, -5), v3(-2.2, 3, 12))] });
    s.swing('halberd-sweep');
    expect(s.recoils).toEqual([]);
  });

  it('only static geometry counts: a crate or a moving platform is not a wall', () => {
    const crate: GreyboxShape = { ...RIGHT_WALL, velocity: v3(0, 0, 0.001) };
    const s = setup({ walls: [FLOOR, LEFT_WALL, crate] });
    // Only the left wall is level geometry; the sweep starts at the right, so it reaches it late.
    s.swing('halberd-sweep');
    expect(s.recoils).toEqual([]);
    const blind: Pick<CollisionWorld, 'raycast'> = new FakeCollisionWorld(CORRIDOR);
    const noOracle = setup({ collision: { raycast: (...a) => blind.raycast(...a) } });
    noOracle.swing('halberd-sweep');
    expect(noOracle.recoils).toHaveLength(1);
  });

  it('a blade begun inside a wall recoils at once, with no surface normal', () => {
    const s = setup({ walls: [box(v3(-0.5, 0, 0.5), v3(0.5, 3, 3))] });
    s.swing('halberd-sweep');
    expect(s.recoils).toHaveLength(1);
  });

  it('recoils: false, a dead fighter and a hit-stopped one never recoil', () => {
    const picky = setup({ recoils: () => false });
    picky.swing('halberd-sweep');
    expect(picky.recoils).toEqual([]);
    const dead = setup();
    requestMove(dead.world, dead.knight, 'halberd-sweep');
    for (let i = 0; i < 21; i++) dead.world.step([]);
    dead.world.set(dead.knight, HealthComponent, { max: 100, current: 0 });
    for (let i = 0; i < 10; i++) dead.world.step([]);
    expect(dead.recoils).toEqual([]);
    const frozen = setup();
    requestMove(frozen.world, frozen.knight, 'halberd-sweep');
    for (let i = 0; i < 21; i++) frozen.world.step([]);
    frozen.world.add(frozen.knight, HitStopComponent, {
      tier: 'light',
      startedAt: 21,
      from: 22,
      until: 30,
    });
    for (let i = 0; i < 9; i++) frozen.world.step([]);
    expect(frozen.recoils).toEqual([]);
  });

  it('is in the sim’s determinism: the same swing recoils on the same tick every run', () => {
    const run = () => {
      const s = setup();
      s.swing('halberd-sweep');
      return s.recoils;
    };
    expect(run()).toEqual(run());
  });
});

describe('what the probe skips', () => {
  /**
   * A knight mid-sweep whose hitbox the test sets by hand (the hit-volume system is not run, so the
   * poses stay as written): the move is current and its hitbox has opened, unswept.
   */
  function craft(hitbox: Partial<LiveHitbox>) {
    const s = setup({ sweep: false });
    requestMove(s.world, s.knight, 'halberd-sweep');
    for (let i = 0; i < 23; i++) s.world.step([]); // the sweep's first active tick is tick 22
    expect(s.world.get(s.knight, HitboxComponent)?.live[0]).toMatchObject({
      elapsed: 0,
      pose: null,
    });
    const live: LiveHitbox = {
      id: 'halberd-sweep',
      shape: { kind: 'sphere', center: v3(0, 0, 0), radius: 0.1 },
      track: { id: 'still', keys: [IDENTITY_POSE] },
      activeTicks: 6,
      aim: v3(0, 0, 1),
      friendlyFire: false,
      elapsed: 1,
      sweptFrom: null,
      pose: null,
      hit: [],
      ...hitbox,
    };
    s.world.set(s.knight, HitboxComponent, { live: [live] });
    return s;
  }
  const capsule = (from: Vec3, to: Vec3) => ({ kind: 'capsule', from, to, radius: 0.1 }) as const;
  const sphere = (center: Vec3) => ({ kind: 'sphere', center, radius: 0.1 }) as const;

  it('a hitbox not swept yet, or with no axis (a sphere), probes nothing', () => {
    for (const hitbox of [{}, { sweptFrom: sphere(v3(0, 1, 0)), pose: sphere(v3(0, 1, 0.5)) }]) {
      const s = craft(hitbox);
      s.world.step([]);
      expect(s.recoils).toEqual([]);
    }
  });

  it('a zero-length blade probes nothing; a blade after a point-shaped sweep probes its axis only', () => {
    const point = craft({
      sweptFrom: capsule(v3(0, 1, 0), v3(0, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(0, 1, 0)),
    });
    point.world.step([]);
    expect(point.recoils).toEqual([]);
    const sphereBefore = craft({
      sweptFrom: sphere(v3(0, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(5, 1, 0)),
    });
    sphereBefore.world.step([]);
    expect(sphereBefore.recoils).toHaveLength(1);
  });

  it('only the path of the point can meet a wall the axis passes by', () => {
    const s = craft({
      sweptFrom: capsule(v3(0, 1, 0), v3(0.5, 1, 4)),
      pose: capsule(v3(0, 1, 0), v3(0.5, 1, 0.9)),
    });
    s.world.step([]);
    expect(s.recoils).toEqual([]);
    const through = craft({
      sweptFrom: capsule(v3(0, 1, 0), v3(-0.5, 1, 0.9)),
      pose: capsule(v3(0, 1, 0), v3(0.5, 1, 0.9)),
    });
    through.world.step([]);
    expect(through.recoils).toEqual([]);
    // The point began inside the wall and ended outside it: only its path says so.
    const inside = craft({
      sweptFrom: capsule(v3(0, 1, 0), v3(1.5, 1, 0.9)),
      pose: capsule(v3(0, 1, 0), v3(0.5, 1, 0.9)),
    });
    inside.world.step([]);
    expect(inside.recoils).toHaveLength(1);
  });

  it('a hitbox that is not a move, one of a move no longer running and a spent one never recoil', () => {
    const stranger = craft({
      id: 'not-a-move',
      sweptFrom: capsule(v3(0, 1, 0), v3(5, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(5, 1, 0.2)),
    });
    stranger.world.step([]);
    const other = craft({
      id: 'sword-light-1',
      sweptFrom: capsule(v3(0, 1, 0), v3(5, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(5, 1, 0.2)),
    });
    other.world.step([]);
    const spent = craft({
      elapsed: 4,
      sweptFrom: capsule(v3(0, 1, 0), v3(5, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(5, 1, 0.2)),
    });
    spent.world.step([]);
    const fresh = craft({
      elapsed: 0,
      sweptFrom: capsule(v3(0, 1, 0), v3(5, 1, 0)),
      pose: capsule(v3(0, 1, 0), v3(5, 1, 0.2)),
    });
    fresh.world.step([]);
    expect([stranger, other, spent, fresh].map((s) => s.recoils.length)).toEqual([0, 0, 0, 0]);
  });
});

describe('wall recoil against the game’s Rapier level (mw-e04.15)', () => {
  /** A Rapier physics world with `fixed` greybox level pieces and `crates` dynamic boxes. */
  function rapierLevel(fixed: readonly GreyboxShape[], crates: readonly Vec3[] = []) {
    const physics = new RapierPhysics(RAPIER);
    for (const shape of fixed) physics.add(shape);
    for (const position of crates) {
      physics.addBody({
        shape: { kind: 'box', halfExtents: v3(0.5, 1.5, 6) },
        position,
        mass: 200,
        friction: 0.5,
        restitution: 0,
      });
    }
    physics.step(0);
    return new RapierCollisionWorld(physics);
  }

  it('AC-2: the halberd sweep clangs off the corridor’s walls on its first active tick', () => {
    const s = setup({ collision: rapierLevel(CORRIDOR) });
    requestMove(s.world, s.knight, 'halberd-sweep');
    while (s.recoils.length === 0 && s.world.tick < 80) s.world.step([]);
    expect(s.recoils).toHaveLength(1);
    expect(s.recoils[0]).toMatchObject({ tick: 22, activeTick: 1, ticks: 30 });
    expect(Math.abs(s.recoils[0]?.point.x ?? 0)).toBeCloseTo(1, 3);
    expect(s.lock()).toBe(30);
  });

  it('AC-3: a spear thrust and a vertical chop in the same Rapier corridor never recoil', () => {
    for (const move of ['spear-thrust', 'halberd-chop', 'sword-heavy']) {
      const s = setup({ collision: rapierLevel(CORRIDOR) });
      s.swing(move, 120);
      expect(s.recoils).toEqual([]);
    }
  });

  it('a hall is no corridor, and crates in the corridor’s place are not walls', () => {
    const hall = setup({ collision: rapierLevel(HALL) });
    hall.swing('halberd-sweep');
    expect(hall.recoils).toEqual([]);
    const crates = setup({
      collision: rapierLevel([FLOOR], [v3(-1.5, 1.5, 3), v3(1.5, 1.5, 3)]),
    });
    crates.swing('halberd-sweep');
    expect(crates.recoils).toEqual([]);
  });
});

describe('wall recoil in the game’s testbed (mw-e04.15)', () => {
  /** The headless testbed, the knight stood at `at` facing `yaw`, then a light attack. */
  function swingAt(at: Vec3, yaw: number) {
    const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
    const [player] = world.query(PlayerLook).ids();
    if (player === undefined) throw new Error('no player');
    const sampler = new ActionSampler();
    const recoils: WallRecoilInfo[] = [];
    world.events.on(WallRecoil, (e) => recoils.push(e));
    world.step([...sampler.sampleCommands(world.tick), teleportCommand(player, at) as never]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    for (let i = 0; i < 40; i++) world.step(sampler.sampleCommands(world.tick));
    sampler.down('Mouse0');
    world.step(sampler.sampleCommands(world.tick));
    sampler.up('Mouse0');
    for (let i = 0; i < 60; i++) world.step(sampler.sampleCommands(world.tick));
    return { recoils, player, lock: world.get(player, ActionTimelineComponent)?.lockTicks };
  }

  it('the knight’s own sword swing, shipped, does not clang off the wall right in front of him', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-light-1');
    // Facing the back wall (its face is at z = -4.5) from 0.5 m away: the sword is medium reach.
    const wall = swingAt(v3(0, 0, -4), 0);
    expect(wall.recoils).toEqual([]);
    expect(wall.lock).toBe(0);
  });

  it('the recoil corridor scene: the halberd sweep (debug `act halberd-sweep`) clangs off a side wall at its surface, the normal facing the knight', ({
    task,
  }) => {
    markExercised(task, 'scene', 'recoil-corridor');
    markExercised(task, 'move', 'halberd-sweep');
    const { world } = createGameWorld<ActionFrame>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'recoil-corridor',
    });
    const [player] = world.query(PlayerLook).ids();
    if (player === undefined) throw new Error('no player');
    const sampler = new ActionSampler();
    const recoils: WallRecoilInfo[] = [];
    world.events.on(WallRecoil, (e) => recoils.push(e));
    for (let i = 0; i < 40; i++) world.step(sampler.sampleCommands(world.tick));
    world.step([
      ...sampler.sampleCommands(world.tick),
      actCommand(player, 'halberd-sweep') as never,
    ]);
    for (let i = 0; i < 60; i++) world.step(sampler.sampleCommands(world.tick));
    expect(recoils).toHaveLength(1);
    const [recoil] = recoils;
    expect(recoil).toMatchObject({ entity: player, move: 'halberd-sweep', ticks: 30 });
    // The side walls' faces are at x = ±1.15; the normal points back into the corridor.
    expect(Math.abs(recoil?.point.x ?? 0)).toBeCloseTo(1.15, 2);
    expect(recoil?.normal.x).toBe(-Math.sign(recoil?.point.x ?? 0));
  });

  it('the sword in the recoil corridor, shipped, swings through without a recoil', () => {
    const { world } = createGameWorld<ActionFrame>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'recoil-corridor',
    });
    const sampler = new ActionSampler();
    const recoils: WallRecoilInfo[] = [];
    world.events.on(WallRecoil, (e) => recoils.push(e));
    for (let i = 0; i < 40; i++) world.step(sampler.sampleCommands(world.tick));
    sampler.down('Mouse0');
    world.step(sampler.sampleCommands(world.tick));
    sampler.up('Mouse0');
    for (let i = 0; i < 40; i++) world.step(sampler.sampleCommands(world.tick));
    expect(recoils).toEqual([]);
  });
});
