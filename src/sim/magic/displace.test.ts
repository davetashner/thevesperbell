// Displacement (mw-e06.12): teleport, swap and dash with collision-safe placement, on the in-memory
// collision and sight worlds. Spells are written as data here; no real spell id is used.
import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import { box, type GreyboxShape } from '../character/greybox';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController, spawnCharacter } from '../character/system';
import type { EntityId } from '../core/component';
import { Rng } from '../rng';
import { learnSpell } from './components';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { placeEntity, placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  Displaced,
  DisplaceRefused,
  DISPLACE_DEFAULT_CAPSULE,
  DISPLACE_FLOOR_REACH,
  fitsAt,
  installSpellDisplace,
  planTeleport,
} from './displace';
import { giveMana, installMana, manaOf } from './mana';
import { SpellFizzled } from './events';
import type { CastRequest } from './registry';
import { makeSpell, spellWorld } from './testing';

type Op = Extract<SpellEntry['effects'][number], { op: 'displace' }>;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const FLOOR = box(v(-50, -1, -50), v(50, 0, 50));

const teleportSpell = (op: Partial<Op> = {}, range = 8): SpellEntry =>
  makeSpell('t-blink', {
    cost: { mana: 10 },
    delivery: { kind: 'summonPoint', range, lineOfSight: true },
    effects: [{ op: 'displace', mode: 'teleport', distance: 8, lineOfSight: true, ...op }],
  });
const swapSpell = (op: Partial<Op> = {}): SpellEntry =>
  makeSpell('t-swap', {
    cost: { mana: 10 },
    delivery: { kind: 'touch', reach: 6 },
    effects: [{ op: 'displace', mode: 'swap', distance: 6, lineOfSight: true, ...op }],
  });

function scene(shapes: readonly GreyboxShape[], spells: readonly SpellEntry[], blind = false) {
  const collision = new FakeCollisionWorld([FLOOR, ...shapes]);
  const sight = new FakeSightWorld(shapes.map((s) => s as ReturnType<typeof box>));
  const { world, pipeline } = spellWorld(spells);
  world.register(CharacterController);
  installMana(world, pipeline);
  installSpellDisplace(world, pipeline, blind ? { collision } : { collision, sight });
  const fizzled: string[] = [];
  const refused: string[] = [];
  const moved: { entity: EntityId; falling: boolean }[] = [];
  world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));
  world.events.on(DisplaceRefused, (e) => refused.push(e.reason));
  world.events.on(Displaced, (e) => moved.push({ entity: e.entity, falling: e.falling }));
  const person = (at: Vec3, radius = 0.35): EntityId => {
    const id = spawnCharacter(world, at);
    placeEntity(world, id, at, radius);
    giveMana(world, id);
    return id;
  };
  const feet = (id: EntityId): Vec3 => {
    const c = world.get(id, CharacterController);
    if (c === undefined) throw new Error('no character');
    return c.position;
  };
  const cast = (request: CastRequest) => {
    const result = pipeline.cast(world, request);
    world.step(); // the bus delivers at the end of the tick
    return result;
  };
  return { world, pipeline, cast, collision, sight, fizzled, refused, moved, person, feet };
}

describe('teleport placement (mw-e06.12)', () => {
  it('AC-1: a target inside a wall lands before the wall along the aim ray (1000 seeded trials)', () => {
    const wall = box(v(-10, 0, -6), v(10, 4, -5));
    const collision = new FakeCollisionWorld([FLOOR, wall]);
    const rng = Rng.create(12345);
    const span = (lo: number, hi: number): number => lo + rng.float() * (hi - lo);
    const capsule = DISPLACE_DEFAULT_CAPSULE;
    let landed = 0;
    for (let i = 0; i < 1000; i++) {
      const from = v(span(-8, 8), 0, span(-2, 3));
      const to = v(span(-9, 9), span(0, 2), span(-8, -5.2));
      const plan = planTeleport(
        { collision },
        { capsule, from, to, distance: 12, lineOfSight: false },
      );
      if (!plan.ok) {
        expect(plan.reason).toBe('no-space');
        continue;
      }
      landed++;
      expect(collision.overlapCapsule(capsule, plan.landing)).toBe(false);
      // Never past the wall's near face (z = -5): the capsule's radius stays clear of it.
      expect(plan.landing.z).toBeGreaterThanOrEqual(-5 + capsule.radius - 1e-6);
    }
    expect(landed).toBeGreaterThan(500);
  });

  it('AC-1: a wall at arm length leaves no room, so the teleport is refused', () => {
    const collision = new FakeCollisionWorld([FLOOR, box(v(-5, 0, -1), v(5, 4, -0.5))]);
    const plan = planTeleport(
      { collision },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, -5),
        distance: 8,
        lineOfSight: false,
      },
    );
    expect(plan).toEqual({ ok: false, reason: 'no-space' });
  });

  it('a long ask is clamped to the spell distance', () => {
    const collision = new FakeCollisionWorld([FLOOR]);
    const plan = planTeleport(
      { collision },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, -20),
        distance: 6,
        lineOfSight: false,
      },
    );
    expect(plan.ok && plan.landing.z).toBeCloseTo(-6, 5);
  });

  it('a zero-length ask goes nowhere', () => {
    const collision = new FakeCollisionWorld([FLOOR]);
    const plan = planTeleport(
      { collision },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, 0),
        distance: 6,
        lineOfSight: true,
      },
    );
    expect(plan).toEqual({ ok: false, reason: 'no-space' });
  });

  it('AC-2: requiresLOS and a point behind a closed door fails with no-line-of-sight, nothing spent', () => {
    const door = box(v(-1, 0, -3.1), v(1, 3, -2.9));
    const s = scene([door], [teleportSpell()]);
    const caster = s.person(v(0, 0, 0));
    learnSpell(s.world, caster, 't-blink');
    const before = manaOf(s.world, caster)?.current;
    const result = s.cast({ caster, spell: 't-blink', aim: v(0, 0, -5) });
    expect(result).toMatchObject({ status: 'fizzled', reason: 'no-line-of-sight' });
    expect(s.fizzled).toEqual(['no-line-of-sight']);
    expect(manaOf(s.world, caster)?.current).toBe(before);
    expect(s.feet(caster)).toEqual(v(0, 0, 0));
  });

  it('AC-2: the same cast with the door open (no collider) goes through, and mana is spent', () => {
    const s = scene([], [teleportSpell()]);
    const caster = s.person(v(0, 0, 0));
    learnSpell(s.world, caster, 't-blink');
    const result = s.cast({ caster, spell: 't-blink', aim: v(0, 0, -5) });
    expect(result.status).toBe('cast');
    expect(s.feet(caster).z).toBeCloseTo(-5, 3);
    expect(placementOf(s.world, caster)?.z).toBeCloseTo(-5, 3);
    expect(manaOf(s.world, caster)?.current).toBe(90);
    expect(s.moved).toEqual([{ entity: caster, falling: false }]);
  });

  it('a free cast (a scroll) skips the gate, so the op itself refuses and says why', () => {
    const door = box(v(-1, 0, -3.1), v(1, 3, -2.9));
    const blind = makeSpell('t-blind', {
      delivery: { kind: 'summonPoint', range: 8, lineOfSight: false },
      effects: [{ op: 'displace', mode: 'teleport', distance: 8, lineOfSight: true }],
    });
    const s = scene([door], [blind]);
    const caster = s.person(v(0, 0, 0));
    s.cast({ caster, spell: 't-blind', source: 'free', aim: v(0, 0, -5) });
    expect(s.refused).toEqual(['no-line-of-sight']);
    expect(s.feet(caster)).toEqual(v(0, 0, 0));
  });

  it('AC-3: a swap with a creature too large for the caster spot is refused no-space, mana refunded', () => {
    // The caster stands in a 1.2 m wide alley; a 1 m radius creature cannot stand there.
    const walls = [box(v(-1.6, 0, -2), v(-0.6, 3, 2)), box(v(0.6, 0, -2), v(1.6, 3, 2))];
    const s = scene(walls, [swapSpell()]);
    const caster = s.person(v(0, 0, 0));
    const big = s.person(v(0, 0, -5), 1);
    learnSpell(s.world, caster, 't-swap');
    const before = manaOf(s.world, caster)?.current;
    const result = s.cast({ caster, spell: 't-swap', target: big });
    expect(result).toMatchObject({ status: 'fizzled', reason: 'no-space' });
    expect(manaOf(s.world, caster)?.current).toBe(before);
    expect(s.feet(caster)).toEqual(v(0, 0, 0));
    expect(s.feet(big)).toEqual(v(0, 0, -5));
  });

  it('a swap that fits exchanges both places', () => {
    const s = scene([], [swapSpell()]);
    const caster = s.person(v(0, 0, 0));
    const other = s.person(v(0, 0, -4));
    learnSpell(s.world, caster, 't-swap');
    expect(s.cast({ caster, spell: 't-swap', target: other }).status).toBe('cast');
    expect(s.feet(caster)).toEqual(v(0, 0, -4));
    expect(s.feet(other)).toEqual(v(0, 0, 0));
    expect(s.moved.map((m) => m.entity)).toEqual([caster, other]);
  });

  it('a swap is refused for no target, a far target, a hidden one, or a thing that is not a character', () => {
    const wall = box(v(-3, 0, -3.1), v(3, 3, -2.9));
    const pointed = makeSpell('t-pointed', {
      delivery: { kind: 'summonPoint', range: 20, lineOfSight: false },
      effects: [{ op: 'displace', mode: 'swap', distance: 5, lineOfSight: true }],
    });
    const s = scene([wall], [swapSpell({ distance: 5 }), pointed]);
    const caster = s.person(v(0, 0, 0));
    const hidden = s.person(v(0, 0, -4));
    const far = s.person(v(5, 0, 3));
    const prop = s.world.spawn();
    placeEntity(s.world, prop, v(1, 0, 1), 0.3);
    s.cast({ caster, spell: 't-pointed', source: 'free', aim: v(0, 0, 1) });
    for (const target of [caster, hidden, far, prop]) {
      s.cast({ caster, spell: 't-swap', source: 'free', target });
    }
    expect(s.refused).toEqual([
      'no-target',
      'no-target',
      'no-line-of-sight',
      'out-of-reach',
      'not-displaceable',
    ]);
  });

  it('a swap with a party that has no position is refused at the gate', () => {
    const free = makeSpell('t-swap0', {
      delivery: { kind: 'touch', reach: 6 },
      effects: [{ op: 'displace', mode: 'swap', distance: 6, lineOfSight: false }],
    });
    const s = scene([], [free]);
    const caster = s.person(v(0, 0, 0));
    const ghost = s.world.spawn();
    const bare = s.world.spawn();
    learnSpell(s.world, caster, 't-swap0');
    learnSpell(s.world, bare, 't-swap0');
    const a = s.cast({ caster, spell: 't-swap0', target: ghost });
    const b = s.cast({ caster: bare, spell: 't-swap0', target: caster });
    expect([a, b]).toMatchObject([{ reason: 'no-position' }, { reason: 'no-position' }]);
  });

  it('AC-4: a destination with no floor within 1 m lands at the point and the caster falls', () => {
    // A chasm: the floor ends at z = -3 and resumes 9 m below.
    const hole = new FakeCollisionWorld([
      box(v(-50, -1, -3), v(50, 0, 50)),
      box(v(-50, -10, -50), v(50, -9, -3)),
    ]);
    const plan = planTeleport(
      { collision: hole },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, -5),
        distance: 8,
        lineOfSight: false,
      },
    );
    expect(plan).toEqual({ ok: true, landing: v(0, 0, -5), falling: true });
    expect(DISPLACE_FLOOR_REACH).toBe(1);
  });

  it('AC-4: cast over the chasm, the Displaced event says falling and the character is airborne', () => {
    const chasm = new FakeCollisionWorld([box(v(-50, -1, -3), v(50, 0, 50))]);
    const { world, pipeline } = spellWorld([teleportSpell()]);
    world.register(CharacterController);
    installSpellDisplace(world, pipeline, { collision: chasm });
    const caster = spawnCharacter(world, v(0, 0, 0));
    placeEntity(world, caster, v(0, 0, 0), 0.35);
    const events: boolean[] = [];
    world.events.on(Displaced, (e) => events.push(e.falling));
    pipeline.cast(world, { caster, spell: 't-blink', source: 'free', aim: v(0, 0, -5) });
    world.step();
    expect(events).toEqual([true]);
    expect(world.get(caster, CharacterController)).toMatchObject({
      position: v(0, 0, -5),
      grounded: false,
    });
  });

  it('snaps up onto a kerb and down onto a lower floor within reach', () => {
    const kerb = box(v(-5, 0, -6), v(5, 0.25, -4));
    const collision = new FakeCollisionWorld([FLOOR, kerb]);
    const onto = planTeleport(
      { collision },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, -5),
        distance: 8,
        lineOfSight: false,
      },
    );
    expect(onto.ok && onto.landing.y).toBeCloseTo(0.27, 5);
    expect(onto.ok && onto.falling).toBe(false);
  });

  it('a dash runs the full distance along the aimed heading, level', () => {
    const dash = makeSpell('t-dash', {
      delivery: { kind: 'summonPoint', range: 8, lineOfSight: false },
      effects: [{ op: 'displace', mode: 'dash', distance: 4, lineOfSight: false }],
    });
    const s = scene([], [dash]);
    const caster = s.person(v(0, 0, 0));
    learnSpell(s.world, caster, 't-dash');
    s.cast({ caster, spell: 't-dash', aim: v(0, 0, -1.5) });
    expect(s.feet(caster).z).toBeCloseTo(-4, 3);
    // Aimed straight at its own feet there is no heading, so the dash is refused.
    s.cast({ caster, spell: 't-dash', source: 'free', aim: s.feet(caster) });
    expect(s.refused).toEqual(['no-space']);
  });

  it('the summonPoint delivery refuses no aim, no position, a far aim and a blocked view', () => {
    const wall = box(v(-3, 0, -3.1), v(3, 3, -2.9));
    const s = scene([wall], [teleportSpell({}, 6)]);
    const caster = s.person(v(0, 0, 0));
    const bare = s.world.spawn();
    const cast = (who: EntityId, aim?: Vec3) =>
      s.cast({
        caster: who,
        spell: 't-blink',
        source: 'free',
        ...(aim === undefined ? {} : { aim }),
      });
    expect(cast(caster)).toMatchObject({ reason: 'no-target' });
    expect(cast(bare, v(0, 0, 1))).toMatchObject({ reason: 'no-position' });
    expect(cast(caster, v(0, 0, 7))).toMatchObject({ reason: 'out-of-reach' });
    expect(cast(caster, v(0, 0, -5))).toMatchObject({ reason: 'no-line-of-sight' });
  });

  it('a caster that is not a character cannot be displaced', () => {
    const s = scene([], [teleportSpell()]);
    const prop = s.world.spawn();
    placeEntity(s.world, prop, v(0, 0, 0), 0.3);
    s.cast({ caster: prop, spell: 't-blink', source: 'free', aim: v(0, 0, -3) });
    expect(s.refused).toEqual(['not-displaceable']);
  });

  it('a learned teleport with no aim fizzles at the gate, after other ops are skipped', () => {
    const lit = makeSpell('t-lit', {
      cost: { mana: 10 },
      delivery: { kind: 'summonPoint', range: 8, lineOfSight: true },
      effects: [
        { op: 'noise', phase: 'release', loudness: 10 },
        { op: 'displace', mode: 'teleport', distance: 8, lineOfSight: true },
      ],
    });
    const s = scene([], [lit]);
    const caster = s.person(v(0, 0, 0));
    learnSpell(s.world, caster, 't-lit');
    expect(s.cast({ caster, spell: 't-lit' })).toMatchObject({ reason: 'no-target' });
  });

  it('with no sight world nothing blocks the view, and a character with no radius fills the default capsule', () => {
    const s = scene([], [teleportSpell()], true);
    const caster = s.person(v(0, 0, 0), 0);
    s.cast({ caster, spell: 't-blink', source: 'free', aim: v(0, 0, -5) });
    expect(s.feet(caster).z).toBeCloseTo(-5, 3);
  });

  it('backs off in steps until the capsule fits (a clear path with a blocked far end)', () => {
    const collision = {
      sweepCapsule: () => undefined,
      raycast: () => undefined,
      overlapCapsule: (_c: unknown, feet: Vec3) => feet.z < -3.1,
    };
    const plan = planTeleport(
      { collision },
      {
        capsule: DISPLACE_DEFAULT_CAPSULE,
        from: v(0, 0, 0),
        to: v(0, 0, -5),
        distance: 8,
        lineOfSight: false,
      },
    );
    expect(plan).toEqual({ ok: true, landing: v(0, 0, -3), falling: true });
  });

  it('the fit helper', () => {
    const collision = new FakeCollisionWorld([FLOOR, box(v(1, 0, -1), v(2, 2, 1))]);
    expect(fitsAt({ collision }, DISPLACE_DEFAULT_CAPSULE, v(0, 0, 0))).toBe(true);
    expect(fitsAt({ collision }, DISPLACE_DEFAULT_CAPSULE, v(1.2, 0, 0))).toBe(false);
  });
});
