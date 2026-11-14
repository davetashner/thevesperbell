// Ropes in the running game (mw-e10.9): a level's `rope-anchor` spawns become anchors where the
// player ties and unties the climbing rope with Interact, and the navmesh follows the ropes that
// hang (an off-mesh climb link for climbers while one does). The rules are src/sim/climb; this
// reads the rope item from content and wires them to the scene's navigation.

import type { GameContent } from '@content/index';
import {
  installRopePlacement,
  ROPE_ANCHOR_TAG,
  sceneRopeAnchors,
  type InventoryRules,
  type LoadedScene,
  type World,
} from '@sim/index';
import type { SceneNavigation } from '../creatures/ai';

/** A climbing rope item as content declares it: a tool with a `rope` block. */
export interface RopeItem {
  readonly id: string;
  /** How far it hangs once tied, metres. */
  readonly length: number;
}

/** The content's climbing rope (the first item with a `rope` block, in id order), or undefined. */
export function ropeItemOf(content: GameContent): RopeItem | undefined {
  for (const item of content.all('item')) {
    if (item.category === 'tool' && item.rope !== undefined) {
      return { id: item.id, length: item.rope.length };
    }
  }
  return undefined;
}

/** Whether `loaded` has any rope anchor. */
export function hasRopeAnchors(loaded: LoadedScene): boolean {
  return loaded.spawns.some(({ spawn }) => spawn.tags.includes(ROPE_ANCHOR_TAG));
}

/**
 * Makes the scene's rope anchors work: ties and unties through Interact, and keeps the navmesh's
 * rope links current each tick. Does nothing for a scene without anchors, so its world is
 * unchanged. Returns the anchors' entities.
 */
export function startRopes(
  world: World<never>,
  content: GameContent,
  loaded: LoadedScene,
  inventory: InventoryRules,
  navigation: Pick<SceneNavigation, 'syncRopes'>,
): readonly number[] {
  const rope = ropeItemOf(content);
  if (!hasRopeAnchors(loaded) || rope === undefined) return [];
  const anchors = sceneRopeAnchors(world, loaded);
  installRopePlacement(world, {
    inventory,
    item: rope.id,
    length: rope.length,
    properties: { material: 'rope' },
  });
  world.addSystem({
    name: 'rope-nav-links',
    run: ({ world: sim }) => {
      navigation.syncRopes(sim);
    },
  });
  return anchors;
}
