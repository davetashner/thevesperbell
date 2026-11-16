import { describe, expect, it } from 'vitest';
import { actionVector } from '@sim/index';
import {
  choosePad,
  DEFAULT_GAMEPAD_SETTINGS,
  isPadChord,
  isPadCode,
  isPadInputCode,
  padChordParts,
  magnitude,
  mergeMove,
  PAD_BUTTONS,
  radialDeadzone,
  readPad,
} from './gamepad';
import { fakePad } from './fake-gamepad';

const deadzone = DEFAULT_GAMEPAD_SETTINGS.moveDeadzone;

describe('radial deadzone (mw-e02.9)', () => {
  it('AC-1: magnitude 0.10 with deadzone 0.15 is no movement; magnitude 1.0 is length 1.0', () => {
    expect(deadzone).toBe(0.15);
    expect(radialDeadzone(actionVector(0.1, 0), deadzone)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone(actionVector(0.06, -0.08), deadzone)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone(actionVector(0.15, 0), deadzone)).toEqual({ x: 0, y: 0 });
    expect(magnitude(radialDeadzone(actionVector(1, 0), deadzone))).toBe(1);
    expect(magnitude(radialDeadzone(actionVector(0.6, 0.8), deadzone))).toBe(1);
    const diagonal = radialDeadzone(actionVector(Math.SQRT1_2, Math.SQRT1_2), deadzone);
    expect(magnitude(diagonal)).toBeCloseTo(1, 2);
    expect(magnitude(diagonal)).toBeLessThanOrEqual(1);
  });

  it('AC-2: magnitude 0.575 (midway between deadzone and full) comes out at 0.5 ± 0.01', () => {
    for (const angle of [0, 0.7, 2, -2.5]) {
      const stick = actionVector(0.575 * Math.cos(angle), 0.575 * Math.sin(angle));
      const out = radialDeadzone(stick, deadzone);
      expect(Math.abs(magnitude(out) - 0.5)).toBeLessThanOrEqual(0.01);
      // Direction kept.
      expect(Math.atan2(out.y, out.x)).toBeCloseTo(angle, 2);
    }
  });

  it('is rescaled (no jump at the edge of the zone), clamps past the rim and is quantised', () => {
    expect(magnitude(radialDeadzone(actionVector(0.16, 0), deadzone))).toBeCloseTo(0.012, 3);
    expect(radialDeadzone(actionVector(0, -1.3), deadzone)).toEqual({ x: 0, y: -1 });
    const out = radialDeadzone(actionVector(0.3333333, 0.4444444), deadzone);
    expect(out.x * 1000).toBe(Math.round(out.x * 1000));
    expect(out.y * 1000).toBe(Math.round(out.y * 1000));
  });
});

describe('keyboard and pad movement merge (mw-e02.9)', () => {
  it('AC-3: the larger-magnitude vector wins and the length never exceeds 1', () => {
    const diagonal = actionVector(Math.SQRT1_2, Math.SQRT1_2);
    const halfStick = actionVector(0, 0.5);
    expect(mergeMove(diagonal, halfStick)).toBe(diagonal);
    const fullStick = actionVector(-1, 0);
    expect(mergeMove(actionVector(0, 0), fullStick)).toBe(fullStick);
    expect(mergeMove(actionVector(0, 0.4), actionVector(0.6, 0))).toEqual({ x: 0.6, y: 0 });
    // Never a sum: W plus a full stick to the right is not √2 long.
    const merged = mergeMove(actionVector(0, 1), actionVector(1, 0));
    expect(magnitude(merged)).toBeLessThanOrEqual(1);
    // A tie keeps the keyboard's.
    const keys = actionVector(0, 1);
    expect(mergeMove(keys, actionVector(1, 0))).toBe(keys);
  });
});

describe('readPad (standard mapping)', () => {
  it('names the standard buttons by their Xbox labels', () => {
    expect(PAD_BUTTONS).toHaveLength(17);
    expect(PAD_BUTTONS[0]).toBe('PadA');
    expect(PAD_BUTTONS[7]).toBe('PadRT');
    expect(PAD_BUTTONS[9]).toBe('PadMenu');
    expect(PAD_BUTTONS[12]).toBe('PadUp');
    expect(isPadCode('PadLS')).toBe(true);
    expect(isPadCode('KeyW')).toBe(false);
    expect(isPadChord('PadLT+PadUp')).toBe(true);
    expect(isPadChord('PadLT+PadLT')).toBe(false);
    expect(isPadChord('PadLT')).toBe(false);
    expect(isPadChord('PadLT+KeyW')).toBe(false);
    expect(isPadInputCode('PadA')).toBe(true);
    expect(isPadInputCode('PadLT+PadUp')).toBe(true);
    expect(isPadInputCode('F1')).toBe(false);
    expect(padChordParts('PadLT+PadUp')).toEqual(['PadLT', 'PadUp']);
  });

  it('reads buttons down, sticks with y up, and triggers past the threshold only', () => {
    const pad = fakePad({ pressed: ['PadA', 'PadLS'], lt: 0.2, rt: 0.9 });
    const snapshot = readPad({ ...pad, axes: [0.5, -0.25, -1, 1] });
    expect([...snapshot.buttons].sort()).toEqual(['PadA', 'PadLS', 'PadRT']);
    expect(snapshot.left).toEqual({ x: 0.5, y: 0.25 });
    expect(snapshot.right).toEqual({ x: -1, y: -1 });
    const lightPull = readPad(fakePad({ lt: 0.2 }), { triggerThreshold: 0.1 });
    expect([...lightPull.buttons]).toEqual(['PadLT']);
    expect(readPad(fakePad({ left: [0, 1] })).left).toEqual({ x: 0, y: 1 });
  });

  it('tolerates short button and axis arrays and non-finite axes', () => {
    const snapshot = readPad({
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons: [{ pressed: true, value: 1 }],
      axes: [Number.NaN],
    });
    expect([...snapshot.buttons]).toEqual(['PadA']);
    expect(snapshot.left).toEqual({ x: 0, y: 0 });
    expect(snapshot.right).toEqual({ x: 0, y: 0 });
  });
});

describe('choosePad', () => {
  it('takes the first connected standard-mapping pad and keeps the current one while it lasts', () => {
    const odd = fakePad({ index: 0, mapping: '' });
    const first = fakePad({ index: 1 });
    const second = fakePad({ index: 2 });
    expect(choosePad([])).toBeUndefined();
    expect(choosePad([null, odd])).toBeUndefined();
    expect(choosePad([odd, first, second])).toBe(first);
    expect(choosePad([odd, first, second], 2)).toBe(second);
    expect(choosePad([odd, first, fakePad({ index: 2, connected: false })], 2)).toBe(first);
    expect(choosePad([odd, first], 5)).toBe(first);
  });
});
