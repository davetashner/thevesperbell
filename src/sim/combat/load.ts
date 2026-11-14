// What armor weight does to the wearer's fighting (mw-e04.16, ADR-0003). The load class itself is
// derived once, by the equipment rules (`EquipmentRules.state`: ratio, class, noise); nothing here
// recomputes it. This file applies it:
//
//   roll           the dodge system picks a roll by class (dodge.ts, `loadClassOf` feeds it): Light
//                  3.6 m / 13 i-frames / 36 ticks, Medium 3.0 / 11 / 40, Heavy 2.2 / 9 / 46,
//                  Overloaded a 20-tick stumble with no i-frames. An actor with no equipment keeps
//                  its own roll, untouched.
//   stamina        regen × 1.0 / 1.0 / 0.85 / 0.7 (Light / Medium / Heavy / Overloaded), and no sprint
//                  while Overloaded (`StaminaProfile.noSprint`).
//   absorption     the sum of the worn pieces' flat absorption becomes the actor's armor (it owns
//                  `Resistances.armor` once it has equipment); the damage model's armor stage takes
//                  it off every hit.
//   poise          the pieces' poise bonus is added to the actor's maximum poise.
//   noise          the load class's footstep noise (1.0 / 1.3 / 1.6 / 1.8, times any item's own and
//                  clamped, i.e. `EquipmentState.noiseModifier`) is written as the actor's
//                  `CharacterEncumbrance`: the one place stealth (mw-e09.5) and footstep events read.
//
// `armorLoadSystem` runs once per tick, before the stamina and dodge systems, for every actor with
// equipment, and writes only what changed, so an actor whose gear changes nothing (no equipment, or
// pieces with no absorption or poise worn at Light or Medium load) adds nothing to the snapshot but
// its encumbrance. The poise bonus it has applied is kept in `ArmorLoadComponent` so the base poise is
// always `max − applied`.

import { defineComponent, type ComponentType, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { CharacterEncumbrance } from '../character/profile';
import {
  EquipmentComponent,
  type EquipmentRules,
  type EquipmentState,
  type LoadClass,
} from '../inventory/equipment';
import {
  DEFAULT_STAMINA_PROFILE,
  StaminaComponent,
  type Stamina,
  type StaminaProfile,
} from './stamina';
import { PoiseComponent, ResistancesComponent, type Resistances } from './damage/components';
import type { DamageAmounts } from './damage/types';

/** Stamina regen multiplier of each load class (ADR-0003). */
export const LOAD_STAMINA_REGEN: Readonly<Record<LoadClass, number>> = Object.freeze({
  light: 1,
  medium: 1,
  heavy: 0.85,
  overloaded: 0.7,
});

/** The classes that may sprint (ADR-0003: Overloaded may not). */
export const LOAD_MAY_SPRINT: Readonly<Record<LoadClass, boolean>> = Object.freeze({
  light: true,
  medium: true,
  heavy: true,
  overloaded: false,
});

/** `base` with a load class's stamina effects applied (`base` itself when they change nothing). */
export function loadStaminaProfile(base: StaminaProfile, load: LoadClass): StaminaProfile {
  const regen = LOAD_STAMINA_REGEN[load];
  if (regen === 1 && LOAD_MAY_SPRINT[load]) return base;
  return Object.freeze({
    ...base,
    regenPerSecond: base.regenPerSecond * regen,
    ...(!LOAD_MAY_SPRINT[load] && { noSprint: true as const }),
  });
}

/** The armor load an actor has applied to its poise (`combat.armor-load`; a snapshot key). */
export interface ArmorLoadApplied {
  /** Poise added to the actor's maximum so far. */
  readonly poiseBonus: number;
}

export const ArmorLoadComponent = defineComponent<ArmorLoadApplied>('combat.armor-load');

/** Options of the armor load system. */
export interface ArmorLoadOptions {
  /** The item and class definitions the load class is derived from. */
  readonly equipment: EquipmentRules;
  /** The stamina profile of an actor with no armor load (the player's own); default knight's. */
  readonly stamina?: StaminaProfile;
}

/** The armor load class of `entity` (undefined without equipment): what dodge reads. */
export function loadClassReader(
  equipment: EquipmentRules,
): (world: World<never>, entity: EntityId) => LoadClass | undefined {
  return (world, entity) => {
    if (!world.isRegistered(EquipmentComponent) || !world.has(entity, EquipmentComponent)) {
      return undefined;
    }
    return equipment.state(world, entity).loadClass;
  };
}

/** `entity`'s `type`, or undefined when it has none or the world does not know the type. */
function read<T>(world: World<never>, entity: EntityId, type: ComponentType<T>): T | undefined {
  return world.isRegistered(type) ? world.get(entity, type) : undefined;
}

const sameAmounts = (a: DamageAmounts, b: DamageAmounts): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof DamageAmounts>;
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
};

function applyStamina(
  world: World<never>,
  entity: EntityId,
  state: EquipmentState,
  base: StaminaProfile,
): void {
  const pool: Stamina | undefined = read(world, entity, StaminaComponent);
  if (pool === undefined) return;
  const target = loadStaminaProfile(base, state.loadClass);
  const { profile } = pool;
  if (
    profile.regenPerSecond !== target.regenPerSecond ||
    (profile.noSprint ?? false) !== (target.noSprint ?? false)
  ) {
    world.set(entity, StaminaComponent, Object.freeze({ ...pool, profile: target }));
  }
}

function applyCombat(world: World<never>, entity: EntityId, state: EquipmentState): void {
  const resistances: Resistances | undefined = read(world, entity, ResistancesComponent);
  if (resistances !== undefined && !sameAmounts(resistances.armor, state.absorption)) {
    world.set(
      entity,
      ResistancesComponent,
      Object.freeze({ ...resistances, armor: Object.freeze({ ...state.absorption }) }),
    );
  }
  const poise = read(world, entity, PoiseComponent);
  if (poise === undefined) return;
  const applied = read(world, entity, ArmorLoadComponent)?.poiseBonus ?? 0;
  if (applied === state.poiseBonus) return;
  const max = poise.max - applied + state.poiseBonus;
  // Gaining poise tops it up by the same amount; losing it clamps what is left.
  const current = Math.min(max, Math.max(0, poise.current + state.poiseBonus - applied));
  world.set(entity, PoiseComponent, Object.freeze({ ...poise, max, current }));
  const next = Object.freeze({ poiseBonus: state.poiseBonus });
  if (read(world, entity, ArmorLoadComponent) === undefined)
    world.add(entity, ArmorLoadComponent, next);
  else world.set(entity, ArmorLoadComponent, next);
}

/**
 * Applies the armor load of every actor with equipment (see the file header). Register
 * `ArmorLoadComponent` and `CharacterEncumbrance` on the world first. Add it before the stamina,
 * dodge and locomotion systems.
 */
export function armorLoadSystem<TInput>(options: ArmorLoadOptions): System<TInput> {
  const { equipment } = options;
  const base = options.stamina ?? DEFAULT_STAMINA_PROFILE;
  return {
    name: 'armor-load',
    run: ({ world }) => {
      if (!world.isRegistered(EquipmentComponent)) return;
      const w: World<never> = world;
      for (const entity of w.query(EquipmentComponent).ids()) {
        const state = equipment.state(w, entity);
        applyStamina(w, entity, state, base);
        applyCombat(w, entity, state);
        const noise = read(w, entity, CharacterEncumbrance);
        if (noise === undefined) {
          w.add(entity, CharacterEncumbrance, Object.freeze({ noise: state.noiseModifier }));
        } else if (noise.noise !== state.noiseModifier) {
          w.set(entity, CharacterEncumbrance, Object.freeze({ noise: state.noiseModifier }));
        }
      }
    },
  };
}
