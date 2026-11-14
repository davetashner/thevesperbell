// An undo point over an actor's pack and gold (mw-e23.11), for the game's `LogicHost`: an effect
// batch that gives, takes or pays and then fails later in the batch puts the pack back as it was.
// Inventory states are immutable values, so the snapshot is the state itself. The pack's events
// (`item.added`, `item.removed`, gold...) are held while the point is open: `commit` publishes them
// in order (to an enclosing point if there is one), `rollback` drops them, so no listener hears of
// a change that was undone (mw-e22.16).

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { LogicCheckpoint } from '../logic/types';
import {
  goldCapped,
  goldChanged,
  InventoryComponent,
  inventoryOf,
  itemAdded,
  itemFlagChanged,
  itemRemoved,
} from './inventory';

const PACK_EVENTS = [itemAdded, itemRemoved, itemFlagChanged, goldChanged, goldCapped];

/** Opens an undo point over `actor`'s pack: `rollback` restores it, `commit` keeps the changes. */
export function inventoryCheckpoint(world: World, actor: EntityId): LogicCheckpoint {
  const saved = inventoryOf(world, actor);
  const hold = world.events.hold(PACK_EVENTS);
  return {
    commit: () => {
      hold.commit();
    },
    rollback: () => {
      hold.rollback();
      if (saved !== undefined) world.set(actor, InventoryComponent, saved);
    },
  };
}
