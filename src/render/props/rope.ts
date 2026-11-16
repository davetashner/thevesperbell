// Thin rope drawn from tubes (render only, no GPU needed to build): rope is too fine for image-to-3D
// models, so shrouds, ratlines, stays and rope ladders are made here instead, as short six-sided
// tubes, one per run of rope, merged into a single vertex-coloured geometry per rig. The pure part
// (which segments, where) is unit tested in rope.test.ts; tern-rigging.ts decides where they go.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A point in world metres. */
export type Point = readonly [number, number, number];

/** One straight run of rope, or a fitting such as a deadeye drawn the same way (a short fat run). */
export interface Segment {
  readonly a: Point;
  readonly b: Point;
  readonly radius: number;
  readonly colour: number;
}

/** Sides of every tube: chunky and low poly, but round enough to read as rope from a few metres. */
const SIDES = 6;

/**
 * Ratlines between two shrouds: `rungs` evenly spaced rungs, the first and last `margin` (0..0.5) of
 * the way in from either end, each joining the point at the same fraction along both ropes.
 */
export function ratlines(
  left: readonly [Point, Point],
  right: readonly [Point, Point],
  rungs: number,
  margin: number,
  radius: number,
  colour: number,
): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < rungs; i++) {
    const t = rungs === 1 ? 0.5 : margin + ((1 - 2 * margin) * i) / (rungs - 1);
    out.push({ a: lerp(left[0], left[1], t), b: lerp(right[0], right[1], t), radius, colour });
  }
  return out;
}

/** The point `t` of the way from `a` to `b`. */
export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The six-sided tube of `segment`, vertex-coloured. */
function tube(segment: Segment): BufferGeometry {
  const from = new Vector3(...segment.a);
  const to = new Vector3(...segment.b);
  const direction = to.clone().sub(from);
  const length = direction.length();
  const geometry = new CylinderGeometry(segment.radius, segment.radius, length, SIDES, 1);
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  geometry.applyMatrix4(
    new Matrix4().compose(from.add(to).multiplyScalar(0.5), turn, new Vector3(1, 1, 1)),
  );
  const rgb = new Color(segment.colour);
  const colour = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colour.length; i += 3) colour.set([rgb.r, rgb.g, rgb.b], i);
  geometry.setAttribute('color', new BufferAttribute(colour, 3));
  return geometry;
}

/** All `segments` as one geometry. */
export function ropeGeometry(segments: readonly Segment[]): BufferGeometry {
  const tubes = segments.map(tube);
  const merged = mergeGeometries(tubes);
  for (const t of tubes) t.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
