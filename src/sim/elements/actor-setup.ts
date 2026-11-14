// Making creatures and the player actors in the element rules (mw-e03.24, see ./actors.ts). The sim
// never reads content, so the game hands it each creature's data as an `ActorSpec` and its
// material presets; `installActorElements` then
//
// - adopts every creature (and the player) that is not an actor yet, once, whenever it appears
//   (spawned, repopulated or loaded): it gets the world properties of an object of its material
//   (flesh unless its data says otherwise) overridden by its own, and the actor defaults for what
//   neither says (flammable, ignites at 450 °C, burns for 6 s); the properties it already has are
//   left alone (a player that has waded already has wetness);
// - keeps the player's `conductive` equal to its own value or any equipped item's (iron armor
//   conducts; taking it off restores the base), by the items' materials;
// - shatters a frozen creature that takes a hit hard enough: the hit's physical damage, at
//   `joulesPerPoint` J per point, reaches the ice's breaking threshold (`breaksUnder`: the frozen
//   divisor applies). The shatter is a lethal blunt packet through the damage model, so the
//   creature's `Died` fires as for any other death (loot, dissolve, music) and `actorShattered`
//   reports it for the ice debris. The player is never shattered.

import type { DamageModel } from '../combat/damage/model';
import { DamageApplied } from '../combat/damage/events';
import { PlayerCombatantComponent } from '../combat/damage/components';
import type { DamageAmounts } from '../combat/damage/types';
import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { EquipmentComponent, EQUIPMENT_SLOTS } from '../inventory/equipment';
import {
  addProperties,
  assignProperty,
  hasProperty,
  readProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { breaksUnder } from '../properties/derived';
import type { MaterialPresets } from '../properties/materials';
import { WORLD_PROPERTY_SPECS, type WorldPropertyKey } from '../properties/spec';
import { actorFuel, ActorElementsComponent, AFLAME_FUEL, type ActorElements } from './actors';
import { flameTemperatureOf, resolveFireConfig } from './fire';

/** What the game knows about one kind of actor (a creature's data, or the player's). */
export interface ActorSpec {
  /** The actor's own world properties (sparse). */
  readonly properties: WorldPropertyInit;
  /** Damage multipliers per type (0 immune … 3 vulnerable; unlisted = 1): the elements' resistances. */
  readonly resistances: DamageAmounts;
  /** Data-forced alight. */
  readonly aflame: boolean;
}

/** The material an actor has when its data names none. */
export const DEFAULT_ACTOR_MATERIAL = 'flesh';

/** Properties of an actor's material preset that carry over (its body, not an object's structure). */
const BODY_KEYS: readonly WorldPropertyKey[] = [
  'temperature',
  'flammable',
  'ignitionPoint',
  'fuel',
  'burning',
  'wetness',
  'absorbency',
  'freezePoint',
  'conductive',
];

/** What an actor has unless its data or material says otherwise. */
export const ACTOR_DEFAULTS = Object.freeze({
  flammable: true,
  ignitionPoint: 450,
  fuel: 6,
  absorbency: 0.8,
  wetness: 0,
  freezePoint: 0,
  conductive: false,
}) satisfies WorldPropertyInit;

/** Heat exchange divisor of an actor (it warms 8 times slower than a twig). */
export const ACTOR_HEAT_INERTIA = 8;
/** Temperature below which an actor is slowed by the cold, °C. */
export const ACTOR_CHILL_BELOW = 10;
/** Fraction of its speed a chilled actor keeps at its freeze point. */
export const ACTOR_CHILL_SLOWEST = 0.4;

const resistanceOf = (multipliers: DamageAmounts, type: keyof DamageAmounts): number =>
  Math.min(1, Math.max(0, 1 - (multipliers[type] ?? 1)));

/** The properties and element state of an actor of `spec` (see the file header). */
export function actorInit(
  presets: MaterialPresets,
  spec: ActorSpec,
): { properties: WorldPropertyInit; actor: ActorElements } {
  const material = spec.properties.material ?? DEFAULT_ACTOR_MATERIAL;
  const preset = presets.get(material) ?? {};
  const merged: Record<string, unknown> = { ...ACTOR_DEFAULTS };
  for (const key of BODY_KEYS) if (preset[key] !== undefined) merged[key] = preset[key];
  Object.assign(merged, spec.properties);
  // The defaults fill every key read below.
  const properties = merged as WorldPropertyInit &
    Required<Pick<WorldPropertyInit, 'fuel' | 'conductive' | 'ignitionPoint'>>;
  const fireResistance = resistanceOf(spec.resistances, 'fire');
  const baseFuel = properties.fuel;
  const actor: ActorElements = {
    fireResistance,
    coldResistance: resistanceOf(spec.resistances, 'frost'),
    shockResistance: resistanceOf(spec.resistances, 'shock'),
    aflame: spec.aflame,
    baseFuel,
    baseFragile: WORLD_PROPERTY_SPECS.fragile.default,
    baseConductive: properties.conductive,
    heatInertia: ACTOR_HEAT_INERTIA,
    chillBelow: ACTOR_CHILL_BELOW,
    chillSlowest: ACTOR_CHILL_SLOWEST,
    frozenUntil: 0,
    soaked: false,
  };
  const init: Record<string, unknown> = {
    ...properties,
    material,
    temperature: properties.temperature ?? WORLD_PROPERTY_SPECS.temperature.default,
    fuel: spec.aflame ? AFLAME_FUEL : actorFuel(actor),
  };
  if (properties.conductive) init['charge'] = 0;
  if (spec.aflame) {
    init['flammable'] = true;
    init['burning'] = true;
    init['temperature'] = flameTemperatureOf(resolveFireConfig(), properties.ignitionPoint);
  }
  return { properties: init, actor };
}

/** Gives `entity` the properties and element state of an actor of `spec` (structural). */
export function giveActor(
  world: World<never>,
  entity: EntityId,
  presets: MaterialPresets,
  spec: ActorSpec,
): void {
  const { properties, actor } = actorInit(presets, spec);
  const fresh: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!hasProperty(world, entity, key as WorldPropertyKey)) fresh[key] = value;
  }
  addProperties(world, entity, fresh);
  world.add(entity, ActorElementsComponent, Object.freeze(actor));
}

/** An actor's ice broke under a hit. */
export interface ActorShattered {
  readonly tick: number;
  readonly entity: EntityId;
}

/** Fired when a frozen actor shatters (it dies in the same tick: `Died`). */
export const actorShattered = defineEvent<ActorShattered>('actorShattered');

/** What `installActorElements` needs. */
export interface ActorElementsOptions {
  /** Material presets (the actors' bodies). */
  readonly presets: MaterialPresets;
  /** A creature's actor spec by creature id; undefined for one that is not an actor. */
  readonly creature: (id: string) => ActorSpec | undefined;
  /** The player's spec; absent: the player is not an actor. */
  readonly player?: ActorSpec;
  /** Whether an equipped item (by definition id) conducts. Absent: equipment never changes it. */
  readonly itemConductive?: (defId: string) => boolean;
  /** The damage model a shatter goes through, and its tuning; absent: frozen actors do not shatter. */
  readonly shatter?: { readonly damage: DamageModel; readonly joulesPerPoint: number };
}

const PHYSICAL: readonly (keyof DamageAmounts)[] = ['slash', 'pierce', 'blunt'];

/** Points of physical damage in `amounts`. */
function physicalDamage(amounts: DamageAmounts): number {
  return PHYSICAL.reduce((sum, type) => sum + (amounts[type] ?? 0), 0);
}

/** Largest shatter packet, as a multiple of the victim's current health (any resistance above 1%). */
const SHATTER_OVERKILL = 100;

/**
 * Wires actors into `world` (see the file header): registers the actor component, adds the adoption
 * and equipment systems (add this before the element rules run each tick) and subscribes the
 * shatter. Once per world, between steps. Returns the shatter subscription's unsubscribe.
 */
export function installActorElements<TInput>(
  world: World<TInput>,
  options: ActorElementsOptions,
): () => void {
  const w: World<never> = world;
  if (!w.isRegistered(ActorElementsComponent)) w.register(ActorElementsComponent);
  world.addSystem({
    name: 'actor-elements',
    run: ({ world: sim }) => {
      const here: World<never> = sim;
      const adopt: [EntityId, ActorSpec][] = [];
      if (here.isRegistered(CreatureComponent)) {
        here.query(CreatureComponent).forEach((entity, creature) => {
          if (here.has(entity, ActorElementsComponent)) return;
          const spec = options.creature(creature.origin.creature);
          if (spec !== undefined) adopt.push([entity, spec]);
        });
      }
      if (options.player !== undefined && here.isRegistered(PlayerCombatantComponent)) {
        const { player } = options;
        here.query(PlayerCombatantComponent).forEach((entity) => {
          if (!here.has(entity, ActorElementsComponent)) adopt.push([entity, player]);
        });
      }
      for (const [entity, spec] of adopt) giveActor(here, entity, options.presets, spec);
      const conducts = options.itemConductive;
      if (conducts === undefined || !here.isRegistered(EquipmentComponent)) return;
      here.query(EquipmentComponent, ActorElementsComponent).forEach((entity, equipment, actor) => {
        const worn = EQUIPMENT_SLOTS.some((slot) => {
          const ref = equipment.slots[slot];
          return ref !== null && conducts(ref.defId);
        });
        const value = actor.baseConductive || worn;
        assignProperty(here, entity, 'conductive', value);
      });
    },
  });
  const { shatter } = options;
  if (shatter === undefined) return () => undefined;
  return w.events.on(DamageApplied, (hit) => {
    const { target } = hit;
    if (hit.died || !w.isAlive(target) || !w.isRegistered(ActorElementsComponent)) return;
    if (!w.has(target, ActorElementsComponent) || !readProperty(w, target, 'frozen')) return;
    if (w.isRegistered(PlayerCombatantComponent) && w.has(target, PlayerCombatantComponent)) return;
    const energy = physicalDamage(hit.amounts) * shatter.joulesPerPoint;
    if (energy <= 0 || !breaksUnder(w, target, 'blunt', energy)) return;
    shatter.damage.apply(w, target, {
      amounts: { blunt: hit.healthAfter * SHATTER_OVERKILL },
      instigator: hit.packet.instigator,
      source: hit.packet.source,
      tags: ['shatter'],
    });
    w.events.emit(actorShattered, { tick: w.tick, entity: target });
  });
}
