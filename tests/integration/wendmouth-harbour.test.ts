// mw-e40.1 on real content, headless: Wendmouth's named places (AC-1), the optional town off the main
// quest's critical path (AC-2), every building entry reachable on the navmesh from the barge berth and
// the towpath arrival (AC-3), the eight dialogue NPCs at their places, and wendmouth.visited
// (mw-e39.32) and the heist's quest areas written by signal graphs. The frame-time budget from the
// Stone Wharf (AC-4) is the perf suite's (README: Perf budgets); the walk and the talk in the browser
// are e2e/wendmouth-harbour.spec.ts.
import { describe, expect, it } from 'vitest';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  actionButton,
  actionFrame,
  actionVector,
  NavMesh,
  NavMeshQuery,
  teleportCommand,
  volumeEntered,
  type ActionFrame,
  type NavDoorLookup,
  type NavPathPoint,
  type NavPathResult,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { buildEnv, validateWorld } from '@tools/world/validate';

const content = loadGameContent();
const [world] = content.all('world');
const scene = content.get('scene', 'wendmouth-harbour');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'wendmouth-harbour')));

const spawnOf = (id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return spawn;
};
const at = (id: string) => {
  const [x, y, z] = spawnOf(id).at;
  return { x, y, z };
};

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
/** The humanoid without its climb mode: any way it finds is stairs, floors and doorways. */
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };
/** A rough-stone climber (the thief and archer reach grade 2). */
const roughClimber: NavAgent = { ...humanoid, maxClimbGrade: 2 };

/** Every door unlocked and open: the world once each seal, lock and gate has been dealt with. */
const open: NavDoorLookup = () => 'open';
/** A door stands open unless it has a lock: what the town looks like before anyone picks a thing. */
const asFound: NavDoorLookup = (id) => (spawnOf(id).door?.lock === undefined ? 'open' : 'locked');
const route = (
  agent: NavAgent,
  from: string,
  to: string,
  doors: NavDoorLookup = asFound,
): NavPathResult => query.findPath({ start: at(from), goal: at(to), agent, doors });
const pointsOf = (result: NavPathResult): readonly NavPathPoint[] =>
  result.status === 'off-mesh' ? [] : result.points;
const climbs = (points: readonly NavPathPoint[]) => points.filter((p) => p.link === 'climb');

const WENDMOUTH_NODES = [
  'stone-wharf',
  'tidemarket',
  'customs-house',
  'bonded-warehouse',
  'drowned-gull',
  'undertow',
  'net-lofts',
  'gilded-tern',
  'breakwater',
] as const;

const ENTRIES = [
  'customs-entry',
  'customs-office-door',
  'tidemarket-entry',
  'warehouse-entry',
  'warehouse-dockhand-door',
  'gull-entry',
  'net-loft-entry-a',
  'net-loft-entry-b',
  'net-loft-entry-c',
  'tern-gangway',
  'breakwater-door-landing',
  'gull-cellar-landing',
] as const;

describe('Wendmouth named places (mw-e40.1 AC-1)', () => {
  it('AC-1: every Wendmouth node of the world map is built as a named node spawn of the harbour scene', () => {
    const nodes = (world?.nodes ?? []).filter((n) => n.area === 'wendmouth');
    expect(nodes.map((n) => n.id).sort()).toEqual([...WENDMOUTH_NODES].sort());
    for (const node of nodes) {
      expect(node.scene?.id).toBe('wendmouth-harbour');
      expect(scene.spawns.some((s) => s.id === node.id && s.tags.includes('node'))).toBe(true);
    }
  });

  it('AC-1: the bible places that are not nodes are named too: the Silver Quay, the cranes, the Tidefair ground, bay nine, the strongroom, Cray’s office, the sunken figurehead, the berth', () => {
    const ids = new Set(scene.spawns.map((s) => s.id));
    for (const id of [
      'silver-quay',
      'door-silver-quay-gate',
      'crane-a',
      'crane-b',
      'cargo-net-a',
      'block-yard-east',
      'tidefair-flagstones',
      'patient-ann',
      'barge-berth',
      'towpath-arrival',
      'bay-nine',
      'manifest-desk',
      'night-watchman-post',
      'skylight-bay-nine',
      'hoist-beam-a',
      'strongroom',
      'strongroom-grille',
      'customs-office',
      'customs-scale',
      'cray-shelf',
      'arms-stall',
      'book-cart',
      'stamp-forger',
      'gull-bar',
      'arm-wrestling-table',
      'dice-table',
      'sunken-figurehead',
      'sea-door',
      'tern-berth',
      'tern-rigging-foot',
      'roof-route-customs',
      'wharf-view',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('AC-1: the pool and the sea are standing-water volumes and the pool has ladders out', () => {
    const water = scene.spawns.filter((s) => s.tags.includes('standing-water'));
    expect(water.length).toBeGreaterThanOrEqual(3);
    for (const w of water) expect(w.liquid?.liquid.id).toBe('water');
    expect(scene.spawns.filter((s) => s.tags.includes('ladder'))).toHaveLength(4);
    const ladders = scene.placements.filter((p) => p.properties?.climbable === 'ladder');
    expect(ladders).toHaveLength(4);
  });

  it('AC-1: the doors that stay shut are real locked doors, the open buildings have none', () => {
    const doors = scene.spawns.filter((s) => s.door !== undefined);
    const locked = doors
      .filter((d) => d.door?.lock !== undefined)
      .map((d) => [d.id, d.door?.lock?.id]);
    expect(locked).toEqual([
      ['door-exit-towpath', 'road-not-open'],
      ['door-strongroom', 'strongroom-locked'],
      ['door-bay-nine', 'bay-nine-seal'],
      ['door-silver-quay-gate', 'silver-quay-sealed'],
      ['door-tern-gangway', 'tern-gangway'],
      ['door-tern-berth', 'tern-berth'],
      ['door-breakwater-undertow', 'breakwater-door'],
      ['door-gull-trapdoor', 'undertow-trapdoor'],
    ]);
    expect(content.get('lock', 'silver-quay-sealed')).toMatchObject({ tier: 5, pickTier: null });
    expect(content.get('lock', 'bay-nine-seal')).toMatchObject({ pickTier: 2 });
  });

  it('AC-1: the scene is the wendmouth-harbour region and the respawn rule names it', () => {
    expect(scene.regions.map((r) => r.id)).toEqual(['wendmouth-harbour']);
    const rule = content
      .get('respawn-rules', 'respawn-rules')
      .rules.find((r) => r.region.id === 'wendmouth-harbour');
    expect(rule?.destination).toMatchObject({ spawn: 'player-start' });
  });
});

describe('Wendmouth is optional (mw-e40.1 AC-2)', () => {
  it('AC-2: the main quest critical path passes through no Wendmouth node and every Wendmouth node is optional', () => {
    if (world === undefined) throw new Error('no world map');
    const report = validateWorld(world, buildEnv(content), content);
    expect(report.errors).toEqual([]);
    const wendmouth = new Set(world.nodes.filter((n) => n.area === 'wendmouth').map((n) => n.id));
    expect(report.criticalPath.length).toBeGreaterThan(5);
    expect(report.criticalPath.filter((id) => wendmouth.has(id))).toEqual([]);
    for (const id of wendmouth) {
      expect(world.nodes.find((n) => n.id === id)?.optional, id).toBe(true);
    }
    expect(world.mainQuest.filter((id) => wendmouth.has(id))).toEqual([]);
  });

  it('AC-2: no edge of the main quest runs to a Wendmouth node: the river legs stay planned and no scene links here yet', () => {
    const towpath = world?.edges.find((e) => e.id === 'towpath-lock-wharf');
    const barge = world?.edges.find((e) => e.id === 'barge-lock-wharf');
    expect(towpath?.transitions).toEqual([]);
    expect(barge?.transitions).toEqual([]);
    expect(scene.transitions).toEqual([]);
    for (const other of content.all('scene')) {
      expect(
        other.transitions.filter((t) => t.scene.id === 'wendmouth-harbour'),
        other.id,
      ).toEqual([]);
    }
  });
});

describe('the harbour on foot (mw-e40.1 AC-3)', () => {
  it.each(ENTRIES)(
    'AC-3: %s is reachable from the barge berth and from the towpath arrival (doors unlocked)',
    (entry) => {
      expect(route(walker, 'barge-berth', entry, open).status, `barge berth to ${entry}`).toBe(
        'found',
      );
      expect(route(walker, 'towpath-arrival', entry, open).status, `towpath to ${entry}`).toBe(
        'found',
      );
    },
  );

  it('AC-3: every node of the town is reachable on foot from both arrivals once the doors are unlocked', () => {
    for (const id of WENDMOUTH_NODES) {
      if (id === 'net-lofts') continue; // up on the roofs: climbers only, below
      for (const from of ['barge-berth', 'towpath-arrival']) {
        expect(route(walker, from, id, open).status, `${from} to ${id}`).toBe('found');
      }
    }
  });

  it('AC-3: the open buildings are walked into as found, with no lock opened and no climb', () => {
    for (const id of [
      'customs-entry',
      'customs-house',
      'customs-office-door',
      'tidemarket-entry',
      'tidemarket',
      'warehouse-entry',
      'warehouse-dockhand-door',
      'bonded-warehouse',
      'manifest-desk',
      'gull-entry',
      'drowned-gull',
      'gull-bar',
      'net-loft-entry-a',
      'net-loft-entry-b',
      'net-loft-entry-c',
      'breakwater',
      'tern-gangway',
      'stone-wharf',
    ]) {
      for (const from of ['barge-berth', 'towpath-arrival']) {
        const result = route(walker, from, id);
        expect(result.status, `${from} to ${id}`).toBe('found');
        expect(climbs(pointsOf(result)), `${from} to ${id}`).toHaveLength(0);
      }
    }
  });

  it('AC-3: the barge berth is at the foot of the Great Stair, a step down from the wharf, and Mags stands there', () => {
    const berth = at('barge-berth');
    expect(berth.y).toBeCloseTo(-2, 1);
    const result = route(walker, 'barge-berth', 'stone-wharf');
    expect(result.status).toBe('found');
    const ys = pointsOf(result).map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-1.5);
    expect(Math.max(...ys)).toBeGreaterThan(-0.5);
    expect(spawnOf('npc-mags').at[1]).toBeCloseTo(-2, 1);
  });

  it('AC-3: the sealed places stay shut as found: bay nine, the strongroom, the Silver Quay, the Tern’s berth, and the whole Undertow', () => {
    for (const id of [
      'bay-nine',
      'strongroom',
      'silver-quay',
      'tern-berth',
      'undertow',
      'undertow-wet-bootprints-a',
      'undertow-wet-bootprints-b',
    ]) {
      expect(route(humanoid, 'barge-berth', id).status, id).toBe('unreachable');
    }
  });

  it('AC-3: with the seals broken the same walks go through the doors, and the Undertow opens from either end', () => {
    for (const id of ['bay-nine', 'strongroom', 'silver-quay', 'tern-berth', 'undertow']) {
      expect(route(walker, 'barge-berth', id, open).status, id).toBe('found');
    }
    // The tunnel joins the harbour-wall stair and the Gull's cellar stair.
    expect(route(walker, 'breakwater-door-landing', 'gull-cellar-landing', open).status).toBe(
      'found',
    );
    expect(route(walker, 'gull-cellar-landing', 'undertow', open).status).toBe('found');
    // Each end is its own door: unlock one and the other still keeps the Undertow shut from the far end.
    const onlyCellar: NavDoorLookup = (id) => (id === 'door-gull-trapdoor' ? 'open' : asFound(id));
    expect(route(walker, 'barge-berth', 'undertow', onlyCellar).status).toBe('found');
    const onlyBreakwater: NavDoorLookup = (id) =>
      id === 'door-breakwater-undertow' ? 'open' : asFound(id);
    expect(route(walker, 'barge-berth', 'undertow', onlyBreakwater).status).toBe('found');
    expect(route(humanoid, 'barge-berth', 'undertow', asFound).status).toBe('unreachable');
  });

  it('the net-lofts roof route is for rough climbers: a free-climb up the first loft, roofs joined by planks, and stairs to the Customs House roof', () => {
    expect(route(humanoid, 'net-loft-climb-foot', 'net-loft-roof-c').status).toBe('unreachable');
    expect(route(humanoid, 'net-loft-climb-foot', 'roof-route-customs').status).toBe('unreachable');
    const up = route(roughClimber, 'net-loft-climb-foot', 'net-loft-roof-c');
    expect(up.status).toBe('found');
    expect(climbs(pointsOf(up))).toHaveLength(1);
    const customs = route(roughClimber, 'net-loft-climb-foot', 'roof-route-customs');
    expect(customs.status).toBe('found');
    expect(climbs(pointsOf(customs))).toHaveLength(1);
    // The scene says where the edge goes: the net lofts roof to the Customs House roof.
    const edge = world?.edges.find((e) => e.id === 'net-lofts-customs-roof');
    expect(edge?.from).toBe('net-lofts');
    expect(edge?.to).toBe('customs-house');
  });

  it('the warehouse roof is a climb up the north face, with skylights over the hall and over bay nine', () => {
    expect(route(humanoid, 'warehouse-climb-foot', 'skylight-bay-nine').status).toBe('unreachable');
    const up = route(roughClimber, 'warehouse-climb-foot', 'skylight-bay-nine');
    expect(up.status).toBe('found');
    expect(climbs(pointsOf(up))).toHaveLength(1);
    const roof = scene.placements.find(
      (p) => p.properties?.climbable === 'rough' && p.at[2] > 70 && p.at[0] === 40,
    );
    expect(roof?.scale[1]).toBe(6);
  });

  it('the Gilded Tern is boarded by its gangway gate, and its rigging is a rough climb on the main mast', () => {
    expect(route(walker, 'barge-berth', 'tern-berth', asFound).status).toBe('unreachable');
    expect(route(walker, 'tern-rigging-foot', 'tern-crows-nest', open).status).not.toBe('found');
    const up = route(roughClimber, 'tern-rigging-foot', 'tern-crows-nest', open);
    expect(up.status).toBe('found');
    expect(climbs(pointsOf(up))).toHaveLength(1);
  });
});

describe('Wendmouth’s people (mw-e40.1, with the dialogues of mw-e19 harbour folk)', () => {
  const PEOPLE = [
    ['npc-mags', 'barge-berth'],
    ['npc-nell', 'gull-bar'],
    ['npc-oona', 'arm-wrestling-table'],
    ['npc-reed', 'towpath-arrival'],
    ['npc-cray', 'customs-office'],
    ['npc-tereza', 'arms-stall'],
    ['npc-quell', 'manifest-desk'],
    ['npc-hesketh', 'tern-gangway'],
  ] as const;

  it('all eight dialogue NPCs stand in the harbour as their creatures, each with a dialogue', () => {
    for (const [id, place] of PEOPLE) {
      const spawn = spawnOf(id);
      expect(spawn.creature?.id, id).toBe(id);
      expect(content.get('creature', id).dialogue, id).toBeDefined();
      expect(spawn.tags, id).toContain('npc');
      const here = spawn.at;
      const there = spawnOf(place).at;
      expect(
        Math.hypot(here[0] - there[0], here[2] - there[2]),
        `${id} near ${place}`,
      ).toBeLessThan(12);
    }
  });

  it('only Quell is gone when his dialogue says so: despawnIf quell.left, and no one else is gated', () => {
    expect(spawnOf('npc-quell').despawnIf).toEqual({ fact: 'quell.left' });
    for (const [id] of PEOPLE) {
      if (id === 'npc-quell') continue;
      expect(spawnOf(id).despawnIf, id).toBeUndefined();
      expect(spawnOf(id).spawnIf, id).toBeUndefined();
    }
  });

  it('the people can be reached on foot: Mags and Hesketh from the berth, the rest from the wharf', () => {
    for (const [id] of PEOPLE) {
      expect(route(walker, 'barge-berth', id).status, id).toBe('found');
    }
  });
});

const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});

type Input = ActionFrame | ReturnType<typeof teleportCommand>;

/** The harbour loaded the way the game wires it (the player starts on the Stone Wharf). */
function play() {
  const game = createGameWorld<Input>(RAPIER, {
    seed: 3,
    hz: 60,
    scene: 'wendmouth-harbour',
    magic: true,
  });
  const entered: string[] = [];
  game.world.events.on(volumeEntered, ({ node, entity }) => {
    if (entity === game.player) entered.push(node);
  });
  const settle = (ticks = 10): void => {
    for (let i = 0; i < ticks; i++) game.world.step([IDLE]);
  };
  const stand = (to: { x: number; y: number; z: number }): void => {
    game.world.step([teleportCommand(game.player, to)]);
    settle();
  };
  settle();
  return { game, facts: game.world.facts, entered, stand, settle };
}

describe('arriving in Wendmouth (mw-e39.32)', () => {
  it('writes wendmouth.visited when a game starts on the Stone Wharf (a debug load)', () => {
    const g = play();
    expect(g.entered).toContain('wharf-start');
    expect(g.facts.get('wendmouth.visited')).toBe(true);
  });

  it.each([
    ['towpath-end', 'the towpath arrival', { x: -85, y: 0.9, z: 6 }],
    ['barge-end', 'the barge berth', { x: -9, y: -1.1, z: 108 }],
  ])('%s: arriving by %s enters a volume wired to the visited latch', (node, _name, where) => {
    const g = play();
    g.stand(where);
    expect(g.entered).toContain(node);
    const graph = content.get('signal-graph', 'wendmouth-arrival');
    expect(graph.wires.map((w) => `${w.from}>${w.to}`)).toContain(`${node}.enter>arrived.set`);
    expect(g.facts.get('wendmouth.visited')).toBe(true);
  });

  it('keeps it when the player walks on: leaving the arrival never undoes the visit', () => {
    const g = play();
    g.stand({ x: 40, y: 0.9, z: 50 });
    expect(g.facts.get('wendmouth.visited')).toBe(true);
  });

  it('the scene places the arrival graph, and its nodes are not quest areas', () => {
    expect(scene.signals.map((s) => s.graph.id)).toContain('wendmouth-arrival');
    const graph = content.get('signal-graph', 'wendmouth-arrival');
    expect(graph.nodes.some((n) => n.id === 'bonded-warehouse' || n.id === 'undertow')).toBe(false);
  });
});

describe('the heist’s quest areas (mw-e39.21 areas bonded-warehouse and undertow)', () => {
  it('entering the Bonded Warehouse and the Undertow fires the volumes named as the quest areas', () => {
    const g = play();
    expect(g.entered).not.toContain('bonded-warehouse');
    g.stand({ x: 50, y: 0.9, z: 55 });
    expect(g.entered).toContain('bonded-warehouse');
    expect(g.entered).not.toContain('undertow');
    g.stand({ x: 86, y: -3.1, z: 36 });
    expect(g.entered).toContain('undertow');
  });

  it('the area volumes are observed and sit where the places are', () => {
    const graph = content.get('signal-graph', 'wendmouth-areas');
    expect(graph.nodes.map((n) => n.id)).toEqual(['bonded-warehouse', 'undertow']);
    for (const node of graph.nodes) expect(node.observed).toBe(true);
    expect(scene.signals.map((s) => s.graph.id)).toContain('wendmouth-areas');
  });
});
