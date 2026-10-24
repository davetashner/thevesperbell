import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../combat/damage';
import { giveHurtboxes, HIT_VOLUME_COMPONENTS, type Hurtbox } from '../combat/hits/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { cos, hypot, sin } from '../math';
import { PhysicsColliderComponent } from '../physics/objects';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import { Rng } from '../rng';
import { PlacementComponent as PlacementComponentRef, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusResolved, stimulusSystem } from '../stimulus/stimulus';
import { learnSpell, SpellDeliveryComponent } from './components';
import {
  SpellEffectApplied,
  SpellFizzled,
  SpellHit,
  SpellQuenched,
  type SpellHitInfo,
  type SpellQuenchedInfo,
} from './events';
import { installSpells, type CastCommand } from './pipeline';
import {
  installSpellProjectiles,
  launchVelocity,
  SpellProjectileBounced,
  SpellProjectileComponent,
  type SpellProjectileOptions,
} from './projectile';
import { damageOp, makeSpell, projectileDelivery, stimulusOp } from './testing';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const G = 9.8;

type Projectile = Parameters<typeof projectileDelivery>[0];

/** A world with spells, projectile flight, stimuli and a level of greybox boxes. */
function setup(
  spells: readonly SpellEntry[],
  shapes: readonly ReturnType<typeof box>[] = [],
  options: SpellProjectileOptions = {},
) {
  const byId = new Map(spells.map((s) => [s.id, s]));
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 5 })));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PhysicsColliderComponent);
  const pipeline = installSpells(world, { spells: (id) => byId.get(id) });
  installSpellProjectiles(world, pipeline, {
    collision: new FakeCollisionWorld(shapes),
    muzzleHeight: 0,
    ...options,
  });
  world.addSystem(stimulusSystem());
  const hits: SpellHitInfo[] = [];
  const applied: { tick: number; op: string; target: EntityId | null; point: Vec3 }[] = [];
  const fizzled: string[] = [];
  const bounces: { point: Vec3; left: number; normal: Vec3 }[] = [];
  world.events.on(SpellHit, (e) => hits.push(e));
  world.events.on(SpellEffectApplied, (e) => applied.push(e));
  world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));
  world.events.on(SpellProjectileBounced, (e) => bounces.push(e));
  const caster = world.spawn();
  giveCombatant(world, caster, { health: 100 });
  placeEntity(world, caster, v3(0, 0, 0), 0.5);
  giveHurtboxes(world, caster, { boxes: [sphere(0.5)] });
  const spawn = (at: Vec3, props: Parameters<typeof addProperties>[2] = {}): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.5);
    giveCombatant(world, entity, { health: 100 });
    giveHurtboxes(world, entity, { boxes: [sphere(0.5)] });
    addProperties(world, entity, { temperature: 20, ...props });
    return entity;
  };
  const cast = (spell: string, aim: Vec3) => {
    pipeline.cast(world, { caster, spell, source: 'free', aim });
    world.step(); // the projectile exists from the end of the casting tick
  };
  const flying = (): readonly EntityId[] => world.query(SpellProjectileComponent).ids();
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  const runUntilGone = (max = 2000): number => {
    let ticks = 0;
    while (flying().length > 0 && ticks++ < max) world.step();
    return ticks;
  };
  return {
    world,
    pipeline,
    caster,
    spawn,
    cast,
    run,
    runUntilGone,
    flying,
    hits,
    applied,
    fizzled,
    bounces,
  };
}

function sphere(radius: number): Hurtbox {
  return {
    id: 'body',
    socket: 'root',
    region: 'torso',
    armored: false,
    multiplier: 1,
    shape: { kind: 'sphere', center: v3(0, 0, 0), radius },
  };
}

const bolt = (id: string, delivery: Projectile = {}, effects = [damageOp({ fire: 10 })]) =>
  makeSpell(id, { delivery: projectileDelivery({ speed: 20, ...delivery }), effects });

/** A wall slab whose face at `x` is `thickness` thick, large in y and z. */
const wall = (x: number, thickness = 0.1) => box(v3(x, -50, -50), v3(x + thickness, 50, 50));

describe('launchVelocity (mw-e06.6)', () => {
  it('flies straight at the aim point when there is no gravity', () => {
    expect(launchVelocity(v3(0, 0, 0), v3(3, 0, 4), 10, 0)).toEqual(v3(6, 0, 8));
  });

  it('flies straight when the point is directly above or below, whatever the gravity', () => {
    expect(launchVelocity(v3(0, 0, 0), v3(0, 5, 0), 10, G)).toEqual(v3(0, 10, 0));
  });

  it('takes the low arc that passes through a reachable point', () => {
    const v = launchVelocity(v3(0, 0, 0), v3(10, 0, 0), 20, G);
    if (v === undefined) throw new Error('no velocity');
    const t = 10 / v.x;
    expect(0 + v.y * t - 0.5 * G * t * t).toBeCloseTo(0, 9);
    expect(hypot(v.x, v.y)).toBeCloseTo(20, 9);
    expect(v.y).toBeGreaterThan(0);
  });

  it('takes 45° when the point is out of range, and has no velocity for its own origin', () => {
    const v = launchVelocity(v3(0, 0, 0), v3(1000, 0, 0), 20, G);
    expect(v?.x).toBeCloseTo(v?.y ?? NaN, 9);
    expect(launchVelocity(v3(1, 2, 3), v3(1, 2, 3), 20, G)).toBeUndefined();
  });
});

describe('projectile spells (mw-e06.6)', () => {
  it('AC-1: a 60 m/s projectile impacts a 0.1 m wall in 1000 of 1000 seeded trials', () => {
    const rng = Rng.create(60);
    let impacted = 0;
    for (let trial = 0; trial < 1000; trial++) {
      const d = 5 + rng.float() * 35;
      const t = setup(
        [bolt('t-bolt', { speed: 60, radius: 0.05, maxRange: 200 }, [stimulusOp('heat', 5)])],
        [wall(d)],
      );
      t.cast('t-bolt', v3(d + 1, (rng.float() - 0.5) * 6, (rng.float() - 0.5) * 10));
      t.runUntilGone();
      const [hit] = t.hits;
      if (hit?.target === null && Math.abs(hit.point.x - d) < 0.06) impacted++;
    }
    expect(impacted).toBe(1000);
  });

  it('AC-2: gravity 9.8 at a 30° launch lands within 5 cm of the analytic ballistic solution', () => {
    const speed = 25;
    const theta = Math.PI / 6;
    const vx = speed * cos(theta);
    const vy = speed * sin(theta);
    const y0 = 1.5;
    const radius = 0.001;
    // The point on the 30° trajectory at x = 10 m: aiming at it launches at exactly 30°.
    const at = (x: number) => y0 + (vy / vx) * x - (G * x * x) / (2 * vx * vx);
    const t = setup(
      [bolt('t-lob', { speed, gravity: G, radius, maxRange: 500 }, [stimulusOp('heat', 5)])],
      [box(v3(-10, -2, -10), v3(400, 0, 10))],
      { muzzleHeight: y0 },
    );
    t.cast('t-lob', v3(10, at(10), 0));
    t.runUntilGone();
    // Centre touches the floor (y = radius) after t seconds: solve y0 + vy·t − ½gt² = radius.
    const flight = (vy + Math.sqrt(vy * vy + 2 * G * (y0 - radius))) / G;
    const analytic = vx * flight;
    const [hit] = t.hits;
    expect(hit?.point.y).toBeCloseTo(0, 6);
    expect(Math.abs((hit?.point.x ?? Infinity) - analytic)).toBeLessThan(0.05);
  });

  it('AC-3: with bounce 2 it rebounds off the first two walls and applies its ops on the third hit', () => {
    const t = setup(
      [bolt('t-ricochet', { speed: 20, bounce: 2, restitution: 1 }, [stimulusOp('heat', 50)])],
      [wall(5), wall(-5.1)],
      { selfImmuneSeconds: 5 },
    );
    t.cast('t-ricochet', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.bounces.map((b) => [b.left, Math.round(b.point.x * 100) / 100])).toEqual([
      [1, 5],
      [0, -5],
    ]);
    expect(t.bounces[0]?.normal).toEqual(v3(-1, 0, 0));
    expect(t.applied.map((a) => [a.op, Math.round(a.point.x * 100) / 100])).toEqual([
      ['stimulus', 5],
    ]);
    expect(t.hits).toHaveLength(1);
    expect(t.flying()).toEqual([]);
  });

  it('a bounce keeps only `restitution` of the speed', () => {
    const t = setup([bolt('t-soft', { speed: 20, bounce: 1, restitution: 0.5 })], [wall(5)]);
    t.cast('t-soft', v3(1, 0, 0));
    for (let i = 0; i < 40 && t.bounces.length === 0; i++) t.run(1);
    const [id] = t.flying();
    const flight = id === undefined ? undefined : t.world.get(id, SpellProjectileComponent);
    expect(flight?.velocity.x).toBeCloseTo(-10, 9);
    expect(flight?.bouncesLeft).toBe(0);
  });

  it('AC-4: with lifetime 3 s and no impact, onExpire ops apply at its position at 3 s and the entity is removed', () => {
    const onExpire = [stimulusOp('heat', 40)];
    const t = setup([bolt('t-fuse', { speed: 10, lifetime: 3, maxRange: 500, onExpire })]);
    learnSpell(t.world, t.caster, 't-fuse');
    // A cast command in tick 0: the projectile exists from tick 1, so it flies ticks 1 to 180.
    t.world.step([{ type: 'cast', caster: t.caster, spell: 't-fuse', aim: v3(1, 0, 0) }]);
    const [delivery] = t.flying();
    if (delivery === undefined) throw new Error('not flying');
    t.run(179);
    expect(t.applied).toEqual([]);
    t.run(1);
    expect(t.applied).toHaveLength(1);
    expect(t.applied[0]?.tick).toBe(180);
    expect(t.applied[0]?.point.x).toBeCloseTo(30, 6);
    expect(t.world.isAlive(delivery)).toBe(false);
    expect(t.world.query(SpellDeliveryComponent).ids()).toEqual([]);
    expect(t.fizzled).toEqual([]);
  });

  it('expires as a fizzle when it has no onExpire ops, at maxRange or lifetime', () => {
    const t = setup([bolt('t-short', { speed: 10, maxRange: 25, lifetime: 100 })]);
    t.cast('t-short', v3(1, 0, 0));
    const ticks = t.runUntilGone();
    expect(ticks).toBeGreaterThanOrEqual(149);
    expect(ticks).toBeLessThanOrEqual(151);
    expect(t.fizzled).toEqual(['delivery-ended']);
    expect(t.hits).toEqual([]);
  });

  it('runs onExpire at the end of its range at exactly maxRange', () => {
    const t = setup([
      bolt('t-range', { speed: 10, maxRange: 25, onExpire: [stimulusOp('heat', 1)] }),
    ]);
    t.cast('t-range', v3(0, 0, 1));
    t.runUntilGone();
    expect(t.applied[0]?.point.z).toBeCloseTo(25, 9);
  });

  it('flies a gravity arc: its vertical speed falls by g each second', () => {
    const t = setup([bolt('t-arc', { speed: 20, gravity: G })]);
    t.cast('t-arc', v3(10, 0, 0));
    const [id] = t.flying();
    const before = id === undefined ? undefined : t.world.get(id, SpellProjectileComponent);
    t.run(60);
    const after = id === undefined ? undefined : t.world.get(id, SpellProjectileComponent);
    expect((before?.velocity.y ?? 0) - (after?.velocity.y ?? 0)).toBeCloseTo(G, 6);
    expect(after?.flown).toBe(61);
  });

  it('hits the first creature in its path, once, and damages only it', () => {
    const t = setup([bolt('t-hit')]);
    const first = t.spawn(v3(8, 0, 0));
    const second = t.spawn(v3(12, 0, 0));
    t.cast('t-hit', v3(1, 0, 0));
    t.runUntilGone();
    expect(healthOf(t.world, first)?.current).toBe(90);
    expect(healthOf(t.world, second)?.current).toBe(100);
    expect(t.hits.map((h) => h.target)).toEqual([first]);
  });

  it('pierce 1 strikes the first creature, flies on, and impacts the second', () => {
    const t = setup([bolt('t-pierce', { pierce: 1 })]);
    const first = t.spawn(v3(8, 0, 0));
    const second = t.spawn(v3(12, 0, 0));
    const third = t.spawn(v3(16, 0, 0));
    t.cast('t-pierce', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([first, second]);
    expect(healthOf(t.world, first)?.current).toBe(90);
    expect(healthOf(t.world, second)?.current).toBe(90);
    expect(healthOf(t.world, third)?.current).toBe(100);
  });

  it('pierce 2 strikes two creatures and keeps their ids in ascending order in its state', () => {
    const t = setup([bolt('t-pierce2', { pierce: 2 })]);
    const first = t.spawn(v3(12, 0, 0));
    const second = t.spawn(v3(8, 0, 0));
    const third = t.spawn(v3(16, 0, 0));
    t.cast('t-pierce2', v3(1, 0, 0));
    t.run(42);
    const [id] = t.flying();
    const flight = id === undefined ? undefined : t.world.get(id, SpellProjectileComponent);
    expect(flight?.struck).toEqual([first, second].sort((a, b) => a - b));
    expect(flight?.pierceLeft).toBe(0);
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([second, first, third]);
  });

  it('a wall in front of a creature stops the projectile before it', () => {
    const t = setup([bolt('t-blocked')], [wall(5)]);
    const behind = t.spawn(v3(8, 0, 0));
    t.cast('t-blocked', v3(1, 0, 0));
    t.runUntilGone();
    expect(healthOf(t.world, behind)?.current).toBe(100);
    expect(t.hits.map((h) => h.target)).toEqual([null]);
  });

  it('a creature just behind a wall is never hit, whatever phase the sweep reaches the wall in', () => {
    for (let offset = 0; offset < 1; offset += 0.1) {
      const t = setup([bolt('t-phase', { speed: 100, radius: 0.05 })], [wall(5 + offset)]);
      const behind = t.spawn(v3(6.05 + offset, 0, 0));
      t.cast('t-phase', v3(1, 0, 0));
      t.runUntilGone();
      expect(healthOf(t.world, behind)?.current).toBe(100);
    }
  });

  it('a creature in front of a wall is hit, not the wall', () => {
    const t = setup([bolt('t-front')], [wall(20)]);
    const front = t.spawn(v3(8, 0, 0));
    t.cast('t-front', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([front]);
  });

  it('impactRadius also hits placed entities near the impact, but never the caster', () => {
    const t = setup([bolt('t-burst', { impactRadius: 3 })], [wall(10)]);
    const near = t.spawn(v3(9, 0, 1));
    const far = t.spawn(v3(9, 0, 8));
    const also = t.spawn(v3(9, 0, -1));
    t.cast('t-burst', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([null, near, also]);
    expect(healthOf(t.world, near)?.current).toBe(90);
    expect(healthOf(t.world, far)?.current).toBe(100);
    expect(healthOf(t.world, t.caster)?.current).toBe(100);
  });

  it('impactRadius around a creature hit strikes the creature itself once', () => {
    const t = setup([bolt('t-burst2', { impactRadius: 3 })]);
    const target = t.spawn(v3(8, 0, 0));
    const neighbour = t.spawn(v3(8, 0, 2));
    t.cast('t-burst2', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([target, neighbour]);
    expect(healthOf(t.world, target)?.current).toBe(90);
  });

  it('a wall owned by an entity is the hit target, and the area does not hit it twice', () => {
    let crate: EntityId | null = null;
    const t = setup([bolt('t-crate', { impactRadius: 2 })], [wall(8)], {
      surfaceOf: () => crate,
    });
    crate = t.spawn(v3(8, 0, 0));
    t.cast('t-crate', v3(1, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([crate]);
  });

  it('the caster cannot hit themselves for the first half second, but can after', () => {
    const safe = setup([bolt('t-self', { speed: 4 })]);
    safe.cast('t-self', v3(1, 0, 0));
    safe.run(20);
    expect(healthOf(safe.world, safe.caster)?.current).toBe(100);
    const exposed = setup([bolt('t-self', { speed: 4 })], [], { selfImmuneSeconds: 0 });
    exposed.cast('t-self', v3(1, 0, 0));
    exposed.run(2);
    expect(healthOf(exposed.world, exposed.caster)?.current).toBe(90);
  });

  it('flies through an invulnerable target and strikes the next', () => {
    let dodger: EntityId | null = null;
    const t = setup([bolt('t-dodge')], [], { invulnerable: (_w, e) => e === dodger });
    dodger = t.spawn(v3(8, 0, 0));
    const next = t.spawn(v3(12, 0, 0));
    t.cast('t-dodge', v3(1, 0, 0));
    t.runUntilGone();
    expect(healthOf(t.world, dodger)?.current).toBe(100);
    expect(t.hits.map((h) => h.target)).toEqual([next]);
  });

  it('AC-5 (unit): its trail lays a heat stimulus along the swept path, reaching things within the trail radius', () => {
    const t = setup([
      bolt('t-trail', { speed: 20, trail: { element: 'heat', intensity: 600, radius: 0.5 } }),
    ]);
    const pass = t.spawn(v3(10, 0, 0.4), { flammable: true });
    const clear = t.spawn(v3(10, 0, 3), { flammable: true });
    const reached = new Set<EntityId>();
    t.world.events.on(stimulusResolved, (e) => {
      e.hits.forEach((h) => reached.add(h.entity));
    });
    t.cast('t-trail', v3(1, 0, 0));
    t.run(60);
    expect(reached.has(pass)).toBe(true);
    expect(reached.has(clear)).toBe(false);
    expect(readProperty(t.world, pass, 'temperature')).toBeGreaterThan(20);
    expect(readProperty(t.world, clear, 'temperature')).toBe(20);
  });

  it('flies to the end of its range when the world has no level', () => {
    const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 1 })));
    world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
    const spell = bolt('t-open', { maxRange: 5 });
    const pipeline = installSpells(world, {
      spells: (id) => (id === spell.id ? spell : undefined),
    });
    installSpellProjectiles(world, pipeline);
    const caster = world.spawn();
    placeEntity(world, caster, v3(0, 0, 0), 0.5);
    pipeline.cast(world, { caster, spell: 't-open', source: 'free', aim: v3(1, 1.2, 0) });
    for (let i = 0; i < 40; i++) world.step();
    expect(world.query(SpellProjectileComponent).ids()).toEqual([]);
  });

  it('does nothing at all when nothing is flying', () => {
    const t = setup([bolt('t-idle')]);
    t.run(3);
    expect(t.hits).toEqual([]);
  });

  it('cancels a projectile whose spell is no longer known', () => {
    const t = setup([bolt('t-gone')]);
    t.cast('t-gone', v3(1, 0, 0));
    const [id] = t.flying();
    const flight = id === undefined ? undefined : t.world.get(id, SpellProjectileComponent);
    if (id === undefined || flight === undefined) throw new Error('not flying');
    t.world.set(id, SpellProjectileComponent, { ...flight, spell: 'vanished' });
    t.run(1);
    expect(t.flying()).toEqual([]);
    expect(t.fizzled).toEqual(['delivery-ended']);
  });

  it('fizzles before spending anything with no aim, an aim at the caster, no placement or an unregistered onExpire op', () => {
    const light = {
      op: 'light',
      intensity: 1,
      radius: 1,
      duration: 0,
      attach: 'delivery',
    } as const;
    const t = setup([bolt('t-ok'), bolt('t-light', { onExpire: [light] })]);
    const { pipeline, world, caster } = t;
    pipeline.cast(world, { caster, spell: 't-ok', source: 'free' });
    pipeline.cast(world, { caster, spell: 't-ok', source: 'free', aim: v3(0, 0, 0) });
    pipeline.cast(world, { caster, spell: 't-light', source: 'free', aim: v3(1, 0, 0) });
    const unplaced = world.spawn();
    pipeline.cast(world, { caster: unplaced, spell: 't-ok', source: 'free', aim: v3(1, 0, 0) });
    world.step();
    expect(t.fizzled).toEqual(['no-aim', 'no-aim', 'unsupported-op', 'no-position']);
    expect(t.flying()).toEqual([]);
  });

  it('the pipeline refuses to strike with something that is not a live spell delivery or whose spell is gone', () => {
    const t = setup([bolt('t-strike')]);
    expect(() => {
      t.pipeline.strike(t.world, t.caster, []);
    }).toThrow(/not a spell delivery/);
    t.cast('t-strike', v3(1, 0, 0));
    const [id] = t.flying();
    if (id === undefined) throw new Error('not flying');
    const state = t.world.get(id, SpellDeliveryComponent);
    if (state === undefined) throw new Error('no delivery');
    t.world.set(id, SpellDeliveryComponent, { ...state, spell: 'vanished' });
    expect(() => {
      t.pipeline.strike(t.world, id, []);
    }).toThrow(/unknown spell/);
  });
});

describe('quenched projectiles (mw-e08.2)', () => {
  // Water fills everything at x >= 5 (a pool), and everything below y = -1 (a submerged caster).
  const water = (p: Vec3): boolean => p.x >= 5 || p.y < -1;
  const flame = (id: string, quenched = true) =>
    bolt(id, { quenchedByWater: quenched, maxRange: 30 }, [stimulusOp('heat', 500, 0.3)]);

  function quenchSetup(quenched = true, withWater = true) {
    const t = setup([flame('t-flame', quenched)], [], withWater ? { water } : {});
    const quenches: SpellQuenchedInfo[] = [];
    t.world.events.on(SpellQuenched, (e) => quenches.push(e));
    return { ...t, quenches };
  }

  it('AC-6: a flame flying into water fizzles there with no effects and a steam cue event', () => {
    const t = quenchSetup();
    t.cast('t-flame', v3(20, 0, 0));
    t.runUntilGone();
    expect(t.quenches).toHaveLength(1);
    expect(t.quenches[0]).toMatchObject({
      spell: 't-flame',
      caster: t.caster,
      medium: 'water',
      cue: 'steam',
      stage: 'flight',
    });
    expect(t.quenches[0]?.point.x).toBeGreaterThanOrEqual(5);
    expect(t.quenches[0]?.point.x).toBeLessThan(5.5);
    expect(t.fizzled).toEqual(['quenched']);
    expect(t.hits).toEqual([]);
    expect(t.applied).toEqual([]);
  });

  it('AC-6: a flame cast from underwater never launches, spends nothing and emits the steam cue', () => {
    const t = quenchSetup();
    t.world.set(t.caster, PlacementComponentRef, { ...v3(0, -3, 0), radius: 0.5 });
    t.pipeline.cast(t.world, {
      caster: t.caster,
      spell: 't-flame',
      source: 'free',
      aim: v3(1, -3, 0),
    });
    t.world.step();
    expect(t.fizzled).toEqual(['quenched']);
    expect(t.flying()).toEqual([]);
    expect(t.quenches).toHaveLength(1);
    expect(t.quenches[0]).toMatchObject({ stage: 'launch', cue: 'steam' });
    expect(t.applied).toEqual([]);
  });

  it('a spell that is not quenchedByWater, or a world with no water, flies on through it', () => {
    for (const t of [quenchSetup(false), quenchSetup(true, false)]) {
      t.world.set(t.caster, PlacementComponentRef, { ...v3(0, 0, 0), radius: 0.5 });
      t.cast('t-flame', v3(20, 0, 0));
      t.runUntilGone();
      expect(t.quenches).toEqual([]);
      expect(t.fizzled).toEqual(['delivery-ended']);
    }
  });

  it('a quenchedByWater spell in dry air is untouched by a water probe that says no', () => {
    const t = setup([flame('t-dry')], [], { water: () => false });
    const target = t.spawn(v3(8, 0, 0));
    t.cast('t-dry', v3(20, 0, 0));
    t.runUntilGone();
    expect(t.hits.map((h) => h.target)).toEqual([target]);
    expect(t.fizzled).toEqual([]);
  });
});
