// Dropping the triangles an image-to-3D model got wrong (render only): Tripo cannot make thin rope, so
// the rope on the Gilded Tern's mast module (its shrouds and ratlines) came out as lumpy braided
// blobs. The mast, yards, furled sails and fighting top are fine, so the blobs are cut away when the
// model loads and the rope is drawn again from thin tubes (tern-rigging.ts). Reproducible by
// construction: the rules below are the whole edit, applied to the shipped file every time.
//
// A rule removes every triangle whose centre lies in a box of the model (its own units, before any
// turn or scale) and, when the rule has a `keep` axis, farther than its radius from the vertical line
// through it: the mast core stays, whatever hangs off it inside the box goes.

import { BufferAttribute, BufferGeometry } from 'three';

type Triple = readonly [number, number, number];

/** One cut: triangles centred in the box, and outside `keep.radius` of the axis when there is one. */
export interface StripRule {
  readonly min: Triple;
  readonly max: Triple;
  readonly keep?: { readonly x: number; readonly z: number; readonly radius: number };
}

/** Model id → the cuts its triangles take when loaded. */
export const MODEL_STRIPS: Readonly<Record<string, readonly StripRule[]>> = {
  // The mast module is 2.5 units tall with its axis on x 0.005, z 0. Below y -0.02 only the mast
  // itself (0.15 from the axis, 0.24 at its flared foot) stays; the shrouds, ratlines and chain plate
  // lumps go. The yards, sails, fighting top and the thin stays above the top are untouched.
  'model-ship-gilded-tern-rigging-01': [
    {
      min: [-1, -1.3, -1],
      max: [1, -1.0, 1],
      keep: { x: 0.005, z: 0, radius: 0.24 },
    },
    {
      min: [-1, -1.0, -1],
      max: [1, -0.02, 1],
      keep: { x: 0.005, z: 0, radius: 0.15 },
    },
  ],
  // The hull is 1.5 x 1.2 x 5.6 units. Its deck fittings (three hatches with blobby gratings, three
  // mast-step rings and the companion hutch's stowage boxes) stand along the middle of the deck: the
  // grey-box deck is drawn over the hull's own, so they would poke through as lumps. The hatch and
  // hutch are drawn from the harbour's own props instead. The bulwarks (|x| 0.45 and out) and the
  // stern castle (z -2.2 and aft) are untouched.
  'model-ship-gilded-tern-hull-01': [{ min: [-0.45, 0.12, -2.2], max: [0.45, 1, 2.4] }],
};

/** Whether `rule` removes a triangle centred at (cx, cy, cz). */
export function ruleRemoves(rule: StripRule, cx: number, cy: number, cz: number): boolean {
  const inBox =
    cx >= rule.min[0] &&
    cx < rule.max[0] &&
    cy >= rule.min[1] &&
    cy < rule.max[1] &&
    cz >= rule.min[2] &&
    cz < rule.max[2];
  if (!inBox) return false;
  return (
    rule.keep === undefined || Math.hypot(cx - rule.keep.x, cz - rule.keep.z) > rule.keep.radius
  );
}

/**
 * A copy of indexed `geometry` without the triangles any of `rules` removes, and without the vertices
 * only those triangles used (so its bounds fit what is left). Every attribute is carried over.
 */
export function stripTriangles(
  geometry: BufferGeometry,
  rules: readonly StripRule[],
): BufferGeometry {
  const index = geometry.getIndex();
  if (index === null) throw new Error('stripTriangles needs an indexed geometry');
  const position = geometry.getAttribute('position');
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)] as const;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of corners) {
      cx += position.getX(v) / 3;
      cy += position.getY(v) / 3;
      cz += position.getZ(v) / 3;
    }
    if (!rules.some((rule) => ruleRemoves(rule, cx, cy, cz))) kept.push(...corners);
  }
  const remap = new Map<number, number>();
  const reindexed: number[] = [];
  for (const v of kept) {
    let to = remap.get(v);
    if (to === undefined) {
      to = remap.size;
      remap.set(v, to);
    }
    reindexed.push(to);
  }
  const out = new BufferGeometry();
  for (const name of Object.keys(geometry.attributes)) {
    const source = geometry.getAttribute(name) as BufferAttribute;
    const array = new Float32Array(remap.size * source.itemSize);
    for (const [from, to] of remap) {
      for (let k = 0; k < source.itemSize; k++) {
        array[to * source.itemSize + k] = source.getComponent(from, k);
      }
    }
    out.setAttribute(name, new BufferAttribute(array, source.itemSize));
  }
  out.setIndex(reindexed);
  return out;
}
