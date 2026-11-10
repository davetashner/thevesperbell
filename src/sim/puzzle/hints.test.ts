import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addCapabilities, CapabilityRegistry } from '../progression/capabilities';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { registerSceneComponents, spawnSceneSpawn } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { addSignalGraph, installSignals, setLever, signalSystem } from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import { puzzleHint, puzzleStateChanged, type PuzzleHint } from './events';
import {
  PuzzleRuntime,
  puzzleSystem,
  PuzzleStateComponent,
  type HintTierDef,
  type PuzzleDef,
  type PuzzleRecord,
} from './runtime';

const HZ = 10;
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const room = {
  kind: 'box',
  center: { x: 0, y: 0, z: 0 },
  halfExtents: { x: 2, y: 2, z: 2 },
} as const;

const graphDef: SignalGraphDef = {
  id: 'bells',
  nodes: [{ id: 'wrong', kind: 'lever', observed: true } as never],
  wires: [],
};

const ladder: readonly HintTierDef[] = [
  {
    afterSeconds: 180,
    afterAttempts: 3,
    bark: 'Something here must burn.',
    variants: [
      { capability: 'spell.frost', bark: 'Cold would hold that water.' },
      { capability: 'spell.ember', bark: 'A spark would do it.' },
    ],
    highlight: ['west', 'ghost'],
  },
  { afterSeconds: 360, bark: 'Look at the west one.', variants: [], highlight: [] },
  {
    afterSeconds: 600,
    variants: [],
    highlight: [],
    rumour: 'hall.rumour',
  },
];

const def = (hints: readonly HintTierDef[] = ladder): PuzzleDef => ({
  id: 'braziers',
  goal: {
    entities: { tag: 'brazier' },
    where: [{ test: 'element', element: 'fire' }],
    match: 'all',
  },
  entities: [{ id: 'west', critical: false }],
  solutions: [{ id: 'torch', capabilities: [] }],
  discovery: { volume: room },
  outputs: { solvedFact: 'hall.solved', set: [], signals: [], rewards: [] },
  hints,
  failures: [{ signal: 'bells/wrong' }],
});

function setup(
  options: {
    difficulty?: { puzzleHints: number };
    hints?: readonly HintTierDef[];
    away?: boolean;
    repeatable?: boolean;
    anonymous?: boolean;
  } = {},
) {
  const world = installSignals(
    installStimuli(
      registerWorldProperties(
        new World<never>({
          seed: 3,
          hz: HZ,
          ...(options.difficulty !== undefined && { difficulty: options.difficulty }),
        }),
      ),
    ),
  );
  registerSceneComponents(world);
  world.facts.declare('hall.solved', { type: 'bool', default: false });
  world.facts.declare('hall.rumour', { type: 'bool', default: false });
  world.addSystem(signalSystem());
  const player = world.spawn();
  addCapabilities(world, player);
  placeEntity(world, player, { x: options.away === true ? 50 : 1, y: 0, z: 0 });
  const west: EntityId = spawnSceneSpawn(world, 'hall', {
    id: 'west',
    tags: ['brazier'],
    position: { x: 0, y: 0, z: 0 },
    rotation,
  } as never);
  addProperties(world, west, { burning: false });
  const graph = addSignalGraph(world, graphDef, {});
  const runtime = new PuzzleRuntime(
    world,
    [{ ...def(options.hints), repeatable: options.repeatable === true }],
    { player: options.anonymous === true ? undefined : player },
  );
  world.addSystem(puzzleSystem(runtime));
  const hints: PuzzleHint[] = [];
  world.events.on(puzzleHint, (hint) => hints.push(hint));
  return { world, runtime, player, west, graph, hints };
}

const steps = (world: World<never>, n: number) => {
  for (let i = 0; i < n; i++) world.step();
};
const seconds = (world: World<never>, s: number) => {
  steps(world, s * HZ);
};

describe('puzzle hint ladder (mw-e15.11)', () => {
  it('AC-1: tier 1 fires once when the puzzle has been in progress for 3 minutes, and not again', () => {
    const { world, hints } = setup();
    seconds(world, 179);
    expect(hints).toEqual([]);
    seconds(world, 2);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      puzzle: 'braziers',
      tier: 0,
      bark: 'Something here must burn.',
      highlight: ['west', 'ghost'],
    });
    expect(hints[0]?.entities).toHaveLength(1);
    expect(hints[0]?.variant).toBeUndefined();
    seconds(world, 60);
    expect(hints.filter((hint) => hint.tier === 0)).toHaveLength(1);
  });

  it('later tiers fire in order on their times; the last sets its rumour fact', () => {
    const { world, hints } = setup();
    seconds(world, 359);
    expect(hints.map((h) => h.tier)).toEqual([0]);
    seconds(world, 2);
    expect(hints.map((h) => h.tier)).toEqual([0, 1]);
    expect(world.facts.get('hall.rumour')).toBe(false);
    seconds(world, 241);
    expect(hints.map((h) => h.tier)).toEqual([0, 1, 2]);
    expect(hints[2]).toMatchObject({ rumour: 'hall.rumour', bark: undefined });
    expect(world.facts.get('hall.rumour')).toBe(true);
    seconds(world, 600);
    expect(hints).toHaveLength(3);
  });

  it('AC-2: a sorcerer with the frost spell gets the frost-relevant text', () => {
    const { world, player, hints } = setup();
    const registry = new CapabilityRegistry(['spell.frost', 'spell.ember']);
    registry.grant(world, player, 'spell.frost', 'class');
    registry.grant(world, player, 'spell.ember', 'class');
    seconds(world, 181);
    expect(hints[0]).toMatchObject({
      bark: 'Cold would hold that water.',
      variant: 'spell.frost',
    });
  });

  it('a runtime with no player picks the tier text, not a variant', () => {
    const { world, west, hints } = setup({ anonymous: true });
    setProperty(world, west, 'burning', true);
    setProperty(world, west, 'burning', false);
    seconds(world, 181);
    expect(hints[0]).toMatchObject({ tier: 0, bark: 'Something here must burn.' });
    expect(hints[0]?.variant).toBeUndefined();
  });

  it('a capability the first variant does not need picks the next one that fits', () => {
    const { world, player, hints } = setup();
    new CapabilityRegistry(['spell.ember']).grant(world, player, 'spell.ember', 'class');
    seconds(world, 181);
    expect(hints[0]).toMatchObject({ bark: 'A spark would do it.', variant: 'spell.ember' });
  });

  it('AC-3: with hints disabled no tier fires when the thresholds pass', () => {
    const { world, hints, runtime } = setup({ difficulty: { puzzleHints: 0 } });
    seconds(world, 700);
    expect(hints).toEqual([]);
    expect(world.facts.get('hall.rumour')).toBe(false);
    expect(runtime.record('braziers').hints).toBeUndefined();
  });

  it('AC-4: a puzzle solved at 2:59 fires no hint as time passes', () => {
    const { world, west, hints, runtime } = setup();
    seconds(world, 179);
    setProperty(world, west, 'burning', true);
    world.step();
    expect(runtime.state('braziers')).toBe('solved');
    seconds(world, 700);
    expect(hints).toEqual([]);
  });

  it('three failed attempts fire tier 1 before its time; edges count, a standing pulse does not', () => {
    const { world, graph, hints, runtime } = setup();
    seconds(world, 5);
    for (let attempt = 1; attempt <= 3; attempt++) {
      setLever(world, graph, 'wrong', true);
      world.step();
      world.step();
      if (attempt < 3) {
        expect(hints).toEqual([]);
        setLever(world, graph, 'wrong', false);
        world.step();
      }
    }
    expect(hints.map((h) => h.tier)).toEqual([0]);
    expect(runtime.record('braziers').hints).toEqual({ fired: 1, attempts: 3 });
  });

  it('attempts count only while the puzzle is in play, and a signal already on when it is found is not one', () => {
    const { world, graph, player, runtime } = setup({ away: true });
    setLever(world, graph, 'wrong', true);
    seconds(world, 2);
    placeEntity(world, player, { x: 1, y: 0, z: 0 });
    seconds(world, 2);
    expect(runtime.state('braziers')).toBe('discovered');
    expect(runtime.record('braziers').hints).toBeUndefined();
  });

  it('shifts the times with the difficulty multiplier: 2 offers hints twice as soon', () => {
    const { world, hints } = setup({ difficulty: { puzzleHints: 2 } });
    seconds(world, 89);
    expect(hints).toEqual([]);
    seconds(world, 2);
    expect(hints.map((h) => h.tier)).toEqual([0]);
  });

  it('keeps the ladder through a save and load, and counts time from when the puzzle was found', () => {
    const a = setup();
    seconds(a.world, 200);
    expect(a.hints).toHaveLength(1);
    const saved = JSON.stringify(a.world.snapshot());
    const b = setup();
    b.world.register(PuzzleStateComponent);
    b.world.restore(JSON.parse(saved) as ReturnType<World<never>['snapshot']>);
    seconds(b.world, 100);
    expect(b.hints).toEqual([]);
    seconds(b.world, 70);
    expect(b.hints.map((h) => h.tier)).toEqual([1]);
    expect(b.runtime.record('braziers').hints).toEqual({ fired: 2, attempts: 0 });
  });

  it('a puzzle with no ladder, and a world with no puzzle touched, keep their records as they were', () => {
    const none = setup({ hints: [] });
    seconds(none.world, 700);
    expect(none.hints).toEqual([]);
    expect(none.runtime.record('braziers')).not.toHaveProperty('hints');
    const quiet = setup();
    placeEntity(quiet.world, quiet.player, { x: 50, y: 0, z: 0 });
    expect(quiet.runtime.record('braziers')).not.toHaveProperty('hints');
  });

  it('a repeatable puzzle that reopens starts its ladder again', () => {
    const a = setup({ repeatable: true });
    const { world, runtime, hints } = a;
    const states: string[] = [];
    world.events.on(puzzleStateChanged, ({ to }) => states.push(to));
    seconds(world, 181);
    setProperty(world, a.west, 'burning', true);
    world.step();
    setProperty(world, a.west, 'burning', false);
    world.step();
    world.step();
    expect(states).toContain('solved');
    expect(runtime.state('braziers')).toBe('in-progress');
    const record: PuzzleRecord = runtime.record('braziers');
    expect(record).not.toHaveProperty('hints');
    hints.length = 0;
    seconds(world, 179);
    expect(hints).toEqual([]);
    seconds(world, 2);
    expect(hints.map((h) => h.tier)).toEqual([0]);
  });
});
