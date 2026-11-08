import { describe, expect, it } from 'vitest';
import { CameraShake, explosionTrauma, MAX_SHAKE_OFFSET, shakeWorldOffset, TRAUMA } from './shake';

describe('camera shake (mw-e29.5)', () => {
  it('AC-1: 0.3 trauma is 0.0 after 200 ms with no new trauma', () => {
    const shake = new CameraShake();
    shake.add(0.3);
    expect(shake.trauma).toBeCloseTo(0.3, 10);
    shake.update(0.2);
    expect(shake.trauma).toBe(0);
    const stepped = new CameraShake();
    stepped.add(0.3);
    for (let i = 0; i < 12; i++) stepped.update(1 / 60);
    expect(stepped.trauma).toBe(0);
  });

  it('AC-2: at 0% shake or with reduced motion the camera offset is exactly 0', () => {
    const off = new CameraShake();
    off.configure(0, false);
    off.add(1);
    expect(off.trauma).toBe(0);
    expect(off.update(0.01)).toEqual({ x: 0, y: 0 });
    const reduced = new CameraShake();
    reduced.configure(1, true);
    reduced.add(TRAUMA.guardBreak);
    expect(Object.is(reduced.update(0.013).x, 0)).toBe(true);
    expect(reduced.offset.y).toBe(0);
    expect(reduced.disabled).toBe(true);
  });

  it('offset grows with trauma squared, scales with the setting and stays within the maximum', () => {
    const peak = (trauma: number, scale = 1): number => {
      const s = new CameraShake();
      s.configure(scale, false);
      s.add(trauma);
      let best = 0;
      for (let i = 0; i < 200; i++) {
        s.add(trauma - s.trauma); // hold trauma steady while sampling
        const o = s.update(1 / 120);
        best = Math.max(best, Math.hypot(o.x, o.y));
      }
      return best;
    };
    const low = peak(0.25);
    const high = peak(0.5);
    expect(high / low).toBeCloseTo(4, 0);
    expect(peak(0.5, 0.5) / high).toBeCloseTo(0.5, 1);
    expect(peak(1)).toBeLessThanOrEqual(Math.SQRT2 * MAX_SHAKE_OFFSET);
  });

  it('clamps trauma to 1, ignores bad input and a switched-on setting after configure', () => {
    const shake = new CameraShake();
    shake.add(0.8);
    shake.add(0.8);
    shake.add(-1);
    shake.add(Number.NaN);
    expect(shake.trauma).toBe(1);
    shake.update(Number.NaN);
    shake.update(-5);
    expect(shake.trauma).toBe(1);
    shake.configure(Number.NaN, false);
    expect(shake.disabled).toBe(false);
    shake.configure(7, false);
    expect(shake.disabled).toBe(false);
  });

  it('is deterministic for the same history', () => {
    const run = () => {
      const s = new CameraShake();
      s.add(0.5);
      s.update(0.1);
      return s.update(0.05);
    };
    expect(run()).toEqual(run());
  });

  it('explosions are scaled by distance', () => {
    expect(explosionTrauma(0, 10)).toBe(1);
    expect(explosionTrauma(5, 10)).toBe(0.5);
    expect(explosionTrauma(5, 10, 0.5)).toBe(0.25);
    expect(explosionTrauma(10, 10)).toBe(0);
    expect(explosionTrauma(20, 10)).toBe(0);
    expect(explosionTrauma(1, 0)).toBe(0);
    expect(explosionTrauma(-1, 10, 5)).toBe(1);
    const shake = new CameraShake();
    shake.addExplosion(5, 10);
    expect(shake.trauma).toBe(0.5);
  });

  it('maps the camera-plane offset onto the camera’s right and up', () => {
    const ahead = shakeWorldOffset({ x: 0, y: 0, z: -1 }, { x: 1, y: 2 });
    expect(ahead.x).toBeCloseTo(1);
    expect(ahead.y).toBeCloseTo(2);
    expect(ahead.z).toBeCloseTo(0);
    const east = shakeWorldOffset({ x: 1, y: 0, z: 0 }, { x: 1, y: 0 });
    expect(east.z).toBeCloseTo(1);
    const tilted = shakeWorldOffset({ x: 0, y: -0.6, z: -0.8 }, { x: 0, y: 1 });
    expect(Math.hypot(tilted.x, tilted.y, tilted.z)).toBeCloseTo(1);
    const down = shakeWorldOffset({ x: 0, y: -1, z: 0 }, { x: 3, y: 2 });
    expect(down).toEqual({ x: 0, y: 2, z: 0 });
  });
});
