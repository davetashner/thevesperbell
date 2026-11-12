// Scene regions by position (mw-e25.1): which tagged boxes of a scene hold a point. The Briarwood
// is one scene-wide region (`briarwood`), so "the player stands in the Briarwood" is a region query
// that respawn rules and ambience share; a scene may nest smaller regions inside it.

import type { Vec3 } from '../stimulus/shapes';
import type { SceneRegion } from './layout';

/** The ids of the regions of `layout` that hold `p` (box edges count as inside), in scene order. */
export function regionsAt(regions: readonly SceneRegion[], p: Vec3): readonly string[] {
  return regions
    .filter(
      ({ min, max }) =>
        p.x >= min.x &&
        p.x <= max.x &&
        p.y >= min.y &&
        p.y <= max.y &&
        p.z >= min.z &&
        p.z <= max.z,
    )
    .map(({ id }) => id);
}
