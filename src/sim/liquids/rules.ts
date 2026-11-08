// Water and wetness rules (mw-e03.6), as element rules over world properties and the element field.
//
// - liquid.volumes: fills and drains volumes (level moves at the open fill / drain rate, a drain
//   takes the bottom layer first), forgets layers whose entity is gone (an oil slick that burnt out),
//   and keeps each layer's entity in its slab.
// - water.dry: wetness falls linearly, `1 / dryingSeconds` per second at ambient temperature, so a
//   soaked object is dry in DRYING SECONDS (120 s by default; ≤ 0.1 after 108 s). Warmth speeds it up:
//   the rate is multiplied by 1 + (temperature − ambient) / warmthScale, so beside a fire (an object
//   at 60 °C or more with the defaults) it dries at least 3× faster. Frozen things and liquids do
//   not dry.
// - liquid.submerge: an object fully under a volume's surface becomes wet (to the wetness of the
//   liquid it is in, capped by its absorbency: a submerged iron bar takes a film, a crate is soaked).
//   Entering and leaving are events.
// - rain.fall: a rain zone that is on queues a water stimulus over its box every tick, so rain wets
//   through the same stimulus API as a splash or a water arrow (and respects absorbency).
//
// Nothing here names a liquid or an object kind. Oil burns on water because the oil layer's entity is
// flammable and the water layer's is not: the fire rules do the rest.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { cellsOf } from '../elements/cells';
import type { ElementRule } from '../elements/rules';
import {
  assignProperty,
  hasProperty,
  readProperty,
  setProperty,
  WorldProperties,
} from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { boundingSphereOf, PlacementComponent } from '../stimulus/placement';
import { applyStimulus } from '../stimulus/stimulus';
import {
  LiquidLayerComponent,
  LiquidVolumeComponent,
  RainZoneComponent,
  SubmergedComponent,
  type LiquidLayer,
  type LiquidVolume,
} from './components';
import {
  addDepth,
  EMPTY,
  layerSlabs,
  liquidEmerged,
  liquidEntered,
  placeLayer,
  resolveLiquidConfig,
  totalDepth,
  writeVolume,
  type LiquidConfig,
} from './volumes';

/** Tuning of drying (plain data; game values). */
export interface DryingConfig {
  /** Seconds a saturated object takes to dry completely at ambient temperature (> 0). */
  readonly dryingSeconds: number;
  /** °C above ambient that adds one more multiple of the base drying rate (> 0). */
  readonly warmthScale: number;
}

/** The default drying tuning: dry in 120 s at 20 °C; at 60 °C (ambient + 40) 3× as fast. */
export const DEFAULT_DRYING_CONFIG: DryingConfig = Object.freeze({
  dryingSeconds: 120,
  warmthScale: 20,
});

/** The full, validated drying config for `input` over the defaults. Throws a RangeError. */
export function resolveDryingConfig(input: Partial<DryingConfig> = {}): DryingConfig {
  const config = { ...DEFAULT_DRYING_CONFIG, ...input };
  for (const key of ['dryingSeconds', 'warmthScale'] as const) {
    if (!(config[key] > 0) || !Number.isFinite(config[key])) {
      throw new RangeError(`drying config ${key} must be a finite number > 0`);
    }
  }
  return config;
}

/** The drying rate multiple at `temperature` over `ambient` (1 at or below ambient). */
export function dryingMultiple(config: DryingConfig, temperature: number, ambient: number): number {
  return 1 + Math.max(0, temperature - ambient) / config.warmthScale;
}

/** What `liquidRules` needs. */
export interface LiquidRulesOptions {
  /** Material presets (liquid densities, layer properties). */
  readonly presets: MaterialPresets;
  readonly liquid?: Partial<LiquidConfig>;
  readonly drying?: Partial<DryingConfig>;
}

/** Volumes' entities and values, ascending id. */
function volumesOf(world: World<never>): [EntityId, LiquidVolume][] {
  const found: [EntityId, LiquidVolume][] = [];
  world.query(LiquidVolumeComponent).forEach((entity, volume) => found.push([entity, volume]));
  return found;
}

/** `volume` after `seconds` of fill and drain (see the file header), without dead layers. */
function moved(
  world: World<never>,
  presets: MaterialPresets,
  entity: EntityId,
  volume: LiquidVolume,
  perTick: number,
): LiquidVolume {
  let next = volume;
  const { fill, drain } = volume;
  if (fill?.open === true && fill.rate > 0) {
    next = addDepth(world, presets, entity, next, fill.liquid, fill.rate * perTick);
  }
  if (drain?.open === true && drain.rate > 0) {
    let left = Math.min(drain.rate * perTick, totalDepth(next));
    const layers: LiquidLayer[] = [];
    for (const layer of next.layers) {
      const taken = Math.min(left, layer.depth);
      left -= taken;
      if (layer.depth - taken > EMPTY) layers.push({ ...layer, depth: layer.depth - taken });
      else world.destroy(layer.entity);
    }
    next = { ...next, layers };
  }
  return next;
}

/** Whether `layer`'s entity is still there (a layer born this very tick may not be live yet). */
const layerLives = (world: World<never>, layer: LiquidLayer): boolean =>
  world.tick <= layer.born || world.isAlive(layer.entity);

/** The volume's rule: levels, dead layers, layer placement. */
function volumesRule(options: LiquidRulesOptions, config: LiquidConfig): ElementRule {
  return {
    id: 'liquid.volumes',
    phase: 'exchange',
    run: ({ world, hz }) => {
      for (const [entity, before] of volumesOf(world)) {
        const alive = before.layers.filter((layer) => layerLives(world, layer));
        let volume = alive.length === before.layers.length ? before : { ...before, layers: alive };
        volume = moved(world, options.presets, entity, volume, 1 / hz);
        if (volume !== before) writeVolume(world, entity, volume);
        const slabs = layerSlabs(volume);
        volume.layers.forEach((layer, i) => {
          placeLayer(world, config, volume, layer, slabs[i] as { bottom: number; top: number });
        });
      }
    },
  };
}

/** Whether the entity's sphere is fully inside `volume`'s box, under the surface. */
function fullyUnder(volume: LiquidVolume, at: { x: number; y: number; z: number; radius: number }) {
  const { min, max } = volume;
  const r = at.radius;
  return (
    at.x - r >= min.x &&
    at.x + r <= max.x &&
    at.z - r >= min.z &&
    at.z + r <= max.z &&
    at.y - r >= min.y &&
    at.y + r <= min.y + totalDepth(volume)
  );
}

/** The highest wetness among the layers the sphere overlaps vertically (0: only dry liquids). */
function wettingOf(
  presets: MaterialPresets,
  volume: LiquidVolume,
  at: { y: number; radius: number },
): number {
  const slabs = layerSlabs(volume);
  let wet = 0;
  volume.layers.forEach((layer, i) => {
    const slab = slabs[i] as { bottom: number; top: number };
    if (at.y + at.radius <= slab.bottom || at.y - at.radius >= slab.top) return;
    wet = Math.max(wet, presets.get(layer.liquid)?.wetness ?? 0);
  });
  return wet;
}

function submergeRule(options: LiquidRulesOptions): ElementRule {
  return {
    id: 'liquid.submerge',
    phase: 'exchange',
    run: ({ world }) => {
      const volumes = volumesOf(world);
      if (volumes.length === 0 && world.query(SubmergedComponent).count === 0) return;
      const now = new Map<EntityId, EntityId>();
      world.query(PlacementComponent).forEach((entity, placement) => {
        if (world.has(entity, LiquidLayerComponent) || world.has(entity, LiquidVolumeComponent)) {
          return;
        }
        if (!hasProperty(world, entity, 'wetness') && !hasProperty(world, entity, 'material')) {
          return;
        }
        const at = boundingSphereOf(world, entity, placement);
        for (const [volumeId, volume] of volumes) {
          if (!fullyUnder(volume, at)) continue;
          now.set(entity, volumeId);
          const wet = Math.min(
            wettingOf(options.presets, volume, at),
            readProperty(world, entity, 'absorbency'),
          );
          if (wet > readProperty(world, entity, 'wetness')) {
            assignProperty(world, entity, 'wetness', wet);
          }
          break;
        }
      });
      const before = new Map<EntityId, EntityId>();
      world.query(SubmergedComponent).forEach((entity, { volume }) => before.set(entity, volume));
      for (const [entity, volume] of now) {
        if (before.get(entity) === volume) continue;
        world.add(entity, SubmergedComponent, { volume });
        if (!before.has(entity)) world.events.emit(liquidEntered, { entity, volume });
      }
      for (const [entity, volume] of before) {
        if (now.has(entity)) continue;
        world.remove(entity, SubmergedComponent);
        world.events.emit(liquidEmerged, { entity, volume });
      }
    },
  };
}

function dryRule(config: DryingConfig): ElementRule {
  return {
    id: 'water.dry',
    phase: 'exchange',
    run: ({ world, field, hz }) => {
      const { ambient } = field.config.temperature;
      const drying: [EntityId, number][] = [];
      world.query(WorldProperties.wetness).forEach((entity, wetness) => {
        if (wetness === 0) return;
        if (readProperty(world, entity, 'frozen') || readProperty(world, entity, 'liquid')) return;
        if (world.has(entity, SubmergedComponent)) return;
        let temperature = ambient;
        const own = world.get(entity, WorldProperties.temperature);
        const placed = world.get(entity, PlacementComponent);
        if (own !== undefined) {
          temperature = own;
        } else if (placed !== undefined) {
          const cells = cellsOf(field, placed);
          let sum = 0;
          for (const cell of cells) sum += field.read('temperature', cell);
          temperature = sum / cells.length;
        }
        const rate = dryingMultiple(config, temperature, ambient) / (config.dryingSeconds * hz);
        drying.push([entity, Math.max(0, wetness - rate)]);
      });
      for (const [entity, wetness] of drying) setProperty(world, entity, 'wetness', wetness);
    },
  };
}

const RAIN_MAX = WORLD_PROPERTY_SPECS.wetness.max;

function rainRule(): ElementRule {
  return {
    id: 'rain.fall',
    phase: 'exchange',
    run: ({ world, hz }) => {
      world.query(RainZoneComponent).forEach((_, zone) => {
        if (!zone.on) return;
        const { min, max } = zone;
        applyStimulus(world, {
          shape: {
            kind: 'box',
            center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
            halfExtents: { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 },
          },
          element: 'water',
          intensity: Math.min(RAIN_MAX, zone.rate / hz),
        });
      });
    },
  };
}

/**
 * The water rules, in the order they run (all in the exchange phase, after heat.exchange): volumes,
 * drying, submersion, rain. Add them after `fireRules` to an ElementRuleSet. Throws a RangeError for
 * an invalid config.
 */
export function liquidRules(options: LiquidRulesOptions): ElementRule[] {
  const liquid = resolveLiquidConfig(options.liquid);
  const drying = resolveDryingConfig(options.drying);
  return [volumesRule(options, liquid), dryRule(drying), submergeRule(options), rainRule()];
}
