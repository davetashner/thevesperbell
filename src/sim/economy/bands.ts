// The economy's numeric bands (mw-e20.1, docs/design/economy.md): the ranges merchants and price
// modifiers must stay inside. One source for the price model (./price.ts) and, through
// src/content/types/merchant.ts, for the merchant validator (mw-e20.2), so the design doc, the data
// check and the price function cannot drift apart. Pure data: no DOM, wall clock or randomness.

/** An inclusive numeric band with the value a merchant uses when its file sets none. */
export interface Band {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

/** Whether `value` lies inside `band` (inclusive, with a hair of float slack). */
export function inBand(
  band: { readonly min: number; readonly max: number },
  value: number,
): boolean {
  return value >= band.min - 1e-9 && value <= band.max + 1e-9;
}

/** Merchant markup on what the player buys: price = value x markup. */
export const MARKUP_BAND: Band = { min: 1.1, max: 1.5, default: 1.3 };
/** Fraction of an item's value a merchant pays when the player sells: price = value x buyRate. */
export const BUY_RATE_BAND: Band = { min: 0.3, max: 0.6, default: 0.4 };
/** Extra multiplier on the buy rate for items in a merchant's specialties. */
export const SPECIALTY_BONUS_BAND: Band = { min: 1.1, max: 1.3, default: 1.2 };
/** A fence's multiplier on the sell price of stolen goods. */
export const STOLEN_FACTOR_BAND: Band = { min: 0.5, max: 0.8, default: 0.6 };
/** Player haggle result as a fraction: buy price x (1 - h), sell price x (1 + h). Negative = failed. */
export const HAGGLE_BAND = { min: -0.05, max: 0.1 } as const;
/** Multiplier from the world (a famine, a festival) on every price in a region. */
export const WORLD_PRICE_BAND = { min: 0.8, max: 1.25 } as const;
/** Target ratio of obtainable gold to sink cost for a region (economy doc, "Target gold curve"). */
export const OBTAINABLE_SINK_RATIO_BAND = { min: 0.6, max: 0.8 } as const;
/** Gold for a night at an inn (economy doc, "Inn bed"): a service price fixed by the innkeeper. */
export const INN_BED_PRICE_BAND = { min: 8, max: 15 } as const;
/** Crowns for one trainer technique (economy doc, "Sinks"): rises with the technique's tier. */
export const TRAINER_PRICE_BAND = { min: 100, max: 400 } as const;
/** The price floor in gold. */
export const MIN_PRICE = 1;

/** Per-band multipliers on what the player pays (`buy`) and is paid (`sell`). */
export const DISPOSITION_MULTIPLIERS = {
  cold: { buy: 1.15, sell: 0.85 },
  neutral: { buy: 1, sell: 1 },
  friendly: { buy: 0.92, sell: 1.08 },
  devoted: { buy: 0.85, sell: 1.15 },
} as const;

/** Disposition bands, coldest first; `hostile` merchants refuse to trade at all. */
export const DISPOSITION_BANDS = ['hostile', 'cold', 'neutral', 'friendly', 'devoted'] as const;
export type DispositionBand = (typeof DISPOSITION_BANDS)[number];
/** The band used until disposition tracking (mw-e22.4) exists. */
export const NEUTRAL_DISPOSITION: DispositionBand = 'neutral';
