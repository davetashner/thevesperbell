// The character controller's CollisionWorld on the sim's Rapier physics (mw-e02.21). The controller
// is engine-free (src/sim/character); this adapter answers its capsule sweeps, raycasts and overlap
// tests from the Rapier world the physics port owns, and passes the same contract suite as the
// in-memory fake (collision-world.contract.ts).
//
// Sweeps cast the capsule's vertical core *segment* with a target distance of the radius, rather
// than casting Rapier's capsule shape. The two describe the same swept volume (a capsule is a
// segment grown by its radius), but a segment against a polytope converges exactly, while a rounded
// shape leaves millimetres of error in contact points and normals. Rapier's shape cast with
// stop-at-penetration off already has the contract's start-in-contact rule: a capsule touching or
// overlapping a collider is only blocked while moving further into it.
//
// Edges and corners are rounded here (the exact capsule Minkowski sum), where the fake's are square;
// the contract pins only face contacts, so both pass it.
//
// A capsule of height 2 × radius has a zero-length core: a sphere. The orbit camera (mw-e02.4) sweeps
// and overlaps spheres that way, read-only, between sim steps.
//
// Queries see the colliders as of the physics port's last step: the World steps physics at the
// start of every tick, so colliders added between ticks are there for that tick's systems. Rapier
// works in 32-bit floats, so results carry about 1e-5 m of error; the contract allows 1e-3.

import type * as Rapier from '@dimforge/rapier3d-deterministic';
import type { BodyId, Capsule, CollisionHit, CollisionWorld } from '../character/collision-world';
import type { Vec3 } from '../stimulus/shapes';
import type { RapierPhysics } from './rapier';
import type { ColliderHandle } from './static-colliders';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

const plain = ({ x, y, z }: Vec3): Vec3 => ({ x, y, z });

/** A capsule's centre and the half-length of its core segment, from its feet. */
function placeCapsule(capsule: Capsule, feet: Vec3): { centre: Vec3; half: number } {
  const half = Math.max(0, capsule.height - 2 * capsule.radius) / 2;
  return { centre: { x: feet.x, y: feet.y + capsule.radius + half, z: feet.z }, half };
}

/** CollisionWorld queries against the colliders of a RapierPhysics port. */
export class RapierCollisionWorld implements CollisionWorld {
  constructor(private readonly physics: RapierPhysics) {}

  sweepCapsule(
    capsule: Capsule,
    feet: Vec3,
    direction: Vec3,
    maxDistance: number,
    ignore?: BodyId,
  ): CollisionHit | undefined {
    const { rapier, rapierWorld } = this.physics;
    const { centre, half } = placeCapsule(capsule, feet);
    const core = new rapier.Segment({ x: 0, y: -half, z: 0 }, { x: 0, y: half, z: 0 });
    const skipped =
      ignore === undefined ? undefined : this.physics.rapierHandleOf(ignore as ColliderHandle);
    const hit = rapierWorld.castShape(
      centre,
      IDENTITY,
      direction,
      core,
      capsule.radius,
      maxDistance,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      skipped === undefined ? undefined : (collider) => collider.handle !== skipped,
    );
    return hit === null
      ? undefined
      : this.hit(hit.collider, hit.time_of_impact, hit.normal1, hit.witness1);
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): CollisionHit | undefined {
    const { rapier, rapierWorld } = this.physics;
    const hit = rapierWorld.castRayAndGetNormal(
      new rapier.Ray(origin, direction),
      maxDistance,
      true,
    );
    if (hit === null) return undefined;
    const d = hit.timeOfImpact;
    const point = {
      x: origin.x + direction.x * d,
      y: origin.y + direction.y * d,
      z: origin.z + direction.z * d,
    };
    return this.hit(hit.collider, d, hit.normal, point);
  }

  overlapCapsule(capsule: Capsule, feet: Vec3): boolean {
    const { rapier, rapierWorld } = this.physics;
    const { centre, half } = placeCapsule(capsule, feet);
    const shape = new rapier.Capsule(half, capsule.radius);
    return rapierWorld.intersectionWithShape(centre, IDENTITY, shape) !== null;
  }

  bodyVelocity(body: BodyId): Vec3 {
    return this.physics.velocityOf(body as ColliderHandle);
  }

  isStatic(body: BodyId): boolean {
    return this.physics.isFixed(body as ColliderHandle);
  }

  private hit(
    collider: Rapier.Collider,
    distance: number,
    normal: Vec3,
    point: Vec3,
  ): CollisionHit {
    return {
      distance,
      normal: plain(normal),
      point: plain(point),
      body: this.physics.handleOf(collider.handle),
    };
  }
}
