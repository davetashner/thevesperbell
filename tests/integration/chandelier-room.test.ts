// mw-e03.13: the grey-box chandelier room, loaded through the game's own wiring (createGameWorld:
// Rapier physics, scene mechanisms, the environment damage rules, the fire rules). A hemp rope holds an
// iron chandelier over the spot where the player stands; a rope bridge of twelve planks rated for 150 kg spans the
// east half with a 160 kg anvil hanging from its own rope over the middle. Every stimulus here is
// the one the game sends: an arrow's contact echo, a flame.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  DamageApplied,
  fireArrow,
  healthOf,
  PhysicsObjectComponent,
  PlacementComponent,
  readProperty,
  setProperty,
  SceneSpawnComponent,
  teleportCommand,
  supportReleased,
  suspensionReleased,
  type DamageResult,
  type EntityId,
  type SupportRelease,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function room(options: { magic?: boolean } = {}) {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'chandelier-room',
    ...options,
  });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const { player } = game;
  const released: SupportRelease[] = [];
  sim.events.on(supportReleased, (e) => released.push(e));
  const dropped: EntityId[] = [];
  sim.events.on(suspensionReleased, (e) => dropped.push(e.entity));
  const hits: DamageResult[] = [];
  sim.events.on(DamageApplied, (r) => hits.push(r));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  const heightOf = (name: string) => sim.get(id(name), PhysicsObjectComponent)?.position.y ?? NaN;
  const planks = [...byId.keys()].filter((name) => name.startsWith('rope-bridge-plank-'));
  steps(10); // settle
  return { game, sim, id, player, released, dropped, hits, steps, heightOf, planks };
}

describe('the chandelier room (mw-e03.13)', () => {
  it('AC-5: a pierce hit on the rope drops the chandelier, and impact damage lands on the player beneath', ({
    task,
  }) => {
    markExercised(task, 'scene', 'chandelier-room');
    markExercised(task, 'testprop', 'chandelier');
    const r = room();
    const { player } = r;
    const chandelier = r.id('chandelier');
    const before = r.heightOf('chandelier');
    // The player stands under the chandelier.
    r.game.world.step([teleportCommand(player, v(-4, 0.2, 0))]);
    const health = healthOf(r.sim, player)?.current ?? 0;
    expect(health).toBeGreaterThan(0);
    // Hanging: it holds for a second.
    r.steps(60);
    expect(r.heightOf('chandelier')).toBeCloseTo(before, 2);
    expect(readProperty(r.sim, chandelier, 'suspended')).toBe(true);
    expect(r.hits).toEqual([]);
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('chandelier-rope') },
      element: 'pierce',
      intensity: 60, // 42 through the rope's 30% resistance, over its 20 hp
      source: r.game.player,
    });
    r.steps(240);
    expect(r.released).toMatchObject([
      { cause: 'damage', held: [chandelier], source: r.game.player },
    ]);
    expect(readProperty(r.sim, chandelier, 'suspended')).toBe(false);
    expect(r.heightOf('chandelier')).toBeLessThan(before - 4);
    // The impact: blunt damage on the player, blamed on whoever shot the rope.
    const crush = r.hits.filter((h) => h.packet.tags.includes('crush'));
    expect(crush).toHaveLength(1);
    expect(crush[0]?.packet).toMatchObject({ instigator: r.game.player, source: chandelier });
    expect(crush[0]?.amounts.blunt).toBeGreaterThan(30);
    expect(healthOf(r.sim, player)?.current).toBeLessThan(health);
  });

  it('an arrow through the rope does the same (the broadhead is not required)', ({ task }) => {
    markExercised(task, 'arrow', 'standard');
    const r = room();
    r.game.world.step([teleportCommand(r.player, v(-4, 0.2, 0))]);
    const chandelier = r.id('chandelier');
    // From the south side, level with the rope's middle (y 8 m), 4 m back, straight at it.
    fireArrow(r.sim, r.game.combat.bow.arrows, {
      arrow: 'standard',
      origin: v(-4, 8, -4),
      velocity: v(0, 0, 60),
    });
    r.steps(240);
    expect(r.released).toMatchObject([{ cause: 'damage', held: [chandelier] }]);
    expect(r.hits.some((h) => h.packet.tags.includes('crush'))).toBe(true);
  });

  it('a flame on the rope burns it away and the chandelier falls on the player, blaming no one', () => {
    const r = room({ magic: true });
    r.game.world.step([teleportCommand(r.player, v(-4, 0.2, 0))]);
    const chandelier = r.id('chandelier');
    // The rope's hemp burns for 40 s; a short length of it keeps the test quick.
    setProperty(r.sim, r.id('chandelier-rope'), 'fuel', 2);
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('chandelier-rope') },
      element: 'heat',
      intensity: 600,
    });
    r.steps(60 * 6);
    expect(r.released).toMatchObject([{ cause: 'burnt', source: null, held: [chandelier] }]);
    expect(r.sim.get(chandelier, SceneSpawnComponent)?.id).toBe('chandelier');
    const crush = r.hits.filter((h) => h.packet.tags.includes('crush'));
    expect(crush).toHaveLength(1);
  }, 30_000);

  it('AC-4: cutting the anvil’s rope drops 160 kg on the bridge; it snaps and every plank falls', ({
    task,
  }) => {
    markExercised(task, 'testprop', 'anvil');
    markExercised(task, 'testprop', 'bridge-plank');
    const r = room();
    expect(r.planks).toHaveLength(12);
    const rest = r.planks.map((name) => r.heightOf(name));
    r.steps(60);
    expect(r.planks.map((name) => r.heightOf(name))).toEqual(rest); // it holds
    expect(r.released).toEqual([]);
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('anvil-rope') },
      element: 'pierce',
      intensity: 60,
      source: r.game.player,
    });
    r.steps(180);
    expect(r.released.map((e) => e.cause)).toEqual(['damage', 'overload']);
    const bridge = r.released[1];
    expect(bridge?.held).toHaveLength(12);
    expect(bridge?.load).toBeGreaterThan(150);
    expect(r.planks.every((name) => r.heightOf(name) < 0.5)).toBe(true);
    expect(r.heightOf('anvil')).toBeLessThan(0.5);
  });

  it('the bridge bears the player: standing on its middle does not bring it down', () => {
    const r = room();
    r.game.world.step([teleportCommand(r.player, v(5.25, 1.4, 0))]);
    r.steps(180);
    expect(r.released).toEqual([]);
    const at = r.sim.get(r.player, PlacementComponent);
    expect(at?.y).toBeGreaterThan(1.05); // on the planks, not through them
  });
});
