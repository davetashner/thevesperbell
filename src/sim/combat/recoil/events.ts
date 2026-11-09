// The event wall recoil emits (mw-e04.15). Presentation turns it into sparks and a clang (the cue
// sheet maps it, mw-e28.19); the sim has already locked the fighter for `ticks`.

import type { EntityId } from '../../core/component';
import { defineEvent } from '../../core/events';
import type { Vec3 } from '../../stimulus/shapes';

/** Payload of WallRecoil. */
export interface WallRecoilInfo {
  /** World tick the blade met the wall. */
  readonly tick: number;
  /** The fighter whose swing clanged off it. */
  readonly entity: EntityId;
  /** The move (its hitbox id). */
  readonly move: string;
  /** Active tick (1-based) the blade met the wall on. */
  readonly activeTick: number;
  /** Where the blade met the wall, world space (sparks play here). */
  readonly point: Vec3;
  /** Unit surface normal of the wall at that point, pointing out of it; zero if the blade began inside. */
  readonly normal: Vec3;
  /** Ticks the fighter is locked out of acting (its action timeline is locked for them). */
  readonly ticks: number;
}

/**
 * A horizontal swing of a medium or long weapon struck solid level geometry in the first half of its
 * active window, before it struck any creature: the move ends now and the fighter cannot act for
 * `ticks`. Vertical swings, thrusts and short weapons never emit it.
 */
export const WallRecoil = defineEvent<WallRecoilInfo>('WallRecoil');
