// Events the arrow system emits (mw-e05.2). Render draws trails and stuck arrows from them, audio
// plays flybys and impacts (the impact follows `physicsImpact`'s conventions: the arrow as `entity`,
// what it hit as `other`, the surface material, energy, impulse, speed, normal and position, so a
// cue sheet binds it the same way), and AI hears where arrows land. Per arrow the order is ArrowFired,
// then any DodgedHit as it flies through i-frames, then arrowImpact per impact (a ricochet flies on;
// a damaging hit follows its DamageApplied events), then ArrowExpired if it never came to rest.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { SurfaceHardness } from '../../properties/spec';
import type { Vec3 } from '../../stimulus/shapes';
import type { DamageResult } from '../damage/events';
import type { HitRegion } from '../hits/components';

/** Payload of ArrowFired. */
export interface ArrowFiredInfo {
  readonly tick: number;
  /** The arrow entity. */
  readonly entity: EntityId;
  /** Arrow content id. */
  readonly arrow: string;
  readonly shooter: EntityId | null;
  readonly origin: Vec3;
  readonly velocity: Vec3;
}

/** An arrow was loosed (`fireArrow`). */
export const ArrowFired = defineEvent<ArrowFiredInfo>('ArrowFired');

/** What an impact did to the arrow. */
export type ArrowImpactOutcome = 'stick' | 'ricochet' | 'drop' | 'shatter';

/** Payload of arrowImpact. */
export interface ArrowImpactInfo {
  readonly tick: number;
  /** The arrow entity. */
  readonly entity: EntityId;
  /** Arrow content id. */
  readonly arrow: string;
  readonly shooter: EntityId | null;
  /** What it hit: a creature, a bound collider's entity or a physics object, or null (unbound). */
  readonly other: EntityId | null;
  /** Material of what it hit (unbound geometry reads the default material). */
  readonly material: string;
  /** Surface hardness of what it hit. */
  readonly hardness: SurfaceHardness;
  readonly outcome: ArrowImpactOutcome;
  /**
   * Whether the arrow came to rest whole; present only when this impact brought it to rest (a stick,
   * or a drop that rests), absent for a ricochet, a fall or a shatter (mw-e05.7).
   */
  readonly intact?: boolean;
  /** Speed at impact, m/s. */
  readonly speed: number;
  /** Kinetic energy at impact, J. */
  readonly energy: number;
  /** Momentum the arrow lost in the impact, N·s. */
  readonly impulse: number;
  /** Unit surface normal at the contact, pointing out of what it hit. */
  readonly normal: Vec3;
  /** Contact point, metres. */
  readonly position: Vec3;
  /** The hurtbox struck, when it hit a creature. */
  readonly hurtbox?: string;
  readonly region?: HitRegion;
  /** The damage model's result, when the hit dealt damage. */
  readonly damage?: DamageResult;
}

/** An arrow struck something: fired once per impact, the tick it happens. */
export const arrowImpact = defineEvent<ArrowImpactInfo>('arrowImpact');

/** Payload of ArrowExpired. */
export interface ArrowExpiredInfo {
  readonly tick: number;
  readonly entity: EntityId;
  readonly arrow: string;
  /** Where it was when its airborne lifetime ran out. */
  readonly position: Vec3;
}

/** An arrow flew its whole airborne lifetime without coming to rest and left the world. */
export const ArrowExpired = defineEvent<ArrowExpiredInfo>('ArrowExpired');

/** Payload of ArrowRested. */
export interface ArrowRestedInfo {
  readonly tick: number;
  /** The arrow entity, now an arrow at rest. */
  readonly entity: EntityId;
  readonly arrow: string;
  readonly state: 'stuck' | 'dropped';
  /** Whether it came to rest whole (see ArrowRest.intact). */
  readonly intact: boolean;
  /** What it is stuck in or lying on, or null for unbound level geometry. */
  readonly in: EntityId | null;
  /** Where its tip came to rest, metres. */
  readonly position: Vec3;
}

/** An arrow came to rest (mw-e05.7): fired once, the tick it happens, after its arrowImpact. */
export const ArrowRested = defineEvent<ArrowRestedInfo>('ArrowRested');
