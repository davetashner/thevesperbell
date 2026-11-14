// mw-e26.10 on real content, headless: the Knot's inner half (Horn's Hall, the Fold, the Cradle, the Sounding
// Shaft's foot) and the secret Hornfolk way to the Cradle. Named places and the routes between them (AC-1), the
// secret door as a wall until its seal is open (AC-2), the sealed crypt passage, the Fold's one door, the quest's
// area volumes (mw-5wg), the link to the Chapel landing and the Cradle's friend-below note (mw-bj41). The Cradle's
// frame time (AC-3) is the perf suite's (README: Perf budgets); the walk in the browser is e2e/knot-inner.spec.ts.
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
  doorStatus,
  NavMesh,
  NavMeshQuery,
  regionsAt,
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
const scene = content.get('scene', 'knot-inner');
const outer = content.get('scene', 'knot-outer');
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
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'knot-inner')));
const route = (from: string, to: string, ...open: readonly string[]) =>
  pathOn(query, scene, from, to, ...open);
const points = (path: NavPathResult): readonly Vec3[] => {
  if (path.status === 'off-mesh') throw new Error('off-mesh');
  return path.points;
};

/** A bake of the scene with a wall across each given spot (a wall of `half` metres each side, both ways). */
function bakedWithWalls(
  walls: readonly { readonly at: readonly [number, number, number]; readonly half: number }[],
): NavMeshQuery {
  const wall = scene.placements.find((p) => p.piece.id === 'wall');
  if (wall === undefined) throw new Error('the scene has no wall to copy');
  const blocked: Scene = {
    ...scene,
    placements: [
      ...scene.placements,
      ...walls.flatMap(({ at, half }) => {
        const shut = { ...wall, at, scale: [half, 1.5, 1] as const };
        return [shut, { ...shut, yaw: 90 as const }];
      }),
    ],
  };
  const patched = {
    get: (kind: string, id: string) =>
      kind === 'scene' && id === 'knot-inner' ? blocked : content.get(kind as 'kit', id),
    all: (kind: string) => content.all(kind as 'kit'),
    has: (kind: string, id: string) => content.has(kind as 'kit', id),
  } as unknown as GameContent;
  return new NavMeshQuery(new NavMesh(bakeScene(patched, 'knot-inner')));
}
/** The Cradle's corridor from the hall, walled shut at the cradle-gate marker (the gap is 4 m wide). */
const withoutGate = () => bakedWithWalls([{ at: [90, 0, 74], half: 3 }]);

const NODES = ['horns-hall', 'the-fold', 'the-cradle', 'sounding-shaft-foot'] as const;

describe(
  'the Knot inner half: named places and routes (mw-e26.10 AC-1)',
  { timeout: 60_000 },
  () => {
    it('AC-1: Horn’s Hall, the Fold, the Cradle and the Shaft’s foot are the knot-inner scene’s nodes of the world map, each a named spawn', () => {
      const nodes = (world?.nodes ?? []).filter((n) => n.scene?.id === 'knot-inner');
      expect(nodes.map((n) => n.id).sort()).toEqual([...NODES].sort());
      for (const node of nodes) {
        expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
      }
    });

    it('AC-1: the named places of the four areas are all there', () => {
      const ids = new Set(scene.spawns.map((s) => s.id));
      for (const id of [
        'arrive-from-knot-outer',
        'horns-door',
        'horn-post',
        'statue-ears-1',
        'statue-ears-4',
        'fold-door',
        'fold-wake',
        'moss-bed-1',
        'moss-bed-6',
        'read-fold-tallies',
        'cradle-gate',
        'cradle-centre',
        'carved-face-1',
        'carved-face-8',
        'shaft-door',
        'shaft-mouth',
        'cradle-view',
        'crypt-door',
        'crypt-passage-end',
        'hornfolk-door',
        'hornfolk-wall',
        'cradle-east-door',
      ]) {
        expect(ids.has(id), id).toBe(true);
      }
    });

    it('AC-1: a walker goes from the vestibule to every place of the four areas but the sealed ones', () => {
      for (const id of [
        'player-start',
        'horns-hall',
        'horn-post',
        'statue-ears-1',
        'statue-ears-4',
        'the-fold',
        'fold-wake',
        'moss-bed-1',
        'moss-bed-6',
        'read-fold-tallies',
        'crypt-passage',
        'the-cradle',
        'read-friend-note-cradle',
        'cradle-centre',
        'carved-face-1',
        'carved-face-5',
        'carved-face-8',
        'cradle-east-door',
        'sounding-shaft-foot',
        'shaft-mouth',
        'hornfolk-wall',
      ]) {
        expect(route('arrive-from-knot-outer', id).status, id).toBe('found');
      }
    });

    it('AC-1: the world map’s inner-Knot edges join the hall to the Fold, the Cradle and the Shaft on foot', () => {
      const edges = new Map((world?.edges ?? []).map((e) => [e.id, e]));
      for (const [id, from, to] of [
        ['horns-hall-fold', 'horns-hall', 'the-fold'],
        ['horns-hall-cradle', 'horns-hall', 'the-cradle'],
        ['cradle-shaft-foot', 'the-cradle', 'sounding-shaft-foot'],
      ] as const) {
        expect(edges.get(id), id).toMatchObject({ from, to });
        expect(route(from, to).status, id).toBe('found');
      }
      // The Fold and the Shaft are dead ends: the Cradle is not on the way to the Fold.
      expect(route('the-fold', 'sounding-shaft-foot').status).toBe('found');
      expect(route('the-fold', 'horns-hall').status).toBe('found');
    });

    it('AC-1: the Fold has one door: with it walled shut the vault is cut off, and the hall is still whole', () => {
      const q = bakedWithWalls([{ at: [50, 0, 44], half: 1.5 }]);
      expect(pathOn(q, scene, 'horns-hall', 'the-fold').status).not.toBe('found');
      expect(pathOn(q, scene, 'horns-hall', 'the-cradle').status).toBe('found');
    });

    it('AC-1: the scene is the knot-inner region with the hall, the Fold, the Cradle and the Shaft inside it', () => {
      const { regions } = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'knot-inner' })
        .scene.layout;
      for (const [id, area] of [
        ['horns-hall', 'horns-hall'],
        ['the-fold', 'the-fold'],
        ['the-cradle', 'the-cradle'],
        ['sounding-shaft-foot', 'sounding-shaft-foot'],
        ['hornfolk-corner', undefined],
      ] as const) {
        const here = regionsAt(regions, spot(scene, id));
        expect(here, id).toContain('knot-inner');
        if (area !== undefined) expect(here, id).toContain(area);
      }
      expect(regionsAt(regions, spot(scene, 'player-start'))).toEqual(['knot-inner']);
      const rule = content
        .get('respawn-rules', 'respawn-rules')
        .rules.find((r) => r.region.id === 'knot-inner');
      expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
    });
  },
);

describe('the Cradle’s secret Hornfolk way (mw-e26.10 AC-2)', { timeout: 60_000 }, () => {
  it('AC-2: the Cradle has two ways in: the corridor from the hall and the secret way, which is a wall while the seal holds', () => {
    // Both open: the corridor and (with the seal open) the secret way each lead to the Cradle.
    expect(route('horns-hall', 'the-cradle').status).toBe('found');
    const noGate = withoutGate();
    // The corridor walled shut and the seal holding: the Cradle is cut off from the hall by a wall.
    expect(pathOn(noGate, scene, 'horns-hall', 'the-cradle').status).not.toBe('found');
    expect(pathOn(noGate, scene, 'hornfolk-wall', 'cradle-east-door').status).not.toBe('found');
    // The seal dispelled, the door opens and the secret way leads round to the Cradle.
    const through = pathOn(noGate, scene, 'hornfolk-wall', 'the-cradle', 'hornfolk-door');
    expect(through.status).toBe('found');
    const way = points(through);
    expect(Math.max(...way.map((p) => p.x))).toBeGreaterThan(138);
    expect(Math.max(...way.map((p) => p.z))).toBeGreaterThan(120);
    // And the whole of the hall reaches the Cradle that way.
    expect(pathOn(noGate, scene, 'horns-hall', 'the-cradle', 'hornfolk-door').status).toBe('found');
  });

  it('AC-2: with the corridor open the secret way is a short cut only once the seal is open', () => {
    const shut = points(route('hornfolk-wall', 'cradle-east-door'));
    expect(Math.max(...shut.map((p) => p.x))).toBeLessThan(131);
    const open = points(route('hornfolk-wall', 'cradle-east-door', 'hornfolk-door'));
    expect(Math.max(...open.map((p) => p.x))).toBeGreaterThan(138);
    expect(open.length).toBeLessThanOrEqual(shut.length);
  });

  it('AC-2: the door is a sorcerer’s secret edge: a Hornfolk seal in a magical lock, the runes beside it readable', ({
    task,
  }) => {
    markExercised(task, 'lock', 'hornfolk-seal');
    markExercised(task, 'fact', 'world');
    const lock = content.get('lock', 'hornfolk-seal');
    expect(lock).toMatchObject({ sealed: true, tier: 5 });
    const door = scene.spawns.find((s) => s.id === 'hornfolk-door');
    expect(door?.door).toMatchObject({
      profile: { id: 'sliding-door' },
      lock: { id: 'hornfolk-seal' },
    });
    const edge = world?.edges.find((e) => e.id === 'horns-hall-cradle-secret');
    expect(edge).toMatchObject({
      from: 'horns-hall',
      to: 'the-cradle',
      kind: 'secret',
      unlock: { fact: 'world.hornfolk-seal.dispelled' },
    });
    expect(edge?.classesHint).toHaveLength(1);
    expect(JSON.stringify(edge?.classesHint)).toContain('sorcerer');
    const runes = scene.spawns.find((s) => s.id === 'hornfolk-wall');
    expect(runes?.tags).toEqual(
      expect.arrayContaining(['readable', 'inscription-knot-carved-faces']),
    );
    expect(runes?.interact?.affordances[0]?.verb).toBe('read');
    // The runes stand beside the door, on the hall side.
    const at = spot(scene, 'hornfolk-wall');
    expect(Math.hypot(at.x - 130, at.z - 58)).toBeLessThan(6);
  });

  it('AC-2: in the loaded world the sealed doors are locked', ({ task }) => {
    markExercised(task, 'scene', 'knot-inner');
    markExercised(task, 'signal-graph', 'knot-inner');
    const game = createGameWorld<never>(RAPIER, { seed: 1, hz: 60, scene: 'knot-inner' });
    const byId = new Map<string, EntityId>();
    for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
    for (let i = 0; i < 120; i++) game.world.step();
    for (const id of ['hornfolk-door', 'crypt-door']) {
      const entity = byId.get(id);
      if (entity === undefined) throw new Error(`no spawn ${id}`);
      expect(doorStatus(game.world, entity), id).toBe('locked');
    }
  });
});

describe('the sealed crypt passage (mw-e26.10)', { timeout: 60_000 }, () => {
  it('the passage runs off the hall to a locked door; behind it a sealed stub waits for the priory', () => {
    expect(route('horns-hall', 'crypt-passage').status).toBe('found');
    expect(route('horns-hall', 'crypt-passage-end').status).not.toBe('found');
    expect(route('horns-hall', 'crypt-passage-end', 'crypt-door').status).toBe('found');
    const door = scene.spawns.find((s) => s.id === 'crypt-door');
    expect(door?.door).toMatchObject({ lock: { id: 'crypt-sealed' } });
    const edge = world?.edges.find((e) => e.id === 'ossuary-crypt');
    expect(edge).toMatchObject({
      to: 'priory-crypt',
      unlock: { fact: 'world.priory-crypt.unsealed' },
    });
    const priory = content.get('scene', 'bellwater-priory');
    expect(priory.spawns.find((s) => s.id === 'crypt-door')?.door).toMatchObject({
      lock: { id: 'crypt-sealed' },
    });
  });
});

describe('the quest’s inner Knot areas (mw-5wg)', { timeout: 60_000 }, () => {
  const inside = (node: string, p: Vec3): boolean => {
    const n = content.get('signal-graph', 'knot-inner').nodes.find((x) => x.id === node);
    if (n?.kind !== 'volume' || n.shape.kind !== 'box') return false;
    const { center: c, halfExtents: h } = n.shape;
    return Math.abs(p.x - c.x) <= h.x && Math.abs(p.y - c.y) <= h.y && Math.abs(p.z - c.z) <= h.z;
  };

  it('the main quest’s enterArea horns-hall, the-fold and the-cradle are player volumes of the knot-inner graph', () => {
    const quest = readFileSync(
      'src/content/data/quest/quest-labyrinth-beneath-briar-glen.json',
      'utf8',
    );
    const graph = content.get('signal-graph', 'knot-inner');
    for (const area of ['horns-hall', 'the-fold', 'the-cradle']) {
      expect(quest).toContain(`"area": "${area}"`);
      const node = graph.nodes.find((n) => n.id === area);
      expect(node?.kind).toBe('volume');
      expect(node).toMatchObject({ observed: true, filter: [{ test: 'tag', tag: 'player' }] });
    }
    expect(scene.signals[0]?.graph.id).toBe('knot-inner');
  });

  it('each volume holds its own area’s places and none of the others’', () => {
    const places = {
      'horns-hall': ['horns-hall', 'horn-post', 'statue-ears-1', 'fold-door', 'hornfolk-wall'],
      'the-fold': ['the-fold', 'fold-wake', 'moss-bed-1', 'read-fold-tallies'],
      'the-cradle': ['the-cradle', 'cradle-centre', 'carved-face-1', 'read-friend-note-cradle'],
    } as const;
    for (const [area, ids] of Object.entries(places)) {
      for (const [other, otherIds] of Object.entries(places)) {
        for (const id of otherIds) {
          const p = spot(scene, id);
          // The doorway spawns sit in the wall between two rooms, so they are not checked on both sides.
          if (id === 'fold-door') continue;
          expect(inside(area, p), `${id} in ${area}`).toBe(area === other);
        }
      }
      for (const id of ids) {
        if (id === 'fold-door') continue;
        expect(inside(area, spot(scene, id)), `${id} in ${area}`).toBe(true);
      }
    }
  });
});

describe('the Chapel landing and the vestibule (mw-e26.10)', { timeout: 60_000 }, () => {
  it('chapel-horns-hall lists the transition at each end and each leads to the other scene’s arrival', () => {
    const edge = world?.edges.find((e) => e.id === 'chapel-horns-hall');
    expect(edge?.transitions).toEqual(['knot-outer/horns-door', 'knot-inner/horns-door']);
    expect(outer.transitions.find((t) => t.id === 'horns-door')).toMatchObject({
      scene: { id: 'knot-inner' },
      spawn: 'arrive-from-knot-outer',
    });
    expect(scene.transitions.find((t) => t.id === 'horns-door')).toMatchObject({
      scene: { id: 'knot-outer' },
      spawn: 'arrive-from-knot-inner',
    });
    expect(scene.spawns.find((s) => s.id === 'arrive-from-knot-outer')).toBeDefined();
    expect(outer.spawns.find((s) => s.id === 'arrive-from-knot-inner')).toBeDefined();
  });

  it('the landing walks to its new door and the vestibule to its own', () => {
    const outerQuery = new NavMeshQuery(new NavMesh(content.get('navmesh', 'knot-outer')));
    const path = outerQuery.findPath({
      start: spot(outer, 'arrive-from-knot-inner'),
      goal: spot(outer, 'horns-door'),
      agent: walker,
      doors: doors('chapel-portcullis'),
    });
    expect(path.status).toBe('found');
    const door = outer.transitions.find((t) => t.id === 'horns-door');
    const arrive = spot(outer, 'arrive-from-knot-inner');
    expect(door).toBeDefined();
    expect(arrive.z).toBeLessThan(door?.min[2] ?? -Infinity);
    expect(route('arrive-from-knot-outer', 'horns-door').status).toBe('found');
    const back = scene.transitions.find((t) => t.id === 'horns-door');
    expect(spot(scene, 'arrive-from-knot-outer').z).toBeGreaterThan(back?.max[2] ?? Infinity);
  });
});
