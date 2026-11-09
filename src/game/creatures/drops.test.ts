// Creature drops in the game (mw-e01.5): content's creature loot tables and a scene spawn's `carries`
// reach the sim's creature drops, so a dying creature drops what its spawn carries, then its table.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import type { GameContent } from '@content/index';
import { prepareWorldItems } from '@game/items/index';
import {
  ArrowRestComponent,
  box,
  CREATURE_COMPONENTS,
  CreatureComponent,
  Died,
  installPhysicsObjects,
  installStimuli,
  installWorldItems,
  placeEntity,
  RapierPhysics,
  registerWorldProperties,
  World,
  WorldItemComponent,
  type SceneSpawnPlacement,
} from '@sim/index';
import { startCreatureDrops } from './drops';

const content = loadGameContent();

/** The game's content with the Forgotten miner rolling the alcove chest's table on death. */
const withMinerLoot: Pick<GameContent, 'all'> = {
  all: ((type: string) =>
    type === 'creature'
      ? content.all('creature').map((c) => ({ ...c, loot: 'slice-alcove-chest' }))
      : content.all(type as 'item')) as GameContent['all'],
};

/** The game's content with no creature rolling any table: only what a spawn carries drops. */
const withoutLoot: Pick<GameContent, 'all'> = {
  all: ((type: string) =>
    type === 'creature'
      ? content.all('creature').map((c) => ({ ...c, loot: undefined }))
      : content.all(type as 'item')) as GameContent['all'],
};

const SPAWNS: SceneSpawnPlacement[] = [
  {
    id: 'skeleton',
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags: [],
    creature: 'forgotten-miner',
    carries: [{ item: 'rusted-gallery-key', count: 1 }],
  },
  {
    id: 'marker',
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags: [],
  },
];

function dropsOnDeath(
  source: Pick<GameContent, 'all'>,
  arrows: readonly string[] = [],
): (string | undefined)[] {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3, physics })));
  world.register(...CREATURE_COMPONENTS, ArrowRestComponent);
  installPhysicsObjects(world);
  physics.add(box({ x: -10, y: -1, z: -10 }, { x: 10, y: 0, z: 10 }));
  const items = prepareWorldItems(content);
  installWorldItems(world, items);
  const stop = startCreatureDrops(world, source, items, 'slice', SPAWNS);
  const skeleton = world.spawn();
  placeEntity(world, skeleton, { x: 0, y: 0, z: 0 }, 0.35);
  world.add(skeleton, CreatureComponent, {
    origin: {
      creature: 'forgotten-miner',
      at: { x: 0, y: 0, z: 0 },
      facing: { x: 0, y: 0, z: 1 },
      point: 'skeleton',
    },
    behaviour: 'forgotten',
    tuning: {},
    needs: {},
  });
  for (const arrow of arrows) {
    const stuck = world.spawn();
    world.add(stuck, ArrowRestComponent, {
      arrow,
      shooter: null,
      state: 'stuck',
      position: { x: 0, y: 1, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      in: skeleton,
      tick: 0,
      intact: true,
    });
  }
  world.step([]);
  world.events.emit(Died, {
    tick: world.tick,
    target: skeleton,
    killer: null,
    source: null,
    tags: [],
  });
  world.events.flush();
  world.step([]);
  stop();
  return world
    .query(WorldItemComponent)
    .ids()
    .map((entity) => world.get(entity, WorldItemComponent)?.defId);
}

describe('creature drops in the game (mw-e01.5)', () => {
  it('AC-2: a dying creature drops what its spawn carries, and nothing else without a loot table', () => {
    expect(dropsOnDeath(withoutLoot)).toEqual(['rusted-gallery-key']);
  });

  it('mw-ju8.19: the miner’s own tier 1 table drops its crowns after what the spawn carries', () => {
    const dropped = dropsOnDeath(content);
    expect(dropped[0]).toBe('rusted-gallery-key');
    expect(dropped).toContain('gold');
    expect(dropped.every((id) => id !== undefined)).toBe(true);
  });

  it('mw-e05.7 AC-4: the intact arrows stuck in it drop as the ammo items of their types', () => {
    const dropped = dropsOnDeath(withoutLoot, ['standard', 'standard', 'rope', 'water']);
    // The water arrow comes back as a standard arrow, so three standard arrows stack as one drop.
    expect(dropped.sort()).toEqual(['rope-arrow', 'rusted-gallery-key', 'standard-arrow']);
  });

  it('rolls the creature’s content loot table after what it carries', () => {
    const dropped = dropsOnDeath(withMinerLoot);
    expect(dropped.slice(0, 3)).toEqual([
      'rusted-gallery-key',
      'healing-draught',
      'miners-tally-stick',
    ]);
    expect(dropped[3]).toBe('gold');
  });
});
