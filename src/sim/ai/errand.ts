// Errands (mw-8551): a creature sent to walk somewhere on the navmesh, outside its behaviour. A
// scheduled person who leaves a scene walks to an exit and is gone on arrival (`leave`); one who
// arrives is made at an exit and walks to their spot, then takes up their routine. While it is on an
// errand the AI system skips its brain (as for a conversation) and walks it here; a conversation
// holds the walk where it stands. A walk that cannot be done (no way there) is dropped and the
// creature goes back to its routine.
//
// The component is registered by the first errand and unregistered when the last ends, so a world
// that never sends anyone hashes as before. Send and end errands between sim steps or from systems
// and event listeners, like conversations.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { World } from '../core/world';
import { HealthComponent } from '../combat/damage/components';
import { isConversing } from './conversing';
import type { AiNavigation } from './navigation';
import type { Vec3 } from '../stimulus/shapes';
import { BrainComponent } from './components';
import { getIf } from './util';

/** Where a creature on an errand is going. */
export interface Errand {
  readonly goal: Vec3;
  /** It is gone on arrival (a person leaving the scene); else it takes up its routine there. */
  readonly leave: boolean;
}

/** The marker (`ai.errand`; a snapshot key, never renamed). */
export const ErrandComponent = defineComponent<Errand>('ai.errand');

/** Metres from the goal that counts as there. */
export const ERRAND_WITHIN = 0.7;

/** Walking pace, m/s, for a creature with no brain to say. */
const DEFAULT_PACE = 1.4;

/** Whether `entity` is on an errand. */
export function onErrand(world: World<never>, entity: EntityId): boolean {
  return errandOf(world, entity) !== undefined;
}

/** The agent's errand, or undefined. */
export function errandOf(world: World<never>, entity: EntityId): Errand | undefined {
  return getIf(world, entity, ErrandComponent);
}

/** Sends `entity` to `goal` (replacing any errand it was on); `leave` = gone on arrival. */
export function sendOnErrand(
  world: World<never>,
  entity: EntityId,
  goal: Vec3,
  leave: boolean,
): void {
  if (!world.isRegistered(ErrandComponent)) world.register(ErrandComponent);
  world.add(entity, ErrandComponent, Object.freeze({ goal, leave }));
}

/** Ends `entity`'s errand where it stands. Returns false when it was on none. */
export function endErrand(world: World<never>, entity: EntityId): boolean {
  if (errandOf(world, entity) === undefined) return false;
  world.remove(entity, ErrandComponent);
  world.unregisterIfEmpty(ErrandComponent);
  return true;
}

/** Walks every creature on an errand one tick (run by the AI system, before brains think). */
export function stepErrands(world: World<never>, navigation: AiNavigation, hz: number): void {
  if (!world.isRegistered(ErrandComponent)) return;
  const walkers = [...world.query(ErrandComponent).ids()];
  for (const entity of walkers) {
    const errand = errandOf(world, entity);
    if (errand === undefined || isConversing(world, entity)) continue;
    const health = getIf(world, entity, HealthComponent);
    if (health !== undefined && health.current <= 0) {
      endErrand(world, entity);
      continue;
    }
    const walk = getIf(world, entity, BrainComponent)?.gaits.walk ?? 0;
    const status = navigation.travel(world, entity, {
      goal: errand.goal,
      within: ERRAND_WITHIN,
      speed: walk > 0 ? walk : DEFAULT_PACE,
      dt: 1 / hz,
    });
    if (status === 'running') continue;
    if (status === 'success' && errand.leave) world.destroy(entity);
    else endErrand(world, entity);
  }
}
