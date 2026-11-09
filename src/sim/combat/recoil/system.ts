// Wall recoil (mw-e04.15): a halberd rules a hall but clangs off corridor walls. After the hit-volume
// system has swept a fighter's open hitboxes, this system asks whether any of them has struck solid
// level geometry. A hitbox recoils when all of these hold (the numbers are the `reach-class` table's):
//
// - its move is a horizontal swing (vertical swings and thrusts never recoil) of a reach class the
//   table lists for recoil (long today, medium once the owner decides, mw-d4n: a dagger or mace never clangs);
// - it is still in the first half of its active window: active ticks 1 … ceil(active / 2);
// - it has struck no creature, now or on an earlier tick. The hit-volume system runs first, so a
//   creature struck on the very tick the blade meets the wall wins and the swing carries on; a
//   creature a dodge made untouchable counts as struck, since the blade reached it first;
// - its blade meets static geometry. The blade is probed with two rays through the collision world:
//   along the blade's axis (handle to point, so a blade swung into a wall edge-on or begun inside
//   one is caught) and along the path the point travelled this tick, cast back from where it is now so a wall it passed
//   through is met at its surface (so a fast arc cannot skip a
//   thin wall). Only level geometry counts: a collider the world says is not static (a crate, a
//   door, a platform) never recoils a swing.
//
// Recoil interrupts the move (`interruptAction`: its hitbox closes, the stamina it cost is kept) and
// locks the fighter for the table's ticks (30), then emits WallRecoil with the contact point. The
// system runs for every fighter by default; `recoils` narrows it (the knight's weapons clang, a
// brute's club is its own business). A hit-stopped fighter's hitboxes did not sweep this tick and are
// skipped. The blade's radius is not probed: the axis and the tip path stand for the volume.

import type { MoveTable, ReachTable } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import type { CollisionHit, CollisionWorld } from '../../character/collision-world';
import type { GeomShape } from '../../geom';
import { PlacementComponent } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { HealthComponent } from '../damage/components';
import { HitboxComponent, type LiveHitbox } from '../hits/components';
import { isHitStopped } from '../hitstop/components';
import { actionOf, interruptAction } from '../timeline/timeline';
import { WallRecoil } from './events';

/** What wall recoil needs. */
export interface WallRecoilOptions {
  /** Every move the fighters may perform (`compileMoves`). */
  readonly moves: MoveTable;
  /** The reach-class table (`compileReachClasses`): which swings recoil, and for how long. */
  readonly reach: ReachTable;
  /** The level the blade is probed against (RapierCollisionWorld in the game). */
  readonly collision: Pick<CollisionWorld, 'raycast' | 'isStatic'>;
  /** Which fighters recoil; defaults to all of them. */
  readonly recoils?: (world: World<never>, entity: EntityId) => boolean;
}

/** The last active tick (1-based) of a window of `active` ticks that counts as its first half. */
export function recoilWindowTicks(active: number): number {
  return Math.ceil(active / 2);
}

/** Where a blade met a wall. */
interface Contact {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/** The first static geometry the ray `from` → `to` meets, or undefined. */
function cast(
  collision: WallRecoilOptions['collision'],
  from: Vec3,
  to: Vec3,
): Contact | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length === 0) return undefined;
  const direction = { x: dx / length, y: dy / length, z: dz / length };
  const hit: CollisionHit | undefined = collision.raycast(from, direction, length);
  if (hit === undefined) return undefined;
  if (collision.isStatic?.(hit.body) === false) return undefined;
  return { point: hit.point, normal: hit.normal };
}

/** The blade's axis in `shape`, handle to point, or undefined for a shape with no axis. */
const axisOf = (shape: GeomShape): readonly [Vec3, Vec3] | undefined =>
  shape.kind === 'capsule' ? [shape.from, shape.to] : undefined;

/** Where `hitbox`, swept this tick, meets static geometry, or undefined. */
function contactOf(
  collision: WallRecoilOptions['collision'],
  hitbox: LiveHitbox,
): Contact | undefined {
  const { sweptFrom, pose } = hitbox;
  if (sweptFrom === null || pose === null) return undefined;
  const now = axisOf(pose);
  if (now === undefined) return undefined;
  const before = axisOf(sweptFrom);
  return (
    cast(collision, now[0], now[1]) ??
    (before === undefined ? undefined : cast(collision, now[1], before[1]))
  );
}

/**
 * The wall recoil system (see the file header). Run it right after the hit-volume system. Register
 * the hit-volume, timeline and placement components first.
 */
export function wallRecoilSystem<TInput>(options: WallRecoilOptions): System<TInput> {
  const { moves, reach, collision, recoils = () => true } = options;
  /** Whether `hitbox` of `entity` may recoil this tick: the rule's move, window and creature tests. */
  const clangs = (w: World<never>, entity: EntityId, hitbox: LiveHitbox): boolean => {
    const blade = moves.get(hitbox.id)?.hitbox;
    return (
      blade?.swing === 'horizontal' &&
      reach.wallRecoil.reaches.has(blade.reach) &&
      hitbox.elapsed >= 1 &&
      hitbox.elapsed <= recoilWindowTicks(hitbox.activeTicks) &&
      hitbox.hit.length === 0 &&
      actionOf(w, entity)?.move === hitbox.id
    );
  };
  return {
    name: 'wall-recoil',
    run: ({ world }) => {
      const w: World<never> = world;
      w.query(HitboxComponent, PlacementComponent).forEach((entity, set) => {
        const health = w.get(entity, HealthComponent);
        if ((health !== undefined && health.current <= 0) || isHitStopped(w, entity)) return;
        if (!recoils(w, entity)) return;
        for (const hitbox of set.live) {
          if (!clangs(w, entity, hitbox)) continue;
          const contact = contactOf(collision, hitbox);
          if (contact === undefined) continue;
          interruptAction(w, entity, reach.wallRecoil.ticks);
          w.events.emit(WallRecoil, {
            tick: w.tick,
            entity,
            move: hitbox.id,
            activeTick: hitbox.elapsed,
            point: contact.point,
            normal: contact.normal,
            ticks: reach.wallRecoil.ticks,
          });
          return;
        }
      });
    },
  };
}
