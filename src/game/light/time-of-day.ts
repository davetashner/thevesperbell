// A scene's day and night look (mw-ju8.43). The scene's `light.timeOfDay` keyframes give the rendered
// ambient fill, key light level and sky colour at minutes of the day; `lookAt` blends between the two
// keyframes around a minute, wrapping past midnight, so dusk and dawn fade rather than snap.
//
// Render-only. The sim's light field keeps the scene's static levels (stealth reads those, so a
// guard sees the player the same at noon and at night, and recordings do not depend on the clock);
// `applyLook` only rewrites what the renderer is told of that environment.

import type { ResolvedLightEnvironment } from '@sim/index';

const MINUTES_PER_DAY = 1440;

/** One keyframe: how the scene looks at `minute` of the day. */
export interface TimeOfDayKey {
  readonly minute: number;
  readonly ambient: number;
  readonly directional: number;
  readonly sky?: string | undefined;
}

/** A scene's keyframes, ascending by minute (at least two). */
export interface TimeOfDayLook {
  readonly keyframes: readonly TimeOfDayKey[];
}

/** The blended look at one minute. */
export interface LookAt {
  readonly ambient: number;
  readonly directional: number;
  /** #RRGGBB, or undefined when the keyframes around it give no sky. */
  readonly sky: string | undefined;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Blends two #RRGGBB colours (in sRGB, which is how the keyframes are authored). */
export function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  let out = '#';
  for (let i = 0; i < 3; i++) {
    out += Math.round(lerp(channel(a, i), channel(b, i), t))
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

function keyAt(keys: readonly TimeOfDayKey[], index: number): TimeOfDayKey {
  const key = keys[index % keys.length];
  if (key === undefined) throw new RangeError('a day and night look needs keyframes');
  return key;
}

/** The look at `minute` (0-1439, fractions allowed): the keyframes either side, blended linearly. */
export function lookAt(look: TimeOfDayLook, minute: number): LookAt {
  const keys = look.keyframes;
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let next = keys.findIndex((key) => key.minute > m);
  if (next === -1) next = 0; // after the last keyframe: towards the first, tomorrow
  const from = keyAt(keys, next + keys.length - 1);
  const to = keyAt(keys, next);
  const start = from.minute > m ? from.minute - MINUTES_PER_DAY : from.minute;
  const end = to.minute <= m ? to.minute + MINUTES_PER_DAY : to.minute;
  const t = (m - start) / (end - start);
  return {
    ambient: lerp(from.ambient, to.ambient, t),
    directional: lerp(from.directional, to.directional, t),
    sky:
      from.sky !== undefined && to.sky !== undefined
        ? mixHex(from.sky, to.sky, t)
        : (from.sky ?? to.sky),
  };
}

/**
 * `environment` with its ambient level and its brightest directional light set to the look's: what the
 * renderer should mirror at that minute. The sim's field is left alone.
 */
export function applyLook(
  environment: ResolvedLightEnvironment,
  look: LookAt,
): ResolvedLightEnvironment {
  const levels = environment.directional.map((light) => light.level);
  const keyIndex = levels.indexOf(Math.max(...levels)); // the first brightest; -1 when there are none
  return {
    ...environment,
    ambient: look.ambient,
    directional: environment.directional.map((light, i) =>
      i === keyIndex ? { ...light, level: look.directional } : light,
    ),
  };
}
