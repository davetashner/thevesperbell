// Pushing and pulling heavy objects (mw-e02.18) on the real deterministic Rapier build.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { box } from '../character/greybox';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController } from '../character/system';
import { PoiseBroken } from '../combat/damage/events';
import { HitReaction } from '../combat/reactions/events';
import { ActionStarted } from '../combat/timeline/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  actionButton,
  actionFrame,
  actionVector,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import {
  addInteractable,
  addInteractor,
  installInteraction,
  interactionPrompt,
} from '../interaction/system';
import { installCarry } from '../carry/carry';
import { cos, hypot, sin } from '../math';
import type { BodyShape } from '../physics/bodies';
import { RapierCollisionWorld } from '../physics/rapier-collision-world';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { installPlayer, PlayerLook } from '../player/player';
import { addProperties, registerWorldProperties } from '../properties/components';
import { registerSceneComponents } from '../scene/loader';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { layoutScene } from '../scene/layout';
import { areaTransition } from '../scene/transitions';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  addPushConfig,
  DEFAULT_ACTOR_SPEED,
  DEFAULT_PUSH_STRENGTH,
  installPush,
  PUSH_BASE_SPEED,
  PUSH_LOAD_FACTOR,
  PUSH_REACH,
  pushSpeed,
  settlePushes,
  type PushController,
  type PushOptions,
} from './push';
import {
  grabOf,
  grabberOf,
  grabsOf,
  pushGrabbed,
  pushReleased,
  pushRestraint,
  rotationChanged,
  PushConfigComponent,
  type PushGrabbed,
  type PushReleased,
  type RotationChanged,
} from './state';

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

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const HZ = 60;

type Spec = Partial<Record<ButtonAction, 'press' | 'hold' | 'release'>>;

/** A frame with the stick at (x, y) and the given buttons. */
function frame(spec: Spec = {}, x = 0, y = 0): ActionFrame {
  return actionFrame({
    move: actionVector(x, y),
    look: actionVector(0, 0),
    buttons: (action) => {
      const s = spec[action];
      return actionButton(s === 'press', s === 'press' || s === 'hold', s === 'release');
    },
  });
}
const IDLE = frame();
const TAP = frame({ interact: 'press' });
const FORWARD = frame({}, 0, 1);
const BACK = frame({}, 0, -1);

interface Setup {
  readonly world: World<ActionFrame>;
  readonly sim: World<never>;
  readonly physics: RapierPhysics;
  readonly push: PushController;
  readonly actor: EntityId;
  readonly grabbed: PushGrabbed[];
  readonly released: PushReleased[];
  readonly rotated: RotationChanged[];
}

/** A world on a stone floor (top at y = 0) with an actor standing still at the origin facing −z. */
function setup(options: PushOptions<ActionFrame> = {}): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<ActionFrame>({ seed: 7, physics }))),
  );
  world.register(CharacterController, PlayerLook);
  const sim = world as unknown as World<never>;
  installPhysicsObjects(sim);
  sim.addSystem(stimulusSystem());
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  installInteraction(world);
  const push = installPush(world, { collision: new RapierCollisionWorld(physics), ...options });
  const actor = world.spawn();
  world.add(actor, CharacterController, initialCharacterState(v(0, 0, 0)));
  world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(sim, actor);
  const grabbed: PushGrabbed[] = [];
  const released: PushReleased[] = [];
  const rotated: RotationChanged[] = [];
  world.events.on(pushGrabbed, (e) => grabbed.push(e));
  world.events.on(pushReleased, (e) => released.push(e));
  world.events.on(rotationChanged, (e) => rotated.push(e));
  return { world, sim, physics, push, actor, grabbed, released, rotated };
}

/** A pushable box of `weight` kg on the floor `d` m ahead (−z). */
function crate(
  s: Setup,
  weight: number,
  extra: Record<string, unknown> = {},
  d = 1,
  half = 0.2,
  at?: Vec3,
  shape: BodyShape = { kind: 'box', halfExtents: v(half, half, half) },
): EntityId {
  const entity = s.world.spawn();
  addProperties(s.sim, entity, { pushable: true, weight, ...extra });
  addPhysicsObject(s.sim, entity, { shape, position: at ?? v(0, half, -d) });
  s.world.step([IDLE]);
  return entity;
}

const positionOf = (s: Setup, entity: EntityId) => {
  const at = placementOf(s.sim, entity);
  if (at === undefined) throw new Error('no placement');
  return at;
};

function grab(s: Setup, target: EntityId): void {
  s.world.step([IDLE]);
  s.world.step([TAP]);
  expect(grabOf(s.sim, s.actor)?.target).toBe(target);
}

function steps(s: Setup, count: number, input: ActionFrame = IDLE): void {
  for (let i = 0; i < count; i += 1) s.world.step([input]);
}

/** Total slide after release at `from` until the object has stopped, metres. */
function slideFrom(s: Setup, entity: EntityId): number {
  const start = positionOf(s, entity);
  steps(s, 2 * HZ);
  const end = positionOf(s, entity);
  return hypot(end.x - start.x, end.z - start.z);
}

describe('pushing speed (mw-e02.18)', () => {
  it('AC-1: a 120 kg crate on stone with strength 150 moves at base × clamp(strength / (weight × friction)) within 1%', () => {
    const s = setup({ strength: () => 150 });
    const target = crate(s, 120);
    grab(s, target);
    const before = positionOf(s, target);
    steps(s, 30, FORWARD);
    const after = positionOf(s, target);
    const measured = (before.z - after.z) / (30 / HZ);
    const expected = PUSH_BASE_SPEED * Math.min(1, 150 / (120 * 0.6 * PUSH_LOAD_FACTOR));
    expect(expected).toBeGreaterThan(0.4);
    expect(expected).toBeLessThan(0.7);
    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
    expect(pushSpeed({ strength: 150, weight: 120, friction: 0.6 })).toBeCloseTo(expected, 12);
    expect(s.grabbed[0]).toMatchObject({ target, weight: 120 });
    expect(s.grabbed[0]?.speed).toBeCloseTo(expected, 12);
  });

  it('is capped at the base speed, and a weightless object is not resisted', () => {
    expect(pushSpeed({ strength: 1e6, weight: 1, friction: 0.6 })).toBe(PUSH_BASE_SPEED);
    expect(pushSpeed({ strength: 10, weight: 0, friction: 0.6 })).toBe(PUSH_BASE_SPEED);
    expect(pushSpeed({ strength: 0, weight: 10, friction: 0.6 })).toBe(0);
  });

  it('AC-2: the same crate on a frozen surface is faster and slides 1.0 ± 0.2 m after release', () => {
    const stone = setup({ strength: () => 150 });
    const heavy = crate(stone, 120);
    grab(stone, heavy);
    const from = positionOf(stone, heavy);
    steps(stone, 30, FORWARD);
    const stoneSpeed = (from.z - positionOf(stone, heavy).z) / (30 / HZ);

    const ice = setup({ strength: () => 150 });
    const slick = crate(ice, 120, { friction: 0.05 });
    grab(ice, slick);
    const start = positionOf(ice, slick);
    steps(ice, 30, FORWARD);
    const iceSpeed = (start.z - positionOf(ice, slick).z) / (30 / HZ);
    expect(iceSpeed).toBeGreaterThan(stoneSpeed);
    steps(ice, 30, FORWARD);
    ice.world.step([TAP]);
    expect(grabOf(ice.sim, ice.actor)).toBeUndefined();
    const slide = slideFrom(ice, slick);
    expect(Math.abs(slide - 1)).toBeLessThanOrEqual(0.2);
    // On stone the crate stops where it is let go.
    stone.world.step([TAP]);
    expect(slideFrom(stone, heavy)).toBeLessThan(0.05);
  });

  it('a surface the scene names sets the friction, not the crate', () => {
    const s = setup({ strength: () => 150, surface: () => 0.05 });
    const target = crate(s, 120);
    grab(s, target);
    expect(s.grabbed[0]?.speed).toBe(PUSH_BASE_SPEED);
  });

  it('pulls as well as pushes: backing away drags the crate towards the actor', () => {
    const s = setup();
    const target = crate(s, 20);
    grab(s, target);
    const before = positionOf(s, target);
    steps(s, 30, BACK);
    expect(positionOf(s, target).z).toBeGreaterThan(before.z + 0.2);
  });

  it('follows the stick relative to the look yaw', () => {
    const s = setup();
    const target = crate(s, 20);
    grab(s, target);
    s.world.set(s.actor, PlayerLook, { yaw: Math.PI / 2, pitch: 0 });
    const before = positionOf(s, target);
    steps(s, 20, FORWARD);
    const after = positionOf(s, target);
    expect(before.x - after.x).toBeGreaterThan(0.1);
    expect(Math.abs(after.z - before.z)).toBeLessThan(0.01);
  });
});

describe('grab and release (mw-e02.18)', () => {
  it('a pushable is grabbed and released with Interact; the prompt is the push verb', () => {
    const s = setup();
    const target = crate(s, 20);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({
      target,
      verb: 'push',
      available: true,
    });
    s.world.step([TAP]);
    expect(grabberOf(s.sim, target)?.actor).toBe(s.actor);
    expect(grabsOf(s.sim)).toHaveLength(1);
    s.world.step([TAP]);
    expect(grabOf(s.sim, s.actor)).toBeUndefined();
    s.world.events.flush();
    expect(s.released.map((r) => r.reason)).toEqual(['released']);
  });

  it('refuses what is not pushable, a second grab, a held object and one too heavy', () => {
    const s = setup();
    const first = crate(s, 20);
    const second = crate(s, 20, {}, 2);
    const wall = s.world.spawn();
    expect(s.push.grab(s.actor, wall)).toEqual({ ok: false, reason: 'not-pushable' });
    expect(s.push.grab(s.actor, first)).toEqual({ ok: true });
    expect(s.push.grab(s.actor, second)).toEqual({ ok: false, reason: 'hands-full' });
    const rival = s.world.spawn();
    expect(s.push.grab(rival, first)).toEqual({ ok: false, reason: 'held' });
    expect(s.push.release(s.actor)).toBe(true);
    expect(s.push.release(s.actor)).toBe(false);
    const huge = crate(s, 100_000, {}, 3);
    expect(s.push.grab(s.actor, huge)).toEqual({ ok: false, reason: 'too-heavy' });
    s.world.step([IDLE]);
    expect(s.push.grabOf(s.actor)).toBeUndefined();
  });

  it('shows the refusal in the prompt while another has it, and takes the carry hands', () => {
    const s = setup();
    const heavy = crate(s, 100_000);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({
      verb: 'push',
      available: false,
      reason: 'Too heavy',
    });
    const light = crate(s, 20, { liftable: true }, 2);
    s.world.step([IDLE]);
    s.push.grab(s.actor, light);
    s.world.step([IDLE]);
    expect(s.push.grabOf(s.actor)?.target).toBe(light);
    expect(heavy).not.toBe(light);
  });

  it('a carrier cannot grab, and a grabber cannot pick up (hands full)', () => {
    const s = setup();
    installCarry(s.world, { collision: new RapierCollisionWorld(s.physics) });
    const bottle = crate(s, 5, { liftable: true });
    const target = crate(s, 20, {}, 2);
    expect(s.push.grab(s.actor, target)).toEqual({ ok: true });
    s.world.step([IDLE]);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({
      target: bottle,
      verb: 'pick-up',
      available: false,
      reason: 'Hands full',
    });
    s.push.release(s.actor);
    const carried = setup();
    const carry = installCarry(carried.world, {
      collision: new RapierCollisionWorld(carried.physics),
    });
    const both = crate(carried, 5, { liftable: true });
    carried.world.step([IDLE]);
    expect(carry.pickUp(carried.actor, both)).toEqual({ ok: true });
    expect(carried.push.grab(carried.actor, both)).toEqual({ ok: false, reason: 'hands-full' });
  });

  it('lets go when the pusher is staggered, knocked back, leaves the scene or is lost', () => {
    for (const trigger of ['poise', 'stagger', 'exit', 'far', 'gone'] as const) {
      const s = setup();
      const target = crate(s, 20);
      grab(s, target);
      if (trigger === 'poise') {
        s.world.events.emit(PoiseBroken, { target: s.actor } as never);
      } else if (trigger === 'stagger') {
        s.world.events.emit(HitReaction, { entity: s.actor, reaction: 'knockdown' } as never);
      } else if (trigger === 'exit') {
        s.world.events.emit(areaTransition, { entity: s.actor } as never);
      } else if (trigger === 'far') {
        s.world.add(s.world.spawn(), PlayerLook, { yaw: 0, pitch: 0 });
        s.world.set(s.actor, CharacterController, initialCharacterState(v(0, 0, PUSH_REACH + 2)));
      } else {
        s.world.destroy(target);
      }
      s.world.events.flush();
      s.world.step([IDLE]);
      expect(grabOf(s.sim, s.actor)).toBeUndefined();
      const expected = {
        poise: 'staggered',
        stagger: 'staggered',
        exit: 'exit',
        far: 'far',
        gone: 'lost',
      };
      s.world.events.flush();
      expect(s.released.at(-1)?.reason).toBe(expected[trigger]);
    }
    // A light hit reaction does not.
    const s = setup();
    const target = crate(s, 20);
    grab(s, target);
    s.world.events.emit(HitReaction, { entity: s.actor, reaction: 'flinch' } as never);
    s.world.events.flush();
    expect(grabOf(s.sim, s.actor)?.target).toBe(target);
  });

  it('lets go when the pusher starts a move, so a kick never hits what it holds (mw-e04.18)', () => {
    const s = setup();
    const target = crate(s, 20);
    grab(s, target);
    // Someone else's move changes nothing.
    s.world.events.emit(ActionStarted, { entity: s.world.spawn(), move: 'kick' } as never);
    s.world.events.flush();
    expect(grabOf(s.sim, s.actor)?.target).toBe(target);
    s.world.events.emit(ActionStarted, { entity: s.actor, move: 'kick' } as never);
    s.world.events.flush();
    expect(grabOf(s.sim, s.actor)).toBeUndefined();
    expect(s.released.at(-1)).toMatchObject({ actor: s.actor, target, reason: 'acted' });
  });

  it('a save lets go of everything and completes a grid glide', () => {
    const s = setup();
    const statue = crate(s, 20, {}, 1);
    addPushConfig(s.sim, statue, { grid: 1 });
    grab(s, statue);
    steps(s, 10, FORWARD);
    s.push.release(s.actor);
    s.world.step([IDLE]);
    const free = crate(s, 20, {}, 2, 0.2, v(2, 0.2, -2));
    s.push.grab(s.actor, free);
    settlePushes(s.sim);
    expect(grabsOf(s.sim)).toHaveLength(0);
    expect(positionOf(s, statue).z).toBeCloseTo(-2, 6);
    s.world.step([IDLE]);
    expect(positionOf(s, statue).z).toBeCloseTo(-2, 6);
    // Where pushing is not installed it does nothing.
    settlePushes(new World<never>({ seed: 1 }));
  });
});

describe('constrained pushables (mw-e02.18)', () => {
  it('AC-3: a released grid-snapped statue completes to the next cell centre', () => {
    const s = setup();
    const statue = crate(s, 50, {}, 1, 0.4, v(0, 0.4, -1));
    addPushConfig(s.sim, statue, { grid: 1 });
    grab(s, statue);
    steps(s, 20, FORWARD);
    const mid = positionOf(s, statue);
    expect(mid.z).toBeLessThan(-1.1);
    expect(mid.z).toBeGreaterThan(-1.9);
    s.world.step([TAP]);
    steps(s, 90);
    const end = positionOf(s, statue);
    expect(end.z).toBeCloseTo(-2, 6);
    expect(end.x).toBeCloseTo(0, 6);
    // Pulled back mid-cell it completes to the cell behind it.
    const back = setup();
    const other = crate(back, 50, {}, 1, 0.4, v(0, 0.4, -1.5));
    addPushConfig(back.sim, other, { grid: 1 });
    grab(back, other);
    steps(back, 10, BACK);
    back.world.step([TAP]);
    steps(back, 90);
    expect(positionOf(back, other).z).toBeCloseTo(-1, 6);
    // Released without ever having moved it, it settles on the nearest centre.
    const still = setup();
    const resting = crate(still, 50, {}, 1, 0.4, v(0.2, 0.4, -1));
    addPushConfig(still.sim, resting, { grid: 1 });
    grab(still, resting);
    still.world.step([TAP]);
    steps(still, 90);
    expect(positionOf(still, resting).x).toBeCloseTo(0, 6);
  });

  it('a grid statue moves along one cardinal axis at a time', () => {
    const s = setup();
    const statue = crate(s, 50, {}, 1, 0.4);
    addPushConfig(s.sim, statue, { grid: 1 });
    grab(s, statue);
    // Mostly right, a little forward: it goes right only.
    steps(s, 20, frame({}, 1, 0.3));
    const at = positionOf(s, statue);
    expect(at.x).toBeGreaterThan(0.1);
    expect(at.z).toBeCloseTo(-1, 3);
    // Released facing the other way along z.
    s.world.step([TAP]);
    steps(s, 90);
    expect(positionOf(s, statue).x).toBeCloseTo(1, 6);
    // Then grabbed again and pushed along z.
    s.push.grab(s.actor, statue);
    steps(s, 20, frame({}, 0.3, 1));
    expect(positionOf(s, statue).z).toBeLessThan(-1.1);
  });

  it('a rail keeps the object on its axis and ignores a push across it', () => {
    const s = setup();
    const cart = crate(s, 20);
    addPushConfig(s.sim, cart, { axis: [1, 0] });
    grab(s, cart);
    steps(s, 20, FORWARD);
    const across = positionOf(s, cart);
    expect(Math.abs(across.x)).toBeLessThan(1e-6);
    expect(across.z).toBeCloseTo(-1, 3);
    steps(s, 30, frame({}, 1, 1));
    const along = positionOf(s, cart);
    expect(along.x).toBeGreaterThan(0.1);
    expect(along.z).toBeCloseTo(-1, 3);
    steps(s, 30, frame({}, -1, 0));
    expect(positionOf(s, cart).x).toBeLessThan(along.x - 0.1);
  });

  it('validates a config', () => {
    const s = setup();
    const target = crate(s, 20);
    expect(() => {
      addPushConfig(s.sim, target, { axis: [1, 1] });
    }).toThrow(RangeError);
    expect(() => {
      addPushConfig(s.sim, target, { grid: -1 });
    }).toThrow(RangeError);
    expect(() => {
      addPushConfig(s.sim, target, { rotateStep: 200 });
    }).toThrow(RangeError);
    expect(() => {
      addPushConfig(s.sim, target, { rotateStep: Number.NaN });
    }).toThrow(RangeError);
    addPushConfig(s.sim, target);
    expect(s.world.get(target, PushConfigComponent)).toEqual({
      axis: null,
      grid: 0,
      rotateStep: 0,
      angle: 0,
    });
    // Works in a world that never installed pushing (the component is registered on demand).
    const bare = new World<never>({ seed: 2 });
    const entity = bare.spawn();
    addPushConfig(bare, entity, { rotateStep: 15 });
    expect(bare.get(entity, PushConfigComponent)?.rotateStep).toBe(15);
  });
});

describe('blocked pushes (mw-e02.18)', () => {
  it('AC-4: a crate against a wall does not move, no penetration, and the pusher stays put', () => {
    const LAYOUT = layoutScene(TEST_SCENE, testKit);
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
    world.set(player, PlayerLook, { yaw: 0, pitch: 0 });
    const feet = world.get(player, CharacterController)?.position ?? v(0, 0, 0);
    physics.add(box(v(feet.x - 20, feet.y - 1, feet.z - 20), v(feet.x + 20, feet.y, feet.z + 20)));
    // A wall a hand's width beyond the crate.
    const wallFace = feet.z - 1.7;
    physics.add(box(v(feet.x - 5, feet.y, wallFace - 1), v(feet.x + 5, feet.y + 3, wallFace)));
    const push = installPush(world, { collision: new RapierCollisionWorld(physics) });
    const target = world.spawn();
    addProperties(sim, target, { pushable: true, weight: 20 });
    addPhysicsObject(sim, target, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.3, 0.3) },
      position: v(feet.x, feet.y + 0.3, feet.z - 1),
    });
    world.step([IDLE]);
    world.step([IDLE]);
    expect(push.grab(player, target)).toEqual({ ok: true });
    expect(grabOf(sim, player)?.target).toBe(target);
    const crateStart = placementOf(sim, target);
    for (let i = 0; i < 180; i += 1) world.step([FORWARD]);
    const crateEnd = placementOf(sim, target);
    // It slid up to the wall, and no further.
    expect(crateEnd?.z).toBeGreaterThan(wallFace + 0.3 - 0.001);
    expect(crateEnd?.z).toBeLessThanOrEqual((crateStart?.z ?? 0) + 1e-9);
    const standing = world.get(player, CharacterController)?.position ?? v(0, 0, 0);
    // Now fully blocked: a further second moves neither the player nor the crate.
    for (let i = 0; i < 60; i += 1) world.step([FORWARD]);
    const blockedCrate = placementOf(sim, target);
    const blockedPlayer = world.get(player, CharacterController)?.position ?? v(0, 0, 0);
    expect(blockedCrate?.z).toBe(crateEnd?.z);
    expect(blockedPlayer.z).toBeCloseTo(standing.z, 3);
    expect(blockedPlayer.x).toBeCloseTo(standing.x, 3);
    expect(pushRestraint(sim, player, { x: 0, y: 1 })).toEqual({ scale: 0, noJump: true });
  });

  it('AC-4: a crate against another object does not move it past, and neither penetrates', () => {
    const s = setup();
    const near = crate(s, 20);
    const far = crate(s, 100_000, {}, 1.5);
    grab(s, near);
    steps(s, 120, FORWARD);
    const a = positionOf(s, near);
    const b = positionOf(s, far);
    expect(a.z - b.z).toBeGreaterThanOrEqual(0.4 - 1e-3);
    const resting = a.z;
    steps(s, 60, FORWARD);
    expect(positionOf(s, near).z).toBe(resting);
    expect(pushRestraint(s.sim, s.actor, { x: 0, y: 1 })?.scale).toBe(0);
  });

  it('a gliding crate stops at an obstacle', () => {
    const s = setup();
    const slick = crate(s, 10, { friction: 0.05 });
    const wall = crate(s, 100_000, {}, 2.2);
    grab(s, slick);
    steps(s, 30, FORWARD);
    s.world.step([TAP]);
    steps(s, 120);
    expect(positionOf(s, slick).z - positionOf(s, wall).z).toBeGreaterThanOrEqual(0.4 - 1e-3);
  });

  it('a grid statue that glides into an obstacle stops there', () => {
    const s = setup();
    const statue = crate(s, 20, {}, 1, 0.4, v(0, 0.4, -1));
    addPushConfig(s.sim, statue, { grid: 1 });
    crate(s, 100_000, {}, 2.6, 0.4, v(0, 0.4, -2.6));
    grab(s, statue);
    steps(s, 10, FORWARD);
    s.world.step([TAP]);
    steps(s, 120);
    expect(positionOf(s, statue).z).toBeGreaterThan(-2);
  });
});

describe('the pusher is restrained (mw-e02.18)', () => {
  it('has no restraint without a grab, then walks at the object speed with no jump', () => {
    const s = setup();
    const target = crate(s, 20);
    expect(pushRestraint(s.sim, s.actor, { x: 0, y: 1 })).toBeUndefined();
    grab(s, target);
    const free = pushRestraint(s.sim, s.actor, { x: 0, y: 1 });
    expect(free?.noJump).toBe(true);
    expect(free?.scale).toBeCloseTo(
      pushSpeed({ strength: DEFAULT_PUSH_STRENGTH, weight: 20, friction: 0.6 }) /
        DEFAULT_ACTOR_SPEED,
      12,
    );
    // No stick, no push to be blocked.
    expect(pushRestraint(s.sim, s.actor, { x: 0, y: 0 })?.scale).toBe(1);
  });

  it('the player walks at the object speed while pushing (the real movement path)', () => {
    const LAYOUT = layoutScene(TEST_SCENE, testKit);
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
    const push = installPush(world);
    const feet = world.get(player, CharacterController)?.position ?? v(0, 0, 0);
    const target = world.spawn();
    addProperties(sim, target, { pushable: true, weight: 20 });
    addPhysicsObject(sim, target, {
      shape: { kind: 'box', halfExtents: v(0.3, 0.3, 0.3) },
      position: v(feet.x, feet.y + 0.3, feet.z - 1),
    });
    world.step([IDLE]);
    world.step([IDLE]);
    expect(push.grab(player, target)).toEqual({ ok: true });
    for (let i = 0; i < 90; i += 1) world.step([frame({ sprint: 'hold', jump: 'hold' }, 0, 1)]);
    const velocity = world.get(player, CharacterController)?.velocity ?? v(0, 0, 0);
    const expected = pushSpeed({ strength: DEFAULT_PUSH_STRENGTH, weight: 20, friction: 0.6 });
    expect(hypot(velocity.x, velocity.z)).toBeCloseTo(expected, 1);
    expect(velocity.y).toBeLessThanOrEqual(0.001);
  });
});

describe('rotating (mw-e02.18)', () => {
  function mirror(s: Setup, step = 15): EntityId {
    const entity = s.world.spawn();
    addProperties(s.sim, entity, { weight: 20, reflective: true });
    addPhysicsObject(s.sim, entity, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(0, 0.2, -1),
    });
    addInteractable(
      s.sim,
      entity,
      { affordances: [{ verb: 'rotate' }], anchor: [0, 0, 0], radius: 0.3 },
      v(0, 0.2, -1),
    );
    addPushConfig(s.sim, entity, { rotateStep: step });
    s.world.step([IDLE]);
    return entity;
  }

  it('AC-5: using rotate turns a rotatable mirror by its configured step and emits rotation-changed', () => {
    const s = setup();
    const target = mirror(s);
    s.world.step([IDLE]);
    expect(interactionPrompt(s.sim, s.actor)).toMatchObject({ target, verb: 'rotate' });
    s.world.step([TAP]);
    s.world.events.flush();
    expect(s.rotated).toHaveLength(1);
    expect(s.rotated[0]).toMatchObject({ actor: s.actor, target, step: 15, angle: 15 });
    const turned = s.world.get(target, PhysicsObjectComponent)?.rotation;
    expect(turned?.y).toBeCloseTo(sin((15 * Math.PI) / 360), 6);
    expect(turned?.w).toBeCloseTo(cos((15 * Math.PI) / 360), 6);
    s.world.step([IDLE]);
    s.world.step([TAP]);
    expect(s.world.get(target, PushConfigComponent)?.angle).toBe(30);
    // A full turn wraps.
    for (let i = 0; i < 22; i += 1) s.push.rotate(s.actor, target);
    expect(s.world.get(target, PushConfigComponent)?.angle).toBe(0);
  });

  it('refuses an object that has no step, or no config', () => {
    const s = setup();
    const target = mirror(s, 0);
    expect(s.push.rotate(s.actor, target)).toBe(false);
    const plain = crate(s, 20);
    expect(s.push.rotate(s.actor, plain)).toBe(false);
    const bodyless = s.world.spawn();
    addPushConfig(s.sim, bodyless, { rotateStep: 15 });
    expect(s.push.rotate(s.actor, bodyless)).toBe(false);
  });

  it('release is an affordance too: a declared release lets go, a stray one grabs nothing', () => {
    const s = setup();
    const target = crate(s, 20);
    grab(s, target);
    s.world.step([IDLE]);
    s.push.release(s.actor);
    const other = crate(s, 20, {}, 2);
    addInteractable(
      s.sim,
      other,
      { affordances: [{ verb: 'release' }], anchor: [0, 0, 0], radius: 0.3 },
      v(0, 0.2, -2),
    );
    s.world.step([IDLE]);
    s.push.grab(s.actor, target);
    s.world.step([IDLE]);
    expect(grabOf(s.sim, s.actor)?.target).toBe(target);
  });
});

describe('edges (mw-e02.18)', () => {
  it('pushes spheres and capsules too', () => {
    const s = setup();
    const ball = crate(s, 20, {}, 1, 0.2, v(0, 0.3, -1), { kind: 'sphere', radius: 0.3 });
    const post = crate(s, 20, {}, 2, 0.2, v(1, 0.5, -1), {
      kind: 'capsule',
      radius: 0.2,
      halfHeight: 0.3,
    });
    grab(s, ball);
    steps(s, 20, FORWARD);
    expect(positionOf(s, ball).z).toBeLessThan(-1.1);
    s.push.release(s.actor);
    s.push.grab(s.actor, post);
    steps(s, 20, FORWARD);
    expect(positionOf(s, post).z).toBeLessThan(-1.1);
  });

  it('works without a collision world, and a world without pushing has no restraint', () => {
    const s = setup({ collision: undefined as never });
    const target = crate(s, 20);
    grab(s, target);
    steps(s, 20, FORWARD);
    expect(positionOf(s, target).z).toBeLessThan(-1.1);
    expect(pushRestraint(new World<never>({ seed: 1 }), s.actor, { x: 0, y: 1 })).toBeUndefined();
  });

  it('two pushers each move their own object and glides never mix', () => {
    const s = setup();
    const other = s.world.spawn();
    s.world.add(other, CharacterController, initialCharacterState(v(3, 0, 0)));
    s.world.add(other, PlayerLook, { yaw: 0, pitch: 0 });
    const first = crate(s, 20, { friction: 0.05 });
    const second = crate(s, 20, { friction: 0.05 }, 1, 0.2, v(3, 0.2, -1));
    expect(s.push.grab(other, second)).toEqual({ ok: true });
    expect(s.push.grab(s.actor, first)).toEqual({ ok: true });
    steps(s, 20, FORWARD);
    expect(grabsOf(s.sim).map((g) => g.actor)).toEqual([s.actor, other]);
    s.push.release(s.actor);
    s.push.release(other);
    steps(s, 120);
    expect(positionOf(s, first).x).toBeCloseTo(0, 3);
    expect(positionOf(s, second).x).toBeCloseTo(3, 3);
    expect(positionOf(s, first).z).toBeLessThan(-1.4);
    expect(positionOf(s, second).z).toBeLessThan(-1.4);
  });

  it('a pusher with no input holds still, and one with no view or object is not restrained', () => {
    const s = setup({ input: () => undefined });
    const target = crate(s, 20);
    grab(s, target);
    steps(s, 10, FORWARD);
    expect(positionOf(s, target).z).toBeCloseTo(-1, 3);
    const blind = setup({ view: () => undefined });
    const seen = crate(blind, 20);
    blind.push.grab(blind.actor, seen);
    expect(pushRestraint(blind.sim, blind.actor, { x: 0, y: 1 })?.scale).toBe(1);
    const gone = setup();
    const lost = crate(gone, 20);
    gone.push.grab(gone.actor, lost);
    gone.world.destroy(lost);
    expect(pushRestraint(gone.sim, gone.actor, { x: 0, y: 1 })?.scale).toBe(1);
  });

  it('ignores other verbs and events of actors that hold nothing', () => {
    const s = setup();
    const lever = s.world.spawn();
    addProperties(s.sim, lever, { weight: 20 });
    addPhysicsObject(s.sim, lever, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(0, 0.2, -1),
    });
    addInteractable(
      s.sim,
      lever,
      { affordances: [{ verb: 'release' }], anchor: [0, 0, 0], radius: 0.3 },
      v(0, 0.2, -1),
    );
    s.world.step([IDLE]);
    s.world.step([TAP]);
    expect(grabOf(s.sim, s.actor)).toBeUndefined();
    s.world.events.emit(PoiseBroken, { target: s.actor } as never);
    s.world.events.emit(areaTransition, { entity: s.actor } as never);
    s.world.events.flush();
    const door = setup();
    const useable = door.world.spawn();
    addPhysicsObject(door.sim, useable, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(0, 0.2, -1),
    });
    addInteractable(
      door.sim,
      useable,
      { affordances: [{ verb: 'use' }], anchor: [0, 0, 0], radius: 0.3 },
      v(0, 0.2, -1),
    );
    door.world.step([IDLE]);
    door.world.step([TAP]);
    expect(grabOf(door.sim, door.actor)).toBeUndefined();
  });

  it('installs after a config was declared, and a save finds the glide target gone', () => {
    const s = setup();
    const statue = crate(s, 20, {}, 1, 0.4, v(0, 0.4, -1));
    addPushConfig(s.sim, statue, { grid: 1 });
    grab(s, statue);
    steps(s, 10, FORWARD);
    s.push.release(s.actor);
    s.world.destroy(statue);
    expect(() => {
      settlePushes(s.sim);
    }).not.toThrow();
    // A glide whose object disappears is dropped by the system, one that is settled is too.
    const t = setup();
    const other = crate(t, 20, {}, 1, 0.4, v(0, 0.4, -1));
    addPushConfig(t.sim, other, { grid: 1 });
    grab(t, other);
    steps(t, 10, FORWARD);
    t.push.release(t.actor);
    t.world.step([IDLE]);
    t.world.destroy(other);
    t.world.step([IDLE]);
    t.world.step([IDLE]);
    const early = new World<ActionFrame>({ seed: 1 });
    addPushConfig(early, early.spawn());
    installPush(early);
    expect(early.isRegistered(PushConfigComponent)).toBe(true);
  });
});
