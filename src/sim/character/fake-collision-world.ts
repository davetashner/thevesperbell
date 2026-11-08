// An in-memory, deterministic CollisionWorld (mw-e02.2) over greybox boxes and ramps, so the character
// controller is testable without a physics engine. Its behaviour is pinned by the same contract suite
// the Rapier port must pass (collision-world.contract.ts).
//
// Every collider is a convex polytope: the intersection of half-spaces n·x ≤ c. The capsule is swept
// as its vertical core segment against the polytope with each plane pushed out by the radius. That is
// exact against faces; at edges and corners the pushed-out polytope is sharp where the true Minkowski
// sum is rounded, so the fake treats box edges as square. Contract tests only pin face contacts.
//
// A sweep solves a two-variable linear programme exactly: travel s along the direction and height t
// up the core segment, minimise s subject to every pushed-out plane, 0 ≤ s ≤ maxDistance and
// 0 ≤ t ≤ core length. The optimum lies on a vertex of that polygon, so the solver checks every
// intersection of two constraint lines. Only + − × ÷ and sqrt are used: results are bit-identical
// everywhere.

import type { Vec3 } from '../stimulus/shapes';
import type { BodyId, Capsule, CollisionHit, CollisionWorld } from './collision-world';
import type { GreyboxShape } from './greybox';
import { add, dot, normalize, scale, sub, vec, ZERO } from './vec';

/** A half-space n·x ≤ c with unit normal n pointing out of the solid. */
interface Plane {
  readonly n: Vec3;
  readonly c: number;
}

interface Body {
  readonly shape: GreyboxShape;
  /** Planes at the shape's authored position. */
  readonly planes: readonly Plane[];
  /** How far the body has moved from its authored position. */
  offset: Vec3;
  velocity: Vec3;
}

/** One sweep constraint in (s, t): a·s + b·t ≤ c. */
interface Constraint {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/** A collider face as a sweep constraint, with the face's outward normal. */
interface Face extends Constraint {
  readonly n: Vec3;
}

/** Slack allowed when checking a candidate vertex against the constraints, metres. */
const FEASIBLE_EPS = 1e-9;
/** Two constraint lines closer to parallel than this are skipped (no single vertex). */
const PARALLEL_EPS = 1e-12;
/** A sweep whose first contact is this close to its start began in contact. */
const START_EPS = 1e-9;
/** Moving along a touched face at a rate below this (per metre) counts as moving away. */
const AWAY_EPS = 1e-9;
/** Penetration below this is touching, not overlapping, for `overlapCapsule`. */
const OVERLAP_EPS = 1e-9;

const AXES = ['x', 'y', 'z'] as const;

/** The planes of an axis-aligned box. */
function boxPlanes(min: Vec3, max: Vec3): Plane[] {
  return AXES.flatMap((axis) => {
    const n = (sign: number) => ({ x: 0, y: 0, z: 0, [axis]: sign }) as Vec3;
    return [
      { n: n(1), c: max[axis] },
      { n: n(-1), c: -min[axis] },
    ];
  });
}

/** The planes of a shape at its authored position: its box, plus the slope of a ramp. */
function shapePlanes(shape: GreyboxShape): Plane[] {
  const { min, max } = shape;
  for (const axis of AXES) {
    if (!(max[axis] > min[axis])) {
      throw new RangeError(`greybox ${shape.kind}: max.${axis} must be above min.${axis}`);
    }
  }
  const planes = boxPlanes(min, max);
  if (shape.kind === 'box') return planes;
  const along = shape.rises === '+x' || shape.rises === '-x' ? 'x' : 'z';
  const sign = shape.rises.startsWith('+') ? 1 : -1;
  const lowEnd = sign > 0 ? min[along] : max[along];
  const rise = { x: 0, y: 0, z: 0, [along]: sign } as Vec3;
  // The slope leans back against the climb: up by the run, back by the rise.
  const n = normalize(add(scale(rise, -(max.y - min.y)), vec(0, max[along] - min[along], 0)));
  const low = { x: 0, y: min.y, z: 0, [along]: lowEnd } as Vec3;
  planes.push({ n, c: dot(n, low) });
  return planes;
}

/**
 * The lowest s over the polygon { a·s + b·t ≤ c for every constraint }, with the t it was found at,
 * or undefined when the polygon is empty. Callers include the bounds on s and t, so it is bounded.
 */
function lowestS(constraints: readonly Constraint[]): { s: number; t: number } | undefined {
  let best: { s: number; t: number } | undefined;
  constraints.forEach((p, i) => {
    for (const q of constraints.slice(i + 1)) {
      const det = p.a * q.b - q.a * p.b;
      if (Math.abs(det) < PARALLEL_EPS) continue;
      const s = (p.c * q.b - q.c * p.b) / det;
      const t = (p.a * q.c - q.a * p.c) / det;
      if (best !== undefined && s >= best.s) continue;
      if (constraints.every((k) => k.a * s + k.b * t <= k.c + FEASIBLE_EPS)) best = { s, t };
    }
  });
  return best;
}

/**
 * The contact at the optimum of a sweep, or undefined when the capsule started in contact and is
 * moving away from (or along) the face it is closest to leaving through.
 */
function contact(
  faces: readonly Face[],
  { s, t }: { s: number; t: number },
  core: number,
): { s: number; t: number; n: Vec3 } | undefined {
  if (s <= START_EPS) {
    // Started in contact: the face the core is nearest to being outside of decides. b·t − c is how
    // far outside the pushed-out face the core point at height t lies (largest at one end).
    const pick = faces
      .map((face) => {
        const at = face.b > 0 ? core : 0;
        return { face, at, separation: face.b * at - face.c };
      })
      .reduce((best, next) => (next.separation > best.separation ? next : best));
    return pick.face.a < -AWAY_EPS ? { s: 0, t: pick.at, n: pick.face.n } : undefined;
  }
  // Moving into contact: of the faces active at the optimum, the one met most head-on.
  const pick = faces
    .map((face) => ({ face, residual: face.a * s + face.b * t - face.c }))
    .reduce((best, next) => {
      const tie = Math.abs(next.residual - best.residual) <= FEASIBLE_EPS;
      return (!tie && next.residual > best.residual) || (tie && next.face.a < best.face.a)
        ? next
        : best;
    });
  return { s, t, n: pick.face.n };
}

/**
 * The box around the segment `from`–`to` (any order) with each end extended `rise` upwards, grown
 * by `margin` on every side: [min, max]. For a swept capsule core, `rise` is the core length.
 */
function bounds(from: Vec3, to: Vec3, rise: number, margin: number): [Vec3, Vec3] {
  const lo = vec(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.min(from.z, to.z));
  const hi = vec(Math.max(from.x, to.x), Math.max(from.y, to.y) + rise, Math.max(from.z, to.z));
  return [sub(lo, vec(margin, margin, margin)), add(hi, vec(margin, margin, margin))];
}

/** A deterministic in-memory CollisionWorld of greybox boxes and ramps. */
export class FakeCollisionWorld implements CollisionWorld {
  private readonly bodies: Body[] = [];

  constructor(shapes: readonly GreyboxShape[] = []) {
    for (const shape of shapes) this.add(shape);
  }

  /** Adds a collider; ids are 1, 2, 3… in the order added. */
  add(shape: GreyboxShape): BodyId {
    this.bodies.push({
      shape,
      planes: shapePlanes(shape),
      offset: ZERO,
      velocity: shape.velocity ?? ZERO,
    });
    return this.bodies.length;
  }

  /** Changes a collider's velocity, m/s. */
  setVelocity(body: BodyId, velocity: Vec3): void {
    this.body(body).velocity = velocity;
  }

  /** How far a collider has moved from where it was authored. */
  offsetOf(body: BodyId): Vec3 {
    return this.body(body).offset;
  }

  /** Moves every collider along its velocity for `dt` seconds (the sim steps this once per tick). */
  advance(dt: number): void {
    for (const body of this.bodies) body.offset = add(body.offset, scale(body.velocity, dt));
  }

  bodyVelocity(body: BodyId): Vec3 {
    return this.bodies[body - 1]?.velocity ?? ZERO;
  }

  sweepCapsule(
    capsule: Capsule,
    feet: Vec3,
    direction: Vec3,
    maxDistance: number,
    ignore?: BodyId,
  ): CollisionHit | undefined {
    const { radius } = capsule;
    const core = Math.max(0, capsule.height - 2 * radius);
    const base = add(feet, vec(0, radius, 0));
    const end = add(base, scale(direction, maxDistance));
    const [lo, hi] = bounds(base, end, core, radius);
    let best: CollisionHit | undefined;
    this.bodies.forEach((body, index) => {
      if (index + 1 === ignore || !this.touchesBounds(body, lo, hi)) return;
      const planes = this.worldPlanes(body);
      // Plane i, pushed out by the radius, in (s, t): (n·d)s + (n.y)t ≤ c + r − n·base.
      const faces: Face[] = planes.map(({ n, c }) => ({
        n,
        a: dot(n, direction),
        b: n.y,
        c: c + radius - dot(n, base),
      }));
      const box: Constraint[] = [
        { a: -1, b: 0, c: 0 },
        { a: 1, b: 0, c: maxDistance },
        { a: 0, b: -1, c: 0 },
        { a: 0, b: 1, c: core },
      ];
      const found = lowestS([...faces, ...box]);
      if (found === undefined) return;
      const hit = contact(faces, found, core);
      if (hit === undefined || (best !== undefined && hit.s >= best.distance)) return;
      const centre = add(add(base, scale(direction, hit.s)), vec(0, hit.t, 0));
      best = {
        distance: hit.s,
        normal: hit.n,
        point: sub(centre, scale(hit.n, radius)),
        body: index + 1,
      };
    });
    return best;
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): CollisionHit | undefined {
    const end = add(origin, scale(direction, maxDistance));
    const [lo, hi] = bounds(origin, end, 0, 0);
    let best: CollisionHit | undefined;
    this.bodies.forEach((body, index) => {
      if (!this.touchesBounds(body, lo, hi)) return;
      let enter = 0;
      let exit = maxDistance;
      let normal: Vec3 | undefined;
      for (const { n, c } of this.worldPlanes(body)) {
        const rate = dot(n, direction);
        const room = c - dot(n, origin);
        if (rate === 0) {
          if (room < 0) return; // parallel and outside this face
          continue;
        }
        const s = room / rate;
        if (rate < 0 && s > enter) {
          enter = s;
          normal = n;
        } else if (rate > 0 && s < exit) {
          exit = s;
        }
      }
      if (enter > exit || (best !== undefined && enter >= best.distance)) return;
      // A ray starting inside hits at once; with no face crossed it reports its own reverse.
      const n = normal ?? sub(ZERO, direction);
      best = {
        distance: enter,
        normal: n,
        point: add(origin, scale(direction, enter)),
        body: index + 1,
      };
    });
    return best;
  }

  overlapCapsule(capsule: Capsule, feet: Vec3): boolean {
    const { radius } = capsule;
    const core = Math.max(0, capsule.height - 2 * radius);
    const base = add(feet, vec(0, radius, 0));
    const [lo, hi] = bounds(base, base, core, radius);
    return this.bodies.some((body) => {
      if (!this.touchesBounds(body, lo, hi)) return false;
      const constraints = this.worldPlanes(body).map(({ n, c }) => ({
        a: 0,
        b: n.y,
        c: c + radius - dot(n, base) - OVERLAP_EPS,
      }));
      return (
        lowestS([
          ...constraints,
          { a: -1, b: 0, c: 0 },
          { a: 1, b: 0, c: 0 },
          { a: 0, b: -1, c: 0 },
          { a: 0, b: 1, c: core },
        ]) !== undefined
      );
    });
  }

  /** The body's planes where it is now. */
  private worldPlanes(body: Body): Plane[] {
    return body.planes.map(({ n, c }) => ({ n, c: c + dot(n, body.offset) }));
  }

  /** Whether the body's current bounding box overlaps [lo, hi]. */
  private touchesBounds(body: Body, lo: Vec3, hi: Vec3): boolean {
    const min = add(body.shape.min, body.offset);
    const max = add(body.shape.max, body.offset);
    return AXES.every((axis) => min[axis] <= hi[axis] && max[axis] >= lo[axis]);
  }

  private body(id: BodyId): Body {
    const body = this.bodies[id - 1];
    if (body === undefined) throw new RangeError(`no collider ${String(id)}`);
    return body;
  }
}
