import type { ArrowEntry } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { CollisionHit, CollisionWorld } from '../../character/collision-world';
import { FakeCollisionWorld } from '../../character/fake-collision-world';
import { box, type GreyboxShape } from '../../character/greybox';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import type { LocalShape } from '../../geom';
import { cos, sin } from '../../math';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../../physics/objects';
import { addProperties, registerWorldProperties } from '../../properties/components';
import type { WorldPropertyValues } from '../../properties/spec';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import {
  impulseApplied,
  installStimuli,
  stimulusResolved,
  stimulusSystem,
} from '../../stimulus/stimulus';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../damage/components';
import { DamageApplied, Deflected, type DamageResult, type DeflectInfo } from '../damage/events';
import { DamageModel } from '../damage/model';
import { giveHurtboxes, HIT_VOLUME_COMPONENTS, type Hurtbox } from '../hits/components';
import { DodgedHit, type HitboxHitInfo } from '../hits/events';
import type { InvulnerabilityRule } from '../hits/system';
import {
  damageFactor,
  DEFAULT_ARROW_RULES,
  integrateFlight,
  PENETRATION_TO_STICK,
  penetrates,
  ricochet,
  speedOf,
  type ArrowRules,
} from './ballistics';
import { ArrowComponent, ArrowRestComponent, type ArrowFlight } from './components';
import {
  ArrowExpired,
  ArrowFired,
  arrowImpact,
  type ArrowExpiredInfo,
  type ArrowFiredInfo,
  type ArrowImpactInfo,
} from './events';
import {
  arrowDirection,
  arrowLookup,
  castSegment,
  fireArrow,
  installArrows,
  physicsSurfaceOf,
  type ArrowLookup,
} from './system';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const ZERO = v3(0, 0, 0);
const G = DEFAULT_ARROW_RULES.gravity;

/** An arrow definition as content would load it (the standard arrow's numbers by default). */
function arrowDef(id: string, over: Partial<ArrowEntry> = {}): ArrowEntry {
  return {
    id,
    schemaVersion: 1,
    name: id,
    massGrams: 25,
    dragK: 0.00005,
    damage: {
      amounts: { pierce: 25 },
      poiseDamage: 15,
      staminaDamage: 0,
      impulse: ZERO,
      impactForce: 0,
      tags: [],
    },
    penetration: 20,
    onImpact: 'stick',
    retrievable: true,
    payload: [],
    cues: { trailVfx: 'vfx-arrow-trail-standard', flightSfx: 'sfx-arrow-flyby' },
    tags: [],
    ...over,
  };
}

const STANDARD = arrowDef('standard');
const NO_DRAG = arrowDef('no-drag', { dragK: 0 });
const BLUNT = arrowDef('blunt', {
  massGrams: 35,
  dragK: 0,
  damage: { ...STANDARD.damage, amounts: { blunt: 10 }, impulse: v3(0, 1, 5) },
  penetration: 0,
  onImpact: 'bounce',
});
const WATER = arrowDef('water', {
  dragK: 0,
  penetration: 0,
  onImpact: 'shatter',
  retrievable: false,
});
const ARROWS: ArrowLookup = arrowLookup([STANDARD, NO_DRAG, BLUNT, WATER]);

interface Setup {
  readonly shapes?: readonly GreyboxShape[];
  readonly stimuli?: boolean;
  readonly collision?: CollisionWorld | null;
  readonly invulnerable?: InvulnerabilityRule;
  readonly rules?: Partial<ArrowRules>;
}

function setup(options: Setup = {}) {
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  if (options.stimuli === true) installStimuli(world);
  else world.register(PlacementComponent);
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PhysicsColliderComponent);
  const collision =
    options.collision === undefined
      ? new FakeCollisionWorld(options.shapes ?? [])
      : (options.collision ?? undefined);
  installArrows(world, {
    arrows: ARROWS,
    damage: new DamageModel(),
    ...(collision !== undefined && { collision }),
    ...(options.invulnerable !== undefined && { invulnerable: options.invulnerable }),
    ...(options.rules !== undefined && { rules: options.rules }),
  });
  if (options.stimuli === true) world.addSystem(stimulusSystem());
  const fired: ArrowFiredInfo[] = [];
  const impacts: ArrowImpactInfo[] = [];
  const expired: ArrowExpiredInfo[] = [];
  const damage: DamageResult[] = [];
  const dodged: HitboxHitInfo[] = [];
  world.events.on(ArrowFired, (e) => fired.push(e));
  world.events.on(arrowImpact, (e) => impacts.push(e));
  world.events.on(ArrowExpired, (e) => expired.push(e));
  world.events.on(DamageApplied, (e) => damage.push(e));
  world.events.on(DodgedHit, (e) => dodged.push(e));
  const fire = (arrow: string, origin: Vec3, velocity: Vec3, shooter?: EntityId) =>
    fireArrow(world, ARROWS, {
      arrow,
      origin,
      velocity,
      ...(shooter !== undefined && { shooter }),
    });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  /** Steps until `entity` stops flying (at most `max` ticks); returns the ticks stepped. */
  const land = (entity: EntityId, max = 1200) => {
    let ticks = 0;
    while (world.get(entity, ArrowComponent) !== undefined && ticks < max) {
      world.step();
      ticks++;
    }
    return ticks;
  };
  return { world, fired, impacts, expired, damage, dodged, fire, run, land };
}

const sphereBox = (radius: number, over: Partial<Hurtbox> = {}): Hurtbox => ({
  id: 'body',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'sphere', center: ZERO, radius },
  ...over,
});

/** A creature with 100 health at `at` whose hurtboxes are `boxes` (a 0.5 m sphere by default). */
function creature(
  world: World<never>,
  at: Vec3,
  boxes: readonly Hurtbox[] = [sphereBox(0.5)],
  properties: Partial<WorldPropertyValues> = {},
): EntityId {
  const entity = world.spawn();
  placeEntity(world, entity, at, 0.5);
  giveCombatant(world, entity, { health: 100 });
  giveHurtboxes(world, entity, { boxes });
  if (Object.keys(properties).length > 0) addProperties(world, entity, properties);
  return entity;
}

/** A level entity made of `properties` owning collider `body` (as `bindCollider` records it). */
function surface(world: World<never>, body: number, properties: Partial<WorldPropertyValues>) {
  const entity = world.spawn();
  addProperties(world, entity, properties);
  world.add(entity, PhysicsColliderComponent, { colliders: [body] });
  return entity;
}

const flightOf = (world: World<never>, entity: EntityId): ArrowFlight => {
  const flight = world.get(entity, ArrowComponent);
  if (flight === undefined) throw new Error('not flying');
  return flight;
};

/** Launch velocity at `speed` m/s, `degrees` above the +x axis. */
function launch(speed: number, degrees: number): Vec3 {
  const a = (degrees * Math.PI) / 180;
  return v3(speed * cos(a), speed * sin(a), 0);
}

/** A floor whose top is at y = 0, from x = −10 to 400. */
const FLOOR = box(v3(-10, -1, -10), v3(400, 0, 10));

describe('ballistics maths', () => {
  it('integrates velocity first, then position (semi-implicit Euler)', () => {
    const next = integrateFlight({ position: ZERO, velocity: v3(10, 0, 0) }, 0, 10, 0.1);
    expect(next.velocity).toEqual(v3(10, -1, 0));
    expect(next.position).toEqual(v3(1, -0.1, 0));
  });

  it('drag decelerates along the flight line by k/m·|v|·v', () => {
    const next = integrateFlight({ position: ZERO, velocity: v3(0, 0, 50) }, 0.002, 0, 0.01);
    expect(next.velocity.z).toBeCloseTo(50 - 0.002 * 50 * 50 * 0.01, 12);
    expect(next.velocity.x).toBe(0);
  });

  it('scales damage by (v/v0)² clamped to [min, 1]', () => {
    expect(damageFactor(30, 60, 0.3)).toBeCloseTo(0.3, 12);
    expect(damageFactor(48, 60, 0.3)).toBeCloseTo(0.64, 12);
    expect(damageFactor(10, 60, 0.3)).toBe(0.3);
    expect(damageFactor(70, 60, 0.3)).toBe(1);
  });

  it('sticks when penetration reaches the surface rating', () => {
    expect(PENETRATION_TO_STICK).toEqual({ soft: 5, medium: 10, hard: 40 });
    expect(penetrates(20, 'medium')).toBe(true);
    expect(penetrates(10, 'medium')).toBe(true);
    expect(penetrates(20, 'hard')).toBe(false);
    expect(penetrates(0, 'soft')).toBe(false);
  });

  it('reflects off a surface keeping a fraction of the speed; a normal facing away sends it back', () => {
    expect(ricochet(v3(3, -4, 0), v3(0, 1, 0), 0.5)).toEqual(v3(1.5, 2, 0));
    expect(ricochet(v3(3, 4, 0), v3(0, 1, 0), 0.5)).toEqual(v3(-1.5, -2, -0));
    expect(speedOf(v3(3, 4, 0))).toBe(5);
  });
});

describe('arrow flight', () => {
  it('AC-1: 60 m/s at 30° without drag lands within 1% of the analytic range', () => {
    const t = setup({ shapes: [FLOOR] });
    const arrow = t.fire('no-drag', ZERO, launch(60, 30));
    t.land(arrow);
    const analytic = (60 * 60 * sin((60 * Math.PI) / 180)) / G; // v² sin 2θ / g ≈ 317.8 m
    expect(analytic).toBeCloseTo(317.8, 1);
    const [hit] = t.impacts;
    expect(hit?.position.x).toBeGreaterThan(analytic * 0.99);
    expect(hit?.position.x).toBeLessThan(analytic * 1.01);
    expect(hit?.position.y).toBeCloseTo(0, 6);
    expect(hit?.outcome).toBe('stick'); // unbound ground is medium; penetration 20 sticks
    const rest = t.world.get(arrow, ArrowRestComponent);
    expect(rest).toMatchObject({ arrow: 'no-drag', state: 'stuck', in: null });
    expect(rest?.direction.y).toBeLessThan(0);
  });

  it('drag shortens the flight and slows the arrow', () => {
    const t = setup({ shapes: [FLOOR] });
    const plain = t.fire('no-drag', ZERO, launch(60, 30));
    const dragged = t.fire('standard', v3(0, 0, 5), launch(60, 30));
    t.land(plain);
    t.land(dragged);
    const [a, b] = [...t.impacts].sort((x, y) => x.entity - y.entity);
    expect(b?.position.x).toBeLessThan((a?.position.x ?? 0) * 0.8);
    expect(b?.speed).toBeLessThan(a?.speed ?? 0);
  });

  it('points along its velocity', () => {
    expect(arrowDirection({ velocity: v3(0, 3, 4) })).toEqual(v3(0, 0.6, 0.8));
  });

  it('fires with ArrowFired and rejects unknown arrows and bad launches', () => {
    const t = setup();
    const arrow = t.fire('standard', v3(1, 2, 3), v3(0, 0, 50), undefined);
    t.run(1);
    expect(t.fired).toEqual([
      {
        tick: 0,
        entity: arrow,
        arrow: 'standard',
        shooter: null,
        origin: v3(1, 2, 3),
        velocity: v3(0, 0, 50),
      },
    ]);
    expect(flightOf(t.world, arrow)).toMatchObject({ flown: 1, launchSpeed: 50, spent: false });
    expect(() => t.fire('nope', ZERO, v3(1, 0, 0))).toThrow(/"nope" is not in the arrow table/);
    expect(() => t.fire('standard', v3(Number.NaN, 0, 0), v3(1, 0, 0))).toThrow(/origin/);
    expect(() => t.fire('standard', ZERO, ZERO)).toThrow(/velocity/);
    expect(() => t.fire('standard', ZERO, v3(Infinity, 0, 0))).toThrow(/velocity/);
  });

  it('expires after 10 s airborne without coming to rest', () => {
    const t = setup({ collision: null });
    const arrow = t.fire('standard', ZERO, v3(0, 0, 10));
    t.run(599);
    expect(t.world.isAlive(arrow)).toBe(true);
    t.run(1);
    expect(t.world.isAlive(arrow)).toBe(false);
    expect(t.expired).toEqual([
      { tick: 599, entity: arrow, arrow: 'standard', position: expect.anything() as Vec3 },
    ]);
    t.run(1); // no arrows: nothing to do
    expect(t.impacts).toEqual([]);
  });

  it('flies identically on every run (state hashes)', () => {
    const hashes = () => {
      const t = setup({ shapes: [FLOOR] });
      creature(t.world, v3(20, 1, 0));
      t.fire('standard', v3(0, 1, 0), launch(50, 2));
      t.fire('blunt', v3(0, 1, 0.1), launch(40, 3));
      const out: string[] = [];
      for (let i = 0; i < 120; i++) {
        t.world.step();
        out.push(hashWorld(t.world));
      }
      return out;
    };
    expect(hashes()).toEqual(hashes());
  });
});

describe('arrow hits', () => {
  it('AC-3: an 80 m/s arrow registers on a 5 cm plank', () => {
    // 80 m/s covers 1.33 m a tick: the plank sits inside one tick's step, never on a tick boundary.
    const t = setup({ shapes: [box(v3(10.3, 0, -1), v3(10.35, 2, 1))] });
    const arrow = t.fire('no-drag', v3(0, 1, 0), v3(80, 0, 0));
    t.land(arrow, 20);
    expect(t.impacts).toHaveLength(1);
    expect(t.impacts[0]?.position.x).toBeCloseTo(10.3, 6);
    expect(t.impacts[0]?.normal).toEqual(v3(-1, 0, 0));
    expect(t.world.get(arrow, ArrowRestComponent)?.state).toBe('stuck');
  });

  it('AC-3: an 80 m/s arrow registers on a 5 cm limb', () => {
    const t = setup({ collision: null });
    // A 5 cm thick upright limb, 1 m long.
    const limb: LocalShape = {
      kind: 'capsule',
      from: v3(0, -0.5, 0),
      to: v3(0, 0.5, 0),
      radius: 0.025,
    };
    const target = creature(t.world, v3(10.3, 1, 0), [
      sphereBox(0, { region: 'limb', shape: limb }),
    ]);
    const arrow = t.fire('no-drag', v3(0, 1, 0), v3(80, 0, 0));
    t.land(arrow, 20);
    expect(t.impacts).toMatchObject([{ other: target, hurtbox: 'body', region: 'limb' }]);
    expect(healthOf(t.world, target)?.current).toBeLessThan(100);
  });

  it('AC-4: penetration 20 ricochets off stone at 40% speed and deals no damage', () => {
    const t = setup({ shapes: [box(v3(5, -5, -5), v3(6, 5, 5))] });
    const stone = surface(t.world, 1, { material: 'stone', surfaceHardness: 'hard' });
    const arrow = t.fire('no-drag', v3(0, 1, 0), v3(50, 0, 0));
    t.run(7); // reaches x = 5 in the 6th tick
    const [hit] = t.impacts;
    expect(hit).toMatchObject({
      other: stone,
      material: 'stone',
      hardness: 'hard',
      outcome: 'ricochet',
    });
    const after = flightOf(t.world, arrow);
    expect(after.velocity.x).toBeCloseTo(-0.4 * 50, 6); // reflected off the face at 40%
    expect(Math.abs(after.velocity.y)).toBeLessThan(0.4 * 2); // plus the tick's gravity
    expect(hit?.impulse).toBeCloseTo(0.025 * speedOf(v3(50 + 20, 0, 0)), 3);
    expect(t.damage).toEqual([]);
  });

  it('AC-4: penetration 20 glances off a stone-skinned creature without damage', () => {
    const t = setup({ collision: null });
    const golem = creature(t.world, v3(5, 1, 0), undefined, { surfaceHardness: 'hard' });
    const arrow = t.fire('no-drag', v3(0, 1, 0), v3(50, 0, 0));
    t.run(7);
    expect(t.impacts).toMatchObject([{ other: golem, outcome: 'ricochet', hardness: 'hard' }]);
    expect(t.impacts[0]?.damage).toBeUndefined();
    expect(t.damage).toEqual([]);
    expect(healthOf(t.world, golem)?.current).toBe(100);
    expect(flightOf(t.world, arrow).velocity.x).toBeLessThan(0); // bounced back off the front
  });

  it('sticks in a creature, dealing its packet scaled by speed, and rests in it', () => {
    const t = setup({ collision: null });
    const target = creature(t.world, v3(10, 1, 0), [sphereBox(0.5, { multiplier: 2 })]);
    const shooter = creature(t.world, v3(0, 1, -5));
    const arrow = t.fire('standard', v3(0, 1, 0), v3(60, 0, 0), shooter);
    t.land(arrow, 60);
    const [hit] = t.impacts;
    const factor = ((hit?.speed ?? 0) / 60) ** 2;
    expect(factor).toBeLessThan(1);
    expect(factor).toBeGreaterThan(0.3);
    expect(hit).toMatchObject({ other: target, outcome: 'stick', region: 'torso', shooter });
    expect(t.damage).toHaveLength(1);
    const [result] = t.damage;
    expect(hit?.damage).toBe(result);
    expect(result?.packet).toMatchObject({ instigator: shooter, source: arrow, region: 'torso' });
    expect(result?.packet.regionMultiplier).toBe(2);
    expect(result?.total).toBeCloseTo(25 * factor * 2, 1);
    expect(result?.poiseDamage).toBeCloseTo(15 * factor, 1);
    expect(t.world.get(arrow, ArrowRestComponent)).toMatchObject({ state: 'stuck', in: target });
    expect(hit?.energy).toBeCloseTo(0.5 * 0.025 * (hit?.speed ?? 0) ** 2, 9);
  });

  it('clamps damage at 30% for a slow hit (a ricochet coming back)', () => {
    // A blunt arrow bounces off a wall at 40% speed ((0.4)² = 16% < 30%) into a creature behind it.
    const t = setup({ shapes: [box(v3(5, -5, -5), v3(6, 5, 5))] });
    const target = creature(t.world, v3(2, 1, 0), [sphereBox(0.3)]);
    t.world.set(target, PlacementComponent, { x: 2, y: 1, z: 0, radius: 0.5 });
    const arrow = t.fire('blunt', v3(2.5, 1, 0), v3(50, 0, 0));
    t.land(arrow, 60);
    expect(t.impacts.slice(0, 2).map((i) => i.outcome)).toEqual(['ricochet', 'ricochet']);
    expect(t.impacts[1]?.other).toBe(target);
    expect(t.damage[0]?.total).toBeCloseTo(10 * 0.3, 2);
  });

  it('a blunt head hurts without penetrating, pushes along its flight and bounces', () => {
    const t = setup({ collision: null });
    const target = creature(t.world, v3(10, 1, 0));
    t.fire('blunt', v3(0, 1, 0), v3(40, 0, 0));
    t.run(20);
    expect(t.impacts[0]).toMatchObject({ other: target, outcome: 'ricochet' });
    const packet = t.damage[0]?.packet;
    expect(packet?.amounts.blunt).toBeGreaterThan(0);
    // Impulse (0, 1, 5) authored facing the flight: forward is +x here.
    expect(packet?.impulse.x).toBeGreaterThan(4);
    expect(packet?.impulse.z).toBeCloseTo(0, 9);
  });

  it('mw-e05.6 AC-3: an arrow below the armour value ricochets off an armoured region for 0 damage and a Deflected event', () => {
    const t = setup({ collision: null });
    const deflected: DeflectInfo[] = [];
    t.world.events.on(Deflected, (e) => deflected.push(e));
    const target = creature(t.world, v3(10, 1, 0), [sphereBox(0.5, { armored: true, armor: 30 })]);
    t.fire('standard', v3(0, 1, 0), v3(60, 0, 0));
    t.run(30);
    expect(t.impacts[0]).toMatchObject({ other: target, outcome: 'ricochet' });
    expect(t.damage[0]?.total).toBe(0);
    expect(t.damage[0]?.tags).toContain('deflected');
    expect(deflected).toMatchObject([{ target, armor: 30, penetration: 20, region: 'torso' }]);
    expect(healthOf(t.world, target)?.current).toBe(100);
  });

  it('mw-e05.6 AC-3: a blunt arrow ignores armour deflection but deals half damage', () => {
    const t = setup({ collision: null });
    const armoured = creature(t.world, v3(10, 1, 0), [
      sphereBox(0.5, { armored: true, armor: 30 }),
    ]);
    const bare = creature(t.world, v3(10, 1, 6));
    t.fire('blunt', v3(0, 1, 0), v3(40, 0, 0));
    t.fire('blunt', v3(0, 1, 6), v3(40, 0, 0));
    t.run(20);
    const dealt = (entity: EntityId) => t.damage.find((d) => d.target === entity)?.total ?? -1;
    expect(dealt(armoured)).toBeGreaterThan(0);
    expect(dealt(armoured)).toBeCloseTo(dealt(bare) / 2, 2);
    expect(t.damage.every((d) => !d.tags.includes('deflected'))).toBe(true);
  });

  it('mw-e05.6: an arrow that out-penetrates the armour sticks and damages as usual', () => {
    const t = setup({ collision: null });
    const target = creature(t.world, v3(10, 1, 0), [sphereBox(0.5, { armored: true, armor: 15 })]);
    t.fire('standard', v3(0, 1, 0), v3(60, 0, 0));
    t.run(30);
    expect(t.impacts[0]).toMatchObject({ other: target, outcome: 'stick' });
    expect(t.damage[0]?.total).toBeGreaterThan(0);
  });

  it('mw-e05.6: a shatter head is deflected by armour but still breaks', () => {
    const t = setup({ collision: null });
    creature(t.world, v3(10, 1, 0), [sphereBox(0.5, { armored: true, armor: 30 })]);
    t.fire('water', v3(0, 1, 0), v3(60, 0, 0));
    t.run(30);
    expect(t.impacts[0]?.outcome).toBe('shatter');
    expect(t.damage[0]?.tags).toContain('deflected');
  });

  it('mw-e05.6: a headshot arrow does twice a body hit and is tagged headshot', () => {
    const t = setup({ collision: null });
    creature(t.world, v3(10, 1, 0), [sphereBox(0.5, { region: 'head', multiplier: 2 })]);
    t.fire('standard', v3(0, 1, 0), v3(60, 0, 0));
    t.run(30);
    const [hit] = t.damage;
    expect(hit?.tags).toContain('headshot');
    expect(hit?.total).toBeGreaterThan(25 * 2 * 0.3 - 0.01);
  });

  it('a ricochet is not caught again by the creature it glanced off moving on into it', () => {
    const t = setup({ collision: null });
    const target = creature(t.world, v3(5, 1, 0));
    const arrow = t.fire('blunt', v3(0, 1, 0), v3(40, 0, 0));
    while (t.impacts.length === 0) t.world.step();
    const back = flightOf(t.world, arrow);
    expect(back.glanced).toBe(target);
    // The creature steps into the retreating arrow: it still touches it, so no second hit.
    const { x, y, z } = back.position;
    t.world.set(target, PlacementComponent, { x: x + 0.3, y, z, radius: 0.5 });
    t.run(1);
    expect(t.impacts).toHaveLength(1);
    expect(flightOf(t.world, arrow).glanced).toBe(target);
  });

  it('a blunt head falling straight down pushes along the default forward', () => {
    const t = setup({ collision: null });
    creature(t.world, v3(0, 0, 0));
    t.fire('blunt', v3(0, 3, 0), v3(0, -30, 0));
    t.run(10);
    expect(t.damage[0]?.packet.impulse.z).toBeGreaterThan(4);
  });

  it('a shattering arrow deals its packet and leaves the world; on a wall it just breaks', () => {
    const t = setup({ shapes: [box(v3(5, -5, 2), v3(6, 5, 3))] });
    const target = creature(t.world, v3(5, 1, 0));
    const a = t.fire('water', v3(0, 1, 0), v3(40, 0, 0));
    const b = t.fire('water', v3(0, 1, 2.5), v3(40, 0, 0));
    t.run(10);
    expect(t.impacts.map((i) => [i.entity, i.outcome, i.other])).toEqual([
      [a, 'shatter', target],
      [b, 'shatter', null],
    ]);
    expect(t.damage).toHaveLength(1);
    expect(t.world.isAlive(a)).toBe(false);
    expect(t.world.isAlive(b)).toBe(false);
  });

  it('strikes the first hurtbox along its path: torso before a head behind it', () => {
    const t = setup({ collision: null });
    const target = creature(t.world, v3(10, 1, 0), [
      sphereBox(0.3, {
        id: 'torso',
        shape: { kind: 'sphere', center: v3(-0.5, 0, 0), radius: 0.3 },
      }),
      sphereBox(0.2, {
        id: 'head',
        region: 'head',
        multiplier: 2,
        shape: { kind: 'sphere', center: v3(0.5, 0, 0), radius: 0.2 },
      }),
    ]);
    t.fire('no-drag', v3(0, 1, 0), v3(80, 0.3, 0)); // both within one tick's 1.33 m
    t.run(10);
    expect(t.impacts).toMatchObject([{ other: target, hurtbox: 'torso', region: 'torso' }]);
  });

  it('a wall in front shields a creature behind it in the same tick', () => {
    const t = setup({ shapes: [box(v3(10, -5, -5), v3(10.1, 5, 5))] });
    creature(t.world, v3(10.7, 1, 0));
    t.fire('no-drag', v3(0, 1, 0), v3(80, 0, 0));
    t.run(10);
    expect(t.impacts).toMatchObject([{ other: null, outcome: 'stick' }]);
    expect(t.damage).toEqual([]);
  });

  it('flies through targets in their i-frames (DodgedHit once) and hits the one behind', () => {
    const t = setup({ collision: null });
    const dodger = creature(t.world, v3(5, 1, 0));
    const behind = creature(t.world, v3(10, 1, 0));
    const shooter = creature(t.world, v3(0, 1, -5));
    const t2 = setup({
      collision: null,
      invulnerable: (_world, target) => target === dodger,
    });
    // Same ids in the second world: the dodger is invulnerable there.
    expect([creature(t2.world, v3(5, 1, 0)), creature(t2.world, v3(10, 1, 0))]).toEqual([
      dodger,
      behind,
    ]);
    creature(t2.world, v3(0, 1, -5));
    const arrow = t2.fire('no-drag', v3(0, 1, 0), v3(60, 0, 0), shooter);
    t2.run(30);
    expect(t2.dodged).toHaveLength(1);
    expect(t2.dodged[0]).toMatchObject({ attacker: shooter, target: dodger, hitbox: 'no-drag' });
    expect(t2.impacts).toMatchObject([{ other: behind, outcome: 'stick' }]);
    expect(t2.world.get(arrow, ArrowRestComponent)?.in).toBe(behind);
    expect(t.impacts).toEqual([]);
  });

  it('a dodged arrow keeps its dodged list through a ricochet in the same tick', () => {
    const t = setup({
      shapes: [box(v3(5.6, -5, -5), v3(6, 5, 5))],
      invulnerable: () => true,
    });
    const near = creature(t.world, v3(5.3, 1, 0), [sphereBox(0.1)]);
    const far = creature(t.world, v3(5, 1, 0), [sphereBox(0.1)]);
    expect(surface(t.world, 1, { surfaceHardness: 'hard' })).toBe(3);
    const arrow = t.fire('no-drag', v3(4.8, 1, 0), v3(60, 0, 0));
    t.run(1);
    expect(t.dodged.map((d) => d.target)).toEqual([far, near]); // nearest first
    expect(t.dodged[0]?.attacker).toBe(arrow); // no shooter: the arrow itself
    expect(t.impacts[0]?.outcome).toBe('ricochet');
    expect(flightOf(t.world, arrow).dodged).toEqual([near, far]); // ascending ids
    t.run(3); // flying back through the dodgers: already dodged, not hit again
    expect(t.dodged).toHaveLength(2);
    expect(t.damage).toEqual([]);
  });

  it('keeps flying through dodgers on ticks it hits nothing', () => {
    const t = setup({ collision: null, invulnerable: () => true });
    const far = creature(t.world, v3(3.5, 1, 0), [sphereBox(0.1)]);
    const near = creature(t.world, v3(3, 1, 0), [sphereBox(0.1)]);
    const arrow = t.fire('no-drag', v3(2.5, 1, 0), v3(60, 0, 0));
    t.run(2);
    expect(t.dodged.map((d) => d.target)).toEqual([near, far]);
    expect(flightOf(t.world, arrow).dodged).toEqual([far, near]);
  });
});

describe('the shooter and its own arrow', () => {
  it('AC-5: an arrow shot straight up at 40 m/s comes back down and hits its shooter', () => {
    const t = setup({ collision: null });
    const shooter = creature(t.world, v3(0, 1, 0));
    const arrow = t.fire('standard', v3(0, 1.2, 0), v3(0, 40, 0), shooter);
    const ticks = t.land(arrow);
    expect(ticks).toBeGreaterThan(300); // up and back down: several seconds later
    expect(t.impacts).toMatchObject([{ other: shooter, outcome: 'stick', shooter }]);
    expect(t.damage).toMatchObject([{ target: shooter }]);
  });

  it('AC-5: within its first 30 ticks the shooter is not hit, from tick 31 it is', () => {
    // A slow arrow loosed inside the shooter's hurtbox stays inside it: immune until tick 30.
    const t = setup({ collision: null });
    const shooter = creature(t.world, v3(0, 0, 0), [sphereBox(5)]);
    const arrow = t.fire('standard', v3(0, 0, 0), v3(0.5, 0, 0), shooter);
    t.run(30);
    expect(t.impacts).toEqual([]);
    expect(flightOf(t.world, arrow).flown).toBe(30);
    t.run(1);
    expect(t.impacts).toMatchObject([{ other: shooter, tick: 30 }]);
  });

  it('others are never immune: a bystander at the bow is hit at once', () => {
    const t = setup({ collision: null });
    const bystander = creature(t.world, v3(0, 0, 0));
    t.fire('standard', v3(0, 0, 0), v3(10, 0, 0));
    t.run(1);
    expect(t.impacts).toMatchObject([{ other: bystander }]);
  });
});

describe('drops', () => {
  it('a slow arrow that cannot penetrate the ground drops and rests there', () => {
    const t = setup({ shapes: [FLOOR] });
    surface(t.world, 1, { surfaceHardness: 'hard' });
    const arrow = t.fire('no-drag', v3(0, 0.1, 0), v3(1, -3, 0));
    t.land(arrow, 30);
    expect(t.impacts).toMatchObject([{ outcome: 'drop', hardness: 'hard' }]);
    expect(t.world.get(arrow, ArrowRestComponent)?.state).toBe('dropped');
  });

  it('dropping off a wall it falls, harmless, and rests on the ground', () => {
    const t = setup({ shapes: [FLOOR, box(v3(1, 0, -5), v3(2, 5, 5))] });
    const wall = surface(t.world, 2, { surfaceHardness: 'hard' });
    const target = creature(t.world, v3(0.8, 0.3, 0), [sphereBox(0.2)]);
    const arrow = t.fire('no-drag', v3(0.9, 1, 0), v3(3, 0, 0));
    t.land(arrow, 120);
    expect(t.impacts.map((i) => [i.outcome, i.other])).toEqual([
      ['drop', wall],
      ['drop', null],
    ]);
    expect(t.world.get(arrow, ArrowRestComponent)?.state).toBe('dropped');
    expect(healthOf(t.world, target)?.current).toBe(100); // fell through it, harmless
  });

  it('a slow blunt arrow drops off a creature and falls', () => {
    const t = setup({ shapes: [FLOOR] });
    const target = creature(t.world, v3(1, 1, 0));
    const arrow = t.fire('blunt', v3(0, 1, 0), v3(3, 0, 0));
    t.run(20);
    expect(t.impacts[0]).toMatchObject({ outcome: 'drop', other: target });
    expect(t.impacts[0]?.damage).toBeUndefined();
    t.land(arrow, 120);
    expect(t.world.get(arrow, ArrowRestComponent)?.state).toBe('dropped');
  });
});

describe('what arrows hit, by properties', () => {
  it('pushes a struck object through the stimulus API with the momentum it lost', () => {
    const t = setup({ stimuli: true, shapes: [box(v3(5, 0, -0.5), v3(6, 1, 0.5))] });
    const crate = surface(t.world, 1, { pushable: true, weight: 10, material: 'wood' });
    placeEntity(t.world, crate, v3(5.5, 0.5, 0), 0.7);
    const pushes: { entity: EntityId; impulse: Vec3 }[] = [];
    t.world.events.on(impulseApplied, (e) => pushes.push(e));
    t.fire('no-drag', v3(0, 0.5, 0), v3(50, 0, 0));
    t.run(8);
    expect(t.impacts).toMatchObject([{ other: crate, material: 'wood', outcome: 'stick' }]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.entity).toBe(crate);
    expect(speedOf(pushes[0]?.impulse ?? ZERO)).toBeCloseTo(t.impacts[0]?.impulse ?? 0, 9);
    expect(pushes[0]?.impulse.x).toBeGreaterThan(0);
  });

  it('mw-e03.11: strikes what it hits with its impact energy — pierce for a point, blunt for a bounce head', () => {
    const t = setup({ stimuli: true, shapes: [box(v3(5, 0, -0.5), v3(6, 1, 0.5))] });
    const pot = surface(t.world, 1, { hp: 10, fragile: 5, material: 'clay' });
    placeEntity(t.world, pot, v3(5.5, 0.5, 0), 0.7);
    const struck: { element: string; amount: number; entity: EntityId | undefined }[] = [];
    t.world.events.on(stimulusResolved, ({ stimulus, hits }) => {
      if (stimulus.element === 'force') return;
      struck.push({
        element: stimulus.element,
        amount: hits[0]?.amount ?? 0,
        entity: hits[0]?.entity,
      });
    });
    t.fire('no-drag', v3(0, 0.5, 0), v3(50, 0, 0));
    t.run(8);
    t.fire('blunt', v3(0, 0.5, 0), v3(30, 0, 0));
    t.run(12);
    expect(struck.map((s) => [s.element, s.entity])).toEqual([
      ['pierce', pot],
      ['blunt', pot],
    ]);
    expect(struck[0]?.amount).toBeCloseTo(t.impacts[0]?.energy ?? 0, 9);
    expect(struck[1]?.amount).toBeCloseTo(t.impacts[1]?.energy ?? 0, 9);
  });

  it('names physics objects by their body; unbound colliders by nobody', () => {
    const world = new World<never>({ seed: 1 });
    expect(physicsSurfaceOf(world, 3)).toBeNull(); // nothing registered
    world.register(PhysicsColliderComponent, PhysicsObjectComponent);
    const wall = world.spawn();
    world.add(wall, PhysicsColliderComponent, { colliders: [1, 2] });
    const crate = world.spawn();
    world.add(crate, PhysicsObjectComponent, {
      body: 3,
      shape: { kind: 'box', halfExtents: v3(0.5, 0.5, 0.5) },
      position: ZERO,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      sleeping: false,
      awakeSince: 0,
    });
    expect(physicsSurfaceOf(world, 2)).toBe(wall);
    expect(physicsSurfaceOf(world, 3)).toBe(crate);
    expect(physicsSurfaceOf(world, 4)).toBeNull();
  });

  it('works in worlds without stimuli: nothing is pushed', () => {
    const t = setup({ shapes: [box(v3(5, 0, -0.5), v3(6, 1, 0.5))] });
    surface(t.world, 1, { pushable: true, weight: 10 });
    t.fire('no-drag', v3(0, 0.5, 0), v3(50, 0, 0));
    t.run(8);
    expect(t.impacts).toHaveLength(1);
  });

  it('takes the surface normal of capsules and boxes; along a capsule core it glances back', () => {
    const capsule: LocalShape = {
      kind: 'capsule',
      from: v3(0, -1, 0),
      to: v3(0, 1, 0),
      radius: 0.3,
    };
    const boxShape: LocalShape = { kind: 'box', center: ZERO, halfExtents: v3(0.3, 0.3, 0.3) };
    const point: LocalShape = { kind: 'capsule', from: ZERO, to: ZERO, radius: 0.3 };
    const t = setup({ collision: null });
    const hard = { surfaceHardness: 'hard' } as const;
    creature(t.world, v3(5, 1, 0), [sphereBox(0, { shape: capsule })], hard);
    creature(t.world, v3(5, 1, 3), [sphereBox(0, { shape: boxShape })], hard);
    creature(t.world, v3(5, 1, 6), [sphereBox(0, { shape: point })], hard);
    creature(t.world, v3(5, 1, 9), [sphereBox(0, { shape: capsule })], hard);
    t.fire('no-drag', v3(0, 1, 0), v3(40, 0, 0));
    t.fire('no-drag', v3(0, 1, 3), v3(40, 0, 0));
    t.fire('no-drag', v3(0, 1, 6), v3(40, 0, 0));
    t.fire('no-drag', v3(5, 1.5, 9), v3(0, -40, 0)); // inside, down the core line
    t.run(10);
    // Each arrow's first impact (the one inside the capsule then rattles about its core).
    const first = (other: EntityId) => t.impacts.find((i) => i.other === other)?.normal;
    expect(first(1)).toEqual(v3(-1, 0, 0)); // capsule: straight out from its core
    expect(first(2)?.x).toBeLessThan(-0.9); // box: out from its centre
    expect(first(3)?.x).toBeLessThan(-0.9); // a capsule with no length is a sphere
    expect(first(4)).toEqual(v3(-0, 1, -0)); // on the core line itself: straight back
  });
});

describe('castSegment', () => {
  const hit = (distance: number, normal: Vec3): CollisionHit => ({
    distance,
    normal,
    point: ZERO,
    body: 1,
  });

  it('is clear for a zero-length segment', () => {
    expect(castSegment(new FakeCollisionWorld([FLOOR]), ZERO, ZERO)).toBeUndefined();
  });

  it('skips contacts it is leaving and re-casts past them', () => {
    const world = new FakeCollisionWorld([FLOOR, box(v3(-1, 3, -1), v3(1, 4, 1))]);
    const found = castSegment(world, ZERO, v3(0, 5, 0)); // starts on the floor's top face
    expect(found?.distance).toBeCloseTo(3, 9);
    expect(found?.body).toBe(2);
    expect(castSegment(world, ZERO, v3(0, 2, 0))).toBeUndefined();
  });

  it('gives up after a few leaving contacts or at the end of the segment', () => {
    let calls = 0;
    const leaving: CollisionWorld = Object.assign(new FakeCollisionWorld(), {
      raycast: () => {
        calls++;
        return hit(0.1, v3(1, 0, 0));
      },
    });
    expect(castSegment(leaving, ZERO, v3(10, 0, 0))).toBeUndefined();
    expect(calls).toBe(3);
    calls = 0;
    expect(castSegment(leaving, ZERO, v3(0.15, 0, 0))).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('arrowLookup', () => {
  it('tables arrows by id', () => {
    expect(arrowLookup([STANDARD, BLUNT]).get('blunt')).toBe(BLUNT);
  });
});

describe('rules', () => {
  it('takes overrides: a shorter lifetime', () => {
    const t = setup({ collision: null, rules: { lifetimeSeconds: 1 } });
    t.fire('standard', ZERO, v3(0, 0, 10));
    t.run(60);
    expect(t.expired).toHaveLength(1);
  });
});
