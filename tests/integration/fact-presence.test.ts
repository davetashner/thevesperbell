// mw-e24.22: NPCs come and go with the story. Tansy Pell stands at Pell's Bakery in Briar Glen's lane
// only once tansy.saved is true (spawnIf, mw-e27.8), over the real lane scene, the game's scene
// loader and creatures, headless.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { watchSpawnVariants } from '@game/scene/variants';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { CreatureComponent, sceneDormantEntities, type World } from '@sim/index';

const content = loadGameContent();

const tansies = (world: World<never>): number =>
  world
    .query(CreatureComponent)
    .ids()
    .filter((e) => world.get(e, CreatureComponent)?.origin.creature === 'npc-tansy').length;

function lane(saved: boolean) {
  const g = createGameWorld<never>(RAPIER, { seed: 11, hz: 60, scene: 'briar-glen-lane' });
  if (saved) {
    g.world.facts.set('tansy.saved', true);
    g.scenes.load('briar-glen-lane');
  }
  const watch = watchSpawnVariants({
    world: g.world,
    loader: g.scenes,
    content,
    creatures: g.creatures.spawn,
  });
  return { g, watch };
}

describe('fact-gated NPC presence (mw-e24.22)', () => {
  it('AC-1: Tansy is absent from the bakery before tansy.saved and there after', () => {
    const { g, watch } = lane(false);
    expect(tansies(g.world)).toBe(0);
    g.world.facts.set('tansy.saved', true);
    g.world.step();
    watch?.step();
    g.world.step();
    expect(tansies(g.world)).toBe(1);
    const entity = g.scenes.entityOfSpawn('npc-tansy') ?? expect.fail('no spawn');
    expect(g.world.isAlive(entity)).toBe(true);
  });

  it('AC-1: she leaves again when the fact goes false', () => {
    const { g, watch } = lane(false);
    g.world.facts.set('tansy.saved', true);
    g.world.step();
    watch?.step();
    g.world.facts.set('tansy.saved', false);
    g.world.step();
    watch?.step();
    g.world.step();
    expect(tansies(g.world)).toBe(0);
  });

  it('AC-2: a scene loaded with the saved fact places her from the start, and a fresh one does not', () => {
    const { g } = lane(true);
    const loaded = g.scenes.current ?? expect.fail('no scene');
    expect(loaded.layout.spawns.map((s) => s.id)).toContain('npc-tansy');
    expect(sceneDormantEntities(loaded)).not.toContain('spawn:npc-tansy');
    const fresh = lane(false).g;
    expect(sceneDormantEntities(fresh.scene)).toContain('spawn:npc-tansy');
  });

  it('AC-3: a lane without the fact leaves Tansy out of the loaded layout', () => {
    const { g } = lane(false);
    expect(g.scene.layout.spawns.map((s) => s.id)).not.toContain('npc-tansy');
    expect(g.scene.authoredSpawns.map((s) => s.id)).toContain('npc-tansy');
  });
});
