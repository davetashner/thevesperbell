import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK_SETTINGS, lookTurn } from '../../sim/player';
import { createSettingsStore } from '../settings';
import { liveLook, RECENTRE_DELAY, RECENTRE_RATE } from './look-options';
import { toRadians } from './orbit-camera';

const base = DEFAULT_LOOK_SETTINGS;
const tuning = { pitch: { min: -70, max: 60, initial: -15 } };

function look(locked = false) {
  const settings = createSettingsStore({ warn: () => undefined });
  return { settings, now: liveLook(base, tuning, settings, () => locked) };
}

describe('liveLook (mw-e31.6)', () => {
  it('at the defaults it equals the content look settings, so replays and goldens do not move', () => {
    const { now } = look();
    const got = now();
    expect(got.sensitivity).toBe(base.sensitivity);
    expect(got.invertY).toBe(false);
    expect(got.invertX).toBe(false);
    expect(got.stick).toEqual(base.stick);
    expect(got.recentre).toBeUndefined();
    const input = { mouse: { x: 37, y: -12 }, stick: { x: 0.7, y: 0.4 } };
    expect(lookTurn(input, got, 1 / 60)).toEqual(lookTurn(input, base, 1 / 60));
  });

  it('AC-1: invert Y turns the same mouse movement the opposite way in pitch', () => {
    const { settings, now } = look();
    const plain = lookTurn({ mouse: { x: 0, y: 100 } }, now(), 1 / 60);
    settings.set('camera.invertY', true);
    const inverted = lookTurn({ mouse: { x: 0, y: 100 } }, now(), 1 / 60);
    expect(inverted.pitch).toBeCloseTo(-plain.pitch, 12);
    expect(plain.pitch).not.toBe(0);
  });

  it('invert X turns yaw the opposite way, for mouse and stick', () => {
    const { settings, now } = look();
    const input = { mouse: { x: 100, y: 0 }, stick: { x: 1, y: 0 } };
    const plain = lookTurn(input, now(), 0.1);
    settings.set('camera.invertX', true);
    const inverted = lookTurn(input, now(), 0.1);
    expect(inverted.yaw).toBeCloseTo(-plain.yaw, 12);
  });

  it('sensitivity scales mouse counts and the stick rates, and is read on every call', () => {
    const { settings, now } = look();
    const input = { mouse: { x: 100, y: 100 }, stick: { x: 1, y: 1 } };
    const one = lookTurn(input, now(), 0.1);
    settings.set('camera.sensitivity', 2);
    const two = lookTurn(input, now(), 0.1);
    expect(two.yaw).toBeCloseTo(2 * one.yaw, 12);
    expect(two.pitch).toBeCloseTo(2 * one.pitch, 12);
  });

  it('auto-centre asks the sim to ease to the camera resting pitch after the delay', () => {
    const { settings, now } = look();
    settings.set('camera.autoCentre', true);
    expect(now().recentre).toEqual({
      pitch: toRadians(-15),
      delay: RECENTRE_DELAY,
      rate: toRadians(RECENTRE_RATE),
    });
  });

  it('a replay is locked to the content values whatever the player chose', () => {
    const { settings, now } = look(true);
    settings.set('camera.sensitivity', 3);
    settings.set('camera.invertY', true);
    settings.set('camera.invertX', true);
    settings.set('camera.autoCentre', true);
    expect(now()).toBe(base);
  });
});
