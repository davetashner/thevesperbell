// Spawns that keep to some phases of the day, in the game's wiring (mw-ju8.14): `watchPresence` brings
// them in and out as the clock's phase fact changes, reports a spawn that cannot be made, and lets go.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreatureComponent, PHASE_FACT, type World } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { watchPresence } from '@game/creatures/presence';

afterEach(() => {
  vi.restoreAllMocks();
});

function bank(scene: string, phase: string) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene, phase });
  const sim = game.world as unknown as World<never>;
  const teachers = () =>
    sim
      .query(CreatureComponent)
      .ids()
      .filter((e) => sim.get(e, CreatureComponent)?.origin.creature === 'npc-quillon').length;
  return { game, sim, teachers };
}

describe('watchPresence (mw-ju8.14)', () => {
  it('AC-1: brings a night creature in at dusk, takes it out at dawn, and ignores other facts', () => {
    const { game, sim, teachers } = bank('under-the-bridge', 'day');
    expect(teachers()).toBe(0);
    sim.facts.set('time.day', 2);
    game.world.step();
    expect(teachers()).toBe(0);
    sim.facts.set(PHASE_FACT, 'dusk');
    game.world.step();
    expect(teachers()).toBe(1);
    sim.facts.set(PHASE_FACT, 'dawn');
    game.world.step();
    expect(teachers()).toBe(0);
  });

  it('reports a creature it cannot spawn, to the caller or to the console, and lets go when told', () => {
    const { game, sim } = bank('under-the-bridge', 'day');
    const broken = { ...game.creatures.spawn, creatures: new Map() };
    const lines: string[] = [];
    const stop = watchPresence(sim, broken, game.scene.layout.spawns, (line) => lines.push(line));
    sim.facts.set(PHASE_FACT, 'night');
    game.world.step();
    expect(lines).toEqual(['creature spawn "npc-quillon": unknown-creature']);
    stop();
    sim.facts.set(PHASE_FACT, 'dusk');
    game.world.step();
    expect(lines).toHaveLength(1);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    watchPresence(sim, broken, game.scene.layout.spawns);
    sim.facts.set(PHASE_FACT, 'dawn');
    game.world.step();
    sim.facts.set(PHASE_FACT, 'night');
    game.world.step();
    expect(spy).toHaveBeenCalledWith('creature spawn "npc-quillon": unknown-creature');
  });

  it('a scene with nothing phase-bound is not watched', () => {
    const { game, sim } = bank('marsh-store', 'day');
    const stop = watchPresence(sim, game.creatures.spawn, game.scene.layout.spawns);
    expect(typeof stop).toBe('function');
    stop();
  });
});
