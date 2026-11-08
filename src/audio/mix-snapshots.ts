// Mix snapshot and duck data (mw-e28.9). Pure data: the situations the mix shifts between and the
// short ducks that let an important sound cut through. Gains are dB relative to the player's slider
// (0 = no change); `lowpassHz` omitted = filter open. The mix controller (mix.ts) ramps between these
// and layers them over the player's volumes, so none of it ever touches the settings.
import type { MixBusId } from './buses.ts';

export const SNAPSHOT_NAMES = ['explore', 'stealth', 'combat', 'menu', 'paused'] as const;
export type SnapshotName = (typeof SNAPSHOT_NAMES)[number];

export interface BusMix {
  /** dB relative to the player's bus volume. */
  readonly gainDb: number;
  /** Low-pass cutoff; omitted = open. */
  readonly lowpassHz?: number;
}

export interface Snapshot {
  /** Transition ramp when entering this snapshot, ms (250–1500). */
  readonly rampMs: number;
  /** Per-bus values; a bus left out is neutral (0 dB, open). */
  readonly buses: Readonly<Partial<Record<MixBusId, BusMix>>>;
}

export const SNAPSHOTS: Readonly<Record<SnapshotName, Snapshot>> = {
  /** The baseline: every bus at the player's volume. Eases back slowly after a fight. */
  explore: { rampMs: 1000, buses: {} },
  /** Sneaking: music sits back and the room tone comes forward so footsteps and voices carry. */
  stealth: {
    rampMs: 1500,
    buses: { music: { gainDb: -4 }, ambience: { gainDb: 2 }, sfx: { gainDb: 1 } },
  },
  /**
   * Combat: SFX forward, ambience pushed under the fight. Entered quickly. The music bus stays
   * where it is: the adaptive music controller (mw-e28.11) crossfades its layers on a bar line, and
   * a bus move at the moment combat starts would be a gain jump ahead of that crossfade.
   */
  combat: {
    rampMs: 500,
    buses: { ambience: { gainDb: -8 }, sfx: { gainDb: 2 } },
  },
  /** Title and full-screen menus: the world recedes behind soft, dull sound. */
  menu: {
    rampMs: 400,
    buses: {
      music: { gainDb: -3 },
      sfx: { gainDb: -6, lowpassHz: 2500 },
      ambience: { gainDb: -6, lowpassHz: 2500 },
    },
  },
  /** Pause menu: sfx and ambience muffled at 800 Hz, music lowered; UI stays crisp. */
  paused: {
    rampMs: 250,
    buses: {
      music: { gainDb: -6 },
      sfx: { gainDb: 0, lowpassHz: 800 },
      ambience: { gainDb: 0, lowpassHz: 800 },
    },
  },
};

export const DUCK_NAMES = ['parry', 'critical', 'ui-stinger'] as const;
export type DuckName = (typeof DUCK_NAMES)[number];

export interface Duck {
  /** dB each ducked bus drops to (negative). */
  readonly buses: Readonly<Partial<Record<MixBusId, number>>>;
  /** How long the duck holds, ms. */
  readonly holdMs: number;
  /** Ramp back to neutral, ms. */
  readonly releaseMs: number;
}

export const DUCKS: Readonly<Record<DuckName, Duck>> = {
  /** A parry's ring cuts through the music and room tone. */
  parry: { buses: { music: -6, ambience: -6 }, holdMs: 400, releaseMs: 200 },
  /** A critical hit: the same cut. */
  critical: { buses: { music: -6, ambience: -6 }, holdMs: 400, releaseMs: 200 },
  /** UI stingers (quest, level up) sit above gameplay sfx. */
  'ui-stinger': { buses: { sfx: -4 }, holdMs: 600, releaseMs: 200 },
};

/** Ramp down into a duck, ms: fast enough to catch the hit, slow enough not to click. */
export const DUCK_ATTACK_MS = 30;
