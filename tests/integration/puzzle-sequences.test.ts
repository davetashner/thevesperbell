// mw-e15.5: ordered, timed and sound-clue puzzle mechanisms, from the prefab gallery loaded through
// the game's own wiring (Rapier physics, scene mechanisms). The sound clue emitter and the bell
// sequence are prefabs of the clue and sequence signal nodes; the plate timed door is a timer node
// started when the plate is released.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  deliverImpact,
  doorStatus,
  interacted,
  PlacementComponent,
  SignalGraphComponent,
  signalOutput,
  soundClueCued,
  teleportPhysicsObject,
  type EntityId,
  type SoundClueCue,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const HZ = 60;

function gallery() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: HZ,
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
  const out = (instance: string, node: string, port?: string) => {
    let found: EntityId | undefined;
    sim.query(SignalGraphComponent).forEach((entity, g) => {
      if (g.graph.id === instance) found = entity;
    });
    if (found === undefined) throw new Error(`no graph ${instance}`);
    return signalOutput(sim, found, node, port);
  };
  const cues: SoundClueCue[] = [];
  sim.events.on(soundClueCued, (cue) => cues.push(cue));
  const strike = (name: string) => {
    const at = sim.get(id(name), PlacementComponent);
    if (at === undefined) throw new Error('not placed');
    deliverImpact(sim, {
      position: { x: at.x, y: at.y, z: at.z },
      energy: 500,
      damageType: 'blunt',
      element: null,
      source: null,
    });
    steps(10);
  };
  const put = (name: string, at: { x: number; z: number }) => {
    teleportPhysicsObject(sim, id(name), { x: at.x, y: 0.4, z: at.z });
  };
  return { game, sim, id, steps, out, cues, strike, put };
}

describe('sound clue emitter', () => {
  it(
    'AC-1: the clue prefab, triggered, sounds low, high, mid in order, one second apart, from its source',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      expect(g.cues).toEqual([]);
      g.sim.events.emit(interacted, {
        actor: g.game.player,
        target: g.id('clue-demo-listen'),
        verb: 'press',
        affordance: 0,
      });
      g.steps(2);
      expect(g.out('clue-demo', 'chimes')).toBe(true);
      g.steps(HZ * 4);
      expect(g.cues.map((c) => c.cue)).toEqual(['chime-low', 'chime-high', 'chime-mid']);
      expect(g.cues.map((c) => c.tick - (g.cues[0]?.tick ?? 0))).toEqual([0, HZ, 2 * HZ]);
      expect(g.cues.every((c) => c.entity === g.id('clue-demo-source'))).toBe(true);
      expect(g.out('clue-demo', 'chimes')).toBe(false);
    },
  );
});

describe('bell sequence', () => {
  it(
    'AC-2: striking low, high, mid solves it; any wrong bell resets it and sounds the wrong chime',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      g.strike('bells-demo-bell-low');
      g.strike('bells-demo-bell-high');
      expect(g.out('bells-demo', 'solved')).toBe(false);
      g.strike('bells-demo-bell-mid');
      g.steps(5);
      expect(g.out('bells-demo', 'solved')).toBe(true);
      expect(g.cues.map((c) => c.cue)).toEqual(['chime-solved']);
    },
  );

  it(
    'AC-2: a wrong bell resets the sequence and fires a failure cue; the right order afterwards still solves',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      g.strike('bells-demo-bell-low');
      g.strike('bells-demo-bell-mid'); // wrong: high was next
      expect(g.cues.map((c) => c.cue)).toEqual(['chime-wrong']);
      expect(g.out('bells-demo', 'solved')).toBe(false);
      // The run starts over, so high and then mid are two more wrong bells, not a finish.
      g.steps(HZ * 2);
      g.strike('bells-demo-bell-high');
      g.strike('bells-demo-bell-mid');
      expect(g.cues.map((c) => c.cue)).toEqual(['chime-wrong', 'chime-wrong', 'chime-wrong']);
      expect(g.out('bells-demo', 'solved')).toBe(false);
      g.steps(HZ * 2);
      g.strike('bells-demo-bell-low');
      g.strike('bells-demo-bell-high');
      g.strike('bells-demo-bell-mid');
      g.steps(5);
      expect(g.out('bells-demo', 'solved')).toBe(true);
      expect(g.cues.at(-1)?.cue).toBe('chime-solved');
    },
  );
});

describe('plate timed door', () => {
  it(
    'AC-3: with an 8 s window, the door is open at 7.9 s after the plate is released and shut at 8.1 s',
    { timeout: 120_000 },
    () => {
      const g = gallery();
      g.steps(5);
      const door = g.id('race-demo-door');
      expect(doorStatus(g.sim, door)).toBe('closed');
      g.put('crates-demo-crate-40', { x: -8, z: -3 }); // on the plate
      g.steps(120);
      expect(g.out('race-demo', 'open')).toBe(true);
      expect(doorStatus(g.sim, door)).toBe('open');
      // Held for as long as the weight stays: well past the window.
      g.steps(HZ * 10);
      expect(g.out('race-demo', 'open')).toBe(true);
      g.put('crates-demo-crate-40', { x: -9, z: -4 }); // release
      let waited = 0;
      while (g.out('race-demo', 'held') && waited++ < HZ) g.steps(1);
      expect(g.out('race-demo', 'held')).toBe(false);
      g.steps(Math.round(7.9 * HZ));
      expect(g.out('race-demo', 'open')).toBe(true);
      expect(doorStatus(g.sim, door)).toBe('open');
      g.steps(Math.round(0.2 * HZ)); // 8.1 s after the release
      expect(g.out('race-demo', 'open')).toBe(false);
      expect(['closing', 'closed']).toContain(doorStatus(g.sim, door));
      g.steps(HZ * 2);
      expect(doorStatus(g.sim, door)).toBe('closed');
    },
  );
});
