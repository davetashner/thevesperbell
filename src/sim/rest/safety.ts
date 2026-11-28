// Is it safe to rest here? (mw-e27.13) Resting is refused when something hostile is near: a living
// creature whose alert state is Searching or worse anywhere in the scene, or one that is at least
// Suspicious within `REST_HOSTILE_RADIUS` of the rest point. This is the rest-only half of the check;
// the game also asks the autosave "unsafe" veto registry (combat, hiding, dialogue, quest beats), so
// quests add their own objections in one place.

import type { AlertState } from '@content/index';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { BrainComponent } from '../ai/components';
import { zeroHealth } from '../targeting/lock-on';
import { PlacementComponent } from '../stimulus/placement';

/** Metres: a creature this close to a rest point and Suspicious (or worse) vetoes resting. */
export const REST_HOSTILE_RADIUS = 20;

/** Alert states that veto resting wherever the creature is. */
const HUNTING: ReadonlySet<AlertState> = new Set<AlertState>(['searching', 'alerted', 'combat']);

/** Why `point` is not safe to rest at, or null. */
export function restHostility(
  world: World<never>,
  point: EntityId,
  radius = REST_HOSTILE_RADIUS,
): string | null {
  if (!world.isRegistered(BrainComponent)) return null;
  const at = world.get(point, PlacementComponent);
  let reason: string | null = null;
  world.query(BrainComponent).forEach((entity, brain) => {
    if (reason !== null || brain.state === 'unaware' || zeroHealth(world, entity)) return;
    if (HUNTING.has(brain.state)) {
      reason = 'Enemies are searching for you';
      return;
    }
    const there = world.get(entity, PlacementComponent);
    if (
      at !== undefined &&
      there !== undefined &&
      Math.hypot(there.x - at.x, there.y - at.y, there.z - at.z) <= radius
    ) {
      reason = 'Something hostile is too close';
    }
  });
  return reason;
}
