// mw-e26.5 on real content, headless: Bellwater Priory's named nodes (AC-1), the sealed crypt and the
// routes through the priory on its navmesh (AC-2), the belfry reached by the stair and by the free-climb,
// the scene as the game wires it, and the priory legs of the forest loop (mw-e25.25: priory-road-gate,
// both transitions, both ways). The frame-time budget from the belfry (AC-3) is the perf suite's
// (README: Perf budgets); the walk in the browser is e2e/bellwater-priory.spec.ts.
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
  type NavDoorLookup,
  type NavPathPoint,
  type NavPathResult,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'bellwater-priory');
const briarwood = content.get('scene', 'briarwood');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'bellwater-priory')));

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

/** A sealed door stands locked (no key exists); `open` is the world after the seals are broken. */
const sealed: NavDoorLookup = () => 'locked';
const unsealed: NavDoorLookup = () => 'open';
const route = (
  agent: NavAgent,
  from: string,
  to: string,
  doors: NavDoorLookup = sealed,
): NavPathResult => query.findPath({ start: at(from), goal: at(to), agent, doors });
const pointsOf = (result: NavPathResult): readonly NavPathPoint[] =>
  result.status === 'off-mesh' ? [] : result.points;
const climbs = (points: readonly NavPathPoint[]) => points.filter((p) => p.link === 'climb');

const PRIORY_NODES = [
  'priory-gate',
  'priory-nave',
  'priory-choir',
  'priory-garden',
  'scriptorium',
  'belfry',
  'priory-crypt-stair',
  'priory-crypt',
  'cistern',
] as const;

describe('Bellwater Priory named nodes (mw-e26.5 AC-1)', () => {
  it('AC-1: every priory node of the world map is built as a named spawn of the scene', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'priory');
    expect(nodes.map((n) => n.id).sort()).toEqual([...PRIORY_NODES].sort());
    for (const node of nodes) {
      expect(node.scene?.id).toBe('bellwater-priory');
      expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
    }
  });

  it('AC-1: the cistern link stub, the hidden choir door, the Sounding Shaft top and the pear tree are named', () => {
    const ids = new Set(scene.spawns.map((s) => s.id));
    for (const id of [
      'cistern',
      'cistern-door',
      'choir-hidden-door',
      'choir-altar',
      'monk-statue-a',
      'monk-statue-b',
      'monk-statue-c',
      'monk-statue-d',
      'dead-pear-tree',
      'sounding-shaft-top',
      'vesper-bell',
      'belfry-stair-door',
      'sunbeam-spot',
      'crypt-door',
      'book-mimic-a',
      'tallow-ooze-spawn',
      'abbot-letters',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(scene.spawns.find((s) => s.id === 'cistern')?.tags).toContain('cistern-link');
  });

  it('AC-1: the scene is the bellwater-priory region, the belfry its own, and the respawn rule names the scene', () => {
    const { regions } = createGameWorld<never>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'bellwater-priory',
    }).scene.layout;
    expect(regionsAt(regions, at('belfry-view'))).toEqual(['bellwater-priory', 'belfry']);
    expect(regionsAt(regions, at('priory-nave'))).toEqual(['bellwater-priory']);
    expect(regionsAt(regions, { x: 60, y: 0, z: 140 })).toEqual([]);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'bellwater-priory');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });

  it('the sealed doors are real doors in the game world, each locked with no key', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'bellwater-priory' });
    const doors = game.scene.spawns.filter((s) => s.spawn.door !== undefined);
    expect(doors.map((d) => d.spawn.id).sort()).toEqual([
      'choir-hidden-door',
      'cistern-door',
      'crypt-door',
    ]);
  });
});

describe('the priory on foot (mw-e26.5 AC-2)', () => {
  it('a walker with no climb mode reaches the nave, choir, garden, crypt stair and belfry from the road gate', () => {
    for (const id of [
      'player-start',
      'priory-gate',
      'priory-nave',
      'priory-choir',
      'monk-statue-a',
      'choir-altar',
      'priory-garden',
      'dead-pear-tree',
      'priory-crypt-stair',
      'sunbeam-spot',
      'belfry',
      'belfry-stair-door',
    ]) {
      expect(route(walker, 'arrive-from-briarwood', id).status, id).toBe('found');
    }
  });

  it('AC-2: the crypt is sealed from the priory side: no route from the crypt stair, and its door is a tier-3 lock', () => {
    expect(route(walker, 'priory-crypt-stair', 'priory-crypt').status).toBe('unreachable');
    expect(route(humanoid, 'arrive-from-briarwood', 'priory-crypt').status).toBe('unreachable');
    // With the seal broken the same walk goes through the door.
    expect(route(walker, 'priory-crypt-stair', 'priory-crypt', unsealed).status).toBe('found');
    expect(content.get('lock', 'crypt-sealed')).toMatchObject({ tier: 3, pickTier: 3 });
    const door = scene.spawns.find((s) => s.id === 'crypt-door');
    expect(door?.door?.lock?.id).toBe('crypt-sealed');
    // The world map opens it from the other side only, on the fact the Ossuary edge also uses.
    const edge = world?.edges.find((e) => e.id === 'crypt-stair-crypt');
    expect(JSON.stringify(edge?.unlock)).toContain('world.priory-crypt.unsealed');
    const ossuary = world?.edges.find((e) => e.id === 'ossuary-crypt');
    expect(JSON.stringify(ossuary?.unlock)).toContain('world.priory-crypt.unsealed');
  });

  it('AC-2: the scriptorium waits behind the hidden choir door and the cistern behind its barred door', () => {
    expect(route(humanoid, 'arrive-from-briarwood', 'scriptorium').status).toBe('unreachable');
    expect(route(humanoid, 'arrive-from-briarwood', 'cistern').status).toBe('unreachable');
    expect(route(walker, 'arrive-from-briarwood', 'scriptorium', unsealed).status).toBe('found');
    expect(route(walker, 'arrive-from-briarwood', 'cistern', unsealed).status).toBe('found');
    expect(scene.spawns.find((s) => s.id === 'choir-hidden-door')?.door?.lock?.id).toBe(
      'choir-door-hidden',
    );
    expect(scene.spawns.find((s) => s.id === 'cistern-door')?.door?.lock?.id).toBe(
      'cistern-sealed',
    );
    const unlock = world?.edges.find((e) => e.id === 'choir-scriptorium')?.unlock;
    expect(JSON.stringify(unlock)).toContain('watchers.solved');
  });

  it('the belfry deck is reached by the interior stair, three flights up from the nave doorway', () => {
    const result = route(walker, 'arrive-from-briarwood', 'belfry-view');
    expect(result.status).toBe('found');
    const points = pointsOf(result);
    expect(points.some((p) => p.link !== undefined)).toBe(false);
    const inside = points.filter((p) => p.x > 80 && p.x < 92 && p.z > 68 && p.z < 82);
    for (const floor of [0, 3, 6, 9]) {
      expect(
        inside.some((p) => Math.abs(p.y - floor) < 0.5),
        `the path crosses the floor at ${String(floor)} m`,
      ).toBe(true);
    }
    expect(route(walker, 'arrive-from-briarwood', 'belfry-deck').status).toBe('found');
  });

  it('the south face of the belfry is a free-climb for grade 2 climbers only', () => {
    const result = route(roughClimber, 'belfry-climb-foot', 'belfry-view');
    expect(result.status).toBe('found');
    const up = climbs(pointsOf(result));
    expect(up).toHaveLength(1);
    expect(up[0]?.z).toBeLessThan(68);
    const knight = pointsOf(route(humanoid, 'belfry-climb-foot', 'belfry-view'));
    expect(climbs(knight)).toHaveLength(0);
    const rough = scene.placements.find((p) => p.properties?.climbable === 'rough');
    expect(rough?.scale[1]).toBe(9);
  });

  it('two rope anchors stand on the belfry deck, tagged for the rope system', () => {
    const anchors = scene.spawns.filter((s) => s.tags.includes('rope-anchor'));
    expect(anchors.map((a) => a.id)).toEqual(['belfry-anchor-a', 'belfry-anchor-b']);
    for (const a of anchors) {
      expect(a.at[1]).toBeGreaterThan(9);
      expect(a.interact?.affordances.map((x) => x.verb)).toEqual(['climb', 'release']);
    }
  });
});

describe('the priory legs of the forest loop (mw-e25.25)', () => {
  it('priory-road-gate lists the transition at each end, and each leads to the other scene’s arrival', () => {
    const edge = world?.edges.find((e) => e.id === 'priory-road-gate');
    expect(edge?.transitions).toEqual(['briarwood/priory-road-gate', 'bellwater-priory/road-gate']);
    expect(briarwood.transitions.find((t) => t.id === 'priory-road-gate')).toMatchObject({
      scene: { id: 'bellwater-priory' },
      spawn: 'arrive-from-briarwood',
    });
    expect(scene.transitions.find((t) => t.id === 'road-gate')).toMatchObject({
      scene: { id: 'briarwood' },
      spawn: 'arrive-from-bellwater-priory',
    });
    expect(briarwood.spawns.find((s) => s.id === 'arrive-from-bellwater-priory')).toBeDefined();
    expect(scene.spawns.find((s) => s.id === 'arrive-from-briarwood')).toBeDefined();
  });

  it('the ridge path from Mooring’s Watch stays planned: no transition yet (owner question)', () => {
    const edge = world?.edges.find((e) => e.id === 'moorings-priory-ridge');
    expect(edge?.transitions ?? []).toEqual([]);
  });

  it('the Briarwood’s priory gate is reachable on its navmesh from the town gate and from the hub', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briarwood' });
    const probe = game.world.spawn();
    placeEntity(game.world, probe, spot(briarwood, 'arrive-from-briar-glen-lane'), 0.35);
    for (const id of ['priory-road', 'arrive-from-bellwater-priory', 'priory-road-gate']) {
      const m = game.navigation.distance(game.world, probe, spot(briarwood, id));
      expect(Number.isFinite(m), `${id} is reachable from the town gate`).toBe(true);
    }
  });
});
