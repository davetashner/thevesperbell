import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { levelDeltasOf } from '../deltas/store';
import { factCommand } from '../facts/commands';
import { isDebugCommand, restoreStateCommand } from './commands';
import { installDebugCommands } from './system';

function restoreWorld() {
  const world = new World<unknown>({ seed: 4 });
  world.facts.declare('quest.x.stage', { type: 'int', default: 0 });
  world.facts.declare('gate.open', { type: 'bool', default: false });
  installDebugCommands(world, { spawners: new Map() });
  return world;
}

const CHEST = {
  level: 'inn',
  entities: [{ id: 'chest-1', destroyed: true as const }],
  spawned: [],
};

describe('state restore (mw-e27.6)', () => {
  it('builds a JSON-safe command that copies what it is given', () => {
    const facts = { 'gate.open': true };
    const command = restoreStateCommand(facts, [CHEST]);
    expect(command).toEqual({ kind: 'sim.debug', op: 'restore', facts, levels: [CHEST] });
    expect(command.facts).not.toBe(facts);
    expect(isDebugCommand(command)).toBe(true);
  });

  it('puts facts and the deltas of unloaded levels back, replacing what came after', () => {
    const world = restoreWorld();
    world.step([factCommand({ 'quest.x.stage': 2 })]);
    const facts = world.facts.snapshot();
    const levels = levelDeltasOf(world);
    levels.restore([CHEST]);
    const before = levels.capture(world);

    world.step([factCommand({ 'quest.x.stage': 5, 'gate.open': true })]);
    levels.restore([]);
    world.step([restoreStateCommand(facts, before)]);

    expect(world.facts.snapshot()).toEqual({ 'quest.x.stage': 2 });
    expect(levels.capture(world)).toEqual([CHEST]);
  });

  it('skips a snapshot the fact registry rejects, changing nothing', () => {
    const world = restoreWorld();
    world.step([factCommand({ 'quest.x.stage': 2 })]);
    const levels = levelDeltasOf(world);
    levels.restore([CHEST]);
    world.step([restoreStateCommand({ 'quest.x.stage': 'high' }, [])]);
    expect(world.facts.get('quest.x.stage')).toBe(2);
    expect(levels.levels()).toEqual(['inn']);
  });

  it('leaves the same hash whether a replay re-runs it or not', () => {
    const run = () => {
      const world = restoreWorld();
      world.step([factCommand({ 'quest.x.stage': 3 })]);
      world.step([restoreStateCommand({ 'gate.open': true }, [])]);
      return world.facts.hash();
    };
    expect(run()).toBe(run());
  });
});
