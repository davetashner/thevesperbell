import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { log, pow } from '../math';
import { PhysicsColliderComponent } from '../physics/objects';
import { addProperties, registerWorldProperties } from '../properties/components';
import { IDLE_INPUT, SKIN, type CharacterInput } from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import {
  DEFAULT_FOOTSTEP_SURFACES,
  footSurface,
  footstepLoudness,
  groundUnder,
  type SurfaceOffsets,
} from './footsteps';
import { box } from './greybox';
import {
  CharacterLocomotion,
  giveLocomotion,
  LocomotionEvents,
  locomotionSystem,
  type LocomotionEvent,
} from './locomotion';
import { movementProfileOf } from './profile';
import { CharacterController, characterControllerSystem, spawnCharacter } from './system';

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

// Loudness is data: gravel is 20·log10(1.2) dB louder than stone, i.e. a pressure ratio of 1.2.
const GRAVEL_DB = (20 * log(1.2)) / Math.LN10;
const OFFSETS: Record<string, number> = { gravel: GRAVEL_DB, stone: 0, wood: 2, water: 6 };
const offsetOf: SurfaceOffsets = (material) => OFFSETS[material];

const move = (y: number, extra: Partial<CharacterInput['actions']> = {}): CharacterInput => ({
  actions: {
    move: { x: 0, y },
    jump: { pressed: false, held: false },
    sprint: { pressed: false, held: false },
    crouch: { pressed: false, held: false },
    ...extra,
  },
  cameraYaw: 0,
});

interface Ground {
  readonly material?: string;
  readonly wetness?: number;
  readonly frozen?: boolean;
  readonly burning?: boolean;
}

/** A character on a floor whose entity has `ground`'s properties (none given: unbound geometry). */
function makeWorld(ground?: Ground, tuning: Frozen<ControllerTuning> = TUNING) {
  const collision = new FakeCollisionWorld();
  const floor = collision.add(box({ x: -200, y: -1, z: -200 }, { x: 200, y: 0, z: 200 }));
  const world = registerWorldProperties(
    new World<CharacterInput>({ seed: 1 }).register(
      CharacterController,
      CharacterLocomotion,
      PhysicsColliderComponent,
    ),
  );
  world.addSystem(
    characterControllerSystem<CharacterInput>({
      collision,
      tuning,
      input: (inputs) => inputs[0],
    }),
  );
  world.addSystem(
    locomotionSystem<CharacterInput>({
      tuning,
      moving: (inputs) => (inputs[0]?.actions.move.y ?? 0) !== 0,
      surface: (entity) => {
        const reading = groundUnder(world, entity);
        return reading === undefined
          ? undefined
          : footSurface(reading, offsetOf, DEFAULT_FOOTSTEP_SURFACES);
      },
      noise: (entity) => movementProfileOf(world, entity, tuning)?.noise,
    }),
  );
  if (ground !== undefined) {
    const entity = world.spawn();
    addProperties(world, entity, ground);
    world.add(entity, PhysicsColliderComponent, { colliders: [floor] });
  }
  const player = spawnCharacter(world, { x: 0, y: SKIN, z: 0 });
  giveLocomotion(world, player);
  const steps: Extract<LocomotionEvent, { kind: 'footstep' }>[] = [];
  const all: LocomotionEvent[] = [];
  world.events.on(LocomotionEvents, (e) => {
    all.push(e);
    if (e.kind === 'footstep') steps.push(e);
  });
  return { world, player, steps, all };
}

/** Steps `ticks` ticks of `input` (the first ticks settle the character onto the floor). */
function run(w: ReturnType<typeof makeWorld>, input: CharacterInput, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.world.step([input]);
}

describe('footstepLoudness and footSurface', () => {
  it('AC-2: loudness is profile noise times the surface pressure ratio (gravel 1.2)', () => {
    expect(footstepLoudness(0.3, GRAVEL_DB)).toBeCloseTo(0.3 * 1.2, 12);
    expect(footstepLoudness(0.3, 0)).toBe(0.3);
    expect(footstepLoudness(0, 12)).toBe(0);
  });

  it('AC-3: wet ground adds the wet modifier; dry, frozen and unknown materials read as expected', () => {
    const tuning = DEFAULT_FOOTSTEP_SURFACES;
    const stone = { material: 'stone', wetness: 0, frozen: false, burning: false };
    expect(footSurface(stone, offsetOf, tuning)).toEqual({
      material: 'stone',
      wet: false,
      frozen: false,
      burning: false,
      surfaceDb: 0,
    });
    const wet = footSurface({ ...stone, wetness: 0.8 }, offsetOf, tuning);
    expect(wet.wet).toBe(true);
    expect(wet.surfaceDb).toBe(tuning.wetDb);
    // Below wetFrom is damp, not wet.
    expect(footSurface({ ...stone, wetness: 0.4 }, offsetOf, tuning).wet).toBe(false);
    const frozen = footSurface({ ...stone, frozen: true, burning: true }, offsetOf, tuning);
    expect(frozen).toMatchObject({ frozen: true, burning: true, surfaceDb: tuning.frozenDb });
    // A material with no offset reads as stone; a zero wetFrom still needs some wetness.
    expect(footSurface({ ...stone, material: 'mystery' }, offsetOf, tuning).surfaceDb).toBe(0);
    expect(footSurface(stone, offsetOf, { ...tuning, wetFrom: 0 }).wet).toBe(false);
    expect(footSurface({ ...stone, wetness: 0.1 }, offsetOf, { ...tuning, wetFrom: 0 }).wet).toBe(
      true,
    );
  });
});

describe('footstep events (mw-e02.11)', () => {
  it('AC-1: walking 10 m at walk speed takes floor(10 / stride) ± 1 footsteps', () => {
    const w = makeWorld({ material: 'stone' });
    // A 0.3 deflection walks at 1.5 m/s (stride 0.7 m).
    run(w, move(0.3), 3);
    const start = w.world.get(w.player, CharacterController)?.position.z ?? 0;
    w.steps.length = 0;
    for (let i = 0; i < 2000; i++) {
      w.world.step([move(0.3)]);
      const z = w.world.get(w.player, CharacterController)?.position.z ?? 0;
      if (Math.abs(z - start) >= 10) break;
    }
    expect(w.steps.length).toBeGreaterThanOrEqual(Math.floor(10 / 0.7) - 1);
    expect(w.steps.length).toBeLessThanOrEqual(Math.floor(10 / 0.7) + 1);
    expect(new Set(w.steps.map((s) => s.gait))).toEqual(new Set(['walk']));
  });

  it('AC-2: a gravel floor tags material gravel and loudness = profile noise x 1.2', () => {
    const w = makeWorld({ material: 'gravel' });
    run(w, move(0.3), 120);
    expect(w.steps.length).toBeGreaterThan(3);
    for (const step of w.steps) {
      expect(step.material).toBe('gravel');
      expect(step.wet).toBe(false);
      expect(step.profileNoise).toBeGreaterThan(0);
      expect(step.loudness).toBeCloseTo(step.profileNoise * 1.2, 12);
      expect(step.position.y).toBeCloseTo(0, 1);
    }
    // Stone, the same walk: quieter by exactly the 1.2 ratio.
    const stone = makeWorld({ material: 'stone' });
    run(stone, move(0.3), 120);
    expect(w.steps[1]?.loudness).toBeCloseTo((stone.steps[1]?.loudness ?? 0) * 1.2, 12);
  });

  it('AC-3: wet stone carries wet=true and a louder step than dry stone', () => {
    const dry = makeWorld({ material: 'stone' });
    const wet = makeWorld({ material: 'stone', wetness: 0.8 });
    run(dry, move(0.3), 90);
    run(wet, move(0.3), 90);
    const [d, s] = [dry.steps[1], wet.steps[1]];
    expect(d?.wet).toBe(false);
    expect(s?.wet).toBe(true);
    expect(s?.material).toBe('stone');
    expect(s?.surfaceDb).toBe(DEFAULT_FOOTSTEP_SURFACES.wetDb);
    expect(s?.loudness).toBeCloseTo(
      (d?.loudness ?? 0) * pow(10, DEFAULT_FOOTSTEP_SURFACES.wetDb / 20),
      12,
    );
  });

  it('carries frozen and burning ground, and reads unbound geometry as the default material', () => {
    const w = makeWorld({ material: 'ice', frozen: true, burning: true });
    run(w, move(0.3), 90);
    expect(w.steps[0]).toMatchObject({ material: 'ice', frozen: true, burning: true });
    const open = makeWorld();
    run(open, move(0.3), 90);
    expect(open.steps[0]).toMatchObject({ material: 'generic', wet: false, surfaceDb: 0 });
  });

  it('sneaking and sprinting scale the same step by the movement profile', () => {
    const sneak = makeWorld({ material: 'stone' });
    run(sneak, move(1, { crouch: { pressed: false, held: true } }), 120);
    const sprint = makeWorld({ material: 'stone' });
    run(sprint, move(1, { sprint: { pressed: false, held: true } }), 120);
    const quiet = sneak.steps.at(-1);
    const loud = sprint.steps.at(-1);
    expect(quiet?.gait).toBe('crouch');
    expect(loud?.gait).toBe('sprint');
    expect(loud?.loudness).toBe(1);
    expect(quiet?.loudness).toBeLessThan(0.3);
  });

  it('AC-4: no footsteps standing still, airborne, or while a launch carries the character', () => {
    const still = makeWorld({ material: 'stone' });
    run(still, IDLE_INPUT, 120);
    expect(still.steps).toEqual([]);

    // Jump straight up while holding forward: nothing is emitted from take-off until touchdown.
    const air = makeWorld({ material: 'stone' });
    run(air, IDLE_INPUT, 5);
    air.world.step([move(1, { jump: { pressed: true, held: true } })]);
    let airborneTicks = 0;
    while (air.world.get(air.player, CharacterController)?.grounded === false) {
      const before = air.steps.length;
      air.world.step([move(1, { jump: { pressed: false, held: true } })]);
      if (air.world.get(air.player, CharacterController)?.grounded === false) {
        airborneTicks++;
        expect(air.steps.length).toBe(before);
      }
      if (airborneTicks > 600) throw new Error('never landed');
    }
    expect(airborneTicks).toBeGreaterThan(10);
    // The landing is its own event, not a footstep.
    expect(air.all.some((e) => e.kind === 'land')).toBe(true);
  });

  it('a world without surface or noise readers still emits footsteps with neutral tags', () => {
    const collision = new FakeCollisionWorld([
      box({ x: -200, y: -1, z: -200 }, { x: 200, y: 0, z: 200 }),
    ]);
    const world = new World<CharacterInput>({ seed: 1 }).register(
      CharacterController,
      CharacterLocomotion,
    );
    world.addSystem(
      characterControllerSystem<CharacterInput>({ collision, tuning: TUNING, input: (i) => i[0] }),
    );
    world.addSystem(locomotionSystem<CharacterInput>({ tuning: TUNING, moving: () => true }));
    const id = spawnCharacter(world, { x: 0, y: SKIN, z: 0 });
    giveLocomotion(world, id);
    const steps: LocomotionEvent[] = [];
    world.events.on(LocomotionEvents, (e) => e.kind === 'footstep' && steps.push(e));
    for (let i = 0; i < 90; i++) world.step([move(0.3)]);
    expect(steps[0]).toMatchObject({
      wet: false,
      frozen: false,
      burning: false,
      profileNoise: 1,
      surfaceDb: 0,
      loudness: 1,
    });
    expect(steps[0]).not.toHaveProperty('material');
  });

  it('replays: the same inputs give identical events (deterministic from sim state)', () => {
    const a = makeWorld({ material: 'gravel', wetness: 0.9 });
    const b = makeWorld({ material: 'gravel', wetness: 0.9 });
    run(a, move(0.6), 200);
    run(b, move(0.6), 200);
    expect(a.steps).toEqual(b.steps);
    expect(a.steps.length).toBeGreaterThan(5);
  });
});

describe('groundUnder', () => {
  it('is undefined with no ground under the feet', () => {
    const world = new World<CharacterInput>({ seed: 1 }).register(CharacterController);
    const id = spawnCharacter(world, { x: 0, y: 5, z: 0 });
    expect(groundUnder(world, id)).toBeUndefined();
  });

  it('reads defaults for an owner that lacks properties in a world that registers none', () => {
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
    ]);
    const world = new World<CharacterInput>({ seed: 1 }).register(
      CharacterController,
      PhysicsColliderComponent,
    );
    world.addSystem(
      characterControllerSystem<CharacterInput>({ collision, tuning: TUNING, input: (i) => i[0] }),
    );
    const owner = world.spawn();
    world.add(owner, PhysicsColliderComponent, { colliders: [1] });
    const id = spawnCharacter(world, { x: 0, y: SKIN, z: 0 });
    world.step([IDLE_INPUT]);
    world.step([IDLE_INPUT]);
    expect(groundUnder(world, id)).toEqual({
      material: 'generic',
      wetness: 0,
      frozen: false,
      burning: false,
    });
  });
});
