import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import {
  compileMoves,
  compileSurfaceTable,
  loadGameContent,
  PLAYER_CAMERA_ID,
  PLAYER_CONTROLLER_ID,
  PLAYER_LOCK_ON_ID,
  SURFACE_TABLE_ID,
} from '@content/index';
import { markExercised } from '@content/testing';
import { AnimationController, compileGraph } from '@render/animation/index';
import {
  box,
  BowComponent,
  createSurfaceMap,
  CharacterController,
  CombatFacingComponent,
  DAMAGE_COMPONENTS,
  HealthComponent,
  HIT_VOLUME_COMPONENTS,
  StaminaComponent,
  FakeCollisionWorld,
  hashWorld,
  interacted,
  LineOfSight,
  LEDGE_HANG_CAPABILITY,
  PlacementComponent,
  placeEntity,
  PlayerLook,
  QuiverComponent,
  RapierSightWorld,
  registerWorldProperties,
  sceneTargetPosition,
  spawnCharacter,
  RapierCollisionWorld,
  RapierPhysics,
  registerSceneComponents,
  SKIN,
  World,
  zeroHealth,
  type ActionFrame,
  type Interaction,
  LocomotionEvents,
} from '@sim/index';
import { ActionSampler } from '../input';
import { prepareTestbedCombat, startTestbedCombat, TRAINING_DUMMY } from '../combat';
import { createGameLoop, FakeFrames, RenderSync, type SceneBinding, type Transform } from '../loop';
import { installGamePhysics } from '../physics-objects';
import { readSceneTransform, SceneLoader } from '../scene';
import { lookForward, toRadians } from '../camera';
import type { CharacterProbe } from '../animation';
import {
  CROUCH_DROP,
  DEATH_PULL_BACK,
  readPlayerTransform,
  setupTestbedPlayer,
  yawOf,
  yawRotation,
  type CameraReadout,
  type PlayerReadout,
  type TestbedLockOn,
  type TestbedPlayerOptions,
  type TransformReader,
} from './testbed-player';

const content = loadGameContent();
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
const cameraTuning = content.get('camera', PLAYER_CAMERA_ID);

/** A headless scene object: remembers the last transform applied and whether it was disposed. */
interface Box {
  transform?: Transform;
  disposed?: boolean;
}

function binding(object: Box, read: TransformReader): SceneBinding<Box> {
  return {
    object,
    read,
    apply(target, transform) {
      target.transform = transform;
    },
    dispose(target) {
      target.disposed = true;
    },
  };
}

function fakeCamera() {
  const camera = {
    fov: 70,
    near: 0.1,
    aspect: 16 / 9,
    at: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    position: {
      set(x: number, y: number, z: number) {
        camera.at = { x, y, z };
      },
    },
    lookAt(x: number, y: number, z: number) {
      camera.target = { x, y, z };
    },
  };
  return camera;
}

type Extra = Partial<TestbedPlayerOptions<Box, ActionFrame>>;

/**
 * The testbed loaded headlessly as the game loads it (static colliders in the sim's Rapier world,
 * the controller querying it), with the player wired to a sampler and a fake-frame loop.
 */
function testbed(options: Extra | ((physics: RapierPhysics) => Extra) = {}) {
  const physics = new RapierPhysics(RAPIER);
  const extra = typeof options === 'function' ? options(physics) : options;
  const world = registerSceneComponents(new World<ActionFrame>({ seed: 1, physics }));
  // Climbing reads the pieces' properties through their bound colliders: the game's scene physics.
  if (extra.climb !== undefined) installGamePhysics(world);
  else if (extra.interaction !== undefined) {
    registerWorldProperties(world).register(PlacementComponent);
  } else if (extra.ledges !== undefined) registerWorldProperties(world);
  const sampler = new ActionSampler();
  const frames = new FakeFrames();
  const { loop, sync } = createGameLoop<ActionFrame>({
    world,
    sources: { now: frames.now, scheduler: frames, visibility: frames },
    sampleCommands: sampler.sampleCommands,
    onStep: () => {
      player.onStep();
    },
    draw: (frame) => {
      player.frame(frame);
    },
    warn: () => undefined,
  });
  const loader = new SceneLoader({
    world,
    sync,
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object: Box) => binding(object, readSceneTransform),
    ...(extra.climb !== undefined && { physics: {} }),
  });
  const scene = loader.load('testbed');
  const capsule: Box = {};
  const camera = fakeCamera();
  const player = setupTestbedPlayer({
    world,
    scene,
    sync,
    tuning,
    cameraTuning,
    collision: new RapierCollisionWorld(physics),
    object: capsule,
    binding,
    camera,
    ...extra,
  });
  loop.start();
  /** Runs `seconds` of 60 Hz display frames. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) frames.frame(1000 / 60);
  };
  const state = () => {
    const readout = player.readout();
    if (readout === undefined) throw new Error('no player');
    return readout;
  };
  return {
    world,
    sync,
    sampler,
    player,
    capsule,
    camera,
    run,
    state,
    loop,
    frames,
    physics,
    scene,
  };
}

/** Taps a key for one tick. */
function tap(sampler: ActionSampler, run: (seconds: number) => void, code: string): void {
  sampler.down(code);
  run(1 / 60);
  sampler.up(code);
  run(1 / 60);
}

describe('testbed player with sword and shield (mw-e04.6)', () => {
  it('starts at a named spawn when asked (area transitions, mw-e01.11)', () => {
    const { state } = testbed({ startSpawn: 'player-start' });
    expect(state().position.z).toBeCloseTo(testbed().state().position.z, 3);
  });

  it('publishes the move in progress, stamina and the raised shield', () => {
    const combat = prepareTestbedCombat(content);
    const physics = new RapierPhysics(RAPIER);
    const world = registerSceneComponents(new World<ActionFrame>({ seed: 1, physics })).register(
      ...HIT_VOLUME_COMPONENTS,
      ...DAMAGE_COMPONENTS,
      PlacementComponent,
    );
    const sync = new RenderSync(world);
    const loader = new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: { staticGeometry: () => ({}), spawn: () => ({}) },
      binding: (object: Box) => binding(object, readSceneTransform),
    });
    const scene = loader.load('testbed');
    const player = setupTestbedPlayer({
      world,
      scene,
      sync,
      tuning,
      cameraTuning,
      collision: new RapierCollisionWorld(physics),
      object: {},
      binding,
      camera: fakeCamera(),
      moves: combat.moves,
      melee: combat.melee,
    });
    startTestbedCombat(world, combat, scene.layout.spawns);
    const sampler = new ActionSampler();
    const step = () => {
      world.step(sampler.sampleCommands(world.tick));
    };
    step();
    expect(player.readout()?.combat).toEqual({ action: null, stamina: 100, blocking: false });
    sampler.down('Mouse2');
    step();
    expect(player.readout()?.combat?.blocking).toBe(true);
    sampler.up('Mouse2');
    sampler.down('Mouse0');
    step();
    expect(player.readout()?.combat).toEqual({
      action: 'sword-light-1',
      stamina: 88,
      blocking: false,
    });
    // A player whose pool was taken away reads as empty and unguarded.
    world.remove(player.entity, StaminaComponent);
    step();
    expect(player.readout()?.combat).toMatchObject({ stamina: 0, blocking: false });
  });
});

describe('the room training dummy as a lock target (mw-e02.31, mw-e02.32)', () => {
  /** The testbed with sword and shield, lock-on (zeroHealth) and the room's training dummy. */
  function room() {
    const combat = prepareTestbedCombat(content);
    const physics = new RapierPhysics(RAPIER);
    const world = registerSceneComponents(new World<ActionFrame>({ seed: 1, physics })).register(
      ...HIT_VOLUME_COMPONENTS,
      ...DAMAGE_COMPONENTS,
      PlacementComponent,
    );
    const sync = new RenderSync(world);
    const loader = new SceneLoader({
      world,
      sync,
      colliders: physics,
      content,
      objects: { staticGeometry: () => ({}), spawn: () => ({}) },
      binding: (object: Box) => binding(object, readSceneTransform),
    });
    const scene = loader.load('testbed');
    const player = setupTestbedPlayer({
      world,
      scene,
      sync,
      tuning,
      cameraTuning,
      collision: new RapierCollisionWorld(physics),
      object: {},
      binding,
      camera: fakeCamera(),
      moves: combat.moves,
      melee: combat.melee,
      lockOn: {
        tuning: content.get('lock-on', PLAYER_LOCK_ON_ID),
        sight: new LineOfSight({ world: new RapierSightWorld(physics) }),
        profile: (id: string) => content.get('targetable', id),
        defeated: zeroHealth,
      },
    });
    const { dummies } = startTestbedCombat(world, combat, scene.layout.spawns, player.entity);
    const [dummy] = dummies;
    if (dummy === undefined) throw new Error('no room dummy');
    const sampler = new ActionSampler();
    const step = (codes: readonly string[] = []) => {
      for (const code of codes) sampler.down(code);
      world.step(sampler.sampleCommands(world.tick));
      for (const code of codes) sampler.up(code);
    };
    for (let i = 0; i < 30; i++) step(); // settle
    return { world, player, dummy, step };
  }

  it('AC-1 (mw-e02.32): Q facing the room dummy locks it, and the marker sits on its chest', ({
    task,
  }) => {
    markExercised(task, 'targetable', 'training-dummy');
    const { player, dummy, step } = room();
    expect(player.readout()?.lock).toBeNull();
    step(['KeyQ']);
    expect(player.readout()?.lock).toBe(dummy);
    // The room dummy stands at the origin; the profile's first lock point is its chest.
    expect(player.lockTarget()).toEqual({ entity: dummy, point: { x: 0, y: 1.3, z: 0 } });
  });

  it('AC-2 (mw-e02.32): when its health reaches 0, the lock releases (no other target within 10 m)', () => {
    const { world, player, dummy, step } = room();
    step(['KeyQ']);
    expect(player.readout()?.lock).toBe(dummy);
    const health = world.get(dummy, HealthComponent);
    if (health === undefined) throw new Error('no health');
    world.set(dummy, HealthComponent, { ...health, current: 0 });
    step();
    expect(player.readout()?.lock).toBeNull();
    expect(player.lockTarget()).toBeUndefined();
  });

  it('AC-1 (mw-e02.31): a swing turns toward the locked dummy at 6° a startup tick, wherever it has gone', () => {
    const { world, player, dummy, step } = room();
    step(['KeyQ']);
    const degrees = () => {
      const f = world.get(player.entity, CombatFacingComponent)?.facing;
      if (f === undefined) throw new Error('no facing');
      return (Math.atan2(f.x, f.z) * 180) / Math.PI; // from +z (the dummy) toward +x
    };
    expect(degrees()).toBeCloseTo(0, 6);
    // Knocked round to the knight's side (+x, 90° from where it faces and looks) as the swing starts.
    const at = world.get(player.entity, PlacementComponent);
    if (at === undefined) throw new Error('no placement');
    placeEntity(world, dummy, { x: at.x + 1, y: 0, z: at.z }, TRAINING_DUMMY.radius);
    step(['Mouse0']);
    expect(player.readout()?.combat?.action).toBe('sword-light-1');
    // The look has not turned yet (lock-on turns it after the facing rule), so this is the lock.
    expect(degrees()).toBeCloseTo(6, 6);
    for (let tick = 1; tick < 12; tick++) step();
    expect(degrees()).toBeCloseTo(72, 6); // end of startup: 12 turns of 6°
    step();
    expect(degrees()).toBeCloseTo(72, 6); // first active tick: locked
  });
});

describe('testbed player wiring (mw-e02.23)', () => {
  it('spawns the player at the testbed player-start, facing +z into the room', () => {
    const { state } = testbed();
    expect(state()).toEqual({
      tick: 0,
      position: { x: 0, y: SKIN, z: -1 },
      grounded: false,
      traversal: null,
      yaw: Math.round(Math.PI * 1e4) / 1e4,
      pitch: Math.round(toRadians(cameraTuning.pitch.initial) * 1e4) / 1e4,
    });
  });

  it('binds the capsule through render sync at the player feet', () => {
    const { capsule, sync, player } = testbed();
    expect(sync.has(player.entity)).toBe(true);
    expect(capsule.transform?.position).toEqual({ x: 0, y: SKIN, z: -1 });
  });

  it('places the orbit camera behind, above and over the shoulder before the first frame', () => {
    const { camera } = testbed();
    // The player faces +z, so behind is −z and its right is −x.
    expect(camera.at.z).toBeLessThan(-1 - 2);
    expect(camera.at.z).toBeGreaterThan(-4.9); // still inside the room
    expect(camera.at.y).toBeGreaterThan(SKIN + cameraTuning.pivotHeight); // looking down on it
    expect(camera.at.x).toBeCloseTo(-cameraTuning.shoulder, 6);
    // It looks along the view direction: pitched down 15°, towards +z.
    const forward = lookForward(Math.PI, toRadians(cameraTuning.pitch.initial));
    expect(camera.target.x - camera.at.x).toBeCloseTo(forward.x, 6);
    expect(camera.target.y - camera.at.y).toBeCloseTo(forward.y, 6);
    expect(camera.target.z - camera.at.z).toBeCloseTo(forward.z, 6);
  });

  it('mw-e02.11: footstep events carry the ground material and the supplied loudness offset', () => {
    const { world, sampler, run } = testbed({
      footstepOffsets: (material) => (material === 'generic' ? 6 : 0),
    });
    const steps: { material?: string; surfaceDb: number }[] = [];
    world.events.on(LocomotionEvents, (e) => {
      if (e.kind === 'footstep') steps.push(e);
    });
    run(0.2);
    sampler.down('KeyW');
    run(1);
    sampler.up('KeyW');
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((s) => s.material !== undefined)).toBe(true);
    const flat = steps.filter((s) => s.material === 'generic');
    expect(flat.every((s) => s.surfaceDb === 6)).toBe(true);
  });

  it('mw-e09.4 AC-1: a carpet region replaces the ground material and muffles the step', () => {
    const table = compileSurfaceTable(content.get('surface-table', SURFACE_TABLE_ID));
    const surfaces = createSurfaceMap({
      table,
      regions: [
        {
          id: 'rug',
          min: { x: -10, y: -1, z: -10 },
          max: { x: 10, y: 1, z: 10 },
          surface: 'carpet',
          priority: 0,
        },
      ],
    });
    const { world, sampler, run } = testbed({ surfaces });
    const steps: { material?: string; surfaceDb: number }[] = [];
    world.events.on(LocomotionEvents, (e) => {
      if (e.kind === 'footstep') steps.push(e);
    });
    run(0.2);
    sampler.down('KeyW');
    run(1);
    sampler.up('KeyW');
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.every((s) => s.material === 'carpet' && s.surfaceDb === -10)).toBe(true);
  });

  it('holding W for 1 s moves the player at least 4 m forward (+z), and the camera follows', () => {
    const { sampler, run, state, camera } = testbed();
    run(0.2);
    const before = state().position;
    sampler.down('KeyW');
    run(1);
    sampler.up('KeyW');
    run(0.3);
    const after = state().position;
    expect(after.z - before.z).toBeGreaterThanOrEqual(4);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-3);
    expect(camera.at.z).toBeLessThan(after.z - 2); // still behind it
  });

  it('the back wall stops the player: it rests in front of it and never passes through', () => {
    const { sampler, run, state } = testbed();
    sampler.down('KeyS'); // back, towards the wall at z = −5 (its face is at −4.9)
    run(2);
    const radius = tuning.capsule.radius;
    expect(state().position.z).toBeGreaterThan(-4.9 + radius - 2 * SKIN);
    expect(state().position.z).toBeLessThan(-4.9 + radius + 0.05);
  });

  it('Space jumps: the player leaves the ground and lands again within 1 s', () => {
    const { sampler, run, state, world } = testbed();
    run(0.2);
    expect(state().grounded).toBe(true);
    sampler.down('Space');
    const pressedAt = world.tick;
    let peak = 0;
    let landedAt: number | undefined;
    for (let i = 0; i < 60 && landedAt === undefined; i++) {
      run(1 / 60);
      if (i === 5) sampler.up('Space');
      peak = Math.max(peak, state().position.y);
      if (state().grounded && peak > 0.5) landedAt = world.tick;
    }
    expect(peak).toBeGreaterThan(1);
    expect(landedAt).toBeDefined();
    expect((landedAt ?? Infinity) - pressedAt).toBeLessThanOrEqual(60);
  });

  it('interpolates the capsule between sim steps', () => {
    const { sampler, run, capsule, state, frames } = testbed();
    sampler.down('KeyW');
    run(0.5); // running at full speed, 5 m/s = 1/12 m per tick
    const latest = state().position.z;
    frames.frame(1000 / 120); // half a step: no sim step, the capsule is drawn halfway back
    const drawn = capsule.transform?.position.z ?? Infinity;
    expect(drawn).toBeLessThan(latest - 0.02);
    expect(drawn).toBeGreaterThan(latest - 1 / 12);
  });

  it('mouse look turns the player and the camera swings behind it', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: Math.PI / 2 / 100 });
    sampler.look(100, 0); // a quarter turn right: now facing −x
    run(0.1);
    expect(state().yaw).toBeCloseTo(Math.PI / 2, 3);
    // Behind a player facing −x is +x.
    expect(camera.at.x).toBeGreaterThan(state().position.x + 3);
  });

  it('leaves the camera alone while the orbit camera is off (debug camera)', () => {
    const { sampler, run, camera, player } = testbed();
    player.drivesCamera = false;
    expect(player.drivesCamera).toBe(false);
    const parked = camera.at;
    sampler.down('KeyW');
    run(0.5);
    expect(camera.at).toBe(parked);
    player.drivesCamera = true;
    run(1 / 60);
    expect(camera.at).not.toBe(parked);
  });

  it('publishes one readout per new sim tick', () => {
    const publish = vi.fn<(readout: PlayerReadout) => void>();
    const { run, player } = testbed({ publish });
    expect(publish).toHaveBeenCalledTimes(1); // at setup
    run(0.5);
    const ticks = publish.mock.calls.map(([readout]) => readout.tick);
    expect(ticks).toEqual([...new Set(ticks)]);
    expect(ticks.at(-1)).toBe(30);
    player.frame(); // no new tick: nothing new
    expect(publish.mock.calls).toHaveLength(ticks.length);
  });

  it('collides against whichever CollisionWorld it is given', () => {
    // A wall 1 m in front of the player that the testbed does not have.
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
      box({ x: -5, y: 0, z: -0.5 }, { x: 5, y: 3, z: 0 }),
    ]);
    const { sampler, run, state } = testbed({ collision });
    sampler.down('KeyW');
    run(1);
    expect(state().position.z).toBeLessThan(-0.5);
  });

  it('dispose removes the player and its capsule, and publishing stops', () => {
    const publish = vi.fn<(readout: PlayerReadout) => void>();
    const { player, capsule, world, sync, run, loop } = testbed({ publish });
    player.dispose();
    expect(capsule.disposed).toBe(true);
    expect(world.isAlive(player.entity)).toBe(false);
    expect(sync.has(player.entity)).toBe(false);
    expect(player.readout()).toBeUndefined();
    run(0.1);
    expect(publish).toHaveBeenCalledTimes(1);
    player.dispose(); // twice is harmless
    loop.stop();
  });
});

describe('testbed orbit camera (mw-e02.4)', () => {
  it('mouse up and down pitch the view within the limits, and the camera follows', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: 0.01 });
    const startY = camera.at.y;
    sampler.look(0, 1000); // mouse down a long way: look down, camera up
    run(0.1);
    expect(state().pitch).toBeCloseTo(toRadians(cameraTuning.pitch.min), 4);
    expect(camera.at.y).toBeGreaterThan(startY);
    sampler.look(0, -1000);
    run(0.1);
    expect(state().pitch).toBeCloseTo(toRadians(cameraTuning.pitch.max), 4);
  });

  it('interpolates the pitch between sim steps', () => {
    const { sampler, run, frames, camera } = testbed({ sensitivity: 0.01 });
    run(0.1);
    const level = camera.at.y;
    sampler.look(0, -20); // mouse up: look up 0.2 rad on the next tick, so the camera drops
    frames.frame(1000 / 60); // the tick runs; drawn at the start of its interval (alpha 0)
    const stepped = camera.at.y;
    frames.frame(1000 / 120); // half a step on: part way there
    const halfway = camera.at.y;
    frames.frame(1000 / 120); // the next tick: all the way
    const final = camera.at.y;
    expect(final).toBeLessThan(level - 0.3);
    expect(halfway).toBeLessThan(level - 0.1);
    expect(halfway).toBeGreaterThan(final + 0.1);
    expect(Math.abs(stepped - level)).toBeLessThan(Math.abs(halfway - level));
  });

  it('AC-4: at camera yaw 90° the player moves along the camera forward vector', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: Math.PI / 2 / 100 });
    sampler.look(-100, 0); // a quarter turn left: from yaw π to 3π/2 ≡ −π/2
    run(1 / 60);
    sampler.look(-200, 0); // half a turn more: yaw π/2
    run(0.2);
    expect(state().yaw).toBeCloseTo(Math.PI / 2, 3);
    const before = state().position;
    sampler.down('KeyW');
    run(0.5);
    const after = state().position;
    const moved = { x: after.x - before.x, z: after.z - before.z };
    // The camera's horizontal forward, from where it is and where it looks.
    const look = { x: camera.target.x - camera.at.x, z: camera.target.z - camera.at.z };
    const length = Math.hypot(look.x, look.z);
    expect(look.x / length).toBeCloseTo(-1, 6);
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(1);
    expect(moved.x / Math.hypot(moved.x, moved.z)).toBeCloseTo(look.x / length, 6);
    expect(moved.z / Math.hypot(moved.x, moved.z)).toBeCloseTo(look.z / length, 6);
  });

  it('publishes the camera every frame it drives; the near plane never clips walking into a wall', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { sampler, run, player } = testbed({ publishCamera });
    sampler.down('KeyS'); // back into the room's back wall: the camera is squeezed against it
    run(2);
    const last = publishCamera.mock.calls.at(-1)?.[0];
    expect(last?.frames).toBe(121); // setup plus 120 frames
    expect(last?.clipped).toBe(0);
    expect(last?.pulledIn).toBeGreaterThan(30);
    expect(last?.boom).toBeLessThan(last?.zoom ?? 0);
    expect(last?.position.z).toBeGreaterThanOrEqual(-4.9 + 0.2);
    player.drivesCamera = false;
    run(0.1);
    expect(publishCamera).toHaveBeenCalledTimes(121);
  });

  it('adds the shake offset after the rig resolved, without moving the published pose or the view', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const calm = testbed({ publishCamera });
    calm.run(0.5);
    const rest = { ...calm.camera.at };
    const restTarget = { ...calm.camera.target };
    const shaken = testbed({ shake: () => ({ x: 0.1, y: 0 }) });
    shaken.run(0.5);
    const moved = Math.hypot(
      shaken.camera.at.x - rest.x,
      shaken.camera.at.y - rest.y,
      shaken.camera.at.z - rest.z,
    );
    expect(moved).toBeCloseTo(0.1, 6);
    // The look direction is unchanged: the target moved by the same offset.
    expect(shaken.camera.target.x - shaken.camera.at.x).toBeCloseTo(restTarget.x - rest.x, 6);
    expect(shaken.camera.target.z - shaken.camera.at.z).toBeCloseTo(restTarget.z - rest.z, 6);
    const probed = testbed({ publishCamera, shake: () => ({ x: 0.1, y: 0.1 }) });
    probed.run(0.5);
    expect(publishCamera.mock.calls.at(-1)?.[0].clipped).toBe(0);
  });

  it('the wheel zooms within 2–6 m', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { run, player } = testbed({ publishCamera });
    const zoom = () => publishCamera.mock.calls.at(-1)?.[0].zoom;
    expect(zoom()).toBe(cameraTuning.distance.initial);
    player.zoom(-1);
    run(1 / 60);
    expect(zoom()).toBe(cameraTuning.distance.initial - cameraTuning.distance.step);
    player.zoom(100);
    run(1 / 60);
    expect(zoom()).toBe(cameraTuning.distance.max);
  });

  it('the death beat pulls the camera back and tilts it down, clamped to 0–1 (mw-e01.8)', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { run, player } = testbed({ publishCamera });
    const last = () => publishCamera.mock.calls.at(-1)?.[0];
    run(0.5);
    const before = last();
    player.pullBack(2);
    run(1);
    const after = last();
    expect(after?.zoom).toBeCloseTo(cameraTuning.distance.initial + DEATH_PULL_BACK.metres, 4);
    expect(after?.position.y ?? 0).toBeGreaterThan(before?.position.y ?? 0);
    player.pullBack(-1);
    run(1 / 60);
    expect(last()?.zoom).toBe(cameraTuning.distance.initial);
  });

  it('the camera never changes the sim: same inputs, same hash, with or without it drawing', () => {
    const drive = (drawCamera: boolean) => {
      const { sampler, run, world, player } = testbed();
      player.drivesCamera = drawCamera;
      sampler.down('KeyS');
      sampler.look(40, 5);
      run(1);
      return hashWorld(world);
    };
    expect(drive(true)).toBe(drive(false));
  });

  it('counts a frame whose near plane the probe finds inside geometry', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    // Everything overlaps: the probe must report every frame as clipped.
    const solid = new FakeCollisionWorld([box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 })]);
    solid.overlapCapsule = () => true;
    const { run } = testbed({ publishCamera, collision: solid });
    run(0.1);
    const last = publishCamera.mock.calls.at(-1)?.[0];
    expect(last?.clipped).toBe(last?.frames);
  });

  it('crouching lowers the orbit pivot', () => {
    const { sampler, run, camera } = testbed();
    run(0.2);
    const standing = camera.at.y;
    sampler.down('KeyC');
    run(0.2);
    expect(camera.at.y).toBeLessThan(standing - 0.3);
  });

  it('frames before any timestamp, or with the clock going back, recover nothing', () => {
    const { player, camera } = testbed();
    player.frame({ alpha: 1, timeMs: 500 });
    player.frame({ alpha: 1, timeMs: 400 });
    player.frame();
    expect(camera.at.z).toBeLessThan(-1);
  });
});

describe('testbed player interaction (mw-e02.5)', () => {
  const pressE = (sampler: ActionSampler, run: (seconds: number) => void) => {
    sampler.down('KeyE');
    run(0.1);
    sampler.up('KeyE');
    run(0.1);
  };

  it('AC-6: facing the testbed lever at spawn, Interact pulls it and the prompt names it', () => {
    const pulled: Interaction[] = [];
    const { player, sampler, run, world } = testbed((physics) => ({
      interaction: {
        sight: new RapierSightWorld(physics),
        bodiesOf: () => [],
        publish: (event) => pulled.push(event),
      },
    }));
    run(0.1);
    expect(player.prompt()).toMatchObject({ verb: 'pull', label: 'Pull lever', available: true });
    pressE(sampler, run);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toMatchObject({ actor: player.entity, verb: 'pull', affordance: 0 });
    expect(world.isAlive(pulled[0]?.target ?? 0)).toBe(true);
    player.dispose();
    expect(player.prompt()).toBeUndefined();
  });

  it('stops publishing once disposed', () => {
    const pulled: Interaction[] = [];
    const rig = testbed({ interaction: { publish: (event) => pulled.push(event) } });
    rig.run(0.1);
    pressE(rig.sampler, rig.run);
    expect(pulled).toHaveLength(1);
    // Other actors' interactions are not the player's.
    rig.world.events.emit(interacted, { actor: 999, target: 1, verb: 'pull', affordance: 0 });
    rig.run(0.05);
    expect(pulled).toHaveLength(1);
    rig.player.dispose();
    pressE(rig.sampler, rig.run);
    expect(pulled).toHaveLength(1);
  });

  it('interacts without publishing when nobody listens', () => {
    const rig = testbed({ interaction: {} });
    rig.run(0.1);
    expect(rig.player.prompt()?.verb).toBe('pull');
    rig.player.dispose();
  });

  it('has no prompt without interaction', () => {
    const { player, run } = testbed();
    run(0.1);
    expect(player.prompt()).toBeUndefined();
  });
});

/** The player's body: the grey-box humanoid graph from content, recording what it is given. */
function animatedBody() {
  const graph = compileGraph(
    content.get('anim-graph', 'greybox-humanoid'),
    content.all('anim-clip'),
  );
  const poses: number[] = [];
  const drops: number[] = [];
  const probes: CharacterProbe[] = [];
  const animation = {
    controller: new AnimationController(graph),
    apply: () => {
      poses.push(1);
    },
    lower: (metres: number) => {
      drops.push(metres);
    },
    publish: (probe: CharacterProbe) => {
      probes.push(probe);
    },
  };
  const last = () => probes.at(-1);
  return { animation, poses, drops, probes, last };
}

describe('testbed player animation (mw-e02.6)', () => {
  const moves = compileMoves(content.all('move'));

  it('AC-4: running then jumping plays the run clip, then jump, fall and land, from sim locomotion', () => {
    const body = animatedBody();
    const { sampler, run, state } = testbed({ animation: body.animation, moves });
    run(0.3);
    expect(body.last()?.layers[0]?.state).toBe('idle');
    sampler.down('KeyW');
    run(0.5);
    expect(body.last()?.layers[0]).toMatchObject({ state: 'move', clip: 'anim-humanoid-run' });
    sampler.down('Space');
    run(0.1);
    sampler.up('Space');
    expect(body.last()?.layers[0]?.state).toBe('jump');
    run(1);
    expect(state().grounded).toBe(true);
    const probe = body.last();
    // (The history spans every layer: the carry layer enters idle and move beside the base layer, so
    // runs of the same name collapse to one.)
    expect((probe?.history ?? []).filter((state, i, all) => state !== all[i - 1])).toEqual([
      'idle',
      'move',
      'jump',
      'fall',
      'land',
      'move',
    ]);
    expect(probe?.clipHistory).toEqual(
      expect.arrayContaining(['anim-humanoid-run', 'anim-humanoid-jump', 'anim-humanoid-fall']),
    );
    expect(body.poses.length).toBeGreaterThan(100);
  });

  it('a dodge plays its move clip on the whole body, then locomotion takes over again', () => {
    const body = animatedBody();
    const { sampler, run } = testbed({ animation: body.animation, moves });
    run(0.2);
    sampler.down('KeyW');
    run(0.2);
    sampler.down('KeyR');
    run(0.1);
    sampler.up('KeyR');
    expect(body.last()?.layers[0]).toMatchObject({
      state: 'dodge',
      clip: 'anim-knight-dodge-roll',
    });
    run(1);
    expect(body.last()?.layers[0]?.state).toBe('move');
  });

  it('crouching lowers the pelvis by CROUCH_DROP once the crouch has faded in; standing, by 0', () => {
    const body = animatedBody();
    const { sampler, run } = testbed({ animation: body.animation, moves });
    run(0.2);
    expect(body.drops.at(-1)).toBe(0);
    sampler.down('KeyC');
    run(0.5);
    expect(body.last()?.layers[0]?.state).toBe('crouch');
    expect(body.drops.at(-1)).toBeCloseTo(CROUCH_DROP, 9);
    sampler.up('KeyC');
    run(0.5);
    expect(body.drops.at(-1)).toBe(0);
  });

  it('animation never changes the sim: same inputs, same hash, with or without a body', () => {
    const play = (animated: boolean) => {
      const { sampler, run, world } = testbed(
        animated ? { animation: animatedBody().animation, moves } : { moves },
      );
      sampler.down('KeyW');
      run(0.4);
      sampler.down('Space');
      run(0.6);
      return hashWorld(world);
    };
    expect(play(true)).toBe(play(false));
  });

  it('works without lower or publish, and stops animating once disposed', () => {
    const graph = compileGraph(
      content.get('anim-graph', 'greybox-humanoid'),
      content.all('anim-clip'),
    );
    const apply = vi.fn();
    const { run, player } = testbed({
      animation: { controller: new AnimationController(graph), apply },
    });
    run(0.1);
    expect(apply).toHaveBeenCalled();
    player.dispose();
    apply.mockClear();
    player.frame({ alpha: 1, timeMs: 10_000 });
    expect(apply).not.toHaveBeenCalled();
  });

  it('a graph without layers is never lowered', () => {
    const graph = compileGraph(
      content.get('anim-graph', 'greybox-humanoid'),
      content.all('anim-clip'),
    );
    const lower = vi.fn();
    const controller = new AnimationController({ ...graph, layers: [] });
    const { run } = testbed({ animation: { controller, apply: () => undefined, lower } });
    run(0.1);
    expect(lower).toHaveBeenCalledWith(0);
  });
});

describe('testbed lock-on (mw-e02.16)', () => {
  /** The testbed with lock-on, the player walked through the corridor into the arena doorway. */
  function inArena(lockOn: Partial<TestbedLockOn> = {}) {
    const rig = testbed((physics) => ({
      lockOn: {
        tuning: content.get('lock-on', PLAYER_LOCK_ON_ID),
        sight: new LineOfSight({ world: new RapierSightWorld(physics) }),
        profile: (id: string) => content.get('targetable', id),
        ...lockOn,
      },
    }));
    const dummy = (id: string) => {
      const found = rig.scene.spawns.find(({ spawn }) => spawn.id === id);
      if (found === undefined) throw new Error(`no ${id}`);
      return found.entity;
    };
    rig.sampler.down('KeyW');
    rig.run(3.3);
    rig.sampler.up('KeyW');
    rig.run(0.3);
    expect(rig.state().position.z).toBeGreaterThan(15);
    return {
      ...rig,
      left: dummy('dummy-left'),
      centre: dummy('dummy-centre'),
      right: dummy('dummy-right'),
    };
  }

  /** The horizontal angle between the camera's view and the direction from it to `point`. */
  const offAxis = (camera: ReturnType<typeof fakeCamera>, point: { x: number; z: number }) => {
    const look = Math.atan2(camera.target.x - camera.at.x, camera.target.z - camera.at.z);
    const to = Math.atan2(point.x - camera.at.x, point.z - camera.at.z);
    return Math.abs(Math.atan2(Math.sin(to - look), Math.cos(to - look)));
  };

  it('Q locks the dummy ahead; the camera frames it; Tab cycles right; Q releases', () => {
    const { sampler, run, state, player, camera, left, centre, right } = inArena();
    expect(state().lock).toBeNull();
    expect(player.lockTarget()).toBeUndefined();
    tap(sampler, run, 'KeyQ');
    expect(state().lock).toBe(centre);
    expect(player.lockTarget()).toEqual({ entity: centre, point: { x: 0, y: 1.3, z: 24 } });
    tap(sampler, run, 'Tab');
    expect(state().lock).toBe(right); // x = −3: the player's right, facing +z
    run(1);
    expect(offAxis(camera, { x: -3, z: 23 })).toBeLessThan(toRadians(10));
    tap(sampler, run, 'Tab');
    expect(state().lock).toBe(left); // wrapped round
    tap(sampler, run, 'KeyQ');
    expect(state().lock).toBeNull();
    expect(player.lockTarget()).toBeUndefined();
  });

  it('the player strafes around the locked dummy with A/D', () => {
    const { sampler, run, state } = inArena();
    tap(sampler, run, 'KeyQ');
    run(0.5);
    const distance = () => Math.hypot(state().position.x, state().position.z - 24);
    const before = distance();
    sampler.down('KeyD');
    run(1);
    sampler.up('KeyD');
    expect(Math.abs(distance() - before) / before).toBeLessThan(0.05);
    expect(state().position.x).toBeLessThan(-2); // moved round to the player's right
  });

  it('passes a custom locator and defeated check through to the sim', () => {
    const defeated = new Set<number>();
    const { sampler, run, state, centre } = inArena({
      locate: sceneTargetPosition,
      defeated: (_world, id) => defeated.has(id),
    });
    defeated.add(centre);
    tap(sampler, run, 'KeyQ');
    // The centre dummy is ahead but defeated, so the lock goes to another one.
    expect(state().lock).not.toBe(centre);
    expect(state().lock).not.toBeNull();
  });

  it('a debug-camera round trip cuts straight back to the framing', () => {
    const { sampler, run, player, camera } = inArena();
    tap(sampler, run, 'KeyQ');
    tap(sampler, run, 'Tab');
    player.drivesCamera = false;
    run(0.1);
    player.drivesCamera = true;
    run(1 / 60);
    expect(offAxis(camera, { x: -3, z: 23 })).toBeLessThan(toRadians(10));
  });
});

describe('yaw helpers', () => {
  it('round-trips a yaw through its rotation', () => {
    for (const yaw of [0, 1, -2.5, Math.PI - 1e-9])
      expect(yawOf(yawRotation(yaw))).toBeCloseTo(yaw, 9);
  });
});

describe('readPlayerTransform', () => {
  it('is undefined for a character that is not the player', () => {
    const world = new World({ seed: 1 }).register(CharacterController, PlayerLook);
    const npc = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    expect(readPlayerTransform(world, npc)).toBeUndefined();
  });
});

describe('testbed player mantling (mw-e02.12)', () => {
  /** Holds `key` until `done` (at most `seconds`), a frame at a time. */
  function holdUntil(
    rig: ReturnType<typeof testbed>,
    key: string,
    done: (readout: PlayerReadout) => boolean,
    seconds = 3,
  ) {
    rig.sampler.down(key);
    for (let i = 0; i < seconds * 60 && !done(rig.state()); i++) rig.run(1 / 60);
    rig.sampler.up(key);
  }

  it('AC-1: walking into the testbed’s crates climbs them, crate then stack, playing the mantle clip', () => {
    const body = animatedBody();
    const rig = testbed({ animation: body.animation, ledges: {} });
    rig.run(0.2);
    // Back from the spawn to the crates’ row (z = −3.5), then sideways (−x) into them.
    holdUntil(rig, 'KeyS', (r) => r.position.z <= -3.5);
    holdUntil(rig, 'KeyD', (r) => r.position.y > 2, 4);
    rig.run(0.5);
    expect(rig.state().grounded).toBe(true);
    expect(rig.state().position.y).toBeCloseTo(2 + SKIN, 3);
    const history = body.last()?.history ?? [];
    expect(history.filter((state) => state === 'mantle')).toHaveLength(2);
    expect(body.last()?.clipHistory).toContain('anim-humanoid-mantle');
  });

  it('with the ledge-hang capability, crouch-walking off the stack hangs from it (the hang clip)', () => {
    const body = animatedBody();
    const rig = testbed({
      animation: body.animation,
      ledges: { capabilities: [LEDGE_HANG_CAPABILITY] },
    });
    rig.run(0.2);
    holdUntil(rig, 'KeyS', (r) => r.position.z <= -3.5);
    holdUntil(rig, 'KeyD', (r) => r.position.y > 2, 4);
    rig.run(0.5);
    // Back off the stack's far (−z) edge, crouched: the gap to the room's back wall fits a hang.
    rig.sampler.down('KeyC');
    holdUntil(rig, 'KeyS', (r) => !r.grounded);
    rig.sampler.up('KeyC');
    rig.run(1);
    const readout = rig.state();
    expect(readout.grounded).toBe(false);
    expect(readout.position.y).toBeCloseTo(0, 1);
    expect(body.last()?.layers[0]?.state).toBe('hang');
    expect(rig.world.get(rig.player.entity, CharacterController)?.traversal).toBe('hang');
  });
});

describe('testbed player climbing (mw-e02.13)', () => {
  /** Holds `key` until `done` (or `seconds` run out). */
  function holdUntil(
    rig: ReturnType<typeof testbed>,
    key: string,
    done: (readout: PlayerReadout) => boolean,
    seconds = 3,
  ) {
    rig.sampler.down(key);
    for (let i = 0; i < seconds * 60 && !done(rig.state()); i++) rig.run(1 / 60);
    rig.sampler.up(key);
  }

  it('AC-6: walking into the testbed’s ivy wall climbs it and pulls up onto the platform on top', ({
    task,
  }) => {
    markExercised(task, 'material', 'ivy');
    const rig = testbed({ ledges: {}, climb: {} });
    rig.run(0.2);
    // Sideways (−x) from the spawn to the ivy's line, then forward (+z) into it.
    holdUntil(rig, 'KeyD', (r) => r.position.x <= -3.3);
    rig.run(0.3);
    const modes: (string | null)[] = [];
    holdUntil(
      rig,
      'KeyW',
      (r) => {
        if (modes.at(-1) !== r.traversal) modes.push(r.traversal);
        return r.traversal === null && r.grounded && r.position.y > 2.9;
      },
      6,
    );
    expect(modes).toEqual([null, 'climb', 'mantle', null]);
    const top = rig.state();
    expect(top.position.y).toBeCloseTo(3 + SKIN, 3);
    expect(top.position.z).toBeGreaterThan(3.9);
  });

  it('without climbing a walk into the ivy wall just stops at it', () => {
    const rig = testbed({ ledges: {} });
    rig.run(0.2);
    holdUntil(rig, 'KeyD', (r) => r.position.x <= -3.3);
    holdUntil(rig, 'KeyW', () => false, 2);
    expect(rig.state().traversal).toBeNull();
    expect(rig.state().position.y).toBeCloseTo(SKIN, 3);
    expect(rig.state().position.z).toBeLessThan(3.9);
  });
});

describe('testbed player with a bow (mw-e05.21)', () => {
  const combat = prepareTestbedCombat(content);
  const { aim } = combat.bow;

  it("AC-2: drawing eases the camera's FOV from 70° toward the bow's aim.fov, two thirds in aim.time, and back after release", () => {
    const camera = { ...fakeCamera(), rebuilt: 0 };
    const withRebuild = Object.assign(camera, {
      updateProjectionMatrix() {
        camera.rebuilt += 1;
      },
    });
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { sampler, run, state } = testbed({
      moves: combat.moves,
      bow: combat.bow,
      camera: withRebuild,
      publishCamera,
    });
    const fov = () => publishCamera.mock.calls.at(-1)?.[0].fov;
    run(0.5);
    expect(state().bow).toEqual({
      equipped: false,
      selected: 'standard',
      draw: null,
      quiver: { standard: 20, broadhead: 10, blunt: 10 },
    });
    expect(fov()).toBe(70);
    tap(sampler, run, 'Digit4'); // the bow comes out: no draw, no zoom
    expect(state().bow?.equipped).toBe(true);
    expect(fov()).toBe(70);
    expect(camera.rebuilt).toBe(0);
    sampler.down('Mouse0');
    run(aim.time);
    const covered = (70 - (fov() ?? 70)) / (70 - aim.fov);
    expect(covered).toBeGreaterThan(0.55);
    expect(covered).toBeLessThan(0.75);
    expect(state().bow?.draw).toBeGreaterThan(0);
    expect(state().bow?.quiver['standard']).toBe(19); // nocked
    run(1);
    expect(fov()).toBe(aim.fov);
    expect(camera.fov).toBe(aim.fov);
    expect(camera.rebuilt).toBeGreaterThan(0);
    // Put away mid-draw (the arrow goes back): the lens widens back to the camera's own.
    tap(sampler, run, 'Digit4');
    sampler.up('Mouse0');
    expect(state().bow).toMatchObject({ equipped: false, draw: null });
    expect(state().bow?.quiver['standard']).toBe(20);
    run(aim.time - 2 / 60);
    const back = ((fov() ?? 0) - aim.fov) / (70 - aim.fov);
    expect(back).toBeGreaterThan(0.55);
    expect(back).toBeLessThan(0.8);
    run(1);
    expect(fov()).toBe(70);
    const settled = camera.rebuilt;
    run(0.5);
    expect(camera.rebuilt).toBe(settled); // a settled lens is not rebuilt every frame
  });

  it('works with a camera that needs no projection rebuild, and reads a bow taken away as none', () => {
    const { sampler, run, state, camera, world, player } = testbed({
      moves: combat.moves,
      bow: combat.bow,
    });
    tap(sampler, run, 'Digit4');
    sampler.down('Mouse0');
    run(0.5);
    expect(camera.fov).toBeLessThan(70);
    world.remove(player.entity, BowComponent);
    world.remove(player.entity, QuiverComponent);
    run(1 / 60);
    expect(state().bow).toEqual({ equipped: false, selected: '', draw: null, quiver: {} });
  });

  it('a bow without moves gives the player nothing', () => {
    const { run, state } = testbed({ bow: combat.bow });
    run(0.1);
    expect(state().bow).toBeUndefined();
    expect(state().combat).toBeUndefined();
  });
});

describe('testbed player in water (mw-e02.14)', () => {
  it('publishes the breath and whether the player is in water, once the scene has water rules', () => {
    const rig = testbed({ water: {} });
    rig.run(0.5);
    expect(rig.state().water).toEqual({ inWater: false, sinking: false, breath: 1 });
    expect(rig.state().traversal).toBeNull();
  });

  it('reads the breath on the sim defaults when the profile has no water block', () => {
    const { water, ...bare } = tuning;
    expect(water).toBeDefined();
    const rig = testbed({ water: {}, tuning: bare });
    rig.run(0.5);
    expect(rig.state().water?.breath).toBe(1);
  });

  it('publishes no water without the rules', () => {
    const rig = testbed();
    rig.run(0.1);
    expect(rig.state().water).toBeUndefined();
  });
});
