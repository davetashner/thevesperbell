// Tinting a particle effect (mw-e29.10): a spell template's effects are drawn in neutral light greys
// and a spell's tint recolours them without any per-spell effect file. A tinted effect is a derived
// copy of the loaded effect with every colour stop remapped; the VfxSystem compiles it like any other
// effect, so tinting costs nothing per frame. Pure: no renderer, no randomness.

import { parseHexColour } from '../vfx/curves.ts';
import type { VfxEffectEntry } from '../vfx/effects.ts';

/** Luminance (0–1) at and above which a tinted colour starts to lift towards white. */
const TINT_FULL = 0.75;

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const hex = (channel: number): string =>
  Math.round(Math.min(Math.max(channel, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/**
 * `source` recoloured to `tint`, keeping its brightness: dark stays dark, a light grey becomes the
 * tint at full strength, and white stays white-hot (so a core is still the brightest part of a glow).
 */
export function tintColour(source: string, tint: string): string {
  const [sr, sg, sb] = parseHexColour(source);
  const [tr, tg, tb] = parseHexColour(tint);
  const l = luma(sr, sg, sb);
  const up = l >= TINT_FULL ? (l - TINT_FULL) / (1 - TINT_FULL) : 0;
  const down = l >= TINT_FULL ? 1 : l / TINT_FULL;
  const channel = (t: number): number => t * down + (1 - t) * up;
  return `#${hex(channel(tr))}${hex(channel(tg))}${hex(channel(tb))}`;
}

type Curve = string | readonly { readonly t: number; readonly color: string }[];

function tintCurve(curve: Curve, tint: string): string | { t: number; color: string }[] {
  return typeof curve === 'string'
    ? tintColour(curve, tint)
    : curve.map((key) => ({ t: key.t, color: tintColour(key.color, tint) }));
}

/** The id of `effectId` tinted `tint`: stable, so one derived effect serves every spell using it. */
export function tintedEffectId(effectId: string, tint: string): string {
  return `${effectId}~${tint.slice(1).toLowerCase()}`;
}

/** A copy of `effect` with every emitter's colour curve remapped to `tint`. */
export function tintEffect(effect: VfxEffectEntry, tint: string): VfxEffectEntry {
  return {
    ...effect,
    id: tintedEffectId(effect.id, tint),
    emitters: effect.emitters.map((emitter) => ({
      ...emitter,
      color: tintCurve(emitter.color, tint),
    })),
  };
}
