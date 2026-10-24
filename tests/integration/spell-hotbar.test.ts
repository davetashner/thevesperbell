// mw-e06.16: the spell hotbar through the game's wiring, headless. Spells taught in the game
// (createGameWorld with `magic`, as src/main.ts wires it) land on the bar, and the bar (all eight
// slot assignments and the selected slot) survives a save through the game's save registry into a
// fresh world.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { debugSpellLearner, givePlayerMagic, installGameMagic } from '@game/magic/index';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  addCapabilities,
  assignSpellSlotCommand,
  DamageModel,
  hashWorld,
  hotbarOf,
  installStimuli,
  learnSpellCommand,
  registerWorldProperties,
  selectedHotbarSpell,
  selectSpellSlotCommand,
  SPELL_HOTBAR_SLOTS,
  stimulusSystem,
  World,
} from '@sim/index';
import { makeSpell } from '@sim/magic/testing';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();

const SAVE = {
  build: { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' },
  wallClockSavedAt: 1_790_000_000_000,
};

const SPELLS = Array.from({ length: SPELL_HOTBAR_SLOTS }, (_, i) =>
  makeSpell(`t-spell-${String(i)}`, { name: `Spell ${String(i)}` }),
);

/** A bare world with the game's magic installed and the player's pool, ids from `SPELLS`. */
function bareGame() {
  const world = new World<unknown>({ seed: 1 });
  installStimuli(registerWorldProperties(world));
  installGameMagic(world, {
    spells: SPELLS,
    damage: new DamageModel(),
    collision: {
      sweepCapsule: () => undefined,
      overlapCapsule: () => false,
      bodyVelocity: () => ({ x: 0, y: 0, z: 0 }),
      raycast: () => undefined,
    },
    invulnerable: () => false,
    learn: debugSpellLearner(content),
  });
  world.addSystem(stimulusSystem());
  const player = world.spawn();
  givePlayerMagic(world, player, 50);
  return { world, sim: world as unknown as World<never>, player };
}

describe('the spell hotbar in the game (mw-e06.16)', () => {
  it('a spell taught in the game takes the first slot and is selected', ({ task }) => {
    markExercised(task, 'spell', 'ember');
    const game = createGameWorld<unknown>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'testbed',
      magic: true,
    });
    const sim = game.world as unknown as World<never>;
    addCapabilities(sim, game.player);
    expect(hotbarOf(sim, game.player)).toBeUndefined();
    game.world.step([learnSpellCommand(game.player, 'ember')]);
    game.world.step([]);
    expect(hotbarOf(sim, game.player)?.slots[0]).toBe('ember');
    expect(selectedHotbarSpell(sim, game.player)).toBe('ember');
  }, 30_000);

  it('AC-5: all eight slot assignments and the selected slot are restored by save and load', () => {
    const { world, sim, player } = bareGame();
    world.step(SPELLS.map((s) => learnSpellCommand(player, s.id)));
    world.step([]);
    // Reverse the bar so it differs from learning order, then select slot 6.
    const order = SPELLS.map((s) => s.id).reverse();
    world.step(order.map((id, slot) => assignSpellSlotCommand(player, slot, id)));
    world.step([selectSpellSlotCommand(player, 5)]);
    const saved = hotbarOf(sim, player);
    expect(saved?.slots).toEqual(order);
    expect(saved?.selected).toBe(5);

    const registry = createGameSaveRegistry();
    const bytes = registry.write(sim, SAVE);
    const fresh = bareGame();
    const result = registry.read(fresh.sim, bytes);
    if (!result.ok) throw result.error;
    expect(result.warnings).toEqual([]);
    expect(hotbarOf(fresh.sim, fresh.player)).toEqual(saved);
    expect(selectedHotbarSpell(fresh.sim, fresh.player)).toBe(order[5]);
    expect(hashWorld(fresh.sim)).toBe(hashWorld(sim));
  });
});
