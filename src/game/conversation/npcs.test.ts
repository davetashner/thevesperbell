// The NPC registry (mw-e22.9): creature ids, the NPC resolver and the game's dispositions.

import { loadDevContent } from '@content/dev-content';
import {
  buildFactionTable,
  CreatureComponent,
  factionSpecFromDef,
  installFactions,
  joinFaction,
  npcBand,
  placeEntity,
  registerCreatureComponents,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameDispositions, creatureIdOf, npcResolver } from './npcs';

const content = loadDevContent();

function creatureWorld() {
  const world = installFactions(registerCreatureComponents(new World<never>({ seed: 1 })));
  const table = buildFactionTable(content.all('faction').map(factionSpecFromDef));
  const spawn = (id: string, faction = 'unaligned'): EntityId => {
    const entity = world.spawn();
    joinFaction(world, table, entity, faction);
    placeEntity(world, entity, { x: 0, y: 0, z: 0 }, 0.4);
    world.add(entity, CreatureComponent, {
      origin: { creature: id, at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'x',
      tuning: {},
      needs: {},
    });
    return entity;
  };
  return { world, spawn };
}

describe('NPC registry', () => {
  it('names a creature entity’s content id, and nothing for anything else', () => {
    const { world, spawn } = creatureWorld();
    const ottilie = spawn('npc-ottilie');
    expect(creatureIdOf(world, ottilie)).toBe('npc-ottilie');
    expect(creatureIdOf(world, world.spawn())).toBeUndefined();
    expect(creatureIdOf(new World<never>({ seed: 1 }), 1)).toBeUndefined();
  });

  it('resolves an NPC id to its first spawned entity, or nothing', () => {
    const { world, spawn } = creatureWorld();
    const first = spawn('npc-ottilie');
    spawn('npc-ottilie');
    const other = spawn('npc-oswin');
    const resolve = npcResolver(world);
    expect(resolve('npc-ottilie')).toBe(first);
    expect(resolve('npc-oswin')).toBe(other);
    expect(resolve('npc-nobody')).toBeUndefined();
    expect(npcResolver(new World<never>({ seed: 1 }))('npc-ottilie')).toBeUndefined();
  });
});

describe('game dispositions', () => {
  it('seed a townsperson friendly and an unaligned creature hostile', () => {
    const { world, spawn } = creatureWorld();
    const dispositions = createGameDispositions(world, content, () => undefined);
    const villager = spawn('greybox-villager', 'townsfolk');
    const stranger = spawn('stranger');
    expect(npcBand(dispositions.get(villager))).toBe('neutral');
    expect(dispositions.get(villager)).toBeGreaterThan(0);
    expect(npcBand(dispositions.get(stranger))).toBe('hostile'); // the unaligned fight the player
  });

  it('take a creature’s own baseline and class affinity from its definition, and the player’s class', () => {
    const withBaseline = {
      all: (type: 'creature' | 'faction' | 'disposition-rule') =>
        type === 'creature'
          ? [
              {
                id: 'fence',
                disposition: { baseline: -20, decayPerMinute: 2, classAffinity: { thief: 60 } },
              },
              { id: 'plain', disposition: {} },
            ]
          : content.all(type),
    };
    const { world, spawn } = creatureWorld();
    const none = createGameDispositions(world, withBaseline as never, () => undefined);
    const fence = spawn('fence');
    const plain = spawn('plain');
    expect(none.get(fence)).toBe(-20);
    expect(none.get(plain)).toBe(-75); // its faction's stance seeds it
    const player = world.spawn();
    const thief = createGameDispositions(world, withBaseline as never, () => player);
    expect(thief.get(fence)).toBe(-20); // no class chosen
    expect(thief.get(world.spawn())).toBe(0); // not a creature: no faction, no record
  });
});
