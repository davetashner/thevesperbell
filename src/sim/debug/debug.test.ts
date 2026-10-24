import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterLocomotion } from '../character/locomotion';
import {
  CharacterController,
  CharacterTuning,
  characterTuning,
  spawnCharacter,
} from '../character/system';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { DamageApplied, Died, type DamageResult, type Death } from '../combat/damage/events';
import { DamageModel } from '../combat/damage/model';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import { installPlayer } from '../player/player';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { layoutScene } from '../scene/layout';
import {
  registerSceneComponents,
  SceneSpawnComponent,
  SceneTransformComponent,
} from '../scene/loader';
import { ReplayRecorder } from '../replay/recorder';
import { playReplay } from '../replay/player';
import { installGameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';
import { hashWorld } from '../snapshot';
import {
  addProperties,
  propertyChanged,
  readProperty,
  registerWorldProperties,
  type PropertyChange,
} from '../properties/components';
import { DebugCheatsComponent, godModeModifier, hasCheat, NO_CHEATS } from './cheats';
import { placeEntity } from '../stimulus/placement';
import { STIMULUS_EDGE_FALLOFF } from '../stimulus/shapes';
import {
  impulseApplied,
  installStimuli,
  stimulusSystem,
  type ImpulseApplied,
} from '../stimulus/stimulus';
import {
  ACTION_TIMELINE_COMPONENTS,
  ActionTimelineComponent,
  giveActionTimeline,
} from '../combat/timeline/components';
import {
  actCommand,
  blastCommand,
  timeAdvanceCommand,
  timeSetCommand,
  cheatCommand,
  DEBUG_COMMAND,
  MAX_BLAST_INTENSITY,
  MAX_BLAST_RADIUS,
  isDebugCommand,
  killCommand,
  MAX_SPAWN_COUNT,
  propertyCommand,
  spawnCommand,
  teleportCommand,
  tuneCommand,
  type DebugCommand,
  type SpawnParams,
} from './commands';
import {
  DEBUG_SPAWN_TAG,
  installDebugCommands,
  propSpawner,
  SPAWN_SPACING,
  testPropSpawners,
  type Spawner,
} from './system';

const ORIGIN = { x: 0, y: 0, z: 0 };

function debugWorld(damage?: DamageModel) {
  const world = registerSceneComponents(new World<unknown>({ seed: 3 }));
  world.register(...DAMAGE_COMPONENTS);
  installDebugCommands(world, {
    spawners: testPropSpawners(['crate', 'plank']),
    ...(damage && { damage }),
  });
  return world;
}

/** Props a debug spawn created, by prop id. */
function spawned(world: World, prop: string): EntityId[] {
  const ids: EntityId[] = [];
  world.query(SceneSpawnComponent).forEach((id, spawn) => {
    if (spawn.prop === prop && spawn.tags.includes(DEBUG_SPAWN_TAG)) ids.push(id);
  });
  return ids;
}

describe('debug command builders', () => {
  it('build plain, JSON-safe commands and fold -0 to 0', () => {
    const spawn = spawnCommand('testprop-crate', 2, { x: -0, y: 1, z: 2 });
    expect(spawn).toEqual({
      kind: DEBUG_COMMAND,
      op: 'spawn',
      content: 'testprop-crate',
      count: 2,
      at: { x: 0, y: 1, z: 2 },
    });
    expect(Object.is(spawn.at.x, 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(spawn))).toEqual(spawn);
    expect(cheatCommand(4, 'god', true)).toEqual({
      kind: DEBUG_COMMAND,
      op: 'cheat',
      target: 4,
      cheat: 'god',
      on: true,
    });
    expect(teleportCommand(4, { x: 1, y: 2, z: 3 }).to).toEqual({ x: 1, y: 2, z: 3 });
    expect(killCommand(9)).toEqual({ kind: DEBUG_COMMAND, op: 'kill', target: 9 });
  });

  it('reject bad values at the call site', () => {
    expect(() => spawnCommand('', 1, ORIGIN)).toThrow(/content id/);
    expect(() => spawnCommand('x', 0, ORIGIN)).toThrow(/1–100/);
    expect(() => spawnCommand('x', MAX_SPAWN_COUNT + 1, ORIGIN)).toThrow(RangeError);
    expect(() => spawnCommand('x', 1.5, ORIGIN)).toThrow(RangeError);
    expect(() => spawnCommand('x', 1, { x: Number.NaN, y: 0, z: 0 })).toThrow(/finite/);
    expect(() => teleportCommand(1, { x: 0, y: Infinity, z: 0 })).toThrow(/finite/);
    expect(() => cheatCommand(0, 'god', true)).toThrow(/entity id/);
    expect(() => cheatCommand(1, 'fly' as never, true)).toThrow(/unknown cheat/);
    expect(() => killCommand(1.5)).toThrow(/entity id/);
    expect(() => propertyCommand(1, 'glowing', true)).toThrow('unknown world property "glowing"');
    expect(() => propertyCommand(1, 'wetness', 1.4)).toThrow(/wetness/);
    expect(() => propertyCommand(0, 'burning', true)).toThrow(/entity id/);
    expect(propertyCommand(2, 'burning', false)).toEqual({
      kind: DEBUG_COMMAND,
      op: 'property',
      target: 2,
      key: 'burning',
      value: false,
    });
  });

  it('carry spawn options sorted by name, only when there are some (mw-e04.9)', () => {
    const plain = spawnCommand('dummy', 1, ORIGIN, {});
    expect('params' in plain).toBe(false);
    const withParams = spawnCommand('dummy', 1, ORIGIN, { resist: 'slash=0.5', poise: '60' });
    expect(withParams.params).toEqual({ poise: '60', resist: 'slash=0.5' });
    expect(Object.keys(withParams.params ?? {})).toEqual(['poise', 'resist']);
    expect(JSON.parse(JSON.stringify(withParams))).toEqual(withParams);
    expect(() => spawnCommand('dummy', 1, ORIGIN, { 'Bad Name': '1' })).toThrow(
      'bad spawn option name "Bad Name"',
    );
  });

  it('isDebugCommand picks debug commands out of arbitrary inputs', () => {
    expect(isDebugCommand(killCommand(1))).toBe(true);
    expect(isDebugCommand(propertyCommand(1, 'burning', false))).toBe(true);
    expect(isDebugCommand({ kind: 'sim.fact' })).toBe(false);
    expect(isDebugCommand(null)).toBe(false);
    expect(isDebugCommand('sim.debug')).toBe(false);
  });
});

describe('debug command system', () => {
  it('spawns count props in a row along +x, live from the next tick', () => {
    const world = debugWorld();
    let seenDuringTick = -1;
    world.addSystem({
      name: 'probe',
      run: ({ world: w }) => {
        seenDuringTick = spawned(w, 'crate').length;
      },
    });
    world.step([spawnCommand('testprop-crate', 3, { x: 2, y: 0.5, z: -1 })]);
    expect(seenDuringTick).toBe(0);
    const crates = spawned(world, 'crate');
    expect(crates).toHaveLength(3);
    expect(crates.map((id) => world.get(id, SceneTransformComponent)?.position)).toEqual([
      { x: 2, y: 0.5, z: -1 },
      { x: 2 + SPAWN_SPACING, y: 0.5, z: -1 },
      { x: 2 + 2 * SPAWN_SPACING, y: 0.5, z: -1 },
    ]);
    expect(world.get(crates[0] ?? 0, SceneSpawnComponent)).toEqual({
      id: 'debug-spawn-crate',
      prop: 'crate',
      tags: [DEBUG_SPAWN_TAG],
    });
  });

  it('skips spawns of unknown content and commands for dead entities, leaving the world as it was', () => {
    const world = debugWorld();
    const before = hashWorld(world);
    const other = debugWorld();
    world.step([
      spawnCommand('testprop-anvil', 2, ORIGIN),
      cheatCommand(99, 'god', true),
      teleportCommand(99, ORIGIN),
      killCommand(99),
      { kind: 'something-else' },
    ]);
    other.step();
    expect(before).toBe(hashWorld(debugWorld()));
    expect(hashWorld(world)).toBe(hashWorld(other));
  });

  it('passes spawn options to the spawner; a spawner that rejects them skips the command', () => {
    const world = registerSceneComponents(new World<unknown>({ seed: 3 }));
    const seen: SpawnParams[] = [];
    const picky: Spawner = (w, at, params) => {
      seen.push(params);
      if (params['bad'] !== undefined) throw new RangeError('bad option');
      return propSpawner('crate')(w, at, params);
    };
    installDebugCommands(world, { spawners: new Map([['picky', picky]]) });
    world.step([
      spawnCommand('picky', 2, ORIGIN, { size: 'big' }),
      spawnCommand('picky', 1, ORIGIN),
      spawnCommand('picky', 3, ORIGIN, { bad: 'yes' }),
    ]);
    expect(seen).toEqual([{ size: 'big' }, { size: 'big' }, {}, { bad: 'yes' }]);
    expect(spawned(world, 'crate')).toHaveLength(3);
    const broken: Spawner = () => {
      throw new Error('bug');
    };
    const other = registerSceneComponents(new World<unknown>({ seed: 3 }));
    installDebugCommands(other, { spawners: new Map([['broken', broken]]) });
    expect(() => {
      other.step([spawnCommand('broken', 1, ORIGIN)]);
    }).toThrow('bug');
  });

  it('toggles cheats per entity, accumulating several toggles in one tick', () => {
    const world = debugWorld();
    const a = world.spawn();
    world.step([cheatCommand(a, 'god', true), cheatCommand(a, 'noclip', true)]);
    expect(world.get(a, DebugCheatsComponent)).toEqual({ god: true, noclip: true });
    expect(hasCheat(world, a, 'god')).toBe(true);
    world.step([cheatCommand(a, 'god', false)]);
    expect(world.get(a, DebugCheatsComponent)).toEqual({ god: false, noclip: true });
    expect(hasCheat(world, a, 'god')).toBe(false);
    expect(NO_CHEATS).toEqual({ god: false, noclip: false });
  });

  it('hasCheat is false where the debug commands were never installed', () => {
    const plain = new World({ seed: 1 });
    const id = plain.spawn();
    expect(hasCheat(plain, id, 'noclip')).toBe(false);
  });

  it('teleports characters (at rest) and placed objects; ignores other entities', () => {
    const world = debugWorld();
    world.register(CharacterController);
    const hero = spawnCharacter(world, ORIGIN);
    const [crate] = [propSpawner('crate')(world, ORIGIN, {})];
    const bare = world.spawn();
    const to = { x: 4, y: 2, z: -3 };
    world.step([teleportCommand(hero, to), teleportCommand(crate, to), teleportCommand(bare, to)]);
    expect(world.get(hero, CharacterController)).toMatchObject({
      position: to,
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
    });
    expect(world.get(crate, SceneTransformComponent)?.position).toEqual(to);
    expect(world.isAlive(bare)).toBe(true);
  });

  it('kills a combatant once (health 0, Died), removes a prop and never deletes a character', () => {
    const world = debugWorld();
    world.register(CharacterController);
    const died: Death[] = [];
    world.events.on(Died, (death) => died.push(death));
    const foe = world.spawn();
    giveCombatant(world, foe, { health: 50 });
    const prop = propSpawner('plank')(world, ORIGIN, {});
    const hero = spawnCharacter(world, ORIGIN);
    world.step([killCommand(foe), killCommand(prop), killCommand(hero)]);
    expect(world.get(foe, HealthComponent)?.current).toBe(0);
    expect(died).toEqual([{ tick: 0, target: foe, killer: null, source: null, tags: ['debug'] }]);
    expect(world.isAlive(prop)).toBe(false);
    expect(world.isAlive(hero)).toBe(true);
    world.step([killCommand(foe)]);
    expect(died).toHaveLength(1);
  });

  it('mw-e03.37: property commands set a world property like a rule would, adding it if missing', () => {
    const world = debugWorld();
    const sim = registerWorldProperties(world as unknown as World<never>);
    const torch = world.spawn();
    addProperties(sim, torch, { burning: true });
    const changes: PropertyChange[] = [];
    world.events.on(propertyChanged, (change) => changes.push(change));
    world.step([propertyCommand(torch, 'burning', false), propertyCommand(torch, 'wetness', 0.5)]);
    expect(readProperty(sim, torch, 'burning')).toBe(false);
    expect(readProperty(sim, torch, 'wetness')).toBe(0.5);
    expect(changes.map((c) => [c.key, c.new])).toEqual([
      ['burning', false],
      ['wetness', 0.5],
    ]);
    // A command whose value no longer validates (a replay from another build) is skipped.
    const stale = { ...propertyCommand(torch, 'wetness', 0.2), value: 7 } as DebugCommand;
    world.step([stale]);
    expect(readProperty(sim, torch, 'wetness')).toBe(0.5);
  });

  it('property commands are skipped in a world without world properties', () => {
    const world = debugWorld();
    const other = debugWorld();
    world.step([propertyCommand(world.spawn(), 'burning', true)]);
    other.spawn();
    other.step();
    expect(hashWorld(world)).toBe(hashWorld(other));
  });

  it('kill falls back to removing when the world has no health component', () => {
    const world = registerSceneComponents(new World<unknown>({ seed: 1 }));
    installDebugCommands(world, { spawners: new Map() });
    const thing = world.spawn();
    world.step([killCommand(thing)]);
    expect(world.isAlive(thing)).toBe(false);
  });

  it('god mode zeroes damage through the damage model it was installed on', () => {
    const damage = new DamageModel();
    const world = debugWorld(damage);
    expect(damage.modifiers().map((m) => m.name)).toEqual([godModeModifier.name]);
    const applied: DamageResult[] = [];
    world.events.on(DamageApplied, (hit) => applied.push(hit));
    const hero = world.spawn();
    giveCombatant(world, hero, { health: 100, poise: 10 });
    world.step([cheatCommand(hero, 'god', true)]);
    damage.apply(world, hero, { amounts: { slash: 40, fire: 5 }, poiseDamage: 20 });
    world.events.flush();
    expect(world.get(hero, HealthComponent)?.current).toBe(100);
    expect(applied[0]).toMatchObject({ total: 0, amounts: { slash: 0, fire: 0 }, poiseDamage: 0 });
    world.step([cheatCommand(hero, 'god', false)]);
    damage.apply(world, hero, { amounts: { slash: 40 } });
    expect(world.get(hero, HealthComponent)?.current).toBe(60);
  });
});

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

const UP_BUTTON = actionButton(false, false, false);
const HELD = actionButton(false, true, false);
const rise: ActionFrame = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: (action) => (action === 'jump' ? HELD : UP_BUTTON),
});

describe('noclip on the player', () => {
  function playerWorld() {
    const world = registerSceneComponents(new World<ActionFrame | DebugCommand>({ seed: 5 }));
    installDebugCommands(world, { spawners: new Map() });
    const layout = layoutScene(TEST_SCENE, testKit);
    const collision = new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? []));
    const player = installPlayer(world, { spawns: layout.spawns, collision, tuning: TUNING });
    return { world, player };
  }

  it('flies up through the air while Jump is held, and falls again once it is off', () => {
    const { world, player } = playerWorld();
    for (let i = 0; i < 10; i++) world.step([rise]);
    const start = world.get(player, CharacterController)?.position.y ?? 0;
    world.step([cheatCommand(player, 'noclip', true)]); // component goes live at the end of the tick
    for (let i = 0; i < 30; i++) world.step([rise]);
    const flown = world.get(player, CharacterController);
    expect(flown?.position.y).toBeCloseTo(start + 30 * (TUNING.speeds.sprint / 60), 6);
    expect(flown?.grounded).toBe(false);
    world.step([cheatCommand(player, 'noclip', false)]);
    for (let i = 0; i < 5; i++) world.step();
    expect(world.get(player, CharacterController)?.position.y).toBeLessThan(flown?.position.y ?? 0);
  });

  it('records and replays: the recorded commands reproduce every hash', () => {
    const build = () => playerWorld();
    const { world, player } = build();
    const recorder = new ReplayRecorder(world, {
      scenario: 'debug',
      buildSha: 'test',
      contentHash: null,
      checkpointInterval: 10,
    });
    recorder.step([cheatCommand(player, 'noclip', true)]);
    for (let i = 0; i < 20; i++) recorder.step([rise]);
    recorder.step([teleportCommand(player, { x: 1, y: 3, z: 1 })]);
    for (let i = 0; i < 20; i++) recorder.step();
    const replay = recorder.finish();
    expect(replay.inputs[0]?.[1]).toEqual([cheatCommand(player, 'noclip', true)]);
    const outcome = playReplay(replay, {
      name: 'debug',
      usesContent: false,
      command: z.custom<ActionFrame | DebugCommand>(() => true),
      create: () => build().world,
      drive: () => [],
    });
    expect(outcome.status).toBe('passed');
  });
});

describe('controller tuning (mw-e02.3)', () => {
  const forward: ActionFrame = actionFrame({
    move: actionVector(0, 1),
    look: actionVector(0, 0),
    buttons: () => UP_BUTTON,
  });
  const faster: Frozen<ControllerTuning> = { ...TUNING, speeds: { ...TUNING.speeds, run: 6 } };
  const speedOf = (world: World<ActionFrame | DebugCommand>, entity: EntityId) => {
    const v = world.get(entity, CharacterController)?.velocity ?? ORIGIN;
    return Math.sqrt(v.x * v.x + v.z * v.z);
  };
  function playerWorld() {
    const world = registerSceneComponents(new World<ActionFrame | DebugCommand>({ seed: 5 }));
    installDebugCommands(world, { spawners: new Map() });
    const layout = layoutScene(TEST_SCENE, testKit);
    const collision = new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? []));
    const player = installPlayer(world, { spawns: layout.spawns, collision, tuning: TUNING });
    return { world, player };
  }

  it('builds a JSON-safe command and rejects a bad target at the call site', () => {
    expect(tuneCommand(7, faster)).toEqual({
      kind: DEBUG_COMMAND,
      op: 'tune',
      target: 7,
      tuning: faster,
    });
    expect(isDebugCommand(tuneCommand(7, faster))).toBe(true);
    expect(() => tuneCommand(0, faster)).toThrow(RangeError);
  });

  it('AC-4: the player carries its tuning, and the tick a tune command arrives moves with it', () => {
    const { world, player } = playerWorld();
    expect(world.get(player, CharacterTuning)).toBe(TUNING);
    for (let i = 0; i < 40; i++) world.step([forward]);
    expect(speedOf(world, player)).toBeCloseTo(5, 9);
    world.step([tuneCommand(player, faster), forward]);
    expect(world.get(player, CharacterTuning)).toEqual(faster);
    // Accelerating toward 6 m/s at run / accelTime: one tick's worth above 5 already.
    expect(speedOf(world, player)).toBeCloseTo(5 + 6 / 0.15 / 60, 9);
    for (let i = 0; i < 20; i++) world.step([forward]);
    expect(speedOf(world, player)).toBeCloseTo(6, 9);
    // Locomotion reads the same tuning: full speed is a normalised 1 at the new run speed.
    expect(world.get(player, CharacterLocomotion)?.normalizedSpeed).toBeCloseTo(1, 9);
  });

  it('skips characters without their own tuning, which move with the systems’ tuning', () => {
    const { world, player } = playerWorld();
    const other = spawnCharacter(world, { x: 3, y: 1, z: 3 });
    world.step([tuneCommand(other, faster), tuneCommand(99, faster)]);
    expect(world.has(other, CharacterTuning)).toBe(false);
    expect(characterTuning(world, other, TUNING)).toBe(TUNING);
    expect(characterTuning(world, player, faster)).toBe(TUNING);
    const bare = debugWorld();
    const lone = bare.spawn();
    bare.step([tuneCommand(lone, faster)]);
    expect(characterTuning(bare, lone, TUNING)).toBe(TUNING);
  });

  it('records and replays a live retune to the same hashes', () => {
    const build = () => playerWorld();
    const { world, player } = build();
    const recorder = new ReplayRecorder(world, {
      scenario: 'tune',
      buildSha: 'test',
      contentHash: null,
      checkpointInterval: 10,
    });
    for (let i = 0; i < 10; i++) recorder.step([forward]);
    recorder.step([tuneCommand(player, faster), forward]);
    for (let i = 0; i < 20; i++) recorder.step([forward]);
    const outcome = playReplay(recorder.finish(), {
      name: 'tune',
      usesContent: false,
      command: z.custom<ActionFrame | DebugCommand>(() => true),
      create: () => build().world,
      drive: () => [],
    });
    expect(outcome.status).toBe('passed');
  });
});

describe('blast (mw-e04.34)', () => {
  it('builds a JSON-safe command and rejects bad values at the call site', () => {
    const blast = blastCommand({ x: -0, y: 1, z: 2 }, 4, 1500);
    expect(blast).toEqual({
      kind: DEBUG_COMMAND,
      op: 'blast',
      at: { x: 0, y: 1, z: 2 },
      radius: 4,
      intensity: 1500,
    });
    expect(Object.is(blast.at.x, 0)).toBe(true);
    expect(isDebugCommand(blast)).toBe(true);
    expect(() => blastCommand(ORIGIN, 0, 1)).toThrow(RangeError);
    expect(() => blastCommand(ORIGIN, MAX_BLAST_RADIUS + 1, 1)).toThrow(/radius/);
    expect(() => blastCommand(ORIGIN, 1, 0)).toThrow(/intensity/);
    expect(() => blastCommand(ORIGIN, 1, MAX_BLAST_INTENSITY + 1)).toThrow(/intensity/);
    expect(() => blastCommand(ORIGIN, Number.NaN, 1)).toThrow(RangeError);
    expect(() => blastCommand({ x: Infinity, y: 0, z: 0 }, 1, 1)).toThrow(/finite/);
  });

  it('sets off a force stimulus that pushes what it reaches away from its centre', () => {
    const world = installStimuli(registerWorldProperties(new World<unknown>({ seed: 3 })));
    installDebugCommands(world, { spawners: new Map() });
    world.addSystem(stimulusSystem());
    const crate = world.spawn();
    addProperties(world, crate, { pushable: true, weight: 10 });
    placeEntity(world, crate, { x: 1, y: 0, z: 0 }, 0.5);
    const pushes: ImpulseApplied[] = [];
    world.events.on(impulseApplied, (push) => pushes.push(push));
    world.step([blastCommand(ORIGIN, 3, 300)]);
    expect(pushes).toHaveLength(1);
    // 300 N·s at the centre, linear falloff: the crate's sphere is 0.5 m in, a sixth of the reach.
    const share = 1 - (1 - STIMULUS_EDGE_FALLOFF) * (0.5 / 3);
    expect(pushes[0]?.impulse.x).toBeCloseTo(300 * share);
    expect(pushes[0]?.velocityChange.x).toBeCloseTo(30 * share);
    expect(pushes[0]?.source).toBeNull();
  });

  it('is skipped in a world without stimuli', () => {
    const world = debugWorld();
    const before = hashWorld(world);
    world.step([blastCommand(ORIGIN, 3, 300)]);
    world.step([]);
    const other = debugWorld();
    other.step([]);
    other.step([]);
    expect(hashWorld(world)).toBe(hashWorld(other));
    expect(before).not.toBe(hashWorld(world));
  });
});

describe('act (mw-e03.11)', () => {
  it('builds a JSON-safe command and rejects bad values at the call site', () => {
    expect(actCommand(4, 'sword-heavy')).toEqual({
      kind: DEBUG_COMMAND,
      op: 'act',
      target: 4,
      move: 'sword-heavy',
    });
    expect(isDebugCommand(actCommand(4, 'sword-heavy'))).toBe(true);
    expect(() => actCommand(4, '')).toThrow('act needs a move id');
    expect(() => actCommand(0, 'sword-heavy')).toThrow(/entity id/);
  });

  it('buffers the move on the target’s action timeline, as its attack button would', () => {
    const world = debugWorld();
    world.register(...ACTION_TIMELINE_COMPONENTS);
    const knight = world.spawn();
    const crate = world.spawn();
    giveActionTimeline(world, knight);
    world.step([actCommand(knight, 'sword-heavy'), actCommand(crate, 'sword-heavy')]);
    expect(world.get(knight, ActionTimelineComponent)?.buffer).toEqual({
      move: 'sword-heavy',
      age: 0,
    });
    expect(world.has(crate, ActionTimelineComponent)).toBe(false);
  });

  it('is skipped in a world without action timelines', () => {
    const world = debugWorld();
    const thing = world.spawn();
    const before = hashWorld(world);
    world.step([actCommand(thing, 'sword-heavy')]);
    const other = debugWorld();
    other.spawn();
    other.step([]);
    expect(hashWorld(world)).toBe(hashWorld(other));
    expect(before).not.toBe(hashWorld(world));
  });
});

describe('time commands (mw-e27.12)', () => {
  it('validate their values and are debug commands', () => {
    expect(isDebugCommand(timeSetCommand(2, 90))).toBe(true);
    expect(() => timeSetCommand(0, 0)).toThrow(/day/);
    expect(() => timeSetCommand(1, 1440)).toThrow(/minute/);
    expect(() => timeAdvanceCommand(0)).toThrow(/minutes/);
    expect(() => timeAdvanceCommand(1.5)).toThrow(RangeError);
  });

  it('move the game clock inside the tick, and are ignored by a world without one', () => {
    const world = new World<unknown>({ seed: 1 });
    const clock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
    installDebugCommands(world, { spawners: new Map() });
    world.step([timeAdvanceCommand(120)]);
    expect(clock.time()).toEqual({ day: 1, minute: 480 });
    world.step([timeSetCommand(4, 600)]);
    expect(clock.time()).toEqual({ day: 4, minute: 600 });
    const bare = new World<unknown>({ seed: 1 });
    installDebugCommands(bare, { spawners: new Map() });
    bare.step([timeAdvanceCommand(120)]);
    expect(bare.tick).toBe(1);
  });
});
