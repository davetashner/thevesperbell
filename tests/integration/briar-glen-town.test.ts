/* eslint-disable @typescript-eslint/no-non-null-assertion -- geometry fixtures index boxes and vectors known to exist */
// mw-e24.2: Briar Glen grey-box town. The town is two scenes: briar-glen-lane (the shop lane, the
// Bridge Watch, Marsh's, the Sleeping Ox, the college, the three open shop fronts) and
// briar-glen-green (Market Green and the rest), joined by lane/green-gate and green/lane-gate.
// AC-1: every story bible 3.5 town location has a named node and an entry transition or
// interactable. AC-2: every building door is reachable on the navmesh from the road entry.
// Vane House stays visible from the town's spawns and the Stacks leans. The tour in the browser is
// e2e/briar-glen-town.spec.ts; the frame-time budget (AC-4) is the perf suite's.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { placeEntity } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const green = content.get('scene', 'briar-glen-green');
const lane = content.get('scene', 'briar-glen-lane');

interface Spot {
  x: number;
  y: number;
  z: number;
}
const spawnIn = (scene: typeof green, id: string): Spot => {
  const s = scene.spawns.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return { x: s.at[0], y: s.at[1], z: s.at[2] };
};

/** Every bible 3.5 town location: its node, the scene it stands in and how the player enters it. */
const LOCATIONS = [
  { node: 'market-green', scene: 'briar-glen-green', entry: { spawn: 'notice-board' } },
  {
    node: 'sleeping-ox',
    scene: 'briar-glen-lane',
    nodeScene: 'sleeping-ox',
    entry: { transition: 'sleeping-ox-door' },
  },
  { node: 'lamplit-stacks', scene: 'briar-glen-green', entry: { door: 'door-lamplit-stacks' } },
  { node: 'brands-forge', scene: 'briar-glen-lane', entry: { spawn: 'brand-forge-counter' } },
  {
    node: 'fenns-fletchery',
    scene: 'briar-glen-lane',
    entry: { spawn: 'fenn-fletchery-simples-counter' },
  },
  { node: 'pells-bakery', scene: 'briar-glen-lane', entry: { spawn: 'pell-bakery-counter' } },
  {
    node: 'marsh-store',
    scene: 'briar-glen-lane',
    nodeScene: 'marsh-store',
    entry: { transition: 'marsh-store-door' },
  },
  { node: 'watch-house', scene: 'briar-glen-green', entry: { door: 'door-watch-house' } },
  { node: 'vane-house', scene: 'briar-glen-green', entry: { door: 'door-vane-house' } },
  { node: 'schoolhouse', scene: 'briar-glen-green', entry: { door: 'door-schoolhouse' } },
  { node: 'glen-well', scene: 'briar-glen-green', entry: { spawn: 'glen-well' } },
  { node: 'cemetery', scene: 'briar-glen-green', entry: { spawn: 'cemetery' } },
] as const;

describe('Briar Glen town nodes (mw-e24.2 AC-1)', () => {
  it('AC-1: each bible location has a built node and an entry transition, door or interactable', () => {
    for (const loc of LOCATIONS) {
      const node = world?.nodes.find((n) => n.id === loc.node);
      expect(node?.scene?.id, `${loc.node} is built`).toBe(
        'nodeScene' in loc ? loc.nodeScene : loc.scene,
      );
      const scene = content.get('scene', loc.scene);
      const entry: { transition?: string; door?: string; spawn?: string } = loc.entry;
      if (entry.transition !== undefined) {
        const t = scene.transitions.find((x) => x.id === entry.transition);
        expect(t, `${loc.node} transition`).toBeDefined();
      } else if (entry.door !== undefined) {
        const d = scene.spawns.find((s) => s.id === entry.door);
        expect(d?.door?.lock?.id, `${loc.node} door`).toBe('town-closed');
      } else {
        const s = scene.spawns.find((x) => x.id === entry.spawn);
        expect(s?.interact, `${loc.node} interactable`).toBeDefined();
      }
    }
    for (const id of ['lamplit-stacks', 'watch-house', 'vane-house', 'schoolhouse', 'cemetery']) {
      expect(
        green.spawns.some((s) => s.id === id && s.tags.includes('node')),
        id,
      ).toBe(true);
    }
  });

  it('AC-1: the lane and the green are joined both ways, and the mine road is built and the priory road is a marked planned stub', () => {
    const edge = world?.edges.find((e) => e.id === 'lane-market-green');
    expect(edge?.transitions).toEqual(['briar-glen-lane/green-gate', 'briar-glen-green/lane-gate']);
    expect(lane.transitions.find((t) => t.id === 'green-gate')).toMatchObject({
      scene: { id: 'briar-glen-green' },
      spawn: 'arrive-from-briar-glen-lane',
    });
    expect(green.transitions.find((t) => t.id === 'lane-gate')).toMatchObject({
      scene: { id: 'briar-glen-lane' },
      spawn: 'arrive-from-briar-glen-green',
    });
    // The mine road is built (mw-e26.2): an open doorway with a signpost and a transition into the Deepworks.
    expect(green.spawns.find((s) => s.id === 'exit-mine-road')?.tags).toContain('node');
    expect(green.spawns.find((s) => s.id === 'door-exit-mine-road')).toBeUndefined();
    expect(green.spawns.find((s) => s.id === 'sign-exit-mine-road')?.interact).toBeDefined();
    expect(green.transitions.find((t) => t.id === 'mine-road-gate')).toMatchObject({
      scene: { id: 'deepworks' },
      spawn: 'arrive-from-briar-glen-green',
    });
    // The priory road is still a planned stub.
    expect(green.spawns.find((s) => s.id === 'exit-priory-road')?.tags).toContain(
      'planned:mw-e25.25',
    );
    expect(green.spawns.find((s) => s.id === 'door-exit-priory-road')?.door?.lock?.id).toBe(
      'road-not-open',
    );
    expect(green.spawns.find((s) => s.id === 'sign-exit-priory-road')?.interact).toBeDefined();
    expect(world?.edges.find((e) => e.id === 'green-mine-road')?.transitions).toEqual([
      'briar-glen-green/mine-road-gate',
      'deepworks/road-gate',
    ]);
    expect(world?.edges.find((e) => e.id === 'green-priory-road')?.bead).toBe('mw-e25.25');
  });
});

describe('Briar Glen town navigation (mw-e24.2 AC-2)', () => {
  const reach = (sceneId: string, from: string, targets: readonly Spot[]) => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: sceneId });
    const probe = game.world.spawn();
    const scene = content.get('scene', sceneId);
    placeEntity(game.world, probe, spawnIn(scene, from), 0.35);
    return targets.map((t) => game.navigation.distance(game.world, probe, t));
  };

  it('AC-2: every green building door front, the rise and both road stubs are reachable from the lane gate', () => {
    const fronts = green.spawns.filter(
      (s) =>
        s.tags.includes('door-front') || s.tags.includes('exit-stub') || s.tags.includes('node'),
    );
    expect(fronts.length).toBeGreaterThanOrEqual(11); // the mine road signpost is no longer an exit stub (mw-e26.2)
    const metres = reach(
      'briar-glen-green',
      'arrive-from-briar-glen-lane',
      fronts.map((s) => ({ x: s.at[0], y: s.at[1], z: s.at[2] })),
    );
    metres.forEach((m, i) => {
      expect(Number.isFinite(m), `${fronts[i]?.id ?? '?'} reachable`).toBe(true);
    });
  });

  it('AC-2: every lane door, the green gate and the woodside path are reachable from the bridge entry', () => {
    const ids = [
      'arrive-from-marsh-store',
      'arrive-from-sleeping-ox',
      'arrive-from-bridgeward-college',
      'arrive-from-under-the-bridge',
      'arrive-from-briarwood',
      'arrive-from-briar-glen-green',
    ];
    const metres = reach(
      'briar-glen-lane',
      'arrive-from-valley-03',
      ids.map((i) => spawnIn(lane, i)),
    );
    metres.forEach((m, i) => {
      expect(Number.isFinite(m), `${ids[i] ?? '?'} reachable`).toBe(true);
    });
  });
});

/** The scene's solid boxes (kit parts with the placement's scale and quarter-turn yaw). */
function boxes(scene: typeof green) {
  const out: { min: number[]; max: number[] }[] = [];
  for (const p of scene.placements) {
    const kit = content.get('kit', p.piece.id);
    const turned = p.yaw === 90 || p.yaw === 270;
    for (const part of kit.parts) {
      const sx = part.size[0] * p.scale[0];
      const sy = part.size[1] * p.scale[1];
      const sz = part.size[2] * p.scale[2];
      const ox = part.offset[0] * p.scale[0];
      const oz = part.offset[2] * p.scale[2];
      const [w, d] = turned ? [sz, sx] : [sx, sz];
      const [cx, cz] = turned ? [oz, ox] : [ox, oz];
      const y = p.at[1] + part.offset[1] * p.scale[1];
      out.push({
        min: [p.at[0] + cx - w / 2, y - sy / 2, p.at[2] + cz - d / 2],
        max: [p.at[0] + cx + w / 2, y + sy / 2, p.at[2] + cz + d / 2],
      });
    }
  }
  return out;
}

function blocked(solids: ReturnType<typeof boxes>, a: number[], b: number[]): boolean {
  return solids.some((box) => {
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 3; k++) {
      const from = a[k] ?? 0;
      const delta = (b[k] ?? 0) - from;
      const lo = box.min[k] ?? 0;
      const hi = box.max[k] ?? 0;
      if (Math.abs(delta) < 1e-9) {
        if (from < lo || from > hi) return false;
      } else {
        const ta = (lo - from) / delta;
        const tb = (hi - from) / delta;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
        if (t0 > t1) return false;
      }
    }
    return true;
  });
}

describe('Briar Glen landmarks (mw-e24.2 notes)', () => {
  it('Vane House tower is the tallest thing in town and is in sight of every green node spawn', () => {
    const all = boxes(green);
    // The tower itself is the target, not an occluder.
    const solids = all.filter((b) => (b.max[1] ?? 0) < 40);
    const top = spawnIn(green, 'vane-tower-top');
    const tallest = Math.max(...all.map((s) => s.max[1] ?? 0));
    expect(tallest).toBe(top.y);
    expect(Math.max(...solids.map((b) => b.max[1] ?? 0))).toBeLessThanOrEqual(12);
    const nodes = green.spawns.filter((s) => s.tags.includes('node') && !s.id.startsWith('exit-'));
    // Vane House's own door front is under its hall, and standing at the Watch House's facade the
    // Watch House's own roof is in the way (the tower is 33 m beyond it); every other node sees it.
    for (const s of nodes.filter((n) => n.id !== 'vane-house' && n.id !== 'watch-house')) {
      const eye = [s.at[0], s.at[1] + 1.6, s.at[2]];
      const dx = top.x - eye[0]!;
      const dz = top.z - eye[2]!;
      const reachTop = [top.x - dx * 0.001, top.y - 0.5, top.z - dz * 0.001];
      expect(blocked(solids, eye, reachTop), `${s.id} sees the tower`).toBe(false);
    }
  });

  it('Vane House is visible from the lane too: a 40 m silhouette outside the lane walls', () => {
    const solids = boxes(lane).filter((b) => (b.max[1] ?? 0) < 12);
    const top = spawnIn(lane, 'vane-house-silhouette');
    expect(top.y).toBe(40);
    for (const id of [
      'arrive-from-valley-03',
      'arrive-from-marsh-store',
      'arrive-from-briarwood',
    ]) {
      const s = spawnIn(lane, id);
      expect(
        blocked(solids, [s.x, s.y + 1.6, s.z], [top.x - 0.5, top.y - 0.5, top.z - 0.5]),
        id,
      ).toBe(false);
    }
  });

  it('the Lamplit Stacks has three storeys that lean west onto the forge yard', () => {
    const solids = boxes(green).filter((b) => b.min[0]! < -45 && b.min[0]! > -62 && b.min[2]! > 60);
    const storeys = [
      solids.find((b) => b.min[1] === 0 && b.max[1] === 3.5 && b.max[0]! <= -45),
      solids.find((b) => b.min[1] === 3.5 && b.max[1] === 7),
      solids.find((b) => b.min[1] === 7 && b.max[1] === 10.5),
    ];
    expect(storeys.every((s) => s !== undefined)).toBe(true);
    const west = storeys.map((s) => s?.min[0] ?? 0);
    expect(west[1]).toBeLessThan(west[0]!);
    expect(west[2]).toBeLessThan(west[1]!);
    const yard = boxes(green).find((b) => b.min[0] === -64 && b.max[1] === 6);
    expect(yard).toBeDefined();
    expect(west[2]).toBeLessThan(yard?.max[0] ?? 0);
  });
});
