// Trail and charge-glow tints (mw-e29.6), held in data: `data/trail-tints.json` names one colour per
// damage type (the trail of a swing takes the dominant type of its move's damage), the neutral colour
// for a move that deals none, the faint focused-arrow trail and its alpha, and the three charge-glow
// steps (33%, 66%, 100%). Colours are `#RRGGBB`; this module validates the file and bakes rgb floats.

import { DAMAGE_TYPES, type DamageTypeName } from '@content/index';
import { z } from 'zod';
import { parseHexColour } from './curves.ts';
import tintsJson from './data/trail-tints.json';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'a #RRGGBB colour');
const alpha = z.number().min(0).max(1);

const damageTints = z.strictObject(
  Object.fromEntries(DAMAGE_TYPES.map((type) => [type, hex])) as Record<DamageTypeName, typeof hex>,
);

/** Schema of `data/trail-tints.json`. */
export const trailTintsSchema = z.strictObject({
  damage: damageTints,
  neutral: hex,
  arrow: hex,
  glow: z.tuple([hex, hex, hex]),
  alpha: z.strictObject({ swing: alpha, arrow: alpha }),
});

/** An sRGB colour, each channel 0–1. */
export type Rgb = readonly [number, number, number];

/** The tints, baked to rgb floats. */
export interface TrailTints {
  readonly damage: Readonly<Record<DamageTypeName, Rgb>>;
  readonly neutral: Rgb;
  readonly arrow: Rgb;
  /** Charge-glow colours for steps 1 (33%), 2 (66%) and 3 (100%). */
  readonly glow: readonly [Rgb, Rgb, Rgb];
  readonly swingAlpha: number;
  readonly arrowAlpha: number;
}

/** Validates and bakes tint data; throws a ZodError naming the bad path. */
export function compileTrailTints(input: unknown): TrailTints {
  const data = trailTintsSchema.parse(input);
  const damage = Object.fromEntries(
    DAMAGE_TYPES.map((type) => [type, parseHexColour(data.damage[type])]),
  ) as unknown as Record<DamageTypeName, Rgb>;
  const [g1, g2, g3] = data.glow;
  return Object.freeze({
    damage: Object.freeze(damage),
    neutral: parseHexColour(data.neutral),
    arrow: parseHexColour(data.arrow),
    glow: Object.freeze([parseHexColour(g1), parseHexColour(g2), parseHexColour(g3)] as const),
    swingAlpha: data.alpha.swing,
    arrowAlpha: data.alpha.arrow,
  });
}

/** The committed tints (src/game/vfx/data/trail-tints.json). */
export function trailTints(): TrailTints {
  return compileTrailTints(tintsJson);
}

/**
 * The damage type with the largest amount; ties go to the earlier type in canonical order. Undefined
 * when nothing is dealt.
 */
export function dominantDamageType(
  amounts: Readonly<Partial<Record<string, number>>>,
): DamageTypeName | undefined {
  let best: DamageTypeName | undefined;
  let most = 0;
  for (const type of DAMAGE_TYPES) {
    const amount = amounts[type] ?? 0;
    if (amount > most) {
      best = type;
      most = amount;
    }
  }
  return best;
}

/** The trail colour for a move's damage amounts: the dominant type's tint, else the neutral one. */
export function swingTint(
  tints: TrailTints,
  amounts: Readonly<Partial<Record<string, number>>>,
): Rgb {
  const type = dominantDamageType(amounts);
  return type === undefined ? tints.neutral : tints.damage[type];
}
