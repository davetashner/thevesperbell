// Acoustic surfaces (mw-e09.4): what a position sounds like underfoot. `surfaceAt` answers with a
// material (an audio bible §7.3 surface id) and its loudness in dB relative to stone, from, in order:
//
//   1. the tagged surface region holding the position (a carpet on a wooden floor): the highest
//      `priority` wins, the first listed wins a tie, so overlaps are deterministic. The material is
//      the region's surface and its offset comes from the surface table.
//   2. otherwise the ground collider under the feet, when the caller has read one: its material
//      property and that material's own `footstepLoudness` (mw-e02.11).
//   3. otherwise the default, stone (0 dB), with a dev warning, once per map (the untagged area is
//      one implicit region).
//
// Wet and frozen state come from the ground collider's properties in every case (the state belongs
// to the floor, so a frozen board under a carpet region still reads frozen) and add the controller
// profile's `stealth.surfaces` modifiers, so a surface that gains the frozen property gets louder
// without anything being re-tagged. Nothing here is noise: the footstep
// noise rule (mw-e09.5) reads the result. Pure, deterministic and replay-safe; warnings go to the
// `warn` the host injects, never the console.

import type { AcousticSurface, Frozen, FootstepSurfaces } from '@content/index';
import {
  footSurface,
  type FootSurface,
  type GroundReading,
  type SurfaceOffsets,
} from '../character/footsteps';
import type { Vec3 } from '../stimulus/shapes';

/** A box tagged with a surface, in metres. */
export interface SurfaceRegion {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  /** Surface id (a row of the surface table). */
  readonly surface: string;
  readonly priority: number;
}

/** What `createSurfaceMap` needs. */
export interface SurfaceMapOptions {
  /** The surface table: surface id → acoustics. */
  readonly table: ReadonlyMap<string, AcousticSurface>;
  /** The scene's tagged boxes, in scene order. */
  readonly regions?: readonly SurfaceRegion[];
  /** The surface an untagged position reads; default `stone`. */
  readonly fallback?: string;
  /** Dev warnings (the default was used), once per map. */
  readonly warn?: (message: string) => void;
}

/** A scene's surface regions with the table they read, and the once-only warning state. */
export interface SurfaceMap {
  readonly table: ReadonlyMap<string, AcousticSurface>;
  readonly regions: readonly SurfaceRegion[];
  readonly fallback: string;
  /** Reports the untagged default; only the first call speaks. */
  readonly warnDefault: (position: Vec3) => void;
}

/** Where a reading's surface came from. */
export type SurfaceSource = 'region' | 'ground' | 'default';

/** What `surfaceAt` answers: a footstep surface plus where it came from. */
export interface SurfaceReading extends FootSurface {
  readonly source: SurfaceSource;
  /** The region's id, when `source` is `region`. */
  readonly region?: string;
  /** The surface's table row, when it has one (a ground material without a row has none). */
  readonly acoustics?: AcousticSurface;
}

/**
 * The map of `options.regions` over `options.table`.
 * @throws RangeError for a region naming a surface the table lacks, or a fallback it lacks.
 */
export function createSurfaceMap(options: SurfaceMapOptions): SurfaceMap {
  const { table, regions = [], fallback = 'stone' } = options;
  if (!table.has(fallback)) throw new RangeError(`surface table has no fallback "${fallback}"`);
  for (const region of regions) {
    if (!table.has(region.surface)) {
      throw new RangeError(
        `surface region "${region.id}" names unknown surface "${region.surface}"`,
      );
    }
  }
  let warned = false;
  return {
    table,
    regions,
    fallback,
    warnDefault: (position) => {
      if (warned || options.warn === undefined) return;
      warned = true;
      options.warn(
        `surfaces: no surface tag at (${String(position.x)}, ${String(position.y)}, ${String(position.z)}); defaulting to ${fallback}`,
      );
    },
  };
}

const inside = (r: SurfaceRegion, p: Vec3): boolean =>
  p.x >= r.min.x &&
  p.x <= r.max.x &&
  p.y >= r.min.y &&
  p.y <= r.max.y &&
  p.z >= r.min.z &&
  p.z <= r.max.z;

/** The region holding `position`: highest priority, then first listed; undefined when none. */
export function regionAt(map: SurfaceMap, position: Vec3): SurfaceRegion | undefined {
  let best: SurfaceRegion | undefined;
  for (const region of map.regions) {
    if (!inside(region, position)) continue;
    if (best === undefined || region.priority > best.priority) best = region;
  }
  return best;
}

const NO_GROUND = { wetness: 0, frozen: false, burning: false } as const;

/**
 * The surface at `position` (see the file header). `ground` is the collider's reading under the feet
 * when the caller has one; `groundOffsets` is its material's own loudness; `tuning` the wet and
 * frozen modifiers.
 */
export function surfaceAt(
  map: SurfaceMap,
  position: Vec3,
  tuning: Frozen<FootstepSurfaces>,
  ground?: GroundReading,
  groundOffsets?: SurfaceOffsets,
): SurfaceReading {
  const region = regionAt(map, position);
  const byTable: SurfaceOffsets = (material) => map.table.get(material)?.offsetDb;
  if (region === undefined && ground !== undefined) {
    const reading = footSurface(ground, groundOffsets ?? byTable, tuning);
    const acoustics = map.table.get(ground.material);
    return { ...reading, source: 'ground', ...(acoustics !== undefined && { acoustics }) };
  }
  if (region === undefined) map.warnDefault(position);
  const material = region?.surface ?? map.fallback;
  const reading = footSurface({ ...NO_GROUND, ...ground, material }, byTable, tuning);
  const acoustics = map.table.get(material);
  return {
    ...reading,
    source: region === undefined ? 'default' : 'region',
    ...(region !== undefined && { region: region.id }),
    ...(acoustics !== undefined && { acoustics }),
  };
}
