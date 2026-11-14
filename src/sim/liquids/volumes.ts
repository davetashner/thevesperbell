// Liquid volumes (mw-e03.6): creating them, spilling into them, opening drains, reading levels.
// Volumes are level-based (flowing water is out of scope). Layers stack by density, densest at the
// bottom, so oil spilled on water floats on its surface because oil's material density (900) is
// below water's (1000): nothing here knows either liquid by name.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  LIQUID_COMPONENTS,
  LiquidIceComponent,
  LiquidLayerComponent,
  LiquidVolumeComponent,
  RainZoneComponent,
  type LiquidDrain,
  type LiquidFill,
  type LiquidLayer,
  type LiquidVolume,
} from './components';

/** Tuning of liquid volumes (plain data; game values). */
export interface LiquidConfig {
  /** Depth a spill spreads to on open ground, m (> 0): a puddle is thin. */
  readonly puddleDepth: number;
  /** How far above the ground a puddle's brim is, m (≥ puddleDepth). */
  readonly puddleBrim: number;
  /** Largest radius of the sphere a layer's entity is placed with, m (> 0): flames and splashes reach it. */
  readonly maxLayerRadius: number;
}

/** The default liquid tuning. */
export const DEFAULT_LIQUID_CONFIG: LiquidConfig = Object.freeze({
  puddleDepth: 0.02,
  puddleBrim: 0.1,
  maxLayerRadius: 2,
});

/** The full, validated liquid config for `input` over the defaults. Throws a RangeError. */
export function resolveLiquidConfig(input: Partial<LiquidConfig> = {}): LiquidConfig {
  const config = { ...DEFAULT_LIQUID_CONFIG, ...input };
  const positive = (n: number): boolean => n > 0 && Number.isFinite(n);
  if (!positive(config.puddleDepth)) throw new RangeError('liquid config puddleDepth must be > 0');
  if (!positive(config.maxLayerRadius)) {
    throw new RangeError('liquid config maxLayerRadius must be > 0');
  }
  if (!(config.puddleBrim >= config.puddleDepth) || !Number.isFinite(config.puddleBrim)) {
    throw new RangeError('liquid config puddleBrim must be ≥ puddleDepth');
  }
  return config;
}

/** A layer thinner than this, m, is gone (a drain leaves no film of rounding error). */
export const EMPTY = 1e-9;

/** Fired when an entity goes fully under a volume's surface (a splash). */
export interface LiquidEntry {
  readonly entity: EntityId;
  readonly volume: EntityId;
}

/** Fired when an entity that was fully under comes out (the level fell, or it moved). */
export const liquidEntered = defineEvent<LiquidEntry>('liquidEntered');
/** Fired when a submerged entity is no longer fully under. */
export const liquidEmerged = defineEvent<LiquidEntry>('liquidEmerged');

/** Makes `world` accept liquids: registers the liquid components. Once at setup, outside a step. */
export function installLiquids<W extends World<never>>(world: W): W {
  world.register(...LIQUID_COMPONENTS);
  return world;
}

/** The density of `liquid`, kg/m³, from its material preset. Throws a RangeError for a non-liquid. */
export function liquidDensity(presets: MaterialPresets, liquid: string): number {
  const preset = presets.get(liquid);
  if (preset === undefined) throw new RangeError(`unknown liquid "${liquid}"`);
  if (preset.liquid !== true) throw new RangeError(`material "${liquid}" is not a liquid`);
  return preset.density ?? WORLD_PROPERTY_SPECS.density.default;
}

/** Depth of all layers of `volume`, m. */
export function totalDepth(volume: LiquidVolume): number {
  let total = 0;
  for (const layer of volume.layers) total += layer.depth;
  return total;
}

/** The surface height of `volume`, m. */
export function levelOf(volume: LiquidVolume): number {
  return volume.min.y + totalDepth(volume);
}

/** The volume of `volume`, or an Error when `entity` is not one. */
export function volumeOf(world: World<never>, entity: EntityId): LiquidVolume {
  const volume = world.get(entity, LiquidVolumeComponent);
  if (volume === undefined) throw new Error(`entity ${String(entity)} is not a liquid volume`);
  return volume;
}

/** Entities that are liquid volumes, ascending id. */
export function liquidVolumes(world: World<never>): EntityId[] {
  const found: EntityId[] = [];
  world.query(LiquidVolumeComponent).forEach((entity) => found.push(entity));
  return found;
}

/** The slab (floor and top, m) each layer of `volume` occupies, bottom to top. */
export function layerSlabs(volume: LiquidVolume): { bottom: number; top: number }[] {
  let bottom = volume.min.y;
  return volume.layers.map((layer) => {
    const slab = { bottom, top: bottom + layer.depth };
    bottom = slab.top;
    return slab;
  });
}

/** Layers densest first, ties by liquid id. */
function byDensity(
  presets: MaterialPresets,
  layers: readonly LiquidLayer[],
): readonly LiquidLayer[] {
  return layers
    .map((layer) => ({ layer, density: liquidDensity(presets, layer.liquid) }))
    .sort((a, b) => b.density - a.density || (a.layer.liquid < b.layer.liquid ? -1 : 1))
    .map(({ layer }) => layer);
}

/** Places a layer's entity at the middle of its slab, sized to the volume (see maxLayerRadius). */
export function placeLayer(
  world: World<never>,
  config: LiquidConfig,
  volume: LiquidVolume,
  layer: LiquidLayer,
  slab: { bottom: number; top: number },
): void {
  const halfX = (volume.max.x - volume.min.x) / 2;
  const halfZ = (volume.max.z - volume.min.z) / 2;
  const radius = Math.min(
    config.maxLayerRadius,
    Math.max(halfX, halfZ, (slab.top - slab.bottom) / 2),
  );
  const x = volume.min.x + halfX;
  const y = (slab.bottom + slab.top) / 2;
  const z = volume.min.z + halfZ;
  const at = world.get(layer.entity, PlacementComponent);
  if (at?.x === x && at.y === y && at.z === z && at.radius === radius) return;
  placeEntity(world, layer.entity, { x, y, z }, radius);
}

/** Spawns the entity carrying a layer of `liquid` in `volume`. */
function spawnLayerEntity(
  world: World<never>,
  presets: MaterialPresets,
  volume: EntityId,
  liquid: string,
): EntityId {
  const entity = world.spawn();
  addMaterialProperties(world, entity, presets, { material: liquid });
  world.add(entity, LiquidLayerComponent, { volume });
  return entity;
}

/** What `createVolume` needs. */
export interface VolumeSpec {
  /** Corners, m: `min.y` is the floor, `max.y` the brim. */
  readonly min: Vec3;
  readonly max: Vec3;
  /** What it holds at the start, any order (stacked by density). */
  readonly layers?: readonly { readonly liquid: string; readonly depth: number }[];
  readonly drain?: LiquidDrain;
  readonly fill?: LiquidFill;
  /** An existing entity to make the volume (a scene spawn, so signals and code can name it); default a new one. */
  readonly entity?: EntityId;
}

function checkBox(min: Vec3, max: Vec3): void {
  const ok =
    [min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite) &&
    max.x > min.x &&
    max.y > min.y &&
    max.z > min.z;
  if (!ok)
    throw new RangeError('a liquid volume needs finite corners with max above min on every axis');
}

/**
 * Spawns a liquid volume. Throws a RangeError for a malformed box, an unknown or non-liquid material,
 * a non-positive depth or a start deeper than the brim. Call outside a step (or the volume and its
 * layers appear at the end of the tick).
 */
export function createVolume(
  world: World<never>,
  presets: MaterialPresets,
  spec: VolumeSpec,
  config: LiquidConfig = DEFAULT_LIQUID_CONFIG,
): EntityId {
  checkBox(spec.min, spec.max);
  const volume = spec.entity ?? world.spawn();
  const merged = new Map<string, number>();
  for (const { liquid, depth } of spec.layers ?? []) {
    if (!(depth > 0) || !Number.isFinite(depth)) throw new RangeError('a layer depth must be > 0');
    liquidDensity(presets, liquid);
    merged.set(liquid, (merged.get(liquid) ?? 0) + depth);
  }
  let total = 0;
  for (const depth of merged.values()) total += depth;
  if (total > spec.max.y - spec.min.y) throw new RangeError('a volume cannot start above its brim');
  const layers = byDensity(
    presets,
    [...merged].map(([liquid, depth]) => ({
      liquid,
      depth,
      entity: spawnLayerEntity(world, presets, volume, liquid),
      born: world.tick,
    })),
  );
  const value: LiquidVolume = {
    min: { ...spec.min },
    max: { ...spec.max },
    layers,
    ...(spec.drain === undefined ? {} : { drain: spec.drain }),
    ...(spec.fill === undefined ? {} : { fill: spec.fill }),
  };
  world.add(volume, LiquidVolumeComponent, value);
  world.add(volume, LiquidIceComponent, { cells: [], pending: [] });
  const slabs = layerSlabs(value);
  for (const [i, layer] of layers.entries()) {
    placeLayer(world, config, value, layer, slabs[i] as { bottom: number; top: number });
  }
  return volume;
}

/** Writes `volume` to `entity` (immediately: the volume entity is not structural). */
export function writeVolume(world: World<never>, entity: EntityId, volume: LiquidVolume): void {
  world.set(entity, LiquidVolumeComponent, volume);
}

/** Opens or closes a volume's drain. Throws an Error when the volume has no drain. */
export function setDrainOpen(world: World<never>, entity: EntityId, open: boolean): void {
  const volume = volumeOf(world, entity);
  if (volume.drain === undefined) throw new Error(`volume ${String(entity)} has no drain`);
  writeVolume(world, entity, { ...volume, drain: { ...volume.drain, open } });
}

/** Opens or closes a volume's fill. Throws an Error when the volume has no fill. */
export function setFillOpen(world: World<never>, entity: EntityId, open: boolean): void {
  const volume = volumeOf(world, entity);
  if (volume.fill === undefined) throw new Error(`volume ${String(entity)} has no fill`);
  writeVolume(world, entity, { ...volume, fill: { ...volume.fill, open } });
}

/**
 * Adds `depth` m of `liquid` to `volume` (at most what is left under the brim), stacked by density.
 * Returns the new volume value. The layer's entity is spawned when the liquid is new to the volume.
 */
export function addDepth(
  world: World<never>,
  presets: MaterialPresets,
  entity: EntityId,
  volume: LiquidVolume,
  liquid: string,
  depth: number,
): LiquidVolume {
  const room = volume.max.y - volume.min.y - totalDepth(volume);
  const added = Math.min(depth, room);
  if (!(added > 0)) return volume;
  const existing = volume.layers.find((layer) => layer.liquid === liquid);
  const layers =
    existing === undefined
      ? byDensity(presets, [
          ...volume.layers,
          {
            liquid,
            depth: added,
            entity: spawnLayerEntity(world, presets, entity, liquid),
            born: world.tick,
          },
        ])
      : volume.layers.map((layer) =>
          layer === existing ? { ...layer, depth: layer.depth + added } : layer,
        );
  return { ...volume, layers };
}

/** Whether the point `at` is over `volume`'s footprint and not below its floor (it falls in from above). */
export function containsPoint(volume: LiquidVolume, at: Vec3): boolean {
  return (
    at.x >= volume.min.x &&
    at.x <= volume.max.x &&
    at.z >= volume.min.z &&
    at.z <= volume.max.z &&
    at.y >= volume.min.y
  );
}

/** What `spillLiquid` did. */
export interface SpillResult {
  /** The volume that took the liquid: an existing one, or the puddle the spill made. */
  readonly volume: EntityId;
  /** Whether the spill made a new puddle. */
  readonly puddle: boolean;
}

/**
 * Spills `amount` m³ of `liquid` at `at`. Into a volume whose footprint holds the point it adds depth
 * (amount ÷ footprint area, stacked by density: oil lands on top of water); anywhere else it spreads
 * into a new square puddle puddleDepth deep on the ground at `at`. Throws a RangeError for a
 * non-positive amount or a non-liquid. Call outside a step.
 */
export function spillLiquid(
  world: World<never>,
  presets: MaterialPresets,
  spill: { readonly liquid: string; readonly amount: number; readonly at: Vec3 },
  config: LiquidConfig = DEFAULT_LIQUID_CONFIG,
): SpillResult {
  const { liquid, amount, at } = spill;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new RangeError('a spill needs amount > 0');
  liquidDensity(presets, liquid);
  for (const entity of liquidVolumes(world)) {
    const volume = volumeOf(world, entity);
    if (!containsPoint(volume, at)) continue;
    const area = (volume.max.x - volume.min.x) * (volume.max.z - volume.min.z);
    writeVolume(world, entity, addDepth(world, presets, entity, volume, liquid, amount / area));
    return { volume: entity, puddle: false };
  }
  const side = Math.sqrt(amount / config.puddleDepth);
  const volume = createVolume(
    world,
    presets,
    {
      min: { x: at.x - side / 2, y: at.y, z: at.z - side / 2 },
      max: { x: at.x + side / 2, y: at.y + config.puddleBrim, z: at.z + side / 2 },
      layers: [{ liquid, depth: config.puddleDepth }],
    },
    config,
  );
  return { volume, puddle: true };
}

/** Spawns a rain zone over the box `min`…`max` that wets everything inside at `rate` per second. */
export function createRainZone(
  world: World<never>,
  zone: { readonly min: Vec3; readonly max: Vec3; readonly rate: number; readonly on?: boolean },
): EntityId {
  checkBox(zone.min, zone.max);
  if (!(zone.rate > 0) || !Number.isFinite(zone.rate))
    throw new RangeError('rain rate must be > 0');
  const entity = world.spawn();
  world.add(entity, RainZoneComponent, {
    min: { ...zone.min },
    max: { ...zone.max },
    rate: zone.rate,
    on: zone.on ?? true,
  });
  return entity;
}

/** Turns a rain zone on or off. */
export function setRaining(world: World<never>, entity: EntityId, on: boolean): void {
  const zone = world.get(entity, RainZoneComponent);
  if (zone === undefined) throw new Error(`entity ${String(entity)} is not a rain zone`);
  world.set(entity, RainZoneComponent, { ...zone, on });
}
