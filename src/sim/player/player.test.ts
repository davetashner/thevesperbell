import type { ControllerTuning, Frozen, StatusEntry } from '@content/index';
import { DamageModel } from '../combat/damage/model';
import { describe, expect, it } from 'vitest';
import { SKIN } from '../character/controller';
import { CharacterController, spawnCharacter } from '../character/system';
import { World } from '../core/world';
import {
  actionFrame,
  actionButton,
  actionVector,
  stickVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { loadScene, registerSceneComponents } from '../scene/loader';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { registerWorldProperties } from '../properties/components';
import { sceneLedges } from '../climb/ledges';
import { LEDGE_HANG_CAPABILITY } from '../climb/mantle';
import { HiddenComponent } from '../hiding/state';
import { layoutScene, type SceneSpawnPlacement } from '../scene/layout';
import { hashWorld } from '../snapshot';
import { addCapabilities, CapabilityRegistry } from '../progression/capabilities';
import {
  clampPitch,
  DEFAULT_LOOK_SETTINGS,
  installPlayer,
  lookTurn,
  NoPlayerStartError,
  PLAYER_LOOK_SENSITIVITY,
  PlayerLook,
  playerLookSystem,
  PLAYER_FALL_RESET_MARGIN,
  ViewAnchor,
  playerStart,
  spawnYaw,
  stickResponse,
  wrapYaw,
  type PlayerOptions,
} from './player';
import { installSpells } from '../magic/pipeline';
import { applyStatus } from '../magic/statuses';
import { installStimuli } from '../stimulus/stimulus';
import { placeEntity, PlacementComponent } from '../stimulus/placement';
import { LockOnComponent, NO_LOCK } from '../targeting/components';
import { LocomotionEvents } from '../character/locomotion';
import { createSurfaceMap } from '../surfaces/surfaces';

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

const LAYOUT = layoutScene(TEST_SCENE, testKit);
/** The test scene's solid parts, in memory. */
const sceneCollisionWorld = () =>
  new FakeCollisionWorld(LAYOUT.parts.flatMap((part) => part.collider ?? []));

interface FrameSpec {
  move?: [number, number];
  look?: number;
  lookY?: number;
  stick?: [number, number];
  pressed?: ButtonAction[];
  held?: ButtonAction[];
}

function frame({
  move = [0, 0],
  look = 0,
  lookY = 0,
  stick = [0, 0],
  pressed = [],
  held = [],
}: FrameSpec): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(look, lookY),
    lookStick: stickVector(stick[0], stick[1]),
    buttons: (action) => actionButton(pressed.includes(action), held.includes(action), false),
  });
}

function setup(sensitivity?: number, extra: Partial<PlayerOptions> = {}) {
  const world = new World<ActionFrame>({ seed: 3 });
  const player = installPlayer(world, {
    spawns: LAYOUT.spawns,
    collision: sceneCollisionWorld(),
    tuning: TUNING,
    ...(sensitivity !== undefined && { look: { sensitivity } }),
    ...extra,
  });
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const yaw = () => world.get(player, PlayerLook)?.yaw;
  const pitch = () => world.get(player, PlayerLook)?.pitch;
  return { world, player, state, yaw, pitch };
}

const spawn = (yaw: SceneSpawnPlacement['yaw'], tags: string[]) =>
  ({ ...LAYOUT.spawns[0], yaw, tags }) as SceneSpawnPlacement;

describe('player hiding (mw-e03.23)', () => {
  it('a player hidden in a spot is held where it is: movement input does nothing', () => {
    const { world, player, state } = setup();
    world.register(HiddenComponent);
    world.step([frame({})]);
    const at = state().position;
    world.add(player, HiddenComponent, { spot: 999, concealment: 1, since: 0, from: at });
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1], held: ['sprint'] })]);
    expect(state().position).toEqual(at);
  });
});

describe('wrapYaw', () => {
  it('keeps angles in (−π, π]', () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(1)).toBe(1);
    expect(wrapYaw(Math.PI)).toBe(Math.PI);
    expect(wrapYaw(-Math.PI)).toBe(Math.PI);
    expect(wrapYaw(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapYaw(1.5 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapYaw(-1.5 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('player controller timing hook (mw-e02.8)', () => {
  it('measure wraps the controller system once per tick', () => {
    let wrapped = 0;
    const { world } = setup(undefined, {
      measure: (run: () => void) => {
        wrapped += 1;
        run();
      },
    });
    for (let i = 0; i < 5; i++) world.step([frame({ move: [0, 1] })]);
    expect(wrapped).toBe(5);
  });
});

describe('player spawn (mw-e02.23)', () => {
  it('faces the spawn direction: scene yaw 0 looks along +z, 90 along +x', () => {
    expect(spawnYaw({ yaw: 0 })).toBe(Math.PI);
    expect(spawnYaw({ yaw: 90 })).toBeCloseTo(-Math.PI / 2, 12);
    expect(spawnYaw({ yaw: 180 })).toBe(0);
    expect(spawnYaw({ yaw: 270 })).toBeCloseTo(Math.PI / 2, 12);
  });

  it('finds the spawn tagged player-start', () => {
    expect(playerStart(LAYOUT.spawns)?.id).toBe('player-start');
    expect(playerStart([spawn(0, ['crate']), spawn(90, ['x', 'player-start'])])?.yaw).toBe(90);
    expect(playerStart([spawn(0, [])])).toBeUndefined();
  });

  it('spawns the player at the player start, resting SKIN above it, facing its direction', () => {
    const { state, yaw } = setup();
    expect(state().position).toEqual({ x: 0, y: SKIN, z: -2 });
    expect(yaw()).toBe(Math.PI);
  });

  it('throws NoPlayerStartError and leaves the world untouched when no spawn is tagged', () => {
    const world = new World<ActionFrame>({ seed: 3 });
    expect(() =>
      installPlayer(world, {
        spawns: [spawn(0, [])],
        collision: sceneCollisionWorld(),
        tuning: TUNING,
      }),
    ).toThrow(NoPlayerStartError);
    expect(world.entityCount).toBe(0);
    expect(() => world.register(CharacterController, PlayerLook, ViewAnchor)).not.toThrow();
  });

  it('starts at the named spawn instead of the player start, and throws when it is missing (mw-e01.11)', () => {
    const arrival = { ...spawn(90, ['arrival']), id: 'arrive-from-x' } as SceneSpawnPlacement;
    const world = new World<ActionFrame>({ seed: 3 });
    const id = installPlayer(world, {
      spawns: [spawn(0, ['player-start']), arrival],
      startSpawn: 'arrive-from-x',
      collision: sceneCollisionWorld(),
      tuning: TUNING,
    });
    expect(world.get(id, PlayerLook)?.yaw).toBeCloseTo(-Math.PI / 2, 5);
    expect(() =>
      installPlayer(new World<ActionFrame>({ seed: 3 }), {
        spawns: [spawn(0, ['player-start'])],
        startSpawn: 'nowhere',
        collision: sceneCollisionWorld(),
        tuning: TUNING,
      }),
    ).toThrow(/no spawn "nowhere"/);
  });

  it('an idle player does not move from its spawn', () => {
    const { world, state } = setup();
    const start = state().position;
    for (let i = 0; i < 30; i++) world.step([IDLE_ACTION_FRAME]);
    for (let i = 0; i < 30; i++) world.step([]);
    expect(state().position.x).toBe(start.x);
    expect(state().position.z).toBe(start.z);
    expect(state().position.y).toBeCloseTo(start.y, 9);
    expect(state().grounded).toBe(true);
  });

  it('resets a player who falls below the level to the authored start', () => {
    const resetY = -PLAYER_FALL_RESET_MARGIN;
    const { world, player, state, yaw, pitch } = setup(undefined, { fallResetY: resetY });
    world.set(player, CharacterController, {
      ...state(),
      position: { x: 40, y: resetY - 1, z: 30 },
      velocity: { x: 3, y: -40, z: 2 },
      crouched: true,
    });
    world.set(player, PlayerLook, { yaw: 0, pitch: 0.5 });
    world.step([IDLE_ACTION_FRAME]);
    expect(state()).toMatchObject({
      position: { x: 0, y: SKIN, z: -2 },
      velocity: { x: 0, y: 0, z: 0 },
      crouched: false,
    });
    expect(yaw()).toBe(Math.PI);
    expect(pitch()).toBe(0);
  });

  it('a fall reset also clears placement, the view anchor and the lock-on', () => {
    const resetY = -PLAYER_FALL_RESET_MARGIN;
    const { world, player, state } = setup(undefined, { fallResetY: resetY });
    world.register(PlacementComponent, LockOnComponent);
    placeEntity(world, player, { x: 40, y: resetY - 1, z: 30 }, 0.35);
    world.add(player, ViewAnchor, { point: { x: 1, y: 1, z: 1 } });
    world.add(player, LockOnComponent, { target: null, unseenTicks: 3, armed: false });
    world.set(player, CharacterController, {
      ...state(),
      position: { x: 40, y: resetY - 1, z: 30 },
    });
    world.step([IDLE_ACTION_FRAME]);
    expect(world.has(player, ViewAnchor)).toBe(false);
    expect(world.get(player, LockOnComponent)).toBe(NO_LOCK);
    expect(world.get(player, PlacementComponent)).toMatchObject({ x: 0, y: SKIN, z: -2 });
  });

  it('a fall reset leaves an entity with no controller state alone', () => {
    const { world, player } = setup(undefined, { fallResetY: -PLAYER_FALL_RESET_MARGIN });
    world.remove(player, CharacterController);
    world.step([IDLE_ACTION_FRAME]);
    expect(world.has(player, CharacterController)).toBe(false);
  });

  it('rejects a non-finite fall reset height', () => {
    expect(() => setup(undefined, { fallResetY: Number.NaN })).toThrow(RangeError);
  });
});

describe('ActionFrames drive the player (mw-e02.23)', () => {
  it('forward moves the player the way it faces (+z at the testbed start)', () => {
    const { world, state } = setup();
    for (let i = 0; i < 60; i++) world.step([frame({ move: [0, 1] })]);
    expect(state().position.z).toBeGreaterThan(-2 + 4);
    expect(state().position.x).toBeCloseTo(0, 9);
  });

  it('statuses scale the player’s speed through modifiedStat, and rooted holds it still (mw-e06.24)', () => {
    const slowed: StatusEntry = {
      id: 't-slowed',
      name: 't-slowed',
      description: 't-slowed',
      stack: { rule: 'refresh' },
      tags: [],
      modifiers: [{ stat: 'moveSpeed', mode: 'multiply', value: 0.5 }],
      sourceBound: false,
      breakWhen: [],
    };
    const rooted: StatusEntry = {
      ...slowed,
      id: 't-rooted',
      modifiers: [{ stat: 'moveSpeed', mode: 'multiply', value: 0 }],
    };
    const lookup = (id: string) => [slowed, rooted].find((status) => status.id === id);
    const walk = (status?: StatusEntry): number => {
      const world = installStimuli(registerWorldProperties(new World<ActionFrame>({ seed: 3 })));
      installSpells(world, {
        spells: () => undefined,
        damage: new DamageModel(),
        statuses: lookup,
      });
      const player = installPlayer(world, {
        spawns: LAYOUT.spawns,
        collision: sceneCollisionWorld(),
        tuning: TUNING,
        statuses: lookup,
      });
      if (status !== undefined) {
        applyStatus(world, status, {
          target: player,
          status: status.id,
          source: player,
          seconds: 30,
        });
      }
      const start = world.get(player, CharacterController)?.position.z ?? 0;
      for (let i = 0; i < 60; i++) world.step([frame({ move: [0, 1] })]);
      return (world.get(player, CharacterController)?.position.z ?? 0) - start;
    };
    const free = walk();
    expect(walk(slowed)).toBeLessThan(free * 0.7);
    expect(walk(slowed)).toBeGreaterThan(0.5);
    expect(walk(rooted)).toBeCloseTo(0, 6);
  });

  it('jump leaves the ground and lands again', () => {
    const { world, state } = setup();
    world.step([frame({ pressed: ['jump'], held: ['jump'] })]);
    const heights: number[] = [];
    for (let i = 0; i < 59; i++) {
      world.step([frame({})]);
      heights.push(state().position.y);
    }
    expect(Math.max(...heights)).toBeGreaterThan(1);
    expect(state().grounded).toBe(true);
  });

  it('mouse look turns the player: right is a turn to the right (yaw decreases)', () => {
    const { world, yaw } = setup();
    world.step([frame({ look: 100 })]);
    expect(yaw()).toBeCloseTo(Math.PI - 100 * PLAYER_LOOK_SENSITIVITY, 12);
    world.step([frame({ look: -100 })]);
    expect(yaw()).toBeCloseTo(Math.PI, 12);
    world.step([frame({ look: -100 })]); // crosses π and wraps
    expect(yaw()).toBeCloseTo(-Math.PI + 100 * PLAYER_LOOK_SENSITIVITY, 12);
  });

  it('no look (or no frame) leaves the yaw as it is', () => {
    const { world, yaw } = setup();
    world.step([frame({})]);
    world.step([]);
    expect(yaw()).toBe(Math.PI);
  });

  it('turning then running forward moves along the new facing', () => {
    const { world, state } = setup(Math.PI / 2 / 100);
    world.step([frame({ look: 100 })]); // a quarter turn right: now facing −x
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1] })]);
    expect(state().position.x).toBeLessThan(-1);
    expect(state().position.z).toBeCloseTo(-2, 6);
  });

  it('other characters (no PlayerLook) get no input from the frames', () => {
    const { world } = setup();
    const other = spawnCharacter(world, { x: 2, y: SKIN, z: 2 });
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1] })]);
    const position = world.get(other, CharacterController)?.position;
    expect(position?.x).toBe(2);
    expect(position?.z).toBe(2);
  });

  it('the look system can run on its own, with the default sensitivity', () => {
    const world = new World<ActionFrame>({ seed: 1 }).register(PlayerLook, ViewAnchor);
    world.addSystem(playerLookSystem());
    const id = world.spawn();
    world.add(id, PlayerLook, { yaw: 0, pitch: 0 });
    world.step([frame({ look: 10, lookY: 10 })]);
    expect(world.get(id, PlayerLook)?.yaw).toBeCloseTo(-10 * PLAYER_LOOK_SENSITIVITY, 12);
    expect(world.get(id, PlayerLook)?.pitch).toBeCloseTo(10 * PLAYER_LOOK_SENSITIVITY, 12);
  });

  it('the same frames give the same state hash', () => {
    const run = () => {
      const { world } = setup();
      for (let i = 0; i < 90; i++) {
        world.step([frame({ move: [i % 3 === 0 ? 1 : 0, 1], look: (i % 7) - 3 })]);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});

const DEG = Math.PI / 180;

describe('mantling and ledge hangs (mw-e02.12)', () => {
  /** The test room with a crate `height` tall 1 m ahead of the player start (which faces it). */
  function crateRoom(height: number, capabilities?: readonly string[]) {
    const scene = {
      ...TEST_SCENE,
      placements: [
        { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [5, 1, 5] },
        // The floor piece stretched up into a 2 × 2 m crate.
        { piece: { id: 'floor' }, at: [0, height, 0], yaw: 0, scale: [1, height / 0.2, 1] },
      ],
    } as const;
    const world = registerWorldProperties(
      registerSceneComponents(new World<ActionFrame>({ seed: 3 })),
    );
    const loaded = loadScene(world, scene, testKit, new InMemoryColliderSink());
    const collision = new FakeCollisionWorld(
      loaded.layout.parts.flatMap((part) => part.collider ?? []),
    );
    const player = installPlayer(world, {
      spawns: loaded.layout.spawns,
      collision,
      tuning: TUNING,
      ledges: {
        index: sceneLedges(loaded),
        ...(capabilities !== undefined && { capabilities }),
      },
    });
    const state = () => world.get(player, CharacterController);
    world.step([frame({})]); // the first tick finds the ground
    return { world, state, player };
  }

  it('AC-1: a jump at a 1.4 m crate while moving forward mantles the player onto it', () => {
    const { world, state } = crateRoom(1.4);
    world.step([frame({ move: [0, 1], pressed: ['jump'], held: ['jump'] })]);
    expect(state()?.traversal).toBe('mantle');
    for (let i = 0; i < 40; i++) world.step([frame({})]);
    expect(state()).toMatchObject({ traversal: null, grounded: true });
    expect(state()?.position.y).toBeCloseTo(1.4 + SKIN, 9);
  });

  it('AC-4: a 2.1 m ledge is grabbed only with the ledge-hang capability', () => {
    const plain = crateRoom(2.1);
    plain.world.step([frame({ move: [0, 1], pressed: ['jump'], held: ['jump'] })]);
    expect(plain.state()?.traversal).toBeNull();
    const climber = crateRoom(2.1, [LEDGE_HANG_CAPABILITY]);
    climber.world.step([frame({ move: [0, 1], pressed: ['jump'], held: ['jump'] })]);
    expect(climber.state()?.traversal).toBe('hang');
  });

  it('reads the capability registry live: a granted ledge hang grabs, a revoked one does not', () => {
    const registry = new CapabilityRegistry([LEDGE_HANG_CAPABILITY]);
    const { world, state, player } = crateRoom(2.1);
    addCapabilities(world, player);
    registry.grant(world, player, LEDGE_HANG_CAPABILITY, 'class');
    world.step([frame({ move: [0, 1], pressed: ['jump'], held: ['jump'] })]);
    expect(state()?.traversal).toBe('hang');

    const revoked = crateRoom(2.1);
    addCapabilities(revoked.world, revoked.player);
    registry.grant(revoked.world, revoked.player, LEDGE_HANG_CAPABILITY, 'class');
    registry.revoke(revoked.world, revoked.player, LEDGE_HANG_CAPABILITY, 'class');
    revoked.world.step([frame({ move: [0, 1], pressed: ['jump'], held: ['jump'] })]);
    expect(revoked.state()?.traversal).toBeNull();
  });
});

describe('look pitch (mw-e02.4)', () => {
  it('spawns level by default, or at the given pitch within the limits', () => {
    expect(setup().pitch()).toBe(0);
    expect(setup(undefined, { pitch: -0.3 }).pitch()).toBe(-0.3);
    expect(setup(undefined, { pitch: -3 }).pitch()).toBe(DEFAULT_LOOK_SETTINGS.minPitch);
  });

  it('mouse up looks up, mouse down looks down; invertY swaps them', () => {
    const plain = setup(0.01);
    plain.world.step([frame({ lookY: 10 })]);
    expect(plain.pitch()).toBeCloseTo(0.1, 12);
    plain.world.step([frame({ lookY: -30 })]);
    expect(plain.pitch()).toBeCloseTo(-0.2, 12);
    const inverted = setup(undefined, { look: { sensitivity: 0.01, invertY: true } });
    inverted.world.step([frame({ lookY: 10 })]);
    expect(inverted.pitch()).toBeCloseTo(-0.1, 12);
  });

  it('mw-e31.6 AC-1: invertY flips pitch for the same mouse movement, and invertX flips yaw', () => {
    const plain = setup(0.01);
    plain.world.step([frame({ look: 5, lookY: 100 })]);
    const flipped = setup(undefined, { look: { sensitivity: 0.01, invertY: true, invertX: true } });
    flipped.world.step([frame({ look: 5, lookY: 100 })]);
    expect(flipped.pitch()).toBeCloseTo(-(plain.pitch() ?? NaN), 12);
    expect(flipped.yaw()).toBeCloseTo(-(plain.yaw() ?? NaN), 12);
    const stick = lookTurn(
      { stick: { x: 1, y: 0 } },
      { ...DEFAULT_LOOK_SETTINGS, invertX: true },
      0.1,
    );
    expect(stick.yaw).toBeGreaterThan(0);
  });

  it('mw-e31.6: lookLive is read every tick, so a changed sensitivity applies at once', () => {
    let sensitivity = 0.01;
    const { world, pitch } = setup(undefined, { lookLive: () => ({ sensitivity }) });
    world.step([frame({ lookY: 10 })]);
    expect(pitch()).toBeCloseTo(0.1, 12);
    sensitivity = 0.02;
    world.step([frame({ lookY: 10 })]);
    expect(pitch()).toBeCloseTo(0.3, 12);
  });

  it('mw-e31.6: auto-centre eases pitch back after a delay of moving without look input', () => {
    const recentre = { pitch: 0, delay: 0.5, rate: 1 };
    const { world, pitch } = setup(undefined, {
      look: { sensitivity: 0.01, recentre },
      pitch: 0.5,
    });
    const hold = (spec: Parameters<typeof frame>[0], ticks: number): void => {
      for (let i = 0; i < ticks; i++) world.step([frame(spec)]);
    };
    hold({}, 120); // standing still never recentres
    expect(pitch()).toBe(0.5);
    hold({ move: [0, 1] }, 30); // moving, still inside the 0.5 s delay
    expect(pitch()).toBe(0.5);
    hold({ move: [0, 1] }, 31); // past the delay: easing at 1 rad/s
    expect(pitch()).toBeLessThan(0.5);
    const eased = pitch() ?? NaN;
    world.step([frame({ move: [0, 1], lookY: 10 })]); // looking resets the delay and wins
    expect(pitch()).toBeCloseTo(eased + 0.1, 12);
    hold({ move: [0, 1] }, 20);
    expect(pitch()).toBeCloseTo(eased + 0.1, 12);
    hold({ move: [0, 1] }, 600); // eases all the way to the target without overshooting
    expect(pitch()).toBe(0);
    const off = setup(undefined, { pitch: 0.5 });
    for (let i = 0; i < 300; i++) off.world.step([frame({ move: [0, 1] })]);
    expect(off.pitch()).toBe(0.5); // off by default
  });

  it('AC-1: pitch input beyond the clamp keeps pitch within −70°..+60°', () => {
    expect(DEFAULT_LOOK_SETTINGS.minPitch).toBeCloseTo(-70 * DEG, 12);
    expect(DEFAULT_LOOK_SETTINGS.maxPitch).toBeCloseTo(60 * DEG, 12);
    const { world, pitch } = setup(0.01);
    const seen: number[] = [];
    // Far past the top (10 rad of input), then far past the bottom, then back up again.
    for (const lookY of [1000, 1000, -500, -3000, -1000, 50, 5000]) {
      world.step([frame({ lookY })]);
      seen.push(pitch() ?? NaN);
    }
    for (const value of seen) {
      expect(value).toBeGreaterThanOrEqual(-70 * DEG - 1e-12);
      expect(value).toBeLessThanOrEqual(60 * DEG + 1e-12);
    }
    expect(seen[0]).toBeCloseTo(60 * DEG, 12); // pinned at the top
    expect(seen[3]).toBeCloseTo(-70 * DEG, 12); // pinned at the bottom
    expect(seen[5]).toBeCloseTo(-70 * DEG + 0.5, 12); // and back out at once, no wind-up
  });

  it('AC-1: the clamp follows the limits the game passes in', () => {
    const limits = { minPitch: -0.5, maxPitch: 0.25 };
    expect(clampPitch(1, limits)).toBe(0.25);
    expect(clampPitch(-1, limits)).toBe(-0.5);
    expect(clampPitch(0.1, limits)).toBe(0.1);
    const { world, pitch } = setup(undefined, { look: { sensitivity: 0.01, ...limits } });
    world.step([frame({ lookY: 100 })]);
    expect(pitch()).toBe(0.25);
  });

  it('pitch does not change where the player moves', () => {
    const level = setup();
    const tilted = setup(0.01);
    tilted.world.step([frame({ lookY: 50 })]);
    level.world.step([frame({})]);
    for (let i = 0; i < 30; i++) {
      level.world.step([frame({ move: [0.5, 1] })]);
      tilted.world.step([frame({ move: [0.5, 1] })]);
    }
    expect(tilted.state().position).toEqual(level.state().position);
  });

  it('AC-4: at camera yaw 90°, move (0, 1) moves the player along the camera forward vector', () => {
    const { world, state, yaw } = setup(Math.PI / 2 / 100);
    world.step([frame({ look: -100 })]); // mouse left a quarter turn: yaw π → 3π/2 ≡ −π/2
    world.step([frame({ look: -200 })]); // another half turn: yaw π/2
    expect(yaw()).toBeCloseTo(Math.PI / 2, 12);
    const before = state().position;
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1] })]);
    const after = state().position;
    // Camera forward at yaw 90° is (−sin 90°, 0, −cos 90°) = −x.
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    expect(dx).toBeLessThan(-1);
    expect(Math.abs(dz)).toBeLessThan(1e-9);
  });
});

describe('device-agnostic look (mw-e02.4, ready for mw-e02.9)', () => {
  const settings = {
    ...DEFAULT_LOOK_SETTINGS,
    sensitivity: 0.01,
    stick: { deadzone: 0.2, exponent: 2, yawRate: 4, pitchRate: 2 },
  };

  it('a mouse delta turns by counts × sensitivity, whatever the tick length', () => {
    const turn = { yaw: -0.3, pitch: 0.2 };
    expect(lookTurn({ mouse: { x: 30, y: 20 } }, settings, 1 / 60)).toEqual(turn);
    expect(lookTurn({ mouse: { x: 30, y: 20 } }, settings, 1 / 30)).toEqual(turn);
    expect(lookTurn({}, settings, 1 / 60)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('a stick turns at a rate: full deflection × max rate × dt', () => {
    const turn = lookTurn({ stick: { x: 1, y: 0 } }, settings, 0.5);
    expect(turn.yaw).toBeCloseTo(-2, 12); // right, at 4 rad/s for half a second
    expect(turn.pitch).toBe(0);
    expect(lookTurn({ stick: { x: 0, y: -1 } }, settings, 0.25).pitch).toBeCloseTo(-0.5, 12);
    const inverted = lookTurn({ stick: { x: 0, y: 1 } }, { ...settings, invertY: true }, 0.25);
    expect(inverted.pitch).toBeCloseTo(-0.5, 12);
  });

  it('the stick ignores the deadzone and follows the response curve beyond it', () => {
    expect(stickResponse({ x: 0.2, y: 0 }, settings.stick)).toEqual({ x: 0, y: 0 });
    expect(stickResponse({ x: 0.1, y: -0.1 }, settings.stick)).toEqual({ x: 0, y: 0 });
    // Halfway through the live range (0.6) is a quarter of full speed with exponent 2.
    expect(stickResponse({ x: 0.6, y: 0 }, settings.stick).x).toBeCloseTo(0.25, 12);
    // Direction is kept, and deflection past the rim counts as full.
    const diagonal = stickResponse({ x: 1, y: 1 }, settings.stick);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 12);
    const linear = { ...settings.stick, exponent: 1 };
    expect(stickResponse({ x: 0, y: -0.6 }, linear).y).toBeCloseTo(-0.5, 12);
  });

  it('mouse and stick add up in one tick', () => {
    const turn = lookTurn({ mouse: { x: 10, y: 0 }, stick: { x: -1, y: 0 } }, settings, 0.1);
    expect(turn.yaw).toBeCloseTo(-0.1 + 0.4, 12);
  });
});

describe('right-stick look through the ActionFrame (mw-e02.9)', () => {
  it('a held right stick turns the player at the look rate, tick after tick', () => {
    const { world, yaw, pitch } = setup();
    const start = yaw() ?? 0;
    const { yawRate } = DEFAULT_LOOK_SETTINGS.stick;
    // Full right for 30 ticks (half a second): 240°/s → 120° to the right.
    for (let i = 0; i < 30; i++) world.step([frame({ stick: [1, 0] })]);
    expect(wrapYaw((yaw() ?? 0) - start)).toBeCloseTo(wrapYaw(-yawRate * 0.5), 9);
    expect(pitch()).toBe(0);
    // Up looks up.
    world.step([frame({ stick: [0, 1] })]);
    expect(pitch()).toBeCloseTo(DEFAULT_LOOK_SETTINGS.stick.pitchRate / 60, 12);
  });

  it('a right stick inside the look deadzone leaves the view alone', () => {
    const { world, yaw } = setup();
    const start = yaw();
    world.step([frame({ stick: [0.1, -0.1] })]);
    expect(yaw()).toBe(start);
  });

  it('stick look replays to the same hash', () => {
    const run = () => {
      const { world } = setup();
      for (let i = 0; i < 60; i++) {
        world.step([frame({ move: [0, 1], stick: [((i % 9) - 4) / 4.1, ((i % 5) - 2) / 3] })]);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});

describe('footstep surfaces (mw-e09.4)', () => {
  const rug = {
    id: 'rug',
    surface: 'carpet',
    priority: 0,
    min: { x: -50, y: -5, z: -50 },
    max: { x: 50, y: 5, z: 50 },
  };
  const table = new Map(
    [
      ['stone', 0],
      ['carpet', -10],
    ].map(([id, offsetDb]) => [
      id as string,
      {
        id: id as string,
        offsetDb: offsetDb as number,
        varianceDb: 0,
        sfx: `sfx-foot-${id as string}`,
      },
    ]),
  );

  function walk(regions: (typeof rug)[]) {
    const { world } = setup(undefined, {
      surfaces: createSurfaceMap({ table, regions }),
    });
    const steps: { material?: string; surfaceDb: number }[] = [];
    world.events.on(LocomotionEvents, (e) => {
      if (e.kind === 'footstep') steps.push(e);
    });
    for (let i = 0; i < 120; i++) world.step([frame({ move: [0, 1] })]);
    return steps;
  }

  it('AC-1: a carpet region under the feet tags footsteps carpet at -10 dB', () => {
    const steps = walk([rug]);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((s) => s.material === 'carpet' && s.surfaceDb === -10)).toBe(true);
  });

  it('with no region at the feet, the ground collider still says what it is', () => {
    const steps = walk([{ ...rug, min: { x: 40, y: -5, z: 40 } }]);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((s) => s.material !== 'carpet')).toBe(true);
  });
});
