// Arrow ballistics maths (mw-e05.2), pure and deterministic: one fixed-step integration of an arrow's
// flight, the speed scaling of its damage, the penetration each surface hardness needs, and the
// ricochet. Only + − × ÷ and sqrt are used, so every client computes the same bits.
//
// Integration is semi-implicit (symplectic) Euler at the sim's fixed tick: the velocity takes this
// tick's acceleration first, then the position moves by the new velocity. The acceleration is gravity
// plus quadratic drag, a = g − (k / m)·|v|·v, with k the arrow's dragK (kg/m) and m its mass (kg), so
// drag bleeds speed along the flight line and the arc steepens as the arrow slows.

import type { SurfaceHardness } from '../../properties/spec';
import type { Vec3 } from '../../stimulus/shapes';

/**
 * The rules every arrow flies by. The numbers named in mw-e05.2 are its spec; the rest are tuning
 * defaults (marked), for owner review.
 */
export interface ArrowRules {
  /** Gravity, m/s² (straight down). */
  readonly gravity: number;
  /** Fraction of its speed a ricochet keeps (40%). */
  readonly ricochetSpeedFactor: number;
  /**
   * Tuning default: below this speed after a ricochet, m/s, the arrow drops instead — it falls,
   * harmless, and rests on the next surface.
   */
  readonly minRicochetSpeed: number;
  /** Ticks of flight during which the shooter cannot be hit by its own arrow (30). */
  readonly selfImmuneTicks: number;
  /** Airborne lifetime, seconds (10): an arrow still flying then leaves the world. */
  readonly lifetimeSeconds: number;
  /** Lowest damage factor: damage scales with (v / v0)², clamped to [this, 1] (0.3). */
  readonly minDamageFactor: number;
  /** Tuning default: radius of the arrow's swept segment against hurtboxes, metres. */
  readonly radius: number;
  /**
   * Chance an arrow comes to rest intact, by what it landed in (mw-e05.7): soft and medium surfaces
   * (soil, wood, flesh) 90%, hard non-conductive ones (stone) 40%, hard conductive ones (metal) 20%.
   */
  readonly intactChance: Readonly<{ organic: number; stone: number; metal: number }>;
  /** Most arrows at rest in a world at once (64): the oldest not in view go first (retrieval.ts). */
  readonly maxResting: number;
  /** Arrows within this distance of the one taken are gathered with it, metres (1.0). */
  readonly gatherRadius: number;
}

/** The rules of mw-e05.2 (see ArrowRules for which numbers are tuning defaults). */
export const DEFAULT_ARROW_RULES: ArrowRules = Object.freeze({
  gravity: 9.81,
  ricochetSpeedFactor: 0.4,
  minRicochetSpeed: 2,
  selfImmuneTicks: 30,
  lifetimeSeconds: 10,
  minDamageFactor: 0.3,
  radius: 0.01,
  intactChance: Object.freeze({ organic: 0.9, stone: 0.4, metal: 0.2 }),
  maxResting: 64,
  gatherRadius: 1,
});

/**
 * The chance an arrow lands intact in a surface of `hardness` (conductive: metal when hard). Reads
 * properties, never material names, so a new material gets the right odds from its data.
 */
export function intactChanceOf(
  rules: Pick<ArrowRules, 'intactChance'>,
  hardness: SurfaceHardness,
  conductive: boolean,
): number {
  if (hardness !== 'hard') return rules.intactChance.organic;
  return conductive ? rules.intactChance.metal : rules.intactChance.stone;
}

/**
 * Penetration an arrow needs to stick in each surface hardness (soft: soil, flesh; medium: wood,
 * bone; hard: stone, metal, glass). Mirrors the content's SURFACE_PENETRATION (kept equal by
 * tests/contracts/arrows.test.ts): the sim may not import content values.
 */
export const PENETRATION_TO_STICK: Readonly<Record<SurfaceHardness, number>> = Object.freeze({
  soft: 5,
  medium: 10,
  hard: 40,
});

/** Position and velocity of a flying arrow. */
export interface FlightState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/** The magnitude of `v`. */
export const speedOf = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

/**
 * One tick of flight: `dragPerMass` is k / m (1/m), `gravity` m/s², `dt` seconds. Semi-implicit
 * Euler (see the file header).
 */
export function integrateFlight(
  state: FlightState,
  dragPerMass: number,
  gravity: number,
  dt: number,
): FlightState {
  const { position: p, velocity: v } = state;
  const drag = dragPerMass * speedOf(v);
  const vx = v.x - drag * v.x * dt;
  const vy = v.y - (gravity + drag * v.y) * dt;
  const vz = v.z - drag * v.z * dt;
  return {
    position: { x: p.x + vx * dt, y: p.y + vy * dt, z: p.z + vz * dt },
    velocity: { x: vx, y: vy, z: vz },
  };
}

/** Damage factor at `speed` for an arrow launched at `launchSpeed`: (v / v0)² in [min, 1]. */
export function damageFactor(speed: number, launchSpeed: number, min: number): number {
  const ratio = speed / launchSpeed;
  return Math.min(1, Math.max(min, ratio * ratio));
}

/** Whether an arrow with `penetration` sticks in a surface of `hardness`. */
export function penetrates(penetration: number, hardness: SurfaceHardness): boolean {
  return penetration >= PENETRATION_TO_STICK[hardness];
}

/**
 * `velocity` reflected off a surface with unit normal `normal`, keeping `factor` of its speed. A
 * normal that does not face the arrow (a grazing contact reported from inside) sends it straight back.
 */
export function ricochet(velocity: Vec3, normal: Vec3, factor: number): Vec3 {
  const into = velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z;
  if (into >= 0)
    return { x: -velocity.x * factor, y: -velocity.y * factor, z: -velocity.z * factor };
  const k = 2 * into;
  return {
    x: (velocity.x - k * normal.x) * factor,
    y: (velocity.y - k * normal.y) * factor,
    z: (velocity.z - k * normal.z) * factor,
  };
}
