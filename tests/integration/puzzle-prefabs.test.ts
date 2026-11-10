// mw-e15.4: the prefab gallery, loaded through the game's own wiring (createGameWorld: Rapier physics,
// scene mechanisms, fire and liquids). Each prefab is data built from existing world components, so
// each test below drives it through the property it is made of: a rotate step, a weight, a beam.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  applyStimulus,
  deliverImpact,
  doorStatus,
  interacted,
  levelOf,
  LiquidVolumeComponent,
  PlacementComponent,
  PushConfigComponent,
  readProperty,
  teleportPhysicsObject,
  SignalGraphComponent,
  signalOutput,
  SubmergedComponent,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();

const positionOf = (sim: World<never>, entity: EntityId) => {
  const at = sim.get(entity, PlacementComponent);
  if (at === undefined) throw new Error('not placed');
  return { x: at.x, y: at.y, z: at.z };
};

function gallery() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'prefab-gallery',
    magic: true,
    content,
  });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  const graph = (instance: string): EntityId => {
    let found: EntityId | undefined;
    sim.query(SignalGraphComponent).forEach((entity, g) => {
      if (g.graph.id === instance) found = entity;
    });
    if (found === undefined) throw new Error(`no graph ${instance}`);
    return found;
  };
  const out = (instance: string, node: string) => signalOutput(sim, graph(instance), node);
  const use = (target: EntityId, verb: 'rotate' | 'pull' | 'press') => {
    sim.events.emit(interacted, { actor: game.player, target, verb, affordance: 0 });
    steps(2);
  };
  /** Sets a crate (by spawn id) down at (x, z), on the floor. */
  const put = (name: string, at: { x: number; z: number }) => {
    teleportPhysicsObject(sim, id(name), { x: at.x, y: 0.4, z: at.z });
  };
  return { game, sim, id, steps, out, use, put };
}

const FACINGS = ['east', 'south', 'west', 'north'] as const;

describe('puzzle prefab gallery', () => {
  it(
    'AC-2: the statue prefab facing north, turned four steps, reads east, south, west, north',
    {
      timeout: 120_000,
    },
    () => {
      const g = gallery();
      g.steps(5);
      const facing = () =>
        ['north', 'east', 'south', 'west'].filter((d) => g.out('statue-demo', `facing-${d}`));
      expect(facing()).toEqual(['north']);
      const statue = g.id('statue-demo-statue');
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        g.use(statue, 'rotate');
        seen.push(...facing());
      }
      expect(seen).toEqual([...FACINGS]);
    },
  );

  it(
    'AC-3: the basin prefab with its valve opened loses water and its submerged plate becomes reachable',
    {
      timeout: 120_000,
    },
    () => {
      const g = gallery();
      g.steps(5);
      const basin = g.id('basin-demo-basin');
      const plate = g.id('basin-demo-plate');
      const level = () => {
        const volume = g.sim.get(basin, LiquidVolumeComponent);
        if (volume === undefined) throw new Error('no volume');
        return levelOf(volume);
      };
      const before = level();
      expect(before).toBeCloseTo(0.8, 5);
      expect(g.sim.has(plate, SubmergedComponent)).toBe(true);
      g.steps(120);
      expect(level()).toBeCloseTo(before, 5); // the valve is shut: nothing drains
      g.use(g.id('basin-demo-valve'), 'pull');
      expect(g.out('basin-demo', 'valve-open')).toBe(true);
      g.steps(60 * 9);
      expect(level()).toBeLessThan(before);
      expect(level()).toBeLessThan(0.05);
      expect(g.sim.has(plate, SubmergedComponent)).toBe(false);
      // Reachable: a crate set on the plate now presses it.
      expect(g.out('basin-demo', 'plate-pressed')).toBe(false);
      g.put('crates-demo-crate-20', { x: 3, z: -4 });
      g.steps(90);
      expect(g.out('basin-demo', 'plate-pressed')).toBe(true);
    },
  );

  it('the crate set weighs 5, 10, 20 and 40 kg', { timeout: 120_000 }, () => {
    const g = gallery();
    for (const kg of [5, 10, 20, 40]) {
      expect(readProperty(g.sim, g.id(`crates-demo-crate-${String(kg)}`), 'weight')).toBe(kg);
    }
  });

  it('the brazier prefab burns when heated, and its sensor says so', { timeout: 120_000 }, () => {
    const g = gallery();
    g.steps(5);
    expect(g.out('fire-demo', 'lit')).toBe(false);
    applyStimulus(g.sim, {
      shape: { kind: 'contact', target: g.id('fire-demo-brazier') },
      element: 'heat',
      intensity: 500,
      source: g.game.player,
    });
    g.steps(30);
    expect(g.out('fire-demo', 'lit')).toBe(true);
  });

  it(
    'the mirror, lens and beam source light the beam sensor once the mirror is turned right',
    {
      timeout: 120_000,
    },
    () => {
      const g = gallery();
      g.steps(10);
      expect(g.out('sensor-demo', 'lit')).toBe(false);
      const mirror = g.id('mirror-demo-mirror');
      const lit: boolean[] = [];
      for (let i = 0; i < 8; i++) {
        g.use(mirror, 'rotate');
        g.steps(45);
        lit.push(g.out('sensor-demo', 'lit'));
      }
      expect(lit).toContain(true);
      expect(lit).toContain(false);
    },
  );

  it('the counterweight lift rises under 30 kg and falls without it', { timeout: 120_000 }, () => {
    const g = gallery();
    g.steps(5);
    const lift = g.id('lift-demo-lift');
    expect(doorStatus(g.sim, lift)).toBe('closed');
    g.put('crates-demo-crate-10', { x: 8, z: -5 });
    g.steps(90);
    expect(doorStatus(g.sim, lift)).toBe('closed'); // 10 kg is too little
    g.put('crates-demo-crate-10', { x: -9, z: -4 });
    g.put('crates-demo-crate-40', { x: 8, z: -5 });
    g.steps(180);
    expect(g.out('lift-demo', 'raised')).toBe(true);
    expect(doorStatus(g.sim, lift)).toBe('open');
  });

  it(
    'the scale plate pair is balanced with 20 kg or more on each plate',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      g.put('crates-demo-crate-20', { x: 7.5, z: -0.5 });
      g.steps(90);
      expect(g.out('scales-demo', 'left-on')).toBe(true);
      expect(g.out('scales-demo', 'balanced')).toBe(false);
      g.put('crates-demo-crate-40', { x: 8.5, z: -0.5 });
      g.steps(90);
      expect(g.out('scales-demo', 'balanced')).toBe(true);
    },
  );

  it(
    'the timed door opens on the button and shuts again after its seconds',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      const door = g.id('door-demo-door');
      expect(doorStatus(g.sim, door)).toBe('closed');
      g.use(g.id('door-demo-button'), 'press');
      g.steps(120);
      expect(g.out('door-demo', 'open')).toBe(true);
      expect(doorStatus(g.sim, door)).toBe('open');
      g.steps(60 * 7);
      expect(g.out('door-demo', 'open')).toBe(false);
      expect(['closing', 'closed']).toContain(doorStatus(g.sim, door));
    },
  );

  it('the rune tiles solve only when stepped on in order', { timeout: 120_000 }, () => {
    const g = gallery();
    g.steps(5);
    const step = (tile: number) => {
      g.put('crates-demo-crate-40', { x: -2 + tile * 1.5, z: 3 });
      g.steps(45);
      g.put('crates-demo-crate-40', { x: -9, z: -4 });
      g.steps(45);
    };
    step(2);
    step(0);
    expect(g.out('runes-demo', 'solved')).toBe(false);
    step(0);
    step(1);
    step(2);
    expect(g.out('runes-demo', 'solved')).toBe(true);
  });

  it(
    'the bell rings when struck and the crystal charges and stays charged',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      const strike = (
        name: string,
        spec: { damageType: 'blunt' | null; element: 'charge' | null },
      ) =>
        deliverImpact(g.sim, {
          position: { ...positionOf(g.sim, g.id(name)) },
          energy: 500,
          damageType: spec.damageType,
          element: spec.element,
          source: null,
        });
      expect(g.out('bell-demo', 'rung')).toBe(false);
      strike('bell-demo-bell', { damageType: 'blunt', element: null });
      g.steps(5);
      expect(g.out('bell-demo', 'rung')).toBe(true);
      g.steps(60 * 5);
      expect(g.out('bell-demo', 'rung')).toBe(false);
      strike('crystal-demo-crystal', { damageType: null, element: 'charge' });
      g.steps(5);
      g.steps(60 * 10);
      expect(g.out('crystal-demo', 'charged')).toBe(true);
    },
  );

  it(
    'the sliding block is a pushable that moves a grid cell at a time',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      const block = g.id('block-demo-block');
      expect(g.sim.get(block, PushConfigComponent)).toMatchObject({ grid: 1, rotateStep: 0 });
      expect(readProperty(g.sim, block, 'pushable')).toBe(true);
    },
  );
});
