// Which grey-box parts a dressing model replaces on screen, and which a paint box textures (render
// only). A dressing replaces a blocking or walkable part
// whose centre lies in a dressing's `hides` box. Interactives and hazards always stay drawn, and so do
// climbables unless the box says `climbables` (the dressing draws its own ladder), so a dressing never
// hides an affordance it does not redraw; colliders and navigation are untouched either way.
// Pure geometry; no three.js here.

import type { SceneDressing, ScenePaint, ScenePart } from '@sim/index';

/** True when some dressing draws `part` instead of the grey box. */
export function hiddenByDressing(
  part: Pick<ScenePart, 'purpose' | 'min' | 'max'>,
  dressings: readonly Pick<SceneDressing, 'hides'>[],
): boolean {
  const hideable =
    part.purpose === 'blocking' || part.purpose === 'walkable' || part.purpose === 'climbable';
  if (!hideable) return false;
  const x = (part.min.x + part.max.x) / 2;
  const y = (part.min.y + part.max.y) / 2;
  const z = (part.min.z + part.max.z) / 2;
  return dressings.some(
    ({ hides }) =>
      hides !== undefined &&
      (part.purpose !== 'climbable' || hides.climbables) &&
      x >= hides.min.x &&
      x <= hides.max.x &&
      y >= hides.min.y &&
      y <= hides.max.y &&
      z >= hides.min.z &&
      z <= hides.max.z,
  );
}

/** The wall texture a paint box lays on `part` (a blocking part whose centre lies inside), if any. */
export function paintFor(
  part: Pick<ScenePart, 'purpose' | 'min' | 'max'>,
  paints: readonly Pick<ScenePaint, 'min' | 'max' | 'texture'>[],
): string | undefined {
  if (part.purpose !== 'blocking') return undefined;
  const x = (part.min.x + part.max.x) / 2;
  const y = (part.min.y + part.max.y) / 2;
  const z = (part.min.z + part.max.z) / 2;
  return paints.find(
    (p) =>
      x >= p.min.x && x <= p.max.x && y >= p.min.y && y <= p.max.y && z >= p.min.z && z <= p.max.z,
  )?.texture;
}

/**
 * True when the grey-box parts a dressing hides should be drawn again for a camera at `point`: the
 * dressing's box says `inside` and the camera is in it (a ship's hold seen from within, where the
 * hull model's outside-only faces would leave it open).
 */
export function revealedFrom(
  point: { readonly x: number; readonly y: number; readonly z: number },
  dressing: Pick<SceneDressing, 'hides'>,
): boolean {
  const { hides } = dressing;
  return (
    hides !== undefined &&
    hides.inside &&
    point.x >= hides.min.x &&
    point.x <= hides.max.x &&
    point.y >= hides.min.y &&
    point.y <= hides.max.y &&
    point.z >= hides.min.z &&
    point.z <= hides.max.z
  );
}
