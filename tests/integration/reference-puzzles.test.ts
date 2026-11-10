// mw-e15.9: three greybox reference puzzles built with data only (no TypeScript under src/changed): the
// sunbeam hall (light), the frozen channel (freezing and levitation) and the scales room (weight). Each
// is loaded through the game's own wiring (createGameWorld: Rapier, scene mechanisms, light beams, fire
// and ice rules, spells, the puzzle runtime). Every declared solution is a recorded replay of plain-data
// commands that reaches `solved` and replays to identical hashes (AC-2); the validator proves the
// declared solutions (AC-1); the scales puzzle stays solved when its weight is taken away (AC-4).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, fnv1a64, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import { installFactRegistry } from '@game/facts';
import {
  applyStimulus,
  doorStatus,
  holdRemotely,
  interactRemotely,
  learnSpell,
  playReplay,
  PlacementComponent,
  puzzleSolved,
  puzzleSolvedUndeclared,
  readProperty,
  recordScenario,
  releaseHold,
  setHoldPoint,
  teleportCommand,
  teleportPhysicsObject,
  type EntityId,
  type ReplayScenario,
  type World,
} from '@sim/index';
import { runSolution } from '@tools/puzzle/concrete';
import { validatePuzzle, type SolutionReport } from '@tools/puzzle/validate';
import { capabilityElementsOf } from '@tools/puzzle/abstract';
import { actionFrameCommand } from '@tools/replay/action-frame-command';
import { createGameWorld, type HeadlessGame } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const HZ = 60;
const contentHash = fnv1a64(canonicalJson(content.all('puzzle')));
const vec = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });

/** Everything a route may do beyond walking, as plain data so a recording replays it. */
const command = z.union([
  actionFrameCommand,
  z.strictObject({ turn: z.string() }),
  z.strictObject({ carry: z.string(), to: vec }),
  z.strictObject({ cold: z.number() }),
  z.strictObject({ grip: z.string(), at: vec }),
  z.strictObject({ steer: z.string(), at: vec }),
  z.strictObject({ let_go: z.string() }),
  z.strictObject({
    type: z.literal('cast'),
    caster: z.int().positive(),
    spell: z.string(),
    aim: vec,
  }),
  z.strictObject({
    kind: z.literal('sim.debug'),
    op: z.literal('teleport'),
    target: z.int(),
    to: vec,
  }),
]);
type Command = z.infer<typeof command>;

const at = (x: number, y: number, z2: number) => ({ x, y, z: z2 });
const stand = (player: number, x: number, y: number, z2: number): Command =>
  teleportCommand(player, at(x, y, z2));

interface Room {
  readonly game: HeadlessGame<Command>;
  readonly sim: World<never>;
  readonly id: (name: string) => EntityId;
  readonly sampler: ActionSampler;
}

/** The scene with the player, its puzzle runtime and a route system for the data commands. */
function open(scene: string, spells: readonly string[]): Room {
  const game = createGameWorld<Command>(RAPIER, { seed: 5, hz: HZ, scene, magic: true, content });
  const sim = game.world as unknown as World<never>;
  installFactRegistry(sim.facts, content);
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  for (const spell of spells) learnSpell(sim, game.player, spell);
  game.world.addSystem({
    name: 'reference-route',
    run: ({ inputs }) => {
      for (const input of inputs) {
        if ('turn' in input) interactRemotely(sim, game.player, id(input.turn));
        else if ('carry' in input) teleportPhysicsObject(sim, id(input.carry), input.to);
        else if ('cold' in input) {
          // A cold stimulus swept over the channel from the west bank to the east (mw-e03.7).
          for (let x = -5.5; x <= 5.5; x += 1) {
            applyStimulus(sim, {
              shape: {
                kind: 'box',
                center: at(x, 0, 0),
                halfExtents: at(0.6, 1, input.cold),
              },
              element: 'cold',
              intensity: 60,
            });
          }
        } else if ('grip' in input) holdRemotely(sim, game.player, id(input.grip), input.at, 25);
        else if ('steer' in input) setHoldPoint(sim, id(input.steer), input.at);
        else if ('let_go' in input) releaseHold(sim, id(input.let_go));
      }
    },
  });
  return { game, sim, id, sampler: new ActionSampler() };
}

/** A route: commands by tick, and how long it runs. */
type Script = ReadonlyMap<number, readonly Command[]>;
const script = (entries: readonly (readonly [number, Command])[]): Script => {
  const map = new Map<number, Command[]>();
  for (const [tick, cmd] of entries) map.set(tick, [...(map.get(tick) ?? []), cmd]);
  return map;
};

let lastRoom: Room | undefined;

function scenario(
  name: string,
  scene: string,
  spells: readonly string[],
  ticks: number,
  route: (room: Room) => Script,
  walk?: { from: number; to: number },
): ReplayScenario<Command> {
  let commands: Script = new Map();
  let room: Room | undefined;
  return {
    name,
    usesContent: true,
    command,
    ticks,
    create: () => {
      room = open(scene, spells);
      lastRoom = room;
      commands = route(room);
      return room.game.world;
    },
    drive: ({ tick }) => {
      const out: Command[] = [...(commands.get(tick) ?? [])];
      if (room !== undefined && walk !== undefined) {
        if (tick === walk.from) room.sampler.down('KeyW');
        if (tick === walk.to) room.sampler.up('KeyW');
        out.push(room.sampler.sample());
      }
      return out;
    },
  };
}

/** Records the route, checks the puzzle is solved with the attribution, and replays it to equal hashes. */
function proves(
  s: ReplayScenario<Command>,
  puzzle: string,
  expected: { attribution?: string; undeclared?: boolean } = {},
) {
  const world = s.create({ seed: 5, hz: HZ });
  const game = lastRoom?.game;
  if (game === undefined) throw new Error('no game');
  const solved: string[] = [];
  const undeclared: string[] = [];
  (world as unknown as World<never>).events.on(puzzleSolved, (e) => solved.push(e.attribution));
  (world as unknown as World<never>).events.on(puzzleSolvedUndeclared, () =>
    undeclared.push('undeclared'),
  );
  const ticks = s.ticks ?? 600;
  for (let tick = 0; tick < ticks; tick++) {
    world.step(s.drive({ tick, world, rng: undefined as never }));
  }
  expect(game.puzzles?.state(puzzle)).toBe('solved');
  // A route that needs no capability fits every trail: the runtime credits the first declared one.
  expect(solved).toHaveLength(1);
  if (expected.attribution !== undefined) expect(solved).toEqual([expected.attribution]);
  expect(undeclared).toEqual(expected.undeclared === true ? ['undeclared'] : []);
  const replay = recordScenario(s, {
    seed: 5,
    ticks,
    buildSha: 'test',
    contentHash,
    checkpointInterval: 60,
  });
  expect(playReplay(replay, s, { contentHash }).status).toBe('passed');
  return game;
}

/** The entity of the scene spawn `name`. */
const spawnOf = (game: HeadlessGame<Command>, name: string): EntityId => {
  const found = game.scene.spawns.find(({ spawn }) => spawn.id === name)?.entity;
  if (found === undefined) throw new Error(`no spawn ${name}`);
  return found;
};

const seconds = (n: number) => Math.round(n * HZ);

describe('the sunbeam hall: light (mw-e15.9)', { timeout: 120_000 }, () => {
  const PUZZLE = 'sunbeam-hall';
  // Where a player stands to use a mirror: south of it, clear of every beam.
  const BESIDE_A = at(-3, 0, -1.3);
  const BESIDE_B = at(3, 0, -1.3);

  const turns = (name: string, from: number, n: number): [number, Command][] =>
    Array.from({ length: n }, (_, i) => [from + i * 30, { turn: name }] as [number, Command]);

  it('AC-2: turning both mirrors carries the sunbeam to the sensor and opens the vault', ({
    task,
  }) => {
    markExercised(task, 'scene', 'sunbeam-hall');
    const s = scenario('sunbeam-hall-mirrors', 'sunbeam-hall', [], seconds(14), ({ game }) =>
      script([
        [10, stand(game.player, BESIDE_A.x, BESIDE_A.y, BESIDE_A.z)],
        ...turns('mirror-a-mirror', 20, 3),
        [140, stand(game.player, BESIDE_B.x, BESIDE_B.y, BESIDE_B.z)],
        ...turns('mirror-b-mirror', 150, 3),
      ]),
    );
    const game = proves(s, PUZZLE, { attribution: 'mirrors' });
    const sim = game.world as unknown as World<never>;
    expect(sim.facts.get('sunbeam-hall.vault-open')).toBe(true);
    const gate = spawnOf(game, 'vault-gate');
    expect(doorStatus(sim, gate)).toBe('open');
  });

  it('AC-2: the burning barrel carried to the brazier solves it with no spell and no mirror', () => {
    const s = scenario('sunbeam-hall-flame', 'sunbeam-hall', [], seconds(8), () =>
      script([[10, { carry: 'torch-barrel', to: at(3.9, 0.5, 4.2) }]]),
    );
    proves(s, PUZZLE, {});
  });

  it('AC-2: Ember cast from across the room lights the brazier', ({ task }) => {
    markExercised(task, 'spell', 'ember');
    const s = scenario('sunbeam-hall-ember', 'sunbeam-hall', ['ember'], seconds(8), ({ game }) =>
      script([
        [
          30,
          {
            type: 'cast',
            caster: game.player,
            spell: 'ember',
            aim: at(4.25, 0.75, 4.5),
          },
        ],
      ]),
    );
    proves(s, PUZZLE, { attribution: 'ember' });
  });

  it('a mirror turned the wrong way sends the beam nowhere: the sensor stays dark', () => {
    const room = open('sunbeam-hall', []);
    const puzzles = room.game.puzzles;
    for (let i = 0; i < 2; i++) {
      interactRemotely(room.sim, room.game.player, room.id('mirror-a-mirror'));
      for (let t = 0; t < 10; t++) room.sim.step();
    }
    for (let t = 0; t < seconds(5); t++) room.sim.step();
    expect(puzzles?.state(PUZZLE)).not.toBe('solved');
    expect(room.sim.facts.get('sunbeam-hall.solved')).toBe(false);
  });
});

describe('the frozen channel: freezing and levitation (mw-e15.9)', { timeout: 120_000 }, () => {
  const PUZZLE = 'frozen-channel';

  it('AC-2: a cold stimulus freezes the channel and the player walks across the ice to the pad', ({
    task,
  }) => {
    markExercised(task, 'scene', 'frozen-channel');
    const s = scenario(
      'frozen-channel-freeze',
      'frozen-channel',
      [],
      seconds(14),
      () => script([[30, { cold: 3.2 }]]),
      { from: seconds(3), to: 305 },
    );
    const game = proves(s, PUZZLE, { attribution: 'freeze' });
    const sim = game.world as unknown as World<never>;
    const player = game.player;
    expect(sim.get(player, PlacementComponent)?.z).toBeGreaterThan(3); // on the far bank
    expect(sim.facts.get('frozen-channel.vault-open')).toBe(true);
  });

  it('without the cold the player walks into the trench and cannot reach the pad', () => {
    const room = open('frozen-channel', []);
    room.sampler.down('KeyW');
    for (let t = 0; t < seconds(10); t++) {
      room.game.world.step([room.sampler.sample()]);
    }
    const at2 = room.sim.get(room.game.player, PlacementComponent);
    expect(at2?.y).toBeLessThan(-1); // at the bottom of the 2 m trench
    expect(at2?.z).toBeLessThan(3);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
  });

  it('AC-2: Mage Hand lifts the crate across the water and sets it on the far pad', ({ task }) => {
    markExercised(task, 'spell', 'mage-hand');
    const s = scenario(
      'frozen-channel-levitate',
      'frozen-channel',
      ['mage-hand'],
      seconds(10),
      () =>
        script([
          [10, { grip: 'crate', at: at(2, 1.8, -4) }],
          [40, { steer: 'crate', at: at(0, 1.8, 0) }],
          [80, { steer: 'crate', at: at(0, 1.2, 5) }],
          [130, { let_go: 'crate' }],
        ]),
    );
    const game = proves(s, PUZZLE, {});
    const sim = game.world as unknown as World<never>;
    const crate = spawnOf(game, 'crate');
    expect(sim.get(crate, PlacementComponent)?.z).toBeGreaterThan(3);
  });

  it('a crate pushed into the trench sinks, and the puzzle is not solved by it', () => {
    const room = open('frozen-channel', []);
    teleportPhysicsObject(room.sim, room.id('crate'), at(0, 1, 0));
    for (let t = 0; t < seconds(6); t++) room.sim.step();
    const crate = room.sim.get(room.id('crate'), PlacementComponent);
    expect(crate?.y).toBeLessThan(-1);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
  });
});

describe('the scales room: weight (mw-e15.9)', { timeout: 120_000 }, () => {
  const PUZZLE = 'scales-room';
  const LEFT = at(-1, 0.4, 1);
  const RIGHT = at(1, 0.4, 1);

  const crates = (): Script =>
    script([
      [10, { carry: 'crates-west-crate-40', to: LEFT }],
      [10, { carry: 'crates-east-crate-40', to: RIGHT }],
    ]);

  it('AC-2: a 40 kg crate on each plate balances the scales and opens the vault', ({ task }) => {
    markExercised(task, 'scene', 'scales-room');
    const game = proves(
      scenario('scales-room-crates', 'scales-room', [], seconds(8), crates),
      PUZZLE,
      { attribution: 'crates' },
    );
    const sim = game.world as unknown as World<never>;
    const gate = spawnOf(game, 'vault-gate');
    expect(sim.facts.get('scales-room.vault-open')).toBe(true);
    expect(doorStatus(sim, gate)).toBe('open');
  });

  it('AC-2: a limp body on each plate balances the scales', () => {
    proves(
      scenario('scales-room-bodies', 'scales-room', [], seconds(8), () =>
        script([
          [10, { carry: 'body-a', to: { ...LEFT, y: 0.5 } }],
          [10, { carry: 'body-b', to: { ...RIGHT, y: 0.5 } }],
        ]),
      ),
      PUZZLE,
      {},
    );
  });

  it('AC-2: the block of ice on one plate and a 40 kg crate on the other balance the scales', () => {
    proves(
      scenario('scales-room-ice', 'scales-room', [], seconds(8), () =>
        script([
          [10, { carry: 'ice-block', to: { ...LEFT, y: 0.6 } }],
          [10, { carry: 'crates-east-crate-40', to: RIGHT }],
        ]),
      ),
      PUZZLE,
      {},
    );
  });

  it('AC-2: standing on one plate while Mage Hand sets the light crate on the other balances them', ({
    task,
  }) => {
    markExercised(task, 'spell', 'mage-hand');
    proves(
      scenario(
        'scales-room-stand-and-lift',
        'scales-room',
        ['mage-hand'],
        seconds(10),
        ({ game: g }) =>
          script([
            [5, stand(g.player, LEFT.x, 0, LEFT.z)],
            [10, { grip: 'light-crate', at: at(-3.5, 1.5, -1.5) }],
            [40, { steer: 'light-crate', at: at(1, 1.5, 1) }],
            [100, { steer: 'light-crate', at: at(1, 0.8, 1) }],
            [130, { let_go: 'light-crate' }],
          ]),
      ),
      PUZZLE,
      {},
    );
  });

  it('too much weight fails: the 120 kg stone block overloads a plate, so the scales stay unbalanced', () => {
    const room = open('scales-room', []);
    teleportPhysicsObject(room.sim, room.id('heavy-block'), { ...LEFT, y: 0.6 });
    teleportPhysicsObject(room.sim, room.id('crates-east-crate-40'), RIGHT);
    for (let t = 0; t < seconds(5); t++) room.sim.step();
    expect(readProperty(room.sim, room.id('heavy-block'), 'weight')).toBeGreaterThan(100);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
    expect(room.sim.facts.get('scales-room.solved')).toBe(false);
  });

  it('AC-4: weight taken off after solving leaves the puzzle solved and the door open', () => {
    const room = open('scales-room', []);
    const puzzles = room.game.puzzles;
    const gate = room.id('vault-gate');
    teleportPhysicsObject(room.sim, room.id('crates-west-crate-40'), LEFT);
    teleportPhysicsObject(room.sim, room.id('crates-east-crate-40'), RIGHT);
    for (let t = 0; t < seconds(8); t++) room.sim.step();
    expect(puzzles?.state(PUZZLE)).toBe('solved');
    expect(doorStatus(room.sim, gate)).toBe('open');
    // Take the weight off: both crates are carried away, and the plates read empty.
    teleportPhysicsObject(room.sim, room.id('crates-west-crate-40'), at(-4.5, 0.4, -4.5));
    teleportPhysicsObject(room.sim, room.id('crates-east-crate-40'), at(4.5, 0.4, -4.5));
    for (let t = 0; t < seconds(6); t++) room.sim.step();
    const left = room.sim.get(room.id('scales-left'), PlacementComponent);
    expect(left).toBeDefined();
    expect(puzzles?.state(PUZZLE)).toBe('solved');
    expect(room.sim.facts.get('scales-room.solved')).toBe(true);
    expect(room.sim.facts.get('scales-room.vault-open')).toBe(true);
    expect(doorStatus(room.sim, gate)).toBe('open');
  });
});

describe('the reference puzzles pass the solvability validator (mw-e15.9)', () => {
  const capabilityElements = capabilityElementsOf(content.all('spell'));
  const scenes = content.all('scene');

  it.each(['sunbeam-hall', 'frozen-channel', 'scales-room'])(
    'AC-1: %s has at least two distinct declared solutions and none is unreachable or diverged',
    { timeout: 120_000 },
    (id) => {
      const puzzle = content.all('puzzle').find((p) => p.id === id);
      if (puzzle === undefined) throw new Error(id);
      const scene = scenes.find((s) => s.id === puzzle.scene.id);
      if (scene === undefined) throw new Error(puzzle.scene.id);
      const report = validatePuzzle(puzzle, scene, {
        capabilityElements,
        concrete: (solution) => runSolution(RAPIER, content, puzzle, solution),
      });
      const good = (s: SolutionReport) => s.verdict === 'ok' && s.concrete?.status === 'confirmed';
      expect(report.failed, JSON.stringify(report.solutions.map((s) => [s.id, s.verdict]))).toBe(
        false,
      );
      expect(report.solutions.filter(good).length).toBeGreaterThanOrEqual(2);
      const signatures = new Set(
        report.solutions.map((s) =>
          JSON.stringify(puzzle.solutions.find((d) => d.id === s.id)?.steps),
        ),
      );
      expect(signatures.size).toBe(report.solutions.length); // distinct step lists
      expect(puzzle.tags).toContain('mvp');
    },
  );
});
