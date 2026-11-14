// Heat rules shared by every element (mw-e03.5): objects trade heat with the air around them, and hot
// wet objects boil their water off before they can get any hotter. Fire spreads through these rules
// alone: a burning crate heats its cells, the field carries the heat, a neighbour warms from its own
// cells until it reaches its ignition point. A wet neighbour sits at the boiling point while its water
// evaporates, which is why soaked things resist fire.
//
// Evaporation is latent heat: every °C of heat above the boiling point is spent drying, at
// `latentHeat` °C per unit of wetness, so a soaked object stays at 100 °C until it is dry (or a big
// enough burst of heat dries it at once). The water leaves as steam in the object's cell.

import type { EntityId } from '../core/component';
import { setProperty, WorldProperties } from '../properties/components';
import { PROPERTY_ID_PATTERN, WORLD_PROPERTY_SPECS } from '../properties/spec';
import { PlacementComponent } from '../stimulus/placement';
import { heatInertiaOf } from './actors';
import { cellsOf, exchangeWithCells } from './cells';
import type { ElementRule } from './rules';

/** Tuning of the heat rules (plain data; game values, not physical constants). */
export interface HeatConfig {
  /** Fraction of the way an object's temperature moves towards its cells' mean per tick, [0, 1]. */
  readonly exchangeRate: number;
  /** An object's heat capacity relative to the cells it occupies (≥ 0; they share its change × this). */
  readonly cellShare: number;
  /** Temperature above which wet objects dry, °C. */
  readonly boilingPoint: number;
  /** Heat spent evaporating a whole unit of wetness, °C (> 0). */
  readonly latentHeat: number;
  /** Steam concentration put into the object's cell per unit of wetness evaporated (≥ 0). */
  readonly steamYield: number;
  /** Gas id evaporated water becomes. */
  readonly steamGas: string;
}

/** The default heat tuning. */
export const DEFAULT_HEAT_CONFIG: HeatConfig = Object.freeze({
  exchangeRate: 0.05,
  cellShare: 1,
  boilingPoint: 100,
  latentHeat: 2000,
  steamYield: 1,
  steamGas: 'steam',
});

function check(ok: boolean, what: string, problem: string): void {
  if (!ok) throw new RangeError(`heat config ${what} ${problem}`);
}

const finite = (n: number): boolean => Number.isFinite(n);
const TEMPERATURE = WORLD_PROPERTY_SPECS.temperature;

/** The full, validated heat config for `input` over DEFAULT_HEAT_CONFIG. Throws a RangeError. */
export function resolveHeatConfig(input: Partial<HeatConfig> = {}): HeatConfig {
  const config = { ...DEFAULT_HEAT_CONFIG, ...input };
  const { exchangeRate, cellShare, boilingPoint, latentHeat, steamYield, steamGas } = config;
  check(exchangeRate >= 0 && exchangeRate <= 1, 'exchangeRate', 'must be in [0, 1]');
  check(cellShare >= 0 && finite(cellShare), 'cellShare', 'must be a finite number ≥ 0');
  check(
    boilingPoint >= TEMPERATURE.min && boilingPoint <= TEMPERATURE.max,
    'boilingPoint',
    'must be a valid temperature',
  );
  check(latentHeat > 0 && finite(latentHeat), 'latentHeat', 'must be a finite number > 0');
  check(steamYield >= 0 && finite(steamYield), 'steamYield', 'must be a finite number ≥ 0');
  check(PROPERTY_ID_PATTERN.test(steamGas), 'steamGas', 'must be a kebab-case gas id');
  return config;
}

/** Clamps a temperature to the property's range. */
export const clampTemperature = (t: number): number =>
  Math.min(TEMPERATURE.max, Math.max(TEMPERATURE.min, t));

/**
 * Exchange phase: every placed object with a temperature trades heat with its cells (see
 * `exchangeWithCells`), unless it is within the temperature channel's epsilon of their mean. In a quiet part of the field (its chunk absent or asleep) an object within the
 * temperature channel's epsilon of ambient settles to exactly ambient and is then skipped, like the
 * field's own calm chunks: a level full of props costs nothing until something heats up, and a fire's
 * aftermath really ends.
 */
export function heatExchangeRule(config: HeatConfig): ElementRule {
  return {
    id: 'heat.exchange',
    phase: 'exchange',
    run: ({ world, field }) => {
      const { ambient, epsilon } = field.config.temperature;
      const hot: [EntityId, number, number][] = [];
      world
        .query(WorldProperties.temperature, PlacementComponent)
        .forEach((entity, temperature, placement) => {
          const quiet = field.chunkState(field.cellOf(placement)) !== 'awake';
          if (quiet && Math.abs(temperature - ambient) <= epsilon) {
            hot.push([entity, temperature, ambient]);
            return;
          }
          const cells = cellsOf(field, placement);
          const next = exchangeWithCells(
            field,
            'temperature',
            cells,
            temperature,
            config.exchangeRate / heatInertiaOf(world, entity),
            config.cellShare,
            epsilon,
          );
          hot.push([entity, temperature, next]);
        });
      for (const [entity, before, after] of hot) {
        if (after !== before) setProperty(world, entity, 'temperature', clampTemperature(after));
      }
    },
  };
}

/**
 * Transition phase: every object with wetness and a temperature above the boiling point spends the
 * excess heat drying (see the file header), puts the steam into its cell, and keeps what is left.
 */
export function evaporationRule(config: HeatConfig): ElementRule {
  const steam = `gas:${config.steamGas}` as const;
  return {
    id: 'heat.evaporate',
    phase: 'transition',
    run: ({ world, field }) => {
      world
        .query(WorldProperties.wetness, WorldProperties.temperature)
        .forEach((entity, wetness, temperature) => {
          if (wetness === 0 || temperature <= config.boilingPoint) return;
          const dried = Math.min(wetness, (temperature - config.boilingPoint) / config.latentHeat);
          setProperty(world, entity, 'wetness', dried === wetness ? 0 : wetness - dried);
          setProperty(world, entity, 'temperature', temperature - dried * config.latentHeat);
          const at = world.get(entity, PlacementComponent);
          if (at !== undefined && config.steamYield > 0) {
            field.addAt(steam, at, dried * config.steamYield);
          }
        });
    },
  };
}
