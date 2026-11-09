// The character controller's view of physics (mw-e02.2): a thin, engine-free query interface, so the
// controller is unit-testable against an in-memory fake (fake-collision-world.ts) and the Rapier port
// (mw-e02.21) implements the same contract (collision-world.contract.ts runs against both).
//
// Conventions: world space in metres, y up. A character capsule is always vertical and is placed by
// its feet — the lowest point of the capsule — so crouching lowers the top and keeps the feet put.
// Directions passed in are unit length. Queries never see the character itself: an implementation
// that holds the character's own collider must exclude it.

import type { Vec3 } from '../stimulus/shapes';

/** A collider the queries can report, stable for the collider's lifetime. */
export type BodyId = number;

/** A vertical capsule: total height (feet to crown) and radius, both metres; height ≥ 2 × radius. */
export interface Capsule {
  readonly radius: number;
  readonly height: number;
}

/** Where a query first touched a collider. */
export interface CollisionHit {
  /** Distance travelled along the query direction before contact, metres, in [0, maxDistance]. */
  readonly distance: number;
  /** Unit surface normal at the contact, pointing out of the collider (towards the query). */
  readonly normal: Vec3;
  /** Contact point on the collider's surface, world space. */
  readonly point: Vec3;
  /** The collider touched. */
  readonly body: BodyId;
}

/**
 * Collision queries against the static and kinematic world. All results must be deterministic: the
 * same world and arguments give the same bits.
 */
export interface CollisionWorld {
  /**
   * Sweeps `capsule` with its feet starting at `feet` along unit `direction` for up to `maxDistance`
   * metres and returns the first contact, or undefined when the path is clear. A capsule that starts
   * touching or overlapping a collider reports it at distance 0 only while moving further into it;
   * moving away (or sliding along it) is not blocked, so a controller can always separate.
   * `ignore` names one collider the sweep never sees (the crate an actor is carrying, which starts
   * inside the capsule that carries it).
   */
  sweepCapsule(
    capsule: Capsule,
    feet: Vec3,
    direction: Vec3,
    maxDistance: number,
    ignore?: BodyId,
  ): CollisionHit | undefined;

  /** Casts a ray from `origin` along unit `direction`; the nearest hit within `maxDistance`, if any. */
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): CollisionHit | undefined;

  /** Whether `capsule` with its feet at `feet` intersects any collider (e.g. room to stand up). */
  overlapCapsule(capsule: Capsule, feet: Vec3): boolean;

  /**
   * Whether `body` is level geometry that never moves (not a crate, a door or a moving platform).
   * Optional: a world that cannot tell treats everything as static. Wall recoil (mw-e04.15) uses it
   * so a swing that meets a crate clangs off nothing.
   */
  isStatic?(body: BodyId): boolean;

  /** Linear velocity of `body` this tick, m/s (zero for static colliders): moving-platform carry. */
  bodyVelocity(body: BodyId): Vec3;
}
