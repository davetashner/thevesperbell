// Dynamic rigid bodies on the sim's physics port (mw-e03.10). Crates, barrels, bottles and debris are
// simulated by the physics engine inside the sim's fixed tick; this is the engine-agnostic surface the
// physics-object layer (objects.ts) drives, so the layer never touches Rapier types and a plain
// TypeScript reference integrator could implement it for engine-free tests.
//
// A body is one collider on one dynamic rigid body. Its handle comes from the same sequence as the
// port's static and kinematic colliders (ColliderHandle), so `remove` takes a body away too and one
// handle table covers everything in snapshots.
//
// Impacts: every step, the port reports each contact that started during it and involves at least
// one dynamic body, with the closing speed along the contact normal measured from the bodies' linear
// velocities just before the step, and the energy that closing motion carries (½ μ v², μ the reduced
// mass; a fixed or kinematic side counts as infinitely heavy). Angular velocity is not included: the
// figure is for sound, noise, damage and breaking, not for exact contact mechanics.

import { hypot } from '../math';
import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';
import type { PhysicsPort } from './port';
import type { ColliderHandle } from './static-colliders';

/** A body's collision shape, centred on the body (a capsule stands along the y axis). */
export type BodyShape =
  | { readonly kind: 'box'; readonly halfExtents: Vec3 }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'capsule'; readonly halfHeight: number; readonly radius: number };

/** Surface response of a body's collider. */
export interface BodyMaterial {
  /** Coulomb friction coefficient (≥ 0). */
  readonly friction: number;
  /** Restitution (bounciness), 0 … 1. */
  readonly restitution: number;
}

/** A dynamic body to add. */
export interface BodyDesc extends BodyMaterial {
  readonly shape: BodyShape;
  /** Centre, metres. */
  readonly position: Vec3;
  /** Defaults to identity. */
  readonly rotation?: Quat;
  /** Initial linear velocity, m/s (a thrown object); defaults to zero. */
  readonly velocity?: Vec3;
  /** kg, > 0. */
  readonly mass: number;
}

/** Where a body is. */
export interface BodyPose {
  readonly position: Vec3;
  readonly rotation: Quat;
  /** Asleep: the engine no longer simulates it until something wakes it. */
  readonly sleeping: boolean;
}

/** Where a body is and how it moves. */
export interface BodyMotion extends BodyPose {
  /** m/s. */
  readonly linvel: Vec3;
  /** rad/s. */
  readonly angvel: Vec3;
  /** kg. */
  readonly mass: number;
}

/** A contact that started during the last step (see the file header). */
export interface ContactImpact {
  readonly a: ColliderHandle;
  readonly b: ColliderHandle;
  /** Unit contact normal pointing from `a` towards `b`. */
  readonly normal: Vec3;
  /** Closing speed along the normal just before the step, m/s (≤ 0: they were not approaching). */
  readonly speed: number;
  /** Kinetic energy of the closing motion, J (0 when not approaching). */
  readonly energy: number;
  /** Momentum the closing motion carries, N·s (reduced mass × speed; 0 when not approaching). */
  readonly impulse: number;
}

/** The sim's physics port with dynamic bodies. RapierPhysics implements it. */
export interface RigidBodyPort extends PhysicsPort {
  /**
   * Adds a dynamic body; `remove(handle)` takes it away again.
   * @throws RangeError for a non-positive mass or shape size, or a non-finite number.
   */
  addBody(desc: BodyDesc): ColliderHandle;
  /** Sets a body's mass, kg (> 0); the next step simulates it with the new mass. */
  setMass(handle: ColliderHandle, mass: number): void;
  /** Sets the friction and restitution of any collider this port added (static ones too). */
  setMaterial(handle: ColliderHandle, material: BodyMaterial): void;
  /** Applies an impulse (N·s) at a body's centre, waking it. */
  applyImpulse(handle: ColliderHandle, impulse: Vec3): void;
  /** A body's current pose (cheaper than `motionOf`). */
  poseOf(handle: ColliderHandle): BodyPose;
  /** Whether a body is asleep (cheaper than `poseOf`). */
  isSleeping(handle: ColliderHandle): boolean;
  /** A body's current motion. */
  motionOf(handle: ColliderHandle): BodyMotion;
  /**
   * Moves a body's centre to `position` at once (a teleport), stopping it and waking it; it turns to
   * `rotation` when given (a saved pose, mw-e27.3), else its rotation is kept.
   * @throws RangeError for a non-finite position or rotation, or a handle that is not a body.
   */
  moveBody(handle: ColliderHandle, position: Vec3, rotation?: Quat): void;
  /** Puts a body to sleep now (it wakes again when something touches or pushes it). */
  sleep(handle: ColliderHandle): void;
  /** The world's gravity, m/s² (default 9.81 straight down); what a hold must cancel to float a body. */
  gravity(): Vec3;
  /** Contacts that started during the last step, in the engine's deterministic order. */
  impacts(): readonly ContactImpact[];
}

const isPositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Throws a RangeError unless every number of `desc` is finite and its sizes and mass positive. */
export function checkBodyDesc(desc: BodyDesc): void {
  const { shape } = desc;
  const sizes =
    shape.kind === 'box'
      ? [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z]
      : shape.kind === 'sphere'
        ? [shape.radius]
        : [shape.halfHeight, shape.radius];
  if (!sizes.every(isPositive)) throw new RangeError(`${shape.kind} body sizes must be positive`);
  if (!isPositive(desc.mass)) throw new RangeError(`body mass must be positive`);
  const { rotation, velocity, position } = desc;
  const numbers = [
    position.x,
    position.y,
    position.z,
    desc.friction,
    desc.restitution,
    ...(rotation === undefined ? [] : [rotation.x, rotation.y, rotation.z, rotation.w]),
    ...(velocity === undefined ? [] : [velocity.x, velocity.y, velocity.z]),
  ];
  if (!numbers.every(Number.isFinite)) throw new RangeError('body numbers must be finite');
}

/** Radius of the smallest sphere around the body's centre that contains `shape`, metres. */
export function boundingRadius(shape: BodyShape): number {
  switch (shape.kind) {
    case 'box':
      return hypot(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    case 'sphere':
      return shape.radius;
    case 'capsule':
      return shape.halfHeight + shape.radius;
  }
}
