// The material look of an entity in element states (mw-e03.28): the table's per-state looks (wet
// darkening, frost overlay, ember glow, charge shimmer) combined into one set of parameters for the
// renderer: an albedo tint, an emissive glow, a roughness and a pulse rate. Pure arithmetic; the
// Three.js side (src/render/element-look.ts) only applies the result to the entity's materials.
//
// Looks combine in table order as sequential mixes, so a wet frozen thing is darkened and then iced,
// glows add, the shiniest surface wins and a pulse needs a glow to pulse.

import type { ElementLookDef } from '@content/index';
import { parseHexColour } from './curves.ts';

export type LookRgb = readonly [number, number, number];

/** The renderer's parameters for one entity. */
export interface CombinedLook {
  /** Albedo moves this far (0–1) towards `tint`; 0 leaves it alone. */
  readonly tintMix: number;
  readonly tint: LookRgb;
  /** Glow colour already scaled by its intensity (rgb may exceed 1 when glows stack). */
  readonly emissive: LookRgb;
  /** Roughness to take, or undefined to keep the material's own. */
  readonly roughness: number | undefined;
  /** Glow pulses per second (0 = steady). */
  readonly pulseHz: number;
}

/** `a` moved `t` of the way to `b`. */
const mixRgb = (a: LookRgb, b: LookRgb, t: number): LookRgb => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
];

/** Combines looks in order; undefined when there are none (the entity keeps its own look). */
export function combineLooks(looks: readonly ElementLookDef[]): CombinedLook | undefined {
  if (looks.length === 0) return undefined;
  let keep = 1;
  let mixed: LookRgb = [0, 0, 0];
  let glow: LookRgb = [0, 0, 0];
  let roughness: number | undefined;
  let pulseHz = 0;
  for (const look of looks) {
    if (look.tint !== undefined && look.tintMix > 0) {
      mixed = mixRgb(mixed, parseHexColour(look.tint), look.tintMix);
      keep *= 1 - look.tintMix;
    }
    if (look.emissive !== undefined && look.emissiveIntensity > 0) {
      const colour = parseHexColour(look.emissive);
      const k = look.emissiveIntensity;
      glow = [glow[0] + colour[0] * k, glow[1] + colour[1] * k, glow[2] + colour[2] * k];
      pulseHz = Math.max(pulseHz, look.pulseHz);
    }
    if (look.roughness !== undefined) {
      roughness = roughness === undefined ? look.roughness : Math.min(roughness, look.roughness);
    }
  }
  const tintMix = 1 - keep;
  const tint: LookRgb =
    tintMix > 0 ? [mixed[0] / tintMix, mixed[1] / tintMix, mixed[2] / tintMix] : [1, 1, 1];
  return { tintMix, tint, emissive: glow, roughness, pulseHz };
}

/**
 * Glow strength at `seconds` for a pulse of `hz` (a steady look, or reduced motion, is 1). A pulse
 * swings between 0.55 and 1 so the thing never goes dark, and stays at or under 3 Hz.
 */
export function pulseFactor(hz: number, seconds: number, reducedMotion: boolean): number {
  if (hz <= 0 || reducedMotion) return 1;
  return 0.775 + 0.225 * Math.sin(2 * Math.PI * Math.min(hz, 3) * seconds);
}
