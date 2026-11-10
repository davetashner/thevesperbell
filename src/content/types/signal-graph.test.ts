import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent, type ContentIssue } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  signalGraphSchema,
  signalPorts,
  type SignalGraphEntryInput,
  type SignalGraphNode,
} from './signal-graph.ts';

const box = {
  kind: 'box',
  center: { x: 0, y: 0, z: 0 },
  halfExtents: { x: 1, y: 1, z: 1 },
} as const;

function graph(nodes: unknown[], wires: [string, string][] = []): SignalGraphEntryInput {
  return {
    id: 'fixture',
    name: 'Fixture',
    notes: 'Test graph.',
    nodes: nodes as SignalGraphEntryInput['nodes'],
    wires: wires.map(([from, to]) => ({ from, to })),
  };
}

/** `path: message` of every issue parsing `value`, or [] when it is valid. */
function problems(value: unknown): string[] {
  return (signalGraphSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
}

/** The loader's issues for one signal-graph file. */
function loadIssues(entry: unknown): readonly ContentIssue[] {
  try {
    loadContent(contentTypes, [
      { path: 'data/signal-graph/bad.json', text: JSON.stringify(entry) },
    ]);
  } catch (error) {
    return (error as ContentLoadError).issues;
  }
  return [];
}

const lever = (id: string) => ({ id, kind: 'lever' });
const door = (id = 'door') => ({ id, kind: 'receiver', receiver: 'door', entity: 'gate' });

describeContent('signal-graph', 'AC-4, AC-5: passes the schema and graph checks', (entry) => {
  const again = signalGraphSchema.parse(JSON.parse(serializeContent(entry)));
  expect(again).toEqual(entry);
  expect(entry.notes.length).toBeGreaterThan(40); // explains the mechanism for review
});

describe('signal graph content', () => {
  it('AC-4: a zero-delay cycle fails naming the cycle nodes', () => {
    const cyclic = graph(
      [
        lever('l'),
        { id: 'a', kind: 'or' },
        { id: 'b', kind: 'not' },
        { id: 'c', kind: 'or' },
        door(),
      ],
      [
        ['l', 'a'],
        ['c', 'a'],
        ['a', 'b'],
        ['b', 'c'],
        ['l', 'c'],
        ['c', 'door'],
      ],
    );
    expect(loadIssues(cyclic)).toEqual([
      {
        file: 'data/signal-graph/bad.json',
        pointer: '/wires',
        message: 'zero-delay cycle a → b → c → a: route it through a delay or latch (at wires)',
      },
    ]);
  });

  it('AC-4: a loop through a delay or latch is valid', () => {
    for (const [kind, port] of [
      ['delay', 'in'],
      ['latch', 'toggle'],
    ] as const) {
      const loop = graph(
        [{ id: 'n', kind: 'not' }, { id: 'r', kind, seconds: 1 }, door()],
        [
          ['n', `r.${port}`],
          ['r', 'n'],
          ['n', 'door'],
        ],
      );
      expect(
        problems(
          kind === 'latch'
            ? { ...loop, nodes: [loop.nodes[0], { id: 'r', kind }, loop.nodes[2]] }
            : loop,
        ),
      ).toEqual([]);
    }
  });

  it('AC-5: a wire to a missing node fails with the file path and the id', () => {
    const issues = loadIssues(
      graph(
        [lever('l'), door()],
        [
          ['l', 'dor'],
          ['l', 'door'],
        ],
      ),
    );
    expect(issues).toEqual([
      {
        file: 'data/signal-graph/bad.json',
        pointer: '/wires/0/to',
        message: 'wire to missing node "dor" (at wires[0].to)',
      },
    ]);
  });

  it('rejects unknown ports, naming the node’s ports', () => {
    const seq = { id: 'seq', kind: 'sequence', steps: ['x', 'y'] };
    expect(
      problems(
        graph(
          [lever('l'), door(), seq],
          [
            ['ghost', 'door'],
            ['l.up', 'door'],
            ['door', 'seq.x'],
            ['l', 'seq.z'],
            ['l', 'l'],
            ['l', 'seq.x'],
            ['l', 'seq.y'],
            ['seq', 'door'],
          ],
        ),
      ),
    ).toEqual([
      'wires.0.from: wire from missing node "ghost"',
      'wires.1.from: node "l" (lever) has no output port "up"; its outputs: out',
      'wires.2.from: node "door" (receiver) has no output port ""; its outputs: none',
      'wires.3.to: node "seq" (sequence) has no input port "z"; its inputs: x, y, reset',
      'wires.4.to: node "l" (lever) has no input port ""; its inputs: none',
    ]);
  });

  it('checks wire counts and flags nodes that drive nothing', () => {
    expect(
      problems(
        graph(
          [
            lever('l'),
            lever('spare'),
            { ...lever('watched'), observed: true },
            { id: 'and', kind: 'and' },
            { id: 'not', kind: 'not' },
            { id: 'latch', kind: 'latch' },
            { id: 'seq', kind: 'sequence', steps: ['x', 'y'] },
            door(),
          ],
          [
            ['l', 'and'],
            ['l', 'not'],
            ['and', 'not'],
            ['not', 'latch.reset'],
            ['latch', 'door'],
            ['l', 'seq.x'],
          ],
        ),
      ),
    ).toEqual([
      'nodes.1: node "spare" drives nothing: wire an output or mark it "observed"',
      'nodes.3: node "and" needs 2 wire(s) into "in", has 1',
      'nodes.4: node "not" (not) takes exactly one wire',
      'nodes.5: node "latch" (latch) needs a wire into "set" or "toggle"',
      'nodes.6: node "seq" needs 1 wire(s) into "y", has 0',
      'nodes.6: node "seq" drives nothing: wire an output or mark it "observed"',
    ]);
  });

  it('checks node parameters the field schemas cannot', () => {
    const filtered = (filter: unknown[]) => ({
      id: 'v',
      kind: 'volume',
      shape: box,
      filter,
      observed: true,
    });
    expect(
      problems(
        graph([
          lever('l'),
          lever('l'),
          filtered([
            { test: 'property', property: 'burning', op: 'gt', value: 1 },
            { test: 'property', property: 'weight', op: 'gte', value: '20' },
            { test: 'property', property: 'material', op: 'eq', value: 3 },
            { test: 'property', property: 'material', op: 'ne', value: 'wood' },
            { test: 'tag', tag: 'player' },
          ]),
          {
            id: 's',
            kind: 'sensor',
            entity: 'rope',
            filter: [{ test: 'property', property: 'hp', op: 'lte', value: false }],
            observed: true,
          },
          { id: 'seq', kind: 'sequence', steps: ['reset', 'a', 'a'], observed: true },
          { id: 'rand', kind: 'random', outcomes: ['in', 'b'], observed: true },
          { id: 'door', kind: 'receiver', receiver: 'door' },
          { id: 'fact', kind: 'receiver', receiver: 'fact' },
          { id: 'cue', kind: 'receiver', receiver: 'audio-cue', key: 'sfx-bell' },
          { id: 'set', kind: 'set-property', entity: 'lamp', on: {} },
        ]),
      ),
    ).toEqual([
      'nodes.1.id: duplicate node id "l"',
      'nodes.2.filter.0.op: "gt" needs a number property; "burning" is not',
      'nodes.2.filter.1.value: "weight" compares with a number value',
      'nodes.2.filter.2.value: "material" compares with a string value',
      'nodes.3.filter.0.value: "hp" compares with a number value',
      'nodes.4.steps.0: "reset" is reserved and cannot name a port',
      'nodes.4.steps.2: duplicate port "a"',
      'nodes.5.outcomes.0: "in" is reserved and cannot name a port',
      'nodes.6.entity: a door receiver needs an entity',
      'nodes.7.key: a fact receiver needs a key',
      'nodes.9.on: must set at least one property',
    ]);
  });

  it('reports field errors without running the graph checks', () => {
    expect(
      problems(
        graph([
          { id: 'v', kind: 'volume', shape: { ...box, halfExtents: { x: -1, y: 1, z: 1 } } },
          { id: 'x', kind: 'teleporter' },
          { id: 'd', kind: 'delay', seconds: 0 },
          { id: 'p', kind: 'pulse', edge: 'sideways' },
          {
            id: 'f',
            kind: 'volume',
            shape: box,
            filter: [{ test: 'property', property: 'lightEmitter', op: 'eq', value: 1 }],
          },
          { id: 's', kind: 'set-property', entity: 'lamp', on: { material: 'wood' } },
        ]),
      ),
    ).toEqual([
      'nodes.0.shape.halfExtents.x: Too small: expected number to be >=0',
      "nodes.1.kind: Invalid discriminator value. Expected 'volume' | 'lever' | 'button' | 'sensor' | 'and' | 'or' | 'xor' | 'not' | 'delay' | 'timer' | 'pulse' | 'latch' | 'counter' | 'sequence' | 'random' | 'clue' | 'receiver' | 'set-property'",
      'nodes.2.seconds: Too small: expected number to be >0',
      'nodes.3.edge: Invalid option: expected one of "rising"|"falling"|"both"',
      expect.stringMatching(/^nodes\.4\.filter\.0\.property: Invalid option/),
      'nodes.5.on: world property "material" is not allowed here',
    ]);
    expect(problems(graph([], []))).toEqual(['nodes: Too small: expected array to have >=1 items']);
    expect(problems({ ...graph([door()]), wires: [{ from: 'a.b.c', to: 'door' }] })).toEqual([
      'wires.0.from: must be "node" or "node.port", e.g. "plate.enter"',
    ]);
  });

  it('describes every kind’s ports, the first being the default', () => {
    const ports = (node: object) => signalPorts(node as SignalGraphNode);
    expect(ports({ kind: 'volume' }).outputs).toEqual(['active', 'stay', 'enter', 'exit']);
    for (const kind of ['lever', 'button', 'sensor']) {
      expect(ports({ kind })).toEqual({ inputs: [], outputs: ['out'] });
    }
    for (const kind of ['and', 'or', 'xor', 'not', 'delay', 'timer', 'pulse']) {
      expect(ports({ kind })).toEqual({ inputs: ['in'], outputs: ['out'] });
    }
    expect(ports({ kind: 'latch' }).inputs).toEqual(['set', 'reset', 'toggle']);
    expect(ports({ kind: 'counter' }).inputs).toEqual(['in', 'reset']);
    expect(ports({ kind: 'sequence', steps: ['a', 'b'] })).toEqual({
      inputs: ['a', 'b', 'reset'],
      outputs: ['success', 'failed'],
    });
    expect(ports({ kind: 'random', outcomes: ['l', 'r'] }).outputs).toEqual(['l', 'r']);
    for (const kind of ['receiver', 'set-property']) {
      expect(ports({ kind })).toEqual({ inputs: ['in'], outputs: [] });
    }
  });
});
