// The behaviour runtime (mw-e11.2, ADR-0005 "Runtime semantics"). One system runs every agent with
// a brain, in two phases per tick:
//
// 1. Think. An agent thinks at its behaviour's `thinkHz` on ticks where (tick + entity) mod period
//    is 0, period = round(hz / thinkHz), so agents with the same rate are staggered by entity id.
//    Thinkers go in ascending entity id. With a think budget (`maxThinksPerTick`), agents past the
//    budget are owed a think and get it on the next ticks before newly due agents, the one that has
//    waited longest (earliest last think, then lowest id) first.
//    A think first moves the machine (the state's timeout, then its transitions in listed order; at
//    most one transition, emitting AlertStateChanged; mw-e11.7), then scores the state's activities
//    (weight × Π curve(input); +inertia for the running one; ties to the earlier-listed; a score of
//    0 never wins; an activity that failed is excluded for its retryAfterS) and switches to the best
//    unless the running one is not interruptible.
// 2. Act. Every agent with a running activity runs its current step, every tick, in ascending
//    entity id. Steps that finish at once chain within the tick. The last step's success makes the
//    activity `done`, a step's failure makes it `failed`; either is read by the next think.
//
// The alert machine (mw-e11.7) takes only moves its table lists. A timeout counts from entering the
// state, or with `timeoutFrom: "stimulus"` from the later of that and the last stimulus. Standing
// down to unaware from a `postAlert` state puts the agent on edge for `postAlertS` (awareness builds
// `postAlertAwarenessRate` times faster, awareness.ts); standing down from a calmer state leaves a
// running window alone. The window is cleared by the first think after it ends.
//
// Staggered (mw-e11.13, combat.ts `isStaggered`): an agent whose action timeline is locked by a hit
// reaction, guard break or Parried stun, or that plays a stagger or worse, does nothing. Its alert
// machine still moves, but it chooses no activity, and its running activity is dropped (its swing,
// if any, the stagger has already broken off). Once the stagger ends its next think chooses afresh.
//
// Leashes (mw-e01.17, leash.ts): before anyone thinks, every tick, a leashed agent in Combat beyond
// its radius drops its target and moves to Searching (cause `leash`), whether or not it is due to
// think; it searches for its `leashSearchS` and then takes Searching's timeout. A leashed agent
// takes no transition into Combat while it believes its target is beyond its leash.
//
// Conversing (mw-e22.9, conversing.ts): an agent in a conversation with the player is skipped
// altogether (its routine paused) until the conversation ends.
//
// All brain state is plain data in `ai.brain`. A despawned agent's brain leaves with it at the end
// of the tick, so from then on nothing runs for it; an agent whose behaviour this world does not
// know is skipped.

import type { AlertState, BehaviourEvent } from '@content/index';
import type { AttackLookup } from '../combat/attacks/executor';
import { HealthComponent } from '../combat/damage/components';
import { isFrozenSolid } from '../elements/actors';
import { GuardComponent, setBlockHeld } from '../combat/melee/components';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import {
  scoreActivity,
  type BehaviourTable,
  type CompiledActivity,
  type CompiledBehaviour,
  type CompiledState,
} from './behaviour';
import { DEFAULT_ATTACK_TOKENS, isStaggered } from './combat';
import { isConversing } from './conversing';
import { AlertStateChanged, BrainComponent, type Blackboard, type Brain } from './components';
import { leashAllows, leashBroken } from './leash';
import { DEFAULT_MEMORY_TUNING, type MemoryTuning } from './memory';
import { straightLineNavigation, type AiNavigation } from './navigation';
import type { StepRunner } from './primitives';
import { at, getIf, got } from './util';
import type { AgentView, AiPorts } from './view';

/** How `installAi` sets AI up. */
export interface AiOptions {
  /** Compiled behaviours (`compileBehaviours`). */
  readonly behaviours: BehaviourTable;
  /** Moves agents; defaults to `straightLineNavigation`. */
  readonly navigation?: AiNavigation;
  /** Attacks the `attack` primitive may start; without it attacks fail. */
  readonly attacks?: AttackLookup;
  /** The most agents that think in one tick (default: no limit). */
  readonly maxThinksPerTick?: number;
  /**
   * The hour of the day, 0–24, that routine windows are read against (the world clock, mw-e27.12);
   * without it windows are not read and every creature walks the first route of its routine.
   */
  readonly hourOfDay?: (world: World<never>) => number;
  /** How target memory decays and predicts (mw-e11.8); defaults to `DEFAULT_MEMORY_TUNING`. */
  readonly memory?: MemoryTuning;
  /**
   * How many creatures may attack one target at once (mw-e11.13, a whole number ≥ 1); defaults to
   * `DEFAULT_ATTACK_TOKENS` (2).
   */
  readonly attackTokens?: number;
}

interface AiRuntime {
  readonly behaviours: BehaviourTable;
  readonly ports: AiPorts;
  readonly maxThinks: number;
}

const runtimes = new WeakMap<World<never>, AiRuntime>();

const ticks = (seconds: number, hz: number): number => Math.round(seconds * hz);

/** Ticks between thinks of `behaviour` at `hz`. */
export function thinkPeriod(behaviour: CompiledBehaviour, hz: number): number {
  return Math.max(1, Math.round(hz / behaviour.thinkHz));
}

function startStep(view: AgentView, runner: StepRunner): void {
  view.brain.stepTick = view.tick;
  view.brain.stepData = [];
  runner.start?.(view);
}

function begin(view: AgentView, activity: CompiledActivity): void {
  view.brain.activity = activity.name;
  view.brain.step = 0;
  startStep(view, at(activity.steps, 0));
}

/** Ticks `brain` has been in `state` by its timeout's clock. */
function timeoutClock(view: AgentView, state: CompiledState): number {
  const { enteredTick, blackboard } = view.brain;
  const since = state.timeoutFromStimulus
    ? Math.max(enteredTick, blackboard.stimulusTick)
    : enteredTick;
  return view.tick - since;
}

function enter(view: AgentView, from: CompiledState, to: AlertState, cause: string): void {
  const brain = view.brain;
  if (to === 'unaware' && from.postAlert !== null) {
    const until = view.tick + ticks(from.postAlert.seconds(view), view.hz);
    brain.postAlertUntil = Math.max(brain.postAlertUntil, until);
    brain.postAlertRate = from.postAlert.rate(view);
  }
  brain.state = to;
  brain.enteredTick = view.tick;
  brain.activity = null;
  brain.step = 0;
  brain.stepData = [];
  brain.retry = [];
  delete brain.leashSearchUntil;
  view.world.events.emit(AlertStateChanged, {
    tick: view.tick,
    entity: view.entity,
    from: from.name,
    to,
    cause,
  });
}

/** Phase 1 for one agent (see the file header). */
function think(view: AgentView, behaviour: CompiledBehaviour): void {
  const { brain, tick } = view;
  brain.thoughtTick = tick;
  if (brain.postAlertUntil >= 0 && tick >= brain.postAlertUntil) {
    brain.postAlertUntil = -1;
    brain.postAlertRate = 1;
  }
  const state = got(behaviour.states, brain.state);
  let next: AlertState | null = null;
  let cause = '';
  const leashSearch = brain.leashSearchUntil;
  if (
    (state.timeout !== null && timeoutClock(view, state) >= ticks(state.timeout(view), view.hz)) ||
    (leashSearch !== undefined && state.onTimeout !== null && tick >= leashSearch)
  ) {
    next = state.onTimeout;
    cause = 'timeout';
  } else {
    for (const t of state.transitions) {
      if (t.to === 'combat' && !leashAllows(view)) continue;
      if (t.test(view)) {
        next = t.to;
        cause = t.cause;
        break;
      }
    }
  }
  brain.ended = null;
  brain.events = [];
  if (next !== null) enter(view, state, next, cause);
  if (isStaggered(view.world, view.entity)) return;

  const current = brain.activity === null ? undefined : behaviour.activities.get(brain.activity);
  if (current !== undefined && !current.interruptible) return;
  const options = got(behaviour.states, brain.state).activities;
  if (brain.retry.length > 0) brain.retry = brain.retry.filter(([, until]) => until > tick);
  let best: CompiledActivity | undefined;
  let bestScore = 0;
  const scores: [string, number][] = [];
  for (const activity of options) {
    let score = brain.retry.some(([name]) => name === activity.name)
      ? 0
      : scoreActivity(activity, view);
    if (score > 0 && activity === current) score += behaviour.inertia;
    scores.push([activity.name, score]);
    if (score > bestScore) {
      bestScore = score;
      best = activity;
    }
  }
  // Stable sort: equal scores keep listed order.
  brain.scores = scores.sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (best === undefined || best === current) return;
  begin(view, best);
}

/**
 * Breaks the agent's leash when it should (leash.ts): it drops its target, forgets its awareness of
 * it, takes the leash edge as its last-known position and enters Searching for `leashSearchS`.
 */
function checkLeash(view: AgentView, behaviour: CompiledBehaviour): void {
  if (!leashBroken(view, behaviour)) return;
  const brain = view.brain;
  const board = brain.blackboard;
  const source = board.targetSource;
  if (source !== null) brain.awareness = brain.awareness.filter((r) => r.source !== source);
  const here = getIf(view.world, view.entity, PlacementComponent) as Vec3; // measured just now
  board.target = null;
  board.targetSource = null;
  board.targetVisible = false;
  board.stimulus = null;
  board.awareness = brain.awareness.reduce((top, r) => Math.max(top, r.level), 0);
  board.lkp = { x: here.x, y: here.y, z: here.z };
  enter(view, got(behaviour.states, 'combat'), 'searching', 'leash');
  brain.leashSearchUntil = view.tick + ticks(behaviour.leashSearch(view), view.hz);
}

/** Phase 2 for one agent (see the file header). */
function act(view: AgentView, behaviour: CompiledBehaviour): void {
  const brain = view.brain;
  if (brain.activity === null) return;
  if (isStaggered(view.world, view.entity)) {
    brain.activity = null;
    brain.step = 0;
    brain.stepData = [];
    return;
  }
  const activity = got(behaviour.activities, brain.activity);
  for (;;) {
    const status = at(activity.steps, brain.step).update(view);
    if (status === 'running') return;
    if (status === 'failure') {
      brain.ended = { activity: activity.name, ok: false };
      brain.retry.push([activity.name, view.tick + ticks(activity.retryAfterS, view.hz)]);
      brain.activity = null;
      return;
    }
    brain.step += 1;
    if (brain.step >= activity.steps.length) {
      brain.ended = { activity: activity.name, ok: true };
      brain.activity = null;
      return;
    }
    startStep(view, at(activity.steps, brain.step));
  }
}

/**
 * Holds the shield of an agent that carries one (mw-ju8.19) up exactly while its current step is a
 * `guard`: any other step, a finished or failed activity or a stagger lowers it, so a guard step
 * cannot leak a raised shield into the swing that follows.
 */
function syncGuard(view: AgentView, behaviour: CompiledBehaviour): void {
  const { world, entity, brain } = view;
  if (!world.isRegistered(GuardComponent) || !world.has(entity, GuardComponent)) return;
  const activity = brain.activity === null ? undefined : behaviour.activities.get(brain.activity);
  setBlockHeld(world, entity, activity?.steps[brain.step]?.primitive === 'guard');
}

/** The AI system (added by `installAi`). */
function aiSystem<TInput>(runtime: AiRuntime): System<TInput> {
  return {
    name: 'ai',
    run(ctx) {
      const world = ctx.world as World<never>;
      const hz = ctx.clock.hz;
      const view: AgentView = {
        world,
        entity: 0,
        brain: undefined as unknown as Brain,
        creature: undefined,
        tuning: {},
        tick: ctx.tick,
        hz,
        ports: runtime.ports,
      };
      const brains = world.query(BrainComponent);
      /** Points the view at an agent; returns its behaviour, or undefined to skip it. */
      const focus = (entity: EntityId, brain: Brain): CompiledBehaviour | undefined => {
        const behaviour = runtime.behaviours.get(brain.behaviour);
        if (behaviour === undefined) return undefined;
        // A creature at zero health is dead: it does not think, move, leash or fight on.
        const health = getIf(world, entity, HealthComponent);
        if (health !== undefined && health.current <= 0) return undefined;
        // Frozen solid, it does nothing until it thaws (mw-e03.24).
        if (isFrozenSolid(world, entity)) return undefined;
        // Talking to the player, it keeps still until the conversation ends (mw-e22.9).
        if (isConversing(world, entity)) return undefined;
        view.entity = entity;
        view.brain = brain;
        view.creature = getIf(world, entity, CreatureComponent);
        view.tuning = behaviour.tuning;
        return behaviour;
      };
      const due = (entity: EntityId, behaviour: CompiledBehaviour): boolean =>
        (ctx.tick + entity) % thinkPeriod(behaviour, hz) === 0;

      brains.forEach((entity, brain) => {
        const behaviour = focus(entity, brain);
        if (behaviour !== undefined) checkLeash(view, behaviour);
      });
      let budget = runtime.maxThinks;
      // Owed thinks first (only a budget creates them), longest-waiting first, then agents due now.
      if (budget !== Infinity) {
        const owed: [EntityId, Brain][] = [];
        brains.forEach((entity, brain) => {
          if (brain.owed) owed.push([entity, brain]);
        });
        owed.sort(([ea, a], [eb, b]) => a.thoughtTick - b.thoughtTick || ea - eb);
        for (const [entity, brain] of owed) {
          const behaviour = budget === 0 ? undefined : focus(entity, brain);
          if (behaviour === undefined) continue;
          brain.owed = false;
          budget--;
          think(view, behaviour);
        }
      }
      brains.forEach((entity, brain) => {
        const behaviour = focus(entity, brain);
        if (behaviour === undefined || brain.thoughtTick === ctx.tick) return;
        if (!due(entity, behaviour)) return;
        if (budget === 0) {
          brain.owed = true;
          return;
        }
        budget--;
        think(view, behaviour);
      });
      brains.forEach((entity, brain) => {
        const behaviour = focus(entity, brain);
        if (behaviour === undefined) return;
        act(view, behaviour);
        syncGuard(view, behaviour);
      });
    },
  };
}

/**
 * Sets AI up in `world`: registers the brain component (if needed), remembers the behaviours and
 * ports, and appends the AI system (run it after perception and before movement and the attack
 * executor). Once per world.
 */
export function installAi<TInput>(world: World<TInput>, options: AiOptions): void {
  const w = world as World<never>;
  if (runtimes.has(w)) throw new Error('AI is already installed in this world');
  const maxThinks = options.maxThinksPerTick ?? Infinity;
  if (!(maxThinks >= 1)) throw new RangeError('maxThinksPerTick must be at least 1');
  const attackTokens = options.attackTokens ?? DEFAULT_ATTACK_TOKENS;
  if (!(Number.isInteger(attackTokens) && attackTokens >= 1)) {
    throw new RangeError('attackTokens must be a whole number of at least 1');
  }
  if (!world.isRegistered(BrainComponent)) world.register(BrainComponent);
  const runtime: AiRuntime = {
    behaviours: options.behaviours,
    ports: {
      navigation: options.navigation ?? straightLineNavigation,
      attacks: options.attacks,
      hourOfDay: options.hourOfDay,
      memory: options.memory ?? DEFAULT_MEMORY_TUNING,
      attackTokens,
    },
    maxThinks,
  };
  runtimes.set(w, runtime);
  world.addSystem(aiSystem(runtime));
}

/** The compiled behaviour `id` of `world`'s AI, or undefined (also when AI is not installed). */
export function aiBehaviour(world: World<never>, id: string): CompiledBehaviour | undefined {
  return runtimes.get(world)?.behaviours.get(id);
}

/** The ports of `world`'s AI (AI must be installed). */
export function aiPorts(world: World<never>): AiPorts {
  return got(runtimes, world).ports;
}

/** The memory tuning of `world`'s AI (the default when AI is not installed). */
export function memoryTuning(world: World<never>): MemoryTuning {
  return runtimes.get(world)?.ports.memory ?? DEFAULT_MEMORY_TUNING;
}

/** What an agent's brain starts from. */
export interface BrainSpec {
  /** Behaviour id (must be compiled into the world's AI). */
  readonly behaviour: string;
  /** Personality traits, 0–1 (missing = 0.5). */
  readonly traits?: Readonly<Record<string, number>>;
  /** Speed per gait, m/s (default: it does not move). */
  readonly gaits?: Readonly<Brain['gaits']>;
}

/**
 * Gives `entity` a fresh brain running `spec.behaviour` from its initial state. Structural: during
 * a step the brain exists from the end of the tick. Throws when AI is not installed or the
 * behaviour is unknown.
 */
export function giveBrain(world: World<never>, entity: EntityId, spec: BrainSpec): void {
  const behaviour = aiBehaviour(world, spec.behaviour);
  if (behaviour === undefined) {
    throw new RangeError(`unknown behaviour "${spec.behaviour}" (is AI installed?)`);
  }
  const { sneak, walk, run } = spec.gaits ?? { sneak: 0, walk: 0, run: 0 };
  world.add(entity, BrainComponent, {
    behaviour: behaviour.id,
    state: behaviour.initial,
    enteredTick: world.tick,
    activity: null,
    step: 0,
    stepTick: world.tick,
    stepData: [],
    ended: null,
    retry: [],
    events: [],
    owed: false,
    thoughtTick: -1,
    scores: [],
    traits: { ...spec.traits },
    gaits: { sneak, walk, run },
    blackboard: {
      awareness: 0,
      stimulus: null,
      stimulusTick: -1,
      target: null,
      targetSource: null,
      targetVisible: false,
      targetSeenTick: -1,
      lkp: null,
      waypoint: 0,
    },
    awareness: [],
    memory: [],
    postAlertUntil: -1,
    postAlertRate: 1,
    routeDir: 1,
  });
}

/** `entity`'s brain (live: read it, do not keep it), or undefined. */
export function brainOf(world: World<never>, entity: EntityId): Readonly<Brain> | undefined {
  return getIf(world, entity, BrainComponent);
}

/** A blackboard update; positions are copied, and the ticks are recorded by the write. */
export type BlackboardPatch = Partial<
  Readonly<Omit<Blackboard, 'stimulus' | 'lkp' | 'stimulusTick' | 'targetSeenTick'>>
> & {
  readonly stimulus?: Vec3 | null;
  readonly lkp?: Vec3 | null;
};

const copy = (p: Vec3 | null): Vec3 | null => (p === null ? null : { x: p.x, y: p.y, z: p.z });

/**
 * Writes `patch` into `entity`'s blackboard (awareness calls this). A stimulus records the tick it
 * was written, and seeing the target (`targetVisible: true`) the tick it was seen. Returns false
 * when `entity` has no brain.
 */
export function writeBlackboard(
  world: World<never>,
  entity: EntityId,
  patch: BlackboardPatch,
): boolean {
  const brain = getIf(world, entity, BrainComponent);
  if (brain === undefined) return false;
  const { stimulus, lkp, ...rest } = patch;
  const board = brain.blackboard;
  Object.assign(board, rest);
  if (stimulus !== undefined) {
    board.stimulus = copy(stimulus);
    if (stimulus !== null) board.stimulusTick = world.tick;
  }
  if (lkp !== undefined) board.lkp = copy(lkp);
  if (patch.targetVisible === true) board.targetSeenTick = world.tick;
  return true;
}

/**
 * Queues external event `event` on `entity`'s brain for its next think (`{ "event": … }`
 * conditions); an event already queued is not queued twice. Returns false without a brain.
 */
export function queueAiEvent(
  world: World<never>,
  entity: EntityId,
  event: BehaviourEvent,
): boolean {
  const brain = getIf(world, entity, BrainComponent);
  if (brain === undefined) return false;
  if (!brain.events.includes(event)) brain.events.push(event);
  return true;
}
