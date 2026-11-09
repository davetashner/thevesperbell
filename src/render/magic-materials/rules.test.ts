import { describe, expect, it } from 'vitest';
import {
  DEATH_DISSOLVE,
  DEATH_DISSOLVE_DELAY_SECONDS,
  DEATH_DISSOLVE_SECONDS,
  DEFAULT_MAGIC_LOOK,
  MAGIC_MATERIAL_KINDS,
  MAX_MAGIC_INTENSITY,
  MAX_MAGIC_PULSE_HZ,
  dissolveProgress,
  distortionAllowed,
  distortionDrawn,
  magicPulse,
  resolveMagicLook,
} from './rules';

describe('magic material rules', () => {
  it('AC-1: the library names all six materials of the bead', () => {
    expect([...MAGIC_MATERIAL_KINDS].sort()).toEqual(
      ['dissolve', 'distortion', 'fresnel', 'pulse', 'rune', 'soft-particle'].sort(),
    );
  });

  it('every material is parameterised by tint and intensity, kept in range', () => {
    expect(resolveMagicLook()).toEqual(DEFAULT_MAGIC_LOOK);
    expect(resolveMagicLook({ tint: 0xff7a1a, intensity: 2 })).toEqual({
      tint: 0xff7a1a,
      intensity: 2,
    });
    expect(resolveMagicLook({ intensity: -3 }).intensity).toBe(0);
    expect(resolveMagicLook({ intensity: 99 }).intensity).toBe(MAX_MAGIC_INTENSITY);
    expect(resolveMagicLook({ intensity: Number.NaN }).intensity).toBe(1);
    expect(resolveMagicLook({ tint: Number.NaN }).tint).toBe(DEFAULT_MAGIC_LOOK.tint);
    expect(resolveMagicLook({ tint: 0x1ffffff }).tint).toBe(0xffffff);
  });

  it('AC-2: distortion is High only; on Low none of any number requested is drawn', () => {
    expect(distortionAllowed('high')).toBe(true);
    expect(distortionAllowed('low')).toBe(false);
    expect(distortionDrawn('high', 6)).toBe(6);
    expect(distortionDrawn('low', 6)).toBe(0);
    expect(distortionDrawn('high', -2)).toBe(0);
  });

  it('a pulse never flashes faster than 3 Hz and is steady in reduced motion', () => {
    expect(MAX_MAGIC_PULSE_HZ).toBeLessThan(3);
    expect(magicPulse(0, 0.3, false)).toBe(1);
    expect(magicPulse(Number.NaN, 0.3, false)).toBe(1);
    expect(magicPulse(2, 0.3, true)).toBe(1);
    // A 40 Hz request is capped: the sine repeats every 0.5 s, not every 25 ms.
    expect(magicPulse(40, 0.1, false)).toBeCloseTo(magicPulse(2, 0.1, false), 9);
    let low = 1;
    let high = 0;
    for (let t = 0; t < 1; t += 0.01) {
      const p = magicPulse(2, t, false);
      low = Math.min(low, p);
      high = Math.max(high, p);
    }
    expect(low).toBeGreaterThanOrEqual(0.55 - 1e-9);
    expect(high).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('dissolve timing', () => {
  it('AC-3: the death dissolve waits for the collapse, then runs over 1.2 s', () => {
    expect(DEATH_DISSOLVE_SECONDS).toBe(1.2);
    expect(DEATH_DISSOLVE).toEqual({
      delay: DEATH_DISSOLVE_DELAY_SECONDS,
      duration: DEATH_DISSOLVE_SECONDS,
    });
    expect(dissolveProgress(DEATH_DISSOLVE, 0)).toBe(0);
    expect(dissolveProgress(DEATH_DISSOLVE, DEATH_DISSOLVE_DELAY_SECONDS)).toBe(0);
    expect(dissolveProgress(DEATH_DISSOLVE, DEATH_DISSOLVE_DELAY_SECONDS + 0.6)).toBeCloseTo(0.5);
    expect(dissolveProgress(DEATH_DISSOLVE, DEATH_DISSOLVE_DELAY_SECONDS + 1.2)).toBe(1);
    expect(dissolveProgress(DEATH_DISSOLVE, 99)).toBe(1);
  });

  it('a zero-length dissolve is whole until its delay, then gone', () => {
    expect(dissolveProgress({ delay: 1, duration: 0 }, 0.5)).toBe(0);
    expect(dissolveProgress({ delay: 1, duration: 0 }, 1)).toBe(1);
  });
});
