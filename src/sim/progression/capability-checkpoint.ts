// An undo point over an actor's capability grants (mw-e23.11), for the game's `LogicHost`: a
// `learnCapability` effect in a batch that fails later gives the capability back. The grants are an
// immutable value on the actor, so the snapshot is the value. Their events
// (`capability.gained`/`lost`) are held until the outermost commit and dropped on rollback (mw-e22.16).

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { LogicCheckpoint } from '../logic/types';
import { CapabilitiesComponent, capabilityGained, capabilityLost } from './capabilities';

/** Opens an undo point over `actor`'s capabilities: `rollback` restores them. */
export function capabilityCheckpoint(world: World, actor: EntityId): LogicCheckpoint {
  const saved = world.isRegistered(CapabilitiesComponent)
    ? world.get(actor, CapabilitiesComponent)
    : undefined;
  const hold = world.events.hold([capabilityGained, capabilityLost]);
  return {
    commit: () => {
      hold.commit();
    },
    rollback: () => {
      hold.rollback();
      if (saved !== undefined) world.set(actor, CapabilitiesComponent, saved);
    },
  };
}
