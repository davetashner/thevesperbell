// mw-e27.9: ownership and theft over real content: Marsh's store owns its back box and shelf loaf
// (src/content/data/scene/marsh-store.json), the fact registry declares every theft fact (the throw
// policy would fail an undeclared write), and a theft survives a real save and load.
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { installFactRegistry } from '@game/facts';
import { prepareContainers } from '@game/items/containers';
import { prepareWorldItems } from '@game/items';
import { SaveRegistry } from '@game/save/format';
import {
  addInventory,
  addSceneContainers,
  installContainers,
  installStimuli,
  registerWorldProperties,
  hashWorld,
  inventoryOf,
  layoutScene,
  ownerOf,
  thefts,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const layout = layoutScene(content.get('scene', 'marsh-store'), (id) => content.get('kit', id));

function build() {
  const world = installStimuli(registerWorldProperties(new World({ seed: 5 })));
  installFactRegistry(world.facts, content, true);
  const items = prepareWorldItems(content);
  const containers = prepareContainers(content, items.inventory);
  installContainers(world, containers);
  const player = world.spawn();
  addInventory(world, player);
  const spawn = layout.spawns.find((s) => s.id === 'back-box');
  const entity = world.spawn();
  if (spawn === undefined) throw new Error('the store has no back box');
  addSceneContainers(world, containers, 'marsh-store', [{ entity, spawn }], () => undefined);
  return { world, containers, player, box: entity };
}

describe('ownership and theft over real content (mw-e27.9)', () => {
  it('the store’s stock is Ottilie’s: the scene tags the box and the loaf with their owner', ({
    task,
  }) => {
    markExercised(task, 'scene', 'marsh-store');
    const owners = layout.spawns.filter((s) => s.owner !== undefined).map((s) => [s.id, s.owner]);
    expect(owners).toEqual([
      ['shelf-loaf', 'npc-ottilie'],
      ['back-box', 'npc-ottilie'],
    ]);
    const { world, box } = build();
    expect(ownerOf(world, box)).toEqual({
      owner: 'npc-ottilie',
      level: 'marsh-store',
      place: 'back-box',
    });
  });

  it('AC-5: a theft then save and reload keeps the stolen flag and the theft fact', () => {
    const { world, containers, player, box } = build();
    expect(containers.takeAll(world, box, player)).toMatchObject({ ok: true });
    expect(inventoryOf(world, player)?.items.map((i) => i.flags)).toEqual([
      { stolen: true, ownerId: 'npc-ottilie' },
    ]);
    world.step();
    const registry = new SaveRegistry();
    const bytes = registry.write(world, {
      build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
      wallClockSavedAt: 1_790_000_000_000,
    });

    const { world: loaded } = build(); // the level as built, as a load starts from
    expect(registry.read(loaded, bytes)).toMatchObject({ ok: true });
    expect(inventoryOf(loaded, player)?.items.map((i) => i.flags)).toEqual([
      { stolen: true, ownerId: 'npc-ottilie' },
    ]);
    expect(thefts(loaded)).toMatchObject([
      {
        level: 'marsh-store',
        id: 'theft-1',
        owner: 'npc-ottilie',
        item: 'healing-draught',
        place: 'back-box',
        witnessed: 'unknown',
        status: 'stolen',
      },
    ]);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });
});
