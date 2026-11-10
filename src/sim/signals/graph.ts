// Signal graph definitions and their compilation (mw-e03.21). Designers wire trigger volumes, levers,
// buttons and property sensors through logic nodes to receivers (doors, lights, spawners, audio cues,
// world facts, property setters) in data, never in code. This module is the sim's definition of that
// data: the node kinds and their ports, the checks a graph must pass before it can run, and the
// canonical evaluation order. The content layer mirrors it as a zod schema
// (src/content/types/signal-graph.ts); tests/contracts keeps the two in agreement.
//
// Signals are booleans. A *level* stays true while its cause holds (a plate is weighed down); a
// *pulse* is true for exactly one tick (something entered, a button was pressed). A wire is written
// `"node"` or `"node.port"`; the bare form means the node's first port. Several wires into one port
// read as their OR, except the operands of and / or / xor, where each wire is one operand.
//
// Evaluation order is topological, ties broken by node id, so the order of nodes in a file never
// matters. Every node sees its inputs from the same tick, except delay and latch, whose output is
// their stored state from earlier ticks ("registered" nodes). They are the only way to close a loop:
// a cycle that does not pass through one would oscillate within a tick, so compilation rejects it
// and names the nodes.

import { FactKeyError, isFactKey } from '../facts/store';
import type { WorldPropertyInit } from '../properties/components';
import {
  assertProperty,
  isWorldPropertyKey,
  PROPERTY_ID_PATTERN,
  WORLD_PROPERTY_SPECS,
  type WorldPropertyKey,
} from '../properties/spec';
import type { BoxShape, CapsuleShape, SphereShape, Vec3 } from '../stimulus/shapes';
import { normalizeShape } from '../stimulus/shapes';

/** Every node kind, in documentation order. */
export const SIGNAL_NODE_KINDS = [
  'volume',
  'lever',
  'button',
  'sensor',
  'and',
  'or',
  'xor',
  'not',
  'delay',
  'timer',
  'pulse',
  'latch',
  'counter',
  'sequence',
  'random',
  'receiver',
  'set-property',
] as const;

/** A node kind. */
export type SignalNodeKind = (typeof SIGNAL_NODE_KINDS)[number];

/** What a `receiver` node drives; the system that owns each one subscribes to `signalReceived`. */
export const SIGNAL_RECEIVERS = [
  'door',
  'light',
  'spawner',
  'audio-cue',
  'fact',
  'mechanism',
] as const;

/** A receiver kind. */
export type SignalReceiverKind = (typeof SIGNAL_RECEIVERS)[number];

/** Receivers that act on a bound entity (the others are keyed by `key`: a fact or a cue id). */
export const ENTITY_RECEIVERS: readonly SignalReceiverKind[] = [
  'door',
  'light',
  'spawner',
  'mechanism',
];

/** Comparison operators of a property predicate (ordering ones only apply to number properties). */
export const PREDICATE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;

/** A predicate operator. */
export type PredicateOp = (typeof PREDICATE_OPS)[number];

/**
 * Element presence on an entity, as shorthand for the property it shows in: fire = burning,
 * water = wetness > 0, ice = frozen, charge = charge > 0.
 */
export const SIGNAL_ELEMENTS = ['fire', 'water', 'ice', 'charge'] as const;

/** An element a filter can test for. */
export type SignalElement = (typeof SIGNAL_ELEMENTS)[number];

/** Which edges a pulse node fires on. */
export const PULSE_EDGES = ['rising', 'falling', 'both'] as const;

/** A pulse node's edge. */
export type PulseEdge = (typeof PULSE_EDGES)[number];

/** Compares one world property of an entity (its stored value, or the default when absent). */
export interface PropertyPredicate {
  readonly test: 'property';
  readonly property: WorldPropertyKey;
  readonly op: PredicateOp;
  readonly value: number | boolean | string;
}
/** The entity carries a tag (e.g. `player`, `actor`); see tags.ts. */
export interface TagPredicate {
  readonly test: 'tag';
  readonly tag: string;
}
/** The entity shows an element (see SIGNAL_ELEMENTS). */
export interface ElementPredicate {
  readonly test: 'element';
  readonly element: SignalElement;
}

/**
 * The compass directions a facing test names: north is +z, east +x, south -z, west -x (the way the
 * hall of the demo scene runs), and a turn of +90° (a rotate step) takes north to east.
 */
export const FACINGS = ['north', 'east', 'south', 'west'] as const;

/** A compass direction. */
export type Facing = (typeof FACINGS)[number];

/**
 * The entity's physics body faces this way (mw-e15.4): the nearest compass direction of where its
 * front (+z before any turn) points now. A statue turned by the push rules reads as another facing.
 */
export interface FacingPredicate {
  readonly test: 'facing';
  readonly facing: Facing;
}

/** One condition of a filter. Filters read properties, tags and facing, never object type ids. */
export type SignalPredicate = PropertyPredicate | TagPredicate | ElementPredicate | FacingPredicate;

/** A trigger volume's shape, in world coordinates (or relative to the graph's origin, see runtime). */
export type VolumeShape = BoxShape | SphereShape | CapsuleShape;

interface NodeBase {
  /** Unique within the graph; lowercase kebab-case. */
  readonly id: string;
  /**
   * The node's outputs are read by code outside the graph (a puzzle goal, a quest), so leaving them
   * unwired is intended. Only the content validator reads it.
   */
  readonly observed?: boolean;
}

/**
 * A trigger volume. Entities with a placement that overlap the shape and pass every predicate of
 * `filter` are its occupants. Outputs: `active` (level: at least `minCount` occupants weighing at
 * least `minWeight` kg in total — a pressure plate), `stay` (level: any occupant), `enter` and `exit`
 * (pulses on the tick an occupant arrives or leaves).
 */
export interface VolumeNode extends NodeBase {
  readonly kind: 'volume';
  readonly shape: VolumeShape;
  readonly filter?: readonly SignalPredicate[];
  /** Default 1. */
  readonly minCount?: number;
  /** Total occupant `weight`, kg; default 0. */
  readonly minWeight?: number;
}
/** A two-state switch set from outside the graph (`setLever`); output `out` is its state. */
export interface LeverNode extends NodeBase {
  readonly kind: 'lever';
  /** Default false (off). */
  readonly initial?: boolean;
  /** The level entity the lever is (informational; mechanisms find their node through it). */
  readonly entity?: string;
}
/** A momentary switch (`pressButton`); output `out` pulses on the tick after a press. */
export interface ButtonNode extends NodeBase {
  readonly kind: 'button';
  readonly entity?: string;
}
/** Watches one bound entity: `out` is true while it is alive and passes every predicate. */
export interface SensorNode extends NodeBase {
  readonly kind: 'sensor';
  readonly entity: string;
  readonly filter: readonly SignalPredicate[];
}
/** and / or / xor: each wire into `in` is one operand (at least two). not: exactly one wire. */
export interface GateNode extends NodeBase {
  readonly kind: 'and' | 'or' | 'xor' | 'not';
}
/** `out` repeats `in` from `seconds` earlier (registered: may close a loop). */
export interface DelayNode extends NodeBase {
  readonly kind: 'delay';
  readonly seconds: number;
}
/** On a rising edge of `in`, `out` is true for `seconds`; a new edge restarts it unless not `retrigger`. */
export interface TimerNode extends NodeBase {
  readonly kind: 'timer';
  readonly seconds: number;
  /** Default true. */
  readonly retrigger?: boolean;
}
/** `out` is a one-tick pulse on each chosen edge of `in`. */
export interface PulseNode extends NodeBase {
  readonly kind: 'pulse';
  /** Default `rising`. */
  readonly edge?: PulseEdge;
}
/**
 * Remembers a state (registered: may close a loop). Inputs `set`, `reset` (levels; reset wins) and
 * `toggle` (rising edge flips it). `out` shows the state from the previous tick.
 */
export interface LatchNode extends NodeBase {
  readonly kind: 'latch';
  readonly initial?: boolean;
}
/** Counts rising edges of `in` up to `target`; `out` is true once reached; `reset` clears it. */
export interface CounterNode extends NodeBase {
  readonly kind: 'counter';
  readonly target: number;
}
/**
 * Expects rising edges on its step ports in order (edges in one tick count in step order). The last
 * step pulses `success` and restarts; an out-of-order edge pulses `failed` and restarts (at step 2
 * when the wrong edge was the first step's). `reset` restarts silently.
 */
export interface SequenceNode extends NodeBase {
  readonly kind: 'sequence';
  /** Input port names, in the expected order (at least two). */
  readonly steps: readonly string[];
}
/** On a rising edge of `in`, pulses one of its outcome ports, chosen uniformly by a seeded stream. */
export interface RandomNode extends NodeBase {
  readonly kind: 'random';
  /** Output port names (at least two). */
  readonly outcomes: readonly string[];
}
/** Drives a door, light, spawner, audio cue, world fact or mechanism: see `signalReceived`. */
export interface ReceiverNode extends NodeBase {
  readonly kind: 'receiver';
  readonly receiver: SignalReceiverKind;
  /** Required by door, light, spawner and mechanism. */
  readonly entity?: string;
  /** Required by fact (the fact key) and audio-cue (the cue id). */
  readonly key?: string;
}
/** Writes world properties of a bound entity: `on` when `in` rises, `off` (if any) when it falls. */
export interface SetPropertyNode extends NodeBase {
  readonly kind: 'set-property';
  readonly entity: string;
  readonly on: WorldPropertyInit;
  readonly off?: WorldPropertyInit;
}

/** One node of a signal graph. */
export type SignalNodeDef =
  | VolumeNode
  | LeverNode
  | ButtonNode
  | SensorNode
  | GateNode
  | DelayNode
  | TimerNode
  | PulseNode
  | LatchNode
  | CounterNode
  | SequenceNode
  | RandomNode
  | ReceiverNode
  | SetPropertyNode;

/** A wire from an output (`node` or `node.port`) to an input. */
export interface SignalWireDef {
  readonly from: string;
  readonly to: string;
}

/** A signal graph as data (a content entry may carry more fields; they are dropped). */
export interface SignalGraphDef {
  readonly id: string;
  readonly nodes: readonly SignalNodeDef[];
  readonly wires: readonly SignalWireDef[];
}

/** One problem with a graph; `path` locates it in the definition (e.g. `['wires', 3, 'to']`). */
export interface SignalGraphProblem {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** Thrown for an invalid graph, listing every problem found. */
export class SignalGraphError extends Error {
  override readonly name = 'SignalGraphError';

  constructor(
    readonly graph: string,
    readonly problems: readonly SignalGraphProblem[],
  ) {
    super(
      [
        `signal graph "${graph}" is invalid:`,
        ...problems.map((p) => `  ${p.path.join('.')}: ${p.message}`),
      ].join('\n'),
    );
  }
}

/** Kinds whose output is stored state from earlier ticks (the only kinds a loop may pass through). */
export const REGISTERED_KINDS: readonly SignalNodeKind[] = ['delay', 'latch'];

/** A node's input and output port names; the first of each is the default. */
export interface SignalPorts {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

const IN = ['in'];
const OUT = ['out'];

/** The ports of `node`. */
export function signalPorts(node: SignalNodeDef): SignalPorts {
  switch (node.kind) {
    case 'volume':
      return { inputs: [], outputs: ['active', 'stay', 'enter', 'exit'] };
    case 'lever':
    case 'button':
    case 'sensor':
      return { inputs: [], outputs: OUT };
    case 'latch':
      return { inputs: ['set', 'reset', 'toggle'], outputs: OUT };
    case 'counter':
      return { inputs: ['in', 'reset'], outputs: OUT };
    case 'sequence':
      return { inputs: [...node.steps, 'reset'], outputs: ['success', 'failed'] };
    case 'random':
      return { inputs: IN, outputs: node.outcomes };
    case 'receiver':
    case 'set-property':
      return { inputs: IN, outputs: [] };
    default:
      return { inputs: IN, outputs: OUT };
  }
}

/** Fewest wires each input port needs (ports not listed need none). */
function minimumWires(node: SignalNodeDef): Readonly<Record<string, number>> {
  switch (node.kind) {
    case 'and':
    case 'or':
    case 'xor':
      return { in: 2 };
    case 'latch':
    case 'volume':
    case 'lever':
    case 'button':
    case 'sensor':
      return {};
    case 'sequence':
      return Object.fromEntries(node.steps.map((step) => [step, 1]));
    default:
      return { in: 1 };
  }
}

/** A wire endpoint split into node id and port name (`undefined` port = the node's default). */
export function parseEndpoint(endpoint: string): { node: string; port: string | undefined } {
  const dot = endpoint.indexOf('.');
  return dot < 0
    ? { node: endpoint, port: undefined }
    : { node: endpoint.slice(0, dot), port: endpoint.slice(dot + 1) };
}

/** A resolved output: `node.port`. */
export type OutputKey = string;

/** A graph ready to evaluate. */
export interface CompiledSignalGraph {
  readonly def: SignalGraphDef;
  /** Node indices in evaluation order (registered nodes included; see the file header). */
  readonly order: readonly number[];
  /** Per node: input port → the outputs wired into it, in wire order. */
  readonly inputs: readonly Readonly<Record<string, readonly OutputKey[]>>[];
  /** Binding names (level entity keys) the graph refers to, sorted. */
  readonly bindings: readonly string[];
}

type Problems = SignalGraphProblem[];

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
function known<T>(value: T | undefined): T {
  return value as T;
}

function isFiniteAtLeast(value: unknown, min: number, exclusive = false): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && (exclusive ? value > min : value >= min)
  );
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && PROPERTY_ID_PATTERN.test(value);
}

/** How an ordering-comparison error names a non-number property kind. */
const KIND_NOUN = { boolean: 'a boolean', id: 'an id', enum: 'an enum' } as const;

function checkPredicate(p: SignalPredicate, path: (string | number)[], problems: Problems): void {
  const fail = (message: string) => problems.push({ path, message });
  switch (p.test) {
    case 'tag':
      if (!isId(p.tag)) fail(`tag must be a kebab-case id, got ${JSON.stringify(p.tag)}`);
      return;
    case 'element':
      if (!(SIGNAL_ELEMENTS as readonly string[]).includes(p.element)) {
        fail(`unknown element "${p.element}"`);
      }
      return;
    case 'facing':
      if (!(FACINGS as readonly string[]).includes(p.facing)) {
        fail(`unknown facing "${p.facing}"; one of ${FACINGS.join(', ')}`);
      }
      return;
    case 'property': {
      if (!isWorldPropertyKey(p.property)) {
        fail(`unknown world property "${String(p.property)}"`);
        return;
      }
      const spec = WORLD_PROPERTY_SPECS[p.property];
      if (!(PREDICATE_OPS as readonly string[]).includes(p.op)) {
        fail(`unknown operator "${p.op}"`);
        return;
      }
      if (spec.type === 'record') {
        fail(`"${p.property}" is a record and cannot be compared`);
        return;
      }
      // Ids and enum values (surfaceHardness, mw-e03.31) are both compared as strings.
      const kind = spec.type === 'id' || spec.type === 'enum' ? 'string' : spec.type;
      if (p.op !== 'eq' && p.op !== 'ne' && spec.type !== 'number') {
        fail(`"${p.op}" needs a number property; "${p.property}" is ${KIND_NOUN[spec.type]}`);
      } else if (typeof p.value !== kind) {
        fail(`"${p.property}" compares with a ${kind} value`);
      } else if (spec.type === 'enum' && !(spec.values as readonly unknown[]).includes(p.value)) {
        fail(
          `"${p.property}" is one of ${spec.values.join(', ')}, never ${JSON.stringify(p.value)}`,
        );
      }
      return;
    }
    default:
      fail(`unknown predicate test "${String((p as { test: unknown }).test)}"`);
  }
}

function checkFilter(
  filter: readonly SignalPredicate[] | undefined,
  path: (string | number)[],
  problems: Problems,
): void {
  filter?.forEach((p, i) => {
    checkPredicate(p, [...path, i], problems);
  });
}

function checkProperties(init: WorldPropertyInit, path: (string | number)[], problems: Problems) {
  for (const [key, value] of Object.entries(init)) {
    try {
      if (!isWorldPropertyKey(key)) throw new RangeError(`unknown world property "${key}"`);
      assertProperty(key, value);
    } catch (error) {
      problems.push({ path: [...path, key], message: (error as Error).message });
    }
  }
}

function checkPortNames(names: readonly string[], path: (string | number)[], problems: Problems) {
  if (names.length < 2) problems.push({ path, message: 'needs at least two ports' });
  names.forEach((name, i) => {
    if (!isId(name) || name === 'reset' || name === 'in') {
      problems.push({ path: [...path, i], message: `"${name}" is not a valid port name` });
    } else if (names.indexOf(name) !== i) {
      problems.push({ path: [...path, i], message: `duplicate port "${name}"` });
    }
  });
}

/** Per-kind parameter checks. */
function checkNode(node: SignalNodeDef, path: (string | number)[], problems: Problems): void {
  const fail = (field: string, message: string) =>
    problems.push({ path: [...path, field], message });
  switch (node.kind) {
    case 'volume':
      try {
        const shape = normalizeShape(node.shape);
        if (!['box', 'sphere', 'capsule'].includes(shape.kind)) {
          fail('shape', `a volume is a box, sphere or capsule, not a ${shape.kind}`);
        }
      } catch (error) {
        fail('shape', (error as Error).message);
      }
      checkFilter(node.filter, [...path, 'filter'], problems);
      if (
        node.minCount !== undefined &&
        !(Number.isSafeInteger(node.minCount) && node.minCount >= 1)
      ) {
        fail('minCount', 'must be a whole number ≥ 1');
      }
      if (node.minWeight !== undefined && !isFiniteAtLeast(node.minWeight, 0)) {
        fail('minWeight', 'must be a finite number ≥ 0');
      }
      return;
    case 'sensor':
      if (node.filter.length === 0) fail('filter', 'a sensor needs at least one predicate');
      checkFilter(node.filter, [...path, 'filter'], problems);
      return;
    case 'delay':
    case 'timer':
      if (!isFiniteAtLeast(node.seconds, 0, true)) fail('seconds', 'must be a finite number > 0');
      return;
    case 'pulse':
      if (node.edge !== undefined && !(PULSE_EDGES as readonly string[]).includes(node.edge)) {
        fail('edge', `unknown edge "${node.edge}"`);
      }
      return;
    case 'counter':
      if (!(Number.isSafeInteger(node.target) && node.target >= 1)) {
        fail('target', 'must be a whole number ≥ 1');
      }
      return;
    case 'sequence':
      checkPortNames(node.steps, [...path, 'steps'], problems);
      return;
    case 'random':
      checkPortNames(node.outcomes, [...path, 'outcomes'], problems);
      return;
    case 'receiver':
      if (!(SIGNAL_RECEIVERS as readonly string[]).includes(node.receiver)) {
        fail('receiver', `unknown receiver "${node.receiver}"`);
      } else if (ENTITY_RECEIVERS.includes(node.receiver)) {
        if (node.entity === undefined)
          fail('entity', `a ${node.receiver} receiver needs an entity`);
      } else if (node.key === undefined || node.key === '') {
        fail('key', `a ${node.receiver} receiver needs a key`);
      } else if (node.receiver === 'fact' && !isFactKey(node.key)) {
        fail('key', new FactKeyError(node.key).message);
      }
      return;
    case 'set-property':
      if (Object.keys(node.on).length === 0) fail('on', 'must set at least one property');
      checkProperties(node.on, [...path, 'on'], problems);
      if (node.off !== undefined) checkProperties(node.off, [...path, 'off'], problems);
      return;
    default:
      return;
  }
}

/** The entity binding names `node` refers to. */
function bindingOf(node: SignalNodeDef): string | undefined {
  return 'entity' in node ? node.entity : undefined;
}

/** Node ids in evaluation order, or the nodes of one zero-delay cycle (in signal-flow order). */
function orderNodes(
  ids: readonly string[],
  deps: ReadonlyMap<string, ReadonlySet<string>>,
): { order: string[]; cycle?: string[] } {
  const sorted = [...ids].sort();
  const done = new Set<string>();
  const order: string[] = [];
  for (;;) {
    const ready = sorted.find(
      (id) => !done.has(id) && [...known(deps.get(id))].every((dep) => done.has(dep)),
    );
    if (ready === undefined) break;
    done.add(ready);
    order.push(ready);
  }
  const left = sorted.filter((id) => !done.has(id));
  const start = left[0];
  if (start === undefined) return { order };
  // Every node left waits on another node left, so walking back along those waits must repeat.
  const walk: string[] = [start];
  let at = start;
  for (;;) {
    const prev = known([...known(deps.get(at))].filter((dep) => !done.has(dep)).sort()[0]);
    const seen = walk.indexOf(prev);
    if (seen >= 0) {
      // Signal-flow order, starting from the smallest id so the message is canonical.
      const cycle = walk.slice(seen).reverse();
      const first = cycle.indexOf(known([...cycle].sort()[0]));
      return { order, cycle: [...cycle.slice(first), ...cycle.slice(0, first)] };
    }
    walk.push(prev);
    at = prev;
  }
}

const compiled = new WeakMap<SignalGraphDef, CompiledSignalGraph>();

/**
 * Checks `def` and computes its evaluation order. Throws a SignalGraphError listing every problem:
 * duplicate or malformed node ids, unknown kinds, bad parameters, wires to missing nodes or ports,
 * input ports with too few (or, for `not`, too many) wires, and zero-delay cycles (naming their
 * nodes). Results are cached per definition object.
 */
export function compileSignalGraph(def: SignalGraphDef): CompiledSignalGraph {
  const cached = compiled.get(def);
  if (cached !== undefined) return cached;
  const problems: Problems = [];
  const byId = new Map<string, number>();
  def.nodes.forEach((node, i) => {
    const path = ['nodes', i];
    if (!isId(node.id)) {
      problems.push({
        path: [...path, 'id'],
        message: `node id must be kebab-case, got ${JSON.stringify(node.id)}`,
      });
    } else if (byId.has(node.id)) {
      problems.push({ path: [...path, 'id'], message: `duplicate node id "${node.id}"` });
    } else {
      byId.set(node.id, i);
    }
    if (!(SIGNAL_NODE_KINDS as readonly string[]).includes(node.kind)) {
      problems.push({
        path: [...path, 'kind'],
        message: `unknown node kind "${node.kind}"`,
      });
      return;
    }
    checkNode(node, path, problems);
  });
  if (problems.length > 0) throw new SignalGraphError(def.id, problems);

  const inputs = def.nodes.map((node) =>
    Object.fromEntries(signalPorts(node).inputs.map((port) => [port, [] as OutputKey[]])),
  );
  const deps = new Map<string, Set<string>>(def.nodes.map((node) => [node.id, new Set<string>()]));
  def.wires.forEach((wire, i) => {
    const resolve = (end: 'from' | 'to') => {
      const { node: id, port } = parseEndpoint(wire[end]);
      const index = byId.get(id);
      const node = index === undefined ? undefined : def.nodes[index];
      if (index === undefined || node === undefined) {
        problems.push({ path: ['wires', i, end], message: `wire ${end} missing node "${id}"` });
        return undefined;
      }
      const ports = signalPorts(node)[end === 'from' ? 'outputs' : 'inputs'];
      const name = port ?? ports[0];
      if (name === undefined || !ports.includes(name)) {
        const what = end === 'from' ? 'output' : 'input';
        const list = ports.length === 0 ? 'none' : ports.join(', ');
        problems.push({
          path: ['wires', i, end],
          message: `node "${id}" (${node.kind}) has no ${what} port "${port ?? ''}"; its ${what}s: ${list}`,
        });
        return undefined;
      }
      return { index, node, port: name };
    };
    const from = resolve('from');
    const to = resolve('to');
    if (from === undefined || to === undefined) return;
    (inputs[to.index] as Record<string, OutputKey[]>)[to.port]?.push(
      `${from.node.id}.${from.port}`,
    );
    if (!REGISTERED_KINDS.includes(to.node.kind)) deps.get(to.node.id)?.add(from.node.id);
  });
  def.nodes.forEach((node, i) => {
    const wired = inputs[i] as Record<string, OutputKey[]>;
    for (const [port, min] of Object.entries(minimumWires(node))) {
      const count = known(wired[port]).length;
      if (count < min) {
        problems.push({
          path: ['nodes', i],
          message: `node "${node.id}" needs ${String(min)} wire(s) into "${port}", has ${String(count)}`,
        });
      }
    }
    if (node.kind === 'not' && known(wired['in']).length > 1) {
      problems.push({
        path: ['nodes', i],
        message: `node "${node.id}" (not) takes exactly one wire`,
      });
    }
    if (
      node.kind === 'latch' &&
      known(wired['set']).length === 0 &&
      known(wired['toggle']).length === 0
    ) {
      problems.push({
        path: ['nodes', i],
        message: `node "${node.id}" (latch) needs a wire into "set" or "toggle"`,
      });
    }
  });
  if (problems.length > 0) throw new SignalGraphError(def.id, problems);

  const { order, cycle } = orderNodes([...byId.keys()], deps);
  if (cycle !== undefined) {
    throw new SignalGraphError(def.id, [
      {
        path: ['wires'],
        message: `zero-delay cycle ${[...cycle, cycle[0]].join(' → ')}: route it through a delay or latch`,
      },
    ]);
  }
  const bindings = [...new Set(def.nodes.flatMap((node) => bindingOf(node) ?? []))].sort();
  const result: CompiledSignalGraph = {
    def,
    order: order.map((id) => known(byId.get(id))),
    inputs,
    bindings,
  };
  compiled.set(def, result);
  return result;
}

/** `v` moved by `origin`. */
const offset = (v: Vec3, origin: Vec3): Vec3 => ({
  x: v.x + origin.x,
  y: v.y + origin.y,
  z: v.z + origin.z,
});

/** A volume shape moved by `origin` (a graph placed as a prefab). */
export function translateShape(shape: VolumeShape, origin: Vec3): VolumeShape {
  switch (shape.kind) {
    case 'capsule':
      return { ...shape, from: offset(shape.from, origin), to: offset(shape.to, origin) };
    default:
      return { ...shape, center: offset(shape.center, origin) };
  }
}
