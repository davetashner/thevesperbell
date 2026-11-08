// Area transitions in the sim (mw-e01.11). A scene lists the volumes that lead to other scenes (layout
// `transitions`); this system watches the player's feet against them and, on the tick the player
// walks into one from outside, emits `areaTransition`. It decides nothing about loading: the game
// answers the event by saving the old area's changes, carrying the player over and entering the target
// scene at the named spawn (src/game/transit).
//
// The event is a pure function of the player's movement, so a recorded run (mw-e01.9) raises it on the
// same tick every time. Occupancy is read afresh on the first tick, so a player who starts inside a
// volume (a loaded save made in one) has to leave and come back before it fires.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { CharacterController } from '../character/system';
import type { Vec3 } from '../stimulus/shapes';
import type { SceneLayout, SceneTransition } from './layout';

/** The player walked into a way out of the scene. */
export interface AreaTransition {
  readonly tick: number;
  /** The scene the player leaves. */
  readonly from: string;
  /** The transition's id in that scene. */
  readonly transition: string;
  /** The scene it leads to, and the spawn of that scene the player arrives at. */
  readonly scene: string;
  readonly spawn: string;
  /** Companions flagged to follow travel with the player. */
  readonly follow: boolean;
  readonly entity: EntityId;
  /** The volume walked into, metres (carried objects are set down outside it, mw-e17.14). */
  readonly volume?: { readonly min: Vec3; readonly max: Vec3 };
}

/** Fired once as the player enters a transition volume (`scene.transition`; never renamed). */
export const areaTransition = defineEvent<AreaTransition>('scene.transition');

/** Whether the point lies in the transition's volume (edges inclusive). */
export function inTransition(transition: SceneTransition, point: Vec3): boolean {
  const { min, max } = transition;
  return (
    point.x >= min.x &&
    point.x <= max.x &&
    point.y >= min.y &&
    point.y <= max.y &&
    point.z >= min.z &&
    point.z <= max.z
  );
}

/**
 * Adds the system that raises `areaTransition` as `player` enters one of `layout`'s transitions.
 * Does nothing when the scene has none. Once per world, between steps.
 */
export function installSceneTransitions<TInput>(
  world: World<TInput>,
  layout: SceneLayout,
  player: EntityId,
): void {
  if (layout.transitions.length === 0) return;
  let inside: Set<string> | undefined;
  world.addSystem({
    name: 'scene-transitions',
    run({ tick }) {
      const feet = world.get(player, CharacterController)?.position;
      if (feet === undefined) return;
      const now = new Set(layout.transitions.filter((t) => inTransition(t, feet)).map((t) => t.id));
      const before = inside ?? now;
      inside = now;
      for (const t of layout.transitions) {
        if (!now.has(t.id) || before.has(t.id)) continue;
        world.events.emit(areaTransition, {
          tick,
          from: layout.id,
          transition: t.id,
          scene: t.scene,
          spawn: t.spawn,
          follow: t.follow,
          entity: player,
          volume: { min: t.min, max: t.max },
        });
      }
    },
  });
}
