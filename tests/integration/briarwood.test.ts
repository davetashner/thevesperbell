// mw-e25.1 + mw-e25.22 on real content, headless on the game's own wiring (createGameWorld): the
// Briarwood greybox's named nodes (AC-1), the bramble gates that burn open on the navmesh with a fire
// that stays inside 12 m (AC-2), the scene-wide briarwood region (AC-3), and the town link both
// ways (mw-e25.22). The frame-time budget (AC-4) is the perf suite's (README: Perf budgets).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  readProperty,
  doorStatus,
  entitiesWithProperty,
  PlacementComponent,
  placeEntity,
  regionsAt,
  type EntityId,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'briarwood');

/** The nodes the bible places in the Briarwood plus the trail ends the bead names (mw-e25.1). */
const EXTRA_MARKERS = ['mine-road-junction', 'moorings-spur'];
const BRAMBLE_REACH_M = 12;

const spawnAt = (id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};

describe('the Briarwood greybox (mw-e25.1)', () => {
  it('AC-1: every bible Briarwood location has a named node linked in connectivity.json', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'briarwood');
    expect(nodes.map((n) => n.id).sort()).toEqual(
      [
        'briarwood-edge',
        'briarwood-hub',
        'millpond',
        'millweir-far-bank',
        'priory-road',
        'sleepers-path',
        'standing-horn',
        'wolf-den',
        'woodcutters-hut',
      ].sort(),
    );
    const names = new Set(scene.spawns.map((s) => s.id));
    for (const node of nodes) {
      expect(node.scene?.id, `${node.id} is built`).toBe('briarwood');
      expect(names.has(node.id), `${node.id} is a spawn of the scene`).toBe(true);
      const linked = (world?.edges ?? []).some((e) => e.from === node.id || e.to === node.id);
      expect(linked, `${node.id} has an edge`).toBe(true);
    }
    for (const id of EXTRA_MARKERS) expect(names.has(id), id).toBe(true);
  });

  it('AC-1: the markers lie on the trails of a 300 x 250 m scene, reachable on the navmesh from the town gate', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
    const probe = game.world.spawn();
    placeEntity(game.world, probe, spawnAt('arrive-from-briar-glen-lane'), 0.35);
    for (const id of [
      ...(world?.nodes ?? []).filter((n) => n.area === 'briarwood').map((n) => n.id),
      ...EXTRA_MARKERS,
    ]) {
      const metres = game.navigation.distance(game.world, probe, spawnAt(id));
      expect(Number.isFinite(metres), `${id} is reachable from the gate`).toBe(true);
    }
    const floor = scene.placements.find((p) => p.piece.id === 'floor');
    expect(floor?.scale).toEqual([150, 1, 125]);
  });

  it('AC-3: the player stands in region briarwood anywhere in the scene, and the respawn rule names it', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
    const { regions } = game.scene.layout;
    const spots = scene.spawns.filter((s) => !('door' in s && s.door !== undefined));
    expect(spots.length).toBeGreaterThan(10);
    for (const spawn of spots) {
      const at = { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
      expect(regionsAt(regions, at), spawn.id).toContain('briarwood');
    }
    // The corners of the walkable floor, and a point off the map.
    for (const at of [
      { x: -149, y: 0, z: 1 },
      { x: 149, y: 0, z: 249 },
    ]) {
      expect(regionsAt(regions, at)).toEqual(['briarwood']);
    }
    expect(regionsAt(regions, { x: 0, y: 0, z: -5 })).toEqual([]);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'briarwood');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });
});

describe('the bramble gates (mw-e25.1 AC-2)', () => {
  const HEDGE_WEST = { x: -55, y: 0, z: 72 };
  const HEDGE_EAST = { x: -55, y: 0, z: 88 };

  it('AC-2: burning a bramble gate opens the navmesh behind it, and the fire stays inside 12 m', ({
    task,
  }) => {
    markExercised(task, 'material', 'ivy');
    const game = createGameWorld<never>(RAPIER, {
      seed: 3,
      hz: 60,
      scene: 'briarwood',
      magic: true,
    });
    const sim = game.world;
    const gates = game.scene.spawns.filter((s) => s.spawn.door !== undefined);
    expect(gates).toHaveLength(8);
    expect(gates.every((g) => g.spawn.door?.profile === 'bramble-barrier')).toBe(true);
    const gate = (id: string): EntityId => {
      const found = gates.find((g) => g.spawn.id === id);
      if (found === undefined) throw new Error(`no gate ${id}`);
      return found.entity;
    };
    const probe = sim.spawn();
    placeEntity(sim, probe, HEDGE_WEST, 0.35);
    const before = game.navigation.distance(sim, probe, HEDGE_EAST);
    // Closed, the hedge forces the long way round its 40 m run.
    expect(before).toBeGreaterThan(30);
    expect(doorStatus(sim, gate('bramble-hut-hedge-a'))).toBe('closed');

    const torch = gate('bramble-hut-hedge-a');
    const origin = sim.get(torch, PlacementComponent);
    if (origin === undefined) throw new Error('the gate has no placement');
    const burned = new Set<EntityId>();
    let cap = 0;
    for (let tick = 0; tick < 60 * 90; tick++) {
      // A torch held to the gate until it takes (a few seconds), then taken away.
      if (!readProperty(sim, torch, 'burning') && tick < 600)
        applyStimulus(sim, {
          shape: { kind: 'contact', target: torch },
          element: 'heat',
          intensity: 400,
        });
      sim.step();
      for (const id of entitiesWithProperty(sim, 'burning')) {
        if (!readProperty(sim, id, 'burning')) continue;
        const at = sim.get(id, PlacementComponent);
        if (at === undefined) continue;
        burned.add(id);
        cap = Math.max(cap, Math.hypot(at.x - origin.x, at.z - origin.z));
      }
    }
    expect(burned.size).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(BRAMBLE_REACH_M);
    // The torched gate burnt away and the way through the hedge is open: a short walk now.
    expect(sim.isAlive(torch)).toBe(false); // ivy burns away: the barrier is gone
    const after = game.navigation.distance(sim, probe, HEDGE_EAST);
    expect(after).toBeLessThan(before / 2);
    expect(after).toBeLessThan(25);
    // The other hedges' gates still stand.
    for (const other of gates.filter((g) => !g.spawn.id.startsWith('bramble-hut-hedge'))) {
      expect(doorStatus(sim, other.entity), other.spawn.id).toBe('closed');
    }
  }, 120_000);
});

describe('the woodside path (mw-e25.22)', () => {
  it('AC-2: edge lane-briarwood-edge lists both transitions, and each leads to a spawn of the other scene', () => {
    const edge = world?.edges.find((e) => e.id === 'lane-briarwood-edge');
    expect(edge?.transitions).toEqual(['briar-glen-lane/woodside-path', 'briarwood/town-gate']);
    const lane = content.get('scene', 'briar-glen-lane');
    const out = lane.transitions.find((t) => t.id === 'woodside-path');
    const back = scene.transitions.find((t) => t.id === 'town-gate');
    expect(out).toMatchObject({ scene: { id: 'briarwood' }, spawn: 'arrive-from-briar-glen-lane' });
    expect(back).toMatchObject({
      scene: { id: 'briar-glen-lane' },
      spawn: 'arrive-from-briarwood',
    });
    expect(scene.spawns.some((s) => s.id === out?.spawn)).toBe(true);
    expect(lane.spawns.some((s) => s.id === back?.spawn)).toBe(true);
  });
});
