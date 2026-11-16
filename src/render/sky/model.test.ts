import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  moonDirection,
  nightAmount,
  skyAt,
  smoothstep,
  SUNRISE,
  SUNSET,
  sunDirection,
  twilightAmount,
  type SkyDomeSettings,
} from './model';

const DOME: SkyDomeSettings = { stars: 0.8, clouds: 0.4, wind: 90, seed: 7 };
const close = (a: readonly number[], b: readonly number[]): void => {
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i] ?? NaN, 5);
  });
};

describe('procedural sky', () => {
  it('the sun rises in the east at 06:00, stands highest at noon and sets in the west at 18:00', () => {
    close(sunDirection(SUNRISE), [1, 0, 0]);
    close(sunDirection(SUNSET), [-1, 0, 0]);
    const noon = sunDirection(720);
    expect(noon[1]).toBeGreaterThan(0.8);
    expect(noon[2]).toBeLessThan(0); // leans south
    expect(sunDirection(0)[1]).toBeLessThan(-0.8); // midnight: below the horizon
    close(sunDirection(720 + 1440), noon); // wraps by day
    close(sunDirection(720 - 1440), noon);
  });

  it('the moon stands opposite the sun', () => {
    const sun = sunDirection(200);
    close(moonDirection(200), [-sun[0], -sun[1], -sun[2]]);
  });

  it('night falls as the sun sinks, and the twilight glow peaks with the sun on the horizon', () => {
    expect(nightAmount(0.5)).toBe(0);
    expect(nightAmount(-0.5)).toBe(1);
    expect(nightAmount(0)).toBeCloseTo(0.5, 5);
    expect(twilightAmount(0)).toBe(1);
    expect(twilightAmount(0.5)).toBe(0);
    expect(twilightAmount(-0.5)).toBe(0);
  });

  it('smoothstep clamps and eases in both directions', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(0.84375, 5);
  });

  it('stars show only at night, scaled by the scene’s density, and clouds keep their cover', () => {
    const noon = skyAt(DOME, '#8FA8C8', 720);
    const midnight = skyAt(DOME, '#0B0F1E', 0);
    expect(noon.stars).toBe(0);
    expect(midnight.stars).toBeCloseTo(0.8, 5);
    expect(noon.clouds).toBe(0.4);
    expect(skyAt({ ...DOME, stars: 3, clouds: -1 }, '#0B0F1E', 0)).toMatchObject({
      stars: 1,
      clouds: 0,
    });
  });

  it('the horizon warms to hearth amber at sunrise and the zenith is deeper than the horizon by day', () => {
    const dawn = skyAt(DOME, '#8A8FA8', SUNRISE);
    const noon = skyAt(DOME, '#8FA8C8', 720);
    expect(dawn.twilight).toBe(1);
    expect(dawn.horizon[0]).toBeGreaterThan(dawn.horizon[2]); // warm: more red than blue
    const brightness = (c: readonly number[]): number => c.reduce((sum, v) => sum + v, 0);
    expect(brightness(noon.zenith)).toBeLessThan(brightness(noon.horizon));
    expect(dawn.sunColour[0]).toBeGreaterThan(dawn.sunColour[2]);
  });

  it('clouds are parchment by day and dark at night; the wind bearing becomes a drift direction', () => {
    const noon = skyAt(DOME, '#8FA8C8', 720);
    const midnight = skyAt(DOME, '#0B0F1E', 0);
    close(noon.cloudColour, hexToRgb('#EFE2C4'));
    expect(midnight.cloudColour[0]).toBeLessThan(0.3);
    close(noon.wind, [1, 0]); // 90°: towards +x
    expect(noon.seed).toBe(7);
  });
});
