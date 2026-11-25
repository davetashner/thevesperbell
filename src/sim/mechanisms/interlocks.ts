// Door interlocks (mw-e25.14): a door that answers to a liquid volume. The gates of a canal lock
// swing only when the water on both sides stands level, so each gate is tied to the chamber's
// water: while the chamber's depth is outside the gate's window the closed gate is jammed, and a
// player who tries it gets the usual `mechanismJammed` (the strain cue) and nothing changes. When
// the level reaches the window the gate frees itself. Level is measured, never scripted: it is
// whatever the volume's fill and drain have made it. A gate that is already open is left alone
// (it never jams shut against someone standing in it).

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { System, World } from '../core/world';
import { LiquidVolumeComponent } from '../liquids/components';
import { totalDepth } from '../liquids/volumes';
import { DoorComponent } from './components';
import { jamDoor } from './system';

/** A door tied to a liquid volume's depth (`mechanisms.interlock`; a save key, never renamed). */
export interface DoorInterlock {
  /** The liquid volume's entity. */
  readonly volume: EntityId;
  /** Shallowest the liquid may stand for the door to move, metres. */
  readonly minDepth: number;
  /** Deepest it may stand, metres; null: no limit. */
  readonly maxDepth: number | null;
}

export const InterlockComponent = defineComponent<DoorInterlock>('mechanisms.interlock');

/** Ties `door` to `volume`: it moves only while the volume's depth is within the window. */
export function makeInterlock(
  world: World<never>,
  door: EntityId,
  volume: EntityId,
  window: { readonly minDepth?: number | undefined; readonly maxDepth?: number | undefined } = {},
): void {
  world.add(door, InterlockComponent, {
    volume,
    minDepth: window.minDepth ?? 0,
    maxDepth: window.maxDepth ?? null,
  });
}

/** Whether `door`'s interlock lets it move now (true when it has none, or its volume is gone). */
export function interlockAllows(world: World<never>, door: EntityId): boolean {
  const lock = world.get(door, InterlockComponent);
  if (lock === undefined) return true;
  const volume = world.get(lock.volume, LiquidVolumeComponent);
  if (volume === undefined) return true;
  const depth = totalDepth(volume);
  return depth >= lock.minDepth && (lock.maxDepth === null || depth <= lock.maxDepth);
}

/** Jams and frees interlocked doors as their volumes' levels move. */
export function interlocksSystem<TInput>(): System<TInput> {
  return {
    name: 'door-interlocks',
    run: ({ world: w }) => {
      const world: World<never> = w;
      for (const entity of [...world.query(InterlockComponent).ids()]) {
        const door = world.get(entity, DoorComponent);
        if (door === undefined) continue;
        const allowed = interlockAllows(world, entity);
        if (allowed) jamDoor(world, entity, false);
        else if (door.openness === 0 && door.target === 0) jamDoor(world, entity, true);
      }
    },
  };
}
