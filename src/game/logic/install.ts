// Installs the quest runtime on a world over the game's logic host (mw-e23.11), and returns the
// host dialogue and shops run their effects against.
//
// Order matters. Install before any save loads: quest fact keys must be declared when a load
// reaches them, or the production `ignore` fact policy drops them. `createGameSaveRegistry`'s
// `afterRead` hook then refreshes and settles the runtime after every load (slots, recovery,
// death reload), because a load replaces the facts without announcing the changes.
//
// A world whose content has no quests gets no runtime, no system and no declared fact, so it hashes
// and plays exactly as before. The returned host is then the plain game host, whose quest
// conditions read `unstarted` and whose quest effects refuse.

import type { GameContent } from '@content/index';
import type { QuestDef } from '@content/types/quest';
import {
  capabilityGained,
  capabilityLost,
  installQuests,
  itemAdded,
  itemRemoved,
  type LogicHost,
  type QuestRuntime,
} from '@sim/index';
import { bindQuestObjectives } from './bindings';
import { createGameLogicHost, type GameLogicHostOptions } from './host';

/** The content's quests, in file order. Content entries are deeply readonly; the runtime never writes them. */
export function questsOf(content: GameContent): readonly QuestDef[] {
  return content.all('quest') as unknown as readonly QuestDef[];
}

export interface GameLogic {
  /** Run effect batches and conditions against this: quest-aware when the world has quests. */
  readonly host: LogicHost;
  /** The quest runtime; undefined when the content has no quests. */
  readonly quests: QuestRuntime | undefined;
}

export interface GameLogicOptions extends GameLogicHostOptions {
  /** The content's quests (`content.all('quest')`). */
  readonly quests: readonly QuestDef[];
}

const installed = new WeakMap<object, GameLogic>();

function remember(world: object, logic: GameLogic): GameLogic {
  installed.set(world, logic);
  return logic;
}

/**
 * The logic installed on `world`, if any: dialogue start-up (mw-e22.9) takes `.host` from here and
 * passes it to `DialogueRuntime`.
 */
export function gameLogicOf(world: object): GameLogic | undefined {
  return installed.get(world);
}

/**
 * Builds the game host and, when there are quests, installs the quest runtime over it (its `update`
 * runs every tick) and feeds it the item and capability changes it cannot see as facts.
 * @throws RangeError when the world has a quest runtime already.
 */
export function installGameLogic(
  world: GameLogicOptions['world'],
  options: GameLogicOptions,
): GameLogic {
  const base = createGameLogicHost({ ...options, world });
  if (options.quests.length === 0) return remember(world, { host: base, quests: undefined });
  const runtime = installQuests(world, { quests: options.quests, host: base });
  world.events.on(itemAdded, ({ defId }) => {
    runtime.notifyItem(defId);
  });
  world.events.on(itemRemoved, ({ defId }) => {
    runtime.notifyItem(defId);
  });
  world.events.on(capabilityGained, ({ capability }) => {
    runtime.notifyCapability(capability);
  });
  world.events.on(capabilityLost, ({ capability }) => {
    runtime.notifyCapability(capability);
  });
  bindQuestObjectives(world, runtime, { player: options.player });
  return remember(world, { host: runtime.host, quests: runtime });
}
