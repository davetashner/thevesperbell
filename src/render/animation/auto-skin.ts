// Automatic skin weights for an unrigged character mesh (mw-e37.21): image-to-3D tools return a static
// mesh, but the animation runtime poses a rig by bone rotations alone. Each vertex is bound to the
// bones whose rest segments pass nearest it, weighted by inverse distance, so the mesh follows the
// grey-box rig's poses with no per-model skeleton. Pure maths (no Three.js): the render glue turns the
// result into skin attributes.

import type { Rig } from './library';

/** Influences per vertex (the glTF/Three.js skinning limit). */
export const SKIN_INFLUENCES = 4;

/** A bone's rest segment, in the rig's rest space (metres, origin at the feet). */
export interface BoneSegment {
  readonly head: readonly [number, number, number];
  readonly tail: readonly [number, number, number];
  /**
   * How far from the segment the bone's own flesh reaches, metres (default 0). A vertex within it
   * counts as touching the bone, so a thick torso bone keeps the cloth hanging beside an arm.
   */
  readonly radius?: number;
  /**
   * A vertex closer to the midline than this (|x|, metres, default 0) is out of the bone's reach: a
   * limb off to one side does not drag the cloth hanging in front of the torso.
   */
  readonly lateral?: number;
}

/** Skin attributes for a mesh: `SKIN_INFLUENCES` bone indices and weights per vertex. */
export interface SkinWeights {
  readonly indices: Uint16Array;
  readonly weights: Float32Array;
}

/** How much a limb's flesh (armour, sleeves) exceeds its thin grey-box shape. */
const LIMB_FLESH = 1.8;
/** How far inside a side bone's own x the vertices it may move can sit (see BoneSegment.lateral). */
const LATERAL_MARGIN = 0.03;

/** Fields of a bone's rest segment a model overrides to match its own shape (see fitSegments). */
export type SegmentFit = Partial<BoneSegment>;

/**
 * The rest segments with each bone named in `fits` overridden. A static mesh rarely stands in the
 * grey-box rig's pose (a knight's arms hang angled out, its legs apart), and a vertex binds to the
 * bone whose segment it is nearest, so the segment must follow the mesh, not the rig: otherwise cloth
 * hanging beside the rig's arm binds to it and is dragged along when the arm swings. Only the
 * binding changes; the bones still pivot at the rig's joints. Throws on a bone the rig lacks, so a
 * misspelt name cannot silently skip its fit.
 */
export function fitSegments(
  segments: readonly BoneSegment[],
  index: ReadonlyMap<string, number>,
  fits: Readonly<Record<string, SegmentFit>>,
): BoneSegment[] {
  const byIndex = new Map<number, SegmentFit>();
  for (const [bone, fit] of Object.entries(fits)) {
    const i = index.get(bone);
    if (i === undefined) throw new RangeError(`fitSegments: no bone "${bone}"`);
    byIndex.set(i, fit);
  }
  return segments.map((segment, i) => ({ ...segment, ...byIndex.get(i) }));
}

/**
 * The rest segment of every bone: from the bone's joint to the far end of its grey-box shape (the
 * shape's centre is half its extent from the joint). A bone without a shape is a point at its joint.
 * Its radius is half the shape's wider horizontal side, scaled up for long thin limbs.
 */
export function restSegments(rig: Rig): BoneSegment[] {
  const heads: [number, number, number][] = [];
  return rig.defs.map((def, i) => {
    const parent = rig.parents[i] ?? -1;
    const base = parent < 0 ? undefined : heads[parent];
    const head: [number, number, number] = [
      (base?.[0] ?? 0) + def.offset[0],
      (base?.[1] ?? 0) + def.offset[1],
      (base?.[2] ?? 0) + def.offset[2],
    ];
    heads.push(head);
    const c = def.shape?.center ?? [0, 0, 0];
    const size = def.shape?.size ?? [0, 0, 0];
    const side = Math.max(size[0], size[2]);
    const limb = side > 0 && size[1] >= 3 * side;
    return {
      head,
      tail: [head[0] + 2 * c[0], head[1] + 2 * c[1], head[2] + 2 * c[2]],
      radius: (side / 2) * (limb ? LIMB_FLESH : 1),
      lateral: Math.max(
        0,
        Math.min(Math.abs(head[0]), Math.abs(head[0] + 2 * c[0])) - LATERAL_MARGIN,
      ),
    };
  });
}

/** Squared distance from point (px, py, pz) to the segment `s`, less its radius (0 when inside). */
function distanceSquared(s: BoneSegment, px: number, py: number, pz: number): number {
  const [hx, hy, hz] = s.head;
  const dx = s.tail[0] - hx;
  const dy = s.tail[1] - hy;
  const dz = s.tail[2] - hz;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t =
    len2 === 0
      ? 0
      : Math.min(1, Math.max(0, ((px - hx) * dx + (py - hy) * dy + (pz - hz) * dz) / len2));
  const ex = px - (hx + t * dx);
  const ey = py - (hy + t * dy);
  const ez = pz - (hz + t * dz);
  const outside = Math.max(0, Math.sqrt(ex * ex + ey * ey + ez * ez) - (s.radius ?? 0));
  return outside * outside;
}

/**
 * Binds each vertex of `positions` (x, y, z triples) to its nearest bones. Weights fall off as
 * 1 / distance⁴ so the nearest bone dominates and joints blend over a short span; the four nearest
 * bones are kept and their weights sum to 1. `skip` lists bones no vertex may bind to (a held prop's
 * bone: its segment hangs across the body). `bones` must leave at least one bone to bind to.
 */
export function autoSkin(
  positions: ArrayLike<number>,
  bones: readonly BoneSegment[],
  skip: ReadonlySet<number> = new Set(),
): SkinWeights {
  const count = Math.floor(positions.length / 3);
  const indices = new Uint16Array(count * SKIN_INFLUENCES);
  const weights = new Float32Array(count * SKIN_INFLUENCES);
  const eps = 1e-6;
  const scored: { bone: number; w: number }[] = [];
  for (let v = 0; v < count; v++) {
    const px = positions[v * 3] ?? 0;
    const py = positions[v * 3 + 1] ?? 0;
    const pz = positions[v * 3 + 2] ?? 0;
    scored.length = 0;
    bones.forEach((bone, b) => {
      if (skip.has(b) || Math.abs(px) < (bone.lateral ?? 0)) return;
      const d2 = distanceSquared(bone, px, py, pz) + eps;
      scored.push({ bone: b, w: 1 / (d2 * d2) });
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, SKIN_INFLUENCES);
    const total = kept.reduce((sum, k) => sum + k.w, 0);
    kept.forEach((k, i) => {
      indices[v * SKIN_INFLUENCES + i] = k.bone;
      weights[v * SKIN_INFLUENCES + i] = k.w / total;
    });
  }
  return { indices, weights };
}

/**
 * Binds part of a skinned mesh to `bone` (mw-a6t: a knight's hand follows its wrist bone, so the hand
 * and the sword it holds turn together). `share(x, y, z)` gives how much of a vertex, 0 to 1, moves
 * with `bone`: its other weights shrink by that, and `bone` takes the share, in place of the vertex's
 * lightest influence when all four are in use. Changes `skin` in place; weights still sum to 1.
 */
export function bindRegion(
  skin: SkinWeights,
  positions: ArrayLike<number>,
  bone: number,
  share: (x: number, y: number, z: number) => number,
): void {
  const count = Math.floor(positions.length / 3);
  for (let v = 0; v < count; v++) {
    const t = Math.min(
      1,
      Math.max(
        0,
        share(positions[v * 3] ?? 0, positions[v * 3 + 1] ?? 0, positions[v * 3 + 2] ?? 0),
      ),
    );
    if (t <= 0) continue;
    const o = v * SKIN_INFLUENCES;
    let slot = -1;
    let lightest = 0;
    for (let i = 0; i < SKIN_INFLUENCES; i++) {
      const weight = skin.weights[o + i] ?? 0;
      if (skin.indices[o + i] === bone && weight > 0) slot = i;
      if (weight < (skin.weights[o + lightest] ?? 0)) lightest = i;
    }
    if (slot < 0) slot = lightest;
    // Scale every other influence so that, with `bone` at its new weight, they still sum to 1.
    let others = 0;
    for (let i = 0; i < SKIN_INFLUENCES; i++) if (i !== slot) others += skin.weights[o + i] ?? 0;
    const own = skin.indices[o + slot] === bone ? (skin.weights[o + slot] ?? 0) : 0;
    const target = own + (1 - own) * t;
    const scale = others > 0 ? (1 - target) / others : 0;
    for (let i = 0; i < SKIN_INFLUENCES; i++) {
      if (i !== slot) skin.weights[o + i] = (skin.weights[o + i] ?? 0) * scale;
    }
    skin.indices[o + slot] = bone;
    skin.weights[o + slot] = target;
  }
}
