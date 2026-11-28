// The material look of an entity in element states (mw-e03.28): the table's per-state looks (wet
// darkening, frost overlay, ember glow, charge shimmer) combined into one set of parameters for the
// renderer: an albedo tint, an emissive glow, a roughness and a pulse rate. Pure arithmetic; the
// Three.js side (src/render/element-look.ts) only applies the result to the entity's materials.
//
// Precedence (mw-e29.8): looks are passed lowest precedence first (the bridge sorts by each state's
// `precedence`: wet 10 < burning 20 < charged 30 < frozen 40). They combine as sequential mixes, so
// a wet frozen thing is darkened and then iced; the highest precedence that sets a roughness wins
// it (frozen beats wet whatever their numbers); glows add; a pulse needs a glow to pulse.

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
  /** Metalness to take (a sheen bump), or undefined to keep the material's own. */
  readonly metalness: number | undefined;
  /** Environment reflection strength to take, or undefined to keep the material's own. */
  readonly envMapIntensity: number | undefined;
  /** Glow pulses per second (0 = steady). */
  readonly pulseHz: number;
  /** Wet mask for the stylized material (0 = dry … 1 = soaked): the strongest look's wetness. */
  readonly wetness: number;
  /** The tint of the looks that carry no wetness: a stylized surface shows wetness in their place. */
  readonly dryTintMix: number;
  readonly dryTint: LookRgb;
}

/** `a` moved `t` of the way to `b`. */
const mixRgb = (a: LookRgb, b: LookRgb, t: number): LookRgb => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
];

/** Combines looks, lowest precedence first (later layers win); undefined when there are none (the entity keeps its own look). */
export function combineLooks(looks: readonly ElementLookDef[]): CombinedLook | undefined {
  if (looks.length === 0) return undefined;
  let keep = 1;
  let mixed: LookRgb = [0, 0, 0];
  let glow: LookRgb = [0, 0, 0];
  let roughness: number | undefined;
  let metalness: number | undefined;
  let envMapIntensity: number | undefined;
  let pulseHz = 0;
  let wetness = 0;
  let dryKeep = 1;
  let dryMixed: LookRgb = [0, 0, 0];
  for (const look of looks) {
    if (look.tint !== undefined && look.tintMix > 0) {
      const tint = parseHexColour(look.tint);
      mixed = mixRgb(mixed, tint, look.tintMix);
      keep *= 1 - look.tintMix;
      if (look.wetness <= 0) {
        dryMixed = mixRgb(dryMixed, tint, look.tintMix);
        dryKeep *= 1 - look.tintMix;
      }
    }
    wetness = Math.max(wetness, look.wetness);
    if (look.emissive !== undefined && look.emissiveIntensity > 0) {
      const colour = parseHexColour(look.emissive);
      const k = look.emissiveIntensity;
      glow = [glow[0] + colour[0] * k, glow[1] + colour[1] * k, glow[2] + colour[2] * k];
      pulseHz = Math.max(pulseHz, look.pulseHz);
    }
    if (look.roughness !== undefined) roughness = look.roughness;
    if (look.metalness !== undefined) metalness = look.metalness;
    if (look.envMapIntensity !== undefined) envMapIntensity = look.envMapIntensity;
  }
  const tintMix = 1 - keep;
  const tint: LookRgb =
    tintMix > 0 ? [mixed[0] / tintMix, mixed[1] / tintMix, mixed[2] / tintMix] : [1, 1, 1];
  const dryTintMix = 1 - dryKeep;
  const dryTint: LookRgb =
    dryTintMix > 0
      ? [dryMixed[0] / dryTintMix, dryMixed[1] / dryTintMix, dryMixed[2] / dryTintMix]
      : [1, 1, 1];
  return {
    tintMix,
    tint,
    emissive: glow,
    roughness,
    metalness,
    envMapIntensity,
    pulseHz,
    wetness,
    dryTintMix,
    dryTint,
  };
}

/**
 * Glow strength at `seconds` for a pulse of `hz` (a steady look, or reduced motion, is 1). A pulse
 * swings between 0.55 and 1 so the thing never goes dark, and stays at or under 3 Hz.
 */
export function pulseFactor(hz: number, seconds: number, reducedMotion: boolean): number {
  if (hz <= 0 || reducedMotion) return 1;
  return 0.775 + 0.225 * Math.sin(2 * Math.PI * Math.min(hz, 3) * seconds);
}
