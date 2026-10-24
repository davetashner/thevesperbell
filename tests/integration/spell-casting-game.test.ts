// mw-e06.15: casting through the game's wiring, headless (createGameWorld with `magic`, which installs
// the pipeline, mana, fire and the player's pool as src/main.ts does). A paid lesson from the sorcery
// teacher under the Miners' Bridge (mw-ju8.14) puts Ember on the player's spell list, and the casting
// controller then casts it: the whole path from crowns to a bolt in flight.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import { SpellCaster, type SpellCommand } from '@game/magic/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  addCapabilities,
  inventoryOf,
  InventoryRules,
  manaOf,
  RapierCollisionWorld,
  RapierPhysics,
  Shops,
  SpellCast,
  SpellProjectileComponent,
  type ActionFrame,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();

const frame = (cast: boolean): ActionFrame =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (a) => actionButton(cast && a === 'cast', cast && a === 'cast', false),
  });

describe('the paid lesson makes Ember castable (mw-e06.15, mw-ju8.14)', () => {
  it('crowns to Ember on the spell list to a bolt in flight', ({ task }) => {
    markExercised(task, 'spell', 'ember');
    const game = createGameWorld<ActionFrame | SpellCommand>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'under-the-bridge',
      phase: 'night',
      magic: true,
    });
    const sim = game.world as unknown as World<never>;
    const { player, magic } = game;
    if (magic === undefined) throw new Error('magic is installed');
    const rules = new InventoryRules(content.all('item'));
    rules.addGold(sim, player, 200 - (inventoryOf(sim, player)?.gold ?? 0));
    addCapabilities(sim, player);
    const book = createUnlockBook(content, createCapabilityRegistry(content, true));
    const shops = new Shops(content.all('merchant'), content.all('item'), rules);

    expect(manaOf(sim, player)?.profile.max).toBe(content.get('class', 'knight').stats.mana);
    const physics = (game.world as unknown as { physics: RapierPhysics }).physics;
    const caster = new SpellCaster({
      world: sim,
      caster: player,
      spells: magic.spells,
      collision: new RapierCollisionWorld(physics),
    });
    expect(caster.spell()).toBeUndefined();

    expect(shops.train(sim, player, 'bridge-sorcerer', 'ember', book)).toMatchObject({ ok: true });
    expect(caster.learned()).toEqual(['ember']);
    expect(caster.selected).toBe('ember');

    let casts = 0;
    game.world.events.on(SpellCast, () => (casts += 1));
    const ray = () => ({ origin: { x: 0, y: 3, z: 6 }, direction: { x: 0, y: -0.1, z: -0.995 } });
    const press = frame(true);
    game.world.step([press, ...caster.commands(press, ray)]);
    let flying = 0;
    for (let i = 0; i < 40; i++) {
      game.world.step([frame(false)]);
      flying = Math.max(flying, sim.query(SpellProjectileComponent).ids().length);
    }
    expect(casts).toBe(1);
    expect(flying).toBeGreaterThan(0);
    expect(manaOf(sim, player)?.current).toBeLessThan(content.get('class', 'knight').stats.mana);
  });
});
