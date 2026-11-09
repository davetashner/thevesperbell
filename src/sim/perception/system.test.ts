// The perception system (mw-e11.5): agents evaluate their senses from their sense profiles against
// the real world state (character bodies, line of sight, light, propagated noise), on a staggered
// schedule within a work-unit budget, and raise only percepts.
import type { ControllerTuning, Frozen, NavAgent, SenseProfile } from '@content/index';
import { describe, expect, it } from 'vitest';
import { box, type GreyboxBox } from '../character/greybox';
import {
  DEFAULT_STEALTH_TUNING,
  initialCharacterState,
  type CharacterState,
} from '../character/controller';
import { CharacterController, CharacterTuning } from '../character/system';
import { CombatFacingComponent } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CreatureNavComponent, CreatureSensesComponent } from '../creatures/components';
import { registerCreatureComponents } from '../creatures/spawn';
import { cos, sin } from '../math';
import { buildSoundGraph } from '../noise/graph';
import { distanceGainDb } from '../noise/propagation';
import { emitNoise, installNoisePropagation, NoiseListenerComponent } from '../noise/system';
import { FakeSightWorld } from '../sight/fake-sight-world';
import { LineOfSight } from '../sight/line-of-sight';
import { partial } from '../sight/occlusion';
import { VisibilityProfileComponent } from '../stealth/self-visibility';
import { hashWorld } from '../snapshot';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { entitySource, perceived, type Percept, type PerceptionReport } from './percept';
import {
  PerceptionAgentComponent,
  perceptionBudgetUnits,
  perceptionSystem,
  PERCEPTION_UNITS_PER_MS,
  type PerceptionOptions,
  type TargetSighting,
} from './system';
import { touchPercept } from './touch';
import { DEFAULT_PERCEPTION_TUNING } from './tuning';

const CONTROLLER: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  stealth: DEFAULT_STEALTH_TUNING,
};

/** The humanoid sense profile (content `sense/humanoid.json`). */
const SIGHT = {
  nearRange: 8,
  farRange: 20,
  primaryHalfAngle: 35,
  peripheralHalfAngle: 80,
  verticalHalfAngle: 40,
  darkVision: 0.2,
  detectionSpeed: 1,
};
const HEARING = { thresholdDb: 30, range: 25 };
const HUMANOID: Frozen<SenseProfile> = { sight: SIGHT, hearing: HEARING };
/** awareness ≥ 0.3 makes an Unaware creature Suspicious (behaviour tuning `suspiciousAt`). */
const SUSPICIOUS_AT = 0.3;

const NORTH: Vec3 = { x: 0, y: 0, z: 1 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const DEG = Math.PI / 180;
/** Ticks in which every agent is evaluated once at 60 Hz and 10 Hz perception. */
const PERIOD = 6;

const lit = (level: number) => ({ levelAt: () => level });

/** A point on the ground `metres` away, `degrees` off +z toward +x. */
const ahead = (metres: number, degrees = 0): Vec3 => ({
  x: metres * sin(degrees * DEG),
  y: 0,
  z: metres * cos(degrees * DEG),
});

interface Setup extends Partial<PerceptionOptions> {
  readonly walls?: readonly GreyboxBox[];
}

function setup(options: Setup = {}) {
  const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
  world.register(CharacterController, CharacterTuning);
  const reports: PerceptionReport[] = [];
  world.events.on(perceived, (report) => reports.push(report));
  const system = perceptionSystem(world, {
    lineOfSight: new LineOfSight({ world: new FakeSightWorld(options.walls ?? []) }),
    light: lit(1),
    ...options,
  });
  world.addSystem(system);
  const step = (ticks = PERIOD) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  return { world, system, reports, step };
}

function addPlayer(world: World<never>, feet: Vec3, state: Partial<CharacterState> = {}) {
  const id = world.spawn();
  world.add(id, CharacterController, { ...initialCharacterState(feet), ...state });
  world.add(id, CharacterTuning, CONTROLLER);
  return id;
}

function addAgent(
  world: World<never>,
  senses: Frozen<SenseProfile> = HUMANOID,
  at: Vec3 = ORIGIN,
  facing: Vec3 = NORTH,
): EntityId {
  const id = world.spawn();
  world.add(id, CreatureSensesComponent, senses);
  world.add(id, PlacementComponent, { ...at, radius: 0.4 });
  world.add(id, CombatFacingComponent, { facing });
  world.add(id, CreatureNavComponent, { height: 1.8, radius: 0.4 } as Frozen<NavAgent>);
  return id;
}

/** Every percept `agent` reported. */
const perceptsOf = (reports: readonly PerceptionReport[], agent: EntityId): Percept[] =>
  reports.filter((r) => r.agent === agent).flatMap((r) => r.percepts);

describe('perception: sight (mw-e11.5)', () => {
  it('AC-1: a fully lit, standing target 10 m away and 20° off-axis is seen with strength > 0.5', () => {
    const { world, reports, step } = setup();
    const player = addPlayer(world, ahead(10, 20));
    const guard = addAgent(world);
    step();
    const [seen, ...rest] = perceptsOf(reports, guard);
    expect(rest).toEqual([]);
    expect(seen).toMatchObject({
      source: `entity:${String(player)}`,
      kind: 'seen-target',
      sense: 'sight',
      position: ahead(10, 20),
      certainty: 1,
    });
    expect(seen?.strength).toBeGreaterThan(0.5);
  });

  it('AC-2: the same target 120° off-axis is outside the peripheral cone and costs no sight lines', () => {
    const { world, system, reports, step } = setup();
    addPlayer(world, ahead(10, 120));
    const guard = addAgent(world);
    step();
    expect(perceptsOf(reports, guard)).toEqual([]);
    expect(reports.filter((r) => r.agent === guard)).toHaveLength(1);
    expect(system.lastUnits).toBe(0); // the guard was evaluated on an earlier tick: 1 unit, no rays
    const units: number[] = [];
    for (let i = 0; i < PERIOD; i++) {
      world.step();
      units.push(system.lastUnits);
    }
    expect(units.toSorted()).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('AC-3: a target in the cone behind a wall is not seen', () => {
    const wall = box({ x: -3, y: 0, z: 4 }, { x: 3, y: 3, z: 4.5 });
    const sightings: TargetSighting[] = [];
    const { world, reports, step } = setup({
      walls: [wall],
      trace: { sighted: (_, s) => sightings.push(s) },
    });
    addPlayer(world, ahead(10));
    const guard = addAgent(world);
    step();
    expect(perceptsOf(reports, guard)).toEqual([]);
    expect(sightings).toHaveLength(1);
    expect(sightings[0]).toMatchObject({ cone: { zone: 'primary' }, percept: undefined });
    expect(sightings[0]?.terms.los).toBe(0);
  });

  it('AC-4: a crouched, still target in deep shadow 15 m away registers below the Suspicious threshold', () => {
    const sightings: TargetSighting[] = [];
    const { world, reports, step } = setup({
      light: lit(0.02),
      trace: { sighted: (_, s) => sightings.push(s) },
    });
    addPlayer(world, ahead(15), { crouched: true });
    const guard = addAgent(world);
    step();
    const [seen] = perceptsOf(reports, guard);
    expect(sightings[0]?.terms.value).toBeLessThan(0.1);
    expect(seen?.strength).toBeGreaterThan(0);
    expect(seen?.strength).toBeLessThan(SUSPICIOUS_AT);
  });

  it('needs light the agent can see in: dark vision lifts darkness, none sees nothing', () => {
    const { world, reports, step } = setup({ light: lit(0) });
    addPlayer(world, ahead(5));
    const blind = addAgent(world, { sight: { ...SIGHT, darkVision: 0 } }, { x: 0, y: 0, z: 0 });
    const owl = addAgent(world, { sight: { ...SIGHT, darkVision: 1 } }, { x: 0.01, y: 0, z: 0 });
    step();
    expect(perceptsOf(reports, blind)).toEqual([]);
    expect(perceptsOf(reports, owl)[0]?.strength).toBeCloseTo(0.8, 2); // still: motion term 0.8
  });

  it('a dark target against bright light behind it stands out as a silhouette', () => {
    const sightings: TargetSighting[] = [];
    const { world, step } = setup({
      light: { levelAt: (p: Vec3) => (p.z > 10.5 ? 1 : 0.05) },
      trace: { sighted: (_, s) => sightings.push(s) },
    });
    addPlayer(world, ahead(10));
    addAgent(world);
    step();
    expect(sightings[0]?.terms.silhouetted).toBe(true);
  });

  it('reads partial cover from occlusion volumes and the target’s visibility profile', () => {
    const sightings: TargetSighting[] = [];
    const { world, step } = setup({
      volumes: () => [
        { kind: 'sphere', center: { x: 0, y: 1, z: 6 }, radius: 1.5, occlusion: partial(0.5) },
      ],
      trace: { sighted: (_, s) => sightings.push(s) },
    });
    world.register(VisibilityProfileComponent);
    const player = addPlayer(world, ahead(10));
    world.add(player, VisibilityProfileComponent, { cloaked: true });
    addAgent(world);
    step();
    expect(sightings[0]?.terms).toMatchObject({ los: 0.5, profile: 0.7 });
    expect(sightings[0]?.percept?.certainty).toBe(0.5);
  });

  it('sees from its eye: an agent whose eye is inside the target still sees it', () => {
    const { world, reports, step } = setup();
    // The guard's eye is at 0.9 × 1.8 m; the target's chest is 2/3 of its 1.8 m capsule above its feet.
    addPlayer(world, { x: 0, y: 1.62 - 1.2, z: 0 });
    const guard = addAgent(world);
    step();
    // It also feels the target it stands inside (touch, mw-e11.6).
    expect(perceptsOf(reports, guard).map((p) => p.kind)).toEqual(['seen-target', 'touched']);
  });

  it('perceives only targets with a body it can read, never itself', () => {
    const { world, reports, step } = setup({
      targets: (w) => [guard, untuned, ...w.query(CharacterController).ids()],
    });
    const untuned = world.spawn();
    world.add(untuned, CharacterController, initialCharacterState(ahead(5)));
    const guard = addAgent(world);
    const special = {
      'life-sense': {
        range: 20,
        minStrength: 0,
        requiresLineOfSight: false,
        requiresMovement: false,
      },
    };
    world.add(guard, CreatureSensesComponent, { ...HUMANOID, special });
    world.add(guard, CharacterController, initialCharacterState(ORIGIN));
    world.add(guard, CharacterTuning, CONTROLLER);
    step();
    expect(perceptsOf(reports, guard)).toEqual([]); // the untuned body has no movement profile
  });

  it('uses a fallback controller tuning for targets without their own', () => {
    const { world, reports, step } = setup({ controller: CONTROLLER });
    const target = world.spawn();
    world.add(target, CharacterController, initialCharacterState(ahead(5)));
    const guard = addAgent(world);
    step();
    expect(perceptsOf(reports, guard).map((p) => p.source)).toEqual([`entity:${String(target)}`]);
  });

  it('sees anomalies in view by the light on them', () => {
    const wall = box({ x: 2, y: 0, z: 2 }, { x: 4, y: 3, z: 3 });
    const { world, reports, step } = setup({
      walls: [wall],
      light: { levelAt: (p: Vec3) => (p.x < -1 ? 0 : 1) },
      anomalies: () => [
        { id: 'open-door', position: ahead(4), salience: 0.5 },
        { id: 'behind', position: ahead(4, 180), salience: 1 },
        { id: 'walled', position: { x: 6, y: 1, z: 5 }, salience: 1 },
        { id: 'in-the-dark', position: { x: -3, y: 1, z: 6 }, salience: 1 },
      ],
    });
    const guard = addAgent(world, { sight: { ...SIGHT, darkVision: 0 } });
    step();
    expect(perceptsOf(reports, guard)).toEqual([
      {
        source: 'anomaly:open-door',
        kind: 'seen-anomaly',
        sense: 'sight',
        position: ahead(4),
        strength: 0.5,
        certainty: 1,
      },
    ]);
  });

  it('defaults to every character-controlled body as a target, and none without that component', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
    const reports: PerceptionReport[] = [];
    world.events.on(perceived, (report) => reports.push(report));
    const lineOfSight = new LineOfSight({ world: new FakeSightWorld() });
    world.addSystem(perceptionSystem(world, { lineOfSight, light: lit(1) }));
    addAgent(world);
    for (let i = 0; i < PERIOD; i++) world.step();
    expect(reports.map((r) => r.percepts)).toEqual([[]]);
  });

  it('gives an agent without a nav agent or a facing a default eye height, looking along +z', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    world.register(
      CreatureSensesComponent,
      PlacementComponent,
      CharacterController,
      CharacterTuning,
    );
    const reports: PerceptionReport[] = [];
    world.events.on(perceived, (report) => reports.push(report));
    const sightings: TargetSighting[] = [];
    world.addSystem(
      perceptionSystem(world, {
        lineOfSight: new LineOfSight({ world: new FakeSightWorld() }),
        light: lit(1),
        trace: { sighted: (_, s) => sightings.push(s) },
      }),
    );
    addPlayer(world, ahead(6));
    const guard = world.spawn();
    world.add(guard, CreatureSensesComponent, HUMANOID);
    world.add(guard, PlacementComponent, { ...ORIGIN, radius: 0 });
    for (let i = 0; i < PERIOD; i++) world.step();
    expect(sightings).toHaveLength(1);
    // Eye 1.6 m up, chest 1.2 m up, 6 m ahead.
    expect(sightings[0]?.cone.distance).toBeCloseTo(Math.sqrt(36 + 0.16), 9);
  });
});

describe('perception: hearing (mw-e11.5)', () => {
  /** Two rooms side by side through a stone-default wall, with a doorway at the north end. */
  const GRAPH = buildSoundGraph({
    rooms: [
      { id: 'west', min: { x: -10, y: 0, z: -5 }, max: { x: 0, y: 3, z: 5 } },
      { id: 'east', min: { x: 0, y: 0, z: -5 }, max: { x: 10, y: 3, z: 5 } },
    ],
    portals: [{ id: 'doorway', rooms: ['west', 'east'], position: { x: 0, y: 1, z: 4 } }],
  });
  const SOURCE: Vec3 = { x: -5, y: 0, z: -4 };
  const LISTENER: Vec3 = { x: 5, y: 0, z: -4 };
  // Through the doorway: two legs of √(25 + 1 + 64) m, −20·log10 of their sum; the wall loses 30 dB.
  const ROUTE_LOSS = -distanceGainDb(2 * Math.sqrt(90));

  function hearingWorld(trace: PerceptionOptions['trace'] = {}) {
    const s = setup({ trace });
    installNoisePropagation(s.world, { graph: GRAPH });
    return s;
  }

  it('AC-5: a 45 dB noise heard through a doorway carries the doorway’s position, not the source', () => {
    const levels: number[] = [];
    const { world, reports, step } = hearingWorld({ heard: (_, h) => levels.push(h.level) });
    const guard = addAgent(world, HUMANOID, LISTENER);
    step(1); // the guard becomes a listener
    expect(world.get(guard, NoiseListenerComponent)).toEqual(HEARING);
    emitNoise(world, { position: SOURCE, loudness: 45 + ROUTE_LOSS, kind: 'break' });
    step();
    expect(levels[0]).toBeCloseTo(45, 9);
    const [heard, ...rest] = perceptsOf(reports, guard);
    expect(rest).toEqual([]);
    expect(heard).toMatchObject({
      source: 'sound:break',
      kind: 'heard-noise',
      sense: 'hearing',
      position: { x: 0, y: 1, z: 4 },
      certainty: DEFAULT_PERCEPTION_TUNING.hearing.portalCertainty,
    });
    expect(heard?.strength).toBeCloseTo(0.55, 9);
    expect(heard?.position).not.toEqual(SOURCE);
  });

  it('hears every noise since its last evaluation, in order', () => {
    const { world, reports, step } = hearingWorld();
    const guard = addAgent(world, HUMANOID, LISTENER);
    step(1);
    emitNoise(world, { position: { x: 6, y: 0, z: -4 }, loudness: 60, kind: 'step' });
    emitNoise(world, { position: { x: 5, y: 0, z: 0 }, loudness: 70, kind: 'cough' });
    step();
    expect(perceptsOf(reports, guard).map((p) => [p.source, p.certainty])).toEqual([
      ['sound:step', 1],
      ['sound:cough', 1],
    ]);
  });

  it('mw-e09.5: it notices its target’s footsteps and landings, never another creature’s', () => {
    const { world, reports, step } = hearingWorld();
    const guard = addAgent(world, HUMANOID, LISTENER);
    const colleague = addAgent(world, HUMANOID, { x: 6, y: 0, z: -4 });
    const player = addPlayer(world, { x: 8, y: 0, z: -4 });
    step(1);
    const at = { x: 6, y: 0, z: -4 };
    const walker = (who: EntityId | null, kind: string): void => {
      emitNoise(world, { position: at, loudness: 60, kind, entity: who, source: who });
    };
    walker(colleague, 'footstep');
    walker(colleague, 'landing');
    walker(null, 'footstep');
    walker(colleague, 'door');
    walker(player, 'footstep');
    walker(player, 'landing');
    step();
    expect(perceptsOf(reports, guard).map((p) => p.source)).toEqual([
      'entity:' + String(colleague), // the door it slammed is still a sound
      'entity:' + String(player),
      'entity:' + String(player),
    ]);
  });

  it('keeps each agent’s listener in step with its hearing', () => {
    const { world, step } = hearingWorld();
    const guard = addAgent(world, HUMANOID, LISTENER);
    step(1);
    world.add(guard, CreatureSensesComponent, {
      ...HUMANOID,
      hearing: { thresholdDb: 20, range: 25 },
    });
    step(1);
    expect(world.get(guard, NoiseListenerComponent)).toEqual({ thresholdDb: 20, range: 25 });
    world.add(guard, CreatureSensesComponent, {
      ...HUMANOID,
      hearing: { thresholdDb: 20, range: 9 },
    });
    step(1);
    expect(world.get(guard, NoiseListenerComponent)).toEqual({ thresholdDb: 20, range: 9 });
    world.add(guard, CreatureSensesComponent, { sight: SIGHT });
    step(1);
    expect(world.get(guard, NoiseListenerComponent)).toBeUndefined();
    step(1);
    expect(world.get(guard, NoiseListenerComponent)).toBeUndefined();
  });

  it('an agent hears only once perception has set it up', () => {
    const { world, reports, step } = hearingWorld();
    const guard = addAgent(world, HUMANOID, LISTENER);
    world.add(guard, NoiseListenerComponent, HEARING); // listening before perception saw it
    emitNoise(world, { position: LISTENER, loudness: 80, kind: 'early' });
    step(1);
    emitNoise(world, { position: LISTENER, loudness: 80, kind: 'late' });
    step();
    expect(perceptsOf(reports, guard).map((p) => p.source)).toEqual(['sound:late']);
  });

  it('ignores listeners that are not creatures, and noises an agent went deaf to before it listened', () => {
    const { world, reports, step } = hearingWorld();
    const microphone = world.spawn();
    world.add(microphone, NoiseListenerComponent, { thresholdDb: 0, range: 100 });
    world.add(microphone, PlacementComponent, { ...LISTENER, radius: 0 });
    const guard = addAgent(world, HUMANOID, LISTENER);
    step(1);
    emitNoise(world, { position: LISTENER, loudness: 80, kind: 'shout' });
    world.add(guard, CreatureSensesComponent, { sight: SIGHT }); // deaf before its next evaluation
    step();
    expect(perceptsOf(reports, guard)).toEqual([]);
  });
});

describe('perception: special senses (mw-e11.5)', () => {
  it('senses life through walls on registered channels, and nothing on channels without a handler', () => {
    const wall = box({ x: -3, y: 0, z: 2 }, { x: 3, y: 3, z: 2.5 });
    const { world, reports, step } = setup({ walls: [wall] });
    const player = addPlayer(world, ahead(5));
    const sense = {
      range: 10,
      minStrength: 0.1,
      requiresLineOfSight: false,
      requiresMovement: false,
    };
    const undead = addAgent(world, {
      sight: SIGHT,
      special: { 'life-sense': sense, 'magic-sense': sense },
    });
    step();
    const found = perceptsOf(reports, undead);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: `entity:${String(player)}`,
      kind: 'sensed-life',
      sense: 'life-sense',
      position: ahead(5),
    });
    expect(found[0]?.strength).toBeCloseTo(1 - Math.sqrt(25 + 0.42 * 0.42) / 10, 9);
  });

  it('charges the sight lines a special sense traces to the budget', () => {
    const wall = box({ x: -3, y: 0, z: 2 }, { x: 3, y: 3, z: 2.5 });
    const { world, system, reports, step } = setup({
      walls: [wall],
      tuning: { ...DEFAULT_PERCEPTION_TUNING, rateHz: 60 },
    });
    addPlayer(world, ahead(5, 180));
    const sense = { range: 10, minStrength: 0, requiresLineOfSight: true, requiresMovement: false };
    const seer = addAgent(world, { special: { tremor: sense } });
    step(1);
    expect(perceptsOf(reports, seer)).toHaveLength(1);
    expect(system.lastUnits).toBe(2); // the agent and one sight line (no light samples needed)
  });
});

describe('perception: schedule and budget (mw-e11.5)', () => {
  it('staggers agents by entity id at the perception rate and reports the time each covers', () => {
    const { world, reports, step } = setup();
    const agents = [addAgent(world), addAgent(world), addAgent(world)];
    expect(agents).toEqual([1, 2, 3]);
    step(13);
    // Due when (tick + id) mod 6 = 0.
    expect(reports.map((r) => [r.tick, r.agent])).toEqual([
      [3, 3],
      [4, 2],
      [5, 1],
      [9, 3],
      [10, 2],
      [11, 1],
    ]);
    expect(reports.map((r) => r.seconds)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('spends a budget of work units per tick, deferring the rest in order, deterministically', () => {
    const run = () => {
      const { world, system, reports, step } = setup({
        unitsPerTick: 12,
        tuning: { ...DEFAULT_PERCEPTION_TUNING, rateHz: 60 },
      });
      addPlayer(world, ahead(5));
      for (let i = 0; i < 4; i++) addAgent(world, HUMANOID, { x: i, y: 0, z: 0 });
      const ticks: [number, number, number][] = [];
      for (let i = 0; i < 4; i++) {
        step(1);
        ticks.push([system.lastUnits, system.pending, reports.length]);
      }
      return { ticks, order: reports.map((r) => [r.tick, r.agent, r.seconds]) };
    };
    const first = run();
    // Each agent costs 1 + 4 sight lines + 1 background light sample; the first one of a tick also
    // reads the 4 light samples on the target's body: 10, then 6.
    expect(first.ticks).toEqual([
      [16, 2, 2],
      [16, 2, 4],
      [16, 2, 6],
      [16, 2, 8],
    ]);
    expect(first.order.slice(0, 6)).toEqual([
      [0, 2, 1 / 60],
      [0, 3, 1 / 60],
      [1, 4, 1 / 60],
      [1, 5, 1 / 60],
      [2, 2, 2 / 60],
      [2, 3, 2 / 60],
    ]);
    expect(run()).toEqual(first);
  });

  it('drops agents that lost their senses or were destroyed while waiting', () => {
    const { world, system, reports, step } = setup({
      unitsPerTick: 1,
      tuning: { ...DEFAULT_PERCEPTION_TUNING, rateHz: 60 },
    });
    const a = addAgent(world);
    const b = addAgent(world);
    const c = addAgent(world);
    step(1);
    expect(reports.map((r) => r.agent)).toEqual([a]);
    expect(system.pending).toBe(2);
    world.destroy(b);
    world.remove(c, CreatureSensesComponent);
    step(1);
    expect(reports.map((r) => r.agent)).toEqual([a, a]);
  });

  it('stops when uninstalled, dropping its bookkeeping', () => {
    const { world, system, reports, step } = setup();
    const guard = addAgent(world);
    step(1);
    expect(world.get(guard, PerceptionAgentComponent)).toBeDefined();
    system.uninstall();
    step();
    expect(reports).toEqual([]);
    expect(system.pending).toBe(0);
    expect(world.get(guard, PerceptionAgentComponent)).toBeUndefined();
  });

  it('mw-e12.14: keeps its queue, hearing buffers and evaluation times in components, so a restored world perceives exactly as one never saved', () => {
    const build = () => {
      const s = setup({ unitsPerTick: 12, tuning: { ...DEFAULT_PERCEPTION_TUNING, rateHz: 60 } });
      installNoisePropagation(s.world, { graph: buildSoundGraph({ rooms: [], portals: [] }) });
      addPlayer(s.world, ahead(5));
      for (let i = 0; i < 4; i++) addAgent(s.world, HUMANOID, { x: i, y: 0, z: 0 });
      return s;
    };
    const noise = (world: World<never>, tick: number) => {
      if (tick % 3 === 1)
        emitNoise(world, { position: ahead(2), loudness: 60, kind: `n${String(tick)}` });
    };
    const report = (r: PerceptionReport) => [r.tick, r.agent, r.seconds, r.percepts.length];
    const uninterrupted = build();
    for (let tick = 0; tick < 12; tick++) {
      noise(uninterrupted.world, tick);
      uninterrupted.step(1);
    }
    const tail = uninterrupted.reports.filter((r) => r.tick >= 5).map(report);

    const saved = build();
    for (let tick = 0; tick < 5; tick++) {
      noise(saved.world, tick);
      saved.step(1);
    }
    // Mid-queue, with noises heard and not yet perceived.
    expect(saved.system.pending).toBe(2);
    const waiting = saved.world.query(PerceptionAgentComponent).ids();
    expect(
      waiting.some((id) => (saved.world.get(id, PerceptionAgentComponent)?.heard.length ?? 0) > 0),
    ).toBe(true);
    const restored = build();
    restored.world.restore(saved.world.snapshot());
    expect(restored.system.pending).toBe(2);
    for (let tick = 5; tick < 12; tick++) {
      noise(restored.world, tick);
      restored.step(1);
    }
    expect(restored.reports.map(report)).toEqual(tail);
    expect(hashWorld(restored.world)).toBe(hashWorld(uninterrupted.world));
  });

  it('registers its bookkeeping once, for a world that already has it too', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1 }));
    world.register(PerceptionAgentComponent);
    const lineOfSight = new LineOfSight({ world: new FakeSightWorld() });
    expect(() => perceptionSystem(world, { lineOfSight, light: lit(1) })).not.toThrow();
    expect(world.isRegistered(PerceptionAgentComponent)).toBe(true);
  });

  it('refuses a budget under one unit and a rate that is not positive', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1 }));
    const lineOfSight = new LineOfSight({ world: new FakeSightWorld() });
    expect(() => perceptionSystem(world, { lineOfSight, light: lit(1), unitsPerTick: 0 })).toThrow(
      'unitsPerTick must be at least 1',
    );
    expect(() =>
      perceptionSystem(world, {
        lineOfSight,
        light: lit(1),
        tuning: { ...DEFAULT_PERCEPTION_TUNING, rateHz: 0 },
      }),
    ).toThrow('perception rateHz must be positive');
    expect(perceptionBudgetUnits(0.5)).toBe(Math.floor(0.5 * PERCEPTION_UNITS_PER_MS));
    expect(perceptionBudgetUnits(0)).toBe(1);
  });
});

describe('perception: touch (mw-e11.6)', () => {
  it('feels a target in contact from any side in any light, whatever its senses', () => {
    const { world, reports, step } = setup({ light: lit(0) });
    const player = addPlayer(world, { x: 0, y: 0, z: -0.85 }); // behind it: radius 0.4 + reach 0.5
    const numb = addAgent(world, {});
    step();
    expect(perceptsOf(reports, numb)).toEqual([
      {
        source: `entity:${String(player)}`,
        kind: 'touched',
        sense: 'touch',
        position: { x: 0, y: 0, z: -0.85 },
        strength: 1,
        certainty: 1,
      },
    ]);
  });

  it('feels nothing beyond its radius plus the reach, or too far above or below', () => {
    const { world, reports, step } = setup({ light: lit(0) });
    addPlayer(world, { x: 0.7, y: 0, z: -0.7 }); // 0.99 m away
    addPlayer(world, { x: 0, y: 1.2, z: -0.5 }); // on a ledge above
    const guard = addAgent(world, {});
    step();
    expect(perceptsOf(reports, guard)).toEqual([]);
  });

  it('uses the placement radius of an agent without a nav agent', () => {
    const { world, reports, step } = setup({ light: lit(0) });
    addPlayer(world, { x: 1.4, y: 0, z: 0 });
    const guard = world.spawn();
    world.add(guard, CreatureSensesComponent, {});
    world.add(guard, PlacementComponent, { ...ORIGIN, radius: 1 });
    step();
    expect(perceptsOf(reports, guard).map((p) => p.kind)).toEqual(['touched']);
    expect(
      touchPercept(
        ORIGIN,
        0,
        { source: entitySource(1), feet: ahead(0.6) },
        DEFAULT_PERCEPTION_TUNING,
      ),
    ).toBeUndefined();
  });
});
