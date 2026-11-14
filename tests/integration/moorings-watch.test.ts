// mw-e25.6 on real content, headless: Mooring's Watch's named entities (AC-1), the roof reached on the
// navmesh by the interior stair and by the exterior climbs (AC-2), the scene as the game wires it, and
// the Briarwood leg of the forest loop (mw-e25.25: hub-moorings, both transitions, both ways). The
// frame-time budget (AC-3) is the perf suite's (README: Perf budgets); the walk and climb in the browser
// is e2e/moorings-watch.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import {
  NavMesh,
  NavMeshQuery,
  placeEntity,
  regionsAt,
  type NavPathPoint,
  type NavPathResult,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'moorings-watch');
const briarwood = content.get('scene', 'briarwood');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'moorings-watch')));

const spot = (from: typeof scene, id: string) => {
  const spawn = from.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${from.id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};
const at = (id: string) => spot(scene, id);

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
/** The humanoid without its climb mode: it can only walk, so any way it finds is stairs and floors. */
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };
/** A rough-stone climber (the thief and archer reach grade 2). */
const roughClimber: NavAgent = { ...humanoid, maxClimbGrade: 2 };

const route = (agent: NavAgent, from: string, to: string): NavPathResult =>
  query.findPath({ start: at(from), goal: at(to), agent });
const pointsOf = (result: NavPathResult): readonly NavPathPoint[] =>
  result.status === 'off-mesh' ? [] : result.points;
const metres = (points: readonly NavPathPoint[]): number =>
  points.reduce(
    (sum, p, i) =>
      i === 0
        ? 0
        : sum +
          Math.hypot(
            p.x - (points[i - 1]?.x ?? 0),
            p.y - (points[i - 1]?.y ?? 0),
            p.z - (points[i - 1]?.z ?? 0),
          ),
    0,
  );
const climbs = (points: readonly NavPathPoint[]) => points.filter((p) => p.link === 'climb');

describe("Mooring's Watch named entities (mw-e25.6 AC-1)", () => {
  it('AC-1: the tower volume, roof, bell cord and tunnel entry exist as named entities', () => {
    const tower = scene.regions.find((r) => r.id === 'tower');
    expect(tower?.tags).toEqual(['region', 'tower', 'sentinel-leash']);
    const ids = new Set(scene.spawns.map((s) => s.id));
    for (const id of [
      'tower-roof',
      'roof-view',
      'bell-cord',
      'supply-tunnel',
      'supply-tunnel-door',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    const door = scene.spawns.find((s) => s.id === 'supply-tunnel-door');
    expect(door?.door?.profile.id).toBe('iron-door');
    expect(door?.door?.lock?.id).toBe('tunnel-collapsed');
    expect(content.get('lock', 'tunnel-collapsed').hint).toMatch(/stuck/i);
  });

  it('AC-1: the bible places the lookout camp, four armour stands, keeper’s log and signal mirror', () => {
    const tagged = (tag: string) => scene.spawns.filter((s) => s.tags.includes(tag));
    expect(tagged('armour-stand')).toHaveLength(4);
    expect(tagged('keepers-log')).toHaveLength(1);
    expect(tagged('signal-mirror')).toHaveLength(1);
    expect(tagged('goblin-camp')).toHaveLength(1);
    expect(scene.spawns.find((s) => s.id === 'keepers-log')?.interact).toBeDefined();
    expect(scene.spawns.find((s) => s.id === 'signal-mirror')?.interact).toBeDefined();
  });

  it('AC-1: the tower has four floors 3 m apart, all inside the tower volume', () => {
    const tower = scene.regions.find((r) => r.id === 'tower');
    const floors = [
      ['armour-stand-a', 0.5],
      ['keepers-log', 3.5],
      ['bell-cord', 6],
      ['tower-roof', 9],
    ] as const;
    for (const [id, y] of floors) {
      const p = at(id);
      expect(p.y, id).toBe(y);
      expect(p.x).toBeGreaterThan(tower?.min[0] ?? Infinity);
      expect(p.x).toBeLessThan(tower?.max[0] ?? -Infinity);
      expect(p.z).toBeGreaterThan(tower?.min[2] ?? Infinity);
      expect(p.z).toBeLessThan(tower?.max[2] ?? -Infinity);
    }
    const slabs = scene.placements
      .filter((p) => p.piece.id === 'floor' && p.at[1] > 0)
      .map((p) => p.at[1]);
    expect([...new Set(slabs)].sort()).toEqual([3, 6, 9]);
  });

  it('AC-1: the scene is the moorings-watch region, the tower is its own, and the respawn rule names the scene', () => {
    const { regions } = createGameWorld<never>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'moorings-watch',
    }).scene.layout;
    expect(regionsAt(regions, at('tower-roof'))).toEqual(['moorings-watch', 'tower']);
    expect(regionsAt(regions, at('moorings-courtyard'))).toEqual(['moorings-watch']);
    expect(regionsAt(regions, { x: 90, y: 0, z: 104 })).toEqual([]);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'moorings-watch');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });

  it('AC-1: the world map’s three Mooring’s Watch nodes are built as named spawns', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'moorings-watch');
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'moorings-courtyard',
      'moorings-tower',
      'supply-tunnel',
    ]);
    for (const node of nodes) {
      expect(node.scene?.id).toBe('moorings-watch');
      expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
    }
  });

  it('the supply tunnel door is a real door in the game world, locked with no key', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'moorings-watch' });
    const doors = game.scene.spawns.filter((s) => s.spawn.door !== undefined);
    expect(doors.map((d) => d.spawn.id)).toEqual(['supply-tunnel-door']);
  });
});

describe('the roof by the stair and by the climbs (mw-e25.6 AC-2)', () => {
  it('AC-2: a walker with no climb mode reaches the roof from the spur gate by the interior stair', () => {
    const result = route(walker, 'arrive-from-briarwood', 'roof-view');
    expect(result.status).toBe('found');
    const points = pointsOf(result);
    expect(points.some((p) => p.link !== undefined)).toBe(false);
    // Through the tower's south door, then up three flights past the keeper's quarters and the bell shaft.
    const inside = points.filter((p) => p.x > 88 && p.x < 102 && p.z > 46 && p.z < 58);
    for (const floor of [0, 3, 6, 9]) {
      expect(
        inside.some((p) => Math.abs(p.y - floor) < 0.5),
        `the path crosses the floor at ${String(floor)} m`,
      ).toBe(true);
    }
    for (const id of ['keepers-log', 'bell-cord', 'moorings-tower']) {
      expect(route(walker, 'arrive-from-briarwood', id).status, id).toBe('found');
    }
  });

  it('AC-2: from the foot of the ivy a climber reaches the roof by one climb, outside, far shorter than the stair', () => {
    const result = route(humanoid, 'ivy-climb-foot', 'roof-view');
    expect(result.status).toBe('found');
    const points = pointsOf(result);
    const up = climbs(points);
    expect(up).toHaveLength(1);
    expect(up[0]?.x).toBeCloseTo(91, 0);
    expect(up[0]?.z).toBeLessThan(46);
    expect(points[0]?.y).toBe(0);
    expect(points.at(-1)?.y).toBeCloseTo(9, 0);
    // Without the climb the same walk goes round through the door and up the stair.
    const stair = pointsOf(route(walker, 'ivy-climb-foot', 'roof-view'));
    expect(metres(points)).toBeLessThan(metres(stair) / 2);
    expect(climbs(stair)).toHaveLength(0);
  });

  it('AC-2: the broken masonry on the east face is a second climb, for grade 2 climbers only', () => {
    const result = route(roughClimber, 'masonry-climb-foot', 'roof-view');
    expect(result.status).toBe('found');
    const up = climbs(pointsOf(result));
    expect(up).toHaveLength(1);
    expect(up[0]?.x).toBeGreaterThan(102);
    // A knight (grade 1) cannot take it and is sent round to the ivy.
    const knight = pointsOf(route(humanoid, 'masonry-climb-foot', 'roof-view'));
    expect(climbs(knight)[0]?.x).toBeCloseTo(91, 0);
    const grades = scene.placements
      .filter((p) => p.properties?.climbable !== undefined)
      .map((p) => [p.properties?.climbable, p.scale[1]]);
    expect(grades).toContainEqual(['ivy', 9]);
    expect(grades).toContainEqual(['rough', 9]);
  });

  it('AC-2: the goblin lookout post is a ladder climb, and the whole courtyard is walkable from the gate', () => {
    expect(route(walker, 'arrive-from-briarwood', 'lookout-post').status).toBe('unreachable');
    const ladder = route(humanoid, 'arrive-from-briarwood', 'lookout-post');
    expect(ladder.status).toBe('found');
    expect(climbs(pointsOf(ladder))).toHaveLength(1);
    for (const id of ['goblin-lookout', 'courtyard-gate', 'moorings-courtyard', 'supply-tunnel']) {
      expect(route(walker, 'arrive-from-briarwood', id).status, id).toBe('found');
    }
  });
});

describe('the Briarwood leg of the forest loop (mw-e25.25)', () => {
  it('AC-2: hub-moorings lists the transition at each end, and each leads to the other scene’s arrival', () => {
    const edge = world?.edges.find((e) => e.id === 'hub-moorings');
    expect(edge?.transitions).toEqual(['briarwood/moorings-gate', 'moorings-watch/spur-gate']);
    expect(briarwood.transitions.find((t) => t.id === 'moorings-gate')).toMatchObject({
      scene: { id: 'moorings-watch' },
      spawn: 'arrive-from-briarwood',
    });
    expect(scene.transitions.find((t) => t.id === 'spur-gate')).toMatchObject({
      scene: { id: 'briarwood' },
      spawn: 'arrive-from-moorings-watch',
    });
    expect(briarwood.spawns.find((s) => s.id === 'arrive-from-moorings-watch')).toBeDefined();
    expect(scene.spawns.find((s) => s.id === 'arrive-from-briarwood')).toBeDefined();
  });

  it('AC-1: the Briarwood’s moorings gate is reachable on its navmesh from the town gate and from the spur', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
    const probe = game.world.spawn();
    placeEntity(game.world, probe, spot(briarwood, 'arrive-from-briar-glen-lane'), 0.35);
    for (const id of ['moorings-spur', 'arrive-from-moorings-watch', 'moorings-gate']) {
      const m = game.navigation.distance(game.world, probe, spot(briarwood, id));
      expect(Number.isFinite(m), `${id} is reachable from the town gate`).toBe(true);
    }
  });
});
