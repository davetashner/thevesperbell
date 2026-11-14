import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../snapshot';
import { IDLE_INPUT, movementState, type CharacterInput } from './controller';
import { FakeCollisionWorld } from './fake-collision-world';
import { box } from './greybox';
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

/** Commands: the input for one character, by entity id. */
interface Command {
  readonly entity: number;
  readonly input: CharacterInput;
}

const forward: CharacterInput = {
  ...IDLE_INPUT,
  actions: { ...IDLE_INPUT.actions, move: { x: 0, y: 1 } },
};

function makeWorld() {
  const collision = new FakeCollisionWorld([
    box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
  ]);
  const world = new World<Command>({ seed: 1 }).register(CharacterController);
  world.addSystem(
    characterControllerSystem({
      collision,
      tuning: TUNING,
      input: (inputs, entity) => inputs.find((c) => c.entity === entity)?.input,
    }),
  );
  const a = spawnCharacter(world, { x: 0, y: 0, z: 0 });
  const b = spawnCharacter(world, { x: 5, y: 0, z: 0 });
  return { world, a, b };
}

describe('character controller system', () => {
  it('steps each character with its own input; characters without one idle', () => {
    const { world, a, b } = makeWorld();
    for (let i = 0; i < 30; i++) world.step([{ entity: a, input: forward }]);
    const moved = world.get(a, CharacterController);
    const idle = world.get(b, CharacterController);
    expect(moved?.position.z).toBeLessThan(-1);
    expect(idle?.position.x).toBe(5);
    expect(idle?.position.y).toBeCloseTo(0.01, 12);
    expect(idle && movementState(idle)).toEqual({
      grounded: true,
      airborne: false,
      crouched: false,
      sprinting: false,
    });
  });

  it('mw-e03.23: a character that is held is not stepped at all: no input, gravity or depenetration', () => {
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
    ]);
    const world = new World<Command>({ seed: 1 }).register(CharacterController);
    const held = new Set<number>();
    world.addSystem(
      characterControllerSystem({
        collision,
        tuning: TUNING,
        input: (inputs, entity) => inputs.find((c) => c.entity === entity)?.input,
        held: (entity) => held.has(entity),
      }),
    );
    const a = spawnCharacter(world, { x: 0, y: 3, z: 0 });
    const b = spawnCharacter(world, { x: 5, y: 3, z: 0 });
    held.add(a);
    for (let i = 0; i < 30; i++) world.step([{ entity: a, input: forward }]);
    expect(world.get(a, CharacterController)?.position).toEqual({ x: 0, y: 3, z: 0 });
    expect(world.get(b, CharacterController)?.position.y).toBeLessThan(3); // the other one fell
    held.delete(a);
    for (let i = 0; i < 30; i++) world.step([{ entity: a, input: forward }]);
    expect(world.get(a, CharacterController)?.position.y).toBeLessThan(3);
  });

  it('mw-e02.8: measure wraps each tick of the system once and changes nothing about the result', () => {
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
    ]);
    let wrapped = 0;
    const build = (measure?: (run: () => void) => void) => {
      const world = new World<Command>({ seed: 1 }).register(CharacterController);
      world.addSystem(
        characterControllerSystem({
          collision,
          tuning: TUNING,
          input: (inputs, entity) => inputs.find((c) => c.entity === entity)?.input,
          ...(measure !== undefined && { measure }),
        }),
      );
      return { world, id: spawnCharacter(world, { x: 0, y: 0, z: 0 }) };
    };
    const plain = build();
    const timed = build((run) => {
      wrapped += 1;
      run();
    });
    for (let i = 0; i < 20; i++) {
      plain.world.step([{ entity: plain.id, input: forward }]);
      timed.world.step([{ entity: timed.id, input: forward }]);
    }
    expect(wrapped).toBe(20);
    expect(hashWorld(timed.world)).toBe(hashWorld(plain.world));
  });

  it('snapshots controller state, so identical input gives identical hashes', () => {
    const run = () => {
      const { world, a } = makeWorld();
      for (let i = 0; i < 60; i++) world.step(i % 3 === 0 ? [{ entity: a, input: forward }] : []);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
