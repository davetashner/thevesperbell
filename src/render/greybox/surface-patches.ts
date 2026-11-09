// Greybox look of tagged surface regions (mw-1jm): a flat coloured patch laid on the walkable floor
// inside each region, so a player can tell a carpet from boards from shingle by eye and choose a path by
// how it will sound. The patches are exactly where `surfaceAt` answers with the region: the part of a
// flat walkable piece whose top lies in the region's height range. Pure geometry; no three.js here.

import type { FootstepSurface } from '@content/index';
import type { ScenePart, SceneSurface } from '@sim/index';

/** Greybox colour code by surface (sRGB), none equal to the walkable floor's 0x8c8676. */
export const SURFACE_COLOURS: Readonly<Record<FootstepSurface, number>> = {
  stone: 0x9a9a9a,
  wood: 0x5e3a1e,
  'wood-hollow': 0x3b2615,
  dirt: 0x6e5436,
  grass: 0x5f9446,
  gravel: 0xe2dcc6,
  mud: 0x45362a,
  'water-shallow': 0x4d8fb8,
  'snow-ice': 0xe3eef5,
  'metal-grate': 0x4a4f57,
  straw: 0xd2b45c,
  carpet: 0x8a1f4e,
  'bone-litter': 0xe8e0c8,
  leaves: 0xb5702a,
  'glass-shards': 0x9fd7d0,
};

/** How far above the floor a patch is drawn, metres, so it never z-fights the tile. */
export const PATCH_LIFT = 0.012;
/** Extra lift per overlap rank, so the winning region of an overlap shows on top. */
export const PATCH_RANK_LIFT = 0.004;

/** One flat rectangle of a surface on a floor, world metres. */
export interface SurfacePatch {
  readonly region: string;
  readonly surface: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Height the patch is drawn at. */
  readonly y: number;
}

/** The patches of `regions` over the flat walkable `parts`, lowest-winning region first. */
export function surfacePatches(
  parts: readonly Pick<ScenePart, 'purpose' | 'shape' | 'min' | 'max'>[],
  regions: readonly SceneSurface[],
): readonly SurfacePatch[] {
  // Draw order: ascending priority, and a tie goes to the first listed (it wins, so it is drawn last).
  const ranked = regions
    .map((region, index) => ({ region, index }))
    .sort((a, b) => a.region.priority - b.region.priority || b.index - a.index);
  const patches: SurfacePatch[] = [];
  ranked.forEach(({ region }, rank) => {
    for (const part of parts) {
      if (part.purpose !== 'walkable' || part.shape !== 'box') continue;
      const top = part.max.y;
      if (top < region.min.y || top > region.max.y) continue;
      const minX = Math.max(part.min.x, region.min.x);
      const maxX = Math.min(part.max.x, region.max.x);
      const minZ = Math.max(part.min.z, region.min.z);
      const maxZ = Math.min(part.max.z, region.max.z);
      if (maxX <= minX || maxZ <= minZ) continue;
      patches.push({
        region: region.id,
        surface: region.surface,
        minX,
        maxX,
        minZ,
        maxZ,
        y: top + PATCH_LIFT + rank * PATCH_RANK_LIFT,
      });
    }
  });
  return patches;
}
