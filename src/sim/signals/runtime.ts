// Running signal graphs in the world (mw-e03.21). Each placed graph is one entity holding a
// `signal.graph` component: the graph definition (a plain copy, already moved to its origin), the
// level entities its nodes are bound to, and every node's state. All of it is plain data, so graphs
// are part of snapshots, state hashes and saves like any other component.
//
// Once per tick `signalSystem` evaluates every graph (ascending entity id) in its compiled order
// (graph.ts): trigger volumes collect the placed entities that overlap them and pass their filter,
// sensors test their bound entity, logic nodes combine the results, and receivers report changes of
// their input through `signalReceived` in that same order — the emitted signal order is a pure
// function of the graph and the world. Fact receivers also write their world fact (mw-e27.1): the
// bool fact named by `key` follows the receiver's input, set on the tick the input changes. Levers and buttons are set from outside (`setLever`,
// `pressButton`): the mechanism components (mw-e03.18) call them when a lever is pulled, and the
// graph sees the new state on its next evaluation. Place the system after the rules that move
// entities and change their properties (stimuli, elements), so volumes and sensors see this tick's
// world.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import {
  addProperties,
  hasProperty,
  readProperty,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import type { WorldPropertyKey } from '../properties/spec';
import { PlacementComponent } from '../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../stimulus/shapes';
import { matchesFilter, TagsComponent } from './filter';
import {
  compileSignalGraph,
  REGISTERED_KINDS,
  SIGNAL_NODE_KINDS,
  signalPorts,
  translateShape,
  type CompiledSignalGraph,
  type OutputKey,
  type SignalGraphDef,
  type SignalNodeDef,
  type SignalNodeKind,
  type SignalReceiverKind,
} from './graph';

interface VolumeState {
  readonly occupants: readonly EntityId[];
}
interface SwitchState {
  readonly on: boolean;
}
interface ButtonState {
  readonly pressed: boolean;
}
interface EdgeState {
  readonly last: boolean;
}
interface LatchState extends SwitchState, EdgeState {}
interface DelayState extends EdgeState {
  readonly out: boolean;
  /** Scheduled output changes: [tick due, value], in due order. */
  readonly pending: readonly (readonly [number, boolean])[];
}
interface TimerState extends EdgeState {
  /** First tick the output is off again. */
  readonly until: number;
}
interface CounterState extends EdgeState {
  readonly count: number;
}
interface SequenceState {
  /** Steps completed so far. */
  readonly progress: number;
  /** Last input per step. */
  readonly last: readonly boolean[];
}
interface ReceiverState {
  readonly value: boolean;
}
interface ClueState extends EdgeState {
  /** Tick the playing run began, or -1 when idle. */
  readonly start: number;
  /** Cues of the run already sounded. */
  readonly next: number;
}

/** One node's stored state (its shape depends on the node's kind). */
export type SignalNodeState =
  | VolumeState
  | SwitchState
  | ButtonState
  | EdgeState
  | LatchState
  | DelayState
  | TimerState
  | CounterState
  | SequenceState
  | ReceiverState
  | ClueState
  | Readonly<Record<string, never>>;

/** A placed graph: the `signal.graph` component's value. */
export interface SignalGraphInstance {
  readonly graph: SignalGraphDef;
  /** Binding name (level entity key) → entity. */
  readonly bindings: Readonly<Record<string, EntityId>>;
  /** Node id → state. */
  readonly nodes: Readonly<Record<string, SignalNodeState>>;
  /** `node.port` → its value at the last evaluation (absent = false). */
  readonly outputs: Readonly<Record<OutputKey, boolean>>;
}

function initialState(node: SignalNodeDef): SignalNodeState {
  switch (node.kind) {
    case 'volume':
      return { occupants: [] };
    case 'lever':
      return { on: node.initial === true };
    case 'button':
      return { pressed: false };
    case 'latch':
      return { on: node.initial === true, last: false };
    case 'delay':
      return { out: false, last: false, pending: [] };
    case 'timer':
      return { last: false, until: 0 };
    case 'counter':
      return { count: 0, last: false };
    case 'sequence':
      return { progress: 0, last: node.steps.map(() => false) };
    case 'clue':
      return { last: false, start: -1, next: 0 };
    case 'receiver':
    case 'set-property':
      return { value: false };
    case 'pulse':
    case 'random':
      return { last: false };
    default:
      return {};
  }
}

const isEntityId = (value: unknown): value is EntityId =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The bindings a compiled graph needs, checked and in sorted order. */
function checkBindings(
  compiled: CompiledSignalGraph,
  bindings: unknown,
): Readonly<Record<string, EntityId>> {
  const given = (typeof bindings === 'object' && bindings !== null ? bindings : {}) as Record<
    string,
    unknown
  >;
  const missing = compiled.bindings.filter((name) => !isEntityId(given[name]));
  if (missing.length > 0) {
    throw new RangeError(
      `signal graph "${compiled.def.id}" needs an entity id for binding(s): ${missing.join(', ')}`,
    );
  }
  const unused = Object.keys(given).filter((name) => !compiled.bindings.includes(name));
  if (unused.length > 0) {
    throw new RangeError(
      `signal graph "${compiled.def.id}" has no node bound to: ${unused.sort().join(', ')}`,
    );
  }
  return Object.fromEntries(compiled.bindings.map((name) => [name, given[name] as EntityId]));
}

function restoreInstance(data: unknown): SignalGraphInstance {
  const { graph, bindings, nodes, outputs } = (data ?? {}) as Record<string, unknown>;
  if (typeof graph !== 'object' || graph === null) {
    throw new RangeError('signal graph instance must have a graph');
  }
  const compiled = compileSignalGraph(graph as SignalGraphDef);
  const states = (typeof nodes === 'object' && nodes !== null ? nodes : {}) as Record<
    string,
    unknown
  >;
  const stateless = compiled.def.nodes.filter(
    (node) => typeof states[node.id] !== 'object' || states[node.id] === null,
  );
  if (stateless.length > 0 || typeof outputs !== 'object' || outputs === null) {
    throw new RangeError(`signal graph "${compiled.def.id}" instance has missing node state`);
  }
  return {
    graph: compiled.def,
    bindings: checkBindings(compiled, bindings),
    nodes: states as Record<string, SignalNodeState>,
    outputs: outputs as Record<OutputKey, boolean>,
  };
}

/** The placed-graph component (`signal.graph`; a snapshot and save key, never renamed). */
export const SignalGraphComponent = defineComponent<SignalGraphInstance>('signal.graph', {
  deserialize: restoreInstance,
});

/** An entity entering or leaving a trigger volume (it started or stopped overlapping and passing). */
export interface VolumeCrossing {
  /** The graph's entity. */
  readonly graph: EntityId;
  /** The graph definition's id. */
  readonly graphId: string;
  /** The volume node's id. */
  readonly node: string;
  readonly entity: EntityId;
  readonly tick: number;
}

/** Fired when an entity becomes an occupant of a trigger volume (puzzle discovery, quests, AI). */
export const volumeEntered = defineEvent<VolumeCrossing>('volumeEntered');
/** Fired when an occupant leaves, stops passing the filter or is destroyed. */
export const volumeExited = defineEvent<VolumeCrossing>('volumeExited');

/** A receiver's input changed. */
export interface SignalReceipt {
  readonly graph: EntityId;
  readonly graphId: string;
  readonly node: string;
  readonly receiver: SignalReceiverKind | 'set-property';
  /** The bound entity, or null for keyed receivers (fact, audio-cue). */
  readonly entity: EntityId | null;
  /** The fact key or cue id, or null. */
  readonly key: string | null;
  readonly value: boolean;
  readonly tick: number;
}

/**
 * Fired whenever a receiver's input changes, in evaluation order: doors open and close, lights turn
 * on and off, spawners and audio cues fire on `value: true`, fact setters write world facts.
 */
export const signalReceived = defineEvent<SignalReceipt>('signalReceived');

/** One cue of a clue node's run sounded (mw-e15.5). */
export interface SoundClueCue {
  readonly graph: EntityId;
  readonly graphId: string;
  readonly node: string;
  /** The sound's source (the node's bound entity), or null when it has none. */
  readonly entity: EntityId | null;
  /** The cue id, e.g. `chime-high`. */
  readonly cue: string;
  /** Position in the run (0-based) and the run's length. */
  readonly index: number;
  readonly count: number;
  readonly tick: number;
}

/**
 * Fired for each cue of a clue node, in order, `spacing` apart. Presentation (a cue sheet) turns it
 * into a positional sound and a sound caption; the sim itself stays silent.
 */
export const soundClueCued = defineEvent<SoundClueCue>('soundClueCued');

/**
 * Makes `world` run signal graphs: registers the graph and tag components. Call once at setup,
 * outside a step, after `installStimuli` (volumes read entity placements).
 */
export function installSignals<W extends World<never>>(world: W): W {
  world.register(SignalGraphComponent, TagsComponent);
  return world;
}

/** Where and how to place a graph. */
export interface SignalGraphOptions {
  /** Binding name → the level entity it means; every `entity` a node names must be bound. */
  readonly bindings?: Readonly<Record<string, EntityId>>;
  /** Added to every volume shape (a graph authored as a prefab around the origin). */
  readonly origin?: Vec3;
}

/** A plain copy of `def` with only graph fields, its volumes moved by `origin`. */
function placeGraph(def: SignalGraphDef, origin: Vec3 | undefined): SignalGraphDef {
  const copy: SignalGraphDef = structuredClone({
    id: def.id,
    nodes: def.nodes,
    wires: def.wires.map(({ from, to }) => ({ from, to })),
  });
  if (origin === undefined) return copy;
  return {
    ...copy,
    nodes: copy.nodes.map((node) =>
      node.kind === 'volume' ? { ...node, shape: translateShape(node.shape, origin) } : node,
    ),
  };
}

/**
 * Places a graph in the world as a new entity and returns it. Throws a SignalGraphError for an
 * invalid graph and a RangeError for a missing or unknown binding. Nodes start in their initial
 * state; the first evaluation brings receivers up to date (a door behind a `not` opens on tick one).
 */
export function addSignalGraph(
  world: World<never>,
  def: SignalGraphDef,
  options: SignalGraphOptions = {},
): EntityId {
  const compiled = compileSignalGraph(placeGraph(def, options.origin));
  const bindings = checkBindings(compiled, options.bindings);
  const entity = world.spawn();
  world.add(entity, SignalGraphComponent, {
    graph: compiled.def,
    bindings,
    nodes: Object.fromEntries(compiled.def.nodes.map((node) => [node.id, initialState(node)])),
    outputs: {},
  });
  return entity;
}

/** The instance on `graph`; throws when the entity holds no signal graph. */
export function signalGraphOf(world: World<never>, graph: EntityId): SignalGraphInstance {
  const instance = world.get(graph, SignalGraphComponent);
  if (instance === undefined) throw new Error(`entity ${String(graph)} holds no signal graph`);
  return instance;
}

function nodeOf(
  instance: SignalGraphInstance,
  id: string,
  kinds: readonly SignalNodeKind[],
): SignalNodeDef {
  const node = instance.graph.nodes.find((n) => n.id === id);
  if (node === undefined)
    throw new Error(`signal graph "${instance.graph.id}" has no node "${id}"`);
  if (!kinds.includes(node.kind)) {
    throw new Error(`node "${id}" is a ${node.kind}, not a ${kinds.join(' or ')}`);
  }
  return node;
}

function writeState(
  world: World<never>,
  graph: EntityId,
  instance: SignalGraphInstance,
  id: string,
  state: SignalNodeState,
): void {
  world.set(graph, SignalGraphComponent, {
    ...instance,
    nodes: { ...instance.nodes, [id]: state },
  });
}

/**
 * Sets lever `node` of `graph` on or off; the graph sees it at its next evaluation. Returns whether
 * the state changed. Throws when the node doesn't exist or is not a lever.
 */
export function setLever(world: World<never>, graph: EntityId, node: string, on: boolean): boolean {
  const instance = signalGraphOf(world, graph);
  nodeOf(instance, node, ['lever']);
  if ((instance.nodes[node] as SwitchState).on === on) return false;
  writeState(world, graph, instance, node, { on });
  return true;
}

/** Flips lever `node` of `graph`; returns its new state. */
export function toggleLever(world: World<never>, graph: EntityId, node: string): boolean {
  const instance = signalGraphOf(world, graph);
  nodeOf(instance, node, ['lever']);
  const on = !(instance.nodes[node] as SwitchState).on;
  writeState(world, graph, instance, node, { on });
  return on;
}

/** Presses button `node` of `graph`: its output pulses at the next evaluation (presses don't stack). */
export function pressButton(world: World<never>, graph: EntityId, node: string): void {
  const instance = signalGraphOf(world, graph);
  nodeOf(instance, node, ['button']);
  writeState(world, graph, instance, node, { pressed: true });
}

/**
 * The value of output `port` (default: the node's first) of `node` at the last evaluation — what a
 * puzzle goal or quest reads. Throws for an unknown node or port.
 */
export function signalOutput(
  world: World<never>,
  graph: EntityId,
  node: string,
  port?: string,
): boolean {
  const instance = signalGraphOf(world, graph);
  const def = nodeOf(instance, node, SIGNAL_NODE_KINDS);
  const { outputs } = signalPorts(def);
  const name = port ?? outputs[0];
  if (name === undefined || !outputs.includes(name)) {
    throw new Error(`node "${node}" has no output port "${port ?? ''}"`);
  }
  return instance.outputs[`${node}.${name}`] === true;
}

/** The entities inside volume `node` of `graph` at the last evaluation, ascending id. */
export function volumeOccupants(
  world: World<never>,
  graph: EntityId,
  node: string,
): readonly EntityId[] {
  const instance = signalGraphOf(world, graph);
  nodeOf(instance, node, ['volume']);
  return (instance.nodes[node] as VolumeState).occupants;
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
function known<T>(value: T | undefined): T {
  return value as T;
}

/** Ticks for `seconds` at `hz` (at least one). */
const ticksFor = (seconds: number, hz: number): number => Math.max(1, Math.round(seconds * hz));

/** Writes property values in key order: set when the entity has the property, else add it. */
function writeProperties(world: World<never>, entity: EntityId, init: WorldPropertyInit): void {
  for (const key of Object.keys(init).sort() as WorldPropertyKey[]) {
    const value = known(init[key]);
    if (hasProperty(world, entity, key)) setProperty(world, entity, key, value);
    else addProperties(world, entity, { [key]: value });
  }
}

/** Evaluates one graph for this tick and returns its next state. */
function evaluate(world: World<never>, graph: EntityId, instance: SignalGraphInstance) {
  const compiled = compileSignalGraph(instance.graph);
  const { def, inputs, order } = compiled;
  const tick = world.tick;
  const values = new Map<OutputKey, boolean>();
  const states: Record<string, SignalNodeState> = { ...instance.nodes };
  const out = (node: SignalNodeDef, port: string, value: boolean) =>
    values.set(`${node.id}.${port}`, value);
  const operands = (i: number, port: string): boolean[] =>
    known(known(inputs[i])[port]).map((key) => values.get(key) === true);
  const read = (i: number, port: string): boolean => operands(i, port).includes(true);
  const crossing = { graph, graphId: def.id, tick };
  const receive = (
    node: SignalNodeDef,
    value: boolean,
    entity: EntityId | null,
    key: string | null,
  ) => {
    const receiver = node.kind === 'receiver' ? node.receiver : 'set-property';
    world.events.emit(signalReceived, { ...crossing, node: node.id, receiver, entity, key, value });
  };
  const bound = (name: string | undefined): EntityId | null =>
    name === undefined ? null : known(instance.bindings[name]);

  // Registered nodes show their stored state before anything else runs.
  def.nodes.forEach((node) => {
    const state = states[node.id];
    if (node.kind === 'latch') out(node, 'out', (state as LatchState).on);
    if (node.kind === 'delay') {
      const { pending } = state as DelayState;
      const due = pending.filter(([at]) => at <= tick);
      const last = due[due.length - 1];
      const value = last === undefined ? (state as DelayState).out : last[1];
      states[node.id] = {
        ...(state as DelayState),
        out: value,
        pending: pending.slice(due.length),
      };
      out(node, 'out', value);
    }
  });

  for (const i of order) {
    const node = known(def.nodes[i]);
    const state = states[node.id];
    switch (node.kind) {
      case 'volume': {
        const before = (state as VolumeState).occupants;
        const occupants: EntityId[] = [];
        let weight = 0;
        const filter = node.filter ?? [];
        world.query(PlacementComponent).forEach((entity, at) => {
          if (shapeFalloff(node.shape, 'none', at, at.radius) === undefined) return;
          if (!matchesFilter(world, entity, filter)) return;
          occupants.push(entity);
          weight += readProperty(world, entity, 'weight');
        });
        const entered = occupants.filter((e) => !before.includes(e));
        const exited = before.filter((e) => !occupants.includes(e));
        for (const entity of entered)
          world.events.emit(volumeEntered, { ...crossing, node: node.id, entity });
        for (const entity of exited)
          world.events.emit(volumeExited, { ...crossing, node: node.id, entity });
        const enough = occupants.length >= (node.minCount ?? 1);
        out(node, 'active', enough && weight >= (node.minWeight ?? 0));
        out(node, 'stay', occupants.length > 0);
        out(node, 'enter', entered.length > 0);
        out(node, 'exit', exited.length > 0);
        states[node.id] = { occupants };
        break;
      }
      case 'lever':
        out(node, 'out', (state as SwitchState).on);
        break;
      case 'button':
        out(node, 'out', (state as ButtonState).pressed);
        states[node.id] = { pressed: false };
        break;
      case 'sensor': {
        const entity = known(instance.bindings[node.entity]);
        out(node, 'out', world.isAlive(entity) && matchesFilter(world, entity, node.filter));
        break;
      }
      case 'and':
        out(node, 'out', !operands(i, 'in').includes(false));
        break;
      case 'or':
        out(node, 'out', read(i, 'in'));
        break;
      case 'xor':
        out(node, 'out', operands(i, 'in').filter(Boolean).length % 2 === 1);
        break;
      case 'not':
        out(node, 'out', !read(i, 'in'));
        break;
      case 'timer': {
        const input = read(i, 'in');
        const { last, until } = state as TimerState;
        const restart = input && !last && (node.retrigger !== false || tick >= until);
        const end = restart ? tick + ticksFor(node.seconds, world.clock.hz) : until;
        out(node, 'out', tick < end);
        states[node.id] = { last: input, until: end };
        break;
      }
      case 'pulse': {
        const input = read(i, 'in');
        const { last } = state as EdgeState;
        const edge = node.edge ?? 'rising';
        const rising = input && !last;
        const falling = !input && last;
        out(
          node,
          'out',
          edge === 'rising' ? rising : edge === 'falling' ? falling : rising || falling,
        );
        states[node.id] = { last: input };
        break;
      }
      case 'counter': {
        const input = read(i, 'in');
        const { count, last } = state as CounterState;
        const next = read(i, 'reset') ? 0 : Math.min(node.target, count + (input && !last ? 1 : 0));
        out(node, 'out', next >= node.target);
        states[node.id] = { count: next, last: input };
        break;
      }
      case 'sequence': {
        const { last } = state as SequenceState;
        let progress = read(i, 'reset') ? 0 : (state as SequenceState).progress;
        let success = false;
        let failed = false;
        const now = node.steps.map((step) => read(i, step));
        now.forEach((input, step) => {
          if (!input || last[step] === true) return;
          if (step === progress) {
            progress++;
          } else {
            failed = true;
            progress = step === 0 ? 1 : 0;
          }
          if (progress === node.steps.length) {
            success = true;
            progress = 0;
          }
        });
        out(node, 'success', success);
        out(node, 'failed', failed);
        states[node.id] = { progress, last: now };
        break;
      }
      case 'random': {
        const input = read(i, 'in');
        const { last } = state as EdgeState;
        const chosen =
          input && !last
            ? world.random(`signals.${String(graph)}`).int(0, node.outcomes.length - 1)
            : -1;
        node.outcomes.forEach((outcome, k) => out(node, outcome, k === chosen));
        states[node.id] = { last: input };
        break;
      }
      case 'clue': {
        const input = read(i, 'in');
        const { last } = state as ClueState;
        let { start, next } = state as ClueState;
        if (input && !last && start < 0) {
          start = tick;
          next = 0;
        }
        const step = ticksFor(node.spacing ?? 1, world.clock.hz);
        while (start >= 0 && next < node.cues.length && tick >= start + next * step) {
          world.events.emit(soundClueCued, {
            ...crossing,
            node: node.id,
            entity: bound(node.entity),
            cue: known(node.cues[next]),
            index: next,
            count: node.cues.length,
          });
          next++;
        }
        if (next >= node.cues.length) start = -1;
        out(node, 'out', start >= 0);
        states[node.id] = { last: input, start, next };
        break;
      }
      case 'receiver': {
        const input = read(i, 'in');
        if (input === (state as ReceiverState).value) break;
        // A fact setter mirrors its input into a bool fact on this tick (latch it to keep it).
        if (node.receiver === 'fact') world.facts.set(known(node.key), input, { source: graph });
        receive(node, input, bound(node.entity), node.key ?? null);
        states[node.id] = { value: input };
        break;
      }
      case 'set-property': {
        const input = read(i, 'in');
        if (input === (state as ReceiverState).value) break;
        const entity = known(instance.bindings[node.entity]);
        const values = input ? node.on : node.off;
        if (values !== undefined && world.isAlive(entity)) writeProperties(world, entity, values);
        receive(node, input, entity, null);
        states[node.id] = { value: input };
        break;
      }
      default:
        break; // delay and latch: already shown, updated below
    }
  }

  // Registered nodes take in this tick's inputs for later ticks.
  def.nodes.forEach((node, i) => {
    if (!REGISTERED_KINDS.includes(node.kind)) return;
    if (node.kind === 'delay') {
      const state = states[node.id] as DelayState;
      const input = read(i, 'in');
      if (input === state.last) return;
      const due = tick + ticksFor(node.seconds, world.clock.hz);
      states[node.id] = { ...state, last: input, pending: [...state.pending, [due, input]] };
      return;
    }
    const { on, last } = states[node.id] as LatchState;
    const toggle = read(i, 'toggle');
    const flipped = toggle && !last ? !on : on;
    const next = read(i, 'reset') ? false : read(i, 'set') ? true : flipped;
    states[node.id] = { on: next, last: toggle };
  });

  return { ...instance, nodes: states, outputs: Object.fromEntries(values) };
}

/**
 * Evaluates every signal graph once, in ascending entity id order (see the file header). Normally
 * run once per tick by `signalSystem`.
 */
export function evaluateSignalGraphs(world: World<never>): void {
  const graphs: EntityId[] = [...world.query(SignalGraphComponent).ids()];
  for (const graph of graphs) {
    world.set(graph, SignalGraphComponent, evaluate(world, graph, signalGraphOf(world, graph)));
  }
}

/** The system that evaluates signal graphs; add it after movement, stimuli and element rules. */
export function signalSystem<TInput>(): System<TInput> {
  return {
    name: 'signals',
    run: ({ world }) => {
      evaluateSignalGraphs(world);
    },
  };
}
