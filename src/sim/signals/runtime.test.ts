import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addProperties,
  getProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { hashWorld } from '../snapshot';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import { tagEntity } from './filter';
import type { SignalGraphDef, SignalNodeDef } from './graph';
import {
  addSignalGraph,
  evaluateSignalGraphs,
  installSignals,
  pressButton,
  setLever,
  signalGraphOf,
  signalOutput,
  signalReceived,
  signalSystem,
  soundClueCued,
  toggleLever,
  volumeEntered,
  volumeExited,
  volumeOccupants,
  type SignalGraphOptions,
  type SignalReceipt,
  type SoundClueCue,
  type VolumeCrossing,
} from './runtime';

const HZ = 10;
const O = { x: 0, y: 0, z: 0 };
const FAR = { x: 100, y: 0, z: 0 };
const box = { kind: 'box', center: O, halfExtents: { x: 1, y: 1, z: 1 } } as const;

function world() {
  const w = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 7, hz: HZ }))),
  );
  return w.addSystem(signalSystem());
}

function graph(nodes: unknown[], wires: [string, string][] = []): SignalGraphDef {
  return {
    id: 'g',
    nodes: nodes as SignalNodeDef[],
    wires: wires.map(([from, to]) => ({ from, to })),
  };
}

/** Everything the graphs emit, in order: `node=value` receipts and `+node:e` / `-node:e` crossings. */
function trace(w: World<never>): string[] {
  const seen: string[] = [];
  w.events.on(signalReceived, (r: SignalReceipt) => seen.push(`${r.node}=${String(r.value)}`));
  w.events.on(volumeEntered, (c: VolumeCrossing) => seen.push(`+${c.node}:${String(c.entity)}`));
  w.events.on(volumeExited, (c: VolumeCrossing) => seen.push(`-${c.node}:${String(c.entity)}`));
  return seen;
}

function thing(w: World<never>, init: WorldPropertyInit, at: typeof O | null = FAR): EntityId {
  const id = w.spawn();
  addProperties(w, id, init);
  if (at !== null) placeEntity(w, id, at);
  return id;
}

const door = (id = 'door') => ({ id, kind: 'receiver', receiver: 'door', entity: 'gate' });

function place(w: World<never>, def: SignalGraphDef, options: SignalGraphOptions = {}) {
  const bindings = def.nodes.some((n) => 'entity' in n && n.entity === 'gate')
    ? { gate: w.spawn() }
    : {};
  return addSignalGraph(w, def, { bindings, ...options });
}

/** Steps `n` ticks and returns what each tick's trace added. */
function steps(w: World<never>, seen: string[], n = 1): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const before = seen.length;
    w.step();
    out.push(seen.slice(before));
  }
  return out;
}

describe('trigger volumes', () => {
  it('AC-1: a volume filtered to burning fires enter for a burning object, not a player', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          {
            id: 'hearth',
            kind: 'volume',
            shape: box,
            filter: [{ test: 'property', property: 'burning', op: 'eq', value: true }],
          },
          door(),
        ],
        [['hearth.enter', 'door']],
      ),
    );
    const seen = trace(w);
    const player = thing(w, { burning: false, flammable: true });
    tagEntity(w, player, 'player');
    const torch = thing(w, { burning: true, flammable: true });
    w.step();
    placeEntity(w, player, O);
    expect(steps(w, seen)).toEqual([[]]);
    expect(signalOutput(w, g, 'hearth', 'stay')).toBe(false);
    placeEntity(w, torch, O);
    expect(steps(w, seen, 2)).toEqual([[`+hearth:${String(torch)}`, 'door=true'], ['door=false']]);
    expect(volumeOccupants(w, g, 'hearth')).toEqual([torch]);
    expect(signalOutput(w, g, 'hearth', 'stay')).toBe(true);
    expect(signalOutput(w, g, 'hearth')).toBe(true); // active, the default port
    setProperty(w, torch, 'burning', false); // doused: no longer passes, so it leaves
    expect(steps(w, seen)).toEqual([[`-hearth:${String(torch)}`]]);
    expect(signalOutput(w, g, 'hearth', 'exit')).toBe(true);
  });

  it('a pressure plate needs enough occupants and total weight', () => {
    const w = world();
    const g = place(
      w,
      graph([
        { id: 'plate', kind: 'volume', shape: box, minWeight: 20, minCount: 2, observed: true },
      ]),
    );
    const a = thing(w, { weight: 15 }, O);
    w.step();
    expect(signalOutput(w, g, 'plate')).toBe(false);
    const b = thing(w, { weight: 4 }, O);
    w.step();
    expect(volumeOccupants(w, g, 'plate')).toEqual([a, b]);
    expect(signalOutput(w, g, 'plate')).toBe(false); // 19 kg
    thing(w, { weight: 1 }, O);
    w.step();
    expect(signalOutput(w, g, 'plate')).toBe(true);
    w.destroy(a);
    w.step();
    expect(signalOutput(w, g, 'plate')).toBe(false);
    expect(signalOutput(w, g, 'plate', 'exit')).toBe(true);
  });

  it('filters by tag and element presence, and follows the graph origin', () => {
    const w = world();
    const volume = (id: string, filter: unknown[]) => ({ id, kind: 'volume', shape: box, filter });
    const g = place(
      w,
      graph([
        volume('players', [{ test: 'tag', tag: 'player' }]),
        volume('fire', [{ test: 'element', element: 'fire' }]),
        volume('water', [{ test: 'element', element: 'water' }]),
        volume('ice', [{ test: 'element', element: 'ice' }]),
        volume('charge', [{ test: 'element', element: 'charge' }]),
        volume('heavy', [{ test: 'property', property: 'weight', op: 'gte', value: 50 }]),
        volume('all', []),
        { id: 'unmoved', kind: 'lever', observed: true },
      ]),
      { origin: { x: 10, y: 0, z: 0 } },
    );
    const at = { x: 10, y: 0, z: 0 };
    const hero = thing(w, { weight: 80 }, at);
    tagEntity(w, hero, 'player', 'actor');
    const log = thing(w, { burning: true, flammable: true, wetness: 0.2 }, at);
    const block = thing(w, { frozen: true, temperature: -5, charge: 3 }, at);
    thing(w, {}, O); // outside the moved volumes
    w.step();
    const inside = (node: string) => volumeOccupants(w, g, node);
    expect(inside('players')).toEqual([hero]);
    expect(inside('fire')).toEqual([log]);
    expect(inside('water')).toEqual([log]);
    expect(inside('ice')).toEqual([block]);
    expect(inside('charge')).toEqual([block]);
    expect(inside('heavy')).toEqual([hero]);
    expect(inside('all')).toEqual([hero, log, block]);
  });
});

describe('logic nodes', () => {
  it('AC-2: an AND of two levers is on only when both are, on the same tick', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'left', kind: 'lever' },
          { id: 'right', kind: 'lever' },
          { id: 'both', kind: 'and' },
          door(),
        ],
        [
          ['left', 'both'],
          ['right', 'both'],
          ['both', 'door'],
        ],
      ),
    );
    const seen = trace(w);
    expect(setLever(w, g, 'left', true)).toBe(true);
    expect(steps(w, seen)).toEqual([[]]);
    expect(signalOutput(w, g, 'both')).toBe(false);
    expect(setLever(w, g, 'left', true)).toBe(false);
    setLever(w, g, 'right', true);
    const tick = w.tick;
    const receipts: SignalReceipt[] = [];
    w.events.on(signalReceived, (r) => receipts.push(r));
    w.step();
    expect(signalOutput(w, g, 'both')).toBe(true);
    expect(receipts).toEqual([
      {
        graph: g,
        graphId: 'g',
        node: 'door',
        receiver: 'door',
        entity: signalGraphOf(w, g).bindings['gate'],
        key: null,
        value: true,
        tick,
      },
    ]);
    expect(toggleLever(w, g, 'right')).toBe(false);
    w.step();
    expect(signalOutput(w, g, 'both')).toBe(false);
  });

  it('or, xor and not combine their operands', () => {
    const w = world();
    const levers = ['a', 'b', 'c'].map((id) => ({ id, kind: 'lever' }));
    const g = place(
      w,
      graph(
        [
          ...levers,
          { id: 'any', kind: 'or' },
          { id: 'odd', kind: 'xor' },
          { id: 'none', kind: 'not' },
        ],
        [
          ['a', 'any'],
          ['b', 'any'],
          ['a', 'odd'],
          ['b', 'odd'],
          ['c', 'odd'],
          ['any', 'none'],
        ],
      ),
    );
    const read = () => ['any', 'odd', 'none'].map((n) => signalOutput(w, g, n));
    w.step();
    expect(read()).toEqual([false, false, true]);
    setLever(w, g, 'a', true);
    w.step();
    expect(read()).toEqual([true, true, false]);
    setLever(w, g, 'c', true);
    w.step();
    expect(read()).toEqual([true, false, false]);
    setLever(w, g, 'b', true);
    w.step();
    expect(read()).toEqual([true, true, false]);
  });

  it('a button pulses for one tick; a pulse node fires on its chosen edges', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'lever', kind: 'lever', initial: true },
          { id: 'button', kind: 'button', entity: 'gate' },
          { id: 'up', kind: 'pulse' },
          { id: 'down', kind: 'pulse', edge: 'falling' },
          { id: 'both', kind: 'pulse', edge: 'both' },
        ],
        [
          ['lever', 'up'],
          ['lever', 'down'],
          ['lever', 'both'],
        ],
      ),
    );
    const read = () => ['button', 'up', 'down', 'both'].map((n) => signalOutput(w, g, n));
    pressButton(w, g, 'button');
    w.step();
    expect(read()).toEqual([true, true, false, true]); // lever starts on: a rising edge on tick one
    w.step();
    expect(read()).toEqual([false, false, false, false]);
    setLever(w, g, 'lever', false);
    w.step();
    expect(read()).toEqual([false, false, true, true]);
  });

  it('a timer holds for its duration, retriggering unless told not to', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'button', kind: 'button' },
          { id: 'retrig', kind: 'timer', seconds: 0.3 },
          { id: 'once', kind: 'timer', seconds: 0.3, retrigger: false },
        ],
        [
          ['button', 'retrig'],
          ['button', 'once'],
        ],
      ),
    );
    const read = () => ['retrig', 'once'].map((n) => signalOutput(w, g, n));
    const timeline: boolean[][] = [];
    for (let t = 0; t < 7; t++) {
      if (t === 0 || t === 2) pressButton(w, g, 'button');
      w.step();
      timeline.push(read());
    }
    expect(timeline).toEqual([
      [true, true],
      [true, true],
      [true, true], // pressed again: `retrig` restarts, `once` keeps its end
      [true, false],
      [true, false],
      [false, false],
      [false, false],
    ]);
  });

  it('a delay repeats its input later, keeping pulses', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'button', kind: 'button' },
          { id: 'late', kind: 'delay', seconds: 0.2 },
        ],
        [['button', 'late']],
      ),
    );
    const timeline: boolean[] = [];
    for (let t = 0; t < 5; t++) {
      if (t === 0 || t === 1) pressButton(w, g, 'button');
      w.step();
      timeline.push(signalOutput(w, g, 'late'));
    }
    expect(timeline).toEqual([false, false, true, true, false]);
  });

  it('a not through a delay oscillates (a loop the delay makes legal)', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'flip', kind: 'not' },
          { id: 'wait', kind: 'delay', seconds: 0.1 },
        ],
        [
          ['wait', 'flip'],
          ['flip', 'wait'],
        ],
      ),
    );
    const timeline: boolean[] = [];
    for (let t = 0; t < 4; t++) {
      w.step();
      timeline.push(signalOutput(w, g, 'flip'));
    }
    expect(timeline).toEqual([true, false, true, false]);
  });

  it('a latch sets, resets (winning) and toggles on rising edges, showing the previous tick', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'set', kind: 'lever' },
          { id: 'reset', kind: 'lever' },
          { id: 'toggle', kind: 'lever' },
          { id: 'mem', kind: 'latch', initial: true },
        ],
        [
          ['set', 'mem.set'],
          ['reset', 'mem.reset'],
          ['toggle', 'mem.toggle'],
        ],
      ),
    );
    const run = (lever?: [string, boolean]) => {
      if (lever !== undefined) setLever(w, g, lever[0], lever[1]);
      w.step();
      return signalOutput(w, g, 'mem');
    };
    expect(run()).toBe(true); // initial
    expect(run(['toggle', true])).toBe(true); // flips at the end of this tick
    expect(run()).toBe(false); // held toggle does not flip again
    expect(run(['toggle', false])).toBe(false);
    expect(run(['set', true])).toBe(false);
    expect(run(['reset', true])).toBe(true);
    expect(run()).toBe(false); // reset wins over set
    expect(run(['reset', false])).toBe(false);
    expect(run()).toBe(true);
  });

  it('a counter counts rising edges to its target until reset', () => {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'button', kind: 'button' },
          { id: 'clear', kind: 'lever' },
          { id: 'three', kind: 'counter', target: 3 },
        ],
        [
          ['button', 'three'],
          ['clear', 'three.reset'],
        ],
      ),
    );
    const press = () => {
      pressButton(w, g, 'button');
      w.step();
      w.step();
      return signalOutput(w, g, 'three');
    };
    expect([press(), press(), press(), press()]).toEqual([false, false, true, true]);
    setLever(w, g, 'clear', true);
    w.step();
    expect(signalOutput(w, g, 'three')).toBe(false);
    setLever(w, g, 'clear', false);
    expect(press()).toBe(false);
  });

  it('a random node pulses one outcome per rising edge from a seeded stream', () => {
    const run = () => {
      const w = world();
      const g = place(
        w,
        graph(
          [
            { id: 'button', kind: 'button' },
            { id: 'coin', kind: 'random', outcomes: ['heads', 'tails', 'edge'] },
          ],
          [['button', 'coin']],
        ),
      );
      const picks: string[] = [];
      for (let t = 0; t < 12; t++) {
        pressButton(w, g, 'button');
        w.step();
        picks.push(['heads', 'tails', 'edge'].filter((p) => signalOutput(w, g, 'coin', p)).join());
        w.step();
        expect(signalOutput(w, g, 'coin', 'heads') || signalOutput(w, g, 'coin', 'tails')).toBe(
          false,
        );
      }
      return picks;
    };
    const picks = run();
    expect(picks.every((p) => ['heads', 'tails', 'edge'].includes(p))).toBe(true);
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(run()).toEqual(picks);
  });
});

describe('sequence nodes', () => {
  function sequence() {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'a', kind: 'button' },
          { id: 'b', kind: 'button' },
          { id: 'c', kind: 'button' },
          { id: 'clear', kind: 'button' },
          { id: 'runes', kind: 'sequence', steps: ['first', 'second', 'third'] },
        ],
        [
          ['a', 'runes.first'],
          ['b', 'runes.second'],
          ['c', 'runes.third'],
          ['clear', 'runes.reset'],
        ],
      ),
    );
    /** Presses the buttons (together, in one tick) and returns [success, failed]. */
    const press = (...buttons: string[]) => {
      for (const button of buttons) pressButton(w, g, button);
      w.step();
      return [signalOutput(w, g, 'runes'), signalOutput(w, g, 'runes', 'failed')];
    };
    return press;
  }

  it('AC-3: A,B,C emits success; A,C,B resets and emits a failed pulse', () => {
    const press = sequence();
    expect([press('a'), press('b'), press('c')]).toEqual([
      [false, false],
      [false, false],
      [true, false],
    ]);
    expect([press('a'), press('c')]).toEqual([
      [false, false],
      [false, true],
    ]);
    expect(press()).toEqual([false, false]); // the failure is a one-tick pulse
    expect([press('b'), press('a'), press('b'), press('c')]).toEqual([
      [false, true], // B first is out of order too
      [false, false],
      [false, false],
      [true, false],
    ]);
  });

  it('a wrong first step restarts at step two; reset restarts silently; one tick counts in step order', () => {
    const press = sequence();
    expect([press('a'), press(), press('a'), press('b'), press('c')]).toEqual([
      [false, false],
      [false, false],
      [false, true], // a held button is one edge: presses on consecutive ticks would not count twice
      [false, false],
      [true, false],
    ]);
    expect([press('a'), press('clear'), press('b')]).toEqual([
      [false, false],
      [false, false],
      [false, true],
    ]);
    press();
    expect(press('c', 'a', 'b')).toEqual([true, false]);
  });
});

/** The cues a graph sounds, as `tick:cue` strings in order. */
function cues(w: World<never>): { seen: string[]; events: SoundClueCue[] } {
  const seen: string[] = [];
  const events: SoundClueCue[] = [];
  w.events.on(soundClueCued, (e: SoundClueCue) => {
    seen.push(`${String(e.tick)}:${e.cue}`);
    events.push(e);
  });
  return { seen, events };
}

describe('clue nodes (mw-e15.5)', () => {
  function emitter(spacing?: number) {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'listen', kind: 'button' },
          {
            id: 'chimes',
            kind: 'clue',
            cues: ['chime-low', 'chime-high', 'chime-mid'],
            entity: 'gate',
            ...(spacing !== undefined && { spacing }),
          },
        ],
        [['listen', 'chimes']],
      ),
    );
    return { w, g, ...cues(w) };
  }

  it('AC-1: a clue emitter with cues [low, high, mid], triggered, fires three cue events in order at 1.0 s spacing', () => {
    const { w, g, seen, events } = emitter();
    pressButton(w, g, 'listen');
    for (let i = 0; i < 4 * HZ; i++) w.step();
    // The press is tick 0's input; the world is 10 Hz, so 1.0 s is 10 ticks.
    const first = events[0]?.tick ?? -1;
    expect(seen).toEqual([
      `${String(first)}:chime-low`,
      `${String(first + HZ)}:chime-high`,
      `${String(first + 2 * HZ)}:chime-mid`,
    ]);
    expect(events.map((e) => [e.index, e.count])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(events.every((e) => e.entity !== null && e.node === 'chimes' && e.graphId === 'g')).toBe(
      true,
    );
  });

  it('plays at the configured spacing, is on while it plays and ignores a press mid-run', () => {
    const { w, g, seen } = emitter(0.5);
    pressButton(w, g, 'listen');
    w.step();
    expect(signalOutput(w, g, 'chimes')).toBe(true);
    pressButton(w, g, 'listen'); // a press mid-run does not restart it
    for (let i = 0; i < 5; i++) w.step();
    expect(seen).toHaveLength(2); // the press at tick 1 added nothing
    for (let i = 0; i < 6; i++) w.step(); // the run ends on the third cue (tick 10)
    expect(signalOutput(w, g, 'chimes')).toBe(false);
    pressButton(w, g, 'listen');
    for (let i = 0; i < 3 * HZ; i++) w.step();
    // 0.5 s is 5 ticks: three cues, then the later press (after the run ended) plays it again.
    expect(seen).toHaveLength(6);
    const ticks = seen.map((entry) => Number(entry.split(':')[0]));
    expect(ticks.slice(0, 3).map((t) => t - (ticks[0] ?? 0))).toEqual([0, 5, 10]);
    expect(signalOutput(w, g, 'chimes')).toBe(false);
  });

  it('an unbound clue has no source, and a run resumes after a snapshot restore', () => {
    const w = world();
    const g = addSignalGraph(
      w,
      graph(
        [
          { id: 'listen', kind: 'button' },
          { id: 'chimes', kind: 'clue', cues: ['chime-low', 'chime-high'] },
        ],
        [['listen', 'chimes']],
      ),
    );
    const { events } = cues(w);
    pressButton(w, g, 'listen');
    w.step();
    expect(events.map((e) => e.entity)).toEqual([null]);
    const saved = w.snapshot();
    for (let i = 0; i < 2 * HZ; i++) w.step();
    expect(events).toHaveLength(2);
    w.restore(saved);
    for (let i = 0; i < 2 * HZ; i++) w.step();
    expect(events).toHaveLength(3); // the second cue sounded again after the restore, once
  });
});

describe('receivers', () => {
  it('report keyed receivers and write properties of bound entities', () => {
    const w = world();
    const lamp = thing(w, { burning: false, flammable: true });
    const bare = thing(w, {});
    const g = addSignalGraph(
      w,
      graph(
        [
          { id: 'switch', kind: 'lever' },
          { id: 'fact', kind: 'receiver', receiver: 'fact', key: 'cellar.lit' },
          {
            id: 'light',
            kind: 'set-property',
            entity: 'lamp',
            on: { burning: true },
            off: { burning: false },
          },
          { id: 'mark', kind: 'set-property', entity: 'bare', on: { wetness: 0.5 } },
        ],
        [
          ['switch', 'fact'],
          ['switch', 'light'],
          ['switch', 'mark'],
        ],
      ),
      { bindings: { lamp, bare } },
    );
    const receipts: SignalReceipt[] = [];
    w.events.on(signalReceived, (r) => receipts.push(r));
    toggleLever(w, g, 'switch');
    w.step();
    expect(receipts.map((r) => [r.node, r.receiver, r.entity, r.key, r.value])).toEqual([
      ['fact', 'fact', null, 'cellar.lit', true],
      ['light', 'set-property', lamp, null, true],
      ['mark', 'set-property', bare, null, true],
    ]);
    expect(getProperty(w, lamp, 'burning')).toBe(true);
    expect(getProperty(w, bare, 'wetness')).toBe(0.5); // added: the entity had no wetness
    w.step(); // unchanged input: nothing reported or written
    expect(receipts).toHaveLength(3);
    toggleLever(w, g, 'switch');
    w.destroy(lamp);
    w.step();
    expect(receipts.slice(3).map((r) => [r.node, r.value])).toEqual([
      ['fact', false],
      ['light', false], // reported though its entity is gone (nothing to write)
      ['mark', false],
    ]);
    expect(getProperty(w, bare, 'wetness')).toBe(0.5); // no `off`: left as it is
  });

  it('a sensor watches its bound entity’s properties', () => {
    const w = world();
    const brazier = thing(w, { burning: false, flammable: true, charge: 0 });
    const g = addSignalGraph(
      w,
      graph([
        {
          id: 'lit',
          kind: 'sensor',
          entity: 'brazier',
          observed: true,
          filter: [
            { test: 'element', element: 'fire' },
            { test: 'property', property: 'charge', op: 'lt', value: 10 },
          ],
        },
      ]),
      { bindings: { brazier } },
    );
    w.step();
    expect(signalOutput(w, g, 'lit')).toBe(false);
    setProperty(w, brazier, 'burning', true);
    w.step();
    expect(signalOutput(w, g, 'lit')).toBe(true);
    w.destroy(brazier);
    w.step();
    expect(signalOutput(w, g, 'lit')).toBe(false);
  });
});

describe('determinism and state', () => {
  /** A graph using most kinds, driven by the same inputs. */
  function scenario() {
    const w = world();
    const g = place(
      w,
      graph(
        [
          { id: 'plate', kind: 'volume', shape: box, minWeight: 10 },
          { id: 'lever', kind: 'lever' },
          { id: 'both', kind: 'and' },
          { id: 'coin', kind: 'random', outcomes: ['left', 'right'] },
          { id: 'wait', kind: 'delay', seconds: 0.2 },
          door('door'),
          { id: 'left', kind: 'receiver', receiver: 'audio-cue', key: 'sfx-left' },
          { id: 'right', kind: 'receiver', receiver: 'spawner', entity: 'gate' },
        ],
        [
          ['plate', 'both'],
          ['lever', 'both'],
          ['both', 'wait'],
          ['wait', 'door'],
          ['plate.enter', 'coin'],
          ['coin.left', 'left'],
          ['coin.right', 'right'],
        ],
      ),
    );
    const seen = trace(w);
    const crates = [thing(w, { weight: 12 }), thing(w, { weight: 12 })] as const;
    for (let t = 0; t < 20; t++) {
      const crate = crates[t % 2 === 0 ? 0 : 1];
      placeEntity(w, crate, t % 3 === 0 ? O : FAR);
      if (t % 5 === 0) toggleLever(w, g, 'lever');
      w.step();
    }
    return { w, g, seen };
  }

  it('AC-6: the same graph and inputs emit identical signals in identical order', () => {
    const one = scenario();
    const two = scenario();
    expect(one.seen.length).toBeGreaterThan(10);
    expect(two.seen).toEqual(one.seen);
    expect(hashWorld(two.w)).toBe(hashWorld(one.w));
  });

  it('round-trips through a snapshot and carries on identically', () => {
    const { w } = scenario();
    const copy = world();
    copy.restore(w.snapshot());
    expect(hashWorld(copy)).toBe(hashWorld(w));
    const a = trace(w);
    const b = trace(copy);
    for (let t = 0; t < 5; t++) {
      w.step();
      copy.step();
    }
    expect(b).toEqual(a);
    expect(hashWorld(copy)).toBe(hashWorld(w));
  });

  it('rejects invalid saved graphs', () => {
    const { w } = scenario();
    const snap = w.snapshot();
    const [[id, value]] = snap.components['signal.graph'] as [[number, Record<string, unknown>]];
    const restore = (patch: Record<string, unknown> | null) => () => {
      world().restore({
        ...snap,
        components: {
          ...snap.components,
          'signal.graph': [[id, patch === null ? null : { ...value, ...patch }]],
        },
      });
    };
    expect(restore(null)).toThrow(/must have a graph/);
    expect(restore({ graph: 3 })).toThrow(/must have a graph/);
    expect(restore({ graph: { id: 'x', nodes: [{ id: 'n', kind: 'nope' }], wires: [] } })).toThrow(
      /unknown node kind/,
    );
    expect(restore({ nodes: {} })).toThrow(/missing node state/);
    expect(restore({ nodes: null })).toThrow(/missing node state/);
    expect(restore({ nodes: { ...(value['nodes'] as object), plate: null } })).toThrow(
      /missing node state/,
    );
    expect(restore({ outputs: null })).toThrow(/missing node state/);
    expect(restore({ outputs: 1 })).toThrow(/missing node state/);
    expect(restore({ bindings: null })).toThrow(/needs an entity id for binding\(s\): gate/);
    expect(restore({ bindings: { gate: 0 } })).toThrow(/needs an entity id/);
    expect(restore({ bindings: { gate: 1, extra: 2 } })).toThrow(/has no node bound to: extra/);
  });

  it('places graphs as plain copies and checks bindings', () => {
    const w = world();
    const def = { ...graph([door()], []), name: 'Dropped', notes: 'Not graph data.' };
    expect(() => addSignalGraph(w, def)).toThrow(/needs 1 wire/);
    const wired = {
      ...graph([{ id: 'l', kind: 'lever' }, door()], [['l', 'door']]),
      name: 'Dropped',
    };
    expect(() => addSignalGraph(w, wired)).toThrow(/needs an entity id for binding\(s\): gate/);
    expect(() => addSignalGraph(w, wired, { bindings: { gate: 1, gait: 2 } })).toThrow(
      /no node bound to: gait/,
    );
    const g = addSignalGraph(w, wired, { bindings: { gate: 1 } });
    expect(signalGraphOf(w, g).graph).toEqual({ id: 'g', nodes: wired.nodes, wires: wired.wires });
    expect(signalGraphOf(w, g).graph).not.toHaveProperty('name');
  });

  it('rejects inputs and reads on the wrong nodes', () => {
    const w = world();
    const g = place(w, graph([{ id: 'l', kind: 'lever' }, door()], [['l', 'door']]));
    expect(() => signalGraphOf(w, w.spawn())).toThrow(/holds no signal graph/);
    expect(() => setLever(w, g, 'nope', true)).toThrow(/has no node "nope"/);
    expect(() => {
      pressButton(w, g, 'l');
    }).toThrow(/"l" is a lever, not a button/);
    expect(() => volumeOccupants(w, g, 'l')).toThrow(/not a volume/);
    expect(() => toggleLever(w, g, 'door')).toThrow(/not a lever/);
    expect(() => signalOutput(w, g, 'l', 'up')).toThrow(/no output port "up"/);
    expect(() => signalOutput(w, g, 'door')).toThrow(/no output port ""/);
    expect(signalOutput(w, g, 'l')).toBe(false); // nothing evaluated yet
  });

  it('evaluates outside a step too, and the system is named', () => {
    const w = world();
    const g = place(w, graph([{ id: 'l', kind: 'lever', initial: true, observed: true }]));
    evaluateSignalGraphs(w);
    expect(signalOutput(w, g, 'l')).toBe(true);
    expect(signalSystem().name).toBe('signals');
  });
});
