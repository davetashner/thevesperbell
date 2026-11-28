// mw-e24.10 on real content, headless: the cistern route under the Glen Well. The Glen Well's shaft in
// briar-glen-green (an echo volume, the ladder, the loose rung and the grate into the old tunnel)
// and the cistern under Bellwater Priory's garden (the well end, the flooded chamber, the stub
// junctions and the stair up to the sealed vestibule), each loaded the way the game wires it.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  addPhysicsObject,
  addProperties,
  applyStimulus,
  CharacterController,
  DoorComponent,
  ECHO_TAG,
  fallDamageFraction,
  healthOf,
  interacted,
  LANDING_NOISE_KINDS,
  LiquidIceComponent,
  NavMesh,
  NavMeshQuery,
  noiseEmitted,
  PlayerLook,
  teleportCommand,
  type ActionFrame,
  type BodyShape,
  type EntityId,
  type NoiseEvent,
  type QuestRuntime,
  type World,
} from '@sim/index';
import { installFactRegistry } from '../../src/game/facts';
import { RumourBook, rumourFactKey, rumoursOf } from '../../src/game/rumours/rumours';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const HZ = 60;
const content = loadGameContent();
const green = content.get('scene', 'briar-glen-green');
const priory = content.get('scene', 'bellwater-priory');
const [worldMap] = content.all('world');
type Input = ActionFrame | ReturnType<typeof teleportCommand>;
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
const v = (x: number, y: number, z: number) => ({ x, y, z });

type Scene = typeof green;
const spot = (scene: Scene, id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return v(spawn.at[0], spawn.at[1], spawn.at[2]);
};

function play(scene: string) {
  const game = createGameWorld<Input>(RAPIER, { seed: 5, hz: HZ, scene, magic: true });
  const sim = game.world as unknown as World<never>;
  const id = (name: string): EntityId => {
    const found = game.scene.spawns.find((s) => s.spawn.id === name)?.entity;
    if (found === undefined) throw new Error(`no spawn ${name}`);
    return found;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) game.world.step([IDLE]);
  };
  const teleport = (to: { x: number; y: number; z: number }) => {
    for (let i = 0; i < 4; i++) game.world.step([teleportCommand(game.player, to)]);
  };
  const player = () => {
    const state = sim.get(game.player, CharacterController);
    if (state === undefined) throw new Error('no player');
    return state;
  };
  return { game, sim, id, steps, teleport, player };
}

// Each case builds the whole Market Green scene (createGameWorld); under coverage that runs close to
// the 30 s default, so these whole-scene suites take the 60 s used elsewhere (knot-outer, mw-e41.33).
describe('the Glen Well shaft (mw-e24.10)', { timeout: 60_000 }, () => {
  it('AC-1: any object dropped into the well lands twice, the echo about 0.4 s after the landing', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-green');
    const shapes: readonly [string, BodyShape, number][] = [
      ['stone', { kind: 'sphere', radius: 0.08 }, 0.4],
      ['crate', { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) }, 6],
      ['bucket', { kind: 'capsule', halfHeight: 0.1, radius: 0.12 }, 1.5],
    ];
    for (const [name, shape, weight] of shapes) {
      const { sim, steps } = play('briar-glen-green');
      const heard: NoiseEvent[] = [];
      sim.events.on(noiseEmitted, (n) => {
        if (LANDING_NOISE_KINDS.includes(n.kind) && n.position.y < -6) heard.push(n);
      });
      const thing = sim.spawn();
      addProperties(sim, thing, { weight, material: 'stone' });
      steps(1);
      addPhysicsObject(sim, thing, { shape, position: v(14, 2, 48) });
      steps(4 * HZ);
      const landing = heard.find((n) => n.tags?.includes(ECHO_TAG) !== true);
      const echo = heard.find((n) => n.tags?.includes(ECHO_TAG) === true);
      expect(landing, name).toBeDefined();
      expect(echo, name).toBeDefined();
      const gap = ((echo?.tick ?? 0) - (landing?.tick ?? 0)) / HZ;
      expect(gap, name).toBeCloseTo(0.4, 2);
      expect(echo?.entity, name).toBe(thing);
      expect(echo?.loudness ?? 0, name).toBeLessThan(landing?.loudness ?? 0);
    }
  });

  it('AC-1: a landing outside the shaft has no echo', () => {
    const { sim, steps } = play('briar-glen-green');
    const heard: NoiseEvent[] = [];
    sim.events.on(noiseEmitted, (n) => heard.push(n));
    const thing = sim.spawn();
    addProperties(sim, thing, { weight: 6, material: 'stone' });
    steps(1);
    addPhysicsObject(sim, thing, {
      shape: { kind: 'box', halfExtents: v(0.2, 0.2, 0.2) },
      position: v(10, 3, 52),
    });
    steps(2 * HZ);
    expect(heard.some((n) => n.entity === thing)).toBe(true);
    expect(heard.some((n) => n.tags?.includes(ECHO_TAG) === true)).toBe(false);
  });

  it('AC-3: dropping down the shaft from the coping hurts on landing but never kills from full health (edge)', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-green');
    const fall = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID).fall;
    const foot = spot(green, 'glen-well-shaft-foot');
    const rim = 1; // the coping's top
    expect(fallDamageFraction(rim + 1.8 - foot.y, fall)).toBeLessThan(1); // even counting a jump
    const { game, sim, steps, teleport, player } = play('briar-glen-green');
    const heard: NoiseEvent[] = [];
    sim.events.on(noiseEmitted, (n) => {
      if (n.entity === game.player) heard.push(n);
    });
    const before = healthOf(sim, game.player);
    expect(before?.current).toBe(before?.max);
    teleport(v(13.85, rim + 0.1, 48));
    steps(3 * HZ);
    expect(player().position.y).toBeCloseTo(foot.y, 0);
    const after = healthOf(sim, game.player)?.current ?? 0;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before?.current ?? 0);
    // The landing echoes up the shaft like anything else that lands in it.
    expect(heard.some((n) => n.kind === 'landing' && n.tags?.includes(ECHO_TAG) === true)).toBe(
      true,
    );
  });

  it('AC-3: the ladder climbs from the shaft foot back up and out over the coping', () => {
    const { game, sim, steps, teleport, player } = play('briar-glen-green');
    teleport(v(13.85, -7.9, 48));
    steps(HZ);
    const up = actionFrame({
      move: actionVector(0, 1),
      look: actionVector(0, 0),
      buttons: () => actionButton(false, false, false),
    });
    sim.set(game.player, PlayerLook, { yaw: -Math.PI / 2, pitch: 0 }); // facing the ladder, east
    let top = -Infinity;
    for (let i = 0; i < 15 * HZ; i++) {
      game.world.step([up]);
      top = Math.max(top, player().position.y);
    }
    expect(top).toBeGreaterThan(0.9);
    expect(player().position.y).toBeGreaterThan(-0.1); // out of the shaft
  });

  it('the loose rung at the shaft foot raises the grate into the tunnel and writes the shortcut fact', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'glen-well-shaft');
    const { game, sim, id, steps } = play('briar-glen-green');
    const grate = id('glen-well-grate');
    const open = () => (sim.get(grate, DoorComponent)?.openness ?? 0) >= 1;
    steps(HZ);
    expect(open()).toBe(false);
    expect(sim.facts.get('world.glen-well.rung-pulled') ?? false).toBe(false);
    const pull = () => {
      sim.events.emit(interacted, {
        actor: game.player,
        target: id('glen-well-rung'),
        verb: 'use',
        affordance: 0,
      });
    };
    pull();
    steps(4 * HZ);
    expect(open()).toBe(true);
    expect(sim.facts.get('world.glen-well.rung-pulled')).toBe(true);
    pull(); // pushing the rung back leaves the grate up
    steps(4 * HZ);
    expect(open()).toBe(true);
  });

  it('the shaft and tunnel cross to the cistern and back, as the world map says', () => {
    const edge = worldMap?.edges.find((e) => e.id === 'glen-well-cistern');
    expect(edge?.transitions).toEqual([
      'briar-glen-green/well-tunnel',
      'bellwater-priory/well-tunnel',
    ]);
    expect(green.transitions.find((t) => t.id === 'well-tunnel')).toMatchObject({
      scene: { id: 'bellwater-priory' },
      spawn: 'arrive-from-briar-glen-green',
    });
    expect(priory.transitions.find((t) => t.id === 'well-tunnel')).toMatchObject({
      scene: { id: 'briar-glen-green' },
      spawn: 'arrive-from-bellwater-priory',
    });
    const humanoid = deriveNavAgent(
      resolveLocomotion(content.get('locomotion', 'humanoid'), content),
    );
    const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'briar-glen-green')));
    // From the shaft foot (reached by the ladder or the drop) through the raised grate to the tunnel's end.
    const path = query.findPath({
      start: spot(green, 'glen-well-shaft-foot'),
      goal: spot(green, 'well-tunnel'),
      agent: humanoid,
      doors: () => 'open',
    });
    expect(path.status).toBe('found');
  });
});

// Each case builds the whole Market Green scene (createGameWorld); under coverage that runs close to
// the 30 s default, so these whole-scene suites take the 60 s used elsewhere (knot-outer, mw-e41.33).
describe('the cistern under the priory (mw-e24.10)', { timeout: 60_000 }, () => {
  const humanoid = deriveNavAgent(
    resolveLocomotion(content.get('locomotion', 'humanoid'), content),
  );
  const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };
  const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'bellwater-priory')));

  it('AC-2: entering the cistern from the well sets well.tunnel.found and resolves rumour 4', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'bellwater-cistern');
    const { game, sim, steps, teleport } = play('bellwater-priory');
    installFactRegistry(sim.facts, content, true);
    const rumours = rumoursOf(content);
    const rumour = rumours.find((r) => r.id.startsWith('rumor-04-'));
    if (rumour === undefined) throw new Error('no rumour 4');
    expect(rumour.target).toBe('place-glen-well');
    const book = new RumourBook({
      world: sim,
      rumours,
      quests: undefined as QuestRuntime | undefined,
      player: () => game.player,
    });
    book.hear(rumour.id);
    steps(10);
    expect(sim.facts.get('well.tunnel.found') ?? false).toBe(false);
    teleport(spot(priory, 'arrive-from-briar-glen-green'));
    steps(10);
    expect(sim.facts.get('well.tunnel.found')).toBe(true);
    expect(sim.facts.get(rumourFactKey(rumour.id, 'investigated'))).toBe(true);
    // Leaving keeps it.
    teleport(spot(priory, 'arrive-from-briarwood'));
    steps(10);
    expect(sim.facts.get('well.tunnel.found')).toBe(true);
  });

  it('AC-2: the cistern runs from the well end past the flooded chamber to the stair, and the nave door still bars it from the priory', () => {
    const route = (agent: NavAgent, from: string, to: string, doors: 'open' | 'locked') =>
      query.findPath({
        start: spot(priory, from),
        goal: spot(priory, to),
        agent,
        doors: () => doors,
      }).status;
    for (const id of [
      'cistern-jail-drain',
      'cistern-goblin-tunnels',
      'cistern-stair-foot',
      'cistern',
    ]) {
      expect(route(walker, 'arrive-from-briar-glen-green', id, 'locked'), id).toBe('found');
    }
    expect(route(walker, 'arrive-from-briar-glen-green', 'priory-nave', 'locked')).toBe(
      'unreachable',
    );
    expect(route(walker, 'arrive-from-briarwood', 'cistern-well-end', 'locked')).toBe(
      'unreachable',
    );
  });

  it('AC-4: the flooded chamber, frozen by a cold stimulus, becomes ice the player stands on', ({
    task,
  }) => {
    markExercised(task, 'scene', 'bellwater-priory');
    const pool = priory.spawns.find((s) => s.id === 'cistern-flood');
    const water = priory.regions.find((r) => r.id === 'cistern-flood');
    if (pool?.liquid === undefined || water === undefined) throw new Error('no flooded chamber');
    const surface = pool.at[1] + pool.liquid.depth;
    expect(water.max[1]).toBeCloseTo(surface, 5);
    const middle = v(pool.at[0], surface + 0.2, pool.at[2]);
    // Without the cold the player goes into the water.
    {
      const { steps, teleport, player } = play('bellwater-priory');
      teleport(middle);
      steps(2 * HZ);
      expect(player().position.y).toBeLessThan(surface - 0.5);
    }
    const { sim, id, steps, teleport, player } = play('bellwater-priory');
    const flood = id('cistern-flood');
    const [x0, , z0] = pool.at;
    const [w, , d] = pool.liquid.size;
    for (let x = x0 - w / 2 + 0.5; x <= x0 + w / 2; x += 1) {
      applyStimulus(sim, {
        shape: { kind: 'box', center: v(x, surface, z0), halfExtents: v(0.6, 1, d / 2) },
        element: 'cold',
        intensity: 60,
      });
    }
    steps(5 * HZ);
    const cells = sim.get(flood, LiquidIceComponent)?.cells ?? [];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.solid >= 0.1)).toBe(true);
    teleport(middle);
    steps(2 * HZ);
    expect(player().position.y).toBeGreaterThan(surface - 0.2);
  });
});
