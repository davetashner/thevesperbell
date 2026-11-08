// The damage packet (mw-e04.1): everything one hit carries into the damage model. Every source of
// harm — a knight's swing, an arrow, a backstab, a spell, a falling rock — builds one of these and
// hands it to `DamageModel.apply`, so they all compose through the same resistances, guards and
// modifiers instead of each inventing its own maths.
//
// Relation to the stimulus API (mw-e03.3): blunt/slash/pierce stimuli report raw impact energy in
// joules on world objects with `hp`/`fragile`, for breakables (e03.11) to consume. That is physics,
// not harm to a combatant. A source that should hurt a creature — a kinetic impact, a hazard volume,
// a fall — converts its physical quantity into a DamagePacket (tagged `environment`, instigator set
// to whoever caused it; e04.19 owns those conversions) and applies it through the damage model, so
// stimuli become one more damage source rather than a parallel damage system.

import type { EntityId } from '../../core/component';
import type { Vec3 } from '../../stimulus/shapes';
import {
  DAMAGE_TYPES,
  fromUnits,
  isDamageType,
  nonNegativeProblem,
  roundPoints,
  toUnits,
  type DamageAmounts,
  type DamageType,
} from './types';

/**
 * Well-known packet tags. Tags are free-form strings (any rule may add its own), these are the ones
 * the damage model's consumers agree on.
 */
export const DAMAGE_TAGS = Object.freeze({
  /** A critical hit (riposte, backstab). */
  critical: 'critical',
  /** A thief backstab (e10.4). */
  backstab: 'backstab',
  /** Struck the head (e05.6): added by the region stage. */
  headshot: 'headshot',
  /** An arrow that cannot pierce the struck armour ricocheted: 0 damage (e05.6, region stage). */
  deflected: 'deflected',
  /** A blunt arrow head (e05.6): ignores deflection, deals half damage to armour. */
  blunt: 'blunt',
  /** Staggers the target whatever its poise: a head hit on an unaware humanoid (e05.6). */
  staggering: 'staggering',
  /** Struck a weak point (e05.6): added by the region stage. */
  weakpoint: 'weakpoint',
  /** A riposte after a parry (e04.12). */
  riposte: 'riposte',
  /** A counter-hit into a failed parry's recovery (e04.12). */
  counter: 'counter',
  /** A parry in its window may deflect it: added by sources of parryable melee hits (e04.12). */
  parryable: 'parryable',
  /** Deflected by a parry: no damage, poise or stamina; added by the guard stage (e04.12). */
  parried: 'parried',
  /** Falls, crushes and hazards (e04.19). */
  environment: 'environment',
  /** Raw spell force (a push, a blast): breaking poise knocks the target down, not just staggers it. */
  force: 'force',
  /** Passes through shields: the move is unblockable (grabs, some slams). */
  unblockable: 'unblockable',
  /** Met a raised shield; added by the guard stage (e04.6). */
  blocked: 'blocked',
  /** A blocked hit that emptied the blocker's stamina and broke the guard (e04.6). */
  guardBreak: 'guard-break',
  /**
   * Cancels a target's move flagged interruptible (a spell windup), whatever its phase or hyperarmor,
   * and makes it flinch: carried by the shield bash's hits (e04.14, the hit reactions' rule).
   */
  interrupt: 'interrupt',
  /**
   * Breaks a shieldless guard (a blade or forearm) outright, whatever stamina the blocker has left:
   * carried by the shield bash's hits (e04.14, the shield rule).
   */
  guardCrush: 'guard-crush',
} as const);

/** A hit as its source describes it; see `DamagePacket` for the fields. */
export interface DamagePacketInput {
  readonly instigator?: EntityId | null;
  readonly source?: EntityId | null;
  readonly amounts: DamageAmounts;
  readonly poiseDamage?: number;
  readonly staminaDamage?: number;
  readonly impulse?: Vec3;
  readonly impactForce?: number;
  readonly direction?: Vec3;
  readonly region?: string;
  readonly regionMultiplier?: number;
  readonly armor?: number;
  readonly penetration?: number;
  readonly tags?: readonly string[];
}

/** A validated hit with every default filled in (plain data). */
export interface DamagePacket {
  /** Who is responsible (credit, AI blame, the killer on Died); null for nobody. */
  readonly instigator: EntityId | null;
  /** What delivered it (the sword, arrow or hazard entity); null when it has no entity. */
  readonly source: EntityId | null;
  /** Points per damage type; only positive amounts are kept, rounded to hundredths. */
  readonly amounts: DamageAmounts;
  /** Poise damage in points (hit reactions, stagger). */
  readonly poiseDamage: number;
  /** Stamina damage in points, drained by guard rules (block) — the model itself never drains it. */
  readonly staminaDamage: number;
  /** Knockback impulse, N·s (world space); zero when the hit does not push. */
  readonly impulse: Vec3;
  /** Peak impact force, N (breaking, knockdown thresholds). */
  readonly impactForce: number;
  /** Unit direction the hit travels (world space), when known; hit direction and block arcs use it. */
  readonly direction?: Vec3;
  /** Hurtbox region that was struck (e04.2), e.g. "head". */
  readonly region?: string;
  /** Damage multiplier of that region (the region stage applies it); 1 when there is none. */
  readonly regionMultiplier: number;
  /** Armour value of the struck hurtbox (e05.6); absent or 0 = unarmoured. */
  readonly armor?: number;
  /** Penetration rating of the arrow that struck (e05.6); absent for melee, which never deflects. */
  readonly penetration?: number;
  /** Tags such as `critical`, `backstab`, `environment` (see DAMAGE_TAGS); sorted, no duplicates. */
  readonly tags: readonly string[];
}

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

function entityOrNull(what: string, id: EntityId | null | undefined): EntityId | null {
  if (id === undefined || id === null) return null;
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new RangeError(`${what} must be an entity id or null, got ${String(id)}`);
  }
  return id;
}

function amount(what: string, value: number | undefined): number {
  if (value === undefined) return 0;
  const problem = nonNegativeProblem(what, value);
  if (problem !== undefined) throw new RangeError(problem);
  return roundPoints(value);
}

function multiplier(value: number | undefined): number {
  if (value === undefined) return 1;
  const problem = nonNegativeProblem('regionMultiplier', value);
  if (problem !== undefined) throw new RangeError(problem);
  return value;
}

function rating(what: string, value: number): number {
  const problem = nonNegativeProblem(what, value);
  if (problem !== undefined) throw new RangeError(problem);
  return value;
}

function vector(what: string, value: Vec3): Vec3 {
  const { x, y, z } = value;
  if (![x, y, z].every(Number.isFinite)) throw new RangeError(`${what} must be finite`);
  return Object.freeze({ x, y, z });
}

/**
 * Validated per-type amounts: known types only, finite and ≥ 0, rounded to hundredths, zeros dropped,
 * in canonical type order. Throws a RangeError naming `what` otherwise.
 */
export function normalizeAmounts(what: string, amounts: DamageAmounts): DamageAmounts {
  for (const key of Object.keys(amounts)) {
    if (!isDamageType(key)) throw new RangeError(`${what}: unknown damage type "${key}"`);
  }
  const out: Partial<Record<DamageType, number>> = {};
  for (const type of DAMAGE_TYPES) {
    const value = amount(`${what}.${type}`, amounts[type]);
    if (value > 0) out[type] = value;
  }
  return Object.freeze(out);
}

/** Sorted, de-duplicated tags; throws for an empty tag. */
export function normalizeTags(tags: readonly string[]): readonly string[] {
  if (tags.includes('')) {
    throw new RangeError('damage tags must be non-empty strings');
  }
  return Object.freeze([...new Set(tags)].sort((a, b) => (a < b ? -1 : 1)));
}

/**
 * A validated, defaulted, frozen copy of `input`. Throws a RangeError for an unknown damage type, a
 * negative or non-finite amount, a bad entity id, a non-finite vector or an empty tag.
 */
export function createDamagePacket(input: DamagePacketInput): DamagePacket {
  const packet: DamagePacket = {
    instigator: entityOrNull('instigator', input.instigator),
    source: entityOrNull('source', input.source),
    amounts: normalizeAmounts('amounts', input.amounts),
    poiseDamage: amount('poiseDamage', input.poiseDamage),
    staminaDamage: amount('staminaDamage', input.staminaDamage),
    impulse: input.impulse === undefined ? ZERO : vector('impulse', input.impulse),
    impactForce: amount('impactForce', input.impactForce),
    ...(input.direction !== undefined && { direction: vector('direction', input.direction) }),
    ...(input.region !== undefined && { region: input.region }),
    regionMultiplier: multiplier(input.regionMultiplier),
    ...(input.armor !== undefined && { armor: rating('armor', input.armor) }),
    ...(input.penetration !== undefined && {
      penetration: rating('penetration', input.penetration),
    }),
    tags: normalizeTags(input.tags ?? []),
  };
  return Object.freeze(packet);
}

/** Sum of `amounts` in points (exact to the hundredth). */
export function totalDamage(amounts: DamageAmounts): number {
  let units = 0;
  for (const type of DAMAGE_TYPES) units += toUnits(amounts[type] ?? 0);
  return fromUnits(units);
}
