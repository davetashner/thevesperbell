// Arrow state (mw-e05.2): an arrow in flight and an arrow at rest. Plain frozen data, replaced never
// mutated, so snapshots, saves and replays carry arrows mid-flight. An arrow shares the projectile
// model of creature attacks (attacks/components.ts): a world-space position and the `dodged` list of
// targets it flew through during their i-frames (mw-e04.28), with the same meaning; what it adds is
// ballistics — a velocity that gravity and drag change every tick instead of a fixed direction and
// speed — and the arrow content id its mass, drag, penetration and damage come from.
//
// When it lands, an arrow either leaves the world (it shattered, or its airborne lifetime ran out) or
// comes to rest: its `combat.arrow` component is replaced by `combat.arrow-rest`, stuck in what it hit
// or dropped on the ground. A rested arrow stays (mw-e05.7): it is intact or broken (decided at
// impact), follows what it is stuck in when that moves, and can be taken back (retrieval.ts).

import { defineComponent, type EntityId } from '../../core/component';
import type { Vec3 } from '../../stimulus/shapes';
import type { Projectile } from '../attacks/components';

/** An arrow in flight (`combat.arrow`). */
export interface ArrowFlight extends Pick<Projectile, 'position' | 'dodged'> {
  /** Arrow content id (its ArrowDef in the system's table). */
  readonly arrow: string;
  /** Who shot it (immune to it for its first ticks of flight), or null for nobody (a trap). */
  readonly shooter: EntityId | null;
  /** Velocity, m/s; the arrow points along it. */
  readonly velocity: Vec3;
  /** Speed it left the bow at, m/s (damage scales with the square of speed over this). */
  readonly launchSpeed: number;
  /** Ticks flown so far. */
  readonly flown: number;
  /**
   * True once a ricochet left it too slow to fly on (below the minimum ricochet speed): it falls,
   * harmless, until it comes to rest on the next surface it touches.
   */
  readonly spent: boolean;
  /**
   * The creature it last ricocheted off, absent otherwise: it cannot strike that creature again while
   * its path still starts touching it (a creature moving on would otherwise catch it again).
   */
  readonly glanced?: EntityId;
}

/** How an arrow came to rest. */
export type ArrowRestState = 'stuck' | 'dropped';

/** An arrow at rest (`combat.arrow-rest`). */
export interface ArrowRest {
  readonly arrow: string;
  readonly shooter: EntityId | null;
  readonly state: ArrowRestState;
  /** Where its tip came to rest, metres. */
  readonly position: Vec3;
  /** Unit direction it points (its flight direction when it landed). */
  readonly direction: Vec3;
  /** What it is stuck in or lying on: an entity, or null for unbound level geometry. */
  readonly in: EntityId | null;
  /** World tick it came to rest. */
  readonly tick: number;
  /**
   * Whether it came through the impact whole (the roll decided at impact, ballistics.ts). Intact arrows
   * can be taken back and drop into the loot of a creature they are stuck in; broken ones cannot, and
   * an intact one breaks when it or what holds it burns.
   */
  readonly intact: boolean;
  /**
   * Where its tip is relative to what it is stuck in (`in`), metres, so it follows that body as it
   * moves. Absent for an arrow in unbound geometry, or in something with no placement.
   */
  readonly local?: Vec3;
}

/** The arrow-in-flight component (`combat.arrow`; a snapshot and save key, never renamed). */
export const ArrowComponent = defineComponent<ArrowFlight>('combat.arrow');

/** The arrow-at-rest component (`combat.arrow-rest`; a snapshot and save key, never renamed). */
export const ArrowRestComponent = defineComponent<ArrowRest>('combat.arrow-rest');

/** Every arrow component, for `world.register(...ARROW_COMPONENTS)`. */
export const ARROW_COMPONENTS = Object.freeze([ArrowComponent, ArrowRestComponent] as const);
