// mw-e26.2 on real content, headless: the Deepworks blockout's named places (AC-1), the six ways in,
// the walk through its levels on the baked navmesh, the cage lift's winch and shot pulley (AC-2), the
// scene as the game wires it, and the leg of the mine road (green-mine-road). The cutting hall's frame
// time (AC-3) is the perf suite's (README: Perf budgets); the walk in the browser is
// e2e/deepworks.spec.ts.
import { readFileSync } from 'node:fs';
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import {
  doorStatus,
  fireArrow,
  ImpactSwitchComponent,
  NavMesh,
  NavMeshQuery,
  placeEntity,
  regionsAt,
  useSwitch,
  type EntityId,
  type NavDoorLookup,
  type NavDoorState,
  type NavPathResult,
  type Vec3,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'deepworks');
const green = content.get('scene', 'briar-glen-green');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'deepworks')));

const at = (id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in deepworks`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
/** The humanoid without its climb mode: it can only walk, so any way it finds is stairs and floors. */
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };

/** The five doors of the scene; `open` names the ones that stand open, every other one is locked. */
const DOORS = [
  'front-gate-door',
  'inner-bar-door',
  'cage-bay-gate',
  'cage-gate',
] as const satisfies readonly string[];
const doorsWith =
  (...open: readonly string[]): NavDoorLookup =>
  (door): NavDoorState =>
    open.includes(door) ? 'open' : 'locked';
const route = (from: string, to: string, ...open: readonly string[]): NavPathResult =>
  query.findPath({ start: at(from), goal: at(to), agent: walker, doors: doorsWith(...open) });
const lengthOf = (result: NavPathResult): number => {
  if (result.status === 'off-mesh') return Number.NaN;
  let total = 0;
  for (let i = 1; i < result.points.length; i++) {
    const [a, b] = [result.points[i - 1], result.points[i]];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return total;
};

const DEEPWORKS_NODES = [
  'mine-road',
  'mine-gate',
  'winch-house',
  'old-galleries',
  'rootcellar-camp',
  'silver-galleries',
  'vane-sealed-gallery',
  'breach',
  'lower-deepworks',
] as const;
const ROUTES = [
  'front-gate',
  'side-boarding',
  'winch-cage',
  'inner-bar',
  'supply-tunnel',
  'weeping-adit',
] as const;

describe('the Deepworks named places (mw-e26.2 AC-1)', () => {
  it('AC-1: every Deepworks node of the world map is built as a named spawn of the scene', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'deepworks');
    expect(nodes.map((n) => n.id).sort()).toEqual([...DEEPWORKS_NODES].sort());
    for (const node of nodes) {
      expect(node.scene?.id).toBe('deepworks');
      expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
    }
  });

  it('AC-1: the Adit arrival, the Stone Stair head, the cage lift, the breach threshold and the camp are named', () => {
    const ids = new Set(scene.spawns.map((s) => s.id));
    for (const id of [
      'adit-arrival',
      'stone-stair-head',
      'supply-tunnel-arrival',
      'winch-lever',
      'winch-pulley',
      'cage-gate',
      'cage-car-top',
      'cage-landing',
      'ledger',
      'horn-ring',
      'breach-threshold',
      'frozen-channel-near-pad',
      'frozen-channel-far-pad',
      'kettleback',
      'cutting-hall-view',
      'bell-line-carving',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(scene.spawns.find((s) => s.id === 'adit-arrival')?.tags).toContain('entry:weeping-adit');
  });

  it('AC-1: the six entry routes of the route matrix and the quest are each a place with a marker', () => {
    const matrix = JSON.parse(readFileSync('docs/design/route-matrix.json', 'utf8')) as {
      mineEntries: { id: string }[];
    };
    expect(matrix.mineEntries.map((e) => e.id)).toEqual([...ROUTES]);
    const quest = readFileSync(
      'src/content/data/quest/quest-labyrinth-beneath-briar-glen.json',
      'utf8',
    );
    for (const entry of ROUTES) {
      expect(quest, entry).toContain(`deepworks-entered-${entry}`);
      const marked = scene.spawns.filter((s) => s.tags.includes(`entry:${entry}`));
      expect(marked.length, entry).toBeGreaterThan(0);
    }
    // The quest's area for the gate is the world map's node of the same id, now built.
    expect(quest).toContain('"area": "mine-gate"');
    expect(world?.nodes.find((n) => n.id === 'mine-gate')?.scene?.id).toBe('deepworks');
  });

  it('AC-1: the doors, the pulley and the barricades are the right kind of thing', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'deepworks' });
    const doors = game.scene.spawns.filter((s) => s.spawn.door !== undefined);
    expect(doors.map((d) => d.spawn.id).sort()).toEqual([...DOORS].sort());
    expect(scene.spawns.find((s) => s.id === 'front-gate-door')?.door?.lock?.id).toBe(
      'mine-gate-padlock',
    );
    expect(content.get('lock', 'mine-gate-padlock')).toMatchObject({ tier: 2, pickTier: 2 });
    const barricades = scene.placements.filter((p) => p.breakable?.profile.id === 'wood-barricade');
    expect(barricades.map((b) => b.at)).toEqual([
      [136, 0, 80],
      [40, 0, 155],
    ]);
    expect(scene.spawns.find((s) => s.id === 'inner-bar-lever')?.properties).toMatchObject({
      remoteActuatable: true,
    });
  });

  it('AC-1: the scene is the deepworks region, with the camp and the flooded gallery inside it', () => {
    const { regions } = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'deepworks' })
      .scene.layout;
    expect(regionsAt(regions, at('cutting-hall-view'))).toEqual(['deepworks', 'rootcellar-camp']);
    expect(regionsAt(regions, at('lower-deepworks'))).toEqual(['deepworks', 'lower-deepworks']);
    expect(regionsAt(regions, at('winch-house'))).toEqual(['deepworks']);
    expect(regionsAt(regions, { x: 100, y: 0, z: 400 })).toEqual([]);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'deepworks');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });
});

describe('the Deepworks on foot (mw-e26.2)', () => {
  it('the mine road leads from the town arrival to the forecourt and the gate wall', () => {
    for (const id of ['player-start', 'mine-road', 'mine-gate', 'front-gate', 'side-boarding']) {
      expect(route('arrive-from-briar-glen-green', id).status, id).toBe('found');
    }
  });

  it('the gate wall is sealed from outside: with every door locked nobody reaches the winch house', () => {
    for (const id of ['winch-house', 'old-galleries', 'rootcellar-camp', 'breach']) {
      expect(route('mine-gate', id).status, id).toBe('unreachable');
    }
  });

  it('each way in that is a door lets a walker in on its own: the padlock gate, the inner bar and the cage bay', () => {
    for (const open of ['front-gate-door', 'inner-bar-door', 'cage-bay-gate']) {
      expect(route('mine-gate', 'winch-house', open).status, open).toBe('found');
    }
  });

  it('the side boarding and the supply tunnel collapse are walls until they are broken', () => {
    expect(route('mine-gate', 'side-boarding').status).toBe('found');
    const all = doorsWith(...DOORS);
    const through = (from: string, to: string) =>
      query.findPath({ start: at(from), goal: at(to), agent: walker, doors: all }).status;
    expect(through('mine-gate', 'supply-tunnel-arrival')).toBe('unreachable');
    expect(through('old-galleries', 'supply-tunnel-arrival')).toBe('unreachable');
    const boarding = scene.placements.find((p) => p.breakable !== undefined && p.at[0] === 136);
    expect(boarding?.breakable?.profile.id).toBe('wood-barricade');
    const collapse = scene.placements.find((p) => p.breakable !== undefined && p.at[0] === 40);
    expect(collapse?.breakable?.profile.id).toBe('wood-barricade');
  });

  it('the galleries, the cutting hall, the silver galleries, Vane’s gallery, the breach and the lower gallery join up', () => {
    for (const id of [
      'old-galleries',
      'minecart-a',
      'rootcellar-camp',
      'camp-fire',
      'stone-stair-head',
      'quay-gate-stub',
      'silver-landing',
      'silver-galleries',
      'cage-landing',
      'silver-mimic-a',
      'silver-mimic-b',
      'vane-sealed-gallery',
      'ledger',
      'breach',
      'breach-threshold',
      'lower-deepworks',
      'frozen-channel-near-pad',
    ]) {
      expect(route('winch-house', id, 'front-gate-door').status, id).toBe('found');
    }
  });

  it('the flooded channel splits the lower gallery: the Adit arrival is out of reach of a walker', () => {
    expect(route('lower-deepworks', 'frozen-channel-far-pad', ...DOORS).status).toBe('unreachable');
    expect(route('lower-deepworks', 'adit-arrival', ...DOORS).status).toBe('unreachable');
    expect(route('adit-arrival', 'channel-cache', ...DOORS).status).toBe('found');
    expect(route('adit-arrival', 'frozen-channel-far-pad', ...DOORS).status).toBe('found');
  });

  it('each level is the depth the map says: gallery 0 m, silver galleries 6 m down, Vane’s gallery and the breach 12 m', () => {
    expect(at('old-galleries').y).toBe(0);
    expect(at('silver-galleries').y).toBe(-6);
    expect(at('vane-sealed-gallery').y).toBe(-12);
    expect(at('breach').y).toBe(-12);
    const path = route('winch-house', 'breach', 'front-gate-door');
    if (path.status === 'off-mesh') throw new Error('off-mesh');
    const ys = path.points.map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-11.5);
    expect(path.points.some((p) => p.link !== undefined)).toBe(false);
  });
});

describe('the cage lift (mw-e26.2 AC-2)', () => {
  const lift = () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'deepworks' });
    const sim = game.world;
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
    steps(5);
    const probe = sim.spawn();
    return { game, sim, id, steps, probe };
  };

  it('AC-2: the winch lever calls the cage down: the cage gate and the cage bay gate open, the inner bar does not', ({
    task,
  }) => {
    markExercised(task, 'scene', 'deepworks');
    markExercised(task, 'signal-graph', 'deepworks');
    const r = lift();
    expect(doorStatus(r.sim, r.id('cage-gate'))).toBe('closed');
    expect(doorStatus(r.sim, r.id('cage-bay-gate'))).toBe('closed');
    useSwitch(r.sim, r.id('winch-lever'));
    r.steps(300);
    expect(doorStatus(r.sim, r.id('cage-gate'))).toBe('open');
    expect(doorStatus(r.sim, r.id('cage-bay-gate'))).toBe('open');
    expect(doorStatus(r.sim, r.id('inner-bar-door'))).toBe('closed');
    // The latch keeps it down.
    r.steps(300);
    expect(doorStatus(r.sim, r.id('cage-gate'))).toBe('open');
  });

  it('AC-2: an arrow at full draw into the winch pulley drops the cage as well', ({ task }) => {
    markExercised(task, 'arrow', 'standard');
    const r = lift();
    const pulley = r.id('winch-pulley');
    expect(r.sim.has(pulley, ImpactSwitchComponent)).toBe(true);
    const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
    fireArrow(r.sim, r.game.combat.bow.arrows, {
      arrow: 'standard',
      origin: v(61.5, 3.75, 72),
      velocity: v(0, 0, 60),
    });
    r.steps(480);
    expect(doorStatus(r.sim, r.id('cage-gate'))).toBe('open');
    expect(doorStatus(r.sim, r.id('cage-bay-gate'))).toBe('open');
  });

  it('AC-2: with the cage gate open a walker goes from the winch house to the cage landing in under 100 m instead of the long way round', () => {
    const up = lengthOf(route('winch-house', 'cage-landing', 'front-gate-door'));
    const down = lengthOf(route('winch-house', 'cage-landing', 'front-gate-door', 'cage-gate'));
    expect(down).toBeLessThan(100);
    expect(up).toBeGreaterThan(300);
    // The ride down is six metres.
    const path = route('winch-house', 'cage-landing', 'front-gate-door', 'cage-gate');
    if (path.status === 'off-mesh') throw new Error('off-mesh');
    expect(Math.min(...path.points.map((p) => p.y))).toBeCloseTo(-6, 1);
  });

  it('the inner bar lever raises the inner bar portcullis only', () => {
    const r = lift();
    expect(doorStatus(r.sim, r.id('inner-bar-door'))).toBe('closed');
    useSwitch(r.sim, r.id('inner-bar-lever'));
    r.steps(300);
    expect(doorStatus(r.sim, r.id('inner-bar-door'))).toBe('open');
    expect(doorStatus(r.sim, r.id('cage-gate'))).toBe('closed');
  });
});

describe('the mine road leg of the town (mw-e26.2)', () => {
  it('green-mine-road lists the transition at each end, and each leads to the other scene’s arrival', () => {
    const edge = world?.edges.find((e) => e.id === 'green-mine-road');
    expect(edge?.transitions).toEqual(['briar-glen-green/mine-road-gate', 'deepworks/road-gate']);
    expect(green.transitions.find((t) => t.id === 'mine-road-gate')).toMatchObject({
      scene: { id: 'deepworks' },
      spawn: 'arrive-from-briar-glen-green',
    });
    expect(scene.transitions.find((t) => t.id === 'road-gate')).toMatchObject({
      scene: { id: 'briar-glen-green' },
      spawn: 'arrive-from-deepworks',
    });
    expect(green.spawns.find((s) => s.id === 'arrive-from-deepworks')).toBeDefined();
    expect(scene.spawns.find((s) => s.id === 'arrive-from-briar-glen-green')).toBeDefined();
  });

  it('the Miners’ Bridge edge and the in-scene mine road edge stay planned (mw-e25.23)', () => {
    expect(world?.edges.find((e) => e.id === 'miners-bridge')?.transitions ?? []).toEqual([]);
    expect(world?.edges.find((e) => e.id === 'mine-road-gate')?.bead).toBe('mw-e25.23');
  });

  it('the green’s mine road doorway is reachable on its navmesh from the town gate', () => {
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'briar-glen-green' });
    const probe = game.world.spawn();
    const spot = (id: string) => {
      const spawn = green.spawns.find((s) => s.id === id);
      if (spawn === undefined) throw new Error(`no spawn ${id}`);
      return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
    };
    placeEntity(game.world, probe, spot('arrive-from-briar-glen-lane'), 0.35);
    for (const id of ['exit-mine-road', 'arrive-from-deepworks']) {
      const m = game.navigation.distance(game.world, probe, spot(id));
      expect(Number.isFinite(m), `${id} is reachable from the town gate`).toBe(true);
    }
  });
});
