// The behaviour runtime (mw-e11.2): scheduling, the alert machine, utility selection, steps and
// failure, primitives, inputs, introspection and save/restore. Behaviours are written tersely here
// with the schema's defaults filled (sim tests may not load content); the fixture guard's content
// runs in tests/integration/ai-runtime.test.ts.

import type {
  BehaviourActivityDef,
  BehaviourDef,
  BehaviourStateDef,
  BehaviourStepDef,
  Frozen,
  RuntimeAttack,
} from '@content/index';
import { describe, expect, it } from 'vitest';
import { ATTACK_COMPONENTS, currentAttack, giveAttacker } from '../combat/attacks/components';
import { cancelAttack } from '../combat/attacks/executor';
import {
  DAMAGE_COMPONENTS,
  giveCombatant,
  HealthComponent,
  ResistancesComponent,
} from '../combat/damage/components';
import { CombatFacingComponent } from '../combat/melee/components';
import { ActorElementsComponent } from '../elements/actors';
import { addProperties, registerWorldProperties } from '../properties/components';
import type { EntityId } from '../core/component';
import { World, type WorldSnapshot } from '../core/world';
import { CreatureComponent, type Creature } from '../creatures/components';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { buildSoundGraph } from '../noise/graph';
import {
  installNoisePropagation,
  NoiseListenerComponent,
  noiseHeard,
  type NoiseHeard,
} from '../noise/system';
import { entitySource, perceived, percept } from '../perception/percept';
import { hashWorld } from '../snapshot';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { BehaviourError, compileBehaviour, compileBehaviours, compileCurve } from './behaviour';
import {
  AiCuePlayed,
  AlertStateChanged,
  BrainComponent,
  type AiCue,
  type AlertStateChange,
  type Brain,
} from './components';
import { resolveInput } from './inputs';
import { installAwareness } from './awareness';
import { introspectBrain } from './introspect';
import { face, straightLineNavigation, type AiNavigation } from './navigation';
import { observePercepts } from './memory';
import { AI_NOISE_KIND, isPrimitive } from './primitives';
import {
  aiBehaviour,
  aiPorts,
  brainOf,
  giveBrain,
  installAi,
  queueAiEvent,
  thinkPeriod,
  writeBlackboard,
  type AiOptions,
  type BrainSpec,
} from './runtime';
import type { AgentView } from './view';

type Loose = Readonly<Record<string, unknown>>;

/** A step with its schema defaults filled. */
function step(value: Loose): BehaviourStepDef {
  const defaults: Loose =
    value['do'] === 'move-to'
      ? { within: 0.5, gait: 'walk' }
      : value['do'] === 'follow-route'
        ? { dwellS: 0, gait: 'walk' }
        : {};
  return { ...defaults, ...value } as unknown as BehaviourStepDef;
}

/** Terse activity: its steps (raw), optionally weight, considerations… */
interface ActivitySpec {
  readonly steps: readonly Loose[];
  readonly weight?: number;
  readonly interruptible?: boolean;
  readonly retryAfterS?: number;
  readonly considerations?: BehaviourActivityDef['considerations'];
}

/** Terse state: its activities, optionally transitions and a timeout. */
interface StateSpec {
  readonly activities: readonly string[];
  readonly transitions?: BehaviourStateDef['transitions'];
  readonly timeoutS?: BehaviourStateDef['timeoutS'];
  readonly onTimeout?: BehaviourStateDef['onTimeout'];
  readonly timeoutFrom?: BehaviourStateDef['timeoutFrom'];
  readonly postAlert?: boolean;
}

interface BehaviourSpec {
  readonly id?: string;
  readonly tuning?: Readonly<Record<string, number>>;
  readonly thinkHz?: number;
  readonly inertia?: number;
  readonly initial?: BehaviourDef['initial'];
  readonly states: Readonly<Record<string, StateSpec>>;
  readonly activities: Readonly<Record<string, ActivitySpec>>;
}

/** A behaviour definition as content would load it (defaults filled). */
function behaviour(spec: BehaviourSpec): Frozen<BehaviourDef> {
  return {
    id: spec.id ?? 'test',
    schemaVersion: 1,
    tuning: spec.tuning ?? {},
    thinkHz: spec.thinkHz ?? 10,
    inertia: spec.inertia ?? 0.1,
    initial: spec.initial ?? 'unaware',
    states: Object.fromEntries(
      Object.entries(spec.states).map(([name, s]) => [
        name,
        {
          transitions: [],
          timeoutFrom: 'entered',
          postAlert: false,
          ...s,
          activities: [...s.activities],
        },
      ]),
    ),
    activities: Object.fromEntries(
      Object.entries(spec.activities).map(([name, a]) => [
        name,
        {
          weight: a.weight ?? 1,
          interruptible: a.interruptible ?? true,
          retryAfterS: a.retryAfterS ?? 2,
          considerations: a.considerations ?? [],
          steps: a.steps.map(step),
        },
      ]),
    ),
  } as unknown as Frozen<BehaviourDef>;
}

/** A world with placement, facing and creature components and AI running `defs`. */
function aiWorld(
  defs: readonly Frozen<BehaviourDef>[],
  options: Omit<AiOptions, 'behaviours'> = {},
  seed = 7,
): World<never> {
  const world = new World<never>({ seed });
  world.register(PlacementComponent, CombatFacingComponent, CreatureComponent);
  installAi(world, { behaviours: compileBehaviours(defs), ...options });
  return world;
}

/** Gait speeds the tests use, m/s. */
const GAITS = Object.freeze({ sneak: 1, walk: 1.5, run: 3 });

/** An agent at `at` (facing +z) with a brain running `spec.behaviour` (default "test"). */
function agent(
  world: World<never>,
  at: Vec3 = { x: 0, y: 0, z: 0 },
  spec: Partial<BrainSpec> = {},
  creature?: Partial<Creature>,
): EntityId {
  const entity = world.spawn();
  placeEntity(world, entity, at, 0.4);
  world.add(
    entity,
    CombatFacingComponent,
    Object.freeze({ facing: Object.freeze({ x: 0, y: 0, z: 1 }) }),
  );
  if (creature !== undefined) {
    world.add(entity, CreatureComponent, {
      origin: { creature: 'c', at, facing: { x: 0, y: 0, z: 1 } },
      behaviour: spec.behaviour ?? 'test',
      tuning: {},
      needs: {},
      ...creature,
    });
  }
  giveBrain(world, entity, { behaviour: 'test', gaits: GAITS, ...spec });
  return entity;
}

/** Steps `world` `n` times. */
function run(world: World<never>, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

const brain = (world: World<never>, entity: EntityId): Readonly<Brain> =>
  must(brainOf(world, entity));

/**
 * `hunter` sees `prey` where it stands now and makes it its target, as awareness does from a
 * perception report (mw-e11.8: target primitives aim at that memory, not at the prey itself).
 */
function sees(world: World<never>, hunter: EntityId, prey: EntityId): void {
  const at = must(world.get(prey, PlacementComponent));
  const source = entitySource(prey);
  const position = { x: at.x, y: at.y, z: at.z };
  const seen = percept({
    source,
    kind: 'seen-target',
    sense: 'sight',
    position,
    strength: 1,
    certainty: 1,
  });
  observePercepts(
    must(world.get(hunter, BrainComponent)).memory,
    [seen],
    world.tick,
    world.clock.hz,
  );
  writeBlackboard(world, hunter, { target: prey, targetSource: source, lkp: position });
}

/** One activity that waits for a long time, in Unaware. */
const idle = behaviour({
  states: { unaware: { activities: ['idle'] } },
  activities: { idle: { steps: [{ do: 'wait', seconds: 100 }] } },
});

/** A navigation that records every call and otherwise walks straight. */
function spyNavigation(fail: (goal: Vec3) => boolean = () => false) {
  const calls: EntityId[] = [];
  const navigation: AiNavigation = {
    travel(world, entity, request) {
      calls.push(entity);
      return fail(request.goal) ? 'failure' : straightLineNavigation.travel(world, entity, request);
    },
  };
  return { calls, navigation };
}

const square: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 4, y: 0, z: 4 },
  { x: 0, y: 0, z: 4 },
];

describe('think scheduling', () => {
  it('AC-1: two 10 Hz agents on a 60 Hz sim each think exactly 10 times in 60 ticks, staggered by entity id', () => {
    const world = aiWorld([idle]);
    const a = agent(world);
    const b = agent(world);
    const thinks = new Map<EntityId, number[]>([
      [a, []],
      [b, []],
    ]);
    for (let tick = 0; tick < 60; tick++) {
      world.step();
      for (const [entity, ticks] of thinks) {
        if (brain(world, entity).thoughtTick === tick) ticks.push(tick);
      }
    }
    // (tick + entity) mod 6 = 0: entity 1 thinks on ticks 5, 11 … 59 and entity 2 on 4, 10 … 58.
    expect(thinks.get(a)).toEqual([5, 11, 17, 23, 29, 35, 41, 47, 53, 59]);
    expect(thinks.get(b)).toEqual([4, 10, 16, 22, 28, 34, 40, 46, 52, 58]);
    // The same in a second world: the schedule depends on ids and ticks only.
    const again = aiWorld([idle]);
    agent(again);
    agent(again);
    run(again, 60);
    expect(hashWorld(again)).toBe(hashWorld(world));
  });

  it('think period is hz / thinkHz rounded, at least one tick', () => {
    const at = (thinkHz: number) =>
      thinkPeriod(compileBehaviour(behaviour({ ...idleSpec, thinkHz })), 60);
    expect([at(10), at(7), at(60), at(200)]).toEqual([6, 9, 1, 1]);
  });

  it('a think budget defers the rest to the next ticks, longest-waiting first', () => {
    const fast = behaviour({ ...idleSpec, thinkHz: 60 });
    const world = aiWorld([fast], { maxThinksPerTick: 1 });
    const agents = [agent(world), agent(world), agent(world)];
    const counts = new Map(agents.map((e) => [e, 0]));
    for (let tick = 0; tick < 30; tick++) {
      world.step();
      const thinkers = agents.filter((e) => brain(world, e).thoughtTick === tick);
      expect(thinkers).toHaveLength(1);
      const thinker = must(thinkers[0]);
      counts.set(thinker, must(counts.get(thinker)) + 1);
    }
    expect([...counts.values()]).toEqual([10, 10, 10]);
  });

  it('skips agents whose behaviour this world does not know, owed or not', () => {
    const world = aiWorld([idle], { maxThinksPerTick: 5 });
    const entity = agent(world);
    const live = brainOf(world, entity) as Brain;
    live.behaviour = 'gone';
    live.owed = true;
    run(world, 12);
    expect(brain(world, entity).thoughtTick).toBe(-1);
    expect(introspectBrain(world, entity)).toBeUndefined();
  });

  it('a creature at zero health no longer thinks, moves or leashes', () => {
    const world = aiWorld([idle]);
    world.register(...DAMAGE_COMPONENTS);
    const entity = agent(world);
    giveCombatant(world, entity, { health: 10 });
    run(world, 12);
    const thought = brain(world, entity).thoughtTick;
    expect(thought).toBeGreaterThanOrEqual(0);
    world.set(entity, HealthComponent, { max: 10, current: 0 });
    run(world, 60);
    expect(brain(world, entity).thoughtTick).toBe(thought);
  });

  it('a creature frozen solid does not think until it thaws (mw-e03.24)', () => {
    const world = aiWorld([idle]);
    registerWorldProperties(world);
    world.register(ActorElementsComponent);
    const entity = agent(world);
    world.add(entity, ActorElementsComponent, {
      fireResistance: 0,
      coldResistance: 0,
      shockResistance: 0,
      aflame: false,
      baseFuel: 6,
      baseFragile: 0,
      baseConductive: false,
      heatInertia: 1,
      chillBelow: 10,
      chillSlowest: 0.4,
      frozenUntil: 0,
      soaked: false,
    });
    addProperties(world, entity, { frozen: true });
    run(world, 2);
    const thought = brain(world, entity).thoughtTick;
    run(world, 60);
    expect(brain(world, entity).thoughtTick).toBe(thought);
    addProperties(world, entity, { frozen: false });
    run(world, 60);
    expect(brain(world, entity).thoughtTick).toBeGreaterThan(thought);
  });

  it('rejects a second install and a think budget below one', () => {
    const world = aiWorld([idle]);
    expect(() => {
      installAi(world, { behaviours: new Map() });
    }).toThrow(/already installed/);
    const bare = new World<never>({ seed: 1 }).register(BrainComponent);
    expect(() => {
      installAi(bare, { behaviours: new Map(), maxThinksPerTick: 0 });
    }).toThrow(RangeError);
    installAi(bare, { behaviours: new Map() }); // the brain component was already registered
    expect(aiBehaviour(bare, 'test')).toBeUndefined();
    expect(aiBehaviour(new World<never>({ seed: 1 }), 'test')).toBeUndefined();
  });
});

const idleSpec = {
  states: { unaware: { activities: ['idle'] } },
  activities: { idle: { steps: [{ do: 'wait', seconds: 100 }] } },
} as const;

describe('compiling behaviours', () => {
  it('AC-2: a behaviour referencing an unknown primitive fails, naming the behaviour and the primitive', () => {
    const def = behaviour({
      id: 'sleepwalker',
      states: { unaware: { activities: ['drift'] } },
      activities: { drift: { steps: [{ do: 'wait', seconds: 1 }, { do: 'levitate' }] } },
    });
    expect(() => compileBehaviours([def])).toThrow(
      new BehaviourError(
        'behaviour "sleepwalker" activity "drift" step 1: unknown primitive "levitate"',
      ),
    );
  });

  it('fails on an unknown input, state, activity or tuning key, naming it', () => {
    const fails = (spec: Partial<BehaviourSpec>, message: string) => {
      expect(() => compileBehaviour(behaviour({ ...idleSpec, id: 'b', ...spec }))).toThrow(
        `behaviour "b"${message}`,
      );
    };
    fails(
      {
        activities: {
          idle: {
            steps: [{ do: 'wait', seconds: 1 }],
            considerations: [{ input: 'mood', curve: { kind: 'power', exponent: 1 } }],
          },
        },
      },
      ' activity "idle": unknown input "mood"',
    );
    fails({ initial: 'combat' }, ': unknown state "combat"');
    fails(
      { states: { unaware: { activities: ['idle'], timeoutS: 1, onTimeout: 'alerted' } } },
      ' state "unaware": unknown state "alerted"',
    );
    fails(
      { states: { unaware: { activities: ['nap'] } } },
      ' state "unaware": unknown activity "nap"',
    );
    fails(
      {
        states: {
          unaware: {
            activities: ['idle'],
            transitions: [{ to: 'unaware', when: { done: 'nap' } }],
          },
        },
      },
      ' state "unaware": unknown activity "nap"',
    );
    fails(
      { activities: { idle: { steps: [{ do: 'wait', seconds: { tuning: 'patience' } }] } } },
      ' activity "idle" step 0: unknown tuning key "patience"',
    );
  });

  it('curves map inputs to 0–1: linear and step clamp, power raises the clamped input', () => {
    const linear = compileCurve({ kind: 'linear', slope: 2, intercept: -0.5 });
    expect([linear(0), linear(0.5), linear(1)]).toEqual([0, 0.5, 1]);
    const step = compileCurve({ kind: 'step', at: 3, below: 0.2, above: 0.9 });
    expect([step(2.9), step(3)]).toEqual([0.2, 0.9]);
    const cube = compileCurve({ kind: 'power', exponent: 3 });
    expect([cube(-1), cube(0.5), cube(2)]).toEqual([0, 0.125, 1]);
    expect(compileCurve({ kind: 'power', exponent: 1 })(0.3)).toBe(0.3);
  });
});

describe('the alert machine', () => {
  const machine = behaviour({
    tuning: { alarmAt: 0.5, calmS: 2 },
    states: {
      unaware: {
        activities: ['idle'],
        transitions: [
          { to: 'alerted', when: { event: 'ally-alarm' } },
          { to: 'suspicious', when: { input: 'awareness', gte: { tuning: 'alarmAt' } } },
          { to: 'combat', when: { input: 'awareness', gte: 0.2, lt: 0.3 } },
        ],
      },
      suspicious: { activities: ['idle'], timeoutS: { tuning: 'calmS' }, onTimeout: 'unaware' },
      alerted: {
        activities: ['idle'],
        transitions: [{ to: 'unaware', when: { input: 'awareness', lt: 0.1 } }],
      },
      combat: { activities: ['idle'] },
    },
    activities: { idle: { steps: [{ do: 'wait', seconds: 100 }] } },
  });

  it('takes at most one listed transition per think, emits AlertStateChanged, times out by tuning', () => {
    const world = aiWorld([machine]);
    const changes: AlertStateChange[] = [];
    world.events.on(AlertStateChanged, (c) => changes.push(c));
    const guard = agent(world, undefined, {}, { tuning: { calmS: 1 } });
    run(world, 6);
    expect(brain(world, guard).state).toBe('unaware');
    writeBlackboard(world, guard, { awareness: 0.6 });
    run(world, 6);
    expect(brain(world, guard).state).toBe('suspicious');
    run(world, 60); // the creature's calmS (1 s) overrides the behaviour's 2 s
    expect(changes).toEqual([
      { tick: 11, entity: guard, from: 'unaware', to: 'suspicious', cause: 'input:awareness' },
      { tick: 71, entity: guard, from: 'suspicious', to: 'unaware', cause: 'timeout' },
    ]);
    // Events are read once, at the next think, before inputs.
    expect(queueAiEvent(world, guard, 'ally-alarm')).toBe(true);
    expect(queueAiEvent(world, guard, 'ally-alarm')).toBe(true);
    expect(brain(world, guard).events).toEqual(['ally-alarm']);
    run(world, 6);
    expect(brain(world, guard).state).toBe('alerted');
    expect(brain(world, guard).events).toEqual([]);
    writeBlackboard(world, guard, { awareness: 0 });
    run(world, 6);
    writeBlackboard(world, guard, { awareness: 0.25 });
    run(world, 6);
    expect(changes.slice(2).map((c) => [c.to, c.cause])).toEqual([
      ['alerted', 'event:ally-alarm'],
      ['unaware', 'input:awareness'],
      ['combat', 'input:awareness'],
    ]);
  });

  it('without AI or a brain, events and blackboard writes are refused', () => {
    const world = new World<never>({ seed: 1 });
    world.register(BrainComponent);
    const entity = world.spawn();
    expect(queueAiEvent(world, entity, 'ally-alarm')).toBe(false);
    expect(writeBlackboard(world, entity, { awareness: 1 })).toBe(false);
    expect(brainOf(new World<never>({ seed: 1 }), entity)).toBeUndefined();
    expect(() => {
      giveBrain(world, entity, { behaviour: 'test' });
    }).toThrow('unknown behaviour "test" (is AI installed?)');
  });

  it('a fresh brain defaults to traits 0.5 and no movement', () => {
    const world = aiWorld([idle]);
    const entity = world.spawn();
    giveBrain(world, entity, { behaviour: 'test' });
    expect(brain(world, entity)).toMatchObject({
      state: 'unaware',
      traits: {},
      gaits: { sneak: 0, walk: 0, run: 0 },
      blackboard: { awareness: 0, stimulus: null, target: null, waypoint: 0 },
    });
  });
});

describe('utility selection', () => {
  const choosy = behaviour({
    inertia: 0.2,
    states: {
      unaware: { activities: ['patrol', 'gossip', 'snack', 'stare'] },
      combat: { activities: ['strike', 'shout'] },
    },
    activities: {
      patrol: {
        steps: [{ do: 'wait', seconds: 100 }],
        considerations: [
          { input: 'trait.diligence', curve: { kind: 'linear', slope: 1, intercept: 0 } },
        ],
      },
      gossip: {
        steps: [{ do: 'wait', seconds: 100 }],
        considerations: [
          { input: 'trait.sociability', curve: { kind: 'linear', slope: 1, intercept: 0 } },
        ],
      },
      snack: {
        weight: 2,
        steps: [{ do: 'wait', seconds: 100 }],
        considerations: [
          { input: 'need.hunger', curve: { kind: 'power', exponent: 2 } },
          { input: 'trait.greed', curve: { kind: 'step', at: 0.5, below: 0, above: 1 } },
        ],
      },
      stare: { weight: 0, steps: [{ do: 'wait', seconds: 1 }] },
      strike: {
        interruptible: false,
        steps: [
          { do: 'wait', seconds: 1 },
          { do: 'wait', seconds: 1 },
        ],
        considerations: [
          { input: 'healthFraction', curve: { kind: 'linear', slope: 1, intercept: 0 } },
        ],
      },
      shout: { weight: 0.5, steps: [{ do: 'wait', seconds: 100 }] },
    },
  });

  it('scores weight × Π curve(input), keeps the running activity by inertia, ties to the earlier-listed', () => {
    const world = aiWorld([choosy]);
    const traits = { diligence: 0.5, sociability: 0.6, greed: 0.7 };
    const guard = agent(world, undefined, { traits }, { needs: { hunger: 50 } });
    run(world, 6);
    expect(brain(world, guard).activity).toBe('gossip');
    expect(brain(world, guard).scores).toEqual([
      ['gossip', 0.6],
      ['patrol', 0.5], // ties with snack: the earlier-listed goes first
      ['snack', 0.5],
    ]);
    // Hunger rises: snack 2 × 0.6² = 0.72 does not beat gossip 0.6 + 0.2 inertia.
    world.set(guard, CreatureComponent, {
      ...must(world.get(guard, CreatureComponent)),
      needs: { hunger: 60 },
    });
    run(world, 6);
    expect(brain(world, guard).activity).toBe('gossip');
    world.set(guard, CreatureComponent, {
      ...must(world.get(guard, CreatureComponent)),
      needs: { hunger: 70 },
    });
    run(world, 6);
    expect(brain(world, guard).activity).toBe('snack'); // 0.98 > 0.8
    expect(brain(world, guard).scores[0]).toEqual(['snack', expect.closeTo(0.98, 9)]);
  });

  it('a score of 0 never wins; a non-interruptible activity holds until it ends', () => {
    const world = aiWorld([choosy]);
    const loafer = agent(world, undefined, { traits: { diligence: 0, sociability: 0, greed: 0 } });
    run(world, 6);
    expect(brain(world, loafer).activity).toBeNull(); // stare's weight is 0, the others score 0
    const fighter = agent(world, undefined, {}, {});
    world.register(HealthComponent, ResistancesComponent);
    queueAiEvent(world, fighter, 'ally-alarm');
    (brainOf(world, fighter) as Brain).state = 'combat';
    run(world, 6);
    expect(brain(world, fighter).activity).toBe('strike'); // health 1 (no health component)
    giveCombatant(world, fighter, { health: 10 });
    world.set(fighter, HealthComponent, { max: 10, current: 1 });
    run(world, 30);
    expect(brain(world, fighter).activity).toBe('strike'); // 0.1 < shout 0.5, but strike holds
    run(world, 120);
    expect(brain(world, fighter).activity).toBe('shout');
  });
});

describe('steps and failure', () => {
  it('AC-3: a failing move-to (unreachable) makes the activity fail; a failed transition takes over', () => {
    const def = behaviour({
      states: {
        unaware: {
          activities: ['go', 'fallback'],
          transitions: [{ to: 'investigating', when: { failed: 'go' } }],
        },
        investigating: { activities: ['fallback'] },
      },
      activities: {
        go: { weight: 2, steps: [{ do: 'move-to', target: 'stimulus' }] },
        fallback: { steps: [{ do: 'wait', seconds: 100 }] },
      },
    });
    const { navigation } = spyNavigation((goal) => goal.x > 50);
    const world = aiWorld([def], { navigation });
    const changes: AlertStateChange[] = [];
    world.events.on(AlertStateChanged, (c) => changes.push(c));
    const guard = agent(world);
    writeBlackboard(world, guard, { stimulus: { x: 100, y: 0, z: 0 } });
    run(world, 6);
    expect(brain(world, guard).ended).toEqual({ activity: 'go', ok: false });
    run(world, 6);
    expect(changes.map((c) => [c.to, c.cause])).toEqual([['investigating', 'failed:go']]);
    expect(brain(world, guard).activity).toBe('fallback');
  });

  it('AC-3: without a failed transition the next-best activity runs, and the failed one returns after retryAfterS', () => {
    const def = behaviour({
      states: { unaware: { activities: ['go', 'fallback'] } },
      activities: {
        go: { weight: 2, retryAfterS: 1, steps: [{ do: 'move-to', target: 'stimulus' }] },
        fallback: { steps: [{ do: 'wait', seconds: 100 }] },
      },
    });
    const { navigation, calls } = spyNavigation((goal) => goal.x > 50);
    const world = aiWorld([def], { navigation });
    const guard = agent(world);
    writeBlackboard(world, guard, { stimulus: { x: 100, y: 0, z: 0 } });
    run(world, 12);
    expect(brain(world, guard).activity).toBe('fallback');
    expect(brain(world, guard).scores).toEqual([
      ['fallback', 1], // chosen on this think: no inertia yet
      ['go', 0],
    ]);
    expect(calls).toHaveLength(1);
    run(world, 60); // excluded until 1 s after the failure, then chosen (and failing) again
    expect(calls).toHaveLength(2);
    expect(brain(world, guard).retry).toEqual([['go', 125]]); // failed again on tick 65
  });

  it('AC-4: a despawned agent gets no further callbacks, and agents chasing it fail without throwing', () => {
    const def = behaviour({
      states: { unaware: { activities: ['chase', 'wander'] } },
      activities: {
        chase: {
          weight: 2,
          considerations: [
            { input: 'hasStimulus', curve: { kind: 'linear', slope: -1, intercept: 1 } },
          ],
          steps: [{ do: 'move-to', target: 'target' }],
        },
        wander: { steps: [{ do: 'move-to', target: 'stimulus' }] },
      },
    });
    const { navigation, calls } = spyNavigation();
    const world = aiWorld([def], { navigation });
    const hunter = agent(world);
    const prey = agent(world, { x: 0, y: 0, z: 30 });
    // Its memory of the prey forgets it once the prey is gone (awareness's `present` port).
    installAwareness(world, { present: () => world.isAlive(prey) });
    sees(world, hunter, prey);
    writeBlackboard(world, prey, { stimulus: { x: 0, y: 0, z: 90 } });
    run(world, 30);
    expect(calls.filter((e) => e === prey).length).toBeGreaterThan(20);
    expect(calls.filter((e) => e === hunter).length).toBeGreaterThan(20); // chasing
    world.destroy(prey);
    world.step();
    const before = calls.length;
    expect(() => {
      world.events.emit(perceived, { tick: world.tick, agent: hunter, seconds: 0.1, percepts: [] });
      run(world, 60);
    }).not.toThrow();
    expect(brain(world, hunter).blackboard).toMatchObject({ target: null, targetSource: null });
    expect(calls.slice(before)).not.toContain(prey);
    expect(brain(world, hunter).retry.map(([a]) => a)).toContain('chase');
  });

  it('AC-4: an agent despawned by its own step mid-tick finishes that tick and never runs again', () => {
    const calls: EntityId[] = [];
    const navigation: AiNavigation = {
      travel(world, entity) {
        calls.push(entity);
        world.destroy(entity);
        return 'running';
      },
    };
    const world = aiWorld(
      [
        behaviour({
          states: { unaware: { activities: ['go'] } },
          activities: { go: { steps: [{ do: 'move-to', target: 'origin' }] } },
        }),
      ],
      { navigation },
    );
    const guard = agent(world, undefined, {}, {});
    run(world, 30);
    expect(calls).toEqual([guard]);
    expect(world.isAlive(guard)).toBe(false);
  });

  it('steps that finish at once chain within the tick; the last success makes the activity done', () => {
    const def = behaviour({
      states: {
        unaware: {
          activities: ['bark'],
          transitions: [{ to: 'suspicious', when: { done: 'bark' } }],
        },
        suspicious: { activities: ['bark'] },
      },
      activities: {
        bark: {
          steps: [
            { do: 'play-cue', cue: 'woof' },
            { do: 'emit-noise', db: 60 },
            { do: 'forget-stimulus' },
          ],
        },
      },
    });
    const world = aiWorld([def]);
    const cues: AiCue[] = [];
    const noises: NoiseEvent[] = [];
    world.events.on(AiCuePlayed, (c) => cues.push(c));
    world.events.on(noiseEmitted, (n) => noises.push(n));
    const dog = agent(world, { x: 1, y: 2, z: 3 });
    writeBlackboard(world, dog, { stimulus: { x: 5, y: 0, z: 5 }, awareness: 0.7 });
    run(world, 6);
    expect(cues).toEqual([{ tick: 5, entity: dog, cue: 'woof' }]);
    // mw-e09.22 AC-2: on the shared channel, with the agent as its source.
    expect(noises).toEqual([
      {
        tick: 5,
        position: { x: 1, y: 2, z: 3 },
        loudness: 60,
        kind: 'ai',
        entity: dog,
        source: dog,
        tags: [],
      },
    ]);
    expect(brain(world, dog)).toMatchObject({
      activity: null,
      ended: { activity: 'bark', ok: true },
      blackboard: { stimulus: null, awareness: 0 },
    });
    run(world, 6);
    expect(brain(world, dog).state).toBe('suspicious');
  });
});

/** A behaviour running one activity made of `steps`, forever (it restarts when it ends). */
const only = (steps: readonly Readonly<Record<string, unknown>>[], retryAfterS = 0) =>
  behaviour({
    thinkHz: 60,
    states: { unaware: { activities: ['act'] } },
    activities: { act: { steps, retryAfterS } },
  });

describe('primitives', () => {
  it('move-to walks at the gait speed to the stimulus, the origin, the target or the nearest waypoint', () => {
    const world = aiWorld([only([{ do: 'move-to', target: 'nearest-waypoint', gait: 'run' }])]);
    const guard = agent(
      world,
      { x: 5, y: 0, z: 4 },
      {},
      {
        origin: {
          creature: 'c',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          patrol: square,
        },
      },
    );
    world.step();
    expect(world.get(guard, PlacementComponent)?.x).toBeCloseTo(5 - 0.05, 9); // 3 m/s run
    run(world, 30);
    expect(brain(world, guard).blackboard.waypoint).toBe(2);
    expect(world.get(guard, CombatFacingComponent)?.facing).toEqual({ x: -1, y: 0, z: 0 });
    const to = (target: string, at: Vec3, creature?: Partial<Creature>) => {
      const w = aiWorld([only([{ do: 'move-to', target, within: 1 }])]);
      const e = agent(w, at, {}, creature);
      return { w, e };
    };
    const home = to(
      'origin',
      { x: 10, y: 0, z: 0 },
      {
        origin: { creature: 'c', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      },
    );
    run(home.w, 400); // 9 m at 1.5 m/s, stopping 1 m short
    expect(home.w.get(home.e, PlacementComponent)?.x).toBeCloseTo(1, 6);
    const lost = to('origin', { x: 10, y: 0, z: 0 });
    run(lost.w, 2);
    expect(brain(lost.w, lost.e).ended).toEqual({ activity: 'act', ok: false });
    const chase = to('target', { x: 0, y: 0, z: 0 });
    const prey = chase.w.spawn();
    placeEntity(chase.w, prey, { x: 0, y: 0, z: -3 });
    sees(chase.w, chase.e, prey);
    placeEntity(chase.w, prey, { x: 0, y: 0, z: 30 }); // unseen, it moves away: no leak (mw-e11.8)
    run(chase.w, 90);
    expect(chase.w.get(chase.e, PlacementComponent)?.z).toBeCloseTo(-2, 1); // within 1 m of where seen
    const unremembered = to('target', { x: 0, y: 0, z: 0 });
    writeBlackboard(unremembered.w, unremembered.e, { target: prey }); // a target, but no memory
    run(unremembered.w, 2);
    expect(brain(unremembered.w, unremembered.e).ended?.ok).toBe(false);
    const unset = to('target', { x: 0, y: 0, z: 0 });
    run(unset.w, 2);
    expect(brain(unset.w, unset.e).ended?.ok).toBe(false);
    const patrol: Partial<Creature> = {
      origin: {
        creature: 'c',
        at: { x: 0, y: 0, z: 0 },
        facing: { x: 0, y: 0, z: 1 },
        patrol: square,
      },
    };
    const glance = aiWorld([only([{ do: 'look-at', target: 'nearest-waypoint', seconds: 0 }])]);
    const looker = agent(glance, { x: 5, y: 0, z: 0.5 }, {}, patrol);
    glance.step();
    const facing = must(glance.get(looker, CombatFacingComponent)).facing;
    expect([facing.x, facing.z]).toEqual([-2 / Math.sqrt(5), -1 / Math.sqrt(5)]);
    expect(brain(glance, looker).ended).toEqual({ activity: 'act', ok: true });
    const nowhere = to('nearest-waypoint', { x: 0, y: 0, z: 0 }, {});
    const ghost = nowhere.w.spawn(); // a patrolling creature without a placement has no nearest waypoint
    nowhere.w.add(ghost, CreatureComponent, {
      behaviour: 'test',
      tuning: {},
      needs: {},
      ...patrol,
    } as Creature);
    giveBrain(nowhere.w, ghost, { behaviour: 'test' });
    nowhere.w.step();
    expect(brain(nowhere.w, ghost).ended?.ok).toBe(false);
    run(nowhere.w, 2);
    expect(brain(nowhere.w, nowhere.e).ended?.ok).toBe(false);
  });

  it('follow-route walks the loop, dwells at each waypoint, and fails without a route', () => {
    const world = aiWorld([only([{ do: 'follow-route', dwellS: 0.5 }])]);
    const guard = agent(
      world,
      { x: 0, y: 0, z: 0 },
      {},
      {
        origin: {
          creature: 'c',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          patrol: square,
        },
      },
    );
    world.step(); // at waypoint 0 on tick 0: arrives at once, dwells 30 ticks
    expect(brain(world, guard).blackboard.waypoint).toBe(1);
    run(world, 29);
    expect(world.get(guard, PlacementComponent)?.x).toBe(0);
    world.step();
    expect(world.get(guard, PlacementComponent)?.x).toBeCloseTo(0.025, 9); // 1.5 m/s walk
    // Round the loop: each 4 m side takes ~2.5 s at a walk, then 0.5 s at the corner.
    const reached: number[] = [];
    for (let i = 0; i < 700; i++) {
      const before = brain(world, guard).blackboard.waypoint;
      world.step();
      if (brain(world, guard).blackboard.waypoint !== before) reached.push(world.tick);
    }
    expect(reached).toHaveLength(4);
    expect(reached.slice(1).map((t, i) => t - must(reached[i]))).toEqual([180, 179, 179]);
    expect(brain(world, guard).blackboard.waypoint).toBe(1);
    expect(brain(world, guard).activity).toBe('act');
    const lost = aiWorld([only([{ do: 'follow-route' }])]);
    const nobody = agent(lost, undefined, {}, {});
    lost.step();
    expect(brain(lost, nobody).ended?.ok).toBe(false);
    const { navigation } = spyNavigation(() => true);
    const blocked = aiWorld([only([{ do: 'follow-route' }])], { navigation });
    const stuck = agent(
      blocked,
      undefined,
      {},
      {
        origin: {
          creature: 'c',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          patrol: square,
        },
      },
    );
    blocked.step();
    expect(brain(blocked, stuck).ended?.ok).toBe(false);
  });

  it('look-at faces the target for its time; look-around faces seeded directions; wait waits', () => {
    const world = aiWorld([
      only([
        { do: 'look-at', target: 'stimulus', seconds: 1 },
        { do: 'look-around', seconds: 2 },
        { do: 'wait', seconds: 0.5 },
      ]),
    ]);
    const guard = agent(world);
    writeBlackboard(world, guard, { stimulus: { x: -3, y: 0, z: 0 } });
    world.step();
    expect(world.get(guard, CombatFacingComponent)?.facing).toEqual({ x: -1, y: 0, z: 0 });
    run(world, 60);
    expect(brain(world, guard).step).toBe(1);
    const turned = world.get(guard, CombatFacingComponent)?.facing;
    expect(turned).not.toEqual({ x: -1, y: 0, z: 0 });
    run(world, 60);
    expect(world.get(guard, CombatFacingComponent)?.facing).not.toEqual(turned);
    run(world, 60);
    expect(brain(world, guard).step).toBe(2);
    run(world, 30);
    expect(brain(world, guard).ended).toEqual({ activity: 'act', ok: true });
    // A second world with the same seed turns the same way: the directions come from the ai stream.
    const again = aiWorld([
      only([
        { do: 'look-at', target: 'stimulus', seconds: 1 },
        { do: 'look-around', seconds: 2 },
        { do: 'wait', seconds: 0.5 },
      ]),
    ]);
    writeBlackboard(again, agent(again), { stimulus: { x: -3, y: 0, z: 0 } });
    run(again, 211);
    expect(hashWorld(again)).toBe(hashWorld(world));
  });

  it('look-at and emit-noise fail without a placement or a target', () => {
    const world = aiWorld([only([{ do: 'look-at', target: 'stimulus', seconds: 1 }])]);
    const blind = agent(world);
    world.step();
    expect(brain(world, blind).ended?.ok).toBe(false);
    const ghost = world.spawn();
    giveBrain(world, ghost, { behaviour: 'test' });
    writeBlackboard(world, ghost, { stimulus: { x: 1, y: 0, z: 0 } });
    world.step();
    expect(brain(world, ghost).ended?.ok).toBe(false);
    const quiet = aiWorld([only([{ do: 'emit-noise', db: 50 }])]);
    const mute = quiet.spawn();
    giveBrain(quiet, mute, { behaviour: 'test' });
    quiet.step();
    expect(brain(quiet, mute).ended?.ok).toBe(false);
  });

  it('attack starts the attack on its target and runs until it ends; it fails when it may not start', () => {
    const strike = {
      id: 'strike',
      rangeMin: 0,
      rangeMax: 2,
      targetStances: null,
      healthMin: 0,
      healthMax: 1,
      cooldownMs: 1000,
    } as unknown as RuntimeAttack;
    const setup = (options: { attacks?: boolean; attacker?: boolean; at?: Vec3 } = {}) => {
      const world = aiWorld([only([{ do: 'attack', attack: { type: 'attack', id: 'strike' } }])], {
        ...(options.attacks !== false && { attacks: new Map([['strike', strike]]) }),
      });
      world.register(...ATTACK_COMPONENTS, ...DAMAGE_COMPONENTS);
      const guard = agent(world);
      if (options.attacker !== false) giveAttacker(world, guard);
      const foe = world.spawn();
      placeEntity(world, foe, options.at ?? { x: 1, y: 0, z: 0 });
      sees(world, guard, foe);
      return { world, guard };
    };
    const { world, guard } = setup();
    world.step();
    expect(currentAttack(world, guard)).toMatchObject({
      attack: 'strike',
      aim: { x: 1, y: 0, z: 0 },
    });
    run(world, 5);
    expect(brain(world, guard).activity).toBe('act');
    cancelAttack(world, guard);
    world.step();
    expect(brain(world, guard).ended).toEqual({ activity: 'act', ok: true });
    // Straight above it: aims along +z.
    const above = setup({ at: { x: 0, y: 1, z: 0 } });
    above.world.step();
    expect(currentAttack(above.world, above.guard)?.aim).toEqual({ x: 0, y: 0, z: 1 });
    for (const failing of [
      setup({ attacks: false }),
      setup({ attacker: false }),
      setup({ at: { x: 9, y: 0, z: 0 } }),
    ]) {
      failing.world.step();
      expect(brain(failing.world, failing.guard).ended?.ok).toBe(false);
    }
    const alone = setup();
    writeBlackboard(alone.world, alone.guard, { target: null });
    alone.world.step();
    expect(brain(alone.world, alone.guard).ended?.ok).toBe(false);
  });

  it('knows its primitives by name', () => {
    expect(isPrimitive('move-to')).toBe(true);
    expect(isPrimitive('teleport')).toBe(false);
  });
});

describe('navigation', () => {
  it('straight-line travel fails without a placement or speed, arrives within reach, and leaves facing alone when it has none', () => {
    const world = new World<never>({ seed: 1 });
    world.register(PlacementComponent);
    const request = { goal: { x: 3, y: 0, z: 4 }, within: 0.5, speed: 6, dt: 0.5 };
    const nowhere = world.spawn();
    expect(straightLineNavigation.travel(world, nowhere, request)).toBe('failure');
    const walker = world.spawn();
    placeEntity(world, walker, { x: 0, y: 1, z: 0 });
    expect(straightLineNavigation.travel(world, walker, { ...request, speed: 0 })).toBe('failure');
    expect(straightLineNavigation.travel(world, walker, request)).toBe('running');
    const moved = must(world.get(walker, PlacementComponent));
    expect([moved.x, moved.y, moved.z]).toEqual([
      expect.closeTo(1.8, 9),
      1,
      expect.closeTo(2.4, 9),
    ]);
    expect(straightLineNavigation.travel(world, walker, request)).toBe('success');
    expect(straightLineNavigation.travel(world, walker, request)).toBe('success');
    face(world, walker, 1, 0); // no facing component registered: nothing to turn
    world.register(CombatFacingComponent);
    face(world, walker, 1, 0); // registered, but the walker has none
    expect(world.has(walker, CombatFacingComponent)).toBe(false);
  });
});

describe('inputs', () => {
  const view = (world: World<never>, entity: EntityId, creature?: Creature): AgentView => ({
    world,
    entity,
    brain: brainOf(world, entity) as Brain,
    creature,
    tuning: {},
    tick: world.tick,
    hz: 60,
    ports: aiPorts(world),
  });
  const read = (name: string, v: AgentView) => must(resolveInput(name))(v);

  it('reads awareness, stimulus, target, health, time, traits, needs and distance off the route', () => {
    const world = aiWorld([idle]);
    world.register(...DAMAGE_COMPONENTS);
    const guard = agent(world, { x: 2, y: 0, z: -3 }, { traits: { curiosity: 0.9 } });
    run(world, 120);
    const creature: Creature = {
      origin: {
        creature: 'c',
        at: { x: 0, y: 0, z: 0 },
        facing: { x: 0, y: 0, z: 1 },
        patrol: square,
      },
      behaviour: 'test',
      tuning: {},
      needs: { sleep: 40 },
    };
    const v = view(world, guard, creature);
    expect(read('timeInState', v)).toBe(2);
    expect(read('targetLostS', v)).toBe(2); // never seen: time in state
    expect(read('healthFraction', v)).toBe(1);
    expect(read('trait.curiosity', v)).toBe(0.9);
    expect(read('trait.greed', v)).toBe(0.5);
    expect(read('need.sleep', v)).toBe(0.4);
    expect(read('need.hunger', v)).toBe(0);
    expect(read('need.sleep', view(world, guard))).toBe(0);
    expect(read('offRoute', v)).toBe(3);
    expect(read('offRoute', view(world, guard))).toBe(0);
    expect(
      read(
        'offRoute',
        view(world, guard, { ...creature, origin: { ...creature.origin, patrol: [] } }),
      ),
    ).toBe(0);
    expect(
      read(
        'offRoute',
        view(world, guard, {
          ...creature,
          origin: { ...creature.origin, patrol: [{ x: 2, y: 0, z: 1 }] },
        }),
      ),
    ).toBe(4);
    const ghost = world.spawn();
    giveBrain(world, ghost, { behaviour: 'test' });
    expect(read('offRoute', view(world, ghost, creature))).toBe(0);
    expect([read('awareness', v), read('hasStimulus', v), read('targetVisible', v)]).toEqual([
      0, 0, 0,
    ]);
    writeBlackboard(world, guard, {
      awareness: 0.4,
      stimulus: { x: 1, y: 2, z: 3 },
      targetVisible: true,
    });
    expect([read('awareness', v), read('hasStimulus', v), read('targetVisible', v)]).toEqual([
      0.4, 1, 1,
    ]);
    expect(read('targetLostS', v)).toBe(0);
    writeBlackboard(world, guard, { targetVisible: false, stimulus: null });
    run(world, 30);
    expect(read('targetLostS', view(world, guard))).toBe(0.5);
    expect(read('hasStimulus', v)).toBe(0);
    giveCombatant(world, guard, { health: 40 });
    world.set(guard, HealthComponent, { max: 40, current: 10 });
    expect(read('healthFraction', v)).toBe(0.25);
    expect(resolveInput('mood')).toBeUndefined();
  });
});

describe('introspection', () => {
  it('AC-6: returns the active node path and the top-3 scores with their considerations, as serialisable data', () => {
    const def = behaviour({
      states: { unaware: { activities: ['patrol', 'gossip', 'snack', 'stare'] } },
      activities: {
        patrol: {
          steps: [{ do: 'play-cue', cue: 'hum' }, { do: 'follow-route' }],
          considerations: [
            { input: 'trait.diligence', curve: { kind: 'linear', slope: 1, intercept: 0 } },
          ],
        },
        gossip: {
          steps: [{ do: 'wait', seconds: 100 }],
          considerations: [
            {
              input: 'trait.sociability',
              curve: { kind: 'step', at: 0.5, below: 0.1, above: 0.4 },
            },
          ],
        },
        snack: { weight: 0.3, steps: [{ do: 'wait', seconds: 100 }] },
        stare: { weight: 0.2, steps: [{ do: 'wait', seconds: 100 }] },
      },
    });
    const world = aiWorld([def]);
    const guard = agent(
      world,
      undefined,
      { traits: { diligence: 0.8, sociability: 0.6 } },
      {
        origin: {
          creature: 'c',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          patrol: square,
        },
      },
    );
    const before = introspectBrain(world, guard);
    expect(before).toMatchObject({
      state: 'unaware',
      activity: null,
      primitive: null,
      path: ['unaware'],
      scores: [],
    });
    run(world, 66);
    const readout = must(introspectBrain(world, guard));
    expect(readout).toEqual({
      entity: guard,
      behaviour: 'test',
      state: 'unaware',
      timeInState: 1.1,
      postAlert: false,
      activity: 'patrol',
      step: 1,
      primitive: 'follow-route',
      path: ['unaware', 'patrol', '1:follow-route'],
      scores: [
        {
          activity: 'patrol',
          score: 0.9,
          considerations: [
            {
              input: 'trait.diligence',
              value: 0.8,
              curve: { kind: 'linear', slope: 1, intercept: 0 },
            },
          ],
        },
        {
          activity: 'gossip',
          score: 0.4,
          considerations: [
            {
              input: 'trait.sociability',
              value: 0.6,
              curve: { kind: 'step', at: 0.5, below: 0.1, above: 0.4 },
            },
          ],
        },
        { activity: 'snack', score: 0.3, considerations: [] },
      ],
    });
    expect(JSON.parse(JSON.stringify(readout))).toEqual(readout);
    expect(structuredClone(readout)).toEqual(readout);
    expect(introspectBrain(world, world.spawn())).toBeUndefined();
  });
});

describe('brain state is plain data', () => {
  it('a save taken mid-activity and restored into a fresh world continues identically', () => {
    const def = behaviour({
      states: {
        unaware: {
          activities: ['patrol', 'look'],
          transitions: [{ to: 'suspicious', when: { input: 'awareness', gte: 0.5 } }],
        },
        suspicious: {
          activities: ['look'],
          timeoutS: 3,
          onTimeout: 'unaware',
        },
      },
      activities: {
        patrol: { steps: [{ do: 'follow-route', dwellS: 1 }] },
        look: {
          weight: 0.5,
          steps: [{ do: 'look-around', seconds: 2 }, { do: 'forget-stimulus' }],
        },
      },
    });
    const build = () => {
      const world = aiWorld([def]);
      const patrol = {
        origin: {
          creature: 'c',
          at: { x: 0, y: 0, z: 0 },
          facing: { x: 0, y: 0, z: 1 },
          patrol: square,
        },
      };
      return {
        world,
        guards: [
          agent(world, undefined, {}, patrol),
          agent(world, { x: 4, y: 0, z: 4 }, {}, patrol),
        ],
      };
    };
    const script = (world: World<never>, guards: readonly EntityId[], from: number, to: number) => {
      for (let t = from; t < to; t++) {
        if (t === 200)
          writeBlackboard(world, must(guards[1]), {
            awareness: 0.8,
            stimulus: { x: 9, y: 0, z: 9 },
          });
        world.step();
      }
    };
    const straight = build();
    script(straight.world, straight.guards, 0, 600);
    const saved = build();
    script(saved.world, saved.guards, 0, 300);
    const snapshot = JSON.parse(JSON.stringify(saved.world.snapshot())) as WorldSnapshot;
    const loaded = build();
    loaded.world.restore(snapshot);
    script(loaded.world, loaded.guards, 300, 600);
    expect(hashWorld(loaded.world)).toBe(hashWorld(straight.world));
    expect(brain(straight.world, must(straight.guards[1])).state).toBe('unaware');
  });
});

describe('emit-noise on the shared noise channel (mw-e09.22)', () => {
  it('AC-2: a behaviour’s emit-noise step raises noiseEmitted with the agent as its source, which propagation carries to listeners', () => {
    const world = aiWorld([
      only([
        { do: 'emit-noise', db: 70 },
        { do: 'wait', seconds: 10 },
      ]),
    ]);
    installNoisePropagation(world, { graph: buildSoundGraph({ rooms: [], portals: [] }) });
    const emitted: NoiseEvent[] = [];
    const heard: NoiseHeard[] = [];
    world.events.on(noiseEmitted, (n) => emitted.push(n));
    world.events.on(noiseHeard, (h) => heard.push(h));
    const guard = agent(world, { x: 2, y: 0, z: 0 });
    const ear = world.spawn();
    placeEntity(world, ear, { x: 6, y: 0, z: 0 }, 0.4);
    world.add(ear, NoiseListenerComponent, { thresholdDb: 0, range: 40 });
    run(world, 3);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ kind: AI_NOISE_KIND, entity: guard, source: guard });
    // The agent does not hear itself (it is the source); the other listener does.
    expect(heard.map((h) => [h.listener, h.noise.source])).toEqual([[ear, guard]]);
  });
});
