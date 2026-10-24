// Physics objects in the game (mw-e03.39): world setup, budget warnings and prop bodies from content.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent } from '@content/index';
import {
  addPhysicsObject,
  addProperties,
  CharacterController,
  initialCharacterState,
  RapierPhysics,
  World,
  type PhysicsBudgetExceeded,
  type Vec3,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  formatBudgetWarning,
  installGamePhysics,
  playerFocus,
  propBodies,
} from './physics-objects';

describe('game physics objects (mw-e03.39)', () => {
  it('mw-e06.15: beforeStimuli and afterStimuli install around the stimulus system', () => {
    const world = new World<string>({ seed: 2, physics: new RapierPhysics(RAPIER) });
    const order: string[] = [];
    installGamePhysics(world, {
      beforeStimuli: (sim) => {
        sim.addSystem({ name: 'before', run: () => void order.push('before') });
      },
      afterStimuli: (sim) => {
        sim.addSystem({ name: 'after', run: () => void order.push('after') });
      },
    });
    world.step(['x']);
    expect(order).toEqual(['before', 'after']);
  });

  it('AC-4: budget warnings reach the log hook, asking the focus where the player is', () => {
    const world = new World<string>({ seed: 2, physics: new RapierPhysics(RAPIER) });
    const warnings: PhysicsBudgetExceeded[] = [];
    const asked: Vec3[] = [];
    installGamePhysics(world, {
      focus: () => {
        const player = { x: 0, y: 0, z: 0 };
        asked.push(player);
        return player;
      },
      onBudgetExceeded: (warning) => warnings.push(warning),
    });
    const sim = world as unknown as World<never>;
    for (let i = 0; i < 301; i++) {
      const crate = sim.spawn();
      addProperties(sim, crate, { weight: 5 });
      const at = { x: (i % 20) * 2, y: 10, z: Math.floor(i / 20) * 2 };
      addPhysicsObject(sim, crate, { shape: { kind: 'sphere', radius: 0.4 }, position: at });
    }
    world.step(['anything']);
    expect(asked).toHaveLength(1);
    expect(warnings).toEqual([{ tick: 0, active: 301, budget: 300, slept: [] }]);
    expect(warnings.map(formatBudgetWarning)).toEqual([
      'physics budget exceeded at tick 0: 301 awake bodies, budget 300; none could sleep (all moving or near the player)',
    ]);
    expect(formatBudgetWarning({ tick: 9, active: 305, budget: 300, slept: [1, 2, 3, 4, 5] })).toBe(
      'physics budget exceeded at tick 9: 305 awake bodies, budget 300; forced 5 to sleep',
    );
  });

  it('AC-4: the focus follows the player once there is one', () => {
    const world = new World({ seed: 2 }).register(CharacterController);
    const focus = playerFocus(world);
    expect(focus.read()).toBeUndefined();
    const player = world.spawn();
    focus.entity = player;
    expect(focus.read()).toBeUndefined(); // no controller yet
    world.add(player, CharacterController, initialCharacterState({ x: 1, y: 2, z: 3 }));
    expect(focus.read()).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('installs without a focus or a log hook', () => {
    const world = installGamePhysics(new World({ seed: 2, physics: new RapierPhysics(RAPIER) }));
    world.step();
    expect(world.tick).toBe(1);
  });

  it('AC-1: movable testprops have a body from their content; others and unknown props do not', () => {
    const content = loadGameContent();
    const bodies = propBodies(content);
    expect(bodies('crate')).toEqual({
      size: { x: 0.7, y: 0.7, z: 0.7 },
      material: 'wood',
      weight: 12,
      flammable: true,
    });
    expect(bodies('no-such-prop')).toBeUndefined();
    const fixed = propBodies({
      has: (type, id) => content.has(type, id),
      get: ((type: 'testprop', id: string) => {
        return { ...content.get(type, id), body: undefined };
      }) as typeof content.get,
    });
    expect(fixed('crate')).toBeUndefined();
  });
});
