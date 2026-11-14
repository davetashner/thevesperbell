import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { interacted } from '../interaction/system';
import { SpellCast } from '../magic/events';
import { addProperties, registerWorldProperties, setProperty } from '../properties/components';
import { registerSceneComponents, spawnSceneSpawn } from '../scene/loader';
import type { SignalGraphDef } from '../signals/graph';
import { addSignalGraph, installSignals, signalOutput, signalSystem } from '../signals/runtime';
import { placeEntity } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import {
  capabilityUsed,
  clueRead,
  readClue,
  puzzleDiscovered,
  puzzleFailed,
  puzzleRewarded,
  puzzleSolved,
  puzzleSolvedUndeclared,
  puzzleStateChanged,
  puzzleUnsolved,
} from './events';
import {
  attribute,
  ENGAGE_WINDOW_SECONDS,
  PuzzleRuntime,
  PuzzleStateComponent,
  puzzleSystem,
  TRAIL_LIMIT,
  type PuzzleDef,
} from './runtime';

/** Save and load through plain JSON, as a save file's bytes do. */
const WorldSnapshotCodec = {
  save: (world: World<never>): string => JSON.stringify(world.snapshot()),
  load: (world: World<never>, saved: string): void => {
    world.restore(JSON.parse(saved) as ReturnType<World<never>['snapshot']>);
  },
};

const HZ = 10;
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const room = {
  kind: 'box',
  center: { x: 0, y: 0, z: 0 },
  halfExtents: { x: 2, y: 2, z: 2 },
} as const;

const vault: SignalGraphDef = {
  id: 'hall',
  nodes: [
    { id: 'open', kind: 'lever' },
    { id: 'ring', kind: 'button' },
    { id: 'gate', kind: 'receiver', receiver: 'door', entity: 'gate' },
    { id: 'bell', kind: 'receiver', receiver: 'audio-cue', key: 'bell' },
  ],
  wires: [
    { from: 'open', to: 'gate' },
    { from: 'ring', to: 'bell' },
  ],
};

const braziers: PuzzleDef = {
  id: 'braziers',
  goal: {
    entities: { tag: 'brazier' },
    where: [{ test: 'element', element: 'fire' }],
    match: 'all',
  },
  entities: [
    { id: 'west', critical: true },
    { id: 'east', critical: false },
  ],
  solutions: [
    { id: 'torch', capabilities: [] },
    { id: 'ember', capabilities: ['spell.ember'] },
    { id: 'ember-and-hand', capabilities: ['spell.ember', 'spell.mage-hand'] },
  ],
  discovery: { volume: room },
  outputs: {
    solvedFact: 'hall.solved',
    set: [{ fact: 'hall.open', value: true }],
    signals: [],
    rewards: ['hall-reward'],
  },
};

function setup(def: PuzzleDef = braziers, options: { graph?: boolean } = {}) {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3, hz: HZ }))),
  );
  registerSceneComponents(world);
  world.facts.declare('hall.solved', { type: 'bool', default: false });
  world.facts.declare('hall.open', { type: 'bool', default: false });
  world.addSystem(signalSystem());
  const player = world.spawn();
  placeEntity(world, player, { x: 50, y: 0, z: 0 });
  const spawn = (id: string, tags: string[] = ['brazier']): EntityId => {
    const entity = spawnSceneSpawn(world, 'hall', {
      id,
      tags,
      position: { x: 0, y: 0, z: 0 },
      rotation,
    } as never);
    addProperties(world, entity, { burning: false });
    return entity;
  };
  const west = spawn('west');
  const east = spawn('east');
  const graph =
    options.graph === true
      ? addSignalGraph(world, vault, { bindings: { gate: world.spawn() } })
      : undefined;
  const runtime = new PuzzleRuntime(world, [def], { player });
  world.addSystem(puzzleSystem(runtime));
  const log: string[] = [];
  const record = <T extends { puzzle: string }>(
    type: Parameters<typeof world.events.on<T>>[0],
    name: string,
  ) => world.events.on(type, (e) => log.push(`${name}:${JSON.stringify(e)}`));
  return { world, runtime, player, west, east, graph, spawn, log, record };
}

const steps = (world: World<never>, n: number) => {
  for (let i = 0; i < n; i++) world.step();
};

describe('puzzle lifecycle (mw-e15.3)', () => {
  it('AC-1: a dormant puzzle becomes discovered, once, when the player enters its volume', () => {
    const { world, runtime, player } = setup();
    const found: unknown[] = [];
    world.events.on(puzzleDiscovered, (e) => found.push(e));
    expect(runtime.state('braziers')).toBe('dormant');
    steps(world, 3);
    expect(runtime.state('braziers')).toBe('dormant');
    expect(found).toEqual([]);
    placeEntity(world, player, { x: 1, y: 0, z: 0 });
    steps(world, 1);
    expect(runtime.state('braziers')).toBe('discovered');
    expect(found).toEqual([{ puzzle: 'braziers', tick: 3 }]);
    placeEntity(world, player, { x: 50, y: 0, z: 0 });
    placeEntity(world, player, { x: 0, y: 0, z: 0 });
    steps(world, 3);
    expect(found).toHaveLength(1); // leaving and returning is not a second discovery
    expect(runtime.record('braziers').discoveredAt).toBe(3);
  });

  it('is discovered by using its trigger entity, and by the first thing done to a listed entity', () => {
    const interact: PuzzleDef = {
      ...braziers,
      discovery: { interact: 'lever' },
    };
    const a = setup(interact);
    const lever = a.spawn('lever', ['pull']);
    a.world.events.emit(interacted, {
      actor: a.player,
      target: lever,
      verb: 'pull',
      affordance: 0,
    });
    steps(a.world, 1);
    expect(a.runtime.state('braziers')).toBe('discovered');

    // No discovery rule: the first touch discovers it and puts it under way at once.
    const b = setup({ ...braziers, discovery: undefined });
    steps(b.world, 2);
    expect(b.runtime.state('braziers')).toBe('dormant');
    const changes: string[] = [];
    b.world.events.on(puzzleStateChanged, (e) => changes.push(`${e.from}>${e.to}`));
    setProperty(b.world, b.west, 'burning', true);
    steps(b.world, 1);
    expect(b.runtime.state('braziers')).toBe('in-progress');
    expect(changes).toEqual(['dormant>in-progress']);

    // Using a listed entity (not the trigger) is a touch too.
    const c = setup({ ...braziers, discovery: { interact: 'lever' } });
    c.world.events.emit(interacted, {
      actor: c.player,
      target: c.east,
      verb: 'pull',
      affordance: 0,
    });
    steps(c.world, 1);
    expect(c.runtime.state('braziers')).toBe('in-progress');

    // A property the goal does not read is not a touch.
    const d = setup();
    const stranger = d.world.spawn();
    addProperties(d.world, stranger, { burning: false });
    setProperty(d.world, stranger, 'burning', true); // not one the puzzle lists
    steps(d.world, 1);
    expect(d.runtime.state('braziers')).toBe('dormant');
    // An interaction with something that is no scene spawn is no touch either.
    d.world.events.emit(interacted, {
      actor: d.player,
      target: stranger,
      verb: 'pull',
      affordance: 0,
    });
    steps(d.world, 1);
    expect(d.runtime.state('braziers')).toBe('dormant');
    addProperties(d.world, d.west, { burning: false, wetness: 0 });
    setProperty(d.world, d.west, 'wetness', 0.3);
    steps(d.world, 1);
    expect(d.runtime.state('braziers')).toBe('dormant');
  });

  it('AC-2: an in-progress puzzle whose goal comes true is solved, emitting and setting its outputs once', () => {
    const def: PuzzleDef = {
      ...braziers,
      outputs: { ...braziers.outputs, signals: ['hall/open', 'hall/ring'] },
    };
    const { world, runtime, west, east, graph, player, log, record } = setup(def, { graph: true });
    record(puzzleSolved, 'solved');
    record(puzzleRewarded, 'reward');
    placeEntity(world, player, { x: 1, y: 0, z: 0 });
    steps(world, 1);
    setProperty(world, west, 'burning', true);
    steps(world, 1);
    expect(runtime.state('braziers')).toBe('in-progress');
    expect(world.facts.get('hall.solved')).toBe(false);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    expect(world.facts.get('hall.solved')).toBe(true);
    expect(world.facts.get('hall.open')).toBe(true);
    // The lever is on and the graph has seen it; the button pulsed once.
    expect(signalOutput(world, graph ?? 0, 'open')).toBe(true);
    expect(log.filter((l) => l.startsWith('solved:'))).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('reward:'))).toEqual([
      expect.stringContaining('"reward":"hall-reward"'),
    ]);
    steps(world, 5);
    expect(log.filter((l) => l.startsWith('solved:'))).toHaveLength(1);
    expect(runtime.record('braziers').solvedAt).not.toBeNull();
  });

  it('solves from any state when the goal is true, even one nobody discovered', () => {
    const { world, runtime, west, east } = setup();
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
  });

  it('a goal that is already true when the runtime starts solves the puzzle at once', () => {
    const world = installSignals(registerWorldProperties(new World<never>({ seed: 1, hz: HZ })));
    registerSceneComponents(world);
    world.facts.declare('hall.solved', { type: 'bool', default: false });
    world.facts.declare('hall.open', { type: 'bool', default: false });
    const lamp = world.spawn();
    addProperties(world, lamp, { burning: true });
    spawnSceneSpawn(world, 'hall', {
      id: 'west',
      tags: ['brazier'],
      position: { x: 0, y: 0, z: 0 },
      rotation,
    } as never);
    const burning = world.spawn();
    addProperties(world, burning, { burning: true });
    const runtime = new PuzzleRuntime(world, [
      { ...braziers, goal: { fact: 'hall.open', eq: false } },
    ]);
    expect(runtime.state('braziers')).toBe('solved');
  });

  it('AC-3: a solved one-shot puzzle stays solved and fires nothing when the goal later fails', () => {
    const { world, runtime, west, east, log, record } = setup();
    record(puzzleSolved, 'solved');
    record(puzzleRewarded, 'reward');
    record(puzzleUnsolved, 'unsolved');
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    const fired = log.length;
    setProperty(world, west, 'burning', false); // the brazier is put out
    steps(world, 3);
    expect(runtime.state('braziers')).toBe('solved');
    expect(world.facts.get('hall.solved')).toBe(true);
    setProperty(world, west, 'burning', true); // and lit again: nothing fires twice
    steps(world, 3);
    expect(log).toHaveLength(fired);
  });

  it('a repeatable puzzle reopens when its goal fails, switches its levers back and fires rewards once', () => {
    const def: PuzzleDef = {
      ...braziers,
      repeatable: true,
      outputs: { ...braziers.outputs, signals: ['hall/open'] },
    };
    const { world, runtime, west, east, graph, log, record } = setup(def, { graph: true });
    record(puzzleRewarded, 'reward');
    record(puzzleUnsolved, 'unsolved');
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(signalOutput(world, graph ?? 0, 'open')).toBe(true);
    setProperty(world, east, 'burning', false);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('in-progress');
    expect(world.facts.get('hall.solved')).toBe(false);
    expect(signalOutput(world, graph ?? 0, 'open')).toBe(false);
    expect(runtime.record('braziers')).toMatchObject({ attribution: null, solvedAt: null });
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    expect(log.filter((l) => l.startsWith('reward:'))).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('unsolved:'))).toHaveLength(1);
  });

  it('ignores a signal output that names no graph in the world, or a node that is neither lever nor button', () => {
    const def: PuzzleDef = {
      ...braziers,
      outputs: { ...braziers.outputs, signals: ['nowhere/open', 'hall/gate', 'hall/missing'] },
    };
    const { world, runtime, west, east } = setup(def, { graph: true });
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    // With no signal graphs registered at all, the same outputs are skipped too.
    const bare = new World<never>({ seed: 1, hz: HZ });
    registerWorldProperties(bare);
    registerSceneComponents(bare);
    bare.facts.declare('hall.solved', { type: 'bool' });
    bare.facts.declare('hall.open', { type: 'bool' });
    const lone = new PuzzleRuntime(bare, [{ ...def, goal: { fact: 'hall.open' } }]);
    bare.facts.set('hall.open', true);
    bare.step();
    lone.poll();
    expect(lone.state('braziers')).toBe('solved');
  });
});

describe('attribution from the capability trail (mw-e15.3)', () => {
  it('credits the most demanding declared solution whose capabilities were all used', () => {
    const used = (...c: string[]) => new Set(c);
    expect(attribute(braziers.solutions, used())).toBe('torch');
    expect(attribute(braziers.solutions, used('spell.ember'))).toBe('ember');
    expect(attribute(braziers.solutions, used('spell.mage-hand', 'spell.ember'))).toBe(
      'ember-and-hand',
    );
    expect(attribute(braziers.solutions, used('spell.mage-hand'))).toBe('torch');
    const needy = [
      { id: 'a', capabilities: ['x'] },
      { id: 'b', capabilities: ['y'] },
    ];
    expect(attribute(needy, used('y', 'x'))).toBe('a'); // a tie: the first declared
    expect(attribute(needy, used('z'))).toBe('undeclared');
  });

  it('AC-4: a goal reached with capabilities no declared solution uses is attributed undeclared, with an event', () => {
    const def: PuzzleDef = {
      ...braziers,
      solutions: [
        { id: 'ember', capabilities: ['spell.ember'] },
        { id: 'firebolt', capabilities: ['spell.firebolt'] },
      ],
    };
    const { world, runtime, west, east, player, log, record } = setup(def);
    record(puzzleSolved, 'solved');
    record(puzzleSolvedUndeclared, 'undeclared');
    placeEntity(world, player, { x: 1, y: 0, z: 0 });
    steps(world, 1);
    world.events.emit(capabilityUsed, {
      actor: player,
      capability: 'spell.mage-hand',
      tick: world.tick,
    });
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    expect(runtime.record('braziers').attribution).toBe('undeclared');
    expect(log.filter((l) => l.startsWith('undeclared:'))).toEqual([
      expect.stringContaining('"trail":["spell.mage-hand"]'),
    ]);
    expect(log.filter((l) => l.startsWith('solved:'))).toHaveLength(1);
  });

  it('records spell casts by the player as capabilities, and ignores other actors', () => {
    const { world, runtime, west, east, player } = setup();
    const other = world.spawn();
    const cast = (caster: EntityId, spell: string) => {
      world.events.emit(SpellCast, {
        tick: world.tick,
        caster,
        spell,
        source: 'known',
        delivery: caster,
        deliveryKind: 'projectile',
      });
    };
    placeEntity(world, player, { x: 1, y: 0, z: 0 });
    steps(world, 1);
    cast(other, 'mage-hand');
    cast(player, 'ember');
    steps(world, 1);
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.record('braziers').attribution).toBe('ember');
    expect(runtime.status()[0]?.trail).toEqual(['spell.ember']);
  });

  it('counts uses from before the first touch only within the engage window, and keeps a bounded trail', () => {
    const { world, runtime, west, player } = setup(braziers);
    const use = (capability: string) => {
      world.events.emit(capabilityUsed, { actor: player, capability, tick: world.tick });
    };
    use('spell.mage-hand'); // long before the puzzle is touched
    steps(world, ENGAGE_WINDOW_SECONDS * HZ + 5);
    use('spell.ember');
    steps(world, 1);
    setProperty(world, west, 'burning', true);
    steps(world, 1);
    expect(runtime.record('braziers').trail.map((u) => u.capability)).toEqual(['spell.ember']);
    for (let i = 0; i < TRAIL_LIMIT + 5; i++) use(`spell.s${String(i)}`);
    steps(world, 1);
    expect(runtime.record('braziers').trail).toHaveLength(TRAIL_LIMIT);
    // A use aimed at a listed entity is a touch.
    const { world: w2, runtime: r2, player: p2, east } = setup(braziers);
    w2.events.emit(capabilityUsed, {
      actor: p2,
      capability: 'spell.mage-hand',
      target: east,
      tick: 0,
    });
    steps(w2, 1);
    expect(r2.state('braziers')).toBe('in-progress');
    // Once solved the trail is closed.
    const { world: w3, runtime: r3, west: a3, east: b3, player: p3 } = setup(braziers);
    setProperty(w3, a3, 'burning', true);
    setProperty(w3, b3, 'burning', true);
    steps(w3, 2);
    w3.events.emit(capabilityUsed, { actor: p3, capability: 'spell.ember', tick: w3.tick });
    steps(w3, 1);
    expect(r3.record('braziers').trail).toEqual([]);
  });
});

describe('readable clues (mw-e15.5)', () => {
  it('reading a clue adds clue.<item> to its puzzle’s trail only, at any time before the first touch', () => {
    const { world, runtime, west, east, player } = setup({
      ...braziers,
      solutions: [{ id: 'torch', capabilities: [] }],
    });
    readClue(world, player, 'bell-notes', ['braziers']);
    steps(world, ENGAGE_WINDOW_SECONDS * HZ + 5); // long before the puzzle is touched
    expect(runtime.state('braziers')).toBe('dormant');
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    expect(runtime.status()[0]?.trail).toEqual(['clue.bell-notes']);
  });

  it('a clue for another puzzle, from another actor, or after the solve adds nothing', () => {
    const { world, runtime, player, west, east } = setup();
    const stranger = world.spawn();
    readClue(world, stranger, 'bell-notes', ['braziers']);
    readClue(world, player, 'bell-notes', ['somewhere-else']);
    steps(world, 1);
    expect(runtime.record('braziers').trail).toEqual([]);
    setProperty(world, west, 'burning', true);
    setProperty(world, east, 'burning', true);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('solved');
    readClue(world, player, 'late-notes', ['braziers']);
    steps(world, 1);
    expect(runtime.record('braziers').trail).toEqual([]);
  });

  it('readClue announces one event per bound puzzle, and none for an unbound readable', () => {
    const { world, player } = setup();
    const seen: string[] = [];
    world.events.on(clueRead, (e) => seen.push(`${e.puzzle}:${e.item}:${String(e.tick)}`));
    readClue(world, player, 'bell-notes', ['a', 'b']);
    readClue(world, player, 'plain-book', []);
    steps(world, 1);
    expect(seen).toEqual(['a:bell-notes:0', 'b:bell-notes:0']);
  });
});

describe('losing a critical entity (mw-e15.3)', () => {
  it('fails an engaged puzzle when a critical entity is destroyed, and revives it when it returns', () => {
    const { world, runtime, west, spawn, log, record } = setup();
    record(puzzleFailed, 'failed');
    setProperty(world, west, 'burning', true);
    steps(world, 1);
    expect(runtime.state('braziers')).toBe('in-progress');
    world.destroy(west);
    steps(world, 1);
    expect(runtime.state('braziers')).toBe('failed');
    expect(log).toEqual([expect.stringContaining('"lost":["west"]')]);
    expect(runtime.record('braziers').lost).toEqual(['west']);
    spawn('west'); // a recovery policy puts a new one where it spawned
    steps(world, 1);
    expect(runtime.state('braziers')).toBe('in-progress');
  });

  it('does not fail a puzzle nobody has touched, nor one for a non-critical entity, but fails it once touched', () => {
    const { world, runtime, west, east } = setup();
    world.destroy(west);
    world.destroy(east);
    steps(world, 2);
    expect(runtime.state('braziers')).toBe('dormant');
    expect(runtime.record('braziers').lost).toEqual(['west']);
    const lost = setup();
    lost.spawn('unlisted'); // a third brazier the puzzle does not list, so one lit is not the goal
    lost.world.destroy(lost.east);
    steps(lost.world, 1);
    setProperty(lost.world, lost.west, 'burning', true);
    steps(lost.world, 1);
    expect(lost.runtime.state('braziers')).toBe('in-progress');
    // Touched after the loss: the loss counts.
    const late = setup();
    late.world.destroy(late.west);
    steps(late.world, 1);
    late.world.events.emit(interacted, {
      actor: late.player,
      target: late.east,
      verb: 'pull',
      affordance: 0,
    });
    steps(late.world, 1);
    expect(late.runtime.state('braziers')).toBe('failed');
  });
});

describe('puzzle state survives save and load (mw-e15.3)', () => {
  const sustained: PuzzleDef = {
    ...braziers,
    goal: {
      sustained: {
        entities: { tag: 'brazier' },
        where: [{ test: 'element', element: 'fire' }],
        match: 'all',
      },
      seconds: 3,
    },
  };

  it('AC-5: a solved puzzle reloads solved, and neither facts nor rewards fire again', () => {
    const a = setup(braziers, { graph: true });
    placeEntity(a.world, a.player, { x: 1, y: 0, z: 0 });
    setProperty(a.world, a.west, 'burning', true);
    setProperty(a.world, a.east, 'burning', true);
    steps(a.world, 3);
    expect(a.runtime.state('braziers')).toBe('solved');
    const saved = WorldSnapshotCodec.save(a.world);
    // A fresh world of the same scene: nothing solved, the component not even registered.
    const b = setup(braziers, { graph: true });
    expect(b.runtime.state('braziers')).toBe('dormant');
    expect(b.world.isRegistered(PuzzleStateComponent)).toBe(false);
    b.world.register(PuzzleStateComponent);
    b.record(puzzleSolved, 'solved');
    b.record(puzzleRewarded, 'reward');
    b.record(puzzleStateChanged, 'changed');
    WorldSnapshotCodec.load(b.world, saved);
    expect(b.runtime.state('braziers')).toBe('solved');
    expect(b.runtime.record('braziers')).toMatchObject({ attribution: 'torch', rewarded: true });
    steps(b.world, 5);
    expect(b.runtime.state('braziers')).toBe('solved');
    expect(b.world.facts.get('hall.open')).toBe(true);
    expect(b.log).toEqual([]);
  });

  it('a puzzle that never left dormant leaves no entity, so the world hashes as without puzzles', () => {
    const a = setup();
    const bare = new World<never>({ seed: 3, hz: HZ });
    expect(a.world.isRegistered(PuzzleStateComponent)).toBe(false);
    steps(a.world, 5);
    expect(a.world.snapshot().components).not.toHaveProperty('puzzle.state');
    expect(bare.snapshot().components).not.toHaveProperty('puzzle.state');
  });

  it('keeps a half-done sustained hold across save and load, and finishes it on schedule', () => {
    const a = setup(sustained);
    setProperty(a.world, a.west, 'burning', true);
    setProperty(a.world, a.east, 'burning', true);
    steps(a.world, 20); // 2 s of 3
    expect(a.runtime.state('braziers')).toBe('in-progress');
    const record = a.runtime.record('braziers');
    expect(record.holds).toEqual([expect.any(Number)]);
    const saved = WorldSnapshotCodec.save(a.world);
    const b = setup(sustained);
    b.world.register(PuzzleStateComponent);
    WorldSnapshotCodec.load(b.world, saved);
    expect(b.runtime.state('braziers')).toBe('in-progress');
    steps(b.world, 5);
    expect(b.runtime.state('braziers')).toBe('in-progress'); // 2.5 s: not yet
    steps(b.world, 6);
    expect(b.runtime.state('braziers')).toBe('solved'); // 3.1 s in all, not 5 s: the hold resumed
  });

  it('restoring a snapshot from before the puzzle was touched puts it back to dormant', () => {
    const a = setup();
    const before = WorldSnapshotCodec.save(a.world);
    setProperty(a.world, a.west, 'burning', true);
    steps(a.world, 1);
    expect(a.runtime.state('braziers')).toBe('in-progress');
    WorldSnapshotCodec.load(a.world, before);
    expect(a.runtime.state('braziers')).toBe('dormant');
    expect(a.runtime.status()[0]).toMatchObject({ state: 'dormant', attribution: null });
  });

  it('keeps a failed puzzle failed and ignores records of puzzles it does not run', () => {
    const a = setup();
    setProperty(a.world, a.west, 'burning', true);
    steps(a.world, 1);
    a.world.destroy(a.west);
    steps(a.world, 1);
    expect(a.runtime.state('braziers')).toBe('failed');
    const other = a.world.spawn();
    a.world.add(other, PuzzleStateComponent, {
      id: 'elsewhere',
      state: 'solved',
      attribution: null,
      trail: [],
      rewarded: true,
      lost: [],
      discoveredAt: null,
      solvedAt: null,
      holds: [],
    });
    const saved = WorldSnapshotCodec.save(a.world);
    const b = setup();
    b.world.register(PuzzleStateComponent);
    b.world.destroy(b.west); // the same scene, the crate gone in this one too
    WorldSnapshotCodec.load(b.world, saved);
    expect(b.runtime.state('braziers')).toBe('failed');
    expect(b.runtime.record('braziers').lost).toEqual(['west']);
  });
});

describe('PuzzleRuntime guards (mw-e15.3)', () => {
  it('rejects a puzzle defined twice and an unknown id, explains the goal and stops on dispose', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1, hz: HZ }));
    registerSceneComponents(world);
    world.facts.declare('hall.solved', { type: 'bool' });
    world.facts.declare('hall.open', { type: 'bool' });
    expect(() => new PuzzleRuntime(world, [braziers, braziers])).toThrow(/defined twice/);
    const runtime = new PuzzleRuntime(world, [braziers]);
    expect(runtime.ids).toEqual(['braziers']);
    expect(() => runtime.state('nope')).toThrow(/not defined/);
    expect(runtime.explain('braziers')).toContain('brazier');
    runtime.dispose();
    runtime.dispose();
    world.step();
    expect(runtime.state('braziers')).toBe('dormant');
  });

  it('runs without a player (no discovery volume can fire) and in a world with no spawns', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1, hz: HZ }));
    world.facts.declare('hall.solved', { type: 'bool' });
    world.facts.declare('hall.open', { type: 'bool' });
    const runtime = new PuzzleRuntime(world, [braziers]);
    world.step();
    runtime.poll();
    expect(runtime.status()).toEqual([
      expect.objectContaining({ state: 'dormant', entities: {}, met: false }),
    ]);
    // An interaction in a world with no scene components names no spawn, so it is no touch.
    const used = world.spawn();
    world.events.emit(interacted, { actor: used, target: used, verb: 'pull', affordance: 0 });
    world.step();
    // Restoring a world that never registered the puzzle component finds no records.
    world.restore(world.snapshot());
    expect(runtime.state('braziers')).toBe('dormant');
  });
});
