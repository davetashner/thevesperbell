// Wading, swimming and sinking (mw-e02.14): water volumes, the traversal hook, breath and drowning.
import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import type { EntityId } from '../core/component';
import { handsBusy } from '../combat/timeline/timeline';
import { StaminaComponent } from '../combat/stamina';
import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import type { LoadClass } from '../inventory/equipment';
import { installPlayer } from '../player/player';
import { readProperty, registerWorldProperties } from '../properties/components';
import { layoutScene } from '../scene/layout';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { hashWorld } from '../snapshot';
import type { Vec3 } from '../stimulus/shapes';
import { SimClock } from '../clock';
import {
  controllerParams,
  initialCharacterState,
  SKIN,
  stepCharacter,
  type CharacterInput,
} from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box, rampAt, type GreyboxShape } from './greybox';
import { CharacterLocomotion, LocomotionEvents } from './locomotion';
import { CharacterController, characterControllerSystem, spawnCharacter } from './system';
import {
  breathFraction,
  CharacterBreath,
  DEFAULT_WATER_TUNING,
  Drowning,
  giveBreath,
  horizontalSpeed,
  Sinking,
  waterAt,
  waterDepthAt,
  WaterEntered,
  WaterExited,
  waterMode,
  waterSystem,
  waterTraversal,
  waterVolumes,
  type WaterVolume,
} from './water';

const HZ = 60;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

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
  water: DEFAULT_WATER_TUNING,
};

/** A held input: forward (+z with the camera at yaw π) and the buttons. */
function input(
  hold: { move?: [number, number]; jump?: boolean; sprint?: boolean; crouch?: boolean } = {},
): CharacterInput {
  const { move = [0, 0], jump = false, sprint = false, crouch = false } = hold;
  return {
    actions: {
      move: { x: move[0], y: move[1] },
      jump: { pressed: jump, held: jump },
      sprint: { pressed: false, held: sprint },
      crouch: { pressed: false, held: crouch },
    },
    cameraYaw: Math.PI,
  };
}
const FORWARD = input({ move: [0, 1] });

interface RigOptions {
  readonly shapes: readonly GreyboxShape[];
  readonly volumes: readonly WaterVolume[];
  readonly feet: Vec3;
  readonly load?: LoadClass;
  readonly tuning?: Frozen<ControllerTuning>;
  readonly properties?: boolean;
  /** Leave the load-class reader out (a character with no equipment). */
  readonly unequipped?: boolean;
}

/** A character, the water hook and the water system over a fake collision world. */
function rig({ shapes, volumes, feet, load, tuning = TUNING, properties, unequipped }: RigOptions) {
  const world = new World<CharacterInput>({ seed: 1, hz: HZ });
  if (properties === true) registerWorldProperties(world);
  world.register(CharacterController, CharacterBreath);
  const entity = spawnCharacter(world, feet);
  giveBreath(world, entity, DEFAULT_WATER_TUNING, HZ);
  const loadClass = () => load;
  const drained: number[] = [];
  const drowned: number[] = [];
  world.addSystem(
    characterControllerSystem<CharacterInput>({
      collision: new FakeCollisionWorld(shapes),
      tuning,
      hooks: [waterTraversal({ volumes, loadClass })],
      input: (inputs) => inputs[0],
    }),
  );
  world.addSystem(
    waterSystem<CharacterInput>({
      volumes,
      tuning,
      ...(unequipped !== true && { loadClass }),
      drain: (_, amount) => drained.push(amount),
      onDrown: (_, amount) => drowned.push(amount),
    }),
  );
  const drownTicks: number[] = [];
  const sunk: number[] = [];
  const entered: number[] = [];
  const exited: number[] = [];
  world.events.on(Drowning, (e) => drownTicks.push(e.tick));
  world.events.on(Sinking, (e) => sunk.push(e.tick));
  world.events.on(WaterEntered, (e) => entered.push(e.tick));
  world.events.on(WaterExited, (e) => exited.push(e.tick));
  const state = () => {
    const s = world.get(entity, CharacterController);
    if (s === undefined) throw new Error('no character');
    return s;
  };
  const breath = () => {
    const b = world.get(entity, CharacterBreath);
    if (b === undefined) throw new Error('no breath');
    return b;
  };
  const run = (seconds: number, held: CharacterInput = IDLE): void => {
    for (let i = 0; i < Math.round(seconds * HZ); i++) world.step([held]);
  };
  return { world, entity, state, breath, run, drained, drowned, drownTicks, sunk, entered, exited };
}
const IDLE = input();
/** Only heavy and overloaded loads sink: a medium load swims (slowly). */
const MEDIUM_SWIMS: Frozen<ControllerTuning> = {
  ...TUNING,
  water: { ...DEFAULT_WATER_TUNING, sinkFromLoadClass: 'heavy' },
};

/** A flat floor with its top at `top`, 100 m square. */
const floorAt = (top: number): GreyboxShape => box(v(-50, top - 1, -50), v(50, top, 50));
/** Water over the whole floor, `surface` high. */
const pool = (surface: number, id = 'pool'): WaterVolume => ({
  id,
  min: v(-50, -10, -50),
  max: v(50, surface, 50),
});

describe('water volumes', () => {
  const volumes = waterVolumes([
    { id: 'river', min: v(0, -6, 0), max: v(10, -2, 10), tags: ['water', 'river'] },
    { id: 'garden', min: v(0, 0, 0), max: v(10, 1, 10), tags: ['garden'] },
    { id: 'deep', min: v(0, -8, 0), max: v(5, 0, 5), tags: ['water'] },
  ]);

  it('keeps the regions tagged water, in scene order', () => {
    expect(volumes.map((w) => w.id)).toEqual(['river', 'deep']);
  });

  it('finds the volume holding a point, preferring the higher surface', () => {
    expect(waterAt(volumes, v(8, -3, 8))?.id).toBe('river');
    expect(waterAt(volumes, v(2, -3, 2))?.id).toBe('deep');
    // Whatever the order, the higher surface wins.
    expect(waterAt([...volumes].reverse(), v(2, -3, 2))?.id).toBe('deep');
    expect(waterAt(volumes, v(2, -1, 2))?.id).toBe('deep');
    expect(waterAt(volumes, v(8, -1, 8))).toBeUndefined();
    expect(waterAt(volumes, v(8, -7, 8))).toBeUndefined();
    expect(waterAt(volumes, v(11, -3, 5))).toBeUndefined();
    expect(waterAt(volumes, v(5, -3, 11))).toBeUndefined();
    expect(waterAt(volumes, v(-1, -3, 5))).toBeUndefined();
    expect(waterAt(volumes, v(5, -3, -1))).toBeUndefined();
  });

  it('measures depth from the surface to the feet, 0 outside water', () => {
    expect(waterDepthAt(volumes, v(8, -3, 8))).toBe(1);
    expect(waterDepthAt(volumes, v(8, 5, 8))).toBe(0);
  });

  it('picks the mode by depth and armor load', () => {
    const w = DEFAULT_WATER_TUNING;
    expect(waterMode(0.49, 'light', w)).toBe('dry');
    expect(waterMode(0.5, 'heavy', w)).toBe('wade');
    expect(waterMode(1.2, 'overloaded', w)).toBe('wade');
    expect(waterMode(1.21, 'light', w)).toBe('swim');
    expect(waterMode(1.21, 'medium', w)).toBe('sink');
    // The threshold is data: raised to heavy, a medium load swims again.
    expect(waterMode(1.21, 'medium', { ...w, sinkFromLoadClass: 'heavy' })).toBe('swim');
    expect(waterMode(1.21, 'heavy', { ...w, sinkFromLoadClass: 'heavy' })).toBe('sink');
    expect(waterMode(1.21, undefined, w)).toBe('swim');
    expect(waterMode(1.21, 'heavy', w)).toBe('sink');
    expect(waterMode(1.21, 'overloaded', w)).toBe('sink');
  });
});

describe('wading (mw-e02.14)', () => {
  it('AC-1: at depth 0.9 m the character wades at 60% of the run speed, with no sprint', () => {
    const r = rig({ shapes: [floorAt(0)], volumes: [pool(0.9)], feet: v(0, SKIN, 0) });
    r.run(2, FORWARD);
    expect(horizontalSpeed(r.state())).toBeCloseTo(3, 6);
    expect(r.state().traversal).toBeNull();
    expect(r.state().grounded).toBe(true);
    r.run(1, input({ move: [0, 1], sprint: true }));
    expect(horizontalSpeed(r.state())).toBeCloseTo(3, 6);
    expect(r.entered).toHaveLength(1);
  });

  it('walks at full speed in water shallower than 0.5 m', () => {
    const r = rig({ shapes: [floorAt(0)], volumes: [pool(0.3)], feet: v(0, SKIN, 0) });
    r.run(1, FORWARD);
    expect(horizontalSpeed(r.state())).toBeCloseTo(5, 6);
    expect(r.entered).toHaveLength(0);
  });

  it('uses the defaults when the profile has no water block', () => {
    const { water, ...bare } = TUNING;
    expect(water).toBeDefined();
    const r = rig({
      shapes: [floorAt(0)],
      volumes: [pool(0.9)],
      feet: v(0, SKIN, 0),
      tuning: bare,
    });
    r.run(1.5, FORWARD);
    expect(horizontalSpeed(r.state())).toBeCloseTo(3, 6);
  });

  it('keeps combat available: a wade is no traversal mode', () => {
    const r = rig({ shapes: [floorAt(0)], volumes: [pool(0.9)], feet: v(0, SKIN, 0) });
    r.run(1, FORWARD);
    expect(handsBusy(r.world, r.entity)).toBe(false);
  });
});

describe('swimming (mw-e02.14)', () => {
  const basin = (load?: LoadClass, tuning = TUNING) =>
    rig({
      tuning,
      shapes: [floorAt(-1.5)],
      volumes: [pool(0)],
      feet: v(0, -1.5 + SKIN, 0),
      ...(load !== undefined && { load }),
    });

  it('AC-2: at depth 1.5 m the character swims, floating with its head above the surface', () => {
    const r = basin();
    r.run(2);
    const s = r.state();
    expect(s.traversal).toBe('swim');
    expect(s.swim).toEqual({ surface: 0, sinking: false, diving: false });
    expect(s.position.y).toBeCloseTo(-1.3, 6);
    expect(r.breath().air).toBe(20 * HZ);
    expect(handsBusy(r.world, r.entity)).toBe(true);
    expect(r.sunk).toHaveLength(0);
  });

  it('AC-2: breath depletes over 20 s underwater, then a drowning event fires each second', () => {
    const r = basin();
    r.run(19.9, input({ crouch: true }));
    expect(r.state().swim?.diving).toBe(true);
    expect(r.breath().air).toBeGreaterThan(0);
    expect(breathFraction(r.breath(), DEFAULT_WATER_TUNING, HZ)).toBeCloseTo(0.005, 3);
    expect(r.drownTicks).toEqual([]);
    r.run(0.1, input({ crouch: true }));
    expect(r.breath().air).toBe(0);
    expect(r.drownTicks).toEqual([]);
    r.run(3.05, input({ crouch: true }));
    // 1, 2 and 3 s after the breath ran out (tick 1200).
    const [first = 0] = r.drownTicks;
    expect(first).toBeGreaterThanOrEqual(1255);
    expect(first).toBeLessThanOrEqual(1262);
    expect(r.drownTicks).toEqual([first, first + HZ, first + 2 * HZ]);
    expect(r.drowned).toEqual([10, 10, 10]);
  });

  it('refills the breath over 2 s once back at the surface, and stops drowning', () => {
    const r = basin();
    r.run(21, input({ crouch: true }));
    expect(r.drownTicks.length).toBeGreaterThan(0);
    const events = r.drownTicks.length;
    r.run(2.1, IDLE);
    expect(r.breath().air).toBe(20 * HZ);
    expect(r.breath().drowning).toBe(0);
    r.run(2, IDLE);
    expect(r.drownTicks).toHaveLength(events);
  });

  it('swims at 3.0 m/s with a light load and 2.0 m/s with a medium one', () => {
    const light = basin('light');
    light.run(3, FORWARD);
    expect(horizontalSpeed(light.state())).toBeCloseTo(3, 6);
    const medium = basin('medium', MEDIUM_SWIMS);
    medium.run(3, FORWARD);
    expect(horizontalSpeed(medium.state())).toBeCloseTo(2, 6);
    expect(medium.state().position.z).toBeLessThan(light.state().position.z);
  });

  it('drains stamina while swimming: 1/s light, 4/s medium, none for a sinker', () => {
    const total = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
    const light = basin('light');
    light.run(2, FORWARD);
    expect(total(light.drained)).toBeCloseTo(2, 6);
    const medium = basin('medium', MEDIUM_SWIMS);
    medium.run(2, FORWARD);
    expect(total(medium.drained)).toBeCloseTo(8, 6);
    const none = rig({ shapes: [floorAt(-4)], volumes: [pool(0)], feet: v(0, -3.9, 0) });
    none.run(1);
    const heavy = rig({
      shapes: [floorAt(-4)],
      volumes: [pool(0)],
      feet: v(0, -3.9, 0),
      load: 'heavy',
    });
    heavy.run(3);
    expect(heavy.drained).toEqual([]);
  });

  it('needs no stamina pool or damage hook to swim and drown', () => {
    const free: Frozen<ControllerTuning> = {
      ...TUNING,
      water: { ...DEFAULT_WATER_TUNING, staminaPerSecond: { light: 0, medium: 0 } },
    };
    for (const [tuning, drain] of [
      [TUNING, undefined],
      [free, () => 0 / 0],
    ] as const) {
      const world = new World<CharacterInput>({ seed: 1, hz: HZ });
      world.register(CharacterController, CharacterBreath);
      const entity = spawnCharacter(world, v(0, -1.5 + SKIN, 0));
      giveBreath(world, entity, DEFAULT_WATER_TUNING, HZ);
      const volumes = [pool(0)];
      world.addSystem(
        characterControllerSystem<CharacterInput>({
          collision: new FakeCollisionWorld([floorAt(-1.5)]),
          tuning,
          hooks: [waterTraversal({ volumes })],
          input: (inputs) => inputs[0],
        }),
      );
      world.addSystem(
        waterSystem<CharacterInput>({ volumes, tuning, ...(drain !== undefined && { drain }) }),
      );
      for (let i = 0; i < 25 * HZ; i++) world.step([input({ crouch: true })]);
      expect(world.get(entity, CharacterBreath)?.air).toBe(0);
    }
  });

  it('floats back up when the crouch is let go, and dives while it is held', () => {
    const r = rig({ shapes: [floorAt(-5)], volumes: [pool(0)], feet: v(0, -1.3, 0) });
    r.run(2, input({ crouch: true }));
    expect(r.state().position.y).toBeLessThan(-3.5);
    r.run(4, IDLE);
    expect(r.state().position.y).toBeCloseTo(-1.3, 6);
  });

  it('slides along a wall instead of passing through it', () => {
    const wall = box(v(-5, -1.5, 3), v(5, 2, 4));
    const r = rig({
      shapes: [floorAt(-1.5), wall],
      volumes: [pool(0)],
      feet: v(0, -1.5 + SKIN, 0),
    });
    r.run(4, input({ move: [0.3, 1] }));
    expect(r.state().position.z).toBeLessThan(3);
    expect(r.state().position.x).toBeLessThan(-0.5);
  });

  it('wades again where the bottom comes up to wading depth, and walks out', () => {
    // A bottom rising from 4 m deep to the surface along +z.
    const slope = rampAt(v(0, -4, 0), 10, 4, 100);
    const r = rig({
      shapes: [floorAt(-4), { ...slope, rises: '+x' }],
      volumes: [pool(0)],
      feet: v(0, -4 + SKIN, 0),
    });
    r.run(1);
    expect(r.state().traversal).toBe('swim');
    const shallow = rig({
      shapes: [floorAt(-1)],
      volumes: [pool(0)],
      feet: v(0, -1 + SKIN, 0),
    });
    shallow.run(1);
    expect(shallow.state().traversal).toBeNull();
    expect(shallow.state().swim).toBeUndefined();
    expect(shallow.state().grounded).toBe(true);
  });

  it('leaves the water when it swims out of the volume', () => {
    const r = rig({
      shapes: [floorAt(-1.5)],
      volumes: [{ id: 'pond', min: v(-50, -5, -50), max: v(50, 0, 2) }],
      feet: v(0, -1.5 + SKIN, 0),
    });
    r.run(4, FORWARD);
    expect(r.state().position.z).toBeGreaterThan(2);
    expect(r.state().traversal).toBeNull();
    expect(r.exited).toHaveLength(1);
  });
});

describe('sinking under armor (mw-e02.14)', () => {
  const sinker = (load: LoadClass, depth = 4) =>
    rig({
      shapes: [floorAt(-depth)],
      volumes: [pool(0)],
      feet: v(0, -0.2, 0),
      load,
    });

  it('a heavy load sinks at the sinking speed to the bottom and stays there', () => {
    const r = sinker('heavy');
    let fastest = 0;
    for (let i = 0; i < 6 * HZ; i++) {
      r.world.step([IDLE]);
      if (r.state().swim !== undefined) fastest = Math.max(fastest, -r.state().velocity.y);
    }
    expect(fastest).toBeLessThanOrEqual(2 + 1e-9);
    const s = r.state();
    expect(s.traversal).toBe('swim');
    expect(s.swim).toEqual({ surface: 0, sinking: true, diving: false });
    expect(s.grounded).toBe(true);
    expect(s.position.y).toBeCloseTo(-4 + SKIN, 3);
    expect(r.sunk).toHaveLength(1);
    expect(handsBusy(r.world, r.entity)).toBe(true);
  });

  it('cannot swim up: jumping, diving and holding crouch leave it on the bottom', () => {
    const r = sinker('overloaded');
    r.run(4, IDLE);
    const bottom = r.state().position.y;
    r.run(2, input({ jump: true }));
    expect(r.state().position.y).toBeCloseTo(bottom, 6);
    r.run(2, input({ jump: true, move: [0, 1] }));
    expect(r.state().position.y).toBeCloseTo(bottom, 6);
    expect(r.state().grounded).toBe(true);
  });

  it('walks the bottom at 40% of the run speed, with no sprint', () => {
    const r = sinker('heavy');
    r.run(4, input({ move: [0, 1], sprint: true }));
    expect(horizontalSpeed(r.state())).toBeCloseTo(2, 6);
  });

  it('runs out of breath underwater and starts to drown after 20 s', () => {
    const r = sinker('heavy');
    r.run(19, IDLE);
    expect(r.breath().air).toBeGreaterThan(0);
    r.run(3.1, IDLE);
    expect(r.breath().air).toBe(0);
    expect(r.drownTicks.length).toBeGreaterThanOrEqual(1);
  });

  it('does not run short of breath on a bottom 1.5 m down: the head stays dry', () => {
    const r = sinker('heavy', 1.5);
    r.run(30, IDLE);
    expect(r.state().swim?.sinking).toBe(true);
    expect(r.breath().air).toBe(20 * HZ);
    expect(r.drownTicks).toEqual([]);
  });

  it('floats up once the armor comes off (the load class is read every tick)', () => {
    let load: LoadClass = 'heavy';
    const world = new World<CharacterInput>({ seed: 1, hz: HZ });
    world.register(CharacterController, CharacterBreath);
    const entity = spawnCharacter(world, v(0, -3.9, 0));
    const volumes = [pool(0)];
    world.addSystem(
      characterControllerSystem<CharacterInput>({
        collision: new FakeCollisionWorld([floorAt(-4)]),
        tuning: TUNING,
        hooks: [waterTraversal({ volumes, loadClass: () => load })],
        input: (inputs) => inputs[0],
      }),
    );
    for (let i = 0; i < 2 * HZ; i++) world.step([IDLE]);
    expect(world.get(entity, CharacterController)?.swim?.sinking).toBe(true);
    load = 'light';
    for (let i = 0; i < 4 * HZ; i++) world.step([IDLE]);
    const s = world.get(entity, CharacterController);
    expect(s?.swim?.sinking).toBe(false);
    expect(s?.position.y).toBeCloseTo(-1.3, 6);
  });

  it('a character without equipment counts as light', () => {
    const r = rig({
      shapes: [floorAt(-4)],
      volumes: [pool(0)],
      feet: v(0, -0.2, 0),
      unequipped: true,
    });
    r.run(3, IDLE);
    expect(r.state().swim?.sinking).toBe(false);
    expect(r.drained.length).toBeGreaterThan(0);
  });

  it('a controller run without an entity cannot know the load, and swims', () => {
    const world = new FakeCollisionWorld([floorAt(-4)]);
    const hook = waterTraversal({ volumes: [pool(0)], loadClass: () => 'heavy' });
    let state = initialCharacterState(v(0, -1.6, 0));
    const params = controllerParams(TUNING, new SimClock(HZ));
    for (let i = 0; i < HZ; i++) {
      state = stepCharacter(state, IDLE, { world, tuning: TUNING, params, hooks: [hook] });
    }
    expect(state.swim?.sinking).toBe(false);
    expect(state.traversal).toBe('swim');
  });

  it('is saved and replayed bit for bit', () => {
    const run = () => {
      const r = sinker('heavy');
      r.run(3, input({ move: [0, 1] }));
      r.run(3, input({ move: [0.5, 0.5], jump: true }));
      const s = rig({ shapes: [floorAt(-4)], volumes: [pool(0)], feet: v(0, -0.2, 0) });
      s.run(3, input({ move: [0, 1] }));
      s.run(3, input({ move: [0.5, 0.5], crouch: true }));
      return [hashWorld(r.world), hashWorld(s.world)];
    };
    expect(run()).toEqual(run());
  });
});

describe('wetness (mw-e02.14 AC-6)', () => {
  it('AC-6: leaving the water leaves the character wet (wetness 1)', () => {
    const r = rig({
      shapes: [floorAt(0)],
      volumes: [{ id: 'stream', min: v(-50, -5, 3), max: v(50, 0.9, 8) }],
      feet: v(0, SKIN, 0),
      properties: true,
    });
    r.run(0.5, FORWARD);
    expect(readProperty(r.world, r.entity, 'wetness')).toBe(0);
    r.run(1, FORWARD);
    expect(r.entered).toHaveLength(1);
    expect(readProperty(r.world, r.entity, 'wetness')).toBe(1);
    r.run(1.5, FORWARD);
    expect(r.state().position.z).toBeGreaterThan(8);
    expect(r.exited).toHaveLength(1);
    expect(readProperty(r.world, r.entity, 'wetness')).toBe(1);
  });

  it('works in a world without world properties', () => {
    const r = rig({ shapes: [floorAt(0)], volumes: [pool(0.9)], feet: v(0, SKIN, 0) });
    r.run(1, FORWARD);
    expect(r.state().position.z).toBeGreaterThan(0);
  });
});

describe('the player in water (mw-e02.14)', () => {
  const START = (() => {
    const [first] = layoutScene(TEST_SCENE, testKit).spawns;
    if (first === undefined) throw new Error('the test scene has no spawn');
    return first;
  })();
  const press = (...buttons: ButtonAction[]): ActionFrame =>
    actionFrame({
      move: actionVector(0, 1),
      look: actionVector(0, 0),
      buttons: (b) => actionButton(false, buttons.includes(b), false),
    });

  function player(
    options: { combat?: true; load?: LoadClass; tuning?: Frozen<ControllerTuning> } = {},
  ) {
    const world = new World<ActionFrame>({ seed: 2, hz: HZ });
    registerWorldProperties(world);
    const drowned: number[] = [];
    const entity = installPlayer(world, {
      spawns: [{ ...START, tags: ['player-start'], position: v(0, 0, 0), yaw: 0 }],
      collision: new FakeCollisionWorld([floorAt(0)]),
      tuning: options.tuning ?? TUNING,
      ...(options.combat === true && { combat: { moves: new Map() } }),
      water: {
        volumes: [{ id: 'ford', min: v(-50, -5, 4), max: v(50, 0.9, 40) }],
        ...(options.load !== undefined && { loadClass: () => options.load }),
        onDrown: (_, amount) => drowned.push(amount),
      },
    });
    const steps: { material: string | undefined; wet: boolean }[] = [];
    world.events.on(LocomotionEvents, (e) => {
      if (e.kind === 'footstep') steps.push({ material: e.material, wet: e.wet });
    });
    return { world, entity, steps, drowned };
  }

  it('AC-1: wading footsteps report the material water (and wet); dry ones carry the ground’s', () => {
    const p = player();
    for (let i = 0; i < HZ; i++) p.world.step([press()]);
    const dry = p.steps.length;
    expect(dry).toBeGreaterThan(0);
    expect(p.steps.every((s) => s.material === 'generic' && !s.wet)).toBe(true);
    for (let i = 0; i < 3 * HZ; i++) p.world.step([press()]);
    const wading = p.steps.slice(dry);
    expect(wading.length).toBeGreaterThan(2);
    expect(wading.every((s) => s.material === 'water' && s.wet)).toBe(true);
    expect(p.world.get(p.entity, CharacterLocomotion)?.state).toBe('run');
  });

  it('wades on the sim defaults when the profile has no water block', () => {
    const { water: _unused, ...bare } = TUNING;
    expect(_unused).toBeDefined();
    const p = player({ tuning: bare });
    expect(p.world.get(p.entity, CharacterBreath)?.air).toBe(20 * HZ);
    for (let i = 0; i < 4 * HZ; i++) p.world.step([press()]);
    expect(p.steps.some((s) => s.material === 'water')).toBe(true);
  });

  it('gives the player a breath and drains the swimmer stamina pool', () => {
    const p = player({ combat: true });
    expect(p.world.get(p.entity, CharacterBreath)?.air).toBe(20 * HZ);
    expect(p.world.get(p.entity, StaminaComponent)).toBeDefined();
    p.world.step([IDLE_ACTION_FRAME]);
  });

  it('a swimming player drains stamina; a wading one does not', () => {
    const swimmer = installSwimmer(true);
    const before = swimmer.stamina();
    for (let i = 0; i < 2 * HZ; i++) swimmer.world.step([press()]);
    expect(swimmer.stamina()).toBeLessThan(before);
    const noCombat = installSwimmer(false);
    for (let i = 0; i < HZ; i++) noCombat.world.step([press()]);
    expect(noCombat.world.get(noCombat.entity, CharacterController)?.traversal).toBe('swim');
  });

  function installSwimmer(combat: boolean) {
    const world = new World<ActionFrame>({ seed: 2, hz: HZ });
    const entity = installPlayer(world, {
      spawns: [{ ...START, tags: ['player-start'], position: v(0, -1.5, 0), yaw: 0 }],
      collision: new FakeCollisionWorld([floorAt(-1.5)]),
      tuning: TUNING,
      ...(combat && { combat: { moves: new Map() } }),
      water: { volumes: [pool(0)] },
    });
    const stamina = () => world.get(entity, StaminaComponent)?.current ?? 0;
    // Settle first so the starting spawn is in the water.
    world.step([IDLE_ACTION_FRAME]);
    return { world, entity, stamina };
  }

  it('routes drowning to the game and warns when the armor drags the player down', () => {
    const world = new World<ActionFrame>({ seed: 2, hz: HZ });
    const drowned: number[] = [];
    const sunk: EntityId[] = [];
    const entity = installPlayer(world, {
      spawns: [{ ...START, tags: ['player-start'], position: v(0, -4, 0), yaw: 0 }],
      collision: new FakeCollisionWorld([floorAt(-4)]),
      tuning: TUNING,
      water: {
        volumes: [pool(0)],
        loadClass: () => 'heavy',
        onDrown: (_, amount) => drowned.push(amount),
      },
    });
    world.events.on(Sinking, (e) => sunk.push(e.entity));
    for (let i = 0; i < 22 * HZ; i++) world.step([IDLE_ACTION_FRAME]);
    expect(sunk).toEqual([entity]);
    expect(drowned.length).toBeGreaterThanOrEqual(1);
    expect(
      horizontalSpeed(world.get(entity, CharacterController) ?? { velocity: v(0, 0, 0) }),
    ).toBe(0);
  });
});
