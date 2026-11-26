// Contract between layers (mw-e03.21): signal graphs are validated as content
// (src/content/types/signal-graph.ts) and run by the sim (src/sim/signals). Content may import the
// sim only as types, so this runtime check lives outside src/: both sides agree on the vocabulary,
// on each node's ports and on which graphs are valid, and every shipped graph compiles and runs in
// the sim, with its intended solution driven end to end.

import { describe, expect, it } from 'vitest';
import * as content from '@content/index';
import { describeContent, markExercised } from '@content/testing';
import {
  addProperties,
  addSignalGraph,
  compileSignalGraph,
  getProperty,
  installSignals,
  installStimuli,
  placeEntity,
  PREDICATE_OPS,
  registerWorldProperties,
  REGISTERED_KINDS,
  setLever,
  setProperty,
  SIGNAL_ELEMENTS,
  SIGNAL_NODE_KINDS,
  SIGNAL_RECEIVERS,
  signalOutput,
  signalPorts,
  signalReceived,
  signalSystem,
  tagEntity,
  World,
  type EntityId,
  type SignalGraphDef,
  type SignalReceipt,
} from '@sim/index';

const HZ = 10;
const catalogue = content.loadGameContent();

function world() {
  return installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3, hz: HZ }))),
  ).addSystem(signalSystem());
}

/** Places `entry` with a fresh entity for every binding; returns the graph and the bindings. */
function place(w: World<never>, entry: content.GameEntry<'signal-graph'>) {
  const def = entry as SignalGraphDef; // a content graph is a sim graph definition plus name/notes
  const bindings: Record<string, EntityId> = Object.fromEntries(
    compileSignalGraph(def).bindings.map((name) => [name, w.spawn()]),
  );
  return { graph: addSignalGraph(w, def, { bindings }), bindings };
}

function receipts(w: World<never>): SignalReceipt[] {
  const seen: SignalReceipt[] = [];
  w.events.on(signalReceived, (r) => seen.push(r));
  return seen;
}

/** The entity a binding was given. */
function bound(bindings: Readonly<Record<string, EntityId>>, name: string): EntityId {
  const entity = bindings[name];
  if (entity === undefined) throw new Error(`no binding ${name}`);
  return entity;
}

const run = (w: World<never>, ticks: number) => {
  for (let t = 0; t < ticks; t++) w.step();
};

describe('signal graph vocabulary', () => {
  it('content and sim list the same kinds, receivers, operators, elements and registered kinds', () => {
    expect(content.SIGNAL_NODE_KINDS).toEqual(SIGNAL_NODE_KINDS);
    expect(content.SIGNAL_RECEIVERS).toEqual(SIGNAL_RECEIVERS);
    expect(content.PREDICATE_OPS).toEqual(PREDICATE_OPS);
    expect(content.SIGNAL_ELEMENTS).toEqual(SIGNAL_ELEMENTS);
    expect(content.REGISTERED_KINDS).toEqual(REGISTERED_KINDS);
  });

  it('content and sim reject and accept the same graphs', () => {
    const lever = (id: string) => ({ id, kind: 'lever' });
    const door = { id: 'door', kind: 'receiver', receiver: 'door', entity: 'gate' };
    const graphs: [string, unknown[], [string, string][]][] = [
      [
        'valid',
        [lever('a'), lever('b'), { id: 'and', kind: 'and' }, door],
        [
          ['a', 'and'],
          ['b', 'and'],
          ['and', 'door'],
        ],
      ],
      [
        'missing node',
        [lever('a'), door],
        [
          ['a', 'dor'],
          ['a', 'door'],
        ],
      ],
      ['unknown port', [lever('a'), door], [['a.up', 'door']]],
      [
        'cycle',
        [{ id: 'n', kind: 'not' }, { id: 'o', kind: 'or' }, lever('a'), door],
        [
          ['n', 'o'],
          ['a', 'o'],
          ['o', 'n'],
          ['n', 'door'],
        ],
      ],
      [
        'delay loop',
        [{ id: 'n', kind: 'not' }, { id: 'd', kind: 'delay', seconds: 1 }, door],
        [
          ['n', 'd'],
          ['d', 'n'],
          ['n', 'door'],
        ],
      ],
      [
        'one operand',
        [lever('a'), { id: 'and', kind: 'and' }, door],
        [
          ['a', 'and'],
          ['and', 'door'],
        ],
      ],
      [
        'two into not',
        [lever('a'), lever('b'), { id: 'n', kind: 'not' }, door],
        [
          ['a', 'n'],
          ['b', 'n'],
          ['n', 'door'],
        ],
      ],
      [
        'unset latch',
        [lever('a'), { id: 'l', kind: 'latch' }, door],
        [
          ['a', 'l.reset'],
          ['l', 'door'],
        ],
      ],
      ['keyless fact', [lever('a'), { id: 'f', kind: 'receiver', receiver: 'fact' }], [['a', 'f']]],
    ];
    const verdicts = graphs.map(([name, nodes, wires]) => {
      const def = {
        id: 'g',
        name: 'G',
        notes: 'N',
        nodes,
        wires: wires.map(([from, to]) => ({ from, to })),
      };
      const inContent = content.signalGraphSchema.safeParse(def).success;
      let inSim = true;
      try {
        compileSignalGraph(def as SignalGraphDef);
      } catch {
        inSim = false;
      }
      return [name, inContent, inSim];
    });
    expect(verdicts).toEqual(
      graphs.map(([name]) => [
        name,
        name.endsWith('valid') || name === 'delay loop',
        name.endsWith('valid') || name === 'delay loop',
      ]),
    );
  });
});

describeContent('signal-graph', 'compiles and runs in the sim with matching ports', (entry) => {
  const w = world();
  const def = entry as SignalGraphDef;
  expect(def.nodes.map((node) => signalPorts(node))).toEqual(
    entry.nodes.map((node) => content.signalPorts(node)),
  );
  place(w, entry);
  run(w, 5);
});

describe('shipped mechanisms work as their notes describe', () => {
  it('Kestrel Lock: each paddle works its sluice, and the lock settles 20 s after the tail opens', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'kestrel-lock-gates');
    const w = world();
    const { graph } = place(w, catalogue.get('signal-graph', 'kestrel-lock-gates'));
    const seen = receipts(w);
    setLever(w, graph, 'upper-paddle', true);
    run(w, 40);
    expect(seen.map((r) => [r.node, r.value])).toEqual([['head-sluice', true]]);
    expect(seen[0]?.key).toBe('fill');
    setLever(w, graph, 'lower-paddle', true);
    run(w, 20 * HZ);
    expect(seen.map((r) => r.node)).toEqual(['head-sluice', 'tail-drain']);
    w.step();
    expect(seen.map((r) => [r.node, r.value]).slice(2)).toEqual([['gate-open-fact', true]]);
    expect(seen[2]?.key).toBe('kestrel-lock.gate-open');
  });

  it('Chapel of Echoes: cutting or burning the rope drops the portcullis for good', ({ task }) => {
    markExercised(task, 'signal-graph', 'chapel-portcullis');
    for (const cut of [true, false]) {
      const w = world();
      const { graph, bindings } = place(w, catalogue.get('signal-graph', 'chapel-portcullis'));
      const rope = bound(bindings, 'counterweight-rope');
      addProperties(w, rope, { hp: 10, burning: false, flammable: true });
      run(w, 2);
      expect(signalOutput(w, graph, 'raised')).toBe(true);
      if (cut) setProperty(w, rope, 'hp', 0);
      else setProperty(w, rope, 'burning', true);
      run(w, 2);
      expect(signalOutput(w, graph, 'raised')).toBe(false);
      setProperty(w, rope, 'burning', false);
      setProperty(w, rope, 'hp', 10);
      run(w, 2);
      expect(signalOutput(w, graph, 'raised')).toBe(false); // latched down
    }
  });

  it('Millweir sluice: 40 kg on the flagstone opens it, and it stays open 8 s after', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'millweir-sluice');
    const w = world();
    const { graph } = place(w, catalogue.get('signal-graph', 'millweir-sluice'));
    const light = w.spawn();
    addProperties(w, light, { weight: 30 });
    placeEntity(w, light, { x: 0, y: 0, z: 0 });
    run(w, 2);
    expect(signalOutput(w, graph, 'open')).toBe(false);
    const crate = w.spawn();
    addProperties(w, crate, { weight: 30 });
    placeEntity(w, crate, { x: 0.2, y: 0, z: 0 });
    run(w, 1);
    expect(signalOutput(w, graph, 'open')).toBe(true);
    placeEntity(w, crate, { x: 5, y: 0, z: 0 });
    run(w, 8 * HZ);
    expect(signalOutput(w, graph, 'open')).toBe(true);
    run(w, 1);
    expect(signalOutput(w, graph, 'open')).toBe(false);
  });

  it('Rune plates: west, middle, east opens the vault; a wrong plate fires the trap', ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'greybox-rune-plates');
    const w = world();
    const { bindings } = place(w, catalogue.get('signal-graph', 'greybox-rune-plates'));
    const seen = receipts(w);
    const player = w.spawn();
    tagEntity(w, player, 'player');
    const walk = (x: number) => {
      placeEntity(w, player, { x, y: 0, z: 0 });
      run(w, 2);
      placeEntity(w, player, { x, y: 5, z: 0 }); // step off
      run(w, 2);
    };
    walk(-2);
    walk(2);
    expect(seen.map((r) => [r.node, r.value])).toEqual([
      ['trap', true],
      ['trap', false],
    ]);
    walk(-2);
    walk(0);
    walk(2);
    expect(seen.slice(2).map((r) => [r.node, r.value])).toEqual([['vault-door', true]]);
    const lamp = bound(bindings, 'vault-lamp');
    const torch = w.spawn();
    addProperties(w, torch, { burning: true, flammable: true });
    placeEntity(w, torch, { x: 0, y: 1, z: 3 });
    run(w, 1); // the lamp gains its light at the end of the tick (it had no lightEmitter)
    expect(getProperty(w, lamp, 'lightEmitter')).toEqual({ intensity: 100, radius: 8 });
  });
});
