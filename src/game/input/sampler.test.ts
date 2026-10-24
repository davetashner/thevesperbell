import { describe, expect, it } from 'vitest';
import {
  actionFrameOf,
  CharacterController,
  characterControllerSystem,
  FakeCollisionWorld,
  box,
  IDLE_ACTION_FRAME,
  spawnCharacter,
  World,
  type ActionFrame,
} from '@sim/index';
import type { ControllerTuning, Frozen } from '@content/index';
import { createFrameLoop, FakeFrames } from '../loop';
import { DEFAULT_BINDINGS, rebind, unbind } from './bindings';
import { ActionSampler } from './sampler';

const button = (pressed: boolean, held: boolean, released: boolean) => ({
  pressed,
  held,
  released,
});

describe('ActionSampler', () => {
  it('AC-1: W and Space in the same tick give move (0, 1) and a jump press, then jump held', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyW');
    sampler.down('Space');
    const first = sampler.sample();
    expect(first.move).toEqual({ x: 0, y: 1 });
    expect(first.jump).toEqual(button(true, true, false));
    const second = sampler.sample();
    expect(second.jump).toEqual(button(false, true, false));
    expect(second.move).toEqual({ x: 0, y: 1 });
    expect(Object.isFrozen(second)).toBe(true);
  });

  it('AC-2: after rebinding Jump to F, F fires Jump and Space no longer does', () => {
    const result = rebind(DEFAULT_BINDINGS, 'jump', 'KeyF');
    if (!result.ok) throw new Error('conflict');
    const sampler = new ActionSampler();
    sampler.setBindings(result.bindings);
    expect(sampler.bindings).toBe(result.bindings);
    sampler.down('Space');
    expect(sampler.sample().jump).toEqual(button(false, false, false));
    sampler.up('Space');
    sampler.down('KeyF');
    expect(sampler.sample().jump).toEqual(button(true, true, false));
    expect(sampler.isBound('KeyF')).toBe(true);
    expect(sampler.isBound('Space')).toBe(false);
  });

  it('AC-4: a key pressed and released between samples reports pressed and released', () => {
    const sampler = new ActionSampler();
    sampler.down('Space');
    sampler.up('Space');
    expect(sampler.sample().jump).toEqual(button(true, false, true));
    expect(sampler.sample().jump).toEqual(button(false, false, false));
    // Mouse buttons too.
    sampler.down('Mouse0');
    sampler.up('Mouse0');
    expect(sampler.sample().primaryAttack).toEqual(button(true, false, true));
  });

  it('AC-4: a release and re-press inside one tick reports both edges and stays held', () => {
    const sampler = new ActionSampler();
    sampler.down('Space');
    sampler.sample();
    sampler.up('Space');
    sampler.down('Space');
    expect(sampler.sample().jump).toEqual(button(true, true, true));
  });

  it('reports a release edge on the tick a key goes up', () => {
    const sampler = new ActionSampler();
    sampler.down('ShiftLeft');
    sampler.sample();
    sampler.up('ShiftLeft');
    expect(sampler.sample().sprint).toEqual(button(false, false, true));
  });

  it('ignores auto-repeat and ups for keys that are not down', () => {
    const sampler = new ActionSampler();
    sampler.up('Space');
    sampler.down('Space');
    sampler.down('Space');
    expect(sampler.sample().jump).toEqual(button(true, true, false));
    sampler.down('Space');
    expect(sampler.sample().jump).toEqual(button(false, true, false));
  });

  it('keeps an action held while either of its two keys is down', () => {
    const sampler = new ActionSampler();
    sampler.down('Escape');
    sampler.sample();
    sampler.down('KeyP');
    sampler.up('Escape');
    expect(sampler.sample().pause).toEqual(button(false, true, false));
    sampler.up('KeyP');
    expect(sampler.sample().pause).toEqual(button(false, false, true));
  });

  it('ignores unbound codes', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyJ');
    expect(sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('combines move directions into a unit vector; opposites cancel', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyW');
    sampler.down('KeyD');
    const diagonal = sampler.sample().move;
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 12);
    sampler.down('KeyA');
    expect(sampler.sample().move).toEqual({ x: 0, y: 1 });
    sampler.up('KeyW');
    sampler.down('KeyS');
    const back = sampler.sample().move;
    expect(back).toEqual({ x: 0, y: -1 });
  });

  it('accumulates look delta per tick (x right, y up) and resets it after sampling', () => {
    const sampler = new ActionSampler();
    sampler.look(3, 4);
    sampler.look(2, -1);
    sampler.look(Number.NaN, 5);
    sampler.look(1, Number.POSITIVE_INFINITY);
    expect(sampler.sample().look).toEqual({ x: 5, y: -3 });
    const still = sampler.sample().look;
    expect(still).toEqual({ x: 0, y: 0 });
    expect(Object.is(still.y, 0)).toBe(true);
  });

  it('AC-5 (sampler): releaseAll releases every held action and zeroes pending look', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyW');
    sampler.down('ShiftLeft');
    sampler.down('Mouse2');
    sampler.sample();
    sampler.look(10, 10);
    sampler.releaseAll();
    const frame = sampler.sample();
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    expect(frame.sprint).toEqual(button(false, false, true));
    expect(frame.secondaryAttack).toEqual(button(false, false, true));
    expect(sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('applies a bindings change to keys already down', () => {
    const sampler = new ActionSampler();
    sampler.down('Space');
    sampler.down('KeyF');
    sampler.sample();
    const result = rebind(DEFAULT_BINDINGS, 'jump', 'KeyF');
    if (!result.ok) throw new Error('conflict');
    // Jump stays held through KeyF; interact picks up nothing.
    sampler.setBindings(result.bindings);
    expect(sampler.sample().jump).toEqual(button(false, true, false));
    // Losing every key of a held action releases it; gaining a held key presses it.
    sampler.setBindings(unbind(result.bindings, 'jump', 0));
    expect(sampler.sample().jump).toEqual(button(false, false, true));
    sampler.setBindings(result.bindings);
    expect(sampler.sample().jump).toEqual(button(true, true, false));
  });

  it('keeps the latest frame', () => {
    const sampler = new ActionSampler();
    expect(sampler.lastFrame).toBe(IDLE_ACTION_FRAME);
    sampler.down('KeyE');
    const frame = sampler.sample();
    expect(sampler.lastFrame).toBe(frame);
  });

  it('produces JSON-safe frames (replays record them verbatim)', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyA');
    sampler.down('KeyS');
    sampler.look(-0, -0);
    const frame = sampler.sample();
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
    expect(Object.is(frame.look.x, 0)).toBe(true);
  });
});

describe('sampleCommands in the frame loop', () => {
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

  it('feeds one ActionFrame per tick that drives the character controller as is', () => {
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
    ]);
    const world = new World<ActionFrame>({ seed: 1 }).register(CharacterController);
    world.addSystem(
      characterControllerSystem<ActionFrame>({
        collision,
        tuning: TUNING,
        input: (inputs) => {
          const frame = actionFrameOf(inputs);
          return frame && { actions: frame, cameraYaw: 0 };
        },
      }),
    );
    const player = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    const sampler = new ActionSampler();
    const seen: (readonly ActionFrame[])[] = [];
    const frames = new FakeFrames();
    const loop = createFrameLoop<ActionFrame>({
      sim: world,
      hz: world.clock.hz,
      now: frames.now,
      scheduler: frames,
      visibility: frames,
      sampleCommands: (tick) => {
        const commands = sampler.sampleCommands(tick);
        seen.push(commands);
        return commands;
      },
    });
    loop.start();
    sampler.down('KeyW');
    for (let i = 0; i < 30; i++) frames.frame(1000 / 60);
    loop.stop();
    expect(seen.length).toBe(world.tick);
    expect(seen.every((commands) => commands.length === 1)).toBe(true);
    // Yaw 0 looks along −z, so forward input moves the character towards −z.
    expect(world.get(player, CharacterController)?.position.z).toBeLessThan(-0.5);
  });
});
