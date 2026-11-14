// Tying and untying ropes through Interact (mw-e10.9): the rules over the anchors of ./rope-anchors.ts.
// Level content gives each `rope-anchor` spawn two affordances through its `interact`: `climb` ("Tie
// rope", requiring the rope item) and `release` ("Untie rope"). Tying spends one rope item and unties
// give it back; the two are gated on whether the anchor has a rope.

import type { World } from '../core/world';
import { addAffordanceGate, interacted } from '../interaction/system';
import type { InventoryRules } from '../inventory/inventory';
import type { WorldPropertyInit } from '../properties/components';
import { placeRope, retrieveRope, RopeAnchorComponent, ropeAt } from './rope-anchors';

/** What rope placement runs on. */
export interface RopePlacementOptions {
  readonly inventory: InventoryRules;
  /** The rope item's id; the anchors' "Tie rope" affordance should require it. */
  readonly item: string;
  /** How far the rope hangs, metres (the item's `rope.length`). */
  readonly length: number;
  /** The properties a rope has (its material), so it burns and climbs like rope. */
  readonly properties?: WorldPropertyInit;
}

/**
 * Lets actors tie and untie ropes at anchors through the Interact verb: `climb` on a free anchor ties
 * one (spending the item), `release` on an anchor with a rope unties it (giving the item back).
 * Gates the two affordances on whether the anchor has a rope. Returns the function that stops it.
 */
export function installRopePlacement<TInput>(
  world: World<TInput>,
  options: RopePlacementOptions,
): () => void {
  const w: World<never> = world;
  let installed = true;
  const removeGate = addAffordanceGate(w, (_w, _actor, target, affordance) => {
    if (!installed || !w.isRegistered(RopeAnchorComponent) || !w.has(target, RopeAnchorComponent)) {
      return undefined;
    }
    const tied = ropeAt(w, target) !== undefined;
    if (affordance.verb === 'climb' && tied) return 'A rope is already tied here';
    if (affordance.verb === 'release' && !tied) return 'No rope tied here';
    return undefined;
  });
  const off = w.events.on(interacted, ({ actor, target, verb }) => {
    if (!installed || !w.isRegistered(RopeAnchorComponent) || !w.has(target, RopeAnchorComponent)) {
      return;
    }
    if (verb === 'climb') {
      if (ropeAt(w, target) !== undefined) return;
      if (!options.inventory.remove(w, actor, { defId: options.item, count: 1 }).ok) {
        return;
      }
      placeRope(w, target, {
        length: options.length,
        item: options.item,
        actor,
        ...(options.properties !== undefined && { properties: options.properties }),
      });
    } else if (verb === 'release') {
      const item = retrieveRope(w, target, actor);
      if (item !== undefined) options.inventory.add(w, actor, item, 1);
    }
  });
  return () => {
    installed = false;
    removeGate();
    off();
  };
}
