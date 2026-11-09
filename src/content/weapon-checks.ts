// Load-time rules for weapon reach (mw-e04.15). A weapon item declares a reach class and a moveset
// (`weapon.reach`, `weapon.moves`; a missing move is the loader's reference error). After every file
// has parsed, each move of each weapon is held to its class, so reach is a fact of the data:
//
// - the move's own `hitbox.reach` is at most the weapon's class (a spear may jab short, never
//   reach longer than it is);
// - the move's hit volume, at its widest along its socket track, reaches no farther from the fighter
//   than its class's metres (`reach-class` table), and farther than the class below it: a "long"
//   thrust that only reaches 1.5 m is mislabelled, as is a "short" mace that reaches 2.5 m.
//
// Creature moves are not weapons and are not checked. Issues name the item file.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { ItemDef } from './types/item.ts';
import { REACH_CLASSES, type MoveDef, type ReachClass } from './types/move.ts';
import type { ReachClassDef } from './types/reach-class.ts';
import type { SocketTrackDef } from './types/socket-track.ts';

/** A loaded entry with its file. */
interface Loaded<T> {
  readonly file: string;
  readonly value: T;
}

interface Vec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface Quat extends Vec {
  readonly w: number;
}

/** `v` turned by the unit quaternion `q` (plain arithmetic: identical everywhere). */
function rotate(q: Quat, v: Vec): Vec {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** How far from its origin a point lies horizontally. */
const flat = (p: Vec): number => Math.sqrt(p.x * p.x + p.z * p.z);

/** The points of a hit volume that bound it, with the radius they are grown by. */
function corners(shape: NonNullable<MoveDef['hitbox']>['shape']): {
  readonly points: readonly Vec[];
  readonly radius: number;
} {
  if (shape.kind === 'capsule') return { points: [shape.from, shape.to], radius: shape.radius };
  if (shape.kind === 'sphere') return { points: [shape.center], radius: shape.radius };
  const { center: c, halfExtents: h } = shape;
  const radius = Math.sqrt(h.x * h.x + h.y * h.y + h.z * h.z);
  return { points: [c], radius };
}

/**
 * The farthest `hitbox`'s volume gets from the fighter's origin (horizontal metres) on any key of
 * its socket `track`, the volume's radius included.
 */
export function hitboxExtent(
  hitbox: NonNullable<MoveDef['hitbox']>,
  track: { readonly keys: readonly SocketTrackDef['keys'][number][] },
): number {
  const { points, radius } = corners(hitbox.shape);
  let far = 0;
  for (const { position, rotation } of track.keys) {
    for (const point of points) {
      const turned = rotate(rotation, point);
      const placed = {
        x: turned.x + position.x,
        y: turned.y + position.y,
        z: turned.z + position.z,
      };
      far = Math.max(far, flat(placed) + radius);
    }
  }
  return far;
}

/** Slack on a class's metres: authored extents are rounded to the centimetre. */
const EXTENT_SLACK = 1e-6;

const rank = (reach: ReachClass): number => REACH_CLASSES.indexOf(reach);

/** The check: weapons' moves against their reach class (see the file header). */
export const checkWeapons: ContentCheck = (entries) => {
  const of = (type: string): readonly Loaded<unknown>[] => entries.filter((e) => e.type === type);
  const [table] = of('reach-class') as readonly Loaded<ReachClassDef>[];
  if (table === undefined) return [];
  const { metres } = table.value;
  const moves = new Map(
    (of('move') as readonly Loaded<MoveDef>[]).map((e) => [e.value.id, e.value]),
  );
  const tracks = new Map(
    (of('socket-track') as readonly Loaded<SocketTrackDef>[]).map((e) => [e.value.id, e.value]),
  );
  const issues: ContentIssue[] = [];
  for (const { file, value: item } of of('item') as readonly Loaded<ItemDef>[]) {
    if (item.category !== 'weapon') continue;
    const { reach: weaponReach } = item.weapon;
    item.weapon.moves.forEach((ref, i) => {
      const move = moves.get(ref.id);
      const track = move?.hitbox === undefined ? undefined : tracks.get(move.hitbox.track);
      if (move?.hitbox === undefined || track === undefined) return;
      const report = (message: string) =>
        issues.push({
          file,
          pointer: `/weapon/moves/${String(i)}`,
          message: `weapon "${item.id}": move "${move.id}" ${message}`,
        });
      const { reach } = move.hitbox;
      if (rank(reach) > rank(weaponReach)) {
        report(`is ${reach} reach but the weapon is ${weaponReach}`);
      }
      const extent = hitboxExtent(move.hitbox, track);
      const most = metres[reach];
      if (extent > most + EXTENT_SLACK) {
        report(`reaches ${extent.toFixed(2)} m, past its ${reach} class's ${most.toFixed(2)} m`);
      }
      const below = REACH_CLASSES[rank(reach) - 1];
      if (below !== undefined && extent <= metres[below]) {
        report(
          `reaches only ${extent.toFixed(2)} m, no farther than the ${below} class's ` +
            `${metres[below].toFixed(2)} m: it is not ${reach} reach`,
        );
      }
    });
  }
  return issues;
};
