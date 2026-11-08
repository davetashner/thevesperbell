import type { RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { installFactions, joinFaction } from '../../factions/runtime';
import { buildFactionTable, PLAYER_FACTION } from '../../factions/table';
import {
  IDENTITY_POSE,
  shapesOverlap,
  type GeomShape,
  type LocalShape,
  type Pose,
} from '../../geom';
import { cos, sin } from '../../math';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf, HealthComponent } from '../damage/components';
import { DamageModel } from '../damage/model';
import {
  closeHitboxes,
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  HitboxComponent,
  liveHitboxes,
  openHitbox,
  setHurtboxFacing,
  setRegionState,
  type HitboxSpec,
  type Hurtbox,
  type LiveHitbox,
  type SocketTrack,
} from './components';
import { DodgedHit, HitboxHit, type HitboxHitInfo } from './events';
import {
  alliesByStance,
  debugShapes,
  entityFrame,
  hashShapes,
  hitboxFromMove,
  hitboxShapeAt,
  hitPacket,
  hitVolumeDebug,
  hitVolumeSystem,
  hurtboxShapes,
  moveTrack,
  noAllies,
  sameFaction,
  type HitVolumeOptions,
} from './system';

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The socket turned `angle` radians about +y (sim maths: no Math.sin). */
const yaw = (angle: number): Pose => ({
  position: v3(0, 0, 0),
  rotation: { x: 0, y: sin(angle / 2), z: 0, w: cos(angle / 2) },
});

// AC-1's swing: a sword blade (hilt 0.3 m, tip 1.3 m out, 5 cm thick) sweeps a 2.0 m arc at the tip
// over 4 active ticks, horizontally at the attacker's placement height.
const TIP = 1.3;
const ARC = 2.0;
const TOTAL = ARC / TIP;
const STEP = TOTAL / 4;
const BLADE: LocalShape = { kind: 'capsule', from: v3(0, 0, 0.3), to: v3(0, 0, TIP), radius: 0.05 };
const ARC_TRACK: SocketTrack = {
  id: 'test-sword-arc',
  keys: [0, 1, 2, 3, 4].map((k) => yaw(-TOTAL / 2 + k * STEP)),
};
/**
 * A point on the arc at radius `r`, `at` keys into the swing: the default 2.5 is where the sweep
 * between keys 2 and 3 (active tick 3) passes.
 */
function midArc(r: number, at = 2.5): Vec3 {
  const angle = -TOTAL / 2 + at * STEP;
  return v3(r * sin(angle), 0, r * cos(angle));
}

const STILL: SocketTrack = { id: 'still', keys: [IDENTITY_POSE] };

function swing(overrides: Partial<HitboxSpec> = {}): HitboxSpec {
  return {
    id: 'swing',
    shape: BLADE,
    track: ARC_TRACK,
    activeTicks: 4,
    aim: FORWARD,
    friendlyFire: false,
    ...overrides,
  };
}

const torso = (overrides: Partial<Hurtbox> = {}): Hurtbox => ({
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.4 },
  ...overrides,
});

function setup(options: HitVolumeOptions = { isAlly: noAllies }) {
  const world = new World<never>({ seed: 3 }).register(
    ...HIT_VOLUME_COMPONENTS,
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
  );
  world.addSystem(hitVolumeSystem(options));
  const hits: HitboxHitInfo[] = [];
  world.events.on(HitboxHit, (hit) => hits.push(hit));
  /** An attacker whose frame origin is `at` (the blade swings at that height). */
  const attacker = (at: Vec3 = v3(0, 1, 0)): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, at, 0.4);
    giveHitboxes(world, e);
    return e;
  };
  /** A target at `at` (its feet) with `boxes`. */
  const target = (at: Vec3, boxes: readonly Hurtbox[] = [torso()], health?: number): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, at, 1);
    giveHurtboxes(world, e, { boxes });
    if (health !== undefined) giveCombatant(world, e, { health });
    return e;
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, hits, attacker, target, steps };
}

/** The world shape of `hitbox` at `key` for `attacker`. */
function shapeAt(
  world: World<never>,
  attacker: EntityId,
  spec: HitboxSpec,
  key: number,
): GeomShape {
  const frame = entityFrame(world, attacker, spec.aim);
  if (frame === undefined) throw new Error('unplaced');
  const live = { shape: spec.shape, track: spec.track } as LiveHitbox;
  return hitboxShapeAt(frame, live, key);
}

describe('region state (mw-e05.6)', () => {
  it('AC-2: a weakpoint struck outside its enabling state reports its underlying region', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    const core = torso({
      id: 'core',
      region: 'weakpoint',
      multiplier: 3,
      enabledIn: ['roaring'],
      underlying: { region: 'limb', multiplier: 0.5 },
    });
    const t = target(midArc(1.0), [core]);
    openHitbox(world, a, swing());
    steps(4);
    expect(hits[0]).toMatchObject({ target: t, hurtbox: 'core', region: 'limb', multiplier: 0.5 });
    hits.length = 0;
    setRegionState(world, t, 'roaring');
    openHitbox(world, a, swing({ id: 'again' }));
    steps(4);
    expect(hits[0]).toMatchObject({ region: 'weakpoint', multiplier: 3 });
  });
});

describe('hit volumes (mw-e04.2)', () => {
  it('AC-1: a 2.0 m arc over 4 ticks strikes a 0.4 m-radius capsule no tick pose touches, once, on the tick whose sweep crosses it', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    // A crouched 0.4 m-radius capsule whose top just rises into the swing plane mid-arc: in that
    // plane it is narrower than the gap the blade jumps between two tick poses.
    const centre = midArc(1.0);
    const crouched = torso({
      shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 0.58, 0), radius: 0.4 },
    });
    const t = target(centre, [crouched]);
    const [placed] = hurtboxShapes(world, t);
    if (placed === undefined) throw new Error('no hurtbox');
    for (let key = 0; key <= 4; key++) {
      expect(shapesOverlap(shapeAt(world, a, swing(), key), placed.shape)).toBe(false);
    }
    const opened = world.tick;
    openHitbox(world, a, swing());
    steps(4);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ target: t, activeTick: 3, tick: opened + 2, attacker: a });
  });

  it('AC-1: the sweep also catches a thin post standing between two tick poses', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    const post = torso({
      shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 2, 0), radius: 0.05 },
    });
    const t = target(midArc(1.1), [post]);
    const [placed] = hurtboxShapes(world, t);
    if (placed === undefined) throw new Error('no hurtbox');
    for (let key = 0; key <= 4; key++) {
      expect(shapesOverlap(shapeAt(world, a, swing(), key), placed.shape)).toBe(false);
    }
    openHitbox(world, a, swing());
    steps(4);
    expect(hits.map((h) => [h.target, h.activeTick])).toEqual([[t, 3]]);
  });

  it('AC-2: a hitbox overlapping a target on all 4 active ticks hits it exactly once per swing', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    const spec = swing({
      shape: { kind: 'sphere', center: v3(0, 0, 1), radius: 0.5 },
      track: STILL,
    });
    const t = target(v3(0, 0, 1.2));
    const [placed] = hurtboxShapes(world, t);
    if (placed === undefined) throw new Error('no hurtbox');
    for (let key = 0; key <= 4; key++) {
      expect(shapesOverlap(shapeAt(world, a, spec, key), placed.shape)).toBe(true);
    }
    openHitbox(world, a, spec);
    steps(4);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ target: t, activeTick: 1 });
    expect(liveHitboxes(world, a)[0]?.hit).toEqual([t]);
    // A new window (the next swing) may hit it again.
    steps(1);
    openHitbox(world, a, spec);
    steps(4);
    expect(hits).toHaveLength(2);
  });

  it('mw-e04.8: an invulnerable target gets DodgedHit, not HitboxHit, once per window', () => {
    let invulnerableUntil = 0;
    const { world, hits, attacker, target, steps } = setup({
      isAlly: noAllies,
      invulnerable: (w) => w.tick <= invulnerableUntil,
    });
    const dodged: HitboxHitInfo[] = [];
    world.events.on(DodgedHit, (hit) => dodged.push(hit));
    const a = attacker();
    const spec = swing({
      shape: { kind: 'sphere', center: v3(0, 0, 1), radius: 0.5 },
      track: STILL,
    });
    const t = target(v3(0, 0, 1.2));
    invulnerableUntil = world.tick;
    openHitbox(world, a, spec);
    steps(4);
    expect(hits).toEqual([]);
    expect(dodged.map((h) => [h.target, h.activeTick, h.region])).toEqual([[t, 1, 'torso']]);
    // The next swing, after the i-frames: an ordinary hit.
    steps(1);
    openHitbox(world, a, spec);
    steps(4);
    expect(hits.map((h) => [h.target, h.activeTick])).toEqual([[t, 1]]);
    expect(dodged).toHaveLength(1);
  });

  it('AC-3: overlapping head and torso crossed on the same tick resolve to the head and its multiplier', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    const head: Hurtbox = {
      id: 'head',
      socket: 'root',
      region: 'head',
      armored: false,
      multiplier: 1.5,
      shape: { kind: 'sphere', center: v3(0, 1.1, 0), radius: 0.3 },
    };
    // Torso listed first: priority, not order, decides.
    const t = target(v3(0, 0, 1.2), [torso(), head], 100);
    const spec = swing({
      shape: { kind: 'sphere', center: v3(0, 0, 1.2), radius: 0.3 },
      track: STILL,
    });
    const [torsoShape, headShape] = hurtboxShapes(world, t).map((p) => p.shape);
    const tick1 = shapeAt(world, a, spec, 1);
    expect(torsoShape && shapesOverlap(tick1, torsoShape)).toBe(true);
    expect(headShape && shapesOverlap(tick1, headShape)).toBe(true);
    const damage = new DamageModel();
    world.events.on(HitboxHit, (hit) =>
      damage.apply(world, hit.target, hitPacket(hit, { amounts: { slash: 10 } })),
    );
    openHitbox(world, a, spec);
    steps(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      region: 'head',
      multiplier: 1.5,
      hurtbox: 'head',
      armored: false,
    });
    expect(healthOf(world, t)?.current).toBe(85);
  });

  it('region priority: weakpoint beats head; within a region the larger multiplier, then the earlier hurtbox', () => {
    const run = (boxes: readonly Hurtbox[]) => {
      const { world, hits, attacker, target, steps } = setup();
      const a = attacker();
      target(v3(0, 0, 1.2), boxes);
      openHitbox(
        world,
        a,
        swing({ shape: { kind: 'sphere', center: v3(0, 0, 1.2), radius: 0.6 }, track: STILL }),
      );
      steps(1);
      return hits[0]?.hurtbox;
    };
    const ball = (id: string, region: Hurtbox['region'], multiplier: number): Hurtbox => ({
      id,
      socket: 'root',
      region,
      armored: region === 'weakpoint',
      multiplier,
      shape: { kind: 'sphere', center: v3(0, 1, 0), radius: 0.2 },
    });
    expect(
      run([ball('head', 'head', 2), ball('eye', 'weakpoint', 3), ball('arm', 'limb', 1)]),
    ).toBe('eye');
    expect(run([ball('a', 'torso', 1), ball('b', 'torso', 1.2)])).toBe('b');
    expect(run([ball('a', 'torso', 1.2), ball('b', 'torso', 1.2)])).toBe('a');
    // A higher-priority hurtbox the sweep misses does not win.
    const missed = {
      ...ball('eye', 'weakpoint', 3),
      shape: { kind: 'sphere', center: v3(0, 5, 0), radius: 0.1 },
    } as const;
    expect(run([missed, ball('arm', 'limb', 0.5)])).toBe('arm');
    // Its bounds overlap but its shape does not.
    const beside = {
      ...ball('eye', 'weakpoint', 3),
      shape: { kind: 'box', center: v3(0.75, 1.75, 0), halfExtents: v3(0.2, 0.2, 0.2) },
    } as const;
    expect(run([ball('arm', 'limb', 0.5), beside])).toBe('arm');
  });

  it('AC-4: friendlyFire true damages an ally the sweep crosses; false ignores it', () => {
    const table = buildFactionTable([
      {
        id: 'wolves',
        towardPlayer: 'hostile',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [],
      },
      {
        id: 'boars',
        towardPlayer: 'neutral',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [],
      },
    ]);
    const run = (friendlyFire: boolean) => {
      const { world, hits, attacker, target, steps } = setup({ isAlly: sameFaction });
      installFactions(world);
      const a = attacker();
      const ally = target(midArc(1.0), [torso()], 100);
      const stranger = target(v3(-3, 0, 1), [torso()], 100);
      const boar = target(midArc(1.0, 0.5), [torso()], 100);
      joinFaction(world, table, a, 'wolves');
      joinFaction(world, table, ally, 'wolves');
      joinFaction(world, table, boar, 'boars');
      const damage = new DamageModel();
      world.events.on(HitboxHit, (hit) =>
        damage.apply(world, hit.target, hitPacket(hit, { amounts: { slash: 10 } })),
      );
      openHitbox(world, a, swing({ friendlyFire }));
      steps(4);
      return {
        struck: hits.map((h) => h.target),
        ally: healthOf(world, ally)?.current,
        boar: healthOf(world, boar)?.current,
        stranger: healthOf(world, stranger)?.current,
        ids: { ally, boar },
      };
    };
    const on = run(true);
    expect(on.struck).toContain(on.ids.ally);
    expect(on.ally).toBe(90);
    const off = run(false);
    expect(off.struck).not.toContain(off.ids.ally);
    expect(off.ally).toBe(100);
    // Non-allies are struck either way; nobody out of reach is.
    expect(on.boar).toBe(90);
    expect(off.boar).toBe(90);
    expect(on.stranger).toBe(100);
  });

  it('ally rules: same faction by default; alliesByStance reads live stances', () => {
    const table = buildFactionTable([
      {
        id: 'wolves',
        towardPlayer: 'hostile',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [{ faction: 'crows', stance: 'friendly', mutual: true }],
      },
      {
        id: 'crows',
        towardPlayer: 'neutral',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [],
      },
    ]);
    const world = installFactions(new World<never>({ seed: 1 }));
    const [wolf, wolf2, crow, loner] = [world.spawn(), world.spawn(), world.spawn(), world.spawn()];
    joinFaction(world, table, wolf, 'wolves');
    joinFaction(world, table, wolf2, 'wolves');
    joinFaction(world, table, crow, 'crows');
    expect(sameFaction(world, wolf, wolf2)).toBe(true);
    expect(sameFaction(world, wolf, crow)).toBe(false);
    expect(sameFaction(world, loner, wolf)).toBe(false);
    const byStance = alliesByStance(table);
    expect(byStance(world, wolf, crow)).toBe(true);
    expect(byStance(world, wolf, loner)).toBe(false);
    expect(PLAYER_FACTION).toBe('player');
  });

  it('alliesByStance as the system rule spares a friendly faction', () => {
    const table = buildFactionTable([
      {
        id: 'wolves',
        towardPlayer: 'hostile',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [{ faction: 'crows', stance: 'friendly', mutual: true }],
      },
      {
        id: 'crows',
        towardPlayer: 'neutral',
        towardMembers: 'ally',
        towardOthers: 'neutral',
        relations: [],
      },
    ]);
    const { world, hits, attacker, target, steps } = setup({ isAlly: alliesByStance(table) });
    installFactions(world);
    const a = attacker();
    const crow = target(midArc(1.0));
    joinFaction(world, table, a, 'wolves');
    joinFaction(world, table, crow, 'crows');
    openHitbox(world, a, swing());
    steps(4);
    expect(hits).toHaveLength(0);
  });

  it('AC-5: an attacker destroyed during its active window loses its hit volumes; no further hits', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    // Only the tick-3 sweep reaches this post.
    target(midArc(1.1), [
      torso({ shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 2, 0), radius: 0.05 } }),
    ]);
    openHitbox(world, a, swing());
    steps(2);
    expect(hitVolumeDebug(world).hitboxes).toHaveLength(1);
    world.destroy(a);
    steps(3);
    expect(hits).toHaveLength(0);
    expect(world.isAlive(a)).toBe(false);
    expect(hitVolumeDebug(world).hitboxes).toHaveLength(0);
    expect(world.query(HitboxComponent).ids()).toEqual([]);
  });

  it('a dead attacker (0 health) closes its hitboxes without hitting', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    giveCombatant(world, a, { health: 10 });
    target(midArc(1.1), [
      torso({ shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 2, 0), radius: 0.05 } }),
    ]);
    openHitbox(world, a, swing());
    steps(1);
    world.set(a, HealthComponent, { max: 10, current: 0 });
    steps(3);
    expect(hits).toHaveLength(0);
    expect(liveHitboxes(world, a)).toEqual([]);
  });

  it('skips dead targets, the attacker itself, and entities without hurtboxes', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker();
    giveHurtboxes(world, a, { boxes: [torso()] });
    const dead = target(v3(0, 0, 1.2), [torso()], 5);
    world.set(dead, HealthComponent, { max: 5, current: 0 });
    const bare = world.spawn();
    placeEntity(world, bare, v3(0, 0, 1.2), 1);
    const empty = target(v3(0, 0, 1.2), []);
    openHitbox(
      world,
      a,
      swing({ shape: { kind: 'sphere', center: v3(0, 0, 1), radius: 1 }, track: STILL }),
    );
    steps(4);
    expect(hits).toEqual([]);
    expect(hurtboxShapes(world, bare)).toEqual([]);
    expect(hurtboxShapes(world, empty)).toEqual([]);
    expect(hitVolumeDebug(world).hurtboxes.map((h) => h.entity)).toEqual([a]);
  });

  it('a hitbox of an unplaced attacker waits; a target turned away is missed', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = world.spawn();
    giveHitboxes(world, a);
    openHitbox(world, a, swing());
    steps(2);
    expect(liveHitboxes(world, a)[0]?.elapsed).toBe(0);
    expect(entityFrame(world, a, FORWARD)).toBeUndefined();
    // A hurtbox offset 1 m in front of its owner turns with it.
    const b = attacker(v3(0, 0, 0));
    const t = target(v3(0, 0, 2), [
      torso({ shape: { kind: 'sphere', center: v3(0, 1, 1), radius: 0.3 } }),
    ]);
    setHurtboxFacing(world, t, v3(0, 0, -1));
    openHitbox(
      world,
      b,
      swing({ shape: { kind: 'sphere', center: v3(0, 1, 1), radius: 0.3 }, track: STILL }),
    );
    steps(1);
    expect(hits.map((h) => h.target)).toEqual([t]);
  });

  it('the sweep follows the attacker: it starts where the hitbox was last tick', () => {
    const { world, hits, attacker, target, steps } = setup();
    const a = attacker(v3(0, 1, 0));
    const spec = swing({
      shape: { kind: 'sphere', center: v3(0, 0, 0.5), radius: 0.05 },
      track: STILL,
    });
    const post = target(v3(0, 0, 2.5), [
      torso({ shape: { kind: 'capsule', from: v3(0, 0, 0), to: v3(0, 2, 0), radius: 0.02 } }),
    ]);
    openHitbox(world, a, spec);
    steps(1);
    // A 4 m lunge in one tick: no pose touches the post, the sweep does.
    placeEntity(world, a, v3(0, 1, 4), 0.4);
    steps(1);
    expect(hits.map((h) => [h.target, h.activeTick])).toEqual([[post, 2]]);
  });

  it('spent hitboxes stay for one tick of debug draw, then drop; closeHitboxes ends them early', () => {
    const { world, attacker, steps } = setup();
    const a = attacker();
    openHitbox(world, a, swing({ activeTicks: 2 }));
    steps(2);
    expect(liveHitboxes(world, a).map((h) => h.elapsed)).toEqual([2]);
    expect(hitVolumeDebug(world).hitboxes[0]).toMatchObject({ id: 'swing', activeTick: 2 });
    steps(1);
    expect(liveHitboxes(world, a)).toEqual([]);
    // A second step with nothing open leaves the set alone.
    steps(1);
    openHitbox(world, a, swing({ id: 'a' }));
    openHitbox(world, a, swing({ id: 'b' }));
    expect(closeHitboxes(world, a, 'a')).toBe(1);
    expect(closeHitboxes(world, a, 'missing')).toBe(0);
    expect(liveHitboxes(world, a).map((h) => h.id)).toEqual(['b']);
    expect(closeHitboxes(world, a)).toBe(1);
    expect(closeHitboxes(world, world.spawn())).toBe(0);
  });

  it('runs without any attackers', () => {
    const { world, target, steps } = setup();
    target(v3(0, 0, 0));
    steps(1);
    expect(hitVolumeDebug(world)).toMatchObject({ hitboxes: [], hurtboxes: [{ id: 'torso' }] });
  });

  it('debug draw: shapes in test order, and a stable hash', () => {
    const { world, attacker, target, steps } = setup();
    const a = attacker();
    target(v3(3, 0, 0));
    openHitbox(world, a, swing());
    expect(hitVolumeDebug(world).hitboxes).toEqual([]); // not swept yet
    steps(1);
    const debug = hitVolumeDebug(world);
    expect(debug.tick).toBe(world.tick);
    expect(debug.hitboxes[0]?.from).toEqual(shapeAt(world, a, swing(), 0));
    expect(debug.hitboxes[0]?.to).toEqual(shapeAt(world, a, swing(), 1));
    const shapes = debugShapes(debug);
    expect(shapes).toHaveLength(3);
    expect(hashShapes(shapes)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashShapes(shapes)).toBe(hashShapes(debugShapes(hitVolumeDebug(world))));
    expect(hashShapes(shapes.slice(1))).not.toBe(hashShapes(shapes));
  });

  it('is deterministic and survives a snapshot mid-swing', () => {
    const play = () => {
      const s = setup();
      const a = s.attacker();
      s.target(midArc(1.0), [torso()], 50);
      openHitbox(s.world, a, swing());
      s.steps(2);
      return s;
    };
    const first = play();
    const snapshot = first.world.snapshot();
    first.steps(3);
    const second = play();
    second.world.restore(snapshot);
    second.steps(3);
    expect(hashWorld(second.world)).toBe(hashWorld(first.world));
  });

  it('hitPacket fills in attacker, source, direction and region', () => {
    const hit: HitboxHitInfo = {
      tick: 1,
      attacker: 2,
      hitbox: 'h',
      activeTick: 1,
      target: 3,
      hurtbox: 'head',
      region: 'head',
      multiplier: 1.5,
      armored: true,
      direction: FORWARD,
    };
    expect(hitPacket(hit, { amounts: { slash: 5 }, poiseDamage: 3 })).toEqual({
      amounts: { slash: 5 },
      poiseDamage: 3,
      instigator: 2,
      source: 2,
      direction: FORWARD,
      region: 'head',
      regionMultiplier: 1.5,
    });
    expect(hitPacket(hit, { amounts: {} }, 9).source).toBe(9);
  });

  it('hitboxFromMove takes the hit volume, active ticks and friendly fire from a move', () => {
    const shape = { kind: 'sphere', center: v3(0, 1, 1), radius: 0.5 } as const;
    const move = {
      id: 'swipe',
      active: 3,
      hitbox: { track: 'x', shape, reach: 'short', swing: 'horizontal', friendlyFire: true },
    } as unknown as RuntimeMove;
    expect(hitboxFromMove(move, STILL, FORWARD)).toEqual({
      id: 'swipe',
      shape,
      track: STILL,
      activeTicks: 3,
      aim: FORWARD,
      friendlyFire: true,
    });
    const plain = {
      ...move,
      hitbox: { ...move.hitbox, friendlyFire: undefined },
    } as unknown as RuntimeMove;
    expect(hitboxFromMove(plain, STILL, FORWARD, 'other')).toMatchObject({
      id: 'other',
      friendlyFire: false,
    });
    const dodge = { id: 'roll', hitbox: null } as unknown as RuntimeMove;
    expect(() => hitboxFromMove(dodge, STILL, FORWARD)).toThrow(/no hitbox/);
  });

  it('moveTrack looks up the socket track a move names (mw-e04.26)', () => {
    const move = { id: 'swipe', hitbox: { track: 'still' } } as unknown as RuntimeMove;
    const tracks = new Map([[STILL.id, STILL]]);
    expect(moveTrack(move, tracks)).toBe(STILL);
    expect(() => moveTrack(move, new Map())).toThrow(
      'move "swipe" names socket track "still", which is not loaded',
    );
    const dodge = { id: 'roll', hitbox: null } as unknown as RuntimeMove;
    expect(() => moveTrack(dodge, tracks)).toThrow(/no hitbox/);
  });
});
