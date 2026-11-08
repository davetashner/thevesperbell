import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { applyLook, lookAt, mixHex, type TimeOfDayLook } from './time-of-day';

const look: TimeOfDayLook = {
  keyframes: [
    { minute: 0, ambient: 0.1, directional: 0.1, sky: '#000000' },
    { minute: 720, ambient: 0.5, directional: 0.6, sky: '#ffffff' },
    { minute: 1200, ambient: 0.1, directional: 0.1, sky: '#000000' },
  ],
};

describe('a scene day and night look (mw-ju8.43)', () => {
  it('AC-1: the look is the keyframe on its minute and blends between keyframes', () => {
    expect(lookAt(look, 720)).toEqual({ ambient: 0.5, directional: 0.6, sky: '#ffffff' });
    const half = lookAt(look, 360);
    expect(half.ambient).toBeCloseTo(0.3);
    expect(half.directional).toBeCloseTo(0.35);
    expect(half.sky).toBe('#808080');
  });

  it('AC-1: it wraps past midnight, so the last keyframe fades into the first', () => {
    const late = lookAt(look, 1320); // 22:00: halfway from 20:00 (0.1) to 24:00 (0.1)
    expect(late.ambient).toBeCloseTo(0.1);
    const wrap: TimeOfDayLook = {
      keyframes: [
        { minute: 60, ambient: 0.2, directional: 0 },
        { minute: 1380, ambient: 0.6, directional: 0 },
      ],
    };
    expect(lookAt(wrap, 1380 + 60).ambient).toBeCloseTo(0.4); // 00:00, halfway
    expect(lookAt(wrap, 30).ambient).toBeCloseTo(0.3);
    expect(lookAt(wrap, 1440 + 720).ambient).toBeCloseTo(lookAt(wrap, 720).ambient);
    expect(lookAt(wrap, -60).ambient).toBeCloseTo(lookAt(wrap, 1380).ambient);
  });

  it('AC-1: noon is brighter than 22:00 and dusk and dawn sit between', () => {
    const lane = loadGameContent().get('scene', 'briar-glen-lane').light?.timeOfDay;
    if (lane === undefined) throw new Error('the lane has a day and night look');
    const at = (h: number, m = 0) => lookAt(lane, h * 60 + m);
    expect(at(12).ambient).toBeGreaterThan(at(22).ambient * 3);
    expect(at(12).directional).toBeGreaterThan(at(22).directional);
    expect(at(19).ambient).toBeGreaterThan(at(22).ambient);
    expect(at(19).ambient).toBeLessThan(at(12).ambient);
    expect(at(6).ambient).toBeLessThan(at(12).ambient);
    expect(at(22).ambient).toBeGreaterThan(0.05); // dark but playable
    expect(at(22).sky).not.toBe(at(12).sky);
  });

  it('refuses a look with no keyframes', () => {
    expect(() => lookAt({ keyframes: [] }, 0)).toThrow(RangeError);
  });

  it('keeps a sky only when a keyframe has one', () => {
    const mixed: TimeOfDayLook = {
      keyframes: [
        { minute: 0, ambient: 0, directional: 0 },
        { minute: 600, ambient: 1, directional: 1, sky: '#112233' },
      ],
    };
    expect(lookAt(mixed, 300).sky).toBe('#112233');
    expect(lookAt(mixed, 1000).sky).toBe('#112233');
    expect(
      lookAt(
        {
          keyframes: [
            { minute: 0, ambient: 0, directional: 0 },
            { minute: 9, ambient: 0, directional: 0 },
          ],
        },
        5,
      ).sky,
    ).toBeUndefined();
    expect(mixHex('#000000', '#ff0000', 0.5)).toBe('#800000');
  });

  it('AC-1: applying a look sets the ambient and only the brightest directional light', () => {
    const dir = (id: string, level: number) => ({
      id,
      direction: { x: 0, y: -1, z: 0 },
      level,
      reach: 10,
    });
    const env = {
      ambient: 0.28,
      ambientZones: [],
      directional: [dir('fill', 0.1), dir('moon', 0.22)],
    };
    const out = applyLook(env, { ambient: 0.6, directional: 0.7, sky: undefined });
    expect(out.ambient).toBe(0.6);
    expect(out.directional.map((d) => d.level)).toEqual([0.1, 0.7]);
    expect(env.ambient).toBe(0.28); // the sim's environment is untouched
    expect(
      applyLook({ ...env, directional: [] }, { ambient: 0.2, directional: 1, sky: undefined }),
    ).toMatchObject({ ambient: 0.2, directional: [] });
  });
});
