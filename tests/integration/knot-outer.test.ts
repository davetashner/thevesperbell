// mw-e26.9 on real content, headless: the Knot's outer half (Outer Ring, Ossuary Galleries, Chapel of
// Echoes). Named places and the two routes between each adjacent pair (AC-1), the Chapel portcullis
// dropped by its counterweight rope (AC-2), the walk through the baked navmesh, the quest volumes, the
// breach link to the Deepworks and the four friend-below notes. The Ossuary's frame time (AC-3) is the
// perf suite's (README: Perf budgets); the walk in the browser is e2e/knot-outer.spec.ts.
import { readFileSync } from 'node:fs';
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type GameContent,
  type NavAgent,
} from '@content/index';
import {
  applyStimulus,
  doorStatus,
  fireArrow,
  NavMesh,
  NavMeshQuery,
  regionsAt,
  setProperty,
  type EntityId,
  type NavDoorLookup,
  type NavDoorState,
  type NavPathResult,
  type Vec3,
} from '@sim/index';
import { bakeScene } from '@tools/navmesh/bake';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'knot-outer');
const deepworks = content.get('scene', 'deepworks');
type Scene = typeof scene;

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
/** The humanoid without its climb mode: it can only walk, so any way it finds is stairs and floors. */
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };

const spot = (s: Scene, id: string): Vec3 => {
  const spawn = s.spawns.find((p) => p.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${s.id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};
const doors =
  (...open: readonly string[]): NavDoorLookup =>
  (door): NavDoorState =>
    open.includes(door) ? 'open' : 'locked';
const pathOn = (
  query: NavMeshQuery,
  s: Scene,
  from: string,
  to: string,
  ...open: readonly string[]
): NavPathResult =>
  query.findPath({ start: spot(s, from), goal: spot(s, to), agent: walker, doors: doors(...open) });
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'knot-outer')));
const route = (from: string, to: string, ...open: readonly string[]) =>
  pathOn(query, scene, from, to, ...open);

/** A bake of the scene with every route marker of `ids` walled shut (a wall across each, both ways). */
function bakedWithout(ids: readonly string[]): NavMeshQuery {
  const wall = scene.placements.find((p) => p.piece.id === 'wall');
  if (wall === undefined) throw new Error('the scene has no wall to copy');
  const blocked: Scene = {
    ...scene,
    placements: [
      ...scene.placements,
      ...ids.flatMap((id) => {
        const { x, y, z } = spot(scene, id);
        const at = [x, y, z] as const;
        const shut = { ...wall, at, scale: [1.5, 1.5, 1] as const };
        return [shut, { ...shut, yaw: 90 as const }];
      }),
    ],
  };
  const patched = {
    get: (kind: string, id: string) =>
      kind === 'scene' && id === 'knot-outer' ? blocked : content.get(kind as 'kit', id),
    all: (kind: string) => content.all(kind as 'kit'),
    has: (kind: string, id: string) => content.has(kind as 'kit', id),
  } as unknown as GameContent;
  return new NavMeshQuery(new NavMesh(bakeScene(patched, 'knot-outer')));
}

const NODES = ['knot-outer-ring', 'ossuary-galleries', 'chapel-of-echoes'] as const;
/** Each adjacent pair of areas, a spawn on each side, and the markers of its separate ways. */
const PAIRS = [
  {
    edge: 'outer-ring-ossuary',
    from: 'knot-outer-ring',
    to: 'ossuary-galleries',
    ways: ['scales-gate', 'ring-vent'],
  },
  {
    edge: 'ossuary-chapel',
    from: 'ossuary-galleries',
    to: 'chapel-of-echoes',
    ways: ['chapel-door', 'bone-chute'],
  },
] as const;

describe('the Knot outer half: named places and routes (mw-e26.9 AC-1)', () => {
  it('AC-1: Outer Ring, Ossuary and Chapel are the knot-outer scene’s nodes of the world map, each a named spawn', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'knot' && n.scene !== undefined);
    expect(nodes.map((n) => n.id).sort()).toEqual([...NODES].sort());
    for (const node of nodes) {
      expect(node.scene?.id).toBe('knot-outer');
      expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
    }
  });

  it('AC-1: the named places of the three areas are all there', () => {
    const ids = new Set(scene.spawns.map((s) => s.id));
    for (const id of [
      'arrive-from-deepworks',
      'breach-door',
      'scales-room',
      'scales-gate',
      'ring-vent',
      'spider-nest-a',
      'rune-band-south',
      'dark-crossing',
      'clatter-garden',
      'mushroom-bed-a',
      'bone-niche-1',
      'chapel-door',
      'bone-chute',
      'chime-1',
      'chime-4',
      'chapel-portcullis',
      'counterweight-rope',
      'chapel-vent-north',
      'horns-hall-stub',
      'ossuary-view',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('AC-1: the markers of each way between an adjacent pair stand in the scene, two of them for each', () => {
    for (const pair of PAIRS) {
      const tagged = scene.spawns.filter((s) => s.tags.includes(`route:${pair.edge}`));
      expect(tagged.map((s) => s.id).sort(), pair.edge).toEqual([...pair.ways].sort());
    }
    const edges = new Map((world?.edges ?? []).map((e) => [e.id, e]));
    for (const pair of PAIRS) {
      expect(edges.get(pair.edge)).toMatchObject({ from: pair.from, to: pair.to });
    }
  });

  it(
    'AC-1: with any one way shut, a walker still goes from each area to the next',
    { timeout: 240_000 },
    () => {
      for (const pair of PAIRS) {
        expect(route(pair.from, pair.to).status, `${pair.edge} open`).toBe('found');
        for (const shut of pair.ways) {
          const q = bakedWithout([shut]);
          expect(pathOn(q, scene, pair.from, pair.to).status, `${pair.edge} without ${shut}`).toBe(
            'found',
          );
        }
        // And both shut: the areas are truly separate, so each way is really a way.
        const none = bakedWithout([...pair.ways]);
        expect(pathOn(none, scene, pair.from, pair.to).status, `${pair.edge} both shut`).not.toBe(
          'found',
        );
      }
    },
  );

  it(
    'AC-1: the Chapel’s way on has two routes too: the portcullis doorway and the north vent',
    { timeout: 120_000 },
    () => {
      expect(route('chapel-of-echoes', 'horns-hall-stub', 'chapel-portcullis').status).toBe(
        'found',
      );
      // The portcullis down (closed), the vent still goes round.
      expect(route('chapel-of-echoes', 'horns-hall-stub').status).toBe('found');
      const ventShut = bakedWithout(['chapel-vent-north']);
      expect(
        pathOn(ventShut, scene, 'chapel-of-echoes', 'horns-hall-stub', 'chapel-portcullis').status,
      ).toBe('found');
      expect(pathOn(ventShut, scene, 'chapel-of-echoes', 'horns-hall-stub').status).not.toBe(
        'found',
      );
    },
  );

  it('AC-1: the Ossuary has a loop: the hall reaches the far hall through the Dark Crossing, the garden or the east gallery', () => {
    for (const id of [
      'dark-crossing',
      'clatter-garden',
      'mushroom-bed-c',
      'east-gallery',
      'chapel-door',
    ]) {
      expect(route('ossuary-galleries', id).status, id).toBe('found');
    }
    const down = route('ossuary-galleries', 'dark-crossing');
    if (down.status === 'off-mesh') throw new Error('off-mesh');
    expect(Math.min(...down.points.map((p) => p.y))).toBeCloseTo(-3, 1);
  });

  it('AC-1: the scene is the knot-outer region with the ring, the Ossuary and the Chapel inside it', () => {
    const { regions } = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'knot-outer' })
      .scene.layout;
    expect(regionsAt(regions, spot(scene, 'knot-outer-ring'))).toEqual([
      'knot-outer',
      'knot-outer-ring',
    ]);
    expect(regionsAt(regions, spot(scene, 'ossuary-galleries'))).toEqual([
      'knot-outer',
      'ossuary-galleries',
    ]);
    expect(regionsAt(regions, spot(scene, 'dark-crossing'))).toEqual([
      'knot-outer',
      'ossuary-galleries',
    ]);
    expect(regionsAt(regions, spot(scene, 'chapel-of-echoes'))).toEqual([
      'knot-outer',
      'chapel-of-echoes',
    ]);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'knot-outer');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });
});

describe('the Knot outer half on foot (mw-e26.9)', () => {
  it('a walker goes from the breach landing to every place of the three areas and the Horn’s Hall stub', () => {
    for (const id of [
      'player-start',
      'scales-room',
      'spider-nest-a',
      'rune-band-west',
      'ossuary-galleries',
      'forgotten-stub-b',
      'clatter-garden',
      'chapel-of-echoes',
      'chime-1',
      'chime-4',
      'counterweight',
      'horns-hall-stub',
      'read-friend-note-warden',
    ]) {
      if (id === 'counterweight') continue; // hangs 2.75 m up, not a place to stand
      expect(route('arrive-from-deepworks', id, 'chapel-portcullis').status, id).toBe('found');
    }
  });

  it('the pit is three metres down and the ring corridors on both sides run round to the north one', () => {
    expect(spot(scene, 'dark-crossing').y).toBe(-3);
    // The ring’s west and east corridors are both ways round to the north corridor.
    const west = route('rune-band-south', 'rune-band-north');
    const east = route('rune-band-east', 'rune-band-north');
    expect(west.status).toBe('found');
    expect(east.status).toBe('found');
  });
});

describe('the quest’s Knot areas (mw-e26.9)', () => {
  it('the main quest’s enterArea knot-outer-ring and ossuary-galleries are player volumes of the knot-outer graph', () => {
    const quest = readFileSync(
      'src/content/data/quest/quest-labyrinth-beneath-briar-glen.json',
      'utf8',
    );
    const graph = content.get('signal-graph', 'knot-outer');
    for (const area of ['knot-outer-ring', 'ossuary-galleries']) {
      expect(quest).toContain(`"area": "${area}"`);
      const node = graph.nodes.find((n) => n.id === area);
      expect(node?.kind).toBe('volume');
      expect(node).toMatchObject({ observed: true, filter: [{ test: 'tag', tag: 'player' }] });
    }
    expect(scene.signals[0]?.graph.id).toBe('knot-outer');
  });

  it('the ring volume holds the breach landing and the whole ring, the Ossuary volume its hall, pit and garden', () => {
    const inside = (node: string, p: Vec3): boolean => {
      const n = content.get('signal-graph', 'knot-outer').nodes.find((x) => x.id === node);
      if (n?.kind !== 'volume' || n.shape.kind !== 'box') return false;
      const { center: c, halfExtents: h } = n.shape;
      return Math.abs(p.x - c.x) <= h.x && Math.abs(p.y - c.y) <= h.y && Math.abs(p.z - c.z) <= h.z;
    };
    for (const id of ['arrive-from-deepworks', 'player-start', 'scales-room', 'rune-band-west']) {
      expect(inside('knot-outer-ring', spot(scene, id)), id).toBe(true);
      expect(inside('ossuary-galleries', spot(scene, id)), id).toBe(false);
    }
    for (const id of ['ossuary-galleries', 'dark-crossing', 'clatter-garden', 'east-gallery']) {
      expect(inside('ossuary-galleries', spot(scene, id)), id).toBe(true);
      expect(inside('knot-outer-ring', spot(scene, id)), id).toBe(false);
    }
  });
});

describe('the breach and the Deepworks (mw-e26.9)', () => {
  it('breach-outer-ring lists the transition at each end and each leads to the other scene’s arrival', () => {
    const edge = world?.edges.find((e) => e.id === 'breach-outer-ring');
    expect(edge?.transitions).toEqual(['deepworks/breach-door', 'knot-outer/breach-door']);
    expect(deepworks.transitions.find((t) => t.id === 'breach-door')).toMatchObject({
      scene: { id: 'knot-outer' },
      spawn: 'arrive-from-deepworks',
    });
    expect(scene.transitions.find((t) => t.id === 'breach-door')).toMatchObject({
      scene: { id: 'deepworks' },
      spawn: 'arrive-from-knot-outer',
    });
    expect(scene.spawns.find((s) => s.id === 'arrive-from-deepworks')).toBeDefined();
    expect(deepworks.spawns.find((s) => s.id === 'arrive-from-knot-outer')).toBeDefined();
  });

  it('the Deepworks breach room walks to its new door and the Knot landing to its own', () => {
    const dwQuery = new NavMeshQuery(new NavMesh(content.get('navmesh', 'deepworks')));
    const open = doors('front-gate-door');
    const path = dwQuery.findPath({
      start: spot(deepworks, 'breach'),
      goal: spot(deepworks, 'arrive-from-knot-outer'),
      agent: walker,
      doors: open,
    });
    expect(path.status).toBe('found');
    const door = deepworks.transitions.find((t) => t.id === 'breach-door');
    const arrive = spot(deepworks, 'breach-threshold');
    expect(door).toBeDefined();
    expect(arrive.z).toBeGreaterThan(door?.min[2] ?? Infinity);
    expect(route('arrive-from-deepworks', 'breach-door').status).toBe('found');
  });
});

describe('the Chapel portcullis counterweight (mw-e26.9 AC-2)', () => {
  const chapel = (options: { magic?: boolean } = {}) => {
    const game = createGameWorld<never>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'knot-outer',
      ...options,
    });
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
    steps(240);
    return { game, sim, id, steps };
  };
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

  it('AC-2: the portcullis hangs open, and a pierce hit on the counterweight rope drops it for good', ({
    task,
  }) => {
    markExercised(task, 'scene', 'knot-outer');
    markExercised(task, 'signal-graph', 'knot-outer');
    markExercised(task, 'signal-graph', 'chapel-portcullis');
    const r = chapel();
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('open');
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('counterweight-rope') },
      element: 'pierce',
      intensity: 60,
      source: r.game.player,
    });
    r.steps(480);
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('closed');
    expect(r.sim.facts.get('chapel-of-echoes.portcullis-dropped')).toBe(true);
    // The latch holds.
    r.steps(300);
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('closed');
  });

  it('AC-2: an arrow into the rope drops the portcullis too', ({ task }) => {
    markExercised(task, 'arrow', 'standard');
    const r = chapel();
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('open');
    fireArrow(r.sim, r.game.combat.bow.arrows, {
      arrow: 'standard',
      origin: v(70, 4.2, 230),
      velocity: v(0, 0, 60),
    });
    r.steps(480);
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('closed');
  });

  it('AC-2: a flame on the rope burns it through and the portcullis drops', () => {
    const r = chapel({ magic: true });
    setProperty(r.sim, r.id('counterweight-rope'), 'fuel', 2);
    applyStimulus(r.sim, {
      shape: { kind: 'contact', target: r.id('counterweight-rope') },
      element: 'heat',
      intensity: 600,
    });
    r.steps(60 * 8);
    expect(doorStatus(r.sim, r.id('chapel-portcullis'))).toBe('closed');
  }, 60_000);

  it('AC-2: a walker with the portcullis down still goes round it by the north vent', () => {
    expect(route('chapel-of-echoes', 'horns-hall-stub').status).toBe('found');
  });
});
