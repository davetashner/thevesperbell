// Which grey-box parts a dressing model replaces on screen, and which a paint box textures (render
// only). A dressing replaces a blocking or walkable part
// whose centre lies in a dressing's `hides` box. Climbables, interactives and hazards always stay
// drawn, so a dressing never hides an affordance; colliders and navigation are untouched either way.
// Pure geometry; no three.js here.

import type { SceneDressing, ScenePaint, ScenePart } from '@sim/index';

/** True when some dressing draws `part` instead of the grey box. */
export function hiddenByDressing(
  part: Pick<ScenePart, 'purpose' | 'min' | 'max'>,
  dressings: readonly Pick<SceneDressing, 'hides'>[],
): boolean {
  if (part.purpose !== 'blocking' && part.purpose !== 'walkable') return false;
  const x = (part.min.x + part.max.x) / 2;
  const y = (part.min.y + part.max.y) / 2;
  const z = (part.min.z + part.max.z) / 2;
  return dressings.some(
    ({ hides }) =>
      hides !== undefined &&
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
