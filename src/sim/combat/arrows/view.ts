// What "in view" means to the arrow cap (mw-e05.7 AC-3), without a camera. The cap despawns the oldest
// resting arrow that is not in view, but a deterministic sim cannot ask the renderer: replays and
// headless runs have no camera, and the same recorded inputs must always remove the same arrows.
// So "in view" is a stand-in computed from sim state alone, the player's position and look direction
// (PlayerLook, the yaw the orbit camera follows):
//
// - within `near` of the player, in any direction: in view (the orbit camera sits behind the
//   shoulder, so what is at your feet is on screen);
// - otherwise within `far` and inside `halfAngle` either side of where the player looks: in view.
//
// Nothing here reads a camera, a clock or the renderer, so two runs of the same inputs agree. It is
// deliberately a little pessimistic: an arrow the real camera just missed counts as in view and
// goes later than one the camera cannot see.

import { CharacterController } from '../../character/system';
import type { World } from '../../core/world';
import { facing } from '../../interaction/focus';
import { cos } from '../../math';
import { PlayerLook } from '../../player/player';
import type { Vec3 } from '../../stimulus/shapes';
import type { ArrowViewRule } from './retrieval';

/** Tuning of the view stand-in. */
export interface PlayerViewSettings {
  /** Always in view within this distance, metres. */
  readonly near: number;
  /** Furthest in view along the look direction, metres. */
  readonly far: number;
  /** Half of the horizontal angle in view, radians. */
  readonly halfAngle: number;
}

/** About a screen's worth: 6 m all round, 40 m ahead within 60 degrees either side. */
export const DEFAULT_PLAYER_VIEW: PlayerViewSettings = Object.freeze({
  near: 6,
  far: 40,
  halfAngle: Math.PI / 3,
});

/** A view rule from the player's position and look yaw (see the file header). */
export function playerViewRule(settings: Partial<PlayerViewSettings> = {}): ArrowViewRule {
  const { near, far, halfAngle } = { ...DEFAULT_PLAYER_VIEW, ...settings };
  const cosHalf = cos(halfAngle);
  return (world: World<never>, position: Vec3): boolean => {
    if (!world.isRegistered(PlayerLook) || !world.isRegistered(CharacterController)) return false;
    const [player] = world.query(PlayerLook).ids();
    if (player === undefined) return false;
    const look = world.get(player, PlayerLook);
    const body = world.get(player, CharacterController);
    if (look === undefined || body === undefined) return false;
    const dx = position.x - body.position.x;
    const dz = position.z - body.position.z;
    const dy = position.y - body.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= near) return true;
    if (distance > far) return false;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat === 0) return true;
    const ahead = facing(look.yaw);
    return (ahead.x * dx + ahead.z * dz) / flat >= cosHalf;
  };
}
