// Signal graphs as content (mw-e03.21): `src/content/data/signal-graph/<id>.json`. A designer wires
// trigger volumes, levers, buttons and property sensors through logic nodes to doors, lights,
// spawners, audio cues, world facts and property setters without writing code. This schema mirrors
// the sim's definition (src/sim/signals/graph.ts), which content may only import as types; the node
// kinds, ports and rules are kept equal by tests/contracts/signal-graphs.test.ts. Beyond field
// shapes, the whole-graph check reports, with a JSON pointer into the file: duplicate node ids, wires
// to missing nodes or ports, input ports with too few wires, zero-delay cycles (naming their nodes)
// and nodes whose outputs drive nothing. Filters are property and tag predicates, never type ids.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { worldPropertiesSchema } from '../world-properties.ts';

/** Every node kind (mirrors the sim's SIGNAL_NODE_KINDS). */
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

/** Receiver kinds (mirrors the sim's SIGNAL_RECEIVERS). */
export const SIGNAL_RECEIVERS = [
  'door',
  'light',
  'spawner',
  'audio-cue',
  'fact',
  'mechanism',
] as const;
const ENTITY_RECEIVERS: readonly string[] = ['door', 'light', 'spawner', 'mechanism'];
/** Predicate operators (mirrors the sim's PREDICATE_OPS). */
export const PREDICATE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const;
/** Elements a filter can test for (mirrors the sim's SIGNAL_ELEMENTS). */
export const SIGNAL_ELEMENTS = ['fire', 'water', 'ice', 'charge'] as const;
/** Compass directions a facing test names (mirrors the sim's FACINGS). */
export const FACINGS = ['north', 'east', 'south', 'west'] as const;
/** Node kinds a loop may pass through (mirrors the sim's REGISTERED_KINDS). */
export const REGISTERED_KINDS: readonly string[] = ['delay', 'latch'];

const fieldSchemas = worldPropertiesSchema.shape;
type PropertyKey = keyof typeof fieldSchemas;

/** Properties a predicate can compare: every one but the records (`lightEmitter`, `toughness`). */
const COMPARABLE = (Object.keys(fieldSchemas) as PropertyKey[]).filter(
  (k) => fieldSchemas[k].unwrap().type !== 'object',
);

/** A property's value kind: its field schema type (`material` is a ref, so an id string). */
function valueKind(key: PropertyKey): 'number' | 'boolean' | 'string' {
  const type = fieldSchemas[key].unwrap().type;
  return type === 'number' || type === 'boolean' ? type : 'string';
}

const coordinate = z.number().describe('Metres.');
const vec3 = z.strictObject({ x: coordinate, y: coordinate, z: coordinate });
const size = z.number().min(0).describe('Metres.');

/** A trigger volume's shape, relative to where the level places the graph. */
export const volumeShapeSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('box').describe('Shape: an axis-aligned box.'),
      center: vec3.describe('Centre of the box, metres.'),
      halfExtents: z
        .strictObject({ x: size, y: size, z: size })
        .describe('Half the size per axis.'),
    }),
    z.strictObject({
      kind: z.literal('sphere').describe('Shape: a sphere.'),
      center: vec3.describe('Centre of the sphere, metres.'),
      radius: size,
    }),
    z.strictObject({
      kind: z.literal('capsule').describe('Shape: a capsule, a segment swept by a radius.'),
      from: vec3.describe('One end of the capsule’s segment, metres.'),
      to: vec3.describe('The other end of the capsule’s segment, metres.'),
      radius: size,
    }),
  ])
  .describe('Box, sphere or capsule, relative to the graph origin.');

export const predicateSchema = z
  .discriminatedUnion('test', [
    z.strictObject({
      test: z.literal('property'),
      property: z.enum(COMPARABLE).describe('World property to compare (absent = its default).'),
      op: z.enum(PREDICATE_OPS).describe('Comparison; lt/lte/gt/gte need a number property.'),
      value: z.union([z.number(), z.boolean(), z.string()]).describe('Value to compare with.'),
    }),
    z.strictObject({
      test: z.literal('tag'),
      tag: contentId.describe('Tag the entity must carry, e.g. "player".'),
    }),
    z.strictObject({
      test: z.literal('facing'),
      facing: z
        .enum(FACINGS)
        .describe(
          'Compass direction its body faces: north is +z, east +x; a +90° turn takes north to east.',
        ),
    }),
    z.strictObject({
      test: z.literal('element'),
      element: z
        .enum(SIGNAL_ELEMENTS)
        .describe('fire = burning, water = wetness > 0, ice = frozen, charge = charge > 0.'),
    }),
  ])
  .describe('One condition; every condition of a filter must hold.');

const filterSchema = z.array(predicateSchema).describe('Conditions an entity must all pass.');

const binding = contentId.describe('Level entity id this node is bound to.');
const seconds = z.number().positive().describe('Seconds (rounded to whole ticks, at least one).');
const portNames = (doc: string) => z.array(contentId).min(2).describe(doc);

/** Property values a set-property node writes (the material ref is not writable from a graph). */
const writableProperties = worldPropertiesSchema.omit({ material: true });

const base = {
  id: contentId.describe('Node id, unique in the graph; wires refer to it.'),
  observed: z
    .boolean()
    .optional()
    .describe('Outputs are read outside the graph (puzzle goal, quest), so unwired is fine.'),
};

const nodeSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...base,
      kind: z.literal('volume'),
      shape: volumeShapeSchema,
      filter: filterSchema.optional(),
      minCount: z.int().min(1).optional().describe('Occupants needed for `active`; default 1.'),
      minWeight: z
        .number()
        .min(0)
        .optional()
        .describe('Total occupant weight (kg) needed for `active`; default 0.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('lever'),
      initial: z.boolean().optional().describe('Starts on; default false.'),
      entity: binding.optional(),
    }),
    z.strictObject({ ...base, kind: z.literal('button'), entity: binding.optional() }),
    z.strictObject({
      ...base,
      kind: z.literal('sensor'),
      entity: binding,
      filter: filterSchema.min(1),
    }),
    z.strictObject({ ...base, kind: z.enum(['and', 'or', 'xor', 'not']) }),
    z.strictObject({ ...base, kind: z.literal('delay'), seconds }),
    z.strictObject({
      ...base,
      kind: z.literal('timer'),
      seconds,
      retrigger: z.boolean().optional().describe('A new edge restarts the timer; default true.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('pulse'),
      edge: z.enum(['rising', 'falling', 'both']).optional().describe('Default rising.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('latch'),
      initial: z.boolean().optional().describe('Starts set; default false.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('counter'),
      target: z.int().min(1).describe('Rising edges needed.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('sequence'),
      steps: portNames('Input port names in the expected order.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('random'),
      outcomes: portNames('Output port names, one pulsed per rising edge.'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('receiver'),
      receiver: z.enum(SIGNAL_RECEIVERS).describe('What the signal drives.'),
      entity: binding.optional().describe('Required by door, light, spawner and mechanism.'),
      key: z.string().min(1).optional().describe('Fact key or audio cue id (fact, audio-cue).'),
    }),
    z.strictObject({
      ...base,
      kind: z.literal('set-property'),
      entity: binding,
      on: writableProperties.describe('Written when the input rises.'),
      off: writableProperties.optional().describe('Written when the input falls; default none.'),
    }),
  ])
  .describe('One node; kinds, ports and timing are documented in src/sim/signals/graph.ts.');

/** `node` or `node.port`. */
const endpoint = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)?$/,
    'must be "node" or "node.port", e.g. "plate.enter"',
  );

const wireSchema = z.strictObject({
  from: endpoint.describe('Output: "node" (its first output) or "node.port".'),
  to: endpoint.describe('Input: "node" (its first input) or "node.port".'),
});

type Node = z.output<typeof nodeSchema>;
type Predicate = z.output<typeof predicateSchema>;

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
function known<T>(value: T | undefined): T {
  return value as T;
}
interface Graph {
  readonly nodes: readonly Node[];
  readonly wires: readonly z.output<typeof wireSchema>[];
}

/** A node's input and output port names; the first of each is the default. */
export function signalPorts(node: Frozen<Node>): {
  inputs: readonly string[];
  outputs: readonly string[];
} {
  switch (node.kind) {
    case 'volume':
      return { inputs: [], outputs: ['active', 'stay', 'enter', 'exit'] };
    case 'lever':
    case 'button':
    case 'sensor':
      return { inputs: [], outputs: ['out'] };
    case 'latch':
      return { inputs: ['set', 'reset', 'toggle'], outputs: ['out'] };
    case 'counter':
      return { inputs: ['in', 'reset'], outputs: ['out'] };
    case 'sequence':
      return { inputs: [...node.steps, 'reset'], outputs: ['success', 'failed'] };
    case 'random':
      return { inputs: ['in'], outputs: node.outcomes };
    case 'receiver':
    case 'set-property':
      return { inputs: ['in'], outputs: [] };
    default:
      return { inputs: ['in'], outputs: ['out'] };
  }
}

/** Fewest wires each input port needs (mirrors the sim). */
function minimumWires(node: Node): Readonly<Record<string, number>> {
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

type Issue = (path: (string | number)[], message: string) => void;

/** Checks of one node that its field schema can't express. */
function checkNode(node: Node, at: (string | number)[], issue: Issue): void {
  const predicates = (filter: readonly Predicate[] | undefined) => {
    filter?.forEach((p, i) => {
      if (p.test !== 'property') return;
      const kind = valueKind(p.property);
      if (p.op !== 'eq' && p.op !== 'ne' && kind !== 'number') {
        issue(
          [...at, 'filter', i, 'op'],
          `"${p.op}" needs a number property; "${p.property}" is not`,
        );
      } else if (typeof p.value !== kind) {
        issue([...at, 'filter', i, 'value'], `"${p.property}" compares with a ${kind} value`);
      }
    });
  };
  const ports = (names: readonly string[], field: string) => {
    names.forEach((name, i) => {
      if (name === 'reset' || name === 'in') {
        issue([...at, field, i], `"${name}" is reserved and cannot name a port`);
      } else if (names.indexOf(name) !== i) {
        issue([...at, field, i], `duplicate port "${name}"`);
      }
    });
  };
  switch (node.kind) {
    case 'volume':
    case 'sensor':
      predicates(node.filter);
      return;
    case 'sequence':
      ports(node.steps, 'steps');
      return;
    case 'random':
      ports(node.outcomes, 'outcomes');
      return;
    case 'receiver':
      if (ENTITY_RECEIVERS.includes(node.receiver)) {
        if (node.entity === undefined)
          issue([...at, 'entity'], `a ${node.receiver} receiver needs an entity`);
      } else if (node.key === undefined) {
        issue([...at, 'key'], `a ${node.receiver} receiver needs a key`);
      }
      return;
    case 'set-property':
      if (Object.keys(node.on).length === 0) issue([...at, 'on'], 'must set at least one property');
      return;
    default:
      return;
  }
}

/** A zero-delay cycle among `ids` (signal-flow order, smallest id first), or undefined. */
function findCycle(ids: readonly string[], deps: ReadonlyMap<string, ReadonlySet<string>>) {
  const sorted = [...ids].sort();
  const done = new Set<string>();
  for (;;) {
    const ready = sorted.find(
      (id) => !done.has(id) && [...known(deps.get(id))].every((d) => done.has(d)),
    );
    if (ready === undefined) break;
    done.add(ready);
  }
  const start = sorted.find((id) => !done.has(id));
  if (start === undefined) return undefined;
  const walk = [start];
  for (let at = start; ;) {
    const prev = known([...known(deps.get(at))].filter((d) => !done.has(d)).sort()[0]);
    const seen = walk.indexOf(prev);
    if (seen >= 0) {
      const cycle = walk.slice(seen).reverse();
      const first = cycle.indexOf(known([...cycle].sort()[0]));
      return [...cycle.slice(first), ...cycle.slice(0, first)];
    }
    walk.push(prev);
    at = prev;
  }
}

/** The whole-graph checks (see the file header). */
function checkGraph(graph: Graph, ctx: z.RefinementCtx): void {
  let found = 0;
  const issue: Issue = (path, message) => {
    found++;
    ctx.addIssue({ code: 'custom', path, message });
  };
  const byId = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    if (byId.has(node.id)) issue(['nodes', i, 'id'], `duplicate node id "${node.id}"`);
    else byId.set(node.id, i);
    checkNode(node, ['nodes', i], issue);
  });
  if (found > 0) return; // wiring checks assume well-formed nodes

  const wired = graph.nodes.map((node) =>
    Object.fromEntries(signalPorts(node).inputs.map((port) => [port, 0])),
  );
  const drives = new Set<string>();
  const deps = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]));
  graph.wires.forEach((wire, i) => {
    const resolve = (end: 'from' | 'to') => {
      const [id, port] = wire[end].split('.') as [string, string | undefined];
      const index = byId.get(id);
      if (index === undefined) {
        issue(['wires', i, end], `wire ${end} missing node "${id}"`);
        return undefined;
      }
      const node = known(graph.nodes[index]);
      const ports = signalPorts(node)[end === 'from' ? 'outputs' : 'inputs'];
      const name = port ?? ports[0];
      if (name === undefined || !ports.includes(name)) {
        const what = end === 'from' ? 'output' : 'input';
        const list = ports.length === 0 ? 'none' : ports.join(', ');
        issue(
          ['wires', i, end],
          `node "${id}" (${node.kind}) has no ${what} port "${port ?? ''}"; its ${what}s: ${list}`,
        );
        return undefined;
      }
      return { index, node, port: name };
    };
    const from = resolve('from');
    const to = resolve('to');
    if (from === undefined || to === undefined) return;
    const counts = known(wired[to.index]);
    counts[to.port] = known(counts[to.port]) + 1;
    drives.add(from.node.id);
    if (!REGISTERED_KINDS.includes(to.node.kind)) known(deps.get(to.node.id)).add(from.node.id);
  });

  graph.nodes.forEach((node, i) => {
    const counts = known(wired[i]);
    for (const [port, min] of Object.entries(minimumWires(node))) {
      const count = known(counts[port]);
      if (count < min) {
        issue(
          ['nodes', i],
          `node "${node.id}" needs ${String(min)} wire(s) into "${port}", has ${String(count)}`,
        );
      }
    }
    if (node.kind === 'not' && known(counts['in']) > 1) {
      issue(['nodes', i], `node "${node.id}" (not) takes exactly one wire`);
    }
    if (node.kind === 'latch' && counts['set'] === 0 && counts['toggle'] === 0) {
      issue(['nodes', i], `node "${node.id}" (latch) needs a wire into "set" or "toggle"`);
    }
    const sink = node.kind === 'receiver' || node.kind === 'set-property';
    if (!sink && node.observed !== true && !drives.has(node.id)) {
      issue(['nodes', i], `node "${node.id}" drives nothing: wire an output or mark it "observed"`);
    }
  });

  if (found > 0) return; // a cycle is only meaningful once every wire resolved
  const cycle = findCycle([...byId.keys()], deps);
  if (cycle !== undefined) {
    issue(
      ['wires'],
      `zero-delay cycle ${[...cycle, cycle[0]].join(' → ')}: route it through a delay or latch`,
    );
  }
}

/** Runs the graph checks only once every field passed its own schema (one problem, one report). */
const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

/** One signal graph: `src/content/data/signal-graph/<id>.json`. */
export const signalGraphSchema = z
  .strictObject({
    id: contentId,
    name: z.string().min(1).describe('Display name (editor and docs).'),
    notes: z.string().min(1).describe('What the mechanism does and how to solve it, for review.'),
    nodes: z.array(nodeSchema).min(1).describe('Emitters, logic and receivers.'),
    wires: z.array(wireSchema).describe('Connections from outputs to inputs.'),
  })
  .superRefine(checkGraph, whenValid);

/** A signal graph as written in a data file. */
export type SignalGraphEntryInput = z.input<typeof signalGraphSchema>;
/** A loaded signal graph. */
export type SignalGraphEntry = z.output<typeof signalGraphSchema>;
/** One node of a loaded signal graph. */
export type SignalGraphNode = Node;
