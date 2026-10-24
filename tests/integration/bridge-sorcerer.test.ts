// mw-ju8.14: the sorcery teacher under the Miners' Bridge (src/content/data/scene/under-the-bridge.json)
// loaded headless as the game wires it, with the clock's phase set. AC-1: by day the teacher is absent
// and his table does not answer, at night present, and he comes and goes as the phase changes. AC-2:
// paying him teaches Ember. AC-3 (a first-time player finds him without a guide) is manual.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import {
  addCapabilities,
  affordancesOf,
  CreatureComponent,
  FactionMemberComponent,
  InteractableComponent,
  inventoryOf,
  InventoryRules,
  PHASE_FACT,
  SceneSpawnComponent,
  Shops,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const MERCHANT = 'bridge-sorcerer';

function bank(phase: string | undefined, crowns = 0) {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'under-the-bridge',
    ...(phase !== undefined && { phase }),
  });
  const sim = game.world as unknown as World<never>;
  const { player } = game;
  const rules = new InventoryRules(content.all('item'));
  const have = inventoryOf(sim, player)?.gold ?? 0;
  if (crowns > have) rules.addGold(sim, player, crowns - have);
  else if (have > crowns) rules.spendGold(sim, player, have - crowns);
  const registry = createCapabilityRegistry(content, true);
  addCapabilities(sim, player);
  const book = createUnlockBook(content, registry);
  const shops = new Shops(content.all('merchant'), content.all('item'), rules);
  const teachers = () =>
    sim
      .query(CreatureComponent)
      .ids()
      .filter((e) => sim.get(e, CreatureComponent)?.origin.creature === 'npc-quillon');
  const table = () => {
    const entity = sim
      .query(SceneSpawnComponent)
      .ids()
      .find((e) => sim.get(e, SceneSpawnComponent)?.id === 'quillon-lessons');
    if (entity === undefined) throw new Error('no lesson table');
    return entity;
  };
  const talks = () =>
    sim.has(table(), InteractableComponent) && affordancesOf(sim, table()).length > 0;
  const setPhase = (next: string) => {
    sim.facts.set(PHASE_FACT, next);
    game.world.step();
  };
  return {
    game,
    sim,
    player,
    book,
    shops,
    teachers,
    talks,
    setPhase,
    gold: () => inventoryOf(sim, player)?.gold ?? 0,
  };
}

describe('the sorcery teacher under the bridge, headless (mw-ju8.14)', () => {
  it('AC-1: by day the teacher is absent and his table does not answer', ({ task }) => {
    markExercised(task, 'scene', 'under-the-bridge');
    const t = bank('day');
    expect(t.teachers()).toHaveLength(0);
    expect(t.talks()).toBe(false);
  });

  it('AC-1: at night the teacher is there, friendly and unarmed, and his table answers', ({
    task,
  }) => {
    markExercised(task, 'creature', 'npc-quillon');
    const t = bank('night');
    const [teacher] = t.teachers();
    expect(t.teachers()).toHaveLength(1);
    expect(t.sim.get(teacher as never, FactionMemberComponent)).toMatchObject({
      faction: 'townsfolk',
      toward: { player: 'friendly' },
    });
    expect(t.talks()).toBe(true);
  });

  it('AC-1: he arrives at dusk, stays through the night and leaves at dawn', () => {
    const t = bank('day');
    for (const [phase, present] of [
      ['dusk', true],
      ['night', true],
      ['dawn', false],
      ['day', false],
      ['night', true],
    ] as const) {
      t.setPhase(phase);
      expect(t.teachers()).toHaveLength(present ? 1 : 0);
      expect(t.talks()).toBe(present);
    }
  });

  it('AC-1: the Bridge Watch keep shifts: day guards by day, the night guard by night, all at dusk', () => {
    const guards = (phase: string) => {
      const game = createGameWorld<unknown>(RAPIER, {
        seed: 1,
        hz: 60,
        scene: 'briar-glen-lane',
        phase,
      });
      return game.world
        .query(CreatureComponent)
        .ids()
        .map((e) => game.world.get(e, CreatureComponent)?.origin.creature)
        .filter((c) => c?.startsWith('npc-watchman'))
        .sort();
    };
    expect(guards('day')).toEqual(['npc-watchman-day', 'npc-watchman-day']);
    expect(guards('night')).toEqual(['npc-watchman-night']);
    expect(guards('dusk')).toHaveLength(3);
    expect(guards('dawn')).toEqual(['npc-watchman-day', 'npc-watchman-day']);
  });

  it('without a clock he is simply there (headless worlds that set no phase)', () => {
    expect(bank(undefined).teachers()).toHaveLength(1);
  });
});

describe('the Ember lesson (mw-ju8.14)', () => {
  it('AC-2: paying 200 crowns teaches Ember and takes the price', ({ task }) => {
    markExercised(task, 'merchant', MERCHANT);
    const t = bank('night', 500);
    const lesson = content.get('merchant', MERCHANT).services.find((s) => s.id === 'ember');
    expect(lesson).toMatchObject({ kind: 'train', teaches: 'spell.ember', price: 200 });
    expect(t.book.knows(t.sim, t.player, 'spell.ember')).toBe(false);
    expect(t.shops.train(t.sim, t.player, MERCHANT, 'ember', t.book)).toEqual({
      ok: true,
      price: 200,
      capability: 'spell.ember',
    });
    expect(t.gold()).toBe(300);
    expect(t.book.knows(t.sim, t.player, 'spell.ember')).toBe(true);
    expect(t.shops.train(t.sim, t.player, MERCHANT, 'ember', t.book)).toEqual({
      ok: false,
      reason: 'already-known',
    });
  });

  it('too few crowns teaches nothing and charges nothing', () => {
    const t = bank('night', 199);
    expect(t.shops.train(t.sim, t.player, MERCHANT, 'ember', t.book)).toMatchObject({
      ok: false,
      reason: 'cannot-afford',
    });
    expect(t.gold()).toBe(199);
    expect(t.book.knows(t.sim, t.player, 'spell.ember')).toBe(false);
  });

  it('his lesson sits in the trainer band, his table is tagged for his merchant, and he teaches only Fire', () => {
    const merchant = content.get('merchant', MERCHANT);
    expect(merchant.npcId).toBe('npc-quillon');
    for (const service of merchant.services) {
      expect(service.price).toBeGreaterThanOrEqual(100);
      expect(service.price).toBeLessThanOrEqual(400);
      expect(service.teaches).toMatch(/^spell\./);
      expect(service.teaches).not.toMatch(/somnomancy|sleep|dream/i);
    }
    const spawns = content.get('scene', 'under-the-bridge').spawns;
    const table = spawns.find((s) => s.id === 'quillon-lessons');
    expect(table?.tags).toContain(`merchant:${MERCHANT}`);
    expect(table?.presence?.phases).toEqual(['dusk', 'night']);
    expect(spawns.find((s) => s.id === 'npc-quillon')?.presence?.phases).toEqual(['dusk', 'night']);
  });

  it('the lane has the riverbank path, and it leads to the bank and back', () => {
    const lane = content.get('scene', 'briar-glen-lane');
    expect(lane.transitions.find((x) => x.id === 'riverbank-path')?.scene.id).toBe(
      'under-the-bridge',
    );
    expect(lane.spawns.some((s) => s.id === 'arrive-from-under-the-bridge')).toBe(true);
    const bank = content.get('scene', 'under-the-bridge');
    expect(bank.transitions.find((x) => x.id === 'path-up')?.scene.id).toBe('briar-glen-lane');
  });
});
