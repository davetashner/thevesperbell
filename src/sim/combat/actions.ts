// Combat action outcomes shared by every combat rule (mw-e04.5). An action the player (or a creature)
// asks for can be refused by a rule; the refusal is an event, so the HUD can flash the stamina bar and
// audio can play a "can't" cue without polling. Stamina is the first reason; later rules (the action
// timeline, overload) add their own reasons to the union rather than defining new events.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';

/**
 * Why an action was refused: `stamina` — the pool is empty (mw-e04.5); `busy` — a buffered request
 * never became legal within the input buffer (the action timeline, mw-e04.4), or a bow draw was asked
 * for mid-move; `ammo` — the quiver has none of the selected arrow type (mw-e05.3); `traversal` —
 * the hands are busy mantling, hanging or climbing (mw-e02.33); `overloaded` — the armor load
 * forbids it (sprint while Overloaded, mw-e04.16).
 */
export type ActionRejectReason = 'stamina' | 'busy' | 'ammo' | 'traversal' | 'overloaded';

/** A refused action. */
export interface ActionRejection {
  readonly entity: EntityId;
  /** The abstract action that was refused, e.g. "attack", "dodge", "sprint" (never a raw key). */
  readonly action: string;
  readonly reason: ActionRejectReason;
  /** The tick the request was made on. */
  readonly tick: number;
}

/** Emitted once per refused request (a press, not every tick a button is held). */
export const ActionRejected = defineEvent<ActionRejection>('ActionRejected');
