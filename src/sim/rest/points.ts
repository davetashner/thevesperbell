// Rest point entities (mw-e27.13): what the world places and the player rests at. A rest point is an
// entity with a `RestPoint` component naming its kind (the id of a `rest-point` content entry, which
// holds the kind's rules as data) and its own id (what `rest.completed` calls the `point`). Whether a
// campfire "burns" is the fire property of the same entity; the rules read that, not the kind's name.
//
// The component registers on first use, so a world without rest points hashes as it always did.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';

/** A rest point. */
export interface RestPoint {
  /** The kind: a `rest-point` content id (`campfire`). */
  readonly kind: string;
  /** This point's id (its scene spawn id); what `rest.completed` reports as `point`. */
  readonly id: string;
}

/** The rest point component (`rest.point`; a snapshot key, never renamed). */
export const RestPointComponent = defineComponent<RestPoint>('rest.point');

/** Makes `entity` a rest point of `kind`. Structural: during a step it takes effect at the end. */
export function makeRestPoint(
  world: World<never>,
  entity: EntityId,
  kind: string,
  id: string,
): void {
  if (kind === '' || id === '') throw new RangeError('a rest point needs a kind and an id');
  if (!world.isRegistered(RestPointComponent)) world.register(RestPointComponent);
  world.add(entity, RestPointComponent, Object.freeze({ kind, id }));
}

/** The rest point `entity` is, or undefined. */
export function restPointOf(world: World<never>, entity: EntityId): RestPoint | undefined {
  return world.isRegistered(RestPointComponent) ? world.get(entity, RestPointComponent) : undefined;
}
