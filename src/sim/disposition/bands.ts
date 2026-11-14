// Disposition scale and stances (mw-e12.9): a creature's attitude toward the player is one number,
// -100 (hates) to 100 (devoted), and a stance read off it by fixed thresholds:
//
//   hostile < -50 <= wary < -10 <= neutral <= 10 < friendly <= 50 < devoted
//
// These five names are the creature-level vocabulary for UI and dialogue; they are not the faction
// ladder in ../factions/stance.ts (ally..hostile, prey, predator), which describes groups and the
// food chain.
//
// NPC bands (mw-e22.4) are a second, deliberately different reading of the same number, for the
// people dialogue, prices and help talk to (the bead's wording: hostile < -50, cold, neutral, friendly,
// devoted > 75). An NPC is neutral across a wide middle (-10..50: a stranger who has been civil is
// still a stranger), friendly from 51 and devoted above 75, where a creature's stance is friendly from
// 11 and devoted above 50. Both functions read one score; neither replaces the other, and each has
// its own event (`DispositionStanceChanged` vs `disposition.bandChanged`).

import type { Stance } from '../factions/stance';

/** Lowest and highest disposition. */
export const DISPOSITION_MIN = -100;
export const DISPOSITION_MAX = 100;

/** Every disposition stance, coldest to warmest. */
export const DISPOSITION_STANCES = ['hostile', 'wary', 'neutral', 'friendly', 'devoted'] as const;

/** How a creature feels about the player, read off its disposition. */
export type DispositionStance = (typeof DISPOSITION_STANCES)[number];

/** Upper bounds: below `HOSTILE_BELOW` hostile, below `WARY_BELOW` wary, up to `NEUTRAL_UP_TO` neutral. */
export const HOSTILE_BELOW = -50;
export const WARY_BELOW = -10;
export const NEUTRAL_UP_TO = 10;
export const FRIENDLY_UP_TO = 50;

/** `value` held to -100..100. */
export function clampDisposition(value: number): number {
  return Math.min(DISPOSITION_MAX, Math.max(DISPOSITION_MIN, value));
}

/** The stance a disposition score reads as. */
export function dispositionStance(score: number): DispositionStance {
  if (score < HOSTILE_BELOW) return 'hostile';
  if (score < WARY_BELOW) return 'wary';
  if (score <= NEUTRAL_UP_TO) return 'neutral';
  if (score <= FRIENDLY_UP_TO) return 'friendly';
  return 'devoted';
}

/**
 * The disposition a faction stance seeds when a creature's definition gives no baseline: the middle
 * of the matching stance, so a friendly shopkeeper starts friendly and a hostile goblin hostile.
 * Prey (it hunts the player) seeds hostile; predator (it fears the player) seeds wary.
 */
export const STANCE_SEED: Readonly<Record<Stance, number>> = Object.freeze({
  ally: 75,
  friendly: 30,
  neutral: 0,
  wary: -30,
  hostile: -75,
  prey: -75,
  predator: -30,
});

/** Every NPC band, coldest to warmest. */
export const NPC_BANDS = ['hostile', 'cold', 'neutral', 'friendly', 'devoted'] as const;

/** How an NPC feels about the player (dialogue, prices, help), read off its disposition. */
export type NpcBand = (typeof NPC_BANDS)[number];

/** Upper bounds of the NPC bands: below -50 hostile, below -10 cold, up to 50 neutral, up to 75 friendly. */
export const NPC_COLD_BELOW = -10;
export const NPC_NEUTRAL_UP_TO = 50;
export const NPC_FRIENDLY_UP_TO = 75;

/** The NPC band a disposition score reads as. */
export function npcBand(score: number): NpcBand {
  if (score < HOSTILE_BELOW) return 'hostile';
  if (score < NPC_COLD_BELOW) return 'cold';
  if (score <= NPC_NEUTRAL_UP_TO) return 'neutral';
  if (score <= NPC_FRIENDLY_UP_TO) return 'friendly';
  return 'devoted';
}
