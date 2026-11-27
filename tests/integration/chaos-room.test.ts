// mw-e03.54: the chaos room (src/content/data/scene/chaos-room.json) loaded through the game's own
// wiring. Each station's props reach their element state from the stimulus the game sends, so the room
// is a trustworthy stage for the e2e (mw-e03.28 AC-3), the identification playtest (AC-5) and the
// later combo catalogue (mw-e03.27).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  PhysicsObjectComponent,
  readProperty,
  type EntityId,
  type StimulusElement,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

vi.setConfig({ testTimeout: 120_000 });

function room() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'chaos-room',
    magic: true,
  });
  const sim = game.world as unknown as World<never>;
  const byId = new Map<string, EntityId>();
  const tagsOf = new Map<string, readonly string[]>();
  for (const { entity, spawn } of game.scene.spawns) {
    byId.set(spawn.id, entity);
    tagsOf.set(spawn.id, spawn.tags);
  }
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const tagged = (tag: string) => [...tagsOf].filter(([, t]) => t.includes(tag)).map(([n]) => n);
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  const hit = (name: string, element: StimulusElement, intensity: number) =>
    applyStimulus(sim, { shape: { kind: 'contact', target: id(name) }, element, intensity });
  steps(10);
  return { game, sim, id, tagged, steps, hit };
}

describe('the chaos room (mw-e03.54)', () => {
  it('AC-1: four stations, six identification props 3 m apart in a row, and open floor with a plate and a rope', ({
    task,
  }) => {
    markExercised(task, 'scene', 'chaos-room');
    const { sim, id, tagged } = room();
    for (const station of ['fire', 'wet', 'freeze', 'charge']) {
      expect(tagged(`station-${station}`).length, station).toBeGreaterThanOrEqual(3);
    }
    const ident = tagged('ident');
    expect(ident).toHaveLength(6);
    const at = ident.map((n) => sim.get(id(n), PhysicsObjectComponent)?.position);
    for (let i = 1; i < at.length; i++) {
      expect(Math.abs((at[i]?.x ?? 0) - (at[i - 1]?.x ?? 0))).toBeGreaterThanOrEqual(2.99);
      expect(at[i]?.z).toBeCloseTo(at[0]?.z ?? NaN, 1);
    }
    expect(tagged('plate')).toHaveLength(1);
    expect(tagged('rope')).toHaveLength(1);
    // Open floor: nothing but the plate stands within 2 m of the room's centre.
    for (const name of tagged('station-fire').concat(tagged('ident'))) {
      const p = sim.get(id(name), PhysicsObjectComponent)?.position;
      if (p !== undefined) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(2);
    }
  });

  it('AC-2: heat on a fire-station crate burns it and nothing else in the room', () => {
    const { sim, id, tagged, hit, steps } = room();
    hit('fire-crate-1', 'heat', 600);
    steps(60);
    expect(readProperty(sim, id('fire-crate-1'), 'burning')).toBe(true);
    for (const name of [...tagged('ident'), ...tagged('station-freeze'), 'wet-crate-1']) {
      expect(readProperty(sim, id(name), 'burning'), name).not.toBe(true);
    }
  });

  it('AC-3: water on a wet-station crate soaks it', () => {
    const { sim, id, hit, steps } = room();
    hit('wet-crate-1', 'water', 5);
    steps(5);
    expect(readProperty(sim, id('wet-crate-1'), 'wetness')).toBeGreaterThanOrEqual(0.35);
    expect(readProperty(sim, id('wet-crate-2'), 'wetness')).toBeLessThan(0.35);
  });

  it('AC-4: cold on a soaked freeze-station crate freezes it, and the ice block starts frozen', () => {
    const { sim, id, hit, steps } = room();
    expect(readProperty(sim, id('freeze-ice-block'), 'frozen')).toBe(true);
    hit('freeze-crate-1', 'water', 1);
    steps(2);
    hit('freeze-crate-1', 'cold', 60);
    steps(5);
    expect(readProperty(sim, id('freeze-crate-1'), 'frozen')).toBe(true);
    expect(readProperty(sim, id('freeze-crate-2'), 'frozen')).not.toBe(true);
  });

  it('AC-5: charge on the iron anvil charges it', () => {
    const { sim, id, hit, steps } = room();
    hit('charge-anvil', 'charge', 10);
    steps(2);
    expect(readProperty(sim, id('charge-anvil'), 'charge')).toBeGreaterThanOrEqual(1);
  });
});
