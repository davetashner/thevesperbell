// mw-e25.11, mw-e25.12 and mw-e25.24 on real content, headless: the river below Briar Glen
// (scene briar-glen-river) as the game wires it. Walking from under the Miners' Bridge to the quay
// and the Millweir (mw-e25.24), the quay itself, its basin that freezes to walkable ice and the Stone
// Stair slide and climb (mw-e25.11), and the Millweir's sluice, walk and far bank (mw-e25.12).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  controllerTuningFor,
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  PLAYER_CONTROLLER_ID,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  applyStimulus,
  CharacterBreath,
  CharacterController,
  characterControllerSystem,
  DEFAULT_WATER_TUNING,
  fallDamageFraction,
  FakeCollisionWorld,
  giveBreath,
  interacted,
  layoutScene,
  LiquidIceComponent,
  LiquidVolumeComponent,
  levelOf,
  NavMesh,
  NavMeshQuery,
  teleportCommand,
  spawnCharacter,
  waterSystem,
  waterTraversal,
  waterVolumes,
  waterDepthAt,
  waterMode,
  followLiquidLevels,
  World,
  type CharacterInput,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { buildEnv, validateWorld } from '@tools/world/validate';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const HZ = 60;
type Input = ReturnType<typeof teleportCommand>;
/** A jog, m/s: slower than the player's run, so the 10 s bound holds for a walker who dawdles. */
const JOG_SPEED = 4;
const content = loadGameContent();
const [worldMap] = content.all('world');
const river = content.get('scene', 'briar-glen-river');
const bank = content.get('scene', 'under-the-bridge');
const briarwood = content.get('scene', 'briarwood');
const lock = content.get('scene', 'kestrel-lock');
const deepworks = content.get('scene', 'deepworks');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'briar-glen-river')));

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };
const roughClimber: NavAgent = { ...humanoid, maxClimbGrade: 2 };

type Scene = typeof river;
const spot = (scene: Scene, id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};
const route = (agent: NavAgent, from: string, to: string) =>
  query.findPath({ start: spot(river, from), goal: spot(river, to), agent, doors: () => 'open' });
/** Does the transition volume exist, tagged on its spawn, with its arrival in the target scene? */
const leadsTo = (from: Scene, id: string, to: Scene, spawn: string) => {
  const t = from.transitions.find((x) => x.id === id);
  expect(t, `${from.id}/${id}`).toMatchObject({ scene: { id: to.id }, spawn });
  expect(
    to.spawns.find((s) => s.id === spawn),
    `${to.id}/${spawn}`,
  ).toBeDefined();
  expect(from.spawns.find((s) => s.id === id)?.tags).toContain('transition');
};

/** Puts the player at `to` and lets the world settle (volumes see the controller's position). */
const teleport = (game: { world: World<Input>; player: EntityId }, to: Vec3): void => {
  game.world.step([teleportCommand(game.player, to)]);
  for (let i = 0; i < 3; i++) game.world.step([teleportCommand(game.player, to)]);
};

describe('the riverbank to the quay and the Millweir (mw-e25.24)', () => {
  it('AC-1: the riverbank under the bridge leads down to the quay and back', () => {
    leadsTo(bank, 'riverbank-down', river, 'arrive-from-under-the-bridge');
    leadsTo(river, 'path-up', bank, 'arrive-from-briar-glen-river');
  });

  it('AC-1: arriving from the bridge a walker reaches the quay, the Millweir and the towpath end on the navmesh', () => {
    for (const id of [
      'briar-glen-quay',
      'barge-berth',
      'sluice-wheel',
      'millweir',
      'towpath-gate',
    ]) {
      expect(route(walker, 'arrive-from-under-the-bridge', id).status, id).toBe('found');
    }
  });

  it('AC-1: the towpath ends at the towpath gate to Kestrel Lock (6 game hours) and arrives back at arrive-from-kestrel-lock', () => {
    leadsTo(river, 'towpath-gate', lock, 'arrive-from-briar-glen-river');
    expect(river.transitions.find((t) => t.id === 'towpath-gate')?.advanceMinutes).toBe(360);
    expect(river.spawns.find((s) => s.id === 'arrive-from-kestrel-lock')).toBeDefined();
    expect(river.spawns.find((s) => s.id === 'towpath-exit')).toBeUndefined();
    expect(river.transitions.map((t) => t.id).sort()).toEqual([
      'far-bank-gate',
      'path-up',
      'stone-stair-climb',
      'towpath-gate',
    ]);
    expect(route(walker, 'arrive-from-kestrel-lock', 'briar-glen-quay').status).toBe('found');
  });

  it('AC-1: under the bridge no longer has a direct towpath to Kestrel Lock: the way down is the riverbank path', () => {
    expect(bank.transitions.find((t) => t.id === 'towpath-down')).toBeUndefined();
    expect(bank.spawns.find((s) => s.id === 'arrive-from-kestrel-lock')).toBeUndefined();
    expect(bank.transitions.find((t) => t.id === 'riverbank-down')?.scene.id).toBe(
      'briar-glen-river',
    );
  });

  it('AC-2: under-the-bridge-quay, quay-millweir, millweir-kestrel-lock and sluice-walk list their transitions', () => {
    const edge = (id: string) => worldMap?.edges.find((e) => e.id === id);
    expect(edge('under-the-bridge-quay')?.transitions).toEqual([
      'under-the-bridge/riverbank-down',
      'briar-glen-river/path-up',
    ]);
    expect(edge('quay-millweir')?.transitions ?? []).toEqual([]);
    expect(edge('quay-millweir')?.notes).toMatch(/inside|walk inside/);
    expect(edge('millweir-kestrel-lock')?.transitions).toEqual([
      'briar-glen-river/towpath-gate',
      'kestrel-lock/towpath-up',
    ]);
    expect(edge('riverbank-lock-link')).toBeUndefined();
    expect(edge('sluice-walk')?.transitions).toEqual([
      'briar-glen-river/far-bank-gate',
      'briarwood/millweir-gate',
    ]);
    expect(worldMap?.nodes.find((n) => n.id === 'briar-glen-quay')?.scene?.id).toBe(
      'briar-glen-river',
    );
    expect(worldMap?.nodes.find((n) => n.id === 'millweir')?.scene?.id).toBe('briar-glen-river');
  });

  it('AC-2: the world map validates with the river built and the Millweir fact produced', () => {
    if (worldMap === undefined) throw new Error('no world map');
    const report = validateWorld(worldMap, buildEnv(content), content);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join('\n')).not.toContain('world.millweir.sluice-walk-open');
    expect(report.warnings.join('\n')).not.toContain('world.stone-stair.lowered');
  });
});

describe('Briar Glen Quay and the Stone Stair (mw-e25.11)', { timeout: 120_000 }, () => {
  it('the quay has moorings for Patient Ann, glenstone stacks, bollards, a crane and a toll shed', () => {
    const ids = new Set(river.spawns.map((s) => s.id));
    for (const id of ['patient-ann', 'barge-berth', 'quay-crane', 'toll-shed', 'toll-counter']) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(river.spawns.filter((s) => s.tags.includes('block-stack'))).toHaveLength(6);
    expect(river.spawns.filter((s) => s.tags.includes('bollard')).length).toBeGreaterThanOrEqual(6);
    expect(river.dressings.map((d) => d.model)).toContain('model-prop-wharf-crane-01');
  });

  it('the weir sluice gate model is unturned, so its front (planks between stone piers) faces the pond across the flow (mw-e25.30)', () => {
    const gate = river.dressings.find((d) => d.id === 'weir-sluice-gate');
    expect(gate?.turn).toBe(0);
    // The model is 1.79 wide (z) and 1.02 deep (x): unturned it spans the channel along z.
    expect(gate?.size[2]).toBeGreaterThan(gate?.size[0] ?? Infinity);
  });

  it('AC-1: the slide from the cutting hall lands at the quay within 10 s and sets the stair fact', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'stone-stair-foot');
    leadsTo(deepworks, 'quay-gate', river, 'arrive-from-deepworks');
    const deep = new NavMeshQuery(new NavMesh(content.get('navmesh', 'deepworks')));
    const head = deepworks.spawns.find((s) => s.id === 'stone-stair-head');
    const gate = deepworks.spawns.find((s) => s.id === 'quay-gate');
    if (head === undefined || gate === undefined) throw new Error('no stair head or gate');
    const result = deep.findPath({
      start: { x: head.at[0], y: head.at[1], z: head.at[2] },
      goal: { x: gate.at[0], y: gate.at[1], z: gate.at[2] },
      agent: walker,
      doors: () => 'open',
    });
    expect(result.status).toBe('found');
    const metres = (result.status === 'found' ? result.points : []).reduce(
      (sum, p, i, all) =>
        i === 0 ? 0 : sum + Math.hypot(p.x - (all[i - 1]?.x ?? 0), p.z - (all[i - 1]?.z ?? 0)),
      0,
    );
    expect(metres / JOG_SPEED).toBeLessThan(10); // seconds, at a jog
    // Landing on the quay writes the fact and keeps it.
    const game = createGameWorld<Input>(RAPIER, {
      seed: 1,
      hz: HZ,
      scene: 'briar-glen-river',
      magic: true,
    });
    expect(game.world.facts.get('world.stone-stair.lowered') ?? false).toBe(false);
    teleport(game, spot(river, 'arrive-from-deepworks'));
    expect(game.world.facts.get('world.stone-stair.lowered')).toBe(true);
    teleport(game, spot(river, 'player-start'));
    expect(game.world.facts.get('world.stone-stair.lowered')).toBe(true);
  });

  it('AC-2: a non-climber has no way up the slipway, a rough-stone climber does (edge)', () => {
    leadsTo(river, 'stone-stair-climb', deepworks, 'arrive-from-briar-glen-river');
    expect(route(walker, 'arrive-from-deepworks', 'stone-stair-climb').status).toBe('unreachable');
    expect(route(roughClimber, 'arrive-from-deepworks', 'stone-stair-climb').status).toBe('found');
    const edge = worldMap?.edges.find((e) => e.id === 'stone-stair');
    expect(edge?.kind).toBe('one-way');
    expect(edge?.transitions).toEqual([
      'deepworks/quay-gate',
      'briar-glen-river/stone-stair-climb',
    ]);
  });

  it('AC-3: a cold stimulus freezes the quay basin into ice (e03 rules)', ({ task }) => {
    markExercised(task, 'scene', 'briar-glen-river');
    const game = createGameWorld<Input>(RAPIER, {
      seed: 1,
      hz: HZ,
      scene: 'briar-glen-river',
      magic: true,
    });
    const basin = game.scene.spawns.find((s) => s.spawn.id === 'quay-basin')?.entity;
    if (basin === undefined) throw new Error('no basin');
    expect(
      game.world.get(basin, LiquidIceComponent)?.cells.some((c) => c.solid >= 0.1),
    ).toBeFalsy();
    for (let x = 30.5; x <= 40.5; x += 1) {
      applyStimulus(game.world, {
        shape: {
          kind: 'box',
          center: { x, y: -0.25, z: 12 },
          halfExtents: { x: 0.6, y: 1, z: 3.2 },
        },
        element: 'cold',
        intensity: 60,
      });
    }
    for (let tick = 0; tick < 5 * HZ; tick++) game.world.step();
    expect(game.world.get(basin, LiquidIceComponent)?.cells.some((c) => c.solid >= 0.1)).toBe(true);
  });
});

describe('the Millweir sluice walk (mw-e25.12)', { timeout: 120_000 }, () => {
  const play = () => {
    const game = createGameWorld<Input>(RAPIER, {
      seed: 1,
      hz: HZ,
      scene: 'briar-glen-river',
      magic: true,
    });
    const byId = new Map<string, EntityId>();
    for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
    const id = (name: string): EntityId => {
      const entity = byId.get(name);
      if (entity === undefined) throw new Error(`no spawn ${name}`);
      return entity;
    };
    const steps = (n: number) => {
      for (let i = 0; i < n; i++) game.world.step();
    };
    return { game, id, steps };
  };
  const stones = river.placements.filter(
    (p) => p.piece.id === 'platform' && p.at[1] === -2.5 && p.scale[1] === 0.5,
  );

  it('AC-1: toggling the sluice wheel drops the mill pond to its low state within 20 s and the stones stand clear', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'millweir-walk');
    const { game, id, steps } = play();
    const pond = id('mill-pond');
    const surface = () => {
      const volume = game.world.get(pond, LiquidVolumeComponent);
      if (volume === undefined) throw new Error('no pond');
      return levelOf(volume);
    };
    expect(stones.length).toBeGreaterThanOrEqual(10);
    const stoneTop = -2.5 + 0.5; // bed -2.5, boulders 0.5 m high
    expect(surface()).toBeGreaterThan(stoneTop); // submerged while the gate holds the water
    steps(2 * HZ);
    expect(surface()).toBeCloseTo(-0.25, 5); // the gate is shut: nothing drains
    game.world.events.emit(interacted, {
      actor: game.player,
      target: id('sluice-wheel'),
      verb: 'use',
      affordance: 0,
    });
    steps(20 * HZ);
    expect(surface()).toBeLessThan(-2.45); // the low state: the pond is down to its bed
    expect(surface()).toBeLessThan(stoneTop); // the boulders on the bed are exposed
    expect(game.world.facts.get('world.millweir.sluice-walk-open') ?? false).toBe(false);
  });

  it('AC-1: turning the sluice wheel back refills the pond; AC-2: full it must be swum, drained it is walked; AC-3: the swim follows the live level', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'millweir-walk');
    const { game, id, steps } = play();
    const tuning =
      controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)).water ??
      DEFAULT_WATER_TUNING;
    const layout = layoutScene(river, (kit) =>
      content.has('kit', kit) ? content.get('kit', kit) : undefined,
    );
    const volumes = waterVolumes(layout.regions, followLiquidLevels(game.world));
    const bed = { x: 120, y: -2.5, z: 15 };
    const mode = (load: 'light' | 'heavy') => waterMode(waterDepthAt(volumes, bed), load, tuning);
    const wheel = () => {
      game.world.events.emit(interacted, {
        actor: game.player,
        target: id('sluice-wheel'),
        verb: 'use',
        affordance: 0,
      });
    };
    steps(2 * HZ);
    expect(mode('light')).toBe('swim'); // full: a swim barrier
    expect(mode('heavy')).toBe('sink'); // armour still decides
    wheel();
    steps(22 * HZ);
    expect(mode('light')).toBe('dry'); // drained: walk the bed
    expect(mode('heavy')).toBe('dry');
    wheel();
    steps(22 * HZ);
    expect(mode('light')).toBe('swim'); // refilled
  });

  it('AC-1: the mill pond has two states and the wheel can be remote actuated (Mage Hand)', () => {
    const wheel = river.spawns.find((s) => s.id === 'sluice-wheel');
    expect(wheel?.properties).toMatchObject({ remoteActuatable: true });
    expect(river.spawns.find((s) => s.id === 'mill-pond')?.liquid?.drain).toMatchObject({
      open: false,
    });
  });

  it('AC-2: reaching the far bank by the walk, the stones or the pool sets the fact and it stays set', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'millweir-walk');
    for (const from of [
      { x: 150.75, y: 0.3, z: 32.5 }, // the foot of the walk's far stair
      { x: 126, y: 0.3, z: 31.5 }, // the stones' far landing
      { x: 162, y: 0.3, z: 31.5 }, // the pool's south ladder
    ]) {
      const { game, steps } = play();
      expect(game.world.facts.get('world.millweir.sluice-walk-open') ?? false).toBe(false);
      steps(4);
      expect(game.world.facts.get('world.millweir.sluice-walk-open') ?? false).toBe(false);
      teleport(game, from);
      steps(4);
      expect(game.world.facts.get('world.millweir.sluice-walk-open')).toBe(true);
      teleport(game, spot(river, 'player-start'));
      steps(4);
      expect(game.world.facts.get('world.millweir.sluice-walk-open')).toBe(true);
    }
  });

  it('AC-2: the far-bank gate leads on into the Briarwood and back', () => {
    leadsTo(river, 'far-bank-gate', briarwood, 'arrive-from-briar-glen-river');
    leadsTo(briarwood, 'millweir-gate', river, 'arrive-from-briarwood');
    const far = briarwood.spawns.find((s) => s.id === 'millweir-far-bank');
    expect(far).toBeDefined();
    expect(route(walker, 'arrive-from-briarwood', 'far-bank-gate').status).toBe('found');
  });

  it('AC-3: falling from the walk lands in deep water, costs no health and the swimmer reaches a ladder', () => {
    const tuning = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));
    const layout = layoutScene(river, (kit) =>
      content.has('kit', kit) ? content.get('kit', kit) : undefined,
    );
    const volumes = waterVolumes(layout.regions);
    const fall = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID).fall;
    const lower = river.regions.find((r) => r.id === 'lower-pool');
    const deck = river.surfaces.find((s) => s.id === 'sluice-walk');
    if (lower === undefined || deck === undefined) throw new Error('no pool or deck');
    const drop = 2 - lower.max[1];
    expect(fallDamageFraction(drop, fall)).toBe(0);
    expect(lower.max[1] - lower.min[1]).toBeGreaterThanOrEqual(fall.deepWater);
    const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
    for (const load of ['light', 'heavy'] as const) {
      const sim = new World<CharacterInput>({ seed: 7, hz: HZ });
      sim.register(CharacterController, CharacterBreath);
      const entity = spawnCharacter(sim, v(152.5, 1.9, 15.25)); // over the gap, off the deck's east edge
      giveBreath(sim, entity, tuning.water ?? DEFAULT_WATER_TUNING, HZ);
      sim.addSystem(
        characterControllerSystem<CharacterInput>({
          collision: new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? [])),
          tuning,
          hooks: [waterTraversal({ volumes, loadClass: () => load })],
          input: (inputs) => inputs[0],
        }),
      );
      sim.addSystem(waterSystem<CharacterInput>({ volumes, tuning, loadClass: () => load }));
      const state = () => {
        const s = sim.get(entity, CharacterController);
        if (s === undefined) throw new Error('no character');
        return s;
      };
      const ladder = v(162, 0, 1.2);
      const toward = (to: Vec3, move: number): CharacterInput => ({
        actions: {
          move: { x: 0, y: move },
          jump: { pressed: false, held: false },
          sprint: { pressed: false, held: true },
          crouch: { pressed: false, held: false },
        },
        cameraYaw: Math.atan2(-(to.x - state().position.x), -(to.z - state().position.z)),
      });
      for (let i = 0; i < 2 * HZ; i++) sim.step([toward(ladder, 0)]);
      expect(state().position.y).toBeLessThan(lower.max[1]); // in the pool
      let reached = false;
      for (let i = 0; i < 20 * HZ && !reached; i++) {
        sim.step([toward(ladder, 1)]);
        const { x, z } = state().position;
        reached = Math.hypot(x - ladder.x, z - ladder.z) < 1.2;
      }
      expect(reached, load).toBe(true);
      expect(sim.get(entity, CharacterBreath)?.air ?? 0).toBeGreaterThan(0);
    }
  });
});
