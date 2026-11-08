import * as RAPIER from '@dimforge/rapier3d-deterministic';
import type { ControllerTuning, EnvironmentDamageTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { Capsule } from '../../character/collision-world';
import { SKIN } from '../../character/controller';
import { box } from '../../character/greybox';
import { applyCharacterImpulse } from '../../character/impulse';
import {
  CharacterController,
  CharacterImpacted,
  characterControllerSystem,
  spawnCharacter,
  type CharacterImpactInfo,
} from '../../character/system';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import {
  addPhysicsObject,
  bindCollider,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../../physics/objects';
import { RapierCollisionWorld } from '../../physics/rapier-collision-world';
import { RapierPhysics } from '../../physics/rapier';
import { addProperties, registerWorldProperties, setProperty } from '../../properties/components';
import { lightComponents } from '../../light/components';
import { spawnLightSource } from '../../light/sources';
import { placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { applyStimulus, installStimuli, stimulusSystem } from '../../stimulus/stimulus';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../damage/components';
import { DamageApplied, Died, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import {
  blame,
  BlameComponent,
  blameOf,
  EnvironmentContactsComponent,
  fallDamageFraction,
  hazardSystem,
  installEnvironmentDamage,
  kineticDamage,
  kineticImpactSystem,
  noLiquid,
  physicsSurface,
  resolveFall,
  sphereTouchesCapsule,
  type LiquidDepthReader,
} from './environment';

/** The shipped rules (src/content/data/environment-damage/default.json; checked in tests/contracts). */
const RULES: Frozen<EnvironmentDamageTuning> = {
  fall: { safeHeight: 4, lethalHeight: 14, deepWater: 1.5 },
  kinetic: { minSpeed: 6, joulesPerPoint: 20 },
  hazards: [{ when: 'burning', perSecond: { fire: 8 }, reach: 0.75, pulseMs: 250 }],
};

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
  launch: { airControl: 0.1, recoveryMs: 250, mass: 90 },
};

/** Real-world gravity, which mw-e02.15's speeds (safe 8, lethal 20 m/s) were sketched at. */
const EARTH = 9.81;
const CAPSULE: Capsule = { radius: 0.35, height: 1.8 };
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

interface EnvOptions {
  readonly gravity?: number;
  readonly liquidDepth?: LiquidDepthReader;
  readonly rules?: Frozen<EnvironmentDamageTuning>;
}

function env({ gravity = TUNING.gravity, liquidDepth, rules = RULES }: EnvOptions = {}) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1, physics })));
  installPhysicsObjects(world);
  world.register(CharacterController, ...DAMAGE_COMPONENTS);
  const floor = physics.add(box(v(-50, -1, -50), v(50, 0, 50)));
  world.addSystem(stimulusSystem());
  world.addSystem(
    characterControllerSystem({
      collision: new RapierCollisionWorld(physics),
      tuning: { ...TUNING, gravity },
      input: () => undefined,
    }),
  );
  const damage = new DamageModel();
  const off = installEnvironmentDamage(world, {
    damage,
    tuning: rules,
    capsule: CAPSULE,
    ...(liquidDepth !== undefined && { liquidDepth }),
  });
  const hits: DamageResult[] = [];
  const impacts: CharacterImpactInfo[] = [];
  world.events.on(DamageApplied, (r) => hits.push(r));
  world.events.on(CharacterImpacted, (i) => impacts.push(i));
  const creature = (feet: Vec3, health = 100, resistances = {}): EntityId => {
    const e = spawnCharacter(world, feet);
    giveCombatant(world, e, { health, resistances });
    return e;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const land = (e: EntityId, limit = 400) => {
    for (let i = 0; i < limit; i++) {
      world.step();
      if (impacts.some((impact) => impact.entity === e)) return;
    }
    throw new Error('never landed');
  };
  return { world, physics, floor, damage, off, hits, impacts, creature, steps, land };
}

/** Feet height from which a drop from rest lands at `speed` under `gravity`. */
const dropFor = (speed: number, gravity: number) => (speed * speed) / (2 * gravity) + SKIN;

describe('fall damage (mw-e04.19, mw-e02.15)', () => {
  it('the curve: none to safeHeight, linear to all of max health at lethalHeight', () => {
    expect(fallDamageFraction(0, RULES.fall)).toBe(0);
    expect(fallDamageFraction(4, RULES.fall)).toBe(0);
    expect(fallDamageFraction(9, RULES.fall)).toBe(0.5);
    expect(fallDamageFraction(14, RULES.fall)).toBe(1);
    expect(fallDamageFraction(40, RULES.fall)).toBe(1);
  });

  it('AC-1 (e04.19): a 9 m fall costs 50% of max health, tagged environment and fall', () => {
    const s = env();
    const goblin = s.creature(v(0, 9 + SKIN, 0), 60);
    s.land(goblin);
    expect(s.impacts[0]?.height).toBeCloseTo(9, 3);
    expect(s.hits).toHaveLength(1);
    expect(s.hits[0]).toMatchObject({
      target: goblin,
      total: 30,
      amounts: { blunt: 30 },
      tags: ['environment', 'fall'],
      packet: { instigator: null, source: null, impulse: v(0, 0, 0) },
    });
    expect(healthOf(s.world, goblin)?.current).toBe(30);
  });

  it('AC-2 (e02.15): landing at 7 m/s does no damage; at 14 m/s the curve’s share (at real-world gravity)', () => {
    const s = env({ gravity: EARTH });
    const soft = s.creature(v(0, dropFor(7, EARTH), 0));
    const hard = s.creature(v(5, dropFor(14, EARTH), 0));
    s.steps(150);
    const speeds = new Map(s.impacts.map((i) => [i.entity, i.speed]));
    expect(speeds.get(soft)).toBeCloseTo(7, 2);
    expect(speeds.get(hard)).toBeCloseTo(14, 2);
    expect(s.hits.map((h) => h.target)).toEqual([hard]);
    // 14²/(2·9.81) = 9.99 m → (9.99 − 4) / 10 of 100.
    const expected = 100 * fallDamageFraction((14 * 14) / (2 * EARTH), RULES.fall);
    expect(s.hits[0]?.total).toBeCloseTo(expected, 1);
    expect(s.hits[0]?.total).toBeCloseTo(59.9, 1);
  });

  it('at the player’s 25 m/s² the same curve is safe to 14.1 m/s and lethal from 26.5 m/s', () => {
    const safe = Math.sqrt(2 * TUNING.gravity * RULES.fall.safeHeight);
    const lethal = Math.sqrt(2 * TUNING.gravity * RULES.fall.lethalHeight);
    expect(safe).toBeCloseTo(14.14, 2);
    expect(lethal).toBeCloseTo(26.46, 2);
  });

  it('AC-3 (e02.15): landing on hay (impactAbsorb 0.8) at 14 m/s takes 80% less', () => {
    const s = env({ gravity: EARTH });
    const hay = s.world.spawn();
    addProperties(s.world, hay, { impactAbsorb: 0.8 });
    bindCollider(s.world, hay, s.physics.add(box(v(9, 0, -1), v(11, 0.5, 1))));
    const onFloor = s.creature(v(0, dropFor(14, EARTH), 0));
    const onHay = s.creature(v(10, dropFor(14, EARTH) + 0.5, 0));
    s.steps(150);
    const floorHit = s.hits.find((h) => h.target === onFloor);
    const hayHit = s.hits.find((h) => h.target === onHay);
    expect(hayHit?.packet.source).toBe(hay);
    expect(floorHit?.packet.source).toBeNull();
    expect(hayHit?.total).toBeCloseTo(0.2 * (floorHit?.total ?? 0), 1);
    // Something that absorbs everything takes all of it.
    const cushion = s.world.spawn();
    addProperties(s.world, cushion, { impactAbsorb: 1 });
    bindCollider(s.world, cushion, s.physics.add(box(v(19, 0, -1), v(21, 0.5, 1))));
    const onCushion = s.creature(v(20, dropFor(14, EARTH) + 0.5, 0));
    s.land(onCushion);
    s.steps(1);
    expect(s.hits.some((h) => h.target === onCushion)).toBe(false);
  });

  it('a physics object is a surface too: landing on a straw bale lying on the floor', () => {
    const s = env({ gravity: EARTH });
    const bale = s.world.spawn();
    addProperties(s.world, bale, { weight: 30, impactAbsorb: 0.5 });
    addPhysicsObject(s.world, bale, {
      shape: { kind: 'box', halfExtents: v(1, 0.25, 1) },
      position: v(0, 0.25, 0),
    });
    const crate = s.world.spawn();
    addProperties(s.world, crate, { weight: 30 });
    addPhysicsObject(s.world, crate, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.3, 0.3) },
      position: v(5, 0.3, 5),
    });
    s.steps(30);
    const top = s.world.get(bale, PhysicsObjectComponent)?.position.y ?? 0;
    const jumper = s.creature(v(0, top + 0.25 + dropFor(14, EARTH), 0));
    s.land(jumper);
    s.steps(1);
    const hit = s.hits.find((h) => h.target === jumper);
    expect(hit?.packet.source).toBe(bale);
    expect(hit?.total).toBeCloseTo(
      0.5 * 100 * fallDamageFraction((14 * 14) / (2 * EARTH), RULES.fall),
      0,
    );
  });

  it('installEnvironmentDamage takes a surface reader', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1, physics })));
    installPhysicsObjects(world);
    world.register(CharacterController, ...DAMAGE_COMPONENTS);
    physics.add(box(v(-5, -1, -5), v(5, 0, 5)));
    world.addSystem(
      characterControllerSystem({
        collision: new RapierCollisionWorld(physics),
        tuning: TUNING,
        input: () => undefined,
      }),
    );
    const pad = world.spawn();
    addProperties(world, pad, { impactAbsorb: 1 });
    installEnvironmentDamage(world, {
      damage: new DamageModel(),
      tuning: RULES,
      capsule: CAPSULE,
      surface: () => pad,
    });
    const e = spawnCharacter(world, v(0, 20, 0));
    giveCombatant(world, e, { health: 100 });
    for (let i = 0; i < 90; i++) world.step();
    expect(healthOf(world, e)?.current).toBe(100);
  });

  it('AC-5 (e02.15): a launched player striking a wall takes damage on the same curve, blamed on the launcher', () => {
    const s = env({ gravity: EARTH });
    s.physics.add(box(v(3, 0, -5), v(4, 8, 5)));
    const player = s.creature(v(0, SKIN, 0));
    const troll = s.world.spawn();
    s.steps(2);
    applyCharacterImpulse(s.world, player, { velocity: v(12, 2, 0), source: troll, stagger: true });
    s.steps(60);
    const wall = s.impacts.find((i) => i.kind === 'wall');
    expect(wall?.speed).toBeCloseTo(12, 3);
    const hit = s.hits.find((h) => h.packet.direction?.x === -1);
    expect(hit?.packet.instigator).toBe(troll);
    expect(hit?.tags).toEqual(['environment', 'fall', 'wall']);
    expect(hit?.total).toBeCloseTo(
      100 * fallDamageFraction((12 * 12) / (2 * EARTH), RULES.fall),
      1,
    );
    expect(s.world.get(player, CharacterController)?.velocity.x).toBe(0);
  });

  it('AC-2 (e04.19): a 16 m fall into water 1.5 m deep does no damage; 1.4 m deep is lethal', () => {
    const pool: LiquidDepthReader = (_world, _entity, feet) => (feet.x < 5 ? 1.5 : 1.4);
    const s = env({ liquidDepth: pool });
    const deaths: EntityId[] = [];
    s.world.events.on(Died, (d) => deaths.push(d.target));
    const diver = s.creature(v(0, 16 + SKIN, 0));
    const unlucky = s.creature(v(10, 16 + SKIN, 0));
    s.steps(90);
    expect(s.impacts.map((i) => i.entity).sort()).toEqual([diver, unlucky]);
    expect(healthOf(s.world, diver)?.current).toBe(100);
    expect(deaths).toEqual([unlucky]);
    expect(noLiquid(s.world, diver, v(0, 0, 0))).toBe(0);
  });

  it('resolveFall ignores entities without health and gentle impacts', () => {
    const s = env();
    const ghost = spawnCharacter(s.world, v(0, 20, 0));
    const impact: CharacterImpactInfo = {
      tick: 1,
      entity: ghost,
      position: v(0, 0, 0),
      kind: 'ground',
      speed: 30,
      height: 18,
      normal: v(0, 1, 0),
      body: s.floor,
      launch: null,
    };
    const options = { damage: s.damage, fall: RULES.fall };
    expect(resolveFall(s.world, impact, options)).toBe(0);
    const goblin = s.creature(v(0, SKIN, 0));
    s.steps(1);
    expect(resolveFall(s.world, { ...impact, entity: goblin, height: 3 }, options)).toBe(0);
    expect(resolveFall(s.world, { ...impact, entity: goblin }, options)).toBe(100);
    expect(physicsSurface(s.world, s.floor)).toBeNull();
  });

  it('the uninstaller stops fall damage and blame', () => {
    const s = env();
    s.off();
    const goblin = s.creature(v(0, 20, 0));
    s.land(goblin);
    s.steps(1);
    expect(s.hits).toEqual([]);
  });
});

describe('kinetic impacts (mw-e04.19)', () => {
  function thrown(speed: number, weight = 10) {
    const s = env();
    const goblin = s.creature(v(0, SKIN, 0));
    const thrower = s.world.spawn();
    s.steps(2);
    const rock = s.world.spawn();
    addProperties(s.world, rock, { weight, pushable: true });
    addPhysicsObject(s.world, rock, {
      shape: { kind: 'sphere', radius: 0.2 },
      position: v(-1.5, 1.2, 0),
      velocity: v(speed, 1, 0),
    });
    s.steps(1);
    blame(s.world, rock, thrower);
    let touched = false;
    for (let i = 0; i < 30; i++) {
      s.steps(1);
      const [memory] = s.world.query(EnvironmentContactsComponent).ids();
      const contacts = s.world.get(memory ?? 0, EnvironmentContactsComponent)?.contacts ?? [];
      touched ||= contacts.some(([o, c]) => o === rock && c === goblin);
    }
    expect(touched).toBe(true);
    return { ...s, goblin, rock, thrower };
  }

  it('the blunt damage of a strike: ½·m·v² / 20 above 6 m/s, nothing at or below', () => {
    expect(kineticDamage(40, 10, RULES.kinetic)).toBe(100);
    expect(kineticDamage(40, 6, RULES.kinetic)).toBe(0);
    expect(kineticDamage(40, 5, RULES.kinetic)).toBe(0);
  });

  it('AC-5 (e04.19): an object moving at 5 m/s touching a creature deals no damage', () => {
    const s = thrown(5);
    expect(s.hits).toEqual([]);
  });

  it('a strike above 6 m/s deals blunt ½·m·v²/20 once per contact, with its momentum, blamed on the thrower', () => {
    const s = thrown(9);
    expect(s.hits).toHaveLength(1);
    const [hit] = s.hits;
    expect(hit?.packet).toMatchObject({
      instigator: s.thrower,
      source: s.rock,
      tags: ['crush', 'environment'],
    });
    // About 9 m/s relative: 0.5 × 10 × 81 / 20 ≈ 20.
    expect(hit?.total).toBeGreaterThan(19);
    expect(hit?.total).toBeLessThan(22);
    expect(hit?.packet.impulse.x).toBeGreaterThan(80);
    expect(hit?.packet.impactForce).toBeGreaterThan(80 * 60);
    expect(hit?.packet.direction?.x).toBeGreaterThan(0.9);
  });

  it('one falling object can strike several creatures in the same tick', () => {
    const s = env();
    const left = s.creature(v(-0.4, SKIN, 0));
    const right = s.creature(v(0.4, SKIN, 0));
    s.steps(2);
    const boulder = s.world.spawn();
    addProperties(s.world, boulder, { weight: 100 });
    addPhysicsObject(s.world, boulder, {
      shape: { kind: 'sphere', radius: 0.6 },
      position: v(0, 6, 0),
      velocity: v(0, -8, 0),
    });
    s.steps(40);
    const struck = s.hits.map((h) => h.target);
    expect(struck).toEqual([left, right]);
    expect(s.hits[0]?.tick).toBe(s.hits[1]?.tick);
    expect(s.hits[0]?.packet.instigator).toBeNull();
  });

  it('blame comes from a sourced force stimulus and lapses once the object comes to rest', () => {
    const s = env();
    const gust = s.world.spawn();
    const crate = s.world.spawn();
    addProperties(s.world, crate, { weight: 20, pushable: true });
    addPhysicsObject(s.world, crate, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.3, 0.3) },
      position: v(0, 0.3, 0),
    });
    s.steps(1);
    applyStimulus(s.world, {
      shape: { kind: 'contact', target: crate },
      element: 'force',
      intensity: 40,
      direction: v(1, 0, 0),
      source: gust,
    });
    s.steps(2);
    expect(blameOf(s.world, crate)).toBe(gust);
    // Unsourced pushes blame nobody new.
    applyStimulus(s.world, {
      shape: { kind: 'contact', target: crate },
      element: 'force',
      intensity: 10,
      direction: v(1, 0, 0),
    });
    s.steps(2);
    expect(blameOf(s.world, crate)).toBe(gust);
    for (let i = 0; i < 600 && s.world.get(crate, PhysicsObjectComponent)?.sleeping !== true; i++) {
      s.steps(1);
    }
    s.steps(2);
    expect(s.world.has(crate, BlameComponent)).toBe(false);
    expect(blameOf(s.world, crate)).toBeNull();
  });

  it('sphereTouchesCapsule measures from the capsule’s core segment', () => {
    const feet = v(0, 0, 0);
    expect(sphereTouchesCapsule(v(0.5, 1, 0), 0.15, feet, CAPSULE)).toBe(true);
    expect(sphereTouchesCapsule(v(0.6, 1, 0), 0.15, feet, CAPSULE)).toBe(false);
    expect(sphereTouchesCapsule(v(0, 2.2, 0), 0.5, feet, CAPSULE)).toBe(true);
    expect(sphereTouchesCapsule(v(0, 2.4, 0), 0.5, feet, CAPSULE)).toBe(false);
    expect(sphereTouchesCapsule(v(0, -0.5, 0), 0.5, feet, CAPSULE)).toBe(true);
  });

  it('without its contact memory the kinetic system does nothing', () => {
    const world = new World<never>({ seed: 1 }).register(EnvironmentContactsComponent);
    world.addSystem(
      kineticImpactSystem({ damage: new DamageModel(), kinetic: RULES.kinetic, capsule: CAPSULE }),
    );
    expect(() => {
      world.step();
    }).not.toThrow();
  });
});

describe('hazards (mw-e04.19)', () => {
  function fire() {
    const s = env();
    const arsonist = s.world.spawn();
    const brazier = s.world.spawn();
    addProperties(s.world, brazier, { burning: false });
    placeEntity(s.world, brazier, v(0, 0.5, 0), 0.5);
    const salamander = s.creature(v(0.8, SKIN, 0), 100, { fire: 0 });
    const goblin = s.creature(v(-0.8, SKIN, 0), 100);
    const bystander = s.creature(v(5, SKIN, 0), 100);
    s.steps(1);
    setProperty(s.world, brazier, 'burning', true, { source: arsonist });
    return { ...s, arsonist, brazier, salamander, goblin, bystander };
  }

  it('AC-4 (e04.19): a creature immune to fire standing in a fire volume takes 0 fire damage over 3 s', () => {
    const s = fire();
    s.steps(180);
    const on = (e: EntityId) => s.hits.filter((h) => h.target === e);
    expect(on(s.salamander)).toHaveLength(12);
    expect(on(s.salamander).every((h) => h.total === 0 && h.immune)).toBe(true);
    expect(healthOf(s.world, s.salamander)?.current).toBe(100);
    // Anyone else in it burns at 8 fire/s, in 250 ms pulses of 2, blamed on whoever lit it.
    expect(on(s.goblin)).toHaveLength(12);
    expect(on(s.goblin)[0]?.packet).toMatchObject({
      amounts: { fire: 2 },
      instigator: s.arsonist,
      source: s.brazier,
      tags: ['environment', 'hazard'],
    });
    expect(healthOf(s.world, s.goblin)?.current).toBe(76);
    expect(on(s.bystander)).toEqual([]);
  });

  it('a hazard switched off stops hurting and its blame lapses', () => {
    const s = fire();
    s.steps(20);
    expect(blameOf(s.world, s.brazier)).toBe(s.arsonist);
    setProperty(s.world, s.brazier, 'burning', false);
    s.steps(2);
    expect(blameOf(s.world, s.brazier)).toBeNull();
    const before = s.hits.length;
    s.steps(60);
    expect(s.hits.length).toBe(before);
  });

  it('a hazard without a placement reaches nobody; pulses last at least one tick', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1, hz: 1 }));
    world.register(CharacterController, BlameComponent, ...DAMAGE_COMPONENTS);
    installStimuli(world);
    const damage = new DamageModel();
    world.addSystem(
      hazardSystem({
        damage,
        hazards: [{ when: 'burning', perSecond: { fire: 8 }, reach: 1, pulseMs: 250 }],
        capsule: CAPSULE,
      }),
    );
    const pyre = world.spawn();
    addProperties(world, pyre, { burning: true });
    const hurt: DamageResult[] = [];
    world.events.on(DamageApplied, (r) => hurt.push(r));
    const e = spawnCharacter(world, v(0, 0, 0));
    giveCombatant(world, e, { health: 10 });
    world.step();
    world.step();
    expect(hurt).toEqual([]);
    placeEntity(world, pyre, v(0, 0.5, 0), 0.5);
    world.step();
    world.step();
    // At 1 Hz a 250 ms pulse rounds to no ticks: it lasts one tick (1 s, 8 fire).
    expect(hurt.map((h) => h.total)).toEqual([8, 8]);
  });
});

describe('flames that do not burn passers-by (mw-e03.49)', () => {
  const burned = (s: ReturnType<typeof env>, e: EntityId) => s.hits.filter((h) => h.target === e);

  const lit = () => {
    const s = env();
    s.world.register(...lightComponents);
    return s;
  };

  it('AC-1: walking under a lantern hung at 2.5 m deals no fire damage', () => {
    const s = lit();
    spawnLightSource(s.world, 'lantern', v(0, 2.5, 0));
    const walker = s.creature(v(0, SKIN, 0), 100);
    s.steps(120);
    expect(burned(s, walker)).toEqual([]);
    expect(healthOf(s.world, walker)?.current).toBe(100);
  });

  it('AC-1: a legacy lit spawn that only declares flameRadius 0 is enclosed too', () => {
    const s = env();
    const lamp = s.world.spawn();
    addProperties(s.world, lamp, { burning: true, flammable: true, flameRadius: 0 });
    placeEntity(s.world, lamp, v(0, 1, 0), 0.15);
    const walker = s.creature(v(0, SKIN, 0), 100);
    s.steps(60);
    expect(burned(s, walker)).toEqual([]);
  });

  it('AC-2: brushing past a wall torch at head height, 0.5 m away, deals no damage', () => {
    const s = lit();
    spawnLightSource(s.world, 'torch', v(0.5, 1.5, 0));
    spawnLightSource(s.world, 'torch', v(0.5, 2, 0));
    const walker = s.creature(v(0, SKIN, 0), 100);
    s.steps(120);
    expect(burned(s, walker)).toEqual([]);
  });

  it('AC-2: standing in a brazier’s flame burns, and so does walking into a torch', () => {
    const s = lit();
    spawnLightSource(s.world, 'brazier', v(0, 0.4, 0));
    spawnLightSource(s.world, 'torch', v(5, 1, 0));
    const standing = s.creature(v(0.2, SKIN, 0), 100);
    const walkedInto = s.creature(v(5.3, SKIN, 0), 100);
    s.steps(60);
    expect(burned(s, standing).length).toBeGreaterThan(0);
    expect(burned(s, walkedInto).length).toBeGreaterThan(0);
  });

  it('AC-3: a burning crate on the floor still burns a creature touching it', () => {
    const s = env();
    const crate = s.world.spawn();
    addProperties(s.world, crate, { burning: true, flammable: true });
    placeEntity(s.world, crate, v(0, 0.25, 0), 0.4);
    const touching = s.creature(v(0.9, SKIN, 0), 100);
    s.steps(60);
    expect(burned(s, touching).length).toBeGreaterThan(0);
  });
});

describe('suspended objects (mw-e04.19)', () => {
  it('letting a suspended object go blames whoever did it; a sourceless release blames nobody', () => {
    const s = env();
    const cutter = s.world.spawn();
    const lamp = s.world.spawn();
    const bell = s.world.spawn();
    addProperties(s.world, lamp, { suspended: true });
    addProperties(s.world, bell, { suspended: true });
    s.steps(1);
    setProperty(s.world, lamp, 'suspended', false, { source: cutter });
    setProperty(s.world, bell, 'suspended', false);
    s.steps(2);
    expect(blameOf(s.world, lamp)).toBe(cutter);
    expect(blameOf(s.world, bell)).toBeNull();
    setProperty(s.world, lamp, 'suspended', true, { source: cutter });
    s.steps(2);
    expect(blameOf(s.world, lamp)).toBe(cutter);
  });
});
