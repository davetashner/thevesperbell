// The game's save sections (mw-e30.3): the one list of everything the current build saves. Saving,
// loading and the save-schema gate (pnpm save:check, tests/save-fixtures) all build their registry
// here, so a system that adds a section registers it in exactly one place and the gate fingerprints
// it automatically. Sections: the built-in world section, then inventory (mw-e17.8), creatures
// (mw-e12.14), world facts and level deltas (mw-e27.4), then merchants (mw-e20.4), the game clock's schedule (mw-e27.12) and the contest runner (mw-opf6).

import {
  CapabilitiesComponent,
  DispositionComponent,
  NavRouteComponent,
  PlayerClassComponent,
  PuzzleCriticalComponent,
  PuzzleStateComponent,
  questRuntimeOf,
  RecoveryAnchorComponent,
  settleHeldObjects,
  settleHidden,
  settlePushes,
  settleRemoteHolds,
  SpellHotbarComponent,
  StatsComponent,
} from '@sim/index';
import { contestsSaveSection } from './contests';
import { creaturesSaveSection } from './creatures';
import { gameClockSaveSection } from './game-clock';
import { SaveRegistry } from './format';
import { inventorySaveSection, type InventorySectionOptions } from './inventory';
import { levelDeltasSaveSection } from './level-deltas';
import { merchantsSaveSection } from './merchants';
import { worldFactsSaveSection } from './world-facts';

/**
 * Components the game registers only on first use: class selection (mw-e19.5) adds the player's
 * class, stats and capabilities, and a creature's first walk on the navmesh its route (mw-e11.4). A
 * save holding them loads into a fresh world that has not chosen a class yet (Continue from the
 * title, mw-e01.7) or whose creatures have not moved yet (a save mid-fight with the slice's skeleton,
 * mw-e01.5), or whose puzzles have not left dormant yet (mw-e15.3: the puzzle record is only made
 * when a puzzle is first touched), or whose critical puzzle objects are not marked yet (mw-e15.7), or where no creature's disposition
 * toward the player has changed yet (mw-e12.9: the record is made on its first change).
 */
export const ON_DEMAND_COMPONENTS = Object.freeze([
  PlayerClassComponent,
  StatsComponent,
  CapabilitiesComponent,
  NavRouteComponent,
  SpellHotbarComponent,
  RecoveryAnchorComponent,
  PuzzleStateComponent,
  PuzzleCriticalComponent,
  DispositionComponent,
]);

/** What the game's sections need from the running build. */
export type GameSaveOptions = InventorySectionOptions;

/**
 * A registry holding every save section this build writes, world first, in apply order. Returns a
 * fresh registry each call (registries are cheap and hold no world state). The game passes its
 * content's item ids (`knownItem`) and a logger (`warn`) so a save holding a removed item still loads;
 * `warn` also hears about renamed, dropped and damaged world state.
 */
export function createGameSaveRegistry(options: GameSaveOptions = {}): SaveRegistry {
  const { warn } = options;
  return new SaveRegistry({
    onDemand: ON_DEMAND_COMPONENTS,
    // A save never stores a carried object's hold: it is set down at the carrier's feet (mw-e17.14).
    beforeWrite: (world) => {
      settleHeldObjects(world);
      settleRemoteHolds(world);
      settlePushes(world);
      // Nor a hide: whoever is inside a wardrobe steps out first (mw-e03.23).
      settleHidden(world);
    },
    // A load replaces facts without announcing them: the quest runtime, built before the load so
    // its keys were declared, re-evaluates against what loaded (mw-e23.11). No quests: no-op.
    afterRead: (world) => {
      const quests = questRuntimeOf(world);
      quests?.refresh();
      quests?.settle();
    },
  })
    .register(inventorySaveSection(options))
    .register(creaturesSaveSection())
    .register(worldFactsSaveSection({ ...(warn && { warn }) }))
    .register(levelDeltasSaveSection({ ...(warn && { warn }) }))
    .register(merchantsSaveSection(options))
    .register(gameClockSaveSection())
    .register(contestsSaveSection());
}
