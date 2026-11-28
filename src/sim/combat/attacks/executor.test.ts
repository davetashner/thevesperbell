import type { MoveTable, RuntimeAttack, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import type { AllyRule } from '../hits/system';
import { hashWorld } from '../../snapshot';
import { PlacementComponent, placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent, healthOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import { giveHurtboxes, HIT_VOLUME_COMPONENTS } from '../hits/components';
import { DodgedHit, type HitboxHitInfo } from '../hits/events';
import { invulnerabilityRule } from '../invulnerability';
import { ACTION_TIMELINE_COMPONENTS, giveActionTimeline } from '../timeline/components';
import { actionTimelineSystem, requestMove } from '../timeline/timeline';
import { StaminaComponent } from '../stamina';
import {
  ATTACK_COMPONENTS,
  AttackerComponent,
  currentAttack,
  giveAttacker,
  ProjectileComponent,
} from './components';
import {
  AttackActive,
  AttackEnded,
  AttackHit,
  AttackProjectileLaunched,
  AttackStub,
  TelegraphStarted,
  type AttackActiveInfo,
  type AttackEndInfo,
  type AttackHitInfo,
  type AttackProjectileInfo,
  type AttackStubInfo,
  type TelegraphInfo,
} from './events';
import { attackPhase, cancelAttack, canStartAttack, installAttacks, startAttack } from './executor';

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

const packet = (amounts: Record<string, number>, extra: { impulse?: Vec3 } = {}) => ({
  amounts,
  poiseDamage: 5,
  staminaDamage: 2,
  impulse: extra.impulse ?? { x: 0, y: 0, z: 0 },
  impactForce: 0,
  tags: ['test'],
});

type Frames = readonly [startup: number, active: number, recovery: number];

/** A hand-built RuntimeAttack (the sim cannot load content): a sphere 1 m ahead at chest height. */
function makeAttack(
  id: string,
  frames: Frames = [12, 4, 10],
  overrides: Partial<RuntimeAttack> = {},
  telegraphTick = 0,
): RuntimeAttack {
  const [startup, active, recovery] = frames;
  const hitbox = {
    track: 'test',
    shape: { kind: 'sphere', center: { x: 0, y: 0, z: 1 }, radius: 0.5 },
    reach: 'short',
    swing: 'thrust',
  } as const;
  return {
    id,
    kind: 'melee',
    move: {
      id: `${id}-move`,
      verb: 'attack',
      startup,
      active,
      recovery,
      totalTicks: startup + active + recovery,
      activeFrom: startup,
      recoveryFrom: startup + active,
      staminaCost: 0,
      cancelWindows: [],
      damage: packet({ slash: 10 }),
      hitbox,
      parryable: true,
      blockable: true,
      unblockable: false,
      interruptible: false,
      hyperarmor: null,
      iframes: null,
      telegraphTick,
      chainNext: null,
      charge: null,
      motion: null,
      hitStop: 'light',
      presentation: { anim: 'anim-test' },
    },
    hitbox,
    telegraph: `${id}-windup`,
    rangeMin: 0,
    rangeMax: 2,
    packets: [packet({ slash: 10 })],
    cooldownMs: 0,
    weight: 1,
    targetStances: null,
    healthMin: 0,
    healthMax: 1,
    projectile: null,
    ...overrides,
  };
}

function setup(attacks: readonly RuntimeAttack[], isAlly?: AllyRule) {
  const world = new World<never>({ seed: 5 }).register(
    ...DAMAGE_COMPONENTS,
    ...ATTACK_COMPONENTS,
    PlacementComponent,
  );
  const damage = new DamageModel();
  const off = installAttacks(world, {
    attacks: new Map(attacks.map((a) => [a.id, a])),
    damage,
    ...(isAlly !== undefined && { isAlly }),
  });
  const log = {
    telegraph: [] as TelegraphInfo[],
    active: [] as AttackActiveInfo[],
    hit: [] as AttackHitInfo[],
    ended: [] as AttackEndInfo[],
    launched: [] as AttackProjectileInfo[],
    stub: [] as AttackStubInfo[],
    applied: [] as DamageResult[],
  };
  world.events.on(TelegraphStarted, (e) => log.telegraph.push(e));
  world.events.on(AttackActive, (e) => log.active.push(e));
  world.events.on(AttackHit, (e) => log.hit.push(e));
  world.events.on(AttackEnded, (e) => log.ended.push(e));
  world.events.on(AttackProjectileLaunched, (e) => log.launched.push(e));
  world.events.on(AttackStub, (e) => log.stub.push(e));
  world.events.on(DamageApplied, (e) => log.applied.push(e));

  /** An attacker at the origin (health 100, poise 10) unless told otherwise. */
  const attacker = (at: Vec3 | null = { x: 0, y: 0, z: 0 }): EntityId => {
    const e = world.spawn();
    giveCombatant(world, e, { health: 100, poise: 10 });
    giveAttacker(world, e);
    if (at !== null) placeEntity(world, e, at, 0.4);
    return e;
  };
  /** A hurtbox of radius 0.4 at `at` with `health`. */
  const target = (at: Vec3, health = 100): EntityId => {
    const e = world.spawn();
    giveCombatant(world, e, { health });
    placeEntity(world, e, at, 0.4);
    return e;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const health = (e: EntityId) => healthOf(world, e)?.current;
  return { world, damage, off, log, attacker, target, steps, health };
}

describe('attack executor', () => {
  it('AC-1: a 12/4/10 melee attack is active exactly on attack ticks 13–16 and completes on 26', () => {
    const attack = makeAttack('strike');
    const { world, log, attacker, target, steps } = setup([attack]);
    const guard = attacker();
    target({ x: 0, y: 0, z: 1.2 });
    startAttack(world, guard, attack, FORWARD);

    const phases: (string | null)[] = [];
    for (let tick = 1; tick <= 26; tick++) {
      steps(1);
      phases.push(currentAttack(world, guard) === undefined ? 'done' : 'running');
    }
    expect(log.active.map((e) => e.attackTick)).toEqual([13, 14, 15, 16]);
    expect(log.ended).toEqual([
      { tick: 25, attacker: guard, attack: 'strike', reason: 'completed', elapsed: 26 },
    ]);
    expect(phases.indexOf('done')).toBe(25); // the 26th tick
    expect(log.active[0]?.shape).toEqual({
      kind: 'sphere',
      center: { x: 0, y: 0, z: 1 },
      radius: 0.5,
    });
    expect([12, 13, 16, 17, 26, 27].map((k) => attackPhase(attack, k))).toEqual([
      'windup',
      'active',
      'active',
      'recovery',
      'recovery',
      null,
    ]);
  });

  it('hits each target in the volume once per attack, with every packet, rotated to the aim', () => {
    const attack = makeAttack('double', [2, 3, 1], {
      packets: [packet({ slash: 10 }, { impulse: { x: 0, y: 0, z: 4 } }), packet({ fire: 3 })],
    });
    const { world, log, attacker, target, steps, health } = setup([attack]);
    const guard = attacker();
    const near = target({ x: 1.1, y: 0, z: 0 });
    const behind = target({ x: -1.1, y: 0, z: 0 });
    const dead = target({ x: 1, y: 0, z: 0.2 }, 1);
    const other = attacker({ x: 1.2, y: 0, z: 0.1 }); // also in the volume: another creature
    world.set(dead, HealthComponent, { max: 1, current: 0 });
    startAttack(world, guard, attack, { x: 2, y: 0, z: 0 });
    steps(6);

    expect(log.hit.map((h) => [h.target, h.source, h.results.length])).toEqual([
      [near, guard, 2],
      [other, guard, 2],
    ]);
    expect(health(near)).toBe(87);
    expect(health(behind)).toBe(100);
    const first = log.applied[0]?.packet;
    expect(first).toMatchObject({
      instigator: guard,
      source: guard,
      impulse: { x: 4, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      tags: ['test'],
    });
    expect(world.get(guard, AttackerComponent)?.current).toBeNull();
  });

  it('reports only the packets that resolved when the first one kills', () => {
    const attack = makeAttack('double', [1, 1, 1], {
      packets: [packet({ slash: 10 }), packet({ fire: 3 })],
    });
    const { world, log, attacker, target, steps } = setup([attack]);
    const guard = attacker();
    target({ x: 0, y: 0, z: 1 }, 5);
    startAttack(world, guard, attack, FORWARD);
    steps(3);
    expect(log.hit.map((h) => h.results.length)).toEqual([1]);
  });

  it('AC-2: a stagger during windup cancels the attack and no hitbox activates', () => {
    const attack = makeAttack('strike');
    const { world, damage, log, attacker, target, steps, health } = setup([attack]);
    const guard = attacker();
    const victim = target({ x: 0, y: 0, z: 1 });
    startAttack(world, guard, attack, FORWARD);
    steps(5);
    damage.apply(world, guard, { amounts: { blunt: 1 }, poiseDamage: 50 });
    steps(30);
    expect(log.active).toEqual([]);
    expect(log.hit).toEqual([]);
    expect(health(victim)).toBe(100);
    expect(log.ended).toEqual([
      { tick: 5, attacker: guard, attack: 'strike', reason: 'staggered', elapsed: 5 },
    ]);
  });

  it('death breaks the attack off; cancelAttack is a no-op when idle or not an attacker', () => {
    const attack = makeAttack('strike');
    const { world, damage, log, attacker, target, steps, off } = setup([attack]);
    const guard = attacker();
    const victim = target({ x: 0, y: 0, z: 5 });
    startAttack(world, guard, attack, FORWARD);
    steps(2);
    damage.apply(world, guard, { amounts: { slash: 500 } });
    steps(1);
    expect(log.ended.map((e) => e.reason)).toEqual(['died']);
    expect(cancelAttack(world, guard)).toBe(false);
    expect(cancelAttack(world, victim)).toBe(false);

    const second = attacker();
    startAttack(world, second, attack, FORWARD);
    expect(cancelAttack(world, second)).toBe(true);
    steps(1);
    expect(log.ended.map((e) => e.reason)).toEqual(['died', 'cancelled']);

    off(); // interrupts unsubscribed: a stagger no longer breaks an attack off
    startAttack(world, second, attack, FORWARD);
    damage.apply(world, second, { amounts: {}, poiseDamage: 50 });
    steps(1);
    expect(currentAttack(world, second)?.elapsed).toBe(1);
  });

  it('AC-4: windup start emits exactly one TelegraphStarted with the attacker id and cue id', () => {
    const attack = makeAttack('strike');
    const late = makeAttack('late', [12, 4, 10], {}, 4);
    const { world, log, attacker, steps } = setup([attack, late]);
    const guard = attacker();
    const other = attacker();
    startAttack(world, guard, attack, FORWARD);
    startAttack(world, other, late, FORWARD);
    steps(1);
    expect(log.telegraph).toEqual([
      {
        tick: 0,
        attacker: guard,
        attack: 'strike',
        move: 'strike-move',
        cue: 'strike-windup',
        audioCue: null,
        vfxCue: null,
        parryable: true,
        unblockable: false,
      },
    ]);
    steps(30);
    expect(log.telegraph.map((e) => [e.attacker, e.tick])).toEqual([
      [guard, 0],
      [other, 4],
    ]);
  });

  it('an attacker without a placement swings at nothing; grab and special only emit a stub', () => {
    const plain = makeAttack('plain', [1, 2, 1]);
    const grab = makeAttack('grab', [1, 3, 1], { kind: 'grab' });
    const { world, log, attacker, target, steps } = setup([plain, grab]);
    const ghost = attacker(null);
    const grabber = attacker();
    target({ x: 0, y: 0, z: 1 });
    startAttack(world, ghost, plain, FORWARD);
    startAttack(world, grabber, grab, FORWARD);
    steps(5);
    expect(log.active).toEqual([]);
    expect(log.hit).toEqual([]);
    expect(log.stub).toEqual([{ tick: 1, attacker: grabber, attack: 'grab', kind: 'grab' }]);
    expect(log.ended.length).toBe(2);
  });

  it('canStartAttack refuses busy, cooldown, range, stance and health, in that order', () => {
    const attack = makeAttack('picky', [1, 1, 1], {
      cooldownMs: 1500,
      rangeMin: 1,
      rangeMax: 3,
      targetStances: ['blocking', 'idle'],
      healthMin: 0.2,
      healthMax: 0.5,
    });
    const { world, damage, attacker, steps } = setup([attack]);
    const guard = attacker();
    const check = (distance: number, targetStance?: 'blocking' | 'moving') =>
      canStartAttack(world, guard, attack, {
        distance,
        ...(targetStance !== undefined && { targetStance }),
      });
    expect(check(0.5, 'blocking')).toEqual({ ok: false, reason: 'too-close' });
    expect(check(3.5, 'blocking')).toEqual({ ok: false, reason: 'too-far' });
    expect(check(2, 'moving')).toEqual({ ok: false, reason: 'target-stance' });
    expect(check(2)).toEqual({ ok: false, reason: 'target-stance' });
    expect(check(2, 'blocking')).toEqual({ ok: false, reason: 'health' }); // full health
    damage.apply(world, guard, { amounts: { slash: 90 } });
    expect(check(2, 'blocking')).toEqual({ ok: false, reason: 'health' }); // 10%
    world.set(guard, HealthComponent, { max: 100, current: 40 });
    expect(check(2, 'blocking')).toEqual({ ok: true });

    startAttack(world, guard, attack, FORWARD);
    expect(check(2, 'blocking')).toEqual({ ok: false, reason: 'busy' });
    expect(world.get(guard, AttackerComponent)?.readyAt).toEqual({ picky: 90 });
    steps(3);
    expect(check(2, 'blocking')).toEqual({ ok: false, reason: 'cooldown' });
    steps(87);
    expect(check(2, 'blocking')).toEqual({ ok: true });

    const healthless = world.spawn();
    giveAttacker(world, healthless);
    const any = makeAttack('any');
    expect(canStartAttack(world, healthless, any, { distance: 1 })).toEqual({ ok: true });
  });

  it('startAttack and canStartAttack throw for a non-attacker; startAttack for a busy one', () => {
    const attack = makeAttack('strike');
    const { world, attacker, target } = setup([attack]);
    const guard = attacker();
    const stranger = target({ x: 0, y: 0, z: 0 });
    expect(currentAttack(world, stranger)).toBeUndefined();
    expect(() => {
      startAttack(world, stranger, attack, FORWARD);
    }).toThrow('is not an attacker');
    expect(() => canStartAttack(world, stranger, attack, { distance: 1 })).toThrow(
      'is not an attacker',
    );
    startAttack(world, guard, attack, FORWARD);
    expect(() => {
      startAttack(world, guard, attack, FORWARD);
    }).toThrow('already attacking (strike)');
  });

  it('an attack missing from the table is a configuration error', () => {
    const { world, attacker } = setup([]);
    startAttack(world, attacker(), makeAttack('unknown'), FORWARD);
    expect(() => {
      world.step();
    }).toThrow('attack "unknown" is not in the executor\'s table');
  });

  it('is deterministic: the same fight hashes the same, and survives a snapshot mid-swing', () => {
    const attack = makeAttack('strike', [3, 2, 2]);
    const run = () => {
      const s = setup([attack]);
      const guard = s.attacker();
      s.target({ x: 0, y: 0, z: 1 });
      startAttack(s.world, guard, attack, FORWARD);
      s.steps(3);
      const snapshot = s.world.snapshot();
      s.steps(4);
      return { world: s.world, snapshot, guard };
    };
    const a = run();
    const b = run();
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    const restored = setup([attack]);
    restored.world.restore(a.snapshot);
    restored.steps(4);
    expect(hashWorld(restored.world)).toBe(hashWorld(a.world));
  });
});

describe('projectiles and hurtboxes (mw-ju8.19)', () => {
  // A chest-high bolt: 1.2 m up, so a hurtbox-less entity's feet sphere (radius 0.4) is out of reach.
  const bolt = makeAttack('bolt', [2, 2, 2], {
    kind: 'projectile',
    projectile: { speed: 60, maxRange: 5, origin: { x: 0, y: 1.2, z: 0.5 }, radius: 0.1 },
  });

  function boxedWorld() {
    const world = new World<never>({ seed: 5 }).register(
      ...DAMAGE_COMPONENTS,
      ...ATTACK_COMPONENTS,
      ...HIT_VOLUME_COMPONENTS,
      PlacementComponent,
    );
    installAttacks(world, { attacks: new Map([[bolt.id, bolt]]), damage: new DamageModel() });
    const archer = world.spawn();
    giveCombatant(world, archer, { health: 100, poise: 10 });
    giveAttacker(world, archer);
    placeEntity(world, archer, { x: 0, y: 0, z: 0 }, 0.4);
    /** A standing creature: a 1.8 m capsule hurtbox over its feet point. */
    const standing = (z: number, x = 0): EntityId => {
      const e = world.spawn();
      giveCombatant(world, e, { health: 100 });
      placeEntity(world, e, { x, y: 0, z }, 0.4);
      giveHurtboxes(world, e, {
        facing: { x: 0, y: 0, z: -1 },
        boxes: [
          {
            id: 'body',
            socket: 'root',
            region: 'torso',
            armored: false,
            multiplier: 1,
            shape: {
              kind: 'capsule',
              from: { x: 0, y: 0.4, z: 0 },
              to: { x: 0, y: 1.4, z: 0 },
              radius: 0.4,
            },
          },
        ],
      });
      return e;
    };
    return { world, archer, standing };
  }

  it('a chest-high bolt hits an entity where its hurtboxes are, not at its feet', () => {
    const { world, archer, standing } = boxedWorld();
    const knight = standing(3);
    startAttack(world, archer, bolt, FORWARD);
    for (let i = 0; i < 8; i++) world.step();
    expect(healthOf(world, knight)?.current).toBe(90);
  });

  it('flies over a hurtbox-bearing entity it misses, and still hits a bare entity by its sphere', () => {
    const { world, archer, standing } = boxedWorld();
    const aside = standing(3, 2); // off the path
    const bare = world.spawn(); // no hurtboxes: the bounding sphere around the feet point
    giveCombatant(world, bare, { health: 100 });
    placeEntity(world, bare, { x: 0, y: 1.2, z: 4 }, 0.4);
    startAttack(world, archer, bolt, FORWARD);
    for (let i = 0; i < 8; i++) world.step();
    expect(healthOf(world, aside)?.current).toBe(100);
    expect(healthOf(world, bare)?.current).toBe(90);
  });
});

describe('projectile attacks', () => {
  const bolt = makeAttack('bolt', [2, 2, 2], {
    kind: 'projectile',
    projectile: { speed: 60, maxRange: 5, origin: { x: 0, y: 0, z: 0.5 }, radius: 0.1 },
  });

  it('launches on the first active tick and hits the nearest hurtbox along its path', () => {
    const { world, log, attacker, target, steps, health } = setup([bolt]);
    const archer = attacker();
    const far = target({ x: 0, y: 0, z: 3.5 });
    const near = target({ x: 0, y: 0, z: 3.2 });
    const farther = target({ x: 0, y: 0, z: 3.6 }); // after near in id order, still behind it
    target({ x: 2, y: 0, z: 3 }); // off the path
    startAttack(world, archer, bolt, FORWARD);
    steps(3);
    expect(log.launched).toEqual([
      {
        tick: 2,
        attacker: archer,
        attack: 'bolt',
        projectile: expect.any(Number) as EntityId,
        origin: { x: 0, y: 0, z: 0.5 },
        direction: FORWARD,
      },
    ]);
    const projectile = log.launched[0]?.projectile ?? 0;
    steps(3);
    expect(log.hit.map((h) => [h.target, h.source, h.attacker])).toEqual([
      [near, projectile, archer],
    ]);
    expect(health(near)).toBe(90);
    expect([health(far), health(farther)]).toEqual([100, 100]);
    expect(world.isAlive(projectile)).toBe(false);
  });

  it('vanishes at its max range without hitting anything; needs a placed attacker to launch', () => {
    const { world, log, attacker, steps } = setup([bolt]);
    const archer = attacker();
    startAttack(world, archer, bolt, FORWARD);
    steps(4);
    const projectile = log.launched[0]?.projectile ?? 0;
    expect(world.get(projectile, ProjectileComponent)?.travelled).toBe(1);
    steps(3);
    expect(world.get(projectile, ProjectileComponent)?.travelled).toBe(4);
    steps(1);
    expect(world.isAlive(projectile)).toBe(false);
    expect(log.hit).toEqual([]);

    const ghost = attacker(null);
    startAttack(world, ghost, bolt, FORWARD);
    steps(6);
    expect(log.launched.length).toBe(1);
  });

  it('a projectile whose attack has no flight data is a configuration error', () => {
    const plain = makeAttack('plain');
    const { world } = setup([plain]);
    const e = world.spawn();
    world.add(e, ProjectileComponent, {
      attacker: e,
      attack: 'plain',
      position: { x: 0, y: 0, z: 0 },
      direction: FORWARD,
      travelled: 0,
    });
    expect(() => {
      world.step();
    }).toThrow('attack "plain" is not a projectile attack');
  });
});

// The shipped dodge roll (src/content/data/move/dodge-roll.json): i-frames on move ticks 2–14.
const ROLL: RuntimeMove = Object.freeze({
  ...makeAttack('roll').move,
  id: 'dodge-roll',
  verb: 'dodge',
  startup: 2,
  active: 13,
  recovery: 21,
  totalTicks: 36,
  activeFrom: 2,
  recoveryFrom: 15,
  damage: null,
  hitbox: null,
  iframes: { from: 2, to: 14 },
});
const MOVES: MoveTable = new Map([[ROLL.id, ROLL]]);

/** A knight that rolls on tick 0 (timeline before the executor, the shared rule), and a log. */
function rolling(attacks: readonly RuntimeAttack[], at: Vec3) {
  const world = new World<never>({ seed: 5 }).register(
    ...DAMAGE_COMPONENTS,
    ...ATTACK_COMPONENTS,
    ...ACTION_TIMELINE_COMPONENTS,
    StaminaComponent,
    PlacementComponent,
  );
  world.addSystem(actionTimelineSystem({ moves: MOVES }));
  installAttacks(world, {
    attacks: new Map(attacks.map((a) => [a.id, a])),
    damage: new DamageModel(),
    invulnerable: invulnerabilityRule(MOVES),
  });
  const log = { hit: [] as AttackHitInfo[], dodged: [] as HitboxHitInfo[] };
  world.events.on(AttackHit, (e) => log.hit.push(e));
  world.events.on(DodgedHit, (e) => log.dodged.push(e));
  const attacker = world.spawn();
  giveCombatant(world, attacker, { health: 100, poise: 10 });
  giveAttacker(world, attacker);
  placeEntity(world, attacker, { x: 0, y: 0, z: 0 }, 0.4);
  const knight = world.spawn();
  giveCombatant(world, knight, { health: 100 });
  placeEntity(world, knight, at, 0.4);
  giveActionTimeline(world, knight);
  requestMove(world, knight, 'dodge-roll');
  const until = (tick: number) => {
    while (world.tick < tick) world.step();
  };
  const health = (e: EntityId) => healthOf(world, e)?.current;
  return { world, log, attacker, knight, until, health };
}

describe('attack executor and i-frames (mw-e04.28)', () => {
  // One active tick: started on world tick s, attack tick 13 (its only active tick) runs on s + 12.
  const jab = makeAttack('jab', [12, 1, 10]);

  it('AC-1: a knight rolling on tick 0 dodges an executor melee hit landing on tick 14 (DodgedHit, no damage)', () => {
    const { world, log, attacker, knight, until, health } = rolling([jab], { x: 0, y: 0, z: 1.2 });
    until(2);
    startAttack(world, attacker, jab, FORWARD);
    until(15);
    expect(log.hit).toEqual([]);
    expect(log.dodged).toEqual([
      {
        tick: 14,
        attacker,
        hitbox: 'jab',
        activeTick: 1,
        target: knight,
        hurtbox: 'body',
        region: 'torso',
        multiplier: 1,
        armored: false,
        direction: FORWARD,
      },
    ]);
    expect(health(knight)).toBe(100);
  });

  it('AC-1: landing on tick 15, the first tick after the i-frames, the hit applies', () => {
    const { world, log, attacker, knight, until, health } = rolling([jab], { x: 0, y: 0, z: 1.2 });
    until(3);
    startAttack(world, attacker, jab, FORWARD);
    until(16);
    expect(log.dodged).toEqual([]);
    expect(log.hit.map((h) => [h.tick, h.target])).toEqual([[15, knight]]);
    expect(health(knight)).toBe(90);
  });

  it('a melee swing dodged once cannot catch the knight later in its window', () => {
    const long = makeAttack('sweep', [10, 6, 4]);
    const { world, log, attacker, knight, until, health } = rolling([long], { x: 0, y: 0, z: 1.2 });
    until(3);
    startAttack(world, attacker, long, FORWARD); // active on ticks 13–18; i-frames end after 14
    until(20);
    expect(log.dodged.map((h) => [h.tick, h.activeTick])).toEqual([[13, 1]]);
    expect(log.hit).toEqual([]);
    expect(health(knight)).toBe(100);
  });

  const bolt = makeAttack('bolt', [2, 2, 2], {
    kind: 'projectile',
    projectile: { speed: 60, maxRange: 5, origin: { x: 0, y: 0, z: 0.5 }, radius: 0.1 },
  });

  it('AC-2: a projectile reaching a knight during its i-frames is DodgedHit and flies on as a miss', () => {
    const { world, log, attacker, knight, until, health } = rolling([bolt], { x: 0, y: 0, z: 3.2 });
    const behind = world.spawn();
    giveCombatant(world, behind, { health: 100 });
    placeEntity(world, behind, { x: 0, y: 0, z: 4.3 }, 0.4);
    startAttack(world, attacker, bolt, FORWARD);
    until(12);
    // Launched on tick 2; it overlaps the knight on two sweeps but is dodged once, on tick 5.
    expect(log.dodged.map((h) => [h.tick, h.target, h.hitbox])).toEqual([[5, knight, 'bolt']]);
    expect(health(knight)).toBe(100);
    expect(log.hit.map((h) => [h.tick, h.target])).toEqual([[6, behind]]);
    expect(health(behind)).toBe(90);
  });

  it('AC-2: with nobody behind, the dodged projectile flies to its max range and vanishes', () => {
    const { world, log, attacker, knight, until, health } = rolling([bolt], { x: 0, y: 0, z: 3.2 });
    startAttack(world, attacker, bolt, FORWARD);
    until(6);
    const projectile = world.query(ProjectileComponent).ids()[0] ?? expect.fail('no projectile');
    expect(world.get(projectile, ProjectileComponent)?.dodged).toEqual([knight]);
    until(12);
    expect(world.isAlive(projectile)).toBe(false);
    expect(log.dodged).toHaveLength(1);
    expect(log.hit).toEqual([]);
    expect(health(knight)).toBe(100);
  });

  it('a projectile flies through two rolling knights, dodged once by each', () => {
    const { world, log, attacker, knight, until } = rolling([bolt], { x: 0, y: 0, z: 3.2 });
    const nearer = world.spawn();
    giveCombatant(world, nearer, { health: 100 });
    placeEntity(world, nearer, { x: 0, y: 0, z: 2.2 }, 0.4);
    giveActionTimeline(world, nearer);
    requestMove(world, nearer, 'dodge-roll');
    startAttack(world, attacker, bolt, FORWARD);
    until(6);
    expect(log.dodged.map((h) => [h.tick, h.target])).toEqual([
      [4, nearer],
      [5, knight],
    ]);
    const projectile = world.query(ProjectileComponent).ids()[0] ?? expect.fail('no projectile');
    expect(world.get(projectile, ProjectileComponent)?.dodged).toEqual([knight, nearer]);
  });
});

describe('allies are passed through (mw-qfx)', () => {
  const bolt = makeAttack('ally-bolt', [2, 2, 2], {
    kind: 'projectile',
    projectile: { speed: 60, maxRange: 5, origin: { x: 0, y: 0, z: 0.5 }, radius: 0.1 },
  });

  it('AC-3: a melee swing through an ally hurts only the stranger beside it', () => {
    const ally = new Set<EntityId>();
    const { world, attacker, target, steps, health } = setup(
      [makeAttack('ally-strike')],
      (_w, a, t) => ally.has(a) && ally.has(t),
    );
    const brute = attacker();
    const friend = target({ x: 0, y: 0, z: 1 });
    const stranger = target({ x: 0.2, y: 0, z: 1 });
    ally.add(brute).add(friend);
    startAttack(world, brute, makeAttack('ally-strike'), FORWARD);
    steps(20);
    expect(health(friend)).toBe(100);
    expect(health(stranger)).toBeLessThan(100);
  });

  it('AC-4: a projectile flies through an ally and hits the stranger behind it', () => {
    const ally = new Set<EntityId>();
    const { world, attacker, target, steps, health } = setup(
      [bolt],
      (_w, a, t) => ally.has(a) && ally.has(t),
    );
    const archer = attacker();
    const friend = target({ x: 0, y: 0, z: 2 });
    const stranger = target({ x: 0, y: 0, z: 3.5 });
    ally.add(archer).add(friend);
    startAttack(world, archer, bolt, FORWARD);
    steps(8);
    expect(health(friend)).toBe(100);
    expect(health(stranger)).toBe(90);
  });
});
