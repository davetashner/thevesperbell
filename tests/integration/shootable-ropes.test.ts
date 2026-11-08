// mw-e05.13: shootable targets and cuttable ropes in the Bridgeward College's archery butts, loaded
// through the game's own wiring (createGameWorld: Rapier physics, scene mechanisms, the arrow system over
// the real collision world). Arrows are loosed straight from content (standard, broadhead, blunt); the
// non-arrow packet is a pierce stimulus on the rope's contact, exactly what a thrown dagger or a spell
// projectile with a cutting head sends.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  CuttableComponent,
  doorStatus,
  fireArrow,
  ImpactSwitchComponent,
  PhysicsObjectComponent,
  readProperty,
  SceneSpawnComponent,
  suspensionReleased,
  type EntityId,
  type SuspensionReleased,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function range() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'bridgeward-college' });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const released: SuspensionReleased[] = [];
  sim.events.on(suspensionReleased, (e) => released.push(e));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  steps(5); // settle
  const shoot = (arrow: string, origin: Vec3, velocity: Vec3) =>
    fireArrow(sim, game.combat.bow.arrows, { arrow, origin, velocity });
  const hangsAt = () => sim.get(id('chandelier'), PhysicsObjectComponent)?.position.y ?? NaN;
  return { game, sim, id, released, steps, shoot, hangsAt };
}

describe('shootable targets and cuttable ropes in the archery butts (mw-e05.13)', () => {
  it('AC-1: an arrow at or above the threshold on the shootable target opens the gate wired to it', ({
    task,
  }) => {
    markExercised(task, 'scene', 'bridgeward-college');
    markExercised(task, 'arrow', 'standard');
    markExercised(task, 'signal-graph', 'bridgeward-archery');
    const r = range();
    const target = r.id('gate-target');
    expect(r.sim.has(target, ImpactSwitchComponent)).toBe(true);
    expect(readProperty(r.sim, target, 'shootable')).toBe(1);
    expect(doorStatus(r.sim, r.id('archery-gate'))).toBe('closed');
    // 25 g at 60 m/s: 1.5 N·s, over the 1 N·s threshold.
    r.shoot('standard', v(7, 1.5, 0), v(0, 0, 60));
    r.steps(240);
    expect(r.sim.get(target, ImpactSwitchComponent)?.active).toBe(true);
    expect(doorStatus(r.sim, r.id('archery-gate'))).toBe('open');
  });

  it('a weak arrow on the target does not open the gate (below the impulse threshold)', () => {
    const r = range();
    r.shoot('standard', v(7, 1.5, 0), v(0, 0, 20)); // 0.5 N·s
    r.steps(240);
    expect(r.sim.get(r.id('gate-target'), ImpactSwitchComponent)?.active).toBe(false);
    expect(doorStatus(r.sim, r.id('archery-gate'))).toBe('closed');
  });

  it('AC-2: a broadhead arrow severs the rope and the chandelier falls as a physics object', ({
    task,
  }) => {
    markExercised(task, 'arrow', 'broadhead');
    markExercised(task, 'testprop', 'chandelier');
    const r = range();
    const rope = r.id('chandelier-rope');
    const chandelier = r.id('chandelier');
    const before = r.hangsAt();
    expect(r.sim.has(rope, CuttableComponent)).toBe(true);
    // Hanging: it stays where it is for a second, though it is a body under gravity.
    r.steps(60);
    expect(r.hangsAt()).toBeCloseTo(before, 3);
    expect(readProperty(r.sim, chandelier, 'suspended')).toBe(true);
    r.shoot('broadhead', v(1.5, 2.75, -2), v(0, 0, 60));
    r.steps(240);
    expect(r.sim.isAlive(rope)).toBe(false);
    expect(r.released).toHaveLength(1);
    expect(r.released[0]?.entity).toBe(chandelier);
    expect(readProperty(r.sim, chandelier, 'suspended')).toBe(false);
    expect(r.sim.has(chandelier, PhysicsObjectComponent)).toBe(true);
    expect(r.hangsAt()).toBeLessThan(before - 1); // it dropped to the floor
  });

  it('AC-3: a blunt arrow does not sever the rope', ({ task }) => {
    markExercised(task, 'arrow', 'blunt');
    const r = range();
    const before = r.hangsAt();
    r.shoot('blunt', v(1.5, 2.75, -2), v(0, 0, 60));
    r.steps(240);
    expect(r.sim.isAlive(r.id('chandelier-rope'))).toBe(true);
    expect(r.released).toEqual([]);
    expect(r.hangsAt()).toBeCloseTo(before, 2);
  });

  it('AC-5: a non-arrow pierce projectile severs the rope identically', () => {
    const r = range();
    const before = r.hangsAt();
    // A thrown dagger's packet: pierce, on contact with the rope, from a source.
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('chandelier-rope') },
      element: 'pierce',
      intensity: 8,
      source: r.game.player,
    });
    r.steps(240);
    expect(r.sim.isAlive(r.id('chandelier-rope'))).toBe(false);
    expect(r.released).toMatchObject([{ entity: r.id('chandelier'), source: r.game.player }]);
    expect(r.hangsAt()).toBeLessThan(before - 1);
    expect(r.sim.get(r.id('chandelier'), SceneSpawnComponent)?.id).toBe('chandelier');
  });
});
