// Fire (mw-e03.5): ignition, burning, spread and extinguishing, entirely from properties and the
// element field. Nothing here knows what a torch, a haystack or a rope is:
//
// - Ignite: a flammable object that is not soaked (wetness < 0.5), not frozen, has fuel and air, and
//   whose temperature has reached its ignitionPoint catches fire (`burning`, at the end of the tick).
// - Burn: each tick a burning object spends a tick of fuel (fuel is seconds, counted in whole ticks
//   so an object with fuel F burns for exactly F seconds), stays at flame temperature, holds the
//   cells its flames reach at that temperature, puts smoke into its cell and loses structural hp.
// - Spread: nothing more. The held flame cells heat the field, the field diffuses, and a neighbour
//   warms from its own cells (heat.exchange) until it reaches its own ignition point. Wet neighbours
//   first boil dry (heat.evaporate); frozen or non-flammable ones never ignite.
// - Extinguish: soaking (wetness ≥ 0.5), cold (temperature below the ignition point), freezing and
//   smothering (too little breathable air in its cells: walls, or gas such as steam filling them)
//   put a fire out. Water on a burning object then flashes to steam as it cools (heat.evaporate).
// - Burn out: at fuel 0 the object becomes its material's burnt state from data: another material
//   (wood → charred) or nothing (straw, paper and rope burn away, and the entity is destroyed).
//
// Light from burning objects is the light field's job (mw-e03.15 reads `burning`); damage to
// creatures standing in fire is the damage model's (mw-e04.19). Fire damage here is structural hp.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import type { FieldChannel } from '../field/config';
import {
  addProperties,
  assignProperty,
  hasProperty,
  readProperty,
  setProperty,
  WorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import { isFlammableNow, SOAKED_WETNESS } from '../properties/derived';
import type { MaterialPresets } from '../properties/materials';
import { PROPERTY_ID_PATTERN, WORLD_PROPERTY_KEYS, WORLD_PROPERTY_SPECS } from '../properties/spec';
import { PlacementComponent } from '../stimulus/placement';
import { isActor, isAflame, isFireImmune } from './actors';
import { airIn, cellsInSphere, cellsOf, gasChannels, holdAtLeast } from './cells';
import { evaporationRule, heatExchangeRule, resolveHeatConfig, type HeatConfig } from './heat';
import type { ElementRule, ElementRuleContext } from './rules';

/** Tuning of the fire rules (plain data; game values). */
export interface FireConfig {
  /** Temperature a burning object and its flames hold, °C. */
  readonly flameTemperature: number;
  /** Flames are always at least this much hotter than the object's ignition point, °C (≥ 0). */
  readonly flameMargin: number;
  /** How far flames reach beyond the object's bounding sphere, m (≥ 0). */
  readonly flameReach: number;
  /** Smoke concentration a burning object puts into its cell per second (≥ 0). */
  readonly smokePerSecond: number;
  /** Gas id of smoke. */
  readonly smokeGas: string;
  /** Structural hp a burning object loses per second (≥ 0). */
  readonly burnDamagePerSecond: number;
  /** Least breathable-air fraction of its cells a fire needs to start or keep burning, [0, 1]. */
  readonly minAir: number;
}

/** The default fire tuning. */
export const DEFAULT_FIRE_CONFIG: FireConfig = Object.freeze({
  flameTemperature: 600,
  flameMargin: 200,
  flameReach: 0.75,
  smokePerSecond: 1,
  smokeGas: 'smoke',
  burnDamagePerSecond: 0.5,
  minAir: 0.2,
});

const TEMPERATURE = WORLD_PROPERTY_SPECS.temperature;

function check(ok: boolean, what: string, problem: string): void {
  if (!ok) throw new RangeError(`fire config ${what} ${problem}`);
}

const nonNegative = (n: number): boolean => n >= 0 && Number.isFinite(n);

/** The full, validated fire config for `input` over DEFAULT_FIRE_CONFIG. Throws a RangeError. */
export function resolveFireConfig(input: Partial<FireConfig> = {}): FireConfig {
  const config = { ...DEFAULT_FIRE_CONFIG, ...input };
  const { flameTemperature, flameMargin, flameReach, smokePerSecond } = config;
  check(
    flameTemperature >= TEMPERATURE.min && flameTemperature <= TEMPERATURE.max,
    'flameTemperature',
    'must be a valid temperature',
  );
  check(nonNegative(flameMargin), 'flameMargin', 'must be a finite number ≥ 0');
  check(nonNegative(flameReach), 'flameReach', 'must be a finite number ≥ 0');
  check(nonNegative(smokePerSecond), 'smokePerSecond', 'must be a finite number ≥ 0');
  check(PROPERTY_ID_PATTERN.test(config.smokeGas), 'smokeGas', 'must be a kebab-case gas id');
  check(
    nonNegative(config.burnDamagePerSecond),
    'burnDamagePerSecond',
    'must be a finite number ≥ 0',
  );
  check(config.minAir >= 0 && config.minAir <= 1, 'minAir', 'must be in [0, 1]');
  return config;
}

/**
 * Material id → what an object of that material becomes when it burns out: another material id, or
 * null when it burns away (the entity is destroyed). A material missing from the map burns away.
 */
export type BurntMaterials = ReadonlyMap<string, string | null>;

/** Why a fire went out. */
export type ExtinguishCause = 'not-flammable' | 'frozen' | 'water' | 'cold' | 'smothered';

/** An object caught fire (its `burning` becomes true at the end of this tick). */
export interface FireIgnition {
  readonly entity: EntityId;
}

/** A fire went out before its fuel was spent. */
export interface FireExtinguishing {
  readonly entity: EntityId;
  readonly cause: ExtinguishCause;
}

/** A fire spent its fuel. */
export interface FireBurnout {
  readonly entity: EntityId;
  /** The material it became, or null when it burnt away (and is destroyed at the end of the tick). */
  readonly becomes: string | null;
}

/** Fired when an object catches fire (VFX, audio, AI fear of fire, quests). */
export const fireIgnited = defineEvent<FireIgnition>('fireIgnited');
/** Fired when a fire is put out, with the cause (hiss of steam, smother puff, frost crackle). */
export const fireExtinguished = defineEvent<FireExtinguishing>('fireExtinguished');
/** Fired when a fire burns out. */
export const fireBurntOut = defineEvent<FireBurnout>('fireBurntOut');

/** What `fireRules` needs. */
export interface FireRulesOptions {
  /** Material presets (the charred state's properties come from here). */
  readonly presets: MaterialPresets;
  /** Burnt state per material. */
  readonly burnt: BurntMaterials;
  readonly heat?: Partial<HeatConfig>;
  readonly fire?: Partial<FireConfig>;
  /**
   * Objects that stay in the world, unlit and out of fuel, when they burn out without a burnt
   * material (a brazier, a lantern) instead of burning away. Absent: every such object is destroyed.
   */
  readonly keepWhenSpent?: (world: World<never>, entity: EntityId) => boolean;
}

/** The temperature a burning object with `ignitionPoint` and its flames hold. */
export function flameTemperatureOf(config: FireConfig, ignitionPoint: number): number {
  return Math.min(
    TEMPERATURE.max,
    Math.max(config.flameTemperature, ignitionPoint + config.flameMargin),
  );
}

/** Writes every value of `init` onto `entity` (see `assignProperty`), in key order. */
function assignAll(world: World<never>, entity: EntityId, init: WorldPropertyInit): void {
  for (const key of WORLD_PROPERTY_KEYS) {
    const value = init[key];
    if (value !== undefined) assignProperty(world, entity, key, value);
  }
}

/** Material → the material it burns to and that material's preset (absent: it burns away). */
export type BurntStates = ReadonlyMap<
  string,
  { readonly becomes: string; readonly preset: WorldPropertyInit }
>;

/**
 * The burnt state of every material that has one.
 * @throws RangeError for a burnt material that is not in `presets`.
 */
export function burntStatesOf(options: Pick<FireRulesOptions, 'presets' | 'burnt'>): BurntStates {
  const states = new Map<string, { becomes: string; preset: WorldPropertyInit }>();
  for (const [material, becomes] of options.burnt) {
    if (becomes === null) continue;
    const preset = options.presets.get(becomes);
    if (preset === undefined) {
      throw new RangeError(`material "${material}" burns to unknown material "${becomes}"`);
    }
    states.set(material, { becomes, preset });
  }
  return states;
}

/**
 * Burns `entity` out now (the fire rules' settle step, and persistence policies when a level
 * reloads: a fire that was burning at save time has finished by the time it loads). It stops
 * burning; an actor's fire just goes out, and anything else becomes its material's burnt state or,
 * with none, is destroyed unless `keepWhenSpent`. `silent` skips the events (loading is not play).
 */
export function burnOutEntity(
  world: World<never>,
  entity: EntityId,
  states: BurntStates,
  keepWhenSpent?: FireRulesOptions['keepWhenSpent'],
  silent = false,
): void {
  const announce = (becomes: string | null): void => {
    if (!silent) world.events.emit(fireBurntOut, { entity, becomes });
  };
  if (silent) addProperties(world, entity, { burning: false });
  else setProperty(world, entity, 'burning', false);
  if (isActor(world, entity)) {
    // An actor's fire just goes out: it is not charred or destroyed (its fuel returns when it
    // has cooled, actor.recover; mw-e03.24).
    announce(null);
    return;
  }
  const state = states.get(readProperty(world, entity, 'material'));
  if (state === undefined) {
    announce(null);
    if (keepWhenSpent?.(world, entity) !== true) world.destroy(entity);
    return;
  }
  announce(state.becomes);
  if (silent)
    addProperties(world, entity, { material: state.becomes, ...state.preset, burning: false });
  else {
    assignProperty(world, entity, 'material', state.becomes);
    assignAll(world, entity, state.preset);
  }
}

/** Breathable air around a placed entity; lazily lists the field's gas channels once per run. */
class AirProbe {
  private gases: FieldChannel[] | undefined;

  constructor(private readonly ctx: ElementRuleContext) {}

  /** Whether `entity` has at least `minAir` air (an unplaced entity is always in the open). */
  breathes(entity: EntityId, minAir: number): boolean {
    const at = this.ctx.world.get(entity, PlacementComponent);
    if (at === undefined) return true;
    this.gases ??= gasChannels(this.ctx.field);
    return airIn(this.ctx.field, cellsOf(this.ctx.field, at), this.gases) >= minAir;
  }
}

/** Why a burning entity must go out now, or undefined when it keeps burning. */
function extinguishCause(
  world: World<never>,
  entity: EntityId,
  air: AirProbe,
  minAir: number,
): ExtinguishCause | undefined {
  if (!readProperty(world, entity, 'flammable')) return 'not-flammable';
  if (readProperty(world, entity, 'frozen')) return 'frozen';
  if (readProperty(world, entity, 'wetness') >= SOAKED_WETNESS) return 'water';
  const temperature = readProperty(world, entity, 'temperature');
  if (temperature < readProperty(world, entity, 'ignitionPoint')) return 'cold';
  return air.breathes(entity, minAir) ? undefined : 'smothered';
}

/** Entities whose `burning` is true, ascending id. */
function burningEntities(world: World<never>): EntityId[] {
  const found: EntityId[] = [];
  world.query(WorldProperties.burning).forEach((entity, burning) => {
    if (burning) found.push(entity);
  });
  return found;
}

/**
 * The fire rules with the heat rules they depend on, in the order they must run: heat.exchange;
 * fire.extinguish, heat.evaporate, fire.ignite (transition); fire.burn (sustain); fire.burnout
 * (settle). Add them to an ElementRuleSet in this order. Throws a RangeError for an invalid config
 * or a burnt material that is not in `presets`.
 */
export function fireRules(options: FireRulesOptions): ElementRule[] {
  const heat = resolveHeatConfig(options.heat);
  const fire = resolveFireConfig(options.fire);
  const burntStates = burntStatesOf(options);
  const smoke = `gas:${fire.smokeGas}` as const;
  /** Entities that caught fire this tick: they start burning (and spending fuel) next tick. */
  const ignited = new Set<EntityId>();

  const extinguish: ElementRule = {
    id: 'fire.extinguish',
    phase: 'transition',
    run: (ctx) => {
      const air = new AirProbe(ctx);
      for (const entity of burningEntities(ctx.world)) {
        if (isAflame(ctx.world, entity)) continue; // data-forced fire is never put out (mw-e03.24)
        const cause = extinguishCause(ctx.world, entity, air, fire.minAir);
        if (cause === undefined) continue;
        setProperty(ctx.world, entity, 'burning', false);
        ctx.world.events.emit(fireExtinguished, { entity, cause });
      }
    },
  };

  const ignite: ElementRule = {
    id: 'fire.ignite',
    phase: 'transition',
    run: (ctx) => {
      const { world } = ctx;
      ignited.clear();
      const air = new AirProbe(ctx);
      const ready: EntityId[] = [];
      world
        .query(WorldProperties.flammable, WorldProperties.temperature)
        .forEach((entity, flammable, temperature) => {
          if (!flammable || readProperty(world, entity, 'burning')) return;
          if (temperature < readProperty(world, entity, 'ignitionPoint')) return;
          if (readProperty(world, entity, 'fuel') <= 0 || !isFlammableNow(world, entity)) return;
          if (isFireImmune(world, entity)) return; // an actor with fire resistance 1 (mw-e03.24)
          if (air.breathes(entity, fire.minAir)) ready.push(entity);
        });
      for (const entity of ready) {
        assignProperty(world, entity, 'burning', true);
        ignited.add(entity);
        world.events.emit(fireIgnited, { entity });
      }
    },
  };

  const burn: ElementRule = {
    id: 'fire.burn',
    phase: 'sustain',
    run: ({ world, field, hz }) => {
      for (const entity of burningEntities(world)) {
        if (ignited.has(entity)) continue;
        if (!isAflame(world, entity)) {
          const ticksLeft = Math.round(readProperty(world, entity, 'fuel') * hz);
          assignProperty(world, entity, 'fuel', Math.max(0, ticksLeft - 1) / hz);
        }
        const flame = flameTemperatureOf(fire, readProperty(world, entity, 'ignitionPoint'));
        if (readProperty(world, entity, 'temperature') < flame) {
          assignProperty(world, entity, 'temperature', flame);
        }
        if (hasProperty(world, entity, 'hp')) {
          const hp = readProperty(world, entity, 'hp') - fire.burnDamagePerSecond / hz;
          setProperty(world, entity, 'hp', Math.max(0, hp));
        }
        const at = world.get(entity, PlacementComponent);
        if (at === undefined) continue;
        holdAtLeast(
          field,
          'temperature',
          cellsInSphere(field, at, at.radius + fire.flameReach),
          flame,
        );
        if (fire.smokePerSecond > 0) field.addAt(smoke, at, fire.smokePerSecond / hz);
      }
    },
  };

  const burnout: ElementRule = {
    id: 'fire.burnout',
    phase: 'settle',
    run: ({ world }) => {
      for (const entity of burningEntities(world)) {
        if (readProperty(world, entity, 'fuel') > 0) continue;
        burnOutEntity(world, entity, burntStates, options.keepWhenSpent);
      }
    },
  };

  return [heatExchangeRule(heat), extinguish, evaporationRule(heat), ignite, burn, burnout];
}
