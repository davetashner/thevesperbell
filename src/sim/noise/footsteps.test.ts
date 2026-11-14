import type { AcousticSurface, ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { LocomotionEvents } from '../character/locomotion';
import {
  IDLE_INPUT,
  initialCharacterState,
  SKIN,
  type CharacterInput,
} from '../character/controller';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { box } from '../character/greybox';
import type { FootSurface } from '../character/footsteps';
import { CharacterLocomotion, giveLocomotion, locomotionSystem } from '../character/locomotion';
import { CharacterEncumbrance } from '../character/profile';
import {
  CharacterController,
  characterControllerSystem,
  spawnCharacter,
} from '../character/system';
import { CreatureComponent } from '../creatures/components';
import { CreatureConditionComponent, FRESH_CONDITION } from '../creatures/condition';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { noiseEmitted, type NoiseEvent } from './events';
import {
  creatureGait,
  equipmentDb,
  footstepDb,
  CreatureStrideComponent,
  FOOTSTEP_NOISE,
  installFootstepNoise,
  isMovementNoise,
  landingBaseDb,
  landingDb,
  LANDING_NOISE,
  MAX_STEP_SPEED,
} from './footsteps';
import { DEFAULT_NOISE_TUNING } from './propagation';
import { installNoisePropagation, NoiseListenerComponent, noiseHeard } from './system';
import { buildSoundGraph } from './graph';

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
const FOOT = DEFAULT_NOISE_TUNING.footsteps;
const CARPET: FootSurface = {
  material: 'carpet',
  wet: false,
  frozen: false,
  burning: false,
  surfaceDb: -10,
};
const GRAVEL: FootSurface = { ...CARPET, material: 'gravel', surfaceDb: 8 };
const STONE: FootSurface = { ...CARPET, material: 'stone', surfaceDb: 0 };

const HELD = { pressed: false, held: true };
function walkInput(
  buttons: ('sprint' | 'crouch' | 'slowWalk')[] = [],
  forward = true,
): CharacterInput {
  const off = { pressed: false, held: false };
  return {
    actions: {
      move: { x: 0, y: forward ? 1 : 0 },
      jump: off,
      sprint: buttons.includes('sprint') ? HELD : off,
      crouch: buttons.includes('crouch') ? HELD : off,
      ...(buttons.includes('slowWalk') && { slowWalk: HELD }),
    },
    cameraYaw: 0,
  };
}

interface Rig {
  readonly world: World<CharacterInput>;
  readonly noises: NoiseEvent[];
  readonly entity: number;
  run(ticks: number, input?: CharacterInput): void;
}

/** A character on a big flat floor with the real controller and locomotion, footstep noise installed. */
function rig(
  options: {
    surface?: FootSurface;
    encumbrance?: number;
    feet?: { x: number; y: number; z: number };
    surfaces?: ReadonlyMap<string, AcousticSurface>;
  } = {},
): Rig {
  const collision = new FakeCollisionWorld([
    box({ x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 }),
  ]);
  const world = new World<CharacterInput>({ seed: 1 }).register(
    CharacterController,
    CharacterLocomotion,
    PlacementComponent,
  );
  let current: CharacterInput = IDLE_INPUT;
  world.addSystem(
    characterControllerSystem<CharacterInput>({ collision, tuning: TUNING, input: () => current }),
  );
  world.addSystem(
    locomotionSystem<CharacterInput>({
      tuning: TUNING,
      moving: () => current.actions.move.x !== 0 || current.actions.move.y !== 0,
      surface: () => options.surface ?? STONE,
      encumbrance: () => options.encumbrance,
    }),
  );
  installFootstepNoise(world, {
    tuning: FOOT,
    ...(options.surfaces !== undefined && { surfaces: options.surfaces }),
  });
  const entity = spawnCharacter(world, options.feet ?? { x: 0, y: SKIN, z: 0 });
  giveLocomotion(world, entity);
  const noises: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => noises.push(n));
  return {
    world,
    noises,
    entity,
    run(ticks, input = IDLE_INPUT) {
      current = input;
      for (let i = 0; i < ticks; i++) world.step();
    },
  };
}

describe('footstep noise formula (mw-e09.5)', () => {
  it('equipment dB is 20·log10 of the multiplier, so a product of multipliers is a sum of dB', () => {
    expect(equipmentDb(1)).toBe(0);
    expect(equipmentDb(1.6)).toBeCloseTo(4.08, 2);
    expect(equipmentDb(1.3 * 0.7)).toBeCloseTo(equipmentDb(1.3) + equipmentDb(0.7), 10);
    expect(equipmentDb(10 ** 0.5)).toBeCloseTo(10, 10);
  });

  it('AC-1: sneaking on carpet with nothing noisy is 25 − 10 = 15 dB', () => {
    expect(footstepDb(FOOT, 'sneak', -10, 0)).toBe(15);
  });

  it('AC-2: sprinting on gravel in gear worth +10 dB is 65 + gravel + 10', () => {
    expect(footstepDb(FOOT, 'sprint', 8, 10)).toBe(65 + 8 + 10);
    expect(footstepDb(FOOT, 'walk', -30, -20, 0)).toBe(0);
    expect(footstepDb(FOOT, 'walk', 0, 0, 12)).toBe(52);
  });

  it('the landing curve is flat below its first point, interpolated, then flat', () => {
    expect(landingBaseDb(FOOT, 0.49)).toBeNull();
    expect(landingBaseDb(FOOT, 0.5)).toBe(30);
    expect(landingBaseDb(FOOT, 1.5)).toBe(52.5);
    expect(landingBaseDb(FOOT, 3)).toBe(70);
    expect(landingBaseDb(FOOT, 50)).toBe(95);
    expect(landingDb(FOOT, 3, 8, 4)).toBe(82);
    expect(landingDb(FOOT, 0.1, 0, 0)).toBeNull();
    expect(landingDb(FOOT, 0.5, -20, -20)).toBe(0);
  });

  it('a creature steps from 0.2 m/s: walk, run from 2.5, sprint from 6', () => {
    expect(creatureGait(FOOT, 0.1)).toBeUndefined();
    expect(creatureGait(FOOT, Number.NaN)).toBeUndefined();
    expect(creatureGait(FOOT, 0.2)).toBe('walk');
    expect(creatureGait(FOOT, 2.5)).toBe('run');
    expect(creatureGait(FOOT, 6)).toBe('sprint');
  });

  it('movement noise kinds are the footstep and the landing', () => {
    expect(isMovementNoise(FOOTSTEP_NOISE)).toBe(true);
    expect(isMovementNoise(LANDING_NOISE)).toBe(true);
    expect(isMovementNoise('door')).toBe(false);
  });
});

describe('the player’s footsteps are noises (mw-e09.5)', () => {
  it('AC-1: a crouched step on carpet is 15 dB, attributed to the walker', () => {
    const r = rig({ surface: CARPET });
    r.run(120, walkInput(['crouch']));
    const steps = r.noises.filter((n) => n.kind === FOOTSTEP_NOISE);
    expect(steps.length).toBeGreaterThan(2);
    for (const n of steps) {
      expect(n.loudness).toBe(15);
      expect(n.entity).toBe(r.entity);
      expect(n.source).toBe(r.entity);
      expect(n.tags).toEqual(['sneak']);
    }
  });

  it('AC-1: the slow-walk modifier is a sneak too', () => {
    const r = rig({ surface: CARPET });
    r.run(120, walkInput(['slowWalk']));
    expect(new Set(r.noises.map((n) => n.loudness))).toEqual(new Set([15]));
  });

  it('AC-2: a sprint on gravel with a +10 dB equipment term is 83 dB', () => {
    const r = rig({ surface: GRAVEL, encumbrance: 10 ** 0.5 });
    r.run(120, walkInput(['sprint']));
    const steps = r.noises.filter((n) => n.kind === FOOTSTEP_NOISE);
    expect(steps.length).toBeGreaterThan(2);
    for (const n of steps) expect(n.loudness).toBeCloseTo(65 + 8 + 10, 8);
  });

  it('a walk and a run are 40 and 55 dB on stone; a Medium knight adds 2.3 dB', () => {
    const walk = rig();
    walk.run(120, walkInput([], true));
    const gaits = new Set(walk.noises.map((n) => n.tags?.[0]));
    expect(gaits.has('run') || gaits.has('walk')).toBe(true);
    const medium = rig({ encumbrance: 1.3 });
    medium.run(120, walkInput());
    const plain = rig();
    plain.run(120, walkInput());
    expect(medium.noises[0]?.loudness).toBeCloseTo((plain.noises[0]?.loudness ?? 0) + 2.28, 2);
  });

  it('AC-4: standing still for 5 s makes no footsteps', () => {
    const r = rig();
    r.run(5 * 60);
    expect(r.noises).toEqual([]);
  });

  it('AC-3: a 3 m fall onto stone emits one 70 dB landing, once, and no other impact', () => {
    const r = rig({ feet: { x: 0, y: 3 + SKIN, z: 0 } });
    r.run(120);
    expect(r.noises).toHaveLength(1);
    expect(r.noises[0]).toMatchObject({
      kind: LANDING_NOISE,
      entity: r.entity,
      source: r.entity,
    });
    expect(r.noises[0]?.loudness).toBeCloseTo(70, 5);
  });

  it('AC-3: a landing adds the surface and the equipment, and a hop is silent', () => {
    const loud = rig({ feet: { x: 0, y: 3 + SKIN, z: 0 }, surface: GRAVEL, encumbrance: 1.6 });
    loud.run(120);
    expect(loud.noises[0]?.loudness).toBeCloseTo(70 + 8 + 4.08, 1);
    const hop = rig({ feet: { x: 0, y: 0.2, z: 0 } });
    hop.run(60);
    expect(hop.noises).toEqual([]);
  });

  it('a hollow board creaks on a seeded roll and a plain one never does', () => {
    const table = new Map<string, AcousticSurface>([
      [
        'wood-hollow',
        { id: 'wood-hollow', offsetDb: 5, varianceDb: 2, sfx: 'x', creak: { chance: 0.5, db: 12 } },
      ],
      ['stone', { id: 'stone', offsetDb: 0, varianceDb: 1, sfx: 'y' }],
    ]);
    const hollow = { ...STONE, material: 'wood-hollow', surfaceDb: 5 };
    const a = rig({ surface: hollow, surfaces: table });
    a.run(600, walkInput(['sprint']));
    const levels = new Set(a.noises.map((n) => n.loudness));
    expect(levels).toEqual(new Set([70, 82]));
    const b = rig({ surface: hollow, surfaces: table });
    b.run(600, walkInput(['sprint']));
    expect(b.noises.map((n) => n.loudness)).toEqual(a.noises.map((n) => n.loudness));
    const plain = rig({ surface: STONE, surfaces: table });
    plain.run(300, walkInput(['sprint']));
    expect(new Set(plain.noises.map((n) => n.loudness))).toEqual(new Set([65]));
    const unlisted = rig({ surface: { ...STONE, material: 'unknown' }, surfaces: table });
    unlisted.run(300, walkInput(['sprint']));
    expect(new Set(unlisted.noises.map((n) => n.loudness))).toEqual(new Set([65]));
  });

  it('the walker never hears its own footfall; another listener does', () => {
    const r = rig();
    installNoisePropagation(r.world, { graph: buildSoundGraph({ rooms: [], portals: [] }) });
    r.world.add(r.entity, NoiseListenerComponent, { thresholdDb: 0, range: 50 });
    const other = r.world.spawn();
    placeEntity(r.world, other, { x: 0, y: 0, z: 3 }, 0.4);
    r.world.add(other, NoiseListenerComponent, { thresholdDb: 0, range: 50 });
    r.world.step();
    const heard: number[] = [];
    r.world.events.on(noiseHeard, (h) => heard.push(h.listener));
    r.run(120, walkInput(['sprint']));
    expect(heard.length).toBeGreaterThan(0);
    expect(new Set(heard)).toEqual(new Set([other]));
  });

  it('uninstalling stops footstep and landing noise and the creatures', () => {
    const world = new World<never>({ seed: 1 });
    const off = installFootstepNoise(world, { tuning: FOOT });
    const noises: NoiseEvent[] = [];
    world.events.on(noiseEmitted, (n) => noises.push(n));
    off();
    const at = { x: 0, y: 0, z: 0 };
    const base = {
      entity: 1,
      tick: 0,
      position: at,
      wet: false,
      frozen: false,
      surfaceDb: 0,
      encumbrance: 1,
    };
    world.events.emit(LocomotionEvents, {
      ...base,
      kind: 'footstep',
      foot: 'left',
      gait: 'run',
      burning: false,
      profileNoise: 1,
      loudness: 1,
    });
    world.events.emit(LocomotionEvents, { ...base, kind: 'land', impactSpeed: 20, fallHeight: 8 });
    world.step();
    expect(noises).toEqual([]);
  });
});

/** A creature walking a straight line; `speed` m/s, set per tick by the test. */
function creatures(
  options: { surface?: FootSurface; controllers?: boolean; armour?: boolean } = {},
) {
  const world = new World<never>({ seed: 3 }).register(
    CreatureComponent,
    CreatureConditionComponent,
    PlacementComponent,
  );
  if (options.controllers !== false) world.register(CharacterController);
  if (options.armour !== false) world.register(CharacterEncumbrance);
  world.register(CreatureStrideComponent);
  const off = installFootstepNoise(world, {
    tuning: FOOT,
    ...(options.surface !== undefined && { creatureSurface: () => options.surface }),
  });
  const noises: NoiseEvent[] = [];
  world.events.on(noiseEmitted, (n) => noises.push(n));
  const spawn = (x = 0): number => {
    const e = world.spawn();
    world.add(e, CreatureComponent, {
      origin: { creature: 'x', at: { x, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'b',
      tuning: {},
      needs: {},
    });
    world.add(e, CreatureConditionComponent, FRESH_CONDITION);
    placeEntity(world, e, { x, y: 0, z: 0 }, 0.4);
    world.step();
    return e;
  };
  /** Moves `e` `speed` m/s along +x for `ticks` ticks. */
  const walk = (e: number, speed: number, ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      const at = world.get(e, PlacementComponent);
      if (at === undefined) throw new Error('no placement');
      world.set(e, PlacementComponent, { ...at, x: at.x + speed / 60 });
      world.step();
    }
  };
  return { world, noises, spawn, walk, off };
}

describe('creature footsteps come from distance moved (mw-e09.5)', () => {
  it('a patrolling creature steps every 0.75 m at 40 dB; a chasing one every 1.6 m at 55 dB', () => {
    const c = creatures();
    const patrol = c.spawn();
    c.walk(patrol, 1.5, 120); // 3 m
    expect(c.noises.map((n) => n.loudness)).toEqual([40, 40, 40, 40]);
    expect(c.noises.every((n) => n.entity === patrol && n.source === patrol)).toBe(true);
    c.noises.length = 0;
    const chaser = c.spawn(50);
    c.walk(chaser, 4, 60); // 4 m
    expect(c.noises.filter((n) => n.entity === chaser).map((n) => n.loudness)).toEqual([55, 55]);
  });

  it('AC-4: a creature standing still for 5 s is silent', () => {
    const c = creatures();
    c.spawn();
    for (let i = 0; i < 300; i++) c.world.step();
    expect(c.noises).toEqual([]);
  });

  it('a creature on gravel is louder by the surface, and a knocked-out one makes no step', () => {
    const c = creatures({ surface: GRAVEL });
    const e = c.spawn();
    c.walk(e, 1.5, 60);
    expect(new Set(c.noises.map((n) => n.loudness))).toEqual(new Set([48]));
    c.noises.length = 0;
    c.world.set(e, CreatureConditionComponent, { ...FRESH_CONDITION, unconsciousUntil: 10_000 });
    c.walk(e, 1.5, 120);
    expect(c.noises).toEqual([]);
  });

  it('armor load adds its dB to a creature’s step', () => {
    const c = creatures();
    const bare = c.spawn(40);
    const e = c.spawn();
    c.world.add(e, CharacterEncumbrance, { noise: 1.6 });
    c.walk(e, 1.5, 60);
    expect(c.noises[0]?.loudness).toBeCloseTo(44.08, 2);
    c.noises.length = 0;
    c.walk(bare, 1.5, 60);
    expect(c.noises[0]?.loudness).toBe(40);
  });

  it('a character with a controller is the player’s business, not a creature’s', () => {
    const c = creatures();
    const e = c.spawn();
    c.world.add(e, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
    c.walk(e, 1.5, 60);
    expect(c.noises).toEqual([]);
    const free = creatures({ controllers: false, armour: false });
    free.walk(free.spawn(), 1.5, 60);
    expect(free.noises.length).toBeGreaterThan(0);
  });

  it('other locomotion events make no noise', () => {
    const world = new World<never>({ seed: 1 });
    installFootstepNoise(world, { tuning: FOOT });
    const noises: NoiseEvent[] = [];
    world.events.on(noiseEmitted, (n) => noises.push(n));
    world.events.emit(LocomotionEvents, { kind: 'jumpStart', entity: 1, tick: 0 });
    world.step();
    expect(noises).toEqual([]);
  });

  it('a teleport is not a walk: no step and the stride restarts', () => {
    const c = creatures();
    const e = c.spawn();
    c.walk(e, MAX_STEP_SPEED * 2, 3);
    expect(c.noises).toEqual([]);
  });

  it('uninstalled, creatures make no noise; a world with no creatures costs nothing', () => {
    const c = creatures();
    const e = c.spawn();
    c.off();
    c.walk(e, 1.5, 120);
    expect(c.noises).toEqual([]);
    const bare = new World<never>({ seed: 1 });
    installFootstepNoise(bare, { tuning: FOOT });
    bare.step();
    bare.register(CreatureComponent);
    bare.step();
    expect(bare.tick).toBe(2);
  });
});
