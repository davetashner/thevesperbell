// The content-type registry (mw-e00.18): every content type the game loads, keyed by its folder
// name under src/content/data/. Adding a content type = a schema module + one line here + a folder.
// `contentChecks` are the checks across entries every load runs: fact references (mw-e27.2),
// conditions against the fact registry (mw-e27.5), animation (mw-e02.20) and socket tracks
// (mw-e04.26), capability ids and puzzles against their scenes, capabilities and facts (mw-e15.1),
// creature attacks' readability (windups and telegraph cues, mw-e04.20), unlock definitions against
// the capability registry, without cycles or pure numeric upgrades (mw-e19.3), the capability ids
// items grant, teach or learn (mw-e17.2) and the locks keys open (mw-e03.18), the class files against
// the capability registry, the items and the proficiency tags items call for (mw-e19.4), and the
// spawns the signal graphs a scene places bind (mw-e03.18), loot tables' references, nesting and
// unique items across the world (mw-e18.2), and baked navmeshes against their scenes' door spawns
// (mw-e11.4), area transitions' target spawns (mw-e01.11), respawn-rule destinations against their scenes' spawns (mw-e01.8), and merchants' price
// bands and stock against the economy design (mw-e20.2). The `game` type
// is the one game configuration file (playable classes, mw-e01.15).

import { checkAnimation } from './anim-checks.ts';
import { checkCreatureAttacks } from './attack-checks.ts';
import { checkBehaviours } from './behaviour-checks.ts';
import { checkConditions } from './condition-checks.ts';
import { checkFacts } from './fact-checks.ts';
import { checkLootTables } from './loot-checks.ts';
import { checkSpellStatuses } from './spell-status-checks.ts';
import { checkSceneSignals } from './mechanism-checks.ts';
import { checkRepopulation } from './repopulation-checks.ts';
import { checkRecoveryAnchors } from './recovery-checks.ts';
import { checkSceneTransitions } from './transition-checks.ts';
import { checkPuzzles } from './puzzle-checks.ts';
import type { Catalogue, ContentCheck, EntryOf } from './loader.ts';
import { animClipSchema } from './types/anim-clip.ts';
import { animGraphSchema } from './types/anim-graph.ts';
import { arrowSchema } from './types/arrow.ts';
import { attackSchema } from './types/attack.ts';
import { behaviourSchema } from './types/behaviour.ts';
import { bowSchema } from './types/bow.ts';
import { breakableSchema } from './types/breakable.ts';
import { cameraSchema } from './types/camera.ts';
import { capabilitySchema, checkCapabilities } from './types/capability.ts';
import { checkClasses, classSchema } from './types/class.ts';
import { namedConditionSchema } from './types/condition.ts';
import { controllerSchema } from './types/controller.ts';
import { creatureSchema } from './types/creature.ts';
import { cueSheetSchema } from './types/cue-sheet.ts';
import { doorSchema } from './types/door.ts';
import { environmentDamageSchema } from './types/environment-damage.ts';
import { factSchema } from './types/fact.ts';
import { factionSchema } from './types/faction.ts';
import { gameSchema } from './types/game.ts';
import { checkItems, itemSchema } from './types/item.ts';
import { hitStopSchema } from './types/hit-stop.ts';
import { kitSchema } from './types/kit.ts';
import { lockSchema } from './types/lock.ts';
import { lockOnSchema } from './types/lock-on.ts';
import { lootTableSchema } from './types/loot-table.ts';
import { locomotionSchema } from './types/locomotion.ts';
import { checkMerchants, merchantSchema } from './types/merchant.ts';
import { materialSchema } from './types/material.ts';
import { moveSchema } from './types/move.ts';
import { checkNavmeshes, navmeshSchema } from './types/navmesh.ts';
import { puzzleSchema } from './types/puzzle.ts';
import { checkRespawnRules, respawnRulesSchema } from './types/respawn-rules.ts';
import { sandboxSchema } from './types/sandbox.ts';
import { sceneSchema } from './types/scene.ts';
import { senseSchema } from './types/sense.ts';
import { shieldSchema } from './types/shield.ts';
import { signalGraphSchema } from './types/signal-graph.ts';
import { checkSocketTracks, socketTrackSchema } from './types/socket-track.ts';
import { spellSchema } from './types/spell.ts';
import { statusSchema } from './types/status.ts';
import { stealthSchema } from './types/stealth.ts';
import { targetableSchema } from './types/targetable.ts';
import { testPropSchema } from './types/testprop.ts';
import { checkUnlocks, unlockSchema } from './types/unlock.ts';
import { vfxCueSheetSchema } from './types/vfx-cue-sheet.ts';
import { vfxEffectSchema } from './types/vfx-effect.ts';

/** Content type name → schema of one entry. */
export const contentTypes = {
  'anim-clip': animClipSchema,
  'anim-graph': animGraphSchema,
  arrow: arrowSchema,
  attack: attackSchema,
  behaviour: behaviourSchema,
  bow: bowSchema,
  breakable: breakableSchema,
  camera: cameraSchema,
  capability: capabilitySchema,
  class: classSchema,
  condition: namedConditionSchema,
  controller: controllerSchema,
  creature: creatureSchema,
  'cue-sheet': cueSheetSchema,
  door: doorSchema,
  'environment-damage': environmentDamageSchema,
  fact: factSchema,
  faction: factionSchema,
  game: gameSchema,
  'hit-stop': hitStopSchema,
  item: itemSchema,
  kit: kitSchema,
  lock: lockSchema,
  'lock-on': lockOnSchema,
  'loot-table': lootTableSchema,
  locomotion: locomotionSchema,
  material: materialSchema,
  merchant: merchantSchema,
  move: moveSchema,
  navmesh: navmeshSchema,
  puzzle: puzzleSchema,
  'respawn-rules': respawnRulesSchema,
  sandbox: sandboxSchema,
  scene: sceneSchema,
  sense: senseSchema,
  shield: shieldSchema,
  'signal-graph': signalGraphSchema,
  'socket-track': socketTrackSchema,
  spell: spellSchema,
  status: statusSchema,
  stealth: stealthSchema,
  targetable: targetableSchema,
  testprop: testPropSchema,
  unlock: unlockSchema,
  'vfx-cue-sheet': vfxCueSheetSchema,
  'vfx-effect': vfxEffectSchema,
};

/** Checks across entries, run on every load of the registered types (see loader.ts). */
export const contentChecks: readonly ContentCheck[] = [
  checkFacts,
  checkConditions,
  checkAnimation,
  checkSocketTracks,
  checkCapabilities,
  checkPuzzles,
  checkCreatureAttacks,
  checkBehaviours,
  checkUnlocks,
  checkItems,
  checkClasses,
  checkSceneSignals,
  checkSceneTransitions,
  checkRecoveryAnchors,
  checkLootTables,
  checkMerchants,
  checkNavmeshes,
  checkRespawnRules,
  checkRepopulation,
  checkSpellStatuses,
];

export type ContentTypes = typeof contentTypes;
/** A registered content type name (its folder under src/content/data/). */
export type ContentType = keyof ContentTypes;
/** The game's loaded content. */
export type GameContent = Catalogue<ContentTypes>;
/** A loaded entry of the game's content type `K`, e.g. `GameEntry<'testprop'>`. */
export type GameEntry<K extends ContentType> = EntryOf<ContentTypes, K>;
