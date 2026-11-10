// mw-e15.3: the brazier hall, loaded through the game's own wiring (createGameWorld: Rapier physics,
// scene mechanisms, the fire rules, spells, the puzzle runtime). The puzzle brazier-hall is data:
// three unlit light-source braziers, a goal that reads what burns, a portcullis driven by a signal
// latch. The routes below light the braziers differently (a torch's contact heat, an Ember cast from
// across the room, a flame nobody declared) and every one opens the vault; a save and load keeps it
// solved without firing anything twice.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, fnv1a64, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { installFactRegistry } from '@game/facts';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  applyStimulus,
  doorStatus,
  learnSpell,
  PlacementComponent,
  puzzleDiscovered,
  puzzleRewarded,
  puzzleSolved,
  playReplay,
  puzzleSolvedUndeclared,
  readProperty,
  recordScenario,
  setProperty,
  teleportCommand,
  type EntityId,
  type ReplayScenario,
  type World,
} from '@sim/index';
import { createGameWorld, type HeadlessGame } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const BRAZIERS = ['brazier-west', 'brazier-north', 'brazier-east'] as const;
const PUZZLE = 'brazier-hall';
const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };

function hall() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'brazier-hall',
    magic: true,
    content,
  });
  const sim = game.world as unknown as World<never>;
  installFactRegistry(sim.facts, content);
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  const { puzzles, player } = game;
  if (puzzles === undefined) throw new Error('the hall has a puzzle');
  const heard: string[] = [];
  sim.events.on(puzzleDiscovered, () => heard.push('discovered'));
  sim.events.on(puzzleSolved, (e) => heard.push(`solved:${e.attribution}`));
  sim.events.on(puzzleSolvedUndeclared, () => heard.push('undeclared'));
  sim.events.on(puzzleRewarded, (e) => heard.push(`reward:${e.reward}`));
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  /** A torch: contact heat, as a flame held to the brazier. */
  const torch = (name: string) =>
    applyStimulus(sim, {
      shape: { kind: 'contact', target: id(name) },
      element: 'heat',
      intensity: 500,
      source: player,
    });
  /** Ember from where the player stands, aimed at the brazier: the bolt lands on the wall behind. */
  const ember = (name: string) => {
    const at = sim.get(id(name), PlacementComponent);
    if (at === undefined) throw new Error(`${name} is not placed`);
    game.world.step([
      { type: 'cast', caster: player, spell: 'ember', aim: { x: at.x, y: at.y, z: at.z } },
    ]);
    steps(60);
  };
  const burning = () => BRAZIERS.map((name) => readProperty(sim, id(name), 'burning'));
  return { game, sim, id, puzzles, player, heard, steps, torch, ember, burning };
}

/**
 * The bot as a replay scenario: its commands are plain data (a torch held to brazier `torch`, or the
 * cast command the spell pipeline reads), so the run records, replays and hashes like any other.
 */
const botCommand = z.union([
  z.strictObject({ torch: z.int().min(0).max(2) }),
  z.strictObject({
    type: z.literal('cast'),
    caster: z.int().positive(),
    spell: z.string(),
    aim: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  }),
]);
type BotCommand = z.infer<typeof botCommand>;

/** Where each brazier stands (the scene's spawn points), the bot's aim for Ember. */
const AIMS = [
  { x: -4.5, y: 0.75, z: 1.5 },
  { x: 2.5, y: 0.75, z: 4.5 },
  { x: 4.5, y: 0.75, z: 1.5 },
] as const;

let lastGame: HeadlessGame<BotCommand> | undefined;

function botScenario(route: 'torch' | 'ember'): ReplayScenario<BotCommand> {
  return {
    name: `brazier-hall-${route}`,
    usesContent: true,
    command: botCommand,
    ticks: 500,
    create: ({ seed, hz }) => {
      const game = createGameWorld<BotCommand>(RAPIER, {
        seed,
        hz,
        scene: 'brazier-hall',
        magic: true,
        content,
      });
      const sim = game.world as unknown as World<never>;
      installFactRegistry(sim.facts, content);
      const braziers = game.scene.spawns.filter(({ spawn }) => spawn.id.startsWith('brazier-'));
      game.world.addSystem({
        name: 'bot-torch',
        run: ({ inputs }) => {
          for (const input of inputs) {
            if (!('torch' in input)) continue;
            const target = braziers[input.torch]?.entity;
            if (target === undefined) continue;
            applyStimulus(sim, {
              shape: { kind: 'contact', target },
              element: 'heat',
              intensity: 500,
              source: game.player,
            });
          }
        },
      });
      if (route === 'ember') learnSpell(sim, game.player, 'ember');
      lastGame = game;
      return game.world;
    },
    // One brazier every second from tick 60 (Ember is on cooldown for half of one): a torch held to it, or an Ember cast at it.
    drive: ({ tick }) => {
      const index = tick / 60 - 1;
      const aim = AIMS[index];
      if (tick % 60 !== 0 || aim === undefined) return [];
      if (route === 'torch') return [{ torch: index }];
      const caster = lastGame?.player ?? 0;
      return [{ type: 'cast', caster, spell: 'ember', aim: { ...aim } }];
    },
  };
}

describe('the brazier hall puzzle runs from data (mw-e15.3)', { timeout: 30_000 }, () => {
  it('AC-6: the bot lights all braziers with a torch and the vault opens', ({ task }) => {
    markExercised(task, 'scene', 'brazier-hall');
    const h = hall();
    expect(h.puzzles.state(PUZZLE)).toBe('dormant');
    expect(doorStatus(h.sim, h.id('vault-gate'))).toBe('closed');
    h.steps(30);
    expect(h.puzzles.state(PUZZLE)).toBe('dormant'); // nothing touched, nothing moves
    h.game.world.step([teleportCommand(h.player, { x: 0, y: 0, z: 1 })]);
    h.steps(2);
    expect(h.puzzles.state(PUZZLE)).toBe('discovered'); // walked into the discovery volume
    for (const name of BRAZIERS) h.torch(name);
    h.steps(30);
    expect(h.burning()).toEqual([true, true, true]);
    expect(h.puzzles.state(PUZZLE)).toBe('in-progress'); // lit, but not yet for a second
    expect(h.sim.facts.get('brazier-hall.vault-open')).toBe(false);
    h.steps(60);
    expect(h.puzzles.state(PUZZLE)).toBe('solved');
    expect(h.puzzles.record(PUZZLE).attribution).toBe('carry-flame');
    expect(h.sim.facts.get('brazier-hall.solved')).toBe(true);
    expect(h.sim.facts.get('brazier-hall.vault-open')).toBe(true);
    h.steps(150); // the portcullis rises in two seconds
    expect(doorStatus(h.sim, h.id('vault-gate'))).toBe('open');
    expect(h.heard).toEqual(['discovered', 'solved:carry-flame', 'reward:brazier-hall-vault']);
  });

  it('AC-6: the bot lights all braziers with Ember from across the room, and the same vault opens', ({
    task,
  }) => {
    markExercised(task, 'spell', 'ember');
    const h = hall();
    learnSpell(h.sim, h.player, 'ember');
    h.steps(5);
    for (const name of BRAZIERS) h.ember(name);
    h.steps(90);
    expect(h.burning()).toEqual([true, true, true]);
    expect(h.puzzles.state(PUZZLE)).toBe('solved');
    expect(h.puzzles.record(PUZZLE).attribution).toBe('fire-from-range');
    expect(h.puzzles.status()[0]?.trail).toEqual(['spell.ember']);
    h.steps(150);
    expect(doorStatus(h.sim, h.id('vault-gate'))).toBe('open');
    // Never walked into the volume: the first bolt that lit a brazier found the puzzle.
    expect(h.heard).toEqual(['discovered', 'solved:fire-from-range', 'reward:brazier-hall-vault']);
  });

  it('a hold that is broken starts over: a brazier put out in the last second does not count', () => {
    const h = hall();
    for (const name of BRAZIERS) h.torch(name);
    h.steps(45);
    setProperty(h.sim, h.id('brazier-west'), 'burning', false); // doused for a moment
    h.steps(2);
    setProperty(h.sim, h.id('brazier-west'), 'burning', true);
    h.steps(45);
    expect(h.puzzles.state(PUZZLE)).toBe('in-progress');
    expect(h.puzzles.explain(PUZZLE)).toContain('held');
    h.steps(40);
    expect(h.puzzles.state(PUZZLE)).toBe('solved');
  });

  it('AC-5: a solved puzzle saved and loaded is still solved, its door open, nothing fires again', ({
    task,
  }) => {
    markExercised(task, 'scene', 'brazier-hall');
    const a = hall();
    for (const name of BRAZIERS) a.torch(name);
    a.steps(300);
    expect(a.puzzles.state(PUZZLE)).toBe('solved');
    expect(doorStatus(a.sim, a.id('vault-gate'))).toBe('open');
    const registry = createGameSaveRegistry();
    const bytes = registry.write(a.sim, { build, wallClockSavedAt: 1_790_000_000_000 });

    const b = hall();
    expect(b.puzzles.state(PUZZLE)).toBe('dormant');
    expect(doorStatus(b.sim, b.id('vault-gate'))).toBe('closed');
    const result = registry.read(b.sim, bytes);
    if (!result.ok) throw result.error;
    expect(result.warnings).toEqual([]);
    b.steps(10);
    expect(b.puzzles.state(PUZZLE)).toBe('solved');
    expect(b.puzzles.record(PUZZLE).attribution).toBe('carry-flame');
    expect(doorStatus(b.sim, b.id('vault-gate'))).toBe('open');
    expect(b.sim.facts.get('brazier-hall.solved')).toBe(true);
    b.steps(120);
    expect(b.heard).toEqual([]); // no discovery, no solve, no reward: it was already done
    // Putting a brazier out afterwards does not reopen the vault.
    setProperty(b.sim, b.id('brazier-east'), 'burning', false);
    b.steps(30);
    expect(b.puzzles.state(PUZZLE)).toBe('solved');
    expect(doorStatus(b.sim, b.id('vault-gate'))).toBe('open');
  });

  it('a half-finished hold survives save and load and finishes on time', () => {
    const a = hall();
    for (const name of BRAZIERS) a.torch(name);
    a.steps(40); // two thirds of the second
    expect(a.puzzles.state(PUZZLE)).toBe('in-progress');
    const registry = createGameSaveRegistry();
    const bytes = registry.write(a.sim, { build, wallClockSavedAt: 1_790_000_000_000 });
    const b = hall();
    const result = registry.read(b.sim, bytes);
    if (!result.ok) throw result.error;
    b.steps(10);
    expect(b.puzzles.state(PUZZLE)).toBe('in-progress');
    b.steps(15);
    expect(b.puzzles.state(PUZZLE)).toBe('solved'); // 65 ticks since lighting, not 60 + a fresh second
  });

  it('a scene without puzzles starts none, and the testbed lever puzzle sleeps until touched', () => {
    const lane = createGameWorld<unknown>(RAPIER, {
      seed: 1,
      hz: 60,
      scene: 'mechanism-room',
      content,
    });
    expect(lane.puzzles).toBeUndefined();
    const testbed = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, content });
    expect(testbed.puzzles?.state('testbed-room-lever')).toBe('dormant');
    for (let i = 0; i < 30; i++) testbed.world.step();
    expect(testbed.puzzles?.state('testbed-room-lever')).toBe('dormant');
    expect((testbed.world as unknown as World<never>).snapshot().components).not.toHaveProperty(
      'puzzle.state',
    );
  });

  it.each(['torch', 'ember'] as const)(
    'AC-6: the %s replay solves the puzzle, and replays to the same hashes',
    { timeout: 30_000 },
    (route) => {
      const scenario = botScenario(route);
      const contentHash = fnv1a64(canonicalJson(content.all('puzzle')));
      const world = scenario.create({ seed: 5, hz: 60 });
      const game = lastGame;
      for (let tick = 0; tick < 500; tick++) {
        world.step(scenario.drive({ tick, world, rng: undefined as never }));
      }
      expect(game?.puzzles?.state(PUZZLE)).toBe('solved');
      expect(game?.puzzles?.record(PUZZLE).attribution).toBe(
        route === 'torch' ? 'carry-flame' : 'fire-from-range',
      );
      const replay = recordScenario(scenario, {
        seed: 5,
        ticks: 500,
        buildSha: 'test',
        contentHash,
        checkpointInterval: 50,
      });
      expect(playReplay(replay, scenario, { contentHash }).status).toBe('passed');
    },
  );
});
