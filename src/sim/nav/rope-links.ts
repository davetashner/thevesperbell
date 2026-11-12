// Off-mesh climb links for placed ropes (mw-e10.9): a rope tied at an anchor is a way up for climbers
// (creatures with the `climb` capability and a grade-1 climb, like the player on a rope), so while it
// hangs the navmesh has a climb link between its foot and its top, both ways, and it is gone when
// the rope is. The baked mesh stays untouched; `meshWithRopeLinks` returns a copy with the links of
// the ropes hanging now appended, so the link order (and every path) is deterministic.

import type { World } from '../core/world';
import { placedRopes } from '../climb/rope-anchors';
import type { Vec3 } from '../stimulus/shapes';
import { NAV_LINK_KIND_NAMES, type NavLinkRow } from './format';
import { NavMesh } from './mesh';

/** Climb grade of a rope link: ropes are easy climbs (CLIMB_GRADE_RULES.rope.difficulty). */
export const ROPE_LINK_GRADE = 1;
/** How far from a rope's foot or top the mesh must be for the link to join it, metres. */
export const ROPE_LINK_REACH = 1.5;

const CLIMB = NAV_LINK_KIND_NAMES.indexOf('climb');

/**
 * The climb link rows (up and down) of the placed ropes of `world` on `mesh`, in anchor id order. A
 * rope whose foot or top is not within `ROPE_LINK_REACH` of the mesh makes none: nobody could get on
 * or off it.
 */
export function ropeLinkRows(mesh: NavMesh, world: World<never>): NavLinkRow[] {
  const rows: NavLinkRow[] = [];
  for (const { rope } of placedRopes(world)) {
    const { anchor, length } = rope;
    const foot = mesh.nearest(
      { ...anchor, y: anchor.y - length },
      ROPE_LINK_REACH,
      ROPE_LINK_REACH,
    );
    const top = mesh.nearest(anchor, ROPE_LINK_REACH, ROPE_LINK_REACH);
    if (foot === undefined || top === undefined || foot.poly === top.poly) continue;
    const row = (from: Vec3 & { poly: number }, to: Vec3 & { poly: number }): NavLinkRow => [
      CLIMB,
      from.poly,
      to.poly,
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      ROPE_LINK_GRADE,
    ];
    rows.push(row(foot, top), row(top, foot));
  }
  return rows;
}

/** `mesh` plus the climb links of the ropes hanging now; `mesh` itself when there are none. */
export function meshWithRopeLinks(mesh: NavMesh, world: World<never>): NavMesh {
  const rows = ropeLinkRows(mesh, world);
  return rows.length === 0
    ? mesh
    : new NavMesh({ ...mesh.data, links: [...mesh.data.links, ...rows] });
}
