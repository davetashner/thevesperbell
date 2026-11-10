import { describe, expect, it } from 'vitest';
import {
  compileSignalGraph,
  parseEndpoint,
  SignalGraphError,
  signalPorts,
  translateShape,
  type SignalGraphDef,
  type SignalGraphProblem,
  type SignalNodeDef,
} from './graph';

const box = {
  kind: 'box',
  center: { x: 0, y: 0, z: 0 },
  halfExtents: { x: 1, y: 1, z: 1 },
} as const;

function graph(nodes: unknown[], wires: [string, string][] = []): SignalGraphDef {
  return {
    id: 'test',
    nodes: nodes as SignalNodeDef[],
    wires: wires.map(([from, to]) => ({ from, to })),
  };
}

/** The problems compiling `def` reports, as `path: message` lines ([] when it compiles). */
function problems(def: SignalGraphDef): string[] {
  try {
    compileSignalGraph(def);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(SignalGraphError);
    return (error as SignalGraphError).problems.map(
      (p: SignalGraphProblem) => `${p.path.join('.')}: ${p.message}`,
    );
  }
}

const lever = (id: string) => ({ id, kind: 'lever' });
const door = (id: string) => ({ id, kind: 'receiver', receiver: 'door', entity: 'gate' });

describe('signal graph compilation', () => {
  it('orders nodes topologically with ties broken by id, whatever the file order', () => {
    const def = graph(
      [door('z-door'), { id: 'and', kind: 'and' }, lever('b'), lever('a')],
      [
        ['b', 'and'],
        ['a', 'and'],
        ['and', 'z-door'],
      ],
    );
    const { order, inputs, bindings } = compileSignalGraph(def);
    expect(order.map((i) => def.nodes[i]?.id)).toEqual(['a', 'b', 'and', 'z-door']);
    expect(inputs[1]).toEqual({ in: ['b.out', 'a.out'] });
    expect(bindings).toEqual(['gate']);
    expect(compileSignalGraph(def)).toBe(compileSignalGraph(def)); // cached per definition
  });

  it('AC-4: rejects a zero-delay cycle naming its nodes', () => {
    const def = graph(
      [
        lever('l'),
        { id: 'a', kind: 'or' },
        { id: 'b', kind: 'not' },
        { id: 'c', kind: 'or' },
        door('d'),
      ],
      [
        ['l', 'a'],
        ['c', 'a'],
        ['a', 'b'],
        ['b', 'c'],
        ['l', 'c'],
        ['c', 'd'],
      ],
    );
    expect(problems(def)).toEqual([
      'wires: zero-delay cycle a → b → c → a: route it through a delay or latch',
    ]);
    expect(() => compileSignalGraph(def)).toThrow(
      /signal graph "test" is invalid:\n {2}wires: zero-delay/,
    );
  });

  it('AC-4: accepts a loop through a delay or a latch', () => {
    const loop = (kind: string, port: string) =>
      graph(
        [{ id: 'n', kind: 'not' }, { id: 'r', kind, seconds: 1 }, door('d')],
        [
          ['n', `r.${port}`],
          ['r', 'n'],
          ['n', 'd'],
        ],
      );
    expect(problems(loop('delay', 'in'))).toEqual([]);
    expect(problems(loop('latch', 'toggle'))).toEqual([]);
  });

  it('AC-5: rejects wires to missing nodes and ports, naming the id', () => {
    const def = graph(
      [lever('l'), door('d'), { id: 'seq', kind: 'sequence', steps: ['x', 'y'] }],
      [
        ['l', 'dor'],
        ['ghost.out', 'd'],
        ['l.up', 'd'],
        ['d', 'seq.x'],
        ['l', 'seq.z'],
        ['l', 'l'],
        ['l', 'seq.y'],
      ],
    );
    expect(problems(def)).toEqual([
      'wires.0.to: wire to missing node "dor"',
      'wires.1.from: wire from missing node "ghost"',
      'wires.2.from: node "l" (lever) has no output port "up"; its outputs: out',
      'wires.3.from: node "d" (receiver) has no output port ""; its outputs: none',
      'wires.4.to: node "seq" (sequence) has no input port "z"; its inputs: x, y, reset',
      'wires.5.to: node "l" (lever) has no input port ""; its inputs: none',
      'nodes.1: node "d" needs 1 wire(s) into "in", has 0',
      'nodes.2: node "seq" needs 1 wire(s) into "x", has 0',
    ]);
  });

  it('checks wire counts per port', () => {
    const def = graph(
      [
        lever('l'),
        { id: 'and', kind: 'and' },
        { id: 'not', kind: 'not' },
        { id: 'latch', kind: 'latch' },
        { id: 'pulse', kind: 'pulse' },
        door('d'),
      ],
      [
        ['l', 'and'],
        ['l', 'not'],
        ['and', 'not'],
        ['not', 'latch.reset'],
        ['latch', 'd'],
      ],
    );
    expect(problems(def)).toEqual([
      'nodes.1: node "and" needs 2 wire(s) into "in", has 1',
      'nodes.2: node "not" (not) takes exactly one wire',
      'nodes.3: node "latch" (latch) needs a wire into "set" or "toggle"',
      'nodes.4: node "pulse" needs 1 wire(s) into "in", has 0',
    ]);
  });

  it('rejects bad node ids and unknown kinds', () => {
    expect(
      problems(graph([lever('A'), lever('a'), lever('a'), { id: 'x', kind: 'teleporter' }])),
    ).toEqual([
      'nodes.0.id: node id must be kebab-case, got "A"',
      'nodes.2.id: duplicate node id "a"',
      'nodes.3.kind: unknown node kind "teleporter"',
    ]);
  });

  it('checks volume parameters and filters', () => {
    const volume = (extra: object) => graph([{ id: 'v', kind: 'volume', shape: box, ...extra }]);
    expect(problems(volume({ minCount: 2, minWeight: 20, filter: [] }))).toEqual([]);
    expect(problems(volume({ shape: { kind: 'sphere', center: box.center, radius: -1 } }))).toEqual(
      ['nodes.0.shape: sphere.radius must be ≥ 0, got -1'],
    );
    expect(problems(volume({ shape: { kind: 'point', at: box.center } }))).toEqual([
      'nodes.0.shape: a volume is a box, sphere or capsule, not a point',
    ]);
    expect(problems(volume({ minCount: 0, minWeight: -1 }))).toEqual([
      'nodes.0.minCount: must be a whole number ≥ 1',
      'nodes.0.minWeight: must be a finite number ≥ 0',
    ]);
    expect(problems(volume({ minCount: 1.5 }))).toEqual([
      'nodes.0.minCount: must be a whole number ≥ 1',
    ]);
    expect(
      problems(
        volume({
          filter: [
            { test: 'facing', facing: 'north' },
            { test: 'facing', facing: 'up' as never },
          ],
        }),
      ),
    ).toEqual(['nodes.0.filter.1: unknown facing "up"; one of north, east, south, west']);
    expect(
      problems(
        volume({
          filter: [
            { test: 'tag', tag: 'Player' },
            { test: 'element', element: 'lava' },
            { test: 'property', property: 'mass', op: 'eq', value: 1 },
            { test: 'property', property: 'weight', op: 'approx', value: 1 },
            { test: 'property', property: 'lightEmitter', op: 'eq', value: 1 },
            { test: 'property', property: 'burning', op: 'gt', value: true },
            { test: 'property', property: 'owner', op: 'lt', value: 'x' },
            { test: 'property', property: 'weight', op: 'gte', value: '20' },
            { test: 'property', property: 'owner', op: 'ne', value: 1 },
            { test: 'shape' },
            { test: 'property', property: 'owner', op: 'eq', value: 'crown' },
            { test: 'element', element: 'fire' },
            { test: 'property', property: 'toughness', op: 'eq', value: 1 },
            { test: 'property', property: 'surfaceHardness', op: 'gt', value: 'hard' },
            { test: 'property', property: 'surfaceHardness', op: 'eq', value: 'firm' },
            { test: 'property', property: 'surfaceHardness', op: 'eq', value: 'hard' },
          ],
        }),
      ),
    ).toEqual([
      'nodes.0.filter.0: tag must be a kebab-case id, got "Player"',
      'nodes.0.filter.1: unknown element "lava"',
      'nodes.0.filter.2: unknown world property "mass"',
      'nodes.0.filter.3: unknown operator "approx"',
      'nodes.0.filter.4: "lightEmitter" is a record and cannot be compared',
      'nodes.0.filter.5: "gt" needs a number property; "burning" is a boolean',
      'nodes.0.filter.6: "lt" needs a number property; "owner" is an id',
      'nodes.0.filter.7: "weight" compares with a number value',
      'nodes.0.filter.8: "owner" compares with a string value',
      'nodes.0.filter.9: unknown predicate test "shape"',
      'nodes.0.filter.12: "toughness" is a record and cannot be compared',
      'nodes.0.filter.13: "gt" needs a number property; "surfaceHardness" is an enum',
      'nodes.0.filter.14: "surfaceHardness" is one of soft, medium, hard, never "firm"',
    ]);
  });

  it('checks the parameters of every other kind', () => {
    const def = graph([
      { id: 'sensor', kind: 'sensor', entity: 'brazier', filter: [] },
      { id: 'sensor-2', kind: 'sensor', entity: 'brazier', filter: [{ test: 'tag', tag: 'X' }] },
      { id: 'delay', kind: 'delay', seconds: 0 },
      { id: 'timer', kind: 'timer', seconds: Number.POSITIVE_INFINITY },
      { id: 'pulse', kind: 'pulse', edge: 'sideways' },
      { id: 'counter', kind: 'counter', target: 0 },
      { id: 'seq', kind: 'sequence', steps: ['a'] },
      { id: 'seq-2', kind: 'sequence', steps: ['reset', 'in', 'B', 'a', 'a'] },
      { id: 'rand', kind: 'random', outcomes: ['left', 'left'] },
      { id: 'recv', kind: 'receiver', receiver: 'portal' },
      { id: 'door', kind: 'receiver', receiver: 'door' },
      { id: 'fact', kind: 'receiver', receiver: 'fact' },
      { id: 'cue', kind: 'receiver', receiver: 'audio-cue', key: '' },
      { id: 'set', kind: 'set-property', entity: 'lamp', on: {} },
      {
        id: 'set-2',
        kind: 'set-property',
        entity: 'lamp',
        on: { glow: 1, wetness: 2 },
        off: { burning: 'no' },
      },
    ]);
    expect(problems(def)).toEqual([
      'nodes.0.filter: a sensor needs at least one predicate',
      'nodes.1.filter.0: tag must be a kebab-case id, got "X"',
      'nodes.2.seconds: must be a finite number > 0',
      'nodes.3.seconds: must be a finite number > 0',
      'nodes.4.edge: unknown edge "sideways"',
      'nodes.5.target: must be a whole number ≥ 1',
      'nodes.6.steps: needs at least two ports',
      'nodes.7.steps.0: "reset" is not a valid port name',
      'nodes.7.steps.1: "in" is not a valid port name',
      'nodes.7.steps.2: "B" is not a valid port name',
      'nodes.7.steps.4: duplicate port "a"',
      'nodes.8.outcomes.1: duplicate port "left"',
      'nodes.9.receiver: unknown receiver "portal"',
      'nodes.10.entity: a door receiver needs an entity',
      'nodes.11.key: a fact receiver needs a key',
      'nodes.12.key: a audio-cue receiver needs a key',
      'nodes.13.on: must set at least one property',
      'nodes.14.on.glow: unknown world property "glow"',
      'nodes.14.on.wetness: wetness must be ≤ 1, got 2',
      'nodes.14.off.burning: burning must be true or false',
    ]);
  });

  it('describes every kind’s ports, the first being the default', () => {
    const ports = (node: object) => signalPorts(node as SignalNodeDef);
    expect(ports({ kind: 'volume' })).toEqual({
      inputs: [],
      outputs: ['active', 'stay', 'enter', 'exit'],
    });
    for (const kind of ['lever', 'button', 'sensor']) {
      expect(ports({ kind })).toEqual({ inputs: [], outputs: ['out'] });
    }
    for (const kind of ['and', 'or', 'xor', 'not', 'delay', 'timer', 'pulse']) {
      expect(ports({ kind })).toEqual({ inputs: ['in'], outputs: ['out'] });
    }
    expect(ports({ kind: 'latch' })).toEqual({
      inputs: ['set', 'reset', 'toggle'],
      outputs: ['out'],
    });
    expect(ports({ kind: 'counter' })).toEqual({ inputs: ['in', 'reset'], outputs: ['out'] });
    expect(ports({ kind: 'sequence', steps: ['a', 'b'] })).toEqual({
      inputs: ['a', 'b', 'reset'],
      outputs: ['success', 'failed'],
    });
    expect(ports({ kind: 'random', outcomes: ['l', 'r'] })).toEqual({
      inputs: ['in'],
      outputs: ['l', 'r'],
    });
    for (const kind of ['receiver', 'set-property']) {
      expect(ports({ kind })).toEqual({ inputs: ['in'], outputs: [] });
    }
  });

  it('parses wire endpoints', () => {
    expect(parseEndpoint('plate')).toEqual({ node: 'plate', port: undefined });
    expect(parseEndpoint('plate.enter')).toEqual({ node: 'plate', port: 'enter' });
  });

  it('moves volume shapes by an origin', () => {
    const o = { x: 1, y: 2, z: 3 };
    expect(translateShape(box, o)).toEqual({ ...box, center: o });
    expect(translateShape({ kind: 'sphere', center: o, radius: 2 }, o)).toEqual({
      kind: 'sphere',
      center: { x: 2, y: 4, z: 6 },
      radius: 2,
    });
    expect(translateShape({ kind: 'capsule', from: box.center, to: o, radius: 1 }, o)).toEqual({
      kind: 'capsule',
      from: o,
      to: { x: 2, y: 4, z: 6 },
      radius: 1,
    });
  });
});
