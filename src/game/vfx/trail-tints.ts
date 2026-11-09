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
  arrowTypes: z.record(z.string(), hex),
  glow: z.tuple([hex, hex, hex]),
  alpha: z.strictObject({ swing: alpha, arrow: alpha, arrowFocused: alpha }),
});

/** An sRGB colour, each channel 0–1. */
export type Rgb = readonly [number, number, number];

/** The tints, baked to rgb floats. */
export interface TrailTints {
  readonly damage: Readonly<Record<DamageTypeName, Rgb>>;
  readonly neutral: Rgb;
  readonly arrow: Rgb;
  /** Trail colour of the arrow types that have their own (by arrow content id). */
  readonly arrowTypes: Readonly<Record<string, Rgb>>;
  /** Charge-glow colours for steps 1 (33%), 2 (66%) and 3 (100%). */
  readonly glow: readonly [Rgb, Rgb, Rgb];
  readonly swingAlpha: number;
  readonly arrowAlpha: number;
  /** Opacity of a focused shot's trail: well above the plain one. */
  readonly arrowFocusedAlpha: number;
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
    arrowTypes: Object.freeze(
      Object.fromEntries(Object.entries(data.arrowTypes).map(([id, c]) => [id, parseHexColour(c)])),
    ),
    glow: Object.freeze([parseHexColour(g1), parseHexColour(g2), parseHexColour(g3)] as const),
    swingAlpha: data.alpha.swing,
    arrowAlpha: data.alpha.arrow,
    arrowFocusedAlpha: data.alpha.arrowFocused,
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

/** Half the width of a plain arrow trail's ribbon, metres. */
export const ARROW_HALF_WIDTH = 0.025;

/** A focused shot's ribbon is this many times as wide. */
export const FOCUSED_WIDTH_FACTOR = 2;

/** How far a focused trail's colour is lifted toward white. */
export const FOCUSED_BRIGHTEN = 0.4;

/** Which arrow trail look: the plain flight ribbon or the brighter one of a focused shot. */
export type ArrowTrailVariant = 'standard' | 'focused';

/** What an arrow's flight ribbon looks like. */
export interface ArrowTrailLook {
  readonly variant: ArrowTrailVariant;
  readonly rgb: Rgb;
  readonly alpha: number;
  /** Half the ribbon's width, metres. */
  readonly halfWidth: number;
}

/**
 * The trail look of arrow `arrowId`: its type's own tint (the plain arrow colour when it has none).
 * A focused shot (mw-e05.4) gets the focused variant: the same hue lifted toward white, at a much
 * higher opacity and twice the width, so a well-timed shot is seen leaving the bow.
 */
export function arrowTrailLook(
  tints: TrailTints,
  arrowId: string,
  focused: boolean,
): ArrowTrailLook {
  const base = tints.arrowTypes[arrowId] ?? tints.arrow;
  if (!focused) {
    return { variant: 'standard', rgb: base, alpha: tints.arrowAlpha, halfWidth: ARROW_HALF_WIDTH };
  }
  const lift = (c: number): number => c + (1 - c) * FOCUSED_BRIGHTEN;
  return {
    variant: 'focused',
    rgb: [lift(base[0]), lift(base[1]), lift(base[2])],
    alpha: tints.arrowFocusedAlpha,
    halfWidth: ARROW_HALF_WIDTH * FOCUSED_WIDTH_FACTOR,
  };
}
