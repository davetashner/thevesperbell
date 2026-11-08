import * as RAPIER from '@dimforge/rapier3d-deterministic';
import type { ControllerTuning, EnvironmentDamageTuning, Frozen, SpellEntry } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SKIN } from '../character/controller';
import { box } from '../character/greybox';
import { installCharacterStimuli, makePushable } from '../character/stimuli';
import {
  CharacterController,
  characterControllerSystem,
  spawnCharacter,
} from '../character/system';
import { RapierCollisionWorld } from '../physics/rapier-collision-world';
import {
  breakableBroken,
  installBreakables,
  makeBreakable,
  type BreakableBrokenInfo,
} from '../breakables';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../combat/damage/components';
import { ACTION_TIMELINE_COMPONENTS } from '../combat/timeline/components';
import { HurtboxComponent } from '../combat/hits/components';
import { DamageApplied, type DamageResult } from '../combat/damage/events';
import { DamageModel } from '../combat/damage/model';
import type { CharacterImpactInfo } from '../character/system';
import { installEnvironmentDamage, resolveFragileStrike } from '../combat/environment/environment';
import {
  giveHitReactions,
  HitReaction,
  HitReactionComponent,
  installHitReactions,
  pushCharacter,
  type HitReactionInfo,
} from '../combat/reactions';
import type { EntityId } from '../core/component';
import { hypot } from '../math';
import { World } from '../core/world';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
  rigidBodiesOf,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import { addProperties, registerWorldProperties } from '../properties/components';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  activeForces,
  ForceLedgerComponent,
  forceOp,
  installSpellForces,
  LIFT_HEIGHT,
  MAX_LIFTABLE_WEIGHT,
  seekSpeed,
} from './force';
import { builtInOps } from './ops';
import type { OpContext } from './registry';
import { ForceResisted, type ForceResistedInfo } from './tether';

type ForceOp = Extract<SpellEntry['effects'][number], { op: 'force' }>;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const force = (mode: ForceOp['mode'], impulse: number, duration = 0): ForceOp => ({
  op: 'force',
  mode,
  impulse,
  duration,
});

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  launch: { airControl: 0.1, recoveryMs: 250, mass: 80 },
};
const RULES: Frozen<EnvironmentDamageTuning> = {
  fall: { safeHeight: 4, lethalHeight: 14, deepWater: 1.5 },
  kinetic: { minSpeed: 6, joulesPerPoint: 20 },
  hazards: [],
};

function arena() {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3, physics })));
  installPhysicsObjects(world);
  world.register(
    CharacterController,
    ...DAMAGE_COMPONENTS,
    ...ACTION_TIMELINE_COMPONENTS,
    HitReactionComponent,
    HurtboxComponent,
  );
  physics.add(box(v(-50, -1, -50), v(50, 0, 50)));
  const damage = new DamageModel();
  world.addSystem(stimulusSystem());
  world.addSystem(
    characterControllerSystem({
      collision: new RapierCollisionWorld(physics),
      tuning: TUNING,
      input: () => undefined,
    }),
  );
  installCharacterStimuli(world, TUNING);
  installEnvironmentDamage(world, { damage, tuning: RULES, capsule: TUNING.capsule });
  installBreakables(world);
  installHitReactions(world, { moves: new Map(), damage, pushers: [pushCharacter] });
  installSpellForces(world);
  const resisted: ForceResistedInfo[] = [];
  const hits: DamageResult[] = [];
  const reactions: HitReactionInfo[] = [];
  const broken: BreakableBrokenInfo[] = [];
  world.events.on(ForceResisted, (e) => resisted.push(e));
  world.events.on(DamageApplied, (e) => hits.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  world.events.on(breakableBroken, (e) => broken.push(e));
  const caster = world.spawn();
  placeEntity(world, caster, v(-10, 0, 0), 0.3);
  const ops = builtInOps();
  const ctx = (target: EntityId | null, point: Vec3): OpContext => ({
    world,
    caster,
    target,
    point,
    delivery: caster,
    damage,
  });
  const crate = (weight: number, at: Vec3, props: Record<string, unknown> = {}): EntityId => {
    const e = world.spawn();
    addProperties(world, e, { weight, pushable: true, liftable: true, ...props });
    addPhysicsObject(world, e, { shape: { kind: 'sphere', radius: 0.25 }, position: at });
    return e;
  };
  const creature = (feet: Vec3, poise?: number): EntityId => {
    const e = spawnCharacter(world, feet);
    giveCombatant(world, e, { health: 100, ...(poise !== undefined && { poise }) });
    giveHitReactions(world, e);
    makePushable(world, e, TUNING);
    return e;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const velocityOf = (e: EntityId): Vec3 => {
    const body = world.get(e, PhysicsObjectComponent)?.body;
    return rigidBodiesOf(world).motionOf(body as ColliderHandle).linvel;
  };
  return {
    world,
    ops,
    ctx,
    crate,
    creature,
    steps,
    velocityOf,
    resisted,
    hits,
    reactions,
    broken,
    caster,
  };
}

const run = (a: ReturnType<typeof arena>, op: ForceOp, target: EntityId | null, point: Vec3) =>
  a.ops.require('force')(a.ctx(target, point), op);

describe('spell forces (mw-e06.8)', () => {
  it('AC-1: a 200 N·s radial push sends a 10 kg object four times as fast as a 40 kg one at equal distance', () => {
    const a = arena();
    a.steps(1);
    const light = a.crate(10, v(2, 5, 0));
    const heavy = a.crate(40, v(0, 5, 2));
    a.steps(1);
    // Zero gravity matters not: both are in the air and measured the tick after the shove.
    const centre = v(0, 5, 0);
    expect(run(a, force('push', 200), light, centre)).toMatchObject({ mode: 'push' });
    expect(run(a, force('push', 200), heavy, centre)).toMatchObject({ mode: 'push' });
    a.steps(1);
    const lightV = a.velocityOf(light);
    const heavyV = a.velocityOf(heavy);
    expect(lightV.x).toBeCloseTo(20, 0);
    expect(heavyV.z).toBeCloseTo(5, 0);
    expect(lightV.x / heavyV.z).toBeCloseTo(4, 1);
  });

  it('a directional impulse goes from the caster towards the point; a pull goes towards the point', () => {
    const a = arena();
    a.steps(1);
    const o = a.crate(10, v(-5, 5, 0));
    a.steps(1);
    run(a, force('impulse', 100), o, v(0, 5, 0));
    a.steps(1);
    expect(a.velocityOf(o).x).toBeGreaterThan(8);
    const p = a.crate(10, v(5, 8, 5));
    a.steps(1);
    run(a, force('pull', 100), p, v(5, 8, 0));
    a.steps(1);
    expect(a.velocityOf(p).z).toBeLessThan(-9);
    const u = a.crate(10, v(0, 8, 8));
    a.steps(1);
    run(a, force('lift', 100), u, v(0, 8, 8));
    a.steps(1);
    expect(a.velocityOf(u).y).toBeGreaterThan(9);
  });

  it('directions fall back when the point is the target itself or the caster is gone', () => {
    const a = arena();
    a.steps(1);
    const o = a.crate(10, v(-5, 5, 0));
    const q = a.crate(10, v(3, 5, 3));
    // Push from the target's own position: away from the caster; impulse onto the caster: the same.
    run(a, force('push', 100), o, v(-5, 5, 0));
    run(a, force('impulse', 100), q, v(-10, 0, 0));
    a.steps(1);
    expect(a.velocityOf(o).x).toBeGreaterThan(0);
    expect(a.velocityOf(q).x).toBeGreaterThan(0);
    // No caster at all: push from its own position and impulse both fall back to up.
    const b = arena();
    b.steps(1);
    const w = b.crate(10, v(0, 5, 0));
    const nobody = b.world.spawn(); // a caster with no placement
    const noCaster = (point: Vec3, mode: ForceOp['mode']) =>
      forceOp({ ...b.ctx(w, point), caster: nobody }, force(mode, 100));
    noCaster(v(0, 5, 0), 'push');
    b.steps(1);
    expect(b.velocityOf(w).y).toBeGreaterThan(9);
    noCaster(v(1, 1, 1), 'impulse');
    b.steps(1);
    expect(b.velocityOf(w).y).toBeGreaterThan(18);
  });

  it('does nothing without a target, a placement or anything the stimulus reaches', () => {
    const a = arena();
    expect(run(a, force('push', 100), null, v(0, 0, 0))).toBeUndefined();
    expect(run(a, force('push', 100), a.world.spawn(), v(0, 0, 0))).toBeUndefined();
    const inert = a.world.spawn();
    placeEntity(a.world, inert, v(1, 1, 1), 0.2);
    expect(run(a, force('push', 100), inert, v(0, 0, 0))).toBeUndefined();
    expect(run(a, force('push', 0), a.crate(1, v(0, 6, 0)), v(0, 0, 0))).toBeUndefined();
    expect(run(a, force('push', 0.0001), a.crate(1, v(0, 5, 0)), v(0, 0, 0))).toBeDefined();
  });

  it('AC-2: a creature thrown into a fragile object at 6 m/s or more breaks it and takes collision damage', () => {
    const a = arena();
    a.steps(2);
    const goblin = a.creature(v(0, SKIN, 0));
    const vase = a.world.spawn();
    addProperties(a.world, vase, { weight: 2, fragile: 5, pushable: true });
    addPhysicsObject(a.world, vase, {
      shape: { kind: 'sphere', radius: 0.25 },
      position: v(2.5, 0.25, 0),
    });
    makeBreakable(a.world, vase, {
      id: 'pottery',
      resistances: {},
      debris: { count: 2, size: 0.1 },
      breakLoudness: 70,
    });
    a.steps(2);
    // Push from just below and behind: a low, fast hop along the floor at well over 6 m/s.
    run(a, force('push', 1200), goblin, v(-1, -0.15, 0));
    for (let i = 0; i < 90 && a.broken.length === 0; i++) {
      a.steps(1);
    }
    expect(a.broken.map((b) => b.entity)).toContain(vase);
    const crush = a.hits.filter((h) => h.target === goblin && h.packet.tags.includes('crush'));
    expect(crush.length).toBeGreaterThan(0);
    expect(healthOf(a.world, goblin)?.current).toBeLessThan(100);
  });

  it('a creature slower than 6 m/s breaks nothing', () => {
    const a = arena();
    a.steps(2);
    const goblin = a.creature(v(0, SKIN, 0));
    const vase = a.world.spawn();
    addProperties(a.world, vase, { weight: 2, fragile: 5, pushable: true });
    addPhysicsObject(a.world, vase, {
      shape: { kind: 'sphere', radius: 0.25 },
      position: v(1.2, 0.25, 0),
    });
    a.steps(2);
    run(a, force('push', 200), goblin, v(-0.5, -0.4, 0));
    a.steps(60);
    expect(a.world.get(vase, PhysicsObjectComponent)).toBeDefined();
    expect(a.hits.filter((h) => h.packet.tags.includes('crush'))).toEqual([]);
  });

  it('a strike only counts for a launched creature hitting a fragile thing hard enough', () => {
    const a = arena();
    a.steps(2);
    const goblin = a.creature(v(0, SKIN, 0));
    const vase = a.crate(2, v(3, 0.25, 0), { fragile: 5 });
    const plain = a.crate(2, v(5, 0.25, 0));
    const options = { damage: new DamageModel(), kinetic: RULES.kinetic };
    const impact = (over: Partial<CharacterImpactInfo>): CharacterImpactInfo => ({
      kind: 'wall',
      speed: 10,
      height: 0,
      normal: v(-1, 0, 0),
      body: 0,
      launch: { source: null, stagger: true },
      tick: 0,
      entity: goblin,
      position: v(0, 0, 0),
      ...over,
    });
    const at = (target: EntityId | null) => ({ ...options, surface: () => target });
    expect(resolveFragileStrike(a.world, impact({ kind: 'ground' }), at(vase))).toBe(0);
    expect(resolveFragileStrike(a.world, impact({ launch: null }), at(vase))).toBe(0);
    expect(resolveFragileStrike(a.world, impact({}), at(null))).toBe(0);
    expect(resolveFragileStrike(a.world, impact({}), at(plain))).toBe(0);
    expect(resolveFragileStrike(a.world, impact({ speed: 6 }), at(vase))).toBe(0);
    // ½ · 2 kg · (10 m/s)² / 20 J per point = 5 points of blunt damage.
    expect(resolveFragileStrike(a.world, impact({}), at(vase))).toBe(5);
  });

  it('AC-3: a creature with 50 poise hit by a force worth 70 poise damage is knocked down', () => {
    const a = arena();
    a.steps(2);
    const knight = a.creature(v(0, SKIN, 0), 50);
    a.steps(1);
    run(a, force('push', 700), knight, v(-1, 0, 0));
    a.steps(2);
    const down = a.reactions.find((r) => r.entity === knight);
    expect(down?.reaction).toBe('knockdown');
    // A lighter force that leaves poise standing does not.
    const b = arena();
    b.steps(2);
    const rook = b.creature(v(0, SKIN, 0), 50);
    b.steps(1);
    run(b, force('push', 100), rook, v(-1, 0, 0));
    b.steps(2);
    expect(b.reactions.find((r) => r.entity === rook)?.reaction).not.toBe('knockdown');
  });

  it('AC-4: a lift on an anchored or over-heavy object leaves it on the ground and fires ForceResisted', () => {
    const a = arena();
    a.steps(2);
    const bolted = a.crate(20, v(0, 0.25, 0), { anchored: true });
    const boulder = a.crate(MAX_LIFTABLE_WEIGHT + 1, v(3, 0.25, 0));
    const fine = a.crate(MAX_LIFTABLE_WEIGHT, v(6, 0.25, 0));
    a.steps(30);
    expect(run(a, force('lift', 5000, 2), bolted, v(0, 0, 0))).toEqual({
      mode: 'lift',
      resisted: true,
    });
    run(a, force('lift', 5000, 2), boulder, v(0, 0, 0));
    run(a, force('lift', 5000, 2), fine, v(0, 0, 0));
    a.steps(60);
    const y = (e: EntityId) => a.world.get(e, PhysicsObjectComponent)?.position.y ?? 0;
    expect(y(bolted)).toBeLessThan(0.3);
    expect(y(boulder)).toBeLessThan(0.3);
    expect(y(fine)).toBeGreaterThan(LIFT_HEIGHT - 0.5);
    expect(a.resisted.map((r) => [r.target, r.weight, r.limit, r.spell])).toEqual([
      [bolted, 20, 0, null],
      [boulder, MAX_LIFTABLE_WEIGHT + 1, MAX_LIFTABLE_WEIGHT, null],
    ]);
    // Anchored things resist a push too.
    run(a, force('push', 500), bolted, v(-1, 0.25, 0));
    a.steps(1);
    expect(a.resisted).toHaveLength(3);
  });

  it('AC-5: a point pull stops its targets within 0.5 m of the centre instead of oscillating', () => {
    const a = arena();
    a.steps(2);
    // Each target has its own centre, so they never jostle each other on the way in.
    const centres = new Map<EntityId, Vec3>();
    const pulled = (weight: number, from: Vec3, centre: Vec3): EntityId => {
      const e = a.crate(weight, from);
      centres.set(e, centre);
      return e;
    };
    const targets = [
      pulled(10, v(6, 1, 0), v(0, 1, 0)),
      pulled(40, v(-4, 1, 9), v(-4, 1, 6)),
      pulled(10, v(0, 1, -7), v(0, 1, -12)),
    ];
    a.steps(1);
    for (const t of targets) run(a, force('pull', 2000, 8), t, centres.get(t) ?? v(0, 0, 0));
    expect(activeForces(a.world)).toHaveLength(3);
    const dist = (e: EntityId): number => {
      const centre = centres.get(e) ?? v(0, 0, 0);
      const p = a.world.get(e, PhysicsObjectComponent)?.position ?? centre;
      return hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z);
    };
    const arrived = new Map<EntityId, boolean>();
    for (let i = 0; i < 8 * 60 - 5; i++) {
      a.steps(1);
      for (const t of targets) {
        if (dist(t) < 0.3) arrived.set(t, true);
        // Once inside half a metre it never leaves again: no swinging through and out.
        if (arrived.get(t) === true) expect(dist(t)).toBeLessThan(0.5);
      }
    }
    for (const t of targets) {
      expect(arrived.get(t)).toBe(true);
      expect(dist(t)).toBeLessThan(0.5);
    }
    a.steps(10);
    expect(activeForces(a.world)).toHaveLength(0);
  });

  it('a lift holds a creature up for its duration, then lets go; a second force replaces the first', () => {
    const a = arena();
    a.steps(2);
    const goblin = a.creature(v(0, SKIN, 0));
    a.steps(1);
    run(a, force('lift', 3000, 1), goblin, v(0, 0, 0));
    run(a, force('lift', 3000, 1), goblin, v(0, 0, 0));
    expect(activeForces(a.world)).toHaveLength(1);
    a.steps(50);
    expect(a.world.get(goblin, PlacementComponent)?.y ?? 0).toBeGreaterThan(0.5);
    a.steps(120);
    expect(activeForces(a.world)).toHaveLength(0);
  });

  it('without the installed ledger a sustained force is one impulse; the system skips what has no body', () => {
    const a = arena();
    a.steps(1);
    const o = a.crate(10, v(0, 5, 0));
    a.steps(1);
    for (const id of a.world.query(ForceLedgerComponent).ids()) a.world.destroy(id);
    a.steps(1);
    expect(activeForces(a.world)).toEqual([]);
    expect(run(a, force('lift', 100, 3), o, v(0, 5, 0))).toMatchObject({ mode: 'lift' });
    a.steps(1);
    expect(a.velocityOf(o).y).toBeGreaterThan(5);
    const b = arena();
    b.steps(1);
    const rock = b.world.spawn();
    addProperties(b.world, rock, { weight: 5, pushable: true });
    placeEntity(b.world, rock, v(0, 2, 0), 0.2);
    b.steps(1);
    run(b, force('pull', 100, 2), rock, v(3, 2, 0));
    b.steps(5);
    expect(activeForces(b.world)).toHaveLength(1);
  });

  it("a pull onto the target's own spot goes up, and a sustained one holds still; one that lost its placement is skipped", () => {
    const a = arena();
    a.steps(2);
    const o = a.crate(10, v(0, 5, 0));
    run(a, force('pull', 100), o, v(0, 5, 0));
    a.steps(1);
    expect(a.velocityOf(o).y).toBeGreaterThan(0);
    const goblin = a.creature(v(4, SKIN, 0));
    a.steps(1);
    run(a, force('pull', 500, 1), goblin, v(4, SKIN, 0));
    a.steps(3);
    expect(a.world.get(goblin, CharacterController)?.position.x).toBeCloseTo(4, 3);
    const lost = a.creature(v(8, SKIN, 0));
    a.steps(1);
    run(a, force('pull', 500, 1), lost, v(0, SKIN, 0));
    a.world.remove(lost, PlacementComponent);
    a.steps(3);
    expect(activeForces(a.world).some((f) => f.target === lost)).toBe(true);
  });

  it('seekSpeed is capped, damped near the point and limited by what can brake', () => {
    expect(seekSpeed(100, 1000)).toBe(12);
    expect(seekSpeed(0.5, 1000)).toBe(2);
    expect(seekSpeed(4, 1)).toBeCloseTo(2, 5);
    expect(seekSpeed(0, 10)).toBe(0);
  });
});
