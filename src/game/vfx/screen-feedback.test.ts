import { describe, expect, it } from 'vitest';
import {
  DamageVignette,
  desaturation,
  FlashLimiter,
  MAX_FLASHES_PER_SECOND,
  REDUCED_FLASH_INTENSITY,
  MAX_DESATURATION,
  VIGNETTE_MS,
} from './screen-feedback';

describe('screen feedback (mw-e29.5)', () => {
  it('AC-3: 5 flash requests within 1 s render at most 3 flashes', () => {
    const limiter = new FlashLimiter();
    const shown = [0, 100, 200, 300, 400].filter((t) => limiter.request(t));
    expect(shown).toEqual([0, 100, 200]);
    expect(limiter.request(999)).toBe(false);
    expect(limiter.request(1000)).toBe(true); // the first has left the window
  });

  it('AC-4: a hit removing 40% of health gives a vignette of 0.4, gone by 300 ms', () => {
    const vignette = new DamageVignette();
    expect(vignette.hit(0.4, 1000)).toBe(true);
    expect(vignette.intensity(1000)).toBe(0.4);
    expect(vignette.intensity(1000 + VIGNETTE_MS / 2)).toBeCloseTo(0.2);
    expect(vignette.intensity(1000 + VIGNETTE_MS)).toBe(0);
    expect(vignette.intensity(5000)).toBe(0);
    expect(vignette.intensity(900)).toBeCloseTo(0.4); // before the hit: not past the peak
  });

  it('a second hit keeps the stronger of the fading and the new vignette; zero and over-1 clamp', () => {
    const vignette = new DamageVignette();
    vignette.hit(0.6, 0);
    vignette.hit(0.1, 150);
    expect(vignette.intensity(150)).toBeCloseTo(0.3);
    expect(vignette.hit(0, 200)).toBe(false);
    vignette.hit(5, 400);
    expect(vignette.intensity(400)).toBe(1);
  });

  it('the limiter can refuse a vignette, which keeps fading', () => {
    const limiter = new FlashLimiter();
    const vignette = new DamageVignette(limiter);
    for (const t of [0, 10, 20]) vignette.hit(0.5, t);
    expect(vignette.hit(0.9, 30)).toBe(false);
    expect(vignette.intensity(30)).toBeLessThan(0.5);
  });

  it('desaturates below 25% health, ramping to the maximum at 0', () => {
    expect(desaturation(25, 100)).toBe(0);
    expect(desaturation(80, 100)).toBe(0);
    expect(desaturation(12.5, 100)).toBeCloseTo(MAX_DESATURATION / 2);
    expect(desaturation(0, 100)).toBe(MAX_DESATURATION);
    expect(desaturation(-5, 100)).toBe(MAX_DESATURATION);
    expect(desaturation(500, 100)).toBe(0);
    expect(desaturation(10, 0)).toBe(0);
  });
});

describe('reduce flashing (mw-e31.7)', () => {
  it('AC-1: with reduce-flashing on, 10 full-screen flashes in 1 s let 3 through, capped', () => {
    const limiter = new FlashLimiter();
    limiter.configure(true);
    const shown = Array.from({ length: 10 }, (_, i) => limiter.admit(i * 100, 1)).filter(
      (v) => v > 0,
    );
    expect(shown).toHaveLength(MAX_FLASHES_PER_SECOND);
    expect(shown.every((v) => v === REDUCED_FLASH_INTENSITY)).toBe(true);
    expect(limiter.admit(50, 0.1)).toBe(0);
  });

  it('a dim flash stays as it is, and with reduce-flashing off a flash is not capped', () => {
    const limiter = new FlashLimiter();
    limiter.configure(true);
    expect(limiter.admit(0, 0.1)).toBeCloseTo(0.1);
    limiter.configure(false);
    expect(limiter.admit(2000, 1)).toBe(1);
  });

  it('the damage vignette peaks at the cap with reduce-flashing on', () => {
    const limiter = new FlashLimiter();
    limiter.configure(true);
    const vignette = new DamageVignette(limiter);
    expect(vignette.hit(0.9, 0)).toBe(true);
    expect(vignette.intensity(0)).toBe(REDUCED_FLASH_INTENSITY);
  });
});
