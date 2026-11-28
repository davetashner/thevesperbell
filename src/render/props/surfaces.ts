// Painted surfaces for the slice's layout parts and crate (mw-va0): the pillar stone, the ivy on the
// climbable ledge and the crate face. The greybox view draws parts as flat grid-shaded boxes without
// UVs; a part that wears a painting gets box UVs in world units instead, so one tile covers the same
// number of metres on every face whatever the part's size. Each material shows its fallback colour until
// the painting loads, and keeps it if the painting never does.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright slice e2e spec.

import {
  BoxGeometry,
  Color,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { ScenePart } from '@sim/index';
import { StylizedMaterial } from '../materials/index.ts';

/** The paintings (public/assets/surface). */
export const PILLAR_URL = '/assets/surface/pillar-glenstone-01.webp';
export const IVY_URL = '/assets/surface/ivy-stone-01.webp';
export const CRATE_URL = '/assets/surface/crate-01.webp';

/**
 * The painted floor tileables a scene's surface region may name (content SURFACE_TEXTURES): where the
 * runtime file is, how many metres one tile covers, and the region's colour until it loads. Boards run
 * along the texture's v axis, which the floor patch maps to world z.
 */
export const SURFACE_TEXTURE_PAINTINGS: Readonly<
  Record<string, { readonly url: string; readonly tile: number }>
> = {
  'tex-planks-salt-bleached-01': {
    url: '/assets/texture/tex-planks-salt-bleached-01.webp',
    tile: 2,
  },
  'tex-deck-planks-caulked-01': { url: '/assets/texture/tex-deck-planks-caulked-01.webp', tile: 2 },
  // A wall tileable (content WALL_TEXTURES), laid by a scene's paint boxes: boards run horizontally.
  'tex-bulkhead-pine-01': { url: '/assets/texture/tex-bulkhead-pine-01.webp', tile: 2 },
  // Wendmouth's quay and breakwater stone, on floors and (by paint boxes) walls: courses of ~0.65 m.
  'tex-stone-breakwater-01': { url: '/assets/texture/tex-stone-breakwater-01.webp', tile: 4 },
  // The net-loft roofs: loud tin sheets (metal-grate underfoot) and quiet tar felt on battens (wood).
  'tex-roof-tin-harbour-01': { url: '/assets/texture/tex-roof-tin-harbour-01.webp', tile: 3 },
  'tex-roof-tar-harbour-01': { url: '/assets/texture/tex-roof-tar-harbour-01.webp', tile: 3 },
};

/**
 * The painted water a standing liquid wears, by spawn tag (render only); a liquid without one keeps its
 * flat colour. One tile covers `tile` metres, laid in world units so neighbouring pools meet seamlessly.
 */
export const LIQUID_TEXTURE_PAINTINGS: Readonly<
  Record<string, { readonly url: string; readonly tile: number }>
> = {
  'harbour-water': { url: '/assets/texture/tex-water-harbour-grey-01.webp', tile: 8 },
};

/** The liquid painting for a spawn's tags, if one names it. */
export function liquidPaintingFor(
  tags: readonly string[],
): { readonly url: string; readonly tile: number } | undefined {
  for (const tag of tags) {
    const painting = LIQUID_TEXTURE_PAINTINGS[tag];
    if (painting !== undefined) return painting;
  }
  return undefined;
}

/**
 * A flat liquid surface `sizeX` × `sizeZ` metres, centred on (`centreX`, `centreZ`) in the world, lying
 * in the xz plane with UVs in world units (one unit per `tile` metres).
 */
export function worldUvLiquidPlane(
  sizeX: number,
  sizeZ: number,
  centreX: number,
  centreZ: number,
  tile: number,
): BufferGeometry {
  const geometry = new PlaneGeometry(sizeX, sizeZ).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, (position.getX(i) + centreX) / tile, -(position.getZ(i) + centreZ) / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Metres one tile of the pillar stone covers: three to four block courses of about 0.3 m. */
export const PILLAR_TILE = 1.2;
/** Metres one tile of the ivy covers: about a hand-span per leaf. */
export const IVY_TILE = 1;

/** A stylized material (mw-e37.13) showing the painting at `url` (tiling when `repeat`), in `fallback` colour until it loads. */
export function paintedMaterial(url: string, fallback: number, repeat: boolean): StylizedMaterial {
  const material = new StylizedMaterial({ color: new Color(fallback), roughness: 0.85 });
  new TextureLoader().load(
    url,
    (texture) => {
      texture.colorSpace = SRGBColorSpace;
      if (repeat) {
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
      }
      material.map = texture;
      material.color.setHex(0xffffff);
      material.needsUpdate = true;
    },
    undefined,
    () => {
      // Keep the fallback colour.
    },
  );
  return material;
}

/**
 * A box part's geometry with UVs in world units: on every face one UV unit is `tile` metres, so a
 * tiling texture repeats `size / tile` times across the face. Parts that are not boxes return undefined
 * (the caller draws them as before).
 */
export function worldUvPartGeometry(part: ScenePart, tile: number): BufferGeometry | undefined {
  if (part.shape === 'wedge') return undefined;
  const { size, center, rotation } = part;
  const geometry = new BoxGeometry(size.x, size.y, size.z);
  const uv = geometry.getAttribute('uv');
  // BoxGeometry's faces, four vertices each: +x, −x, +y, −y, +z, −z, with the face's (width, height).
  const faces: readonly (readonly [number, number])[] = [
    [size.z, size.y],
    [size.z, size.y],
    [size.x, size.z],
    [size.x, size.z],
    [size.x, size.y],
    [size.x, size.y],
  ];
  faces.forEach(([width, height], face) => {
    for (let i = 0; i < 4; i++) {
      const vertex = face * 4 + i;
      uv.setXY(vertex, (uv.getX(vertex) * width) / tile, (uv.getY(vertex) * height) / tile);
    }
  });
  uv.needsUpdate = true;
  geometry.applyMatrix4(
    new Matrix4().compose(
      new Vector3(center.x, center.y, center.z),
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      new Vector3(1, 1, 1),
    ),
  );
  return geometry;
}
