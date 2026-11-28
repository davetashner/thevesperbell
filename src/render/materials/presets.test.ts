import { describe, expect, it } from 'vitest';
import {
  LIGHTING_PRESETS,
  PALETTE,
  STYLIZED_PRESETS,
  WET_DARKEN,
  clampAlbedo,
  hexToLinear,
  isLightingPreset,
  presetForKeyLight,
  rampLevel,
  srgbToLinear,
  wetAlbedoFactor,
} from './presets.ts';

describe('stylized material parameters (mw-e37.13)', () => {
  it('the ramp has three soft bands: shadow, middle and lit, each flat away from its edges', () => {
    for (const preset of LIGHTING_PRESETS) {
      const params = STYLIZED_PRESETS[preset];
      const [shadow, mid, lit] = params.bandLevels;
      expect(rampLevel(-1, params)).toBeCloseTo(shadow);
      expect(rampLevel((params.bandEdges[0] + params.bandEdges[1]) / 2, params)).toBeCloseTo(mid);
      expect(rampLevel(1, params)).toBeCloseTo(lit);
      // Monotonic and soft: no step jumps more than a band over a 0.01 move in N·L.
      let last = rampLevel(-1, params);
      for (let x = -1; x <= 1; x += 0.01) {
        const level = rampLevel(x, params);
        expect(level).toBeGreaterThanOrEqual(last - 1e-9);
        expect(level - last).toBeLessThan(0.1);
        last = level;
      }
    }
  });

  it('AC-3: a wet surface keeps 70–80 % of its albedo; dry keeps all of it; out-of-range is clamped', () => {
    expect(WET_DARKEN).toBeGreaterThanOrEqual(0.2);
    expect(WET_DARKEN).toBeLessThanOrEqual(0.3);
    expect(wetAlbedoFactor(1)).toBeCloseTo(1 - WET_DARKEN);
    expect(wetAlbedoFactor(0)).toBe(1);
    expect(wetAlbedoFactor(3)).toBeCloseTo(1 - WET_DARKEN);
    expect(wetAlbedoFactor(-1)).toBe(1);
  });

  it('AC-5: pure black and pure white albedo are held between ink and cream, never black or white', () => {
    const black = clampAlbedo([0, 0, 0]);
    const white = clampAlbedo([1, 1, 1]);
    expect(black).toEqual(hexToLinear(PALETTE.ink));
    expect(white).toEqual(hexToLinear(PALETTE.cream));
    expect(Math.min(...black)).toBeGreaterThan(0);
    expect(Math.max(...white.slice(1))).toBeLessThan(1);
    expect(clampAlbedo([0.2, 0.2, 0.2])).toEqual([0.2, 0.2, 0.2]);
  });

  it('every preset tints shadows toward dusk (blue-violet, never neutral) and lifts them', () => {
    for (const preset of LIGHTING_PRESETS) {
      const params = STYLIZED_PRESETS[preset];
      const [r, g, b] = hexToLinear(params.shadowTint);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
      expect(params.shadowLift).toBeGreaterThan(0);
      expect(params.shadowHue).toBeGreaterThan(0);
    }
  });

  it('converts sRGB to linear at both ends of the curve, and names the presets', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92);
    expect(srgbToLinear(1)).toBeCloseTo(1);
    expect(isLightingPreset('golden-hour')).toBe(true);
    expect(isLightingPreset('noon')).toBe(false);
  });

  it('picks interior without a key light, night under moonlight and day under the sun', () => {
    expect(presetForKeyLight(null)).toBe('interior');
    expect(presetForKeyLight(0.08)).toBe('night');
    expect(presetForKeyLight(0.9)).toBe('day');
  });
});
