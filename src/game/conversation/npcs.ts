// The game's NPC registry (mw-e22.9): what dispositions and dialogue need to know about the people
// in the world. An NPC's id is its creature's content id, the same in dialogue conditions and
// effects, disposition and visit facts. `creatureIdOf` names a creature entity's id, `npcResolver`
// finds the entity (the first spawned when there are several), and `createGameDispositions` is the
// disposition system over the game's factions and rules, listening for what changes it (a blow, a
// theft). Dispositions register their component on the first change, so a world where nobody's
// opinion moves hashes as it did.

import type { GameContent } from '@content/index';
import {
  buildFactionTable,
  classOf,
  compileDispositionRules,
  compileFactionSpread,
  CreatureComponent,
  Dispositions,
  factionSpecFromDef,
  type EntityId,
  type World,
} from '@sim/index';

/** The content id of the creature `entity` is, or undefined for anything else. */
export function creatureIdOf(world: World<never>, entity: EntityId): string | undefined {
  return world.isRegistered(CreatureComponent)
    ? world.get(entity, CreatureComponent)?.origin.creature
    : undefined;
}

/** NPC id → the live creature entity of that id (the lowest entity id), or undefined. */
export function npcResolver(world: World<never>): (npc: string) => EntityId | undefined {
  return (npc) => {
    if (!world.isRegistered(CreatureComponent)) return undefined;
    let found: EntityId | undefined;
    world.query(CreatureComponent).forEach((entity, creature) => {
      if (found === undefined && creature.origin.creature === npc) found = entity;
    });
    return found;
  };
}

/**
 * The game's dispositions: factions and rules from content, a creature's own baseline, decay and
 * class affinity from its definition, the player's class from the world. Call `listen()` on the
 * result to have blows and thefts move opinions.
 */
export function createGameDispositions(
  world: World<never>,
  content: Pick<GameContent, 'all'>,
  player: () => EntityId | undefined,
): Dispositions {
  const defs = new Map(content.all('creature').map((def) => [def.id, def.disposition]));
  return new Dispositions(world, {
    factions: buildFactionTable(content.all('faction').map(factionSpecFromDef)),
    rules: compileDispositionRules(content.all('disposition-rule')),
    spread: compileFactionSpread(content.all('faction')),
    playerClass: () => {
      const id = player();
      return id === undefined ? undefined : classOf(world, id);
    },
    defaultsOf: (_world, entity) => {
      const id = creatureIdOf(world, entity);
      const disposition = id === undefined ? undefined : defs.get(id);
      if (disposition === undefined) return undefined;
      return {
        ...(disposition.baseline !== undefined && { baseline: disposition.baseline }),
        ...(disposition.decayPerMinute !== undefined && {
          decayPerMinute: disposition.decayPerMinute,
        }),
        ...(disposition.classAffinity !== undefined && {
          classAffinity: disposition.classAffinity,
        }),
      };
    },
  });
}
