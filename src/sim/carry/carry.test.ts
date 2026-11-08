// Carrying world objects (mw-e02.17) on the real deterministic Rapier build: lifting by weight and
// class limit, holding at walls, dropping, placing, throwing by charge, breaking and noise, fire in
// the hands, and the slow shoulder carry of a body.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { hypot } from '../math';
import { initialCharacterState } from '../character/controller';
import { box } from '../character/greybox';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { BlameComponent } from '../combat/environment/environment';
import { type BreakableProfile } from '../breakables/components';
import { breakableBroken, type BreakableBrokenInfo } from '../breakables/events';
import { installBreakables, makeBreakable } from '../breakables/system';
import {
  actionButton,
  actionFrame,
  actionVector,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import {
  addInteractor,
  installInteraction,
  interacted,
  interactionPrompt,
} from '../interaction/system';
import type { BodyShape } from '../physics/bodies';
import { RapierCollisionWorld } from '../physics/rapier-collision-world';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
  rigidBodiesOf,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { installPlayer, PlayerLook } from '../player/player';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import { registerSceneComponents } from '../scene/loader';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { layoutScene } from '../scene/layout';
import { hashWorld } from '../snapshot';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { WorldItemComponent } from '../items/world-items';
import { addInventory } from '../inventory/inventory';
import {
  aimOf,
  CARRY_IMPACT_NOISE,
  DEFAULT_CARRY_TUNING,
  installCarry,
  objectPickedUp,
  objectReleased,
  pickUpRefused,
  REFUSAL_TEXT,
  throwArc,
  throwSpeed,
  type CarryController,
  type CarryOptions,
  type ObjectPickedUp,
  type ObjectReleased,
  type PickUpRefused,
} from './carry';
import { CarryBulkyComponent, carryRestraint, holdOf, holdsOf, holderOf } from './state';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const HZ = 60;

type Spec = Partial<Record<ButtonAction, 'press' | 'hold' | 'release'>>;

/** A frame with the given buttons pressed (edge and held), held, or released this tick. */
function frame(spec: Spec = {}): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => {
      const s = spec[action];
      return actionButton(s === 'press', s === 'press' || s === 'hold', s === 'release');
    },
  });
}
const IDLE = frame();

const POTTERY: BreakableProfile = {
  id: 'pottery',
  resistances: {},
  debris: { count: 2, size: 0.1 },
  breakLoudness: 70,
};

interface Setup {
  readonly world: World<ActionFrame>;
  readonly sim: World<never>;
  readonly physics: RapierPhysics;
  readonly carry: CarryController;
  readonly actor: EntityId;
  readonly picked: ObjectPickedUp[];
  readonly released: ObjectReleased[];
  readonly refused: PickUpRefused[];
  readonly noises: NoiseEvent[];
  readonly broken: BreakableBrokenInfo[];
}

/** A world on a stone floor (top at y = 0) with an actor at the origin facing −z. */
function setup(
  options: CarryOptions<ActionFrame> = {},
  withCollision = true,
  withBlame = true,
): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<ActionFrame>({ seed: 7, physics }))),
  );
  world.register(CharacterController, PlayerLook);
  if (withBlame) world.register(BlameComponent);
  const sim = world as unknown as World<never>;
  installPhysicsObjects(sim);
  sim.addSystem(stimulusSystem());
  installBreakables(sim);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  installInteraction(world);
  const carry = installCarry(world, {
    ...(withCollision && { collision: new RapierCollisionWorld(physics) }),
    ...options,
  });
  const actor = world.spawn();
  world.add(actor, CharacterController, initialCharacterState(v(0, 0, 0)));
  world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(sim, actor);
  const picked: ObjectPickedUp[] = [];
  const released: ObjectReleased[] = [];
  const refused: PickUpRefused[] = [];
  const noises: NoiseEvent[] = [];
  const broken: BreakableBrokenInfo[] = [];
  world.events.on(objectPickedUp, (e) => picked.push(e));
  world.events.on(objectReleased, (e) => released.push(e));
  world.events.on(pickUpRefused, (e) => refused.push(e));
  world.events.on(noiseEmitted, (e) => noises.push(e));
  world.events.on(breakableBroken, (e) => broken.push(e));
  return { world, sim, physics, carry, actor, picked, released, refused, noises, broken };
}

/** A liftable box of `weight` kg resting on the floor `d` m ahead (−z). */
function crate(
  s: Setup,
  weight: number,
  extra = {},
  half = 0.2,
  d = 1,
  shape: BodyShape = { kind: 'box', halfExtents: v(half, half, half) },
): EntityId {
  const entity = s.world.spawn();
  addProperties(s.sim, entity, { liftable: true, weight, ...extra });
  addPhysicsObject(s.sim, entity, {
    shape,
    position: v(0, half, -d),
  });
  s.world.step([IDLE]);
  return entity;
}

/** Steps until the actor holds `target` (Interact pressed once). */
function lift(s: Setup, target: EntityId): void {
  s.world.step([IDLE]);
  s.world.step([frame({ interact: 'press' })]);
  expect(s.carry.holdOf(s.actor)?.target).toBe(target);
}

const velocityOf = (s: Setup, entity: EntityId) => {
  const object = s.world.get(entity, PhysicsObjectComponent);
  if (object === undefined) throw new Error('no body');
  return rigidBodiesOf(s.sim).motionOf(object.body as never).linvel;
};
const speedOf = ({ x, y, z }: Vec3) => hypot(x, y, z);
const positionOf = (s: Setup, entity: EntityId) => {
  const at = placementOf(s.sim, entity);
  if (at === undefined) throw new Error('no placement');
  return at;
};

/** Holds Throw for `ticks` ticks and releases it. */
function throwAfter(s: Setup, ticks: number): void {
  s.world.step([frame({ throw: 'press' })]);
  for (let i = 1; i < ticks; i += 1) s.world.step([frame({ throw: 'hold' })]);
  s.world.step([frame({ throw: 'release' })]);
}

describe('carrying world objects (mw-e02.17)', () => {
  it('AC-1: a liftable 8 kg object is held on Interact with a 25 kg limit; 40 kg is unavailable "Too heavy"', () => {
    const s = setup();
    const light = crate(s, 8);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({
      target: light,
      verb: 'pick-up',
      available: true,
    });
    s.world.step([frame({ interact: 'press' })]);
    expect(s.picked).toMatchObject([{ actor: s.actor, target: light, mode: 'hand', weight: 8 }]);
    expect(holdOf(s.sim, s.actor)?.target).toBe(light);
    expect(holderOf(s.sim, light)?.actor).toBe(s.actor);

    const other = setup();
    const heavy = crate(other, 40);
    other.world.step([IDLE]);
    expect(interactionPrompt(other.sim, other.actor)).toMatchObject({
      target: heavy,
      verb: 'pick-up',
      available: false,
      reason: 'Too heavy',
    });
    other.world.step([frame({ interact: 'press' })]);
    expect(holdOf(other.sim, other.actor)).toBeUndefined();
  });

  it('AC-1: the carry limit is the actor class data, so a stronger class lifts the 40 kg object', () => {
    const s = setup({ limit: () => 50 });
    const heavy = crate(s, 40);
    lift(s, heavy);
    const weak = setup({ limit: () => 5 });
    crate(weak, 8);
    weak.world.step([IDLE]);
    expect(interactionPrompt(weak.sim, weak.actor)?.reason).toBe('Too heavy');
  });

  it('refuses a second object ("Hands full"), an object another actor holds ("Held") and a non-carryable one', () => {
    const s = setup();
    const first = crate(s, 5);
    const second = crate(s, 5, {}, 0.2, 2);
    lift(s, first);
    expect(s.carry.pickUp(s.actor, second)).toEqual({ ok: false, reason: 'hands-full' });
    const rival = s.world.spawn();
    expect(s.carry.pickUp(rival, first)).toEqual({ ok: false, reason: 'held' });
    const wall = s.world.spawn();
    expect(s.carry.pickUp(rival, wall)).toEqual({ ok: false, reason: 'not-carryable' });
    s.world.events.flush();
    expect(s.refused.map((r) => r.reason)).toEqual(['hands-full', 'held', 'not-carryable']);
    s.world.events.flush();
    expect(REFUSAL_TEXT['hands-full']).toBe('Hands full');
    // The prompt of another crate while hands are full.
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)?.reason).toBe('Hands full');
  });

  it('holds the object in front of the carrier at chest height as it moves', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.world.step([IDLE]);
    const at = positionOf(s, target);
    expect(at.x).toBeCloseTo(0, 5);
    expect(at.y).toBeCloseTo(1, 5);
    expect(at.z).toBeLessThan(-0.5);
    // The held object is not what Interact focuses.
    expect(interactionPrompt(s.sim, s.actor)?.target).not.toBe(target);
  });

  it('a held object is released when its carrier or the object is gone', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.world.destroy(target);
    s.world.step([IDLE]);
    expect(s.released.at(-1)).toMatchObject({ target, reason: 'lost' });
    expect(holdsOf(s.sim)).toEqual([]);
    const t2 = crate(s, 8);
    s.world.step([IDLE]);
    s.world.step([frame({ interact: 'press' })]);
    s.world.destroy(s.actor);
    s.world.step([IDLE]);
    expect(s.released.at(-1)).toMatchObject({ target: t2, reason: 'lost' });
  });

  it('AC-2: released after a 1.0 s charge, the object leaves at 14 m/s ± 0.1 along the aim', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.world.set(s.actor, PlayerLook, { yaw: 0.5, pitch: 0.3 });
    throwAfter(s, HZ);
    const aim = aimOf({ yaw: 0.5, pitch: 0.3 });
    const velocity = velocityOf(s, target);
    expect(speedOf(velocity)).toBeCloseTo(14, 1);
    expect(velocity.x / 14).toBeCloseTo(aim.x, 2);
    expect(velocity.y / 14).toBeCloseTo(aim.y, 2);
    expect(velocity.z / 14).toBeCloseTo(aim.z, 2);
    expect(s.released.at(-1)).toMatchObject({ reason: 'thrown', speed: 14 });
    expect(holdOf(s.sim, s.actor)).toBeUndefined();
  });

  it('AC-2: shorter charges throw slower, from 4 m/s for a tap up to 14 m/s', () => {
    expect(throwSpeed(DEFAULT_CARRY_TUNING.throw, 0)).toBe(4);
    expect(throwSpeed(DEFAULT_CARRY_TUNING.throw, 0.2)).toBe(4);
    expect(throwSpeed(DEFAULT_CARRY_TUNING.throw, 0.6)).toBeCloseTo(9);
    expect(throwSpeed(DEFAULT_CARRY_TUNING.throw, 5)).toBe(14);
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.world.step([frame({ throw: 'press' })]); // a tap inside one tick? held stays down: charging
    s.world.step([frame({ throw: 'release' })]);
    expect(s.released.at(-1)?.speed).toBeCloseTo(throwSpeed(DEFAULT_CARRY_TUNING.throw, 2 / HZ), 5);
    const tap = setup();
    const t = crate(tap, 8);
    lift(tap, t);
    const tapFrame = actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (action) =>
        action === 'throw' ? actionButton(true, false, true) : actionButton(false, false, false),
    });
    tap.world.step([tapFrame]);
    expect(tap.released.at(-1)).toMatchObject({ reason: 'thrown', speed: 4 });
  });

  it('a thrown object keeps flying as a physics object and the thrower is blamed', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    throwAfter(s, HZ);
    for (let i = 0; i < 90; i += 1) s.world.step([IDLE]);
    expect(positionOf(s, target).z).toBeLessThan(-3);
    expect(s.noises.some((n) => n.kind === CARRY_IMPACT_NOISE && n.entity === target)).toBe(true);
    const noise = s.noises.find((n) => n.kind === CARRY_IMPACT_NOISE);
    expect(noise).toMatchObject({ loudness: 60, source: s.actor });
  });

  it('AC-3: a thrown fragile object breaks above its threshold and a noise at the break loudness follows', () => {
    const s = setup();
    const pot = crate(s, 2, { material: 'clay', fragile: 15, hp: 10 });
    makeBreakable(s.sim, pot, POTTERY, { contents: [] });
    lift(s, pot);
    throwAfter(s, HZ);
    for (let i = 0; i < 120 && s.broken.length === 0; i += 1) s.world.step([IDLE]);
    expect(s.broken).toMatchObject([
      { entity: pot, cause: 'impact', by: 'collision', source: s.actor },
    ]);
    expect(s.noises.some((n) => n.loudness === POTTERY.breakLoudness && n.entity === pot)).toBe(
      true,
    );
  });

  it('a thrown burning object stays burning', () => {
    const s = setup();
    const torch = crate(s, 3, { flammable: true, burning: true, fuel: 100 });
    lift(s, torch);
    throwAfter(s, 10);
    for (let i = 0; i < 30; i += 1) s.world.step([IDLE]);
    expect(readProperty(s.sim, torch, 'burning')).toBe(true);
  });

  it('AC-4: an object burning in the hands for 2.0 s heats the carrier and is dropped', () => {
    const s = setup();
    addProperties(s.sim, s.actor, { temperature: 20 });
    const torch = crate(s, 3, { flammable: true, burning: true, fuel: 100 });
    lift(s, torch);
    for (let i = 0; i < 2 * HZ - 2; i += 1) s.world.step([IDLE]);
    expect(holdOf(s.sim, s.actor)).toBeDefined();
    expect(readProperty(s.sim, s.actor, 'temperature')).toBe(20);
    for (let i = 0; i < 3; i += 1) s.world.step([IDLE]);
    expect(holdOf(s.sim, s.actor)).toBeUndefined();
    expect(s.released.at(-1)).toMatchObject({ target: torch, reason: 'burning' });
    expect(readProperty(s.sim, s.actor, 'temperature')).toBe(20 + DEFAULT_CARRY_TUNING.burnHeat);
  });

  it('AC-4: a fire put out in the hands starts the count again', () => {
    const s = setup();
    const torch = crate(s, 3, { flammable: true, burning: true, fuel: 100 });
    lift(s, torch);
    for (let i = 0; i < 60; i += 1) s.world.step([IDLE]);
    expect(holdOf(s.sim, s.actor)?.burning).toBeGreaterThan(50);
    addProperties(s.sim, torch, { burning: false });
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(holdOf(s.sim, s.actor)?.burning).toBe(0);
  });

  it('AC-5: a held object that would clip into a wall is pushed back and stays out of the geometry', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.physics.add(box(v(-3, 0, -1.5), v(3, 3, -0.9))); // a wall whose face is 0.9 m ahead
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    const at = positionOf(s, target);
    expect(holdOf(s.sim, s.actor)).toBeDefined();
    expect(at.z - 0.2).toBeGreaterThanOrEqual(-0.9 - 0.02);
    expect(at.z).toBeGreaterThan(-0.733); // pushed back from where it rides in the open
  });

  it('AC-5: pinned flat against a wall with nowhere to go, the object is let go', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.physics.add(box(v(-3, 0, -1.5), v(3, 3, -0.5)));
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(s.released.at(-1)).toMatchObject({ target, reason: 'blocked' });
    expect(holdOf(s.sim, s.actor)).toBeUndefined();
  });

  it('without a collision world the object simply rides at its hold point', () => {
    const s = setup({}, false);
    const target = crate(s, 8);
    lift(s, target);
    s.world.step([IDLE]);
    expect(positionOf(s, target).z).toBeCloseTo(-(0.35 + hypot(0.2, 0.2) + 0.1), 5);
  });

  it('Drop lets go in front with no speed; Drop with crouch places it gently on the surface below', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    s.world.step([frame({ drop: 'press' })]);
    expect(s.released.at(-1)).toMatchObject({ target, reason: 'dropped', speed: 0 });
    for (let i = 0; i < 60; i += 1) s.world.step([IDLE]);
    expect(positionOf(s, target).y).toBeCloseTo(0.2, 1);

    const p = setup();
    const t2 = crate(p, 8);
    lift(p, t2);
    p.world.step([frame({ drop: 'press', crouch: 'hold' })]);
    expect(p.released.at(-1)).toMatchObject({ target: t2, reason: 'placed' });
    expect(positionOf(p, t2).y).toBeCloseTo(0.21, 1);
    expect(speedOf(velocityOf(p, t2))).toBeLessThan(1);
  });

  it('placing without a surface below simply lets go', () => {
    const s = setup({}, false);
    const target = crate(s, 8);
    lift(s, target);
    expect(s.carry.place(s.actor)).toBe(true);
    s.world.events.flush();
    expect(s.released.at(-1)).toMatchObject({ reason: 'placed' });
    expect(s.carry.place(s.actor)).toBe(false);
    expect(s.carry.drop(s.actor)).toBe(false);
    expect(s.carry.throwHeld(s.actor, 1)).toBe(false);
    expect(s.carry.preview(s.actor)).toBeUndefined();
  });

  it('the controller drops and throws what the actor holds', () => {
    const s = setup();
    const a = crate(s, 8);
    lift(s, a);
    expect(s.carry.drop(s.actor)).toBe(true);
    const b = crate(s, 8, {}, 0.2, 2);
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(s.carry.pickUp(s.actor, b)).toEqual({ ok: true });
    expect(s.carry.throwHeld(s.actor, 1)).toBe(true);
    s.world.events.flush();
    expect(s.released.at(-1)).toMatchObject({ reason: 'thrown', speed: 14 });
    // An actor without a view cannot throw.
    const ghost = s.world.spawn();
    expect(s.carry.throwHeld(ghost, 1)).toBe(false);
  });

  it('shows the arc of the throw being charged, ending where it lands', () => {
    const s = setup();
    const target = crate(s, 8);
    lift(s, target);
    expect(s.carry.preview(s.actor)).toBeUndefined();
    s.world.step([frame({ throw: 'press' })]);
    for (let i = 0; i < 30; i += 1) s.world.step([frame({ throw: 'hold' })]);
    const arc = s.carry.preview(s.actor);
    expect(arc?.length).toBeGreaterThan(5);
    const last = arc?.at(-1);
    expect(last?.y).toBeLessThan(0.5);
    expect(last?.z).toBeLessThan(-2);
    // Open air: the arc runs its full length.
    const open = throwArc(v(0, 5, 0), v(0, 0, -10), 9.81, undefined, { maxPoints: 5 });
    expect(open).toHaveLength(5);
    expect(throwArc(v(0, 5, 0), v(0, 0, -10), 9.81, undefined)).toHaveLength(60);
  });

  it('shoulder-carry (bulky) lifts up to its own limit, slows to 50% and forbids jumping', () => {
    const s = setup();
    const body = crate(s, 70, {}, 0.3);
    s.world.add(body, CarryBulkyComponent, { kind: 'body' });
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    s.world.step([frame({ interact: 'press' })]);
    expect(holdOf(s.sim, s.actor)).toMatchObject({
      mode: 'shoulder',
      speedScale: 0.5,
      noJump: true,
    });
    expect(carryRestraint(s.sim, s.actor)).toEqual({ scale: 0.5, noJump: true });
    // A throw press does nothing for a body; Drop puts it down.
    s.world.step([frame({ throw: 'press' })]);
    expect(holdOf(s.sim, s.actor)).toBeDefined();
    s.world.step([frame({ drop: 'press' })]);
    expect(holdOf(s.sim, s.actor)).toBeUndefined();
    // Over the shoulder limit nothing lifts it.
    const colossus = crate(s, 500, {}, 0.3, 2);
    s.world.add(colossus, CarryBulkyComponent, { kind: 'statue' });
    expect(s.carry.pickUp(s.actor, colossus)).toEqual({ ok: false, reason: 'too-heavy' });
  });

  it('world items are never carried: they go to the pack', () => {
    const s = setup();
    const item = crate(s, 1);
    s.world.add(item, WorldItemComponent, { defId: 'x', count: 1, flags: {}, by: null });
    s.world.step([IDLE]);
    expect(s.carry.pickUp(s.actor, item)).toEqual({ ok: false, reason: 'not-carryable' });
    s.world.step([IDLE]);
    s.world.step([frame({ interact: 'press' })]);
    expect(holdOf(s.sim, s.actor)).toBeUndefined();
    s.world.events.emit(interacted, {
      actor: s.actor,
      target: item,
      verb: 'pick-up',
      affordance: 0,
    });
    s.world.events.flush();
    expect(s.refused.length).toBe(1);
    addInventory(s.sim, s.actor);
  });

  it('only the carry events matter to a pick-up of something with no body', () => {
    const s = setup();
    const ghost = s.world.spawn();
    s.world.events.emit(interacted, {
      actor: s.actor,
      target: ghost,
      verb: 'pick-up',
      affordance: 0,
    });
    s.world.events.emit(interacted, { actor: s.actor, target: ghost, verb: 'open', affordance: 0 });
    s.world.events.flush();
    expect(s.refused).toEqual([]);
  });

  it('impact noise skips non-liftable objects and an unblamed impact has no source', () => {
    const s = setup();
    const rock = s.world.spawn();
    addProperties(s.sim, rock, { weight: 3 });
    addPhysicsObject(s.sim, rock, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(0, 3, -3),
    });
    for (let i = 0; i < 90; i += 1) s.world.step([IDLE]);
    expect(s.noises).toEqual([]);
    const light = crate(s, 0.5, {}, 0.1);
    s.sim.remove(light, PhysicsObjectComponent);
    s.world.step([IDLE]);
    const pebble = s.world.spawn();
    addProperties(s.sim, pebble, { liftable: true, weight: 4 });
    addPhysicsObject(s.sim, pebble, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(2, 3, -3),
    });
    for (let i = 0; i < 90; i += 1) s.world.step([IDLE]);
    expect(s.noises).toMatchObject([{ kind: CARRY_IMPACT_NOISE, loudness: 60, source: null }]);
  });

  it('carries round and capsule bodies too, held clear of the carrier', () => {
    const s = setup();
    const ball = crate(s, 5, {}, 0.2, 1, { kind: 'sphere', radius: 0.25 });
    lift(s, ball);
    s.world.step([IDLE]);
    expect(positionOf(s, ball).z).toBeLessThan(-0.6);
    s.carry.drop(s.actor);
    s.world.destroy(ball);
    const barrel = crate(s, 5, {}, 0.2, 2, { kind: 'capsule', halfHeight: 0.3, radius: 0.2 });
    s.world.step([IDLE]);
    expect(s.carry.pickUp(s.actor, barrel)).toEqual({ ok: true });
    s.world.step([IDLE]);
    expect(positionOf(s, barrel).y).toBeGreaterThan(0.9);
  });

  it('two carriers each hold their own object, and one letting go leaves the other holding', () => {
    const s = setup();
    const a = crate(s, 5);
    const b = crate(s, 5, {}, 0.2, 3);
    const other = s.world.spawn();
    s.world.add(other, CharacterController, initialCharacterState(v(5, 0, 0)));
    s.world.add(other, PlayerLook, { yaw: 0, pitch: 0 });
    expect(s.carry.pickUp(other, b)).toEqual({ ok: true });
    expect(s.carry.pickUp(s.actor, a)).toEqual({ ok: true });
    s.world.step([IDLE]);
    expect(holdsOf(s.sim).map((h) => h.actor)).toEqual([s.actor, other].sort((x, y) => x - y));
    // Both charge a throw on the same button; one letting go leaves the other holding.
    s.world.step([frame({ throw: 'press' })]);
    s.world.step([frame({ throw: 'hold' })]);
    expect(holdOf(s.sim, other)?.charge).toBe(1);
    expect(s.carry.throwHeld(s.actor, 0.5)).toBe(true);
    expect(holdOf(s.sim, other)?.target).toBe(b);
  });

  it('placing with nothing below the object lets go where it is', () => {
    const s = setup();
    const target = crate(s, 5);
    lift(s, target);
    s.world.set(s.actor, CharacterController, initialCharacterState(v(0, 50, 0)));
    s.world.step([IDLE]);
    expect(s.carry.place(s.actor)).toBe(true);
    s.world.events.flush();
    expect(s.released.at(-1)).toMatchObject({ reason: 'placed' });
    expect(positionOf(s, target).y).toBeGreaterThan(40);
  });

  it('a world item that hits something makes no carry noise (its own rules do)', () => {
    const s = setup();
    const item = crate(s, 1);
    s.world.add(item, WorldItemComponent, { defId: 'x', count: 1, flags: {}, by: null });
    s.sim.remove(item, PhysicsObjectComponent);
    const dropped = s.world.spawn();
    addProperties(s.sim, dropped, { liftable: true, weight: 1 });
    addPhysicsObject(s.sim, dropped, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(3, 3, 0),
    });
    s.world.add(dropped, WorldItemComponent, { defId: 'x', count: 1, flags: {}, by: null });
    for (let i = 0; i < 90; i += 1) s.world.step([IDLE]);
    expect(s.noises).toEqual([]);
  });

  it('impact noise falls back to the last band for heavier objects, and to silence with none', () => {
    const banded = setup({ tuning: { impactLoudness: [{ upToKg: 1, db: 30 }] } });
    const heavy = banded.world.spawn();
    addProperties(banded.sim, heavy, { liftable: true, weight: 9 });
    addPhysicsObject(banded.sim, heavy, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(3, 3, 0),
    });
    for (let i = 0; i < 90; i += 1) banded.world.step([IDLE]);
    expect(banded.noises[0]?.loudness).toBe(30);
    const mute = setup({ tuning: { impactLoudness: [] } });
    const rock = mute.world.spawn();
    addProperties(mute.sim, rock, { liftable: true, weight: 9 });
    addPhysicsObject(mute.sim, rock, {
      shape: { kind: 'box', halfExtents: v(0.1, 0.1, 0.1) },
      position: v(3, 3, 0),
    });
    for (let i = 0; i < 90; i += 1) mute.world.step([IDLE]);
    expect(mute.noises[0]?.loudness).toBe(0);
  });

  it('without blame in the world a thrown object has no thrower on record', () => {
    const s = setup({}, true, false);
    const target = crate(s, 8);
    lift(s, target);
    throwAfter(s, 20);
    for (let i = 0; i < 90; i += 1) s.world.step([IDLE]);
    expect(s.noises.find((n) => n.entity === target)?.source).toBeNull();
  });

  it('shares an already registered world-item component with the world items rules', () => {
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(
      registerWorldProperties(new World<ActionFrame>({ seed: 2, physics })),
    );
    world.register(WorldItemComponent);
    installPhysicsObjects(world as unknown as World<never>);
    installInteraction(world);
    expect(installCarry(world).tuning.holdHeight).toBe(1);
  });

  it('refuses to install without stimuli, and tuning overrides apply', () => {
    const bare = registerWorldProperties(new World<ActionFrame>({ seed: 1 }));
    expect(() => installCarry(bare)).toThrow('install stimuli');
    const s = setup({ tuning: { handLimitKg: 3 } });
    crate(s, 8);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)?.reason).toBe('Too heavy');
    expect(s.carry.tuning.handLimitKg).toBe(3);
  });

  it('is deterministic: two runs hash the same', () => {
    const run = () => {
      const s = setup();
      const t = crate(s, 8);
      lift(s, t);
      throwAfter(s, 40);
      for (let i = 0; i < 60; i += 1) s.world.step([IDLE]);
      return hashWorld(s.world);
    };
    expect(run()).toBe(run());
  });
});

describe('a carrier moves slower (mw-e02.17 AC-6)', () => {
  const LAYOUT = layoutScene(TEST_SCENE, testKit);
  const TUNING = {
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
  };

  function playerWorld() {
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(
      registerWorldProperties(
        registerSceneComponents(new World<ActionFrame>({ seed: 3, physics })),
      ),
    );
    const sim = world as unknown as World<never>;
    installPhysicsObjects(sim);
    installInteraction(world);
    const player = installPlayer(world, {
      spawns: LAYOUT.spawns,
      collision: new FakeCollisionWorld(LAYOUT.parts.flatMap((part) => part.collider ?? [])),
      tuning: TUNING,
    });
    const carry = installCarry(world);
    const feet = world.get(player, CharacterController)?.position ?? v(0, 0, 0);
    const object = world.spawn();
    addProperties(sim, object, { liftable: true, weight: 70 });
    addPhysicsObject(sim, object, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.3, 0.3) },
      position: v(feet.x, feet.y + 1, feet.z - 1),
    });
    world.step([IDLE]);
    return { world, sim, player, carry, object };
  }

  const WALK = actionFrame({
    move: actionVector(0, 1),
    look: actionVector(0, 0),
    buttons: () => actionButton(false, false, false),
  });
  const JUMP = actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (action) => actionButton(action === 'jump', action === 'jump', false),
  });
  const horizontal = (w: ReturnType<typeof playerWorld>) => {
    const velocity = w.world.get(w.player, CharacterController)?.velocity ?? v(0, 0, 0);
    return hypot(velocity.x, velocity.z);
  };
  const rise = (w: ReturnType<typeof playerWorld>) =>
    w.world.get(w.player, CharacterController)?.velocity.y ?? 0;

  it('AC-6: carrying a body, speed is 50% and jump is disabled', () => {
    const free = playerWorld();
    for (let i = 0; i < 60; i += 1) free.world.step([WALK]);
    const full = horizontal(free);
    expect(full).toBeGreaterThan(4);
    free.world.step([JUMP]);
    expect(rise(free)).toBeGreaterThan(1);

    const w = playerWorld();
    w.world.add(w.object, CarryBulkyComponent, { kind: 'body' });
    w.world.step([IDLE]);
    expect(w.carry.pickUp(w.player, w.object)).toEqual({ ok: true });
    for (let i = 0; i < 60; i += 1) w.world.step([WALK]);
    expect(horizontal(w)).toBeCloseTo(full * 0.5, 1);
    w.world.step([IDLE]);
    w.world.step([JUMP]);
    expect(rise(w)).toBeLessThanOrEqual(0.001);
  });

  it('hands carry at 85% and may still jump', () => {
    const free = playerWorld();
    for (let i = 0; i < 60; i += 1) free.world.step([WALK]);
    const full = horizontal(free);
    const w = playerWorld();
    expect(w.carry.pickUp(w.player, w.object)).toEqual({ ok: false, reason: 'too-heavy' });
    addProperties(w.sim, w.object, { weight: 10 });
    expect(w.carry.pickUp(w.player, w.object)).toEqual({ ok: true });
    for (let i = 0; i < 60; i += 1) w.world.step([WALK]);
    expect(horizontal(w)).toBeCloseTo(full * 0.85, 1);
    w.world.step([IDLE]);
    w.world.step([JUMP]);
    expect(rise(w)).toBeGreaterThan(1);
  });
});

describe('carry state', () => {
  it('reads as nothing carried where carrying is not installed', () => {
    const world = new World<never>({ seed: 1 });
    const actor = world.spawn();
    expect(holdsOf(world)).toEqual([]);
    expect(holdOf(world, actor)).toBeUndefined();
    expect(holderOf(world, actor)).toBeUndefined();
    expect(carryRestraint(world, actor)).toBeUndefined();
  });
});
