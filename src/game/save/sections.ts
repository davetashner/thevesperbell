// The game's save sections (mw-e30.3): the one list of everything the current build saves. Saving,
// loading and the save-schema gate (pnpm save:check, tests/save-fixtures) all build their registry
// here, so a system that adds a section registers it in exactly one place and the gate fingerprints
// it automatically. Sections: the built-in world section, then inventory (mw-e17.8), creatures
// (mw-e12.14), world facts and level deltas (mw-e27.4), then merchants (mw-e20.4) and the game clock's schedule (mw-e27.12).

import {
  CapabilitiesComponent,
  NavRouteComponent,
  PlayerClassComponent,
  SpellHotbarComponent,
  StatsComponent,
} from '@sim/index';
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
 * mw-e01.5).
 */
export const ON_DEMAND_COMPONENTS = Object.freeze([
  PlayerClassComponent,
  StatsComponent,
  CapabilitiesComponent,
  NavRouteComponent,
  SpellHotbarComponent,
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
  return new SaveRegistry({ onDemand: ON_DEMAND_COMPONENTS })
    .register(inventorySaveSection(options))
    .register(creaturesSaveSection())
    .register(worldFactsSaveSection({ ...(warn && { warn }) }))
    .register(levelDeltasSaveSection({ ...(warn && { warn }) }))
    .register(merchantsSaveSection(options))
    .register(gameClockSaveSection());
}
