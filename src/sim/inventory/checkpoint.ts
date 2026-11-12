// An undo point over an actor's pack and gold (mw-e23.11), for the game's `LogicHost`: an effect
// batch that gives, takes or pays and then fails later in the batch puts the pack back as it was.
// Inventory states are immutable values, so the snapshot is the state itself. The events the
// operations emitted stay emitted (`item.added`...): they are announcements to systems that re-read
// the pack, and a quest re-evaluated on one sees the restored pack.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { LogicCheckpoint } from '../logic/types';
import { InventoryComponent, inventoryOf } from './inventory';

/** Opens an undo point over `actor`'s pack: `rollback` restores it, `commit` keeps the changes. */
export function inventoryCheckpoint(world: World, actor: EntityId): LogicCheckpoint {
  const saved = inventoryOf(world, actor);
  return {
    commit: () => undefined,
    rollback: () => {
      if (saved !== undefined) world.set(actor, InventoryComponent, saved);
    },
  };
}
