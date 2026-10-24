import { CommandQueue } from '@game/loop/command-queue';
import {
  CharacterController,
  cheatCommand,
  DEBUG_SPAWN_TAG,
  despawnCreaturesCommand,
  DebugCheatsComponent,
  difficultyCommand,
  hashWorld,
  installDebugCommands,
  actCommand,
  assignSpellSlotCommand,
  learnSpellCommand,
  useQuickSlotCommand,
  blastCommand,
  timeAdvanceCommand,
  timeSetCommand,
  killCommand,
  PlayerLook,
  propertyCommand,
  registerSceneComponents,
  ReplayRecorder,
  SceneSpawnComponent,
  spawnCharacter,
  spawnCommand,
  teleportCommand,
  testPropSpawners,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLAST, registerBuiltins, type ConsoleHost } from './builtins';
import { createGameHost } from './host';
import { CommandRegistry } from './registry';

const PROPS = ['crate', 'plank', 'barrel', 'brazier', 'crystal'];

/** The host options every test host shares. */
const HOST_BASE = (world: World) => ({
  world,
  submit: () => undefined,
  player: () => undefined,
  spawnables: [],
  bookmarks: () => new Map(),
  scenes: [],
  loadScene: () => undefined,
  loop: { timeScale: 1 },
});

/** A real sim world behind a console, with a replay recorder in front of it like a session. */
function session(
  options: { withPlayer?: boolean; props?: readonly string[]; items?: readonly string[] } = {},
) {
  const world = registerSceneComponents(new World<unknown>({ seed: 42 }));
  const spawners = testPropSpawners(options.props ?? PROPS);
  installDebugCommands(world, { spawners });
  world.register(CharacterController, PlayerLook);
  let player: EntityId | undefined;
  if (options.withPlayer === true) {
    player = spawnCharacter(world, { x: 1, y: 0, z: 1 });
    world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  }
  const queue = new CommandQueue<unknown>();
  const loop = { timeScale: 1 };
  const loadScene = vi.fn();
  const host = createGameHost({
    world: world,
    submit: (command) => {
      queue.push(command);
    },
    player: () => player,
    spawnables: [...spawners.keys()].sort(),
    ...(options.items !== undefined && { items: options.items }),
    bookmarks: () => new Map([['player-start', { x: 0, y: 0.5, z: 3 }]]),
    scenes: ['kit-gallery', 'testbed'],
    loadScene,
    loop,
  });
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(registry);
  const recorder = new ReplayRecorder(world, {
    scenario: 'console',
    buildSha: 'test',
    contentHash: null,
  });
  const tick = () => {
    recorder.step(queue.drain());
  };
  const crates = () => {
    let n = 0;
    world.query(SceneSpawnComponent).forEach((_id, spawn) => {
      if (spawn.prop === 'crate' && spawn.tags.includes(DEBUG_SPAWN_TAG)) n++;
    });
    return n;
  };
  return {
    world,
    registry,
    queue,
    recorder,
    tick,
    crates,
    hero: player ?? 0,
    loop,
    loadScene,
    host,
  };
}

describe('built-in console commands', () => {
  it('AC-1: spawn testprop-crate 3 puts 3 crates in the sim next tick, recorded in the replay input log', () => {
    const s = session({ withPlayer: true });
    const result = s.registry.execute('spawn testprop-crate 3');
    expect(result).toEqual({ ok: true, lines: ['spawning 3 × testprop-crate'] });
    expect(s.crates()).toBe(0); // nothing changes until the sim steps
    s.tick();
    expect(s.crates()).toBe(3);
    const replay = s.recorder.finish();
    // In front of the player: feet (1, y, 1) facing −z, 2 m ahead.
    const y = s.world.get(s.hero, CharacterController)?.position.y ?? NaN;
    expect(replay.inputs).toEqual([[1, [spawnCommand('testprop-crate', 3, { x: 1, y, z: -1 })]]]);
  });

  it('AC-2: spawn does-not-exist prints "unknown content id" with the 3 closest matches; the sim is unchanged', () => {
    const s = session();
    const before = hashWorld(s.world);
    const result = s.registry.execute('spawn testprop-crat');
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      'unknown content id "testprop-crat"; closest: testprop-crate, testprop-crystal, testprop-plank',
    ]);
    const missing = s.registry.execute('spawn does-not-exist');
    expect(missing.lines[0]).toMatch(
      /^unknown content id "does-not-exist"; closest: (\S+, ){2}\S+$/,
    );
    expect(s.queue.size).toBe(0);
    s.tick();
    expect(s.recorder.finish().inputs).toEqual([[1, []]]);
    expect(hashWorld(s.world)).not.toBe(before); // the clock advanced…
    const fresh = session();
    fresh.tick();
    expect(hashWorld(s.world)).toBe(hashWorld(fresh.world)); // …and nothing else did
  });

  it('an unknown id with nothing to compare to says only that it is unknown', () => {
    expect(session({ props: [] }).registry.execute('spawn testprop-crate').lines).toEqual([
      'unknown content id "testprop-crate"',
    ]);
  });

  it('AC-3: give with a non-numeric count fails argument validation with usage help', () => {
    const s = session();
    const result = s.registry.execute('give potion lots');
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/^give: invalid arguments: arg 2: /);
    expect(result.lines[1]).toBe('usage: give <itemId> [n]');
    expect(s.queue.size).toBe(0);
  });

  it('give completes nothing without an item list', () => {
    expect(session().registry.complete('give ').options).toEqual([]);
  });

  it('give with valid arguments explains items do not exist yet', () => {
    expect(session().registry.execute('give potion 2')).toEqual({
      ok: false,
      lines: ['no items to give yet: the inventory arrives with e17 (mw-e17.12)'],
    });
  });

  it('give puts a known item in the player’s pack, and rejects an unknown one', () => {
    const s = session({ withPlayer: true, items: ['healing-draught', 'scroll-of-ember'] });
    expect(s.registry.execute('give scroll-of-ember 2')).toEqual({
      ok: true,
      lines: ['giving 2 × scroll-of-ember'],
    });
    expect(s.registry.execute('give healing-draught').lines).toEqual([
      'giving 1 × healing-draught',
    ]);
    expect(s.queue.size).toBe(2);
    expect(s.registry.execute('give scroll-of-embers').lines[0]).toMatch(
      /^unknown item "scroll-of-embers"; closest: scroll-of-ember/,
    );
    expect(s.queue.size).toBe(2);
    expect(s.registry.complete('give scr').line).toBe('give scroll-of-ember ');
    expect(s.registry.complete('give scroll-of-ember ').options).toEqual([]);
  });

  it('spawn defaults to one at the origin without a player, and caps the count', () => {
    const s = session();
    s.registry.execute('spawn testprop-crate');
    expect(s.queue.drain()).toEqual([spawnCommand('testprop-crate', 1, { x: 0, y: 0, z: 0 })]);
    expect(s.registry.execute('spawn testprop-crate 101').ok).toBe(false);
    expect(s.registry.execute('spawn testprop-crate 0').ok).toBe(false);
  });

  it('spawn passes --options to spawnables that take them, checked up front (mw-e04.9)', () => {
    const s = session();
    const checked: [string, Readonly<Record<string, string>>][] = [];
    const host: ConsoleHost = Object.assign(Object.create(s.host) as ConsoleHost, {
      checkSpawn: (content: string, options: Readonly<Record<string, string>>) => {
        checked.push([content, options]);
        return options['poise'] === '-1' ? '--poise must be a number 0–…' : undefined;
      },
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerBuiltins(registry);
    expect(registry.execute('spawn testprop-crate 2 --poise 60 --resist slash=0.5')).toEqual({
      ok: true,
      lines: ['spawning 2 × testprop-crate --poise 60 --resist slash=0.5'],
    });
    expect(s.queue.drain()).toEqual([
      spawnCommand('testprop-crate', 2, { x: 0, y: 0, z: 0 }, { poise: '60', resist: 'slash=0.5' }),
    ]);
    expect(registry.execute('spawn testprop-crate --poise -1')).toEqual({
      ok: false,
      lines: ['spawn testprop-crate: --poise must be a number 0–…'],
    });
    expect(checked).toHaveLength(2);
    expect(registry.execute('spawn testprop-crate --poise').lines).toEqual([
      'option --poise needs a value',
    ]);
    expect(registry.execute('spawn testprop-crate 1 2').lines).toEqual([
      'spawn: invalid arguments: arg 2: Too big: expected array to have <=1 items',
      'usage: spawn <contentId> [count 1–100] [at-cursor] [--option value…]',
    ]);
    // Without a check, no spawnable takes options.
    expect(s.registry.execute('spawn testprop-crate --size big').lines).toEqual([
      'spawn testprop-crate: testprop-crate takes no options',
    ]);
    expect(s.queue.size).toBe(0);
    expect(
      createGameHost({ ...HOST_BASE(s.world), checkSpawn: () => 'nope' }).checkSpawn?.('x', {}),
    ).toBe('nope');
  });

  it('god and noclip toggle the player through cheat commands, or set a state explicitly', () => {
    const s = session({ withPlayer: true });
    const player = s.hero;
    expect(s.registry.execute('god')).toEqual({ ok: true, lines: ['god mode on'] });
    s.tick();
    expect(s.world.get(player, DebugCheatsComponent)).toEqual({ god: true, noclip: false });
    expect(s.registry.execute('god').lines).toEqual(['god mode off']);
    expect(s.registry.execute('noclip on').lines).toEqual(['noclip on']);
    expect(s.registry.execute('noclip off').lines).toEqual(['noclip off']);
    expect(s.queue.drain()).toEqual([
      cheatCommand(player, 'god', false),
      cheatCommand(player, 'noclip', true),
      cheatCommand(player, 'noclip', false),
    ]);
    expect(s.registry.execute('noclip maybe').ok).toBe(false);
  });

  it('player commands say so when the scene has no player', () => {
    const s = session();
    for (const line of ['god', 'kill', 'tp 1 2 3']) {
      expect(s.registry.execute(line)).toEqual({ ok: false, lines: ['no player in this scene'] });
    }
  });

  it('kill targets the player by default, or a given live entity', () => {
    const s = session({ withPlayer: true });
    expect(s.registry.execute('kill').lines).toEqual([`killing entity ${String(s.hero)}`]);
    expect(s.registry.execute('kill 999')).toEqual({ ok: false, lines: ['no entity 999'] });
    expect(s.queue.drain()).toEqual([killCommand(s.hero)]);
  });

  it('mw-e03.11: act makes the player perform a move (the heavy attack placeholder)', () => {
    const s = session({ withPlayer: true });
    expect(s.registry.execute('act sword-heavy').lines).toEqual(['player performs sword-heavy']);
    expect(s.queue.drain()).toEqual([actCommand(s.hero, 'sword-heavy')]);
    expect(session().registry.execute('act sword-heavy')).toEqual({
      ok: false,
      lines: ['no player in this scene'],
    });
    expect(s.registry.execute('act').ok).toBe(false);
  });

  it('mw-e17.10: quickslot uses a quick slot of the player (1-based), until the controls bind them', () => {
    const s = session({ withPlayer: true });
    expect(s.registry.execute('quickslot 2').lines).toEqual(['using quick slot 2']);
    expect(s.queue.drain()).toEqual([useQuickSlotCommand(s.hero, 1)]);
    expect(s.registry.execute('quickslot 5').ok).toBe(false);
    expect(s.registry.execute('quickslot 0').ok).toBe(false);
    expect(session().registry.execute('quickslot 1')).toEqual({
      ok: false,
      lines: ['no player in this scene'],
    });
  });

  it('mw-e06.15: spell learn teaches the player a known spell, spell select chooses it', () => {
    const s = session({ withPlayer: true });
    const chosen: string[] = [];
    const host: ConsoleHost = Object.assign(Object.create(s.host) as ConsoleHost, {
      spells: ['ember', 'frost-bolt'],
      selectSpell: (id: string) => {
        chosen.push(id);
        return id === 'ember';
      },
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerBuiltins(registry);
    expect(registry.execute('spell learn ember').ok).toBe(true);
    expect(s.queue.drain()).toEqual([learnSpellCommand(s.hero, 'ember')]);
    expect(registry.execute('spell select ember').lines).toEqual(['ember selected']);
    expect(registry.execute('spell select frost-bolt')).toEqual({
      ok: false,
      lines: ['frost-bolt is not learned yet; try: spell learn frost-bolt'],
    });
    expect(chosen).toEqual(['ember', 'frost-bolt']);
    expect(registry.execute('spell learn embr').lines[0]).toContain('closest: ember');
    // mw-e06.16: spell slot puts a spell on the hotbar, or clears the slot.
    expect(registry.execute('spell slot 3 ember').lines).toEqual(['slot 3: ember']);
    expect(registry.execute('spell slot 8 none').lines).toEqual(['slot 8 cleared']);
    expect(registry.execute('spell slot 1').lines).toEqual(['slot 1 cleared']);
    expect(s.queue.drain()).toEqual([
      assignSpellSlotCommand(s.hero, 2, 'ember'),
      assignSpellSlotCommand(s.hero, 7, null),
      assignSpellSlotCommand(s.hero, 0, null),
    ]);
    expect(registry.execute('spell slot 9 ember')).toEqual({
      ok: false,
      lines: ['slot must be 1–8, got "9"'],
    });
    expect(registry.execute('spell slot two ember').ok).toBe(false);
    expect(registry.execute('spell slot 2 embr').lines[0]).toContain('closest: ember');
    expect(registry.complete('spell slot 2 e').line).toBe('spell slot 2 ember ');
    expect(registry.complete('spell slot 2 n').line).toBe('spell slot 2 none ');
    expect(registry.complete('spell slot 2 x ').options).toEqual([]);
    expect(registry.complete('spell learn e').line).toBe('spell learn ember ');
    expect(registry.complete('spell learn').options).toEqual([]);
    // A host with no spells knows none, and a build without selection cannot select.
    expect(s.registry.execute('spell learn ember').ok).toBe(false);
    expect(s.registry.complete('spell learn e')).toEqual({ line: 'spell learn e', options: [] });
    const bare = new CommandRegistry<ConsoleHost>(
      Object.assign(Object.create(s.host) as ConsoleHost, { spells: ['ember'] }),
    );
    registerBuiltins(bare);
    expect(bare.execute('spell select ember').ok).toBe(false);
  });

  it('mw-e03.37: prop sets a world property of a live entity, parsing the value', () => {
    const s = session();
    const torch = s.world.spawn();
    expect(s.registry.execute(`prop ${String(torch)} burning false`).lines).toEqual([
      `entity ${String(torch)}: burning = false`,
    ]);
    s.registry.execute(`prop ${String(torch)} wetness 0.5`);
    s.registry.execute(`prop ${String(torch)} lightEmitter {"intensity":80,"radius":6}`);
    s.registry.execute(`prop ${String(torch)} material wood`);
    expect(s.queue.drain()).toEqual([
      propertyCommand(torch, 'burning', false),
      propertyCommand(torch, 'wetness', 0.5),
      propertyCommand(torch, 'lightEmitter', { intensity: 80, radius: 6 }),
      propertyCommand(torch, 'material', 'wood'),
    ]);
    expect(s.registry.execute('prop 999 burning false')).toEqual({
      ok: false,
      lines: ['no entity 999'],
    });
    expect(s.registry.execute(`prop ${String(torch)} burnin true`).lines[0]).toMatch(
      /^unknown world property "burnin"; closest: burning/,
    );
    expect(s.registry.execute(`prop ${String(torch)} wetness 3`).lines).toEqual([
      'wetness must be ≤ 1, got 3',
    ]);
    expect(s.registry.execute(`prop ${String(torch)} lightEmitter {oops`).lines).toEqual([
      'bad value {oops: expected JSON like {"intensity":80,"radius":6}',
    ]);
    expect(s.queue.drain()).toEqual([]);
    expect(s.registry.complete(`prop ${String(torch)} burn`).line).toBe(
      `prop ${String(torch)} burning `,
    );
    expect(s.registry.complete('prop 1').options).toEqual([]);
  });

  it('prop passes unexpected errors on as failures', () => {
    const s = session();
    const torch = s.world.spawn();
    const submit = vi.spyOn(s.host, 'submit').mockImplementation(() => {
      throw new TypeError('queue closed');
    });
    expect(s.registry.execute(`prop ${String(torch)} burning false`)).toEqual({
      ok: false,
      lines: ['prop failed: TypeError: queue closed'],
    });
    submit.mockRestore();
  });

  it('tp takes x y z or a named place; unknown places list the closest', () => {
    const s = session({ withPlayer: true });
    const player = s.hero;
    expect(s.registry.execute('tp 1 2.5 -3').lines).toEqual(['teleporting to 1 2.5 -3']);
    expect(s.registry.execute('tp player-start').lines).toEqual(['teleporting to 0 0.5 3']);
    expect(s.queue.drain()).toEqual([
      teleportCommand(player, { x: 1, y: 2.5, z: -3 }),
      teleportCommand(player, { x: 0, y: 0.5, z: 3 }),
    ]);
    expect(s.registry.execute('tp nowhere').lines).toEqual([
      'unknown place "nowhere"; closest: player-start',
    ]);
    expect(s.registry.execute('tp 1 two 3').ok).toBe(false);
    expect(s.registry.execute('tp 1 Infinity 3').ok).toBe(false);
  });

  it('mw-e04.34: blast sets off a force blast where spawn puts things, with defaults and bounds', () => {
    const s = session({ withPlayer: true });
    // The player's feet are at (1, 0, 1), looking along −z: two metres ahead is (1, 0, −1).
    expect(s.registry.execute('blast').lines).toEqual([
      `blast of ${String(DEFAULT_BLAST.intensity)} N·s, radius ${String(DEFAULT_BLAST.radius)} m at 1 0 -1`,
    ]);
    expect(s.registry.execute('blast 900 2.5').ok).toBe(true);
    expect(s.queue.drain()).toEqual([
      blastCommand({ x: 1, y: 0, z: -1 }, DEFAULT_BLAST.radius, DEFAULT_BLAST.intensity),
      blastCommand({ x: 1, y: 0, z: -1 }, 2.5, 900),
    ]);
    expect(s.registry.execute('blast 0').ok).toBe(false);
    expect(s.registry.execute('blast 100 99').ok).toBe(false);
  });

  it('mw-e27.12: time set and time advance send clock commands, rejecting bad values', () => {
    const s = session();
    expect(s.registry.execute('time advance 8h').lines).toEqual(['time advances 480 game minutes']);
    expect(s.registry.execute('time advance 90m').ok).toBe(true);
    expect(s.registry.execute('time set 3 14:30').lines).toEqual(['time set to day 3 14:30']);
    expect(s.queue.drain()).toEqual([
      timeAdvanceCommand(480),
      timeAdvanceCommand(90),
      timeSetCommand(3, 14 * 60 + 30),
    ]);
    expect(s.registry.execute('time advance soon').ok).toBe(false);
    expect(s.registry.execute('time advance 0h').ok).toBe(false);
    expect(s.registry.execute('time set 3').ok).toBe(false);
    expect(s.registry.execute('time set 0 10:00').ok).toBe(false);
    expect(s.registry.execute('time set 1 25:00').ok).toBe(false);
    expect(s.queue.drain()).toEqual([]);
  });

  it('timescale shows and sets the loop speed within range', () => {
    const s = session();
    expect(s.registry.execute('timescale').lines).toEqual(['timescale 1']);
    expect(s.registry.execute('timescale 0.25').lines).toEqual(['timescale 0.25']);
    expect(s.loop.timeScale).toBe(0.25);
    expect(s.host.timeScale).toBe(0.25);
    expect(s.registry.execute('timescale 9').ok).toBe(false);
  });

  it('scene loads a known scene and suggests close ones for a typo', () => {
    const s = session();
    expect(s.registry.execute('scene testbed').lines).toEqual(['loading scene testbed']);
    expect(s.loadScene).toHaveBeenCalledWith('testbed');
    expect(s.registry.execute('scene testbd').lines).toEqual([
      'unknown scene "testbd"; closest: testbed, kit-gallery',
    ]);
  });

  it('mw-e30.7: save writes the game into a slot (manual-1 by default) and checks the slot', () => {
    const saved: string[] = [];
    const host = createGameHost({
      ...HOST_BASE(new World({ seed: 1 })),
      save: (slot) => {
        saved.push(slot);
      },
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerBuiltins(registry);
    expect(registry.execute('save').lines).toEqual(['saving to manual-1']);
    expect(registry.execute('save auto-2').lines).toEqual(['saving to auto-2']);
    expect(registry.execute('save manual-11')).toMatchObject({ ok: false });
    expect(saved).toEqual(['manual-1', 'auto-2']);
    expect(registry.complete('save q').line).toBe('save quick ');
    expect(registry.complete('save quick x').options).toEqual([]);
    // Without a save hook (a host that cannot save) the command says so.
    const s = session();
    expect(s.registry.execute('save')).toEqual({
      ok: false,
      lines: ['saving is unavailable here'],
    });
  });

  it('set changes a difficulty multiplier through a difficulty command, within its range', () => {
    const s = session();
    expect(s.registry.execute('set damageTaken 0.5').lines).toEqual(['damageTaken = 0.5']);
    expect(s.queue.drain()).toEqual([difficultyCommand({ damageTaken: 0.5 })]);
    expect(s.registry.execute('set damageTaken 99').lines).toEqual(['damageTaken must be 0.25–4']);
    expect(s.registry.execute('set speed 2').ok).toBe(false);
    s.registry.execute('set fallDamage 0');
    s.tick();
    expect(s.world.difficulty.fallDamage).toBe(0);
  });

  it('mw-e12.4: spawn … at-cursor spawns at the point under the cursor, rounded to the millimetre', () => {
    const world = registerSceneComponents(new World<unknown>({ seed: 1 }));
    const submitted: unknown[] = [];
    let cursor: { x: number; y: number; z: number } | undefined = { x: 1.23456, y: 0, z: -2 };
    const host = createGameHost({
      ...HOST_BASE(world),
      submit: (command) => submitted.push(command),
      spawnables: ['fixture-hound'],
      cursorPoint: () => cursor,
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerBuiltins(registry);
    expect(registry.execute('spawn fixture-hound 3 at-cursor')).toEqual({
      ok: true,
      lines: ['spawning 3 × fixture-hound at 1.235 0 -2'],
    });
    expect(registry.execute('spawn fixture-hound at-cursor').ok).toBe(true);
    expect(submitted).toEqual([
      spawnCommand('fixture-hound', 3, { x: 1.235, y: 0, z: -2 }),
      spawnCommand('fixture-hound', 1, { x: 1.235, y: 0, z: -2 }),
    ]);
    cursor = undefined;
    expect(registry.execute('spawn fixture-hound at-cursor').lines).toEqual([
      'spawn: nothing under the cursor',
    ]);
    // A host without a view has no cursor.
    const blind = new CommandRegistry<ConsoleHost>(
      createGameHost({ ...HOST_BASE(world), spawnables: ['fixture-hound'] }),
    );
    registerBuiltins(blind);
    expect(blind.execute('spawn fixture-hound at-cursor').lines).toEqual([
      'spawn: at-cursor needs the game view',
    ]);
    expect(submitted).toHaveLength(2);
  });

  it('mw-e12.4: despawn all submits a despawn of every creature', () => {
    const s = session();
    expect(s.registry.execute('despawn all').lines).toEqual(['despawning every creature']);
    expect(s.queue.drain()).toEqual([despawnCreaturesCommand()]);
    expect(s.registry.execute('despawn').ok).toBe(false);
    expect(s.registry.execute('despawn 3').ok).toBe(false);
    expect(s.registry.complete('despawn ').line).toBe('despawn all ');
    expect(s.registry.complete('despawn all ').options).toEqual([]);
  });

  it('seed prints the world seed; help lists every command or explains one', () => {
    const s = session();
    expect(s.registry.execute('seed').lines).toEqual(['seed 42']);
    expect(s.registry.execute('seed 1').ok).toBe(false);
    const help = s.registry.execute('help').lines;
    expect(help.map((line) => line.split(' ')[0])).toEqual([
      'act',
      'blast',
      'despawn',
      'give',
      'god',
      'help',
      'kill',
      'noclip',
      'prop',
      'quickslot',
      'save',
      'scene',
      'seed',
      'set',
      'spawn',
      'spell',
      'time',
      'timescale',
      'tp',
    ]);
    expect(s.registry.execute('help spawn').lines).toEqual([
      'usage: spawn <contentId> [count 1–100] [at-cursor] [--option value…]',
      'spawn content or a creature in front of the player, or at-cursor (sandbox dummies take options: type dummies)',
    ]);
    expect(s.registry.execute('help spwn').lines).toEqual([
      'unknown command "spwn"; closest: spawn, despawn, save',
    ]);
  });

  it('completes arguments: content ids, places, scenes, settings, cheat states and command names', () => {
    const s = session();
    expect(s.registry.complete('spawn testprop-cr')).toEqual({
      line: 'spawn testprop-cr',
      options: ['testprop-crate', 'testprop-crystal'],
    });
    expect(s.registry.complete('spawn testprop-p').line).toBe('spawn testprop-plank ');
    expect(s.registry.complete('spawn testprop-crate ').options).toEqual([]);
    expect(s.registry.complete('tp pl').line).toBe('tp player-start ');
    expect(s.registry.complete('tp 1 ').options).toEqual([]);
    expect(s.registry.complete('scene k').line).toBe('scene kit-gallery ');
    expect(s.registry.complete('scene kit-gallery ').options).toEqual([]);
    expect(s.registry.complete('set damage').options).toEqual(['damageDealt', 'damageTaken']);
    expect(s.registry.complete('set damageTaken ').options).toEqual([]);
    expect(s.registry.complete('god o').options).toEqual(['on', 'off']);
    expect(s.registry.complete('help times').line).toBe('help timescale ');
  });
});
