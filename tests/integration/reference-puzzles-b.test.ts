// mw-e15.10: three more greybox reference puzzles built with data only (no TypeScript under src/
// changed, apart from the scene id lists in two inventory tests): the Watchers (statues), the dark
// crossing (darkness) and the chimes (sound). Each is loaded through the game's own wiring
// (createGameWorld: Rapier, scene mechanisms, light field, spells, the puzzle runtime). Every declared
// solution is a recorded replay of plain-data commands that reaches `solved` and replays to identical
// hashes (AC-2); the validator proves the declared solutions (AC-1); the Watchers stay solvable with a
// statue destroyed (AC-3).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, fnv1a64, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import { installFactRegistry } from '@game/facts';
import {
  applyStimulus,
  breakableBroken,
  deliverImpact,
  doorStatus,
  holdRemotely,
  interacted,
  interactRemotely,
  learnSpell,
  playReplay,
  PlacementComponent,
  puzzleFailed,
  puzzleSolved,
  puzzleSolvedUndeclared,
  readProperty,
  recordScenario,
  releaseHold,
  setHoldPoint,
  soundClueCued,
  teleportCommand,
  teleportPhysicsObject,
  type EntityId,
  type ReplayScenario,
  type SoundClueCue,
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
  z.strictObject({ press: z.string() }),
  z.strictObject({ smash: z.string() }),
  z.strictObject({ strike: z.string(), damage: z.enum(['pierce', 'blunt']) }),
  z.strictObject({ carry: z.string(), to: vec }),
  z.strictObject({ grip: z.string(), at: vec }),
  z.strictObject({ steer: z.string(), at: vec }),
  z.strictObject({ let_go: z.string() }),
  z.strictObject({
    type: z.literal('cast'),
    caster: z.int().positive(),
    spell: z.string(),
    aim: vec,
  }),
  z.strictObject({ type: z.literal('tether-use'), caster: z.int().positive() }),
  z.strictObject({ type: z.literal('tether-release'), caster: z.int().positive() }),
  z.strictObject({
    kind: z.literal('sim.debug'),
    op: z.literal('teleport'),
    target: z.int(),
    to: vec,
  }),
]);
type Command = z.infer<typeof command>;

const at = (x: number, y: number, z2: number) => ({ x, y, z: z2 });
const seconds = (n: number) => Math.round(n * HZ);

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
        else if ('press' in input) {
          sim.events.emit(interacted, {
            actor: game.player,
            target: id(input.press),
            verb: 'press',
            affordance: 0,
          });
        } else if ('smash' in input) {
          // A blunt blow (a shield bash, a hurled crate): the same stimulus the breakables read.
          applyStimulus(sim, {
            shape: { kind: 'contact', target: id(input.smash) },
            element: 'blunt',
            intensity: 500,
            source: game.player,
          });
        } else if ('strike' in input) {
          // What an arrow's impact delivers (the arrow feed ends in `deliverImpact`).
          const place = sim.get(id(input.strike), PlacementComponent);
          if (place === undefined) throw new Error('not placed');
          deliverImpact(sim, {
            position: { x: place.x, y: place.y, z: place.z },
            energy: 60,
            damageType: input.damage,
            element: null,
            source: game.player,
          });
        } else if ('carry' in input) teleportPhysicsObject(sim, id(input.carry), input.to);
        else if ('grip' in input) holdRemotely(sim, game.player, id(input.grip), input.at, 25);
        else if ('steer' in input) setHoldPoint(sim, id(input.steer), input.at);
        else if ('let_go' in input) releaseHold(sim, id(input.let_go));
      }
    },
  });
  return { game, sim, id, sampler: new ActionSampler() };
}

/** A route: commands by tick. */
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
function proves(s: ReplayScenario<Command>, puzzle: string) {
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
  expect(solved).toHaveLength(1);
  const replay = recordScenario(s, {
    seed: 5,
    ticks,
    buildSha: 'test',
    contentHash,
    checkpointInterval: 60,
  });
  expect(playReplay(replay, s, { contentHash }).status).toBe('passed');
  return { game, solved, undeclared };
}

const turns = (name: string, from: number, n: number): [number, Command][] =>
  Array.from({ length: n }, (_, i) => [from + i * 10, { turn: name }] as [number, Command]);

describe('the Watchers: statues (mw-e15.10)', { timeout: 120_000 }, () => {
  const PUZZLE = 'watchers';
  const NAMES = ['watcher-a', 'watcher-b', 'watcher-c'];

  it('AC-2: turning each watcher by hand, two quarter turns apiece, opens the vault', ({
    task,
  }) => {
    markExercised(task, 'scene', 'watchers');
    const s = scenario('watchers-turn', 'watchers', [], seconds(6), () =>
      script([
        ...turns('watcher-a', 10, 2),
        ...turns('watcher-b', 40, 2),
        ...turns('watcher-c', 70, 2),
      ]),
    );
    const { game } = proves(s, PUZZLE);
    const sim = game.world as unknown as World<never>;
    expect(sim.facts.get('watchers.vault-open')).toBe(true);
    const gate = game.scene.spawns.find(({ spawn }) => spawn.id === 'vault-gate')?.entity;
    expect(gate === undefined ? undefined : doorStatus(sim, gate)).toBe('open');
  });

  it('AC-2: Mage Hand tethers each watcher from the south bank and turns it with the tether', ({
    task,
  }) => {
    markExercised(task, 'spell', 'mage-hand');
    const s = scenario(
      'watchers-mage-hand',
      'watchers',
      ['mage-hand'],
      seconds(16),
      ({ game, id, sim }) => {
        const place = (name: string) => {
          const p = sim.get(id(name), PlacementComponent);
          if (p === undefined) throw new Error('not placed');
          return at(p.x, p.y + 0.8, p.z);
        };
        const entries: [number, Command][] = [];
        NAMES.forEach((name, i) => {
          const t = 10 + i * 200;
          entries.push([
            t,
            { type: 'cast', caster: game.player, spell: 'mage-hand', aim: place(name) },
          ]);
          // The tether grabs 30 ticks after the cast; the held statue drifts towards where the
          // player looks, so both turns are made before it has moved far, then it is let go.
          entries.push([t + 34, { type: 'tether-use', caster: game.player }]);
          entries.push([t + 38, { type: 'tether-use', caster: game.player }]);
          entries.push([t + 50, { type: 'tether-release', caster: game.player }]);
        });
        return script(entries);
      },
    );
    const { game } = proves(s, PUZZLE);
    // The player never left the south bank.
    expect(game.world.get(game.player, PlacementComponent)?.z).toBeLessThan(-3);
  });

  it('AC-2: smashing the cracked watcher and turning the other two solves it', ({ task }) => {
    markExercised(task, 'scene', 'watchers');
    const s = scenario('watchers-smash', 'watchers', [], seconds(6), () =>
      script([
        [10, { smash: 'watcher-c' }],
        ...turns('watcher-a', 40, 2),
        ...turns('watcher-b', 70, 2),
      ]),
    );
    const { game } = proves(s, PUZZLE);
    const crack = game.scene.spawns.find(({ spawn }) => spawn.id === 'watcher-c')?.entity;
    expect(crack !== undefined && game.world.isAlive(crack)).toBe(false);
  });

  it('a watcher turned once still faces the door: the puzzle is not solved', () => {
    const room = open('watchers', []);
    for (const name of NAMES) interactRemotely(room.sim, room.game.player, room.id(name));
    for (let t = 0; t < seconds(3); t++) room.sim.step();
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
    expect(room.sim.facts.get('watchers.solved')).toBe(false);
  });

  it('AC-3: with the cracked watcher destroyed the puzzle is not failed and the other two still solve it', () => {
    const room = open('watchers', []);
    const events: string[] = [];
    room.sim.events.on(breakableBroken, () => events.push('broken'));
    room.sim.events.on(puzzleFailed, () => events.push('failed'));
    applyStimulus(room.sim, {
      shape: { kind: 'contact', target: room.id('watcher-c') },
      element: 'blunt',
      intensity: 500,
    });
    for (let t = 0; t < seconds(2); t++) room.sim.step();
    expect(events).toEqual(['broken']);
    expect(room.sim.isAlive(room.id('watcher-c'))).toBe(false);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
    for (const name of ['watcher-a', 'watcher-b']) {
      interactRemotely(room.sim, room.game.player, room.id(name));
      interactRemotely(room.sim, room.game.player, room.id(name));
    }
    for (let t = 0; t < seconds(2); t++) room.sim.step();
    expect(room.game.puzzles?.state(PUZZLE)).toBe('solved');
  });

  it('AC-3: the validator reports no softlock for any declared solution, and the smash route is one of them', () => {
    const puzzle = content.all('puzzle').find((p) => p.id === PUZZLE);
    const scene = content.all('scene').find((sc) => sc.id === 'watchers');
    if (puzzle === undefined || scene === undefined) throw new Error('missing');
    const report = validatePuzzle(puzzle, scene, {
      capabilityElements: capabilityElementsOf(content.all('spell')),
      concrete: (solution) => runSolution(RAPIER, content, puzzle, solution),
    });
    expect(report.solutions.map((s) => s.softlock.status)).not.toContain('softlock');
    const smash = report.solutions.find((s) => s.id === 'smash');
    expect(smash?.verdict).toBe('ok');
    expect(smash?.concrete?.status).toBe('confirmed');
    expect(report.failed).toBe(false);
  });

  it('AC-3: a plain watcher knocked out of the level comes home, so the puzzle cannot be lost', () => {
    const room = open('watchers', []);
    teleportPhysicsObject(room.sim, room.id('watcher-a'), at(-3, -200, 1));
    for (let t = 0; t < seconds(2); t++) room.sim.step();
    const home = room.sim.get(room.id('watcher-a'), PlacementComponent);
    expect(home?.y).toBeGreaterThan(-1);
    for (const name of NAMES) {
      interactRemotely(room.sim, room.game.player, room.id(name));
      interactRemotely(room.sim, room.game.player, room.id(name));
    }
    for (let t = 0; t < seconds(2); t++) room.sim.step();
    expect(room.game.puzzles?.state(PUZZLE)).toBe('solved');
  });
});

describe('the dark crossing: darkness (mw-e15.10)', { timeout: 120_000 }, () => {
  const PUZZLE = 'dark-crossing';
  // The causeway, sampled where the player's feet and eyes are.
  const PATH = [at(0, 0.1, -2.5), at(0, 0.1, 0), at(0, 0.1, 2.5)];
  const WALK = { from: seconds(6), to: seconds(6) + 125 };
  const lightOn = (room: Room) => PATH.map((p) => room.game.light.field.levelAt(p));
  /** A spot beside a brazier, on its ledge, where a burning barrel sets it alight. */
  const BESIDE = [at(-1.5, 0.5, -1.75), at(1.5, 0.5, -0.25), at(-1.5, 0.5, 0.75)];

  it('the causeway is dark before anything burns: every sample reads below 0.1', () => {
    const room = open('dark-crossing', []);
    for (let t = 0; t < 10; t++) room.sim.step();
    // The burning barrel is far from the path's middle; sample the middle and far end.
    const [, middle, far] = lightOn(room);
    expect(middle).toBeLessThan(0.1);
    expect(far).toBeLessThan(0.1);
  });

  it('AC-2: carrying the burning barrel along the causeway lights it and the player walks to the pad', ({
    task,
  }) => {
    markExercised(task, 'scene', 'dark-crossing');
    // The barrel is held up where the player can see by it (a torch overhead, a little ahead of the
    // walker at 5 m/s), so it never blocks the narrow path.
    const carries: [number, Command][] = [];
    for (let tick = 10; tick <= 170; tick += 6) {
      const z = Math.min(-5.5 + ((tick - 30) * 5) / 60 + 1.5, 6);
      carries.push([tick, { carry: 'torch-barrel', to: at(0, 2.4, z) }]);
    }
    const s = scenario(
      'dark-crossing-torch',
      'dark-crossing',
      [],
      seconds(8),
      () => script(carries),
      {
        from: 30,
        to: 155,
      },
    );
    const { game } = proves(s, PUZZLE);
    const sim = game.world as unknown as World<never>;
    const barrel = game.scene.spawns.find(({ spawn }) => spawn.id === 'torch-barrel')?.entity;
    expect(barrel !== undefined && readProperty(sim, barrel, 'burning')).toBe(true);
    expect(game.world.get(game.player, PlacementComponent)?.z).toBeGreaterThan(3);
    expect(sim.facts.get('dark-crossing.vault-open')).toBe(true);
  });

  it('AC-2: the burning barrel set beside each brazier lights all three, and the lit path can be walked', () => {
    const s = scenario(
      'dark-crossing-braziers',
      'dark-crossing',
      [],
      seconds(12),
      () =>
        script(
          BESIDE.map((to, i) => [10 + i * 100, { carry: 'torch-barrel', to }] as [number, Command]),
        ),
      WALK,
    );
    const { game } = proves(s, PUZZLE);
    const lit = PATH.map((p) => game.light.field.levelAt(p));
    for (const level of lit) expect(level).toBeGreaterThan(0.3);
  });

  it('AC-2: Ember cast from the south bank lights the three braziers and the lit path can be walked', ({
    task,
  }) => {
    markExercised(task, 'spell', 'ember');
    const ledges = [at(-1.5, 0.75, -2), at(1.5, 0.75, -0.5), at(-1.5, 0.75, 1)];
    const s = scenario(
      'dark-crossing-ember',
      'dark-crossing',
      ['ember'],
      seconds(12),
      ({ game: g }) =>
        script(
          ledges.map(
            (aim, i) =>
              [20 + i * 45, { type: 'cast', caster: g.player, spell: 'ember', aim }] as [
                number,
                Command,
              ],
          ),
        ),
      WALK,
    );
    const { game } = proves(s, PUZZLE);
    for (const p of PATH) expect(game.light.field.levelAt(p)).toBeGreaterThan(0.3);
  });

  it('stepping off the causeway drops the player into the pit, and the pad stays unweighed', () => {
    const room = open('dark-crossing', []);
    room.game.world.step([teleportCommand(room.game.player, at(1.2, 0.3, -2.5))]);
    for (let t = 0; t < seconds(4); t++) room.sim.step();
    expect(room.sim.get(room.game.player, PlacementComponent)?.y).toBeLessThan(-1);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
  });

  it('honest limit: nothing reads light, so walking the dark causeway blind also weighs the pad', () => {
    const s = scenario('dark-crossing-blind', 'dark-crossing', [], seconds(10), () => script([]), {
      from: 30,
      to: 30 + 125,
    });
    const { game } = proves(s, PUZZLE);
    // No flame was lit: the path was dark the whole way (the barrel stayed on the south bank).
    expect(game.light.field.levelAt(PATH[2] ?? at(0, 0, 0))).toBeLessThan(0.1);
  });
});

describe('the chimes: sound (mw-e15.10)', { timeout: 120_000 }, () => {
  const PUZZLE = 'chimes';
  const BELL_X = { low: -3, mid: 0, high: 3 } as const;
  const ORDER = ['high', 'low', 'mid'] as const;
  const drop = (n: (typeof ORDER)[number]) => at(BELL_X[n] + 0.4, 1.6, 5.5);
  const cues: SoundClueCue[] = [];
  const listen = (): [number, Command][] => [[10, { press: 'chime-button' }]];

  it('AC-2: pressing the button plays high, low, mid from the closet and lobbing the crate in that order opens the vault', ({
    task,
  }) => {
    markExercised(task, 'scene', 'chimes');
    cues.length = 0;
    const s = scenario('chimes-listen', 'chimes', [], seconds(12), ({ sim }) => {
      cues.length = 0;
      sim.events.on(soundClueCued, (c) => cues.push(c));
      return script([
        ...listen(),
        ...ORDER.map(
          (n, i) =>
            [seconds(5) + i * 120, { carry: 'lob-crate', to: drop(n) }] as [number, Command],
        ),
      ]);
    });
    const { game } = proves(s, PUZZLE);
    const sim = game.world as unknown as World<never>;
    const heard = cues.filter((c) => c.cue.startsWith('chime-') && c.cue !== 'chime-solved');
    expect(heard.map((c) => c.cue)).toEqual(['chime-high', 'chime-low', 'chime-mid']);
    const source = game.scene.spawns.find(({ spawn }) => spawn.id === 'chime-source')?.entity;
    expect(heard.every((c) => c.entity === source)).toBe(true);
    expect(sim.facts.get('chimes.vault-open')).toBe(true);
  });

  it('AC-2: Mage Hand carries the crate over the pit and drops it on each bell in the order heard', ({
    task,
  }) => {
    markExercised(task, 'spell', 'mage-hand');
    const entries: [number, Command][] = [...listen()];
    ORDER.forEach((n, i) => {
      const t = seconds(5) + i * 200;
      const above = drop(n);
      entries.push([t, { grip: 'lob-crate', at: at(above.x, above.y, -4) }]);
      entries.push([t + 30, { steer: 'lob-crate', at: above }]);
      entries.push([t + 120, { let_go: 'lob-crate' }]);
    });
    proves(
      scenario('chimes-mage-hand', 'chimes', ['mage-hand'], seconds(20), () => script(entries)),
      PUZZLE,
    );
  });

  it('AC-2: knowing the order from the ledger, with no button pressed, lobbing the crate solves it', () => {
    cues.length = 0;
    const s = scenario('chimes-by-the-book', 'chimes', [], seconds(8), ({ sim }) => {
      cues.length = 0;
      sim.events.on(soundClueCued, (c) => cues.push(c));
      return script(
        ORDER.map(
          (n, i) => [10 + i * 120, { carry: 'lob-crate', to: drop(n) }] as [number, Command],
        ),
      );
    });
    proves(s, PUZZLE);
    expect(cues.map((c) => c.cue)).toEqual(['chime-solved']);
  });

  it('an arrow-strength strike on each bell, as from a balcony, also solves it (not declared: no validator model)', () => {
    const s = scenario('chimes-arrows', 'chimes', [], seconds(6), () =>
      script(
        ORDER.map(
          (n, i) => [10 + i * 60, { strike: `bell-${n}`, damage: 'pierce' }] as [number, Command],
        ),
      ),
    );
    proves(s, PUZZLE);
  });

  it('a wrong bell rings the wrong chime and starts the order over; the right order afterwards still solves', () => {
    const room = open('chimes', []);
    const heard: string[] = [];
    room.sim.events.on(soundClueCued, (c) => heard.push(c.cue));
    const hit = (name: string) => {
      const place = room.sim.get(room.id(name), PlacementComponent);
      if (place === undefined) throw new Error('not placed');
      deliverImpact(room.sim, {
        position: { x: place.x, y: place.y, z: place.z },
        energy: 60,
        damageType: 'pierce',
        element: null,
        source: null,
      });
      for (let t = 0; t < 70; t++) room.sim.step();
    };
    hit('bell-low'); // wrong: high comes first
    expect(heard).toEqual(['chime-wrong']);
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
    hit('bell-high');
    hit('bell-low');
    expect(room.game.puzzles?.state(PUZZLE)).not.toBe('solved');
    hit('bell-mid');
    for (let t = 0; t < 30; t++) room.sim.step();
    expect(room.game.puzzles?.state(PUZZLE)).toBe('solved');
    expect(heard.at(-1)).toBe('chime-solved');
  });

  it('the bells are out of reach across the pit: a player cannot walk to them', () => {
    const room = open('chimes', []);
    room.sampler.down('KeyW');
    for (let t = 0; t < seconds(10); t++) room.game.world.step([room.sampler.sample()]);
    const p = room.sim.get(room.game.player, PlacementComponent);
    expect(p?.y).toBeLessThan(-1);
    expect(p?.z).toBeLessThan(3);
  });
});

describe('the reference puzzles pass the solvability validator (mw-e15.10)', () => {
  const capabilityElements = capabilityElementsOf(content.all('spell'));
  const scenes = content.all('scene');

  it.each(['watchers', 'dark-crossing', 'chimes'])(
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
