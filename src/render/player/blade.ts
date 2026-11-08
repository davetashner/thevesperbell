// Where the knight's blade points (mw-a6t): pure geometry over points in the body's own space (y up,
// feet at 0), so a test can say how far off vertical the sword rides and how far it keeps from the leg.
// The page publishes the numbers for the e2e (src/main.ts); nothing in the sim reads them.

/** A point in the body's space, metres. */
export type Point3 = readonly [number, number, number];

/** How the blade sits, in the body's space. */
export interface BladeReadout {
  /** The blade's angle from straight down, degrees (0 = hanging, 90 = level). */
  readonly offVertical: number;
  /** The tip's height above the feet, metres. */
  readonly tipY: number;
  /** The least distance from the blade to the right leg's centreline, metres. */
  readonly legGap: number;
}

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Point3): number => Math.sqrt(dot(a, a));

/** Distance between segments p0–p1 and q0–q1 (closest-point search by sampling; they are short). */
export function segmentGap(p0: Point3, p1: Point3, q0: Point3, q1: Point3): number {
  let best = Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p: Point3 = [
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
    ];
    // Closest point on q to p.
    const d = sub(q1, q0);
    const u = Math.min(1, Math.max(0, dot(sub(p, q0), d) / dot(d, d)));
    const q: Point3 = [q0[0] + d[0] * u, q0[1] + d[1] * u, q0[2] + d[2] * u];
    best = Math.min(best, length(sub(p, q)));
  }
  return best;
}

/** The blade from `grip` to `tip`, against a leg given as its hip, knee and ankle. */
export function readBlade(
  grip: Point3,
  tip: Point3,
  leg: readonly [Point3, Point3, Point3],
): BladeReadout {
  const axis = sub(tip, grip);
  const len = length(axis);
  const offVertical = (Math.acos(Math.min(1, Math.max(-1, -axis[1] / len))) * 180) / Math.PI;
  return {
    offVertical,
    tipY: tip[1],
    legGap: Math.min(segmentGap(grip, tip, leg[0], leg[1]), segmentGap(grip, tip, leg[1], leg[2])),
  };
}
