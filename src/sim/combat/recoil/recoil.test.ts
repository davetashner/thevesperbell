// Wall recoil (mw-e04.15), unit level: hand-built moves swung by a knight at a wall straight ahead.
// The shipped content (halberd, spear, sword, mace in a 2 m corridor) is tests/integration/weapon-reach.
import type { MoveTable, ReachTable, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import { FakeCollisionWorld } from '../../character/fake-collision-world';
import { box, type GreyboxShape } from '../../character/greybox';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../damage/components';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  HitboxComponent,
  type Hurtbox,
  type LiveHitbox,
  type SocketTrack,
} from '../hits/components';
import { HitboxHit } from '../hits/events';
import { hitVolumeSystem, noAllies } from '../hits/system';
import { HitStopComponent } from '../hitstop/components';
import { giveFacing, installMeleeStrikes, MELEE_COMPONENTS } from '../melee';
import { giveStamina, StaminaComponent, staminaSystem } from '../stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionTimeline,
} from '../timeline/components';
import { ActionEnded } from '../timeline/events';
import { actionTimelineSystem, requestMove } from '../timeline/timeline';
import { WallRecoil, type WallRecoilInfo } from './events';
import { recoilWindowTicks, wallRecoilSystem, type WallRecoilOptions } from './system';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const REACH: ReachTable = Object.freeze({
  metres: Object.freeze({ close: 0.6, short: 1.2, medium: 2, long: 3 }),
  wallRecoil: Object.freeze({ ticks: 30, reaches: new Set(['medium', 'long'] as const) }),
});

interface MoveSpec {
  readonly id: string;
  /** Blade length along +z from the origin, metres. */
  readonly length: number;
  readonly swing?: 'horizontal' | 'vertical' | 'thrust';
  readonly reach?: 'close' | 'short' | 'medium' | 'long';
  readonly active?: number;
}

/** A RuntimeMove as compileMove builds it: 6/`active`/6 ticks, a blade held out straight ahead. */
function move({
  id,
  length,
  swing = 'horizontal',
  reach = 'long',
  active = 6,
}: MoveSpec): RuntimeMove {
  return Object.freeze({
    id,
    verb: 'attack',
    startup: 6,
    active,
    recovery: 6,
    totalTicks: 12 + active,
    activeFrom: 6,
    recoveryFrom: 6 + active,
    staminaCost: 0,
    cancelWindows: [],
    damage: {
      amounts: { slash: 10 },
      poiseDamage: 0,
      staminaDamage: 0,
      impulse: v3(0, 0, 0),
      impactForce: 0,
      tags: [],
    },
    hitbox: {
      track: id,
      shape: { kind: 'capsule', from: v3(0, 1.2, 0.3), to: v3(0, 1.2, length), radius: 0.05 },
      reach,
      swing,
    },
    parryable: true,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: 'light',
    chainNext: null,
    charge: null,
    presentation: { anim: `anim-${id}` },
    motion: null,
  } satisfies RuntimeMove);
}

const MOVES: MoveTable = new Map(
  [
    move({ id: 'sweep', length: 2.8 }),
    move({ id: 'thrust', length: 2.9, swing: 'thrust' }),
    move({ id: 'chop', length: 2.8, swing: 'vertical' }),
    move({ id: 'jab', length: 1.1, reach: 'short' }),
    move({ id: 'sword', length: 1.8, reach: 'medium' }),
    move({ id: 'flick', length: 2.8, active: 1 }),
  ].map((m) => [m.id, m]),
);
const TRACKS = new Map<string, SocketTrack>(
  [...MOVES.keys()].map((id) => [id, { id, keys: [IDENTITY_POSE] }]),
);

const WALL = (z: number): GreyboxShape => box(v3(-3, 0, z), v3(3, 3, z + 1));
const FLOOR = box(v3(-5, -1, -5), v3(5, 0, 12));

const torso = (radius: number): Hurtbox => ({
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
  readonly recoils?: WallRecoilOptions['recoils'];
  readonly sweep?: boolean;
  /** Give the knight health and poise (default); false leaves it no combatant at all. */
  readonly combatant?: boolean;
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
  const collision = options.collision ?? new FakeCollisionWorld(options.walls ?? [FLOOR]);
  world.addSystem(staminaSystem()).addSystem(actionTimelineSystem({ moves: MOVES }));
  if (options.sweep !== false) world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
  world.addSystem(
    wallRecoilSystem({
      moves: MOVES,
      reach: REACH,
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
  if (options.combatant !== false) giveCombatant(world, knight, { health: 100, poise: 50 });
  const recoils: WallRecoilInfo[] = [];
  const hits: { target: EntityId; tick: number }[] = [];
  const ended: { move: string; reason: string }[] = [];
  world.events.on(WallRecoil, (e) => recoils.push(e));
  world.events.on(HitboxHit, (e) => hits.push({ target: e.target, tick: e.tick }));
  world.events.on(ActionEnded, (e) => ended.push({ move: e.move, reason: e.reason }));
  const creature = (at: Vec3, radius = 0.3): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.4);
    giveHurtboxes(world, entity, { boxes: [torso(radius)] });
    giveCombatant(world, entity, { health: 500 });
    return entity;
  };
  const swing = (id: string, ticks = 40) => {
    requestMove(world, knight, id);
    for (let i = 0; i < ticks; i++) world.step([]);
  };
  return { world, knight, creature, swing, recoils, hits, ended };
}

describe('weapon reach (mw-e04.15)', () => {
  it('AC-1: a 3.0 m thrust hits a target at 2.8 m; a 2.0 m sword swing does not', () => {
    const spear = setup();
    const mark = spear.creature(v3(0, 0, 2.8), 0.05);
    spear.swing('thrust');
    expect(spear.hits.map((h) => h.target)).toEqual([mark]);
    const sword = setup();
    sword.creature(v3(0, 0, 2.8), 0.05);
    sword.swing('sword');
    expect(sword.hits).toEqual([]);
  });
});

describe('wall recoil (mw-e04.15)', () => {
  it('a long horizontal sweep into a wall recoils on its first active tick: the move ends, 30 ticks locked', () => {
    const s = setup({ walls: [FLOOR, WALL(2.5)] });
    s.swing('sweep', 7);
    expect(s.recoils).toHaveLength(1);
    expect(s.recoils[0]).toMatchObject({
      entity: s.knight,
      move: 'sweep',
      tick: 6,
      activeTick: 1,
      ticks: 30,
      normal: v3(0, 0, -1),
    });
    expect(s.recoils[0]?.point.z).toBeCloseTo(2.5, 6);
    expect(s.world.get(s.knight, ActionTimelineComponent)?.lockTicks).toBe(30);
    expect(s.ended).toEqual([{ move: 'sweep', reason: 'interrupted' }]);
  });

  it('a medium sword recoils too; a short jab, a thrust and a vertical chop never do', () => {
    const wall = { walls: [FLOOR, WALL(1.5)] };
    const results = ['sword', 'jab', 'thrust', 'chop'].map((id) => {
      const s = setup(wall);
      s.swing(id);
      return [id, s.recoils.length];
    });
    // The jab (1.4 m) ends before the wall at 1.5 m: use a nearer wall for it.
    const near = setup({ walls: [FLOOR, WALL(0.9)] });
    near.swing('jab');
    expect(results).toEqual([
      ['sword', 1],
      ['jab', 0],
      ['thrust', 0],
      ['chop', 0],
    ]);
    expect(near.recoils).toEqual([]);
    expect(near.ended.at(-1)).toEqual({ move: 'jab', reason: 'completed' });
  });

  it('AC-4: a creature struck on the tick the blade meets the wall is hit, and nothing recoils', () => {
    const s = setup({ walls: [FLOOR, WALL(2.5)] });
    const front = s.creature(v3(0, 0, 2));
    s.swing('sweep');
    expect(s.hits).toEqual([{ target: front, tick: 6 }]);
    expect(s.recoils).toEqual([]);
    expect(s.ended.at(-1)).toEqual({ move: 'sweep', reason: 'completed' });
  });

  it('a creature a wall hides from the blade does not stop the recoil', () => {
    const s = setup({ walls: [FLOOR, WALL(2.5)] });
    s.creature(v3(0, 0, 4));
    s.swing('sweep');
    expect(s.recoils).toHaveLength(1);
    expect(s.hits).toEqual([]);
  });

  it('only the first half of the active window counts: ticks 1 to ceil(active / 2)', () => {
    expect(recoilWindowTicks(6)).toBe(3);
    expect(recoilWindowTicks(5)).toBe(3);
    expect(recoilWindowTicks(1)).toBe(1);
    // A wall that appears under the blade after its first half does not recoil it.
    let ahead = true;
    const fake = new FakeCollisionWorld([FLOOR, WALL(2.5)]);
    const late = setup({
      collision: { raycast: (...a) => (ahead ? undefined : fake.raycast(...a)) },
    });
    requestMove(late.world, late.knight, 'sweep');
    for (let i = 0; i < 6 + 3; i++) late.world.step([]); // ticks 0 to 8: active ticks 1 to 3
    ahead = false;
    for (let i = 0; i < 20; i++) late.world.step([]);
    expect(late.recoils).toEqual([]);
    // A one-tick window is all first half.
    const flick = setup({ walls: [FLOOR, WALL(2.5)] });
    flick.swing('flick');
    expect(flick.recoils).toHaveLength(1);
  });

  it('only static geometry counts, a collision world that cannot tell counts everything', () => {
    const wall = new FakeCollisionWorld([FLOOR, { ...WALL(2.5), velocity: v3(0, 0, 0.001) }]);
    const moving = setup({ collision: wall });
    moving.swing('sweep');
    expect(moving.recoils).toEqual([]);
    const blind = setup({
      collision: { raycast: (...a) => new FakeCollisionWorld([FLOOR, WALL(2.5)]).raycast(...a) },
    });
    blind.swing('sweep');
    expect(blind.recoils).toHaveLength(1);
  });

  it('a blade begun inside a wall recoils at once', () => {
    const s = setup({ walls: [FLOOR, box(v3(-1, 0, 1), v3(1, 3, 3))] });
    s.swing('sweep');
    expect(s.recoils).toHaveLength(1);
  });

  it('`recoils` can exempt a fighter; the dead and the hit-stopped never recoil', () => {
    const walls = [FLOOR, WALL(2.5)];
    const exempt = setup({ walls, recoils: () => false });
    exempt.swing('sweep');
    expect(exempt.recoils).toEqual([]);
    const dead = setup({ walls });
    requestMove(dead.world, dead.knight, 'sweep');
    for (let i = 0; i < 5; i++) dead.world.step([]);
    dead.world.set(dead.knight, HealthComponent, { max: 100, current: 0 });
    for (let i = 0; i < 10; i++) dead.world.step([]);
    expect(dead.recoils).toEqual([]);
    const frozen = setup({ walls });
    requestMove(frozen.world, frozen.knight, 'sweep');
    for (let i = 0; i < 5; i++) frozen.world.step([]);
    frozen.world.add(frozen.knight, HitStopComponent, {
      tier: 'light',
      startedAt: 5,
      from: 6,
      until: 20,
    });
    for (let i = 0; i < 10; i++) frozen.world.step([]);
    expect(frozen.recoils).toEqual([]);
  });

  it('a fighter that is no combatant (no health) still recoils', () => {
    const s = setup({ walls: [FLOOR, WALL(2.5)], combatant: false });
    s.swing('sweep');
    expect(s.recoils).toHaveLength(1);
  });

  it('is deterministic: the same swing recoils identically every run', () => {
    const run = () => {
      const s = setup({ walls: [FLOOR, WALL(2.5)] });
      s.swing('sweep');
      return s.recoils;
    };
    expect(run()).toEqual(run());
  });
});

describe('what the probe skips', () => {
  /** A knight mid-sweep whose hitbox the test sets by hand (the hit-volume system is not run). */
  function craft(hitbox: Partial<LiveHitbox>) {
    const s = setup({ sweep: false, walls: [FLOOR, box(v3(1, 0, -5), v3(2, 3, 12))] });
    requestMove(s.world, s.knight, 'sweep');
    for (let i = 0; i < 7; i++) s.world.step([]); // the sweep's first active tick is tick 6
    expect(s.world.get(s.knight, HitboxComponent)?.live[0]).toMatchObject({
      elapsed: 0,
      pose: null,
    });
    const live: LiveHitbox = {
      id: 'sweep',
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
    s.world.step([]);
    return s.recoils.length;
  }
  const capsule = (from: Vec3, to: Vec3) => ({ kind: 'capsule', from, to, radius: 0.1 }) as const;
  const sphere = (center: Vec3) => ({ kind: 'sphere', center, radius: 0.1 }) as const;
  const along = (x: number) => capsule(v3(0, 1, 0), v3(x, 1, 0.9));

  it('a hitbox not swept yet, or without an axis (a sphere), probes nothing', () => {
    expect(craft({})).toBe(0);
    expect(craft({ sweptFrom: along(1.5) })).toBe(0);
    expect(craft({ sweptFrom: sphere(v3(0, 1, 0)), pose: sphere(v3(2, 1, 0)) })).toBe(0);
  });

  it('a zero-length blade probes nothing; a sphere before a capsule probes the axis only', () => {
    const point = capsule(v3(0, 1, 0), v3(0, 1, 0));
    expect(craft({ sweptFrom: point, pose: point })).toBe(0);
    expect(craft({ sweptFrom: sphere(v3(0, 1, 0)), pose: along(5) })).toBe(1);
    expect(craft({ sweptFrom: sphere(v3(0, 1, 0)), pose: along(0.5) })).toBe(0);
  });

  it('the point’s path can meet a wall the blade’s axis ends clear of', () => {
    expect(craft({ sweptFrom: along(0.5), pose: along(0.5) })).toBe(0);
    expect(craft({ sweptFrom: along(-0.5), pose: along(0.5) })).toBe(0);
    // The point began inside the wall and ended outside it.
    expect(craft({ sweptFrom: along(1.5), pose: along(0.5) })).toBe(1);
  });

  it('a hitbox that is no move, a spent or unstarted one, or one already in a creature never recoils', () => {
    const swept = { sweptFrom: along(1.5), pose: along(2.5) };
    expect(craft({ ...swept })).toBe(1);
    expect(craft({ ...swept, id: 'not-a-move' })).toBe(0);
    expect(craft({ ...swept, id: 'sword' })).toBe(0);
    expect(craft({ ...swept, elapsed: 4 })).toBe(0);
    expect(craft({ ...swept, elapsed: 0 })).toBe(0);
    expect(craft({ ...swept, hit: [99] })).toBe(0);
  });
});
