import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CharacterInput, MovementActions } from '../character/controller';
import {
  ACTION_FRAME_COMMAND,
  ACTIONS,
  actionButton,
  actionFrame,
  actionFrameOf,
  actionVector,
  BUTTON_ACTIONS,
  IDLE_ACTION_FRAME,
  isActionFrame,
  STICK_QUANTUM,
  stickVector,
  type ActionFrame,
} from './action-frame';

describe('action registry', () => {
  it('lists every button action of the registry, in order, and no vectors', () => {
    expect(BUTTON_ACTIONS).toEqual([
      'jump',
      'sprint',
      'crouch',
      'slowWalk',
      'dodge',
      'interact',
      'lockOn',
      'cycleTarget',
      'primaryAttack',
      'secondaryAttack',
      'ability1',
      'ability2',
      'ability3',
      'ability4',
      'cast',
      'cancelCast',
      'inventory',
      'drop',
      'throw',
      'pause',
    ]);
    expect(ACTIONS.move.kind).toBe('vector');
    expect(ACTIONS.look.kind).toBe('vector');
    expect(Object.isFrozen(BUTTON_ACTIONS)).toBe(true);
  });
});

describe('ActionFrame', () => {
  it('satisfies MovementActions, so a frame plus camera yaw is a CharacterInput', () => {
    expectTypeOf<ActionFrame>().toExtend<MovementActions>();
    const input: CharacterInput = { actions: IDLE_ACTION_FRAME, cameraYaw: 0 };
    expect(input.actions.jump).toEqual({ pressed: false, held: false, released: false });
  });

  it('the idle frame is frozen plain data that round-trips through JSON', () => {
    const frame = IDLE_ACTION_FRAME;
    expect(frame.kind).toBe(ACTION_FRAME_COMMAND);
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    expect(frame.lookStick).toEqual({ x: 0, y: 0 });
    for (const action of BUTTON_ACTIONS) {
      expect(frame[action]).toEqual({ pressed: false, held: false, released: false });
    }
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.jump)).toBe(true);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });

  it('actionButton shares one frozen value per edge combination', () => {
    for (const pressed of [false, true]) {
      for (const held of [false, true]) {
        for (const released of [false, true]) {
          const button = actionButton(pressed, held, released);
          expect(button).toEqual({ pressed, held, released });
          expect(actionButton(pressed, held, released)).toBe(button);
          expect(Object.isFrozen(button)).toBe(true);
        }
      }
    }
  });

  it('actionVector normalises -0 to 0 and freezes', () => {
    const v = actionVector(-0, 1);
    expect(Object.is(v.x, 0)).toBe(true);
    expect(Object.isFrozen(v)).toBe(true);
    expect(actionVector(0, 0)).toBe(actionVector(-0, -0));
    expect(actionVector(-2.5, 3)).toEqual({ x: -2.5, y: 3 });
  });

  it('actionFrame fills each button from the callback', () => {
    const frame = actionFrame({
      move: actionVector(0, 1),
      look: actionVector(3, -2),
      buttons: (action) => actionButton(action === 'jump', action === 'jump', false),
    });
    expect(frame.jump).toEqual({ pressed: true, held: true, released: false });
    expect(frame.sprint.held).toBe(false);
    expect(frame.move).toEqual({ x: 0, y: 1 });
    expect(frame.look).toEqual({ x: 3, y: -2 });
  });

  it('isActionFrame and actionFrameOf pick the frame out of mixed tick commands', () => {
    const other = { kind: 'sim.difficulty', set: {} };
    expect(isActionFrame(IDLE_ACTION_FRAME)).toBe(true);
    expect(isActionFrame(other)).toBe(false);
    expect(isActionFrame(null)).toBe(false);
    expect(isActionFrame('input.actions')).toBe(false);
    expect(actionFrameOf([other, IDLE_ACTION_FRAME])).toBe(IDLE_ACTION_FRAME);
    expect(actionFrameOf([other])).toBeUndefined();
  });
});

describe('stick quantisation (mw-e02.9)', () => {
  const length = (v: { x: number; y: number }) => Math.sqrt(v.x * v.x + v.y * v.y);

  it('rounds each axis to the nearest thousandth of full deflection', () => {
    expect(STICK_QUANTUM).toBe(0.001);
    expect(stickVector(0.12345, -0.98765)).toEqual({ x: 0.123, y: -0.988 });
    expect(stickVector(1, 0)).toEqual({ x: 1, y: 0 });
    expect(stickVector(0.0004, -0.0004)).toBe(actionVector(0, 0));
    expect(Object.is(stickVector(-0.0004, 0).x, 0)).toBe(true);
    expect(Object.isFrozen(stickVector(0.5, 0.5))).toBe(true);
  });

  it('is exact through JSON: every quantised value parses back to the same double', () => {
    for (let k = -1000; k <= 1000; k++) {
      const v = stickVector(k / 1000 + 0.0002, 0);
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
      expect(v.x).toBe(k / 1000);
    }
  });

  it('never exceeds length 1: longer input is scaled back, and rounding up falls back to truncation', () => {
    const corner = stickVector(1, 1);
    expect(corner).toEqual({ x: 0.707, y: 0.707 });
    // 0.7075 and 0.7067 round to 0.708 and 0.707 (length > 1); truncation keeps it on the circle.
    const rim = stickVector(0.7075, 0.70669);
    expect(length(rim)).toBeLessThanOrEqual(1);
    expect(rim).toEqual({ x: 0.707, y: 0.706 });
    expect(stickVector(3, -4)).toEqual({ x: 0.6, y: -0.8 });
  });

  it('reads non-finite axes as 0', () => {
    expect(stickVector(Number.NaN, 0.5)).toEqual({ x: 0, y: 0.5 });
    expect(stickVector(0.5, Number.POSITIVE_INFINITY)).toEqual({ x: 0.5, y: 0 });
  });

  it('a frame carries the given lookStick and round-trips through JSON', () => {
    const frame = actionFrame({
      move: stickVector(0.3, 0.4),
      look: actionVector(0, 0),
      lookStick: stickVector(-0.25, 0.75),
      buttons: () => actionButton(false, false, false),
    });
    expect(frame.lookStick).toEqual({ x: -0.25, y: 0.75 });
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });
});
