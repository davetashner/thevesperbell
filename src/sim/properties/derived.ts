// Derived property queries and state invariants (mw-e03.1). Rules ask derived questions ("can this
// burn right now?") rather than re-deriving them from raw properties in every system, so the answer
// is defined once. Invariants name combinations of properties that no rule should ever leave behind
// (frozen yet above its freezing point); tests and the debug overlay check them between ticks.
// mw-e03.31 adds the queries other systems share: what breaks an object, whether a hidden object has
// been revealed, what a hanging object hangs from, and an actor's noise multiplier.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import {
  entitiesWithProperty,
  readProperty,
  setProperty,
  type PropertyWriteOptions,
} from './components';
import {
  WORLD_PROPERTY_SPECS,
  type BreakType,
  type WorldPropertyKey,
  type WorldPropertyValues,
} from './spec';

/** Properties whose value is a boolean flag. */
type FlagKey = {
  [K in WorldPropertyKey]: WorldPropertyValues[K] extends boolean ? K : never;
}[WorldPropertyKey];

/** Wetness at or above this puts fire out and stops ignition (mw-e03.5 AC-1, AC-5). */
export const SOAKED_WETNESS = 0.5;

/** Density of water, kg/m³: anything less dense floats. */
export const WATER_DENSITY = 1000;

/** Whether `entity` can catch fire right now: flammable, not soaked (wetness < 0.5) and not frozen. */
export function isFlammableNow(world: World<never>, entity: EntityId): boolean {
  return (
    readProperty(world, entity, 'flammable') &&
    readProperty(world, entity, 'wetness') < SOAKED_WETNESS &&
    !readProperty(world, entity, 'frozen')
  );
}

/** Divisor of a frozen thing's `fragile` threshold: ice is brittle (mw-e03.7). */
export const FROZEN_FRAGILITY = 3;

/** Whether `entity` floats in water (density below water's). */
export function floats(world: World<never>, entity: EntityId): boolean {
  return readProperty(world, entity, 'density') < WATER_DENSITY;
}

/**
 * Whether a single hit of kind `type` delivering `energy` J breaks `entity`: it reaches the object's
 * `fragile` threshold (any kind of hit; a frozen object's is divided by FROZEN_FRAGILITY), or the object is `breakable` and the energy reaches its
 * `toughness` for that kind (a kind without a toughness never breaks it).
 */
export function breaksUnder(
  world: World<never>,
  entity: EntityId,
  type: BreakType,
  energy: number,
): boolean {
  const fragile = readProperty(world, entity, 'fragile');
  if (energy >= (readProperty(world, entity, 'frozen') ? fragile / FROZEN_FRAGILITY : fragile)) {
    return true;
  }
  if (!readProperty(world, entity, 'breakable')) return false;
  const toughness = readProperty(world, entity, 'toughness')[type];
  return toughness !== undefined && energy >= toughness;
}

/**
 * Whether `entity` can be perceived and targeted: it is not `hidden`. Perception (senses, sight,
 * sound) and interaction targeting must skip entities for which this is false.
 */
export function isRevealed(world: World<never>, entity: EntityId): boolean {
  return !readProperty(world, entity, 'hidden');
}

/** The entities of `candidates` that are revealed (see `isRevealed`), in their original order. */
export function revealedOnly(world: World<never>, candidates: readonly EntityId[]): EntityId[] {
  return candidates.filter((entity) => isRevealed(world, entity));
}

/**
 * Reveals a hidden entity (clears `hidden`), emitting exactly one `propertyChanged` event. Returns
 * false, and emits nothing, when it was not hidden.
 */
export function reveal(
  world: World<never>,
  entity: EntityId,
  options: PropertyWriteOptions = {},
): boolean {
  // Only an entity that has `hidden` can read true (the default is false), so the set is valid.
  return (
    readProperty(world, entity, 'hidden') && setProperty(world, entity, 'hidden', false, options)
  );
}

/** `support` value meaning "hangs from nothing". */
export const NO_SUPPORT = 0;

/**
 * The live entity `entity` hangs from, or undefined when it is not `suspended`, names no support, or
 * its support no longer exists.
 */
export function supportOf(world: World<never>, entity: EntityId): EntityId | undefined {
  if (!readProperty(world, entity, 'suspended')) return undefined;
  const support = readProperty(world, entity, 'support');
  return support !== NO_SUPPORT && world.isAlive(support) ? support : undefined;
}

/**
 * An actor's noise multiplier: the product of the `noiseMultiplier` of each equipped entity (items
 * without one count as 1), clamped to the property's 0.2–3 range. Stealth scales every noise the
 * actor makes by it (plate 1.6 × a bell charm 1.2 = 1.92).
 */
export function actorNoiseMultiplier(world: World<never>, equipped: readonly EntityId[]): number {
  const { min, max } = WORLD_PROPERTY_SPECS.noiseMultiplier;
  const product = equipped.reduce(
    (total, item) => total * readProperty(world, item, 'noiseMultiplier'),
    1,
  );
  return Math.min(max, Math.max(min, product));
}

/** One broken invariant on one entity. */
export interface PropertyViolation {
  readonly entity: EntityId;
  /** Stable rule id, e.g. `frozen-above-freeze-point`. */
  readonly rule: string;
  readonly message: string;
}

interface Invariant {
  readonly rule: string;
  /** Only entities that have this property (set to true) can break the rule. */
  readonly when: FlagKey;
  /** The problem with `entity`, or undefined when it is consistent. */
  readonly check: (world: World<never>, entity: EntityId) => string | undefined;
}

/** Every invariant, checked in this order per entity. */
const INVARIANTS: readonly Invariant[] = [
  {
    rule: 'frozen-above-freeze-point',
    when: 'frozen',
    check: (world, entity) => {
      const temperature = readProperty(world, entity, 'temperature');
      const freezePoint = readProperty(world, entity, 'freezePoint');
      return temperature > freezePoint
        ? `frozen at ${String(temperature)} °C, above its freeze point ${String(freezePoint)} °C`
        : undefined;
    },
  },
  {
    rule: 'burning-while-frozen',
    when: 'burning',
    check: (world, entity) =>
      readProperty(world, entity, 'frozen') ? 'burning and frozen at once' : undefined,
  },
  {
    rule: 'burning-not-flammable',
    when: 'burning',
    check: (world, entity) =>
      readProperty(world, entity, 'flammable') ? undefined : 'burning but not flammable',
  },
  {
    rule: 'transparent-and-opaque',
    when: 'transparent',
    check: (world, entity) =>
      readProperty(world, entity, 'opaque') ? 'both transparent and opaque' : undefined,
  },
  {
    rule: 'suspended-without-support',
    when: 'suspended',
    check: (world, entity) => {
      const support = readProperty(world, entity, 'support');
      if (support === NO_SUPPORT) return 'suspended with no support';
      return world.isAlive(support)
        ? undefined
        : `suspended from entity ${String(support)}, which does not exist`;
    },
  },
  {
    rule: 'trapped-without-trap',
    when: 'trapped',
    check: (world, entity) =>
      readProperty(world, entity, 'trap') === WORLD_PROPERTY_SPECS.trap.default
        ? 'trapped with no trap definition'
        : undefined,
  },
  {
    rule: 'water-surface-not-liquid',
    when: 'waterSurface',
    check: (world, entity) =>
      readProperty(world, entity, 'liquid')
        ? undefined
        : `has a water surface but its material "${readProperty(world, entity, 'material')}" is not liquid`,
  },
];

/** Invariant rule ids, for tests and tooling. */
export const PROPERTY_INVARIANT_RULES: readonly string[] = INVARIANTS.map((i) => i.rule);

/**
 * Every entity whose properties are inconsistent, sorted by entity id then rule order. Call between
 * ticks (tests, debug overlay); an empty list means the world is consistent.
 */
export function findPropertyViolations(world: World<never>): PropertyViolation[] {
  const found: PropertyViolation[] = [];
  for (const { rule, when, check } of INVARIANTS) {
    for (const entity of entitiesWithProperty(world, when)) {
      const message = readProperty(world, entity, when) ? check(world, entity) : undefined;
      if (message !== undefined) {
        found.push({ entity, rule, message: `entity ${String(entity)} ${message}` });
      }
    }
  }
  // Stable sort: violations of one entity stay in rule order.
  return found.sort((a, b) => a.entity - b.entity);
}
