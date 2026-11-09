// The magical material library's rules (mw-e29.7): what a spell, a summon or a death asks of the
// shared looks, with no GPU in sight so every rule is unit tested. The materials in this folder draw
// them; src/game/vfx/magic-materials.ts runs corpses on them. Dissolve, fresnel glow, heat haze,
// rune decals, emissive pulse and soft particles all take the same two knobs: a tint and an intensity.
//
// - Distortion (heat haze) is High only: on Low it is skipped and no distortion pass runs.
// - A pulse stays at or under 3 Hz (style bible §8, photosensitivity) and is steady in reduced motion.
// - A creature's death dissolves: it collapses first, then dissolves over 1.2 s, then is removed.

import type { VfxQualityTier } from '@content/index';

/** The materials of the library. */
export const MAGIC_MATERIAL_KINDS = [
  'dissolve',
  'fresnel',
  'distortion',
  'rune',
  'pulse',
  'soft-particle',
] as const;
export type MagicMaterialKind = (typeof MAGIC_MATERIAL_KINDS)[number];

/** How long a death dissolve runs, seconds (mw-e29.7 AC-3). */
export const DEATH_DISSOLVE_SECONDS = 1.2;
/**
 * Seconds from a creature's death to the start of its dissolve: the body falls (src/render/creatures
 * death.ts, 0.9 s, landing at 80 % of it) and the dissolve takes over as it comes to rest.
 */
export const DEATH_DISSOLVE_DELAY_SECONDS = 0.72;

/** The most any magical pulse flashes, hertz: under the 3 Hz photosensitivity ceiling. */
export const MAX_MAGIC_PULSE_HZ = 2;

/** Brightest an intensity may be asked for: emissive cores may exceed 1, but not blow out. */
export const MAX_MAGIC_INTENSITY = 4;

/** The two knobs every material takes. */
export interface MagicLook {
  /** sRGB colour, 0xRRGGBB. */
  readonly tint: number;
  /** Strength: 0 is invisible, 1 is the authored look. */
  readonly intensity: number;
}

/** The look a caller gets for the parts of it it leaves out: arcane violet (style bible §2.3). */
export const DEFAULT_MAGIC_LOOK: MagicLook = Object.freeze({ tint: 0x8b5cf6, intensity: 1 });

/** A look with every field filled in and kept in range. */
export function resolveMagicLook(look: Partial<MagicLook> = {}): MagicLook {
  const tint = Number.isFinite(look.tint) ? Math.trunc(look.tint ?? 0) & 0xffffff : undefined;
  const intensity = look.intensity;
  return {
    tint: tint ?? DEFAULT_MAGIC_LOOK.tint,
    intensity:
      intensity !== undefined && Number.isFinite(intensity)
        ? Math.min(Math.max(intensity, 0), MAX_MAGIC_INTENSITY)
        : DEFAULT_MAGIC_LOOK.intensity,
  };
}

/** Whether distortion may be drawn on `tier` (High only). */
export function distortionAllowed(tier: VfxQualityTier): boolean {
  return tier === 'high';
}

/** How many of `requested` distortion effects are drawn on `tier`: all on High, none on Low. */
export function distortionDrawn(tier: VfxQualityTier, requested: number): number {
  return distortionAllowed(tier) ? Math.max(0, Math.trunc(requested)) : 0;
}

/**
 * A pulse's strength at `seconds`: 1 when steady (no rate, or reduced motion), otherwise a sine
 * between 0.55 and 1 at the requested rate capped at MAX_MAGIC_PULSE_HZ.
 */
export function magicPulse(hz: number, seconds: number, reducedMotion: boolean): number {
  if (!(hz > 0) || reducedMotion) return 1;
  return 0.775 + 0.225 * Math.sin(2 * Math.PI * Math.min(hz, MAX_MAGIC_PULSE_HZ) * seconds);
}

/** When a dissolve starts and how long it runs, seconds. */
export interface DissolveSpec {
  readonly delay: number;
  readonly duration: number;
}

/** The death dissolve: after the collapse, 1.2 s. */
export const DEATH_DISSOLVE: DissolveSpec = Object.freeze({
  delay: DEATH_DISSOLVE_DELAY_SECONDS,
  duration: DEATH_DISSOLVE_SECONDS,
});

/** Dissolve progress at `elapsed` seconds into `spec`: 0 whole (also while waiting), 1 gone. */
export function dissolveProgress(spec: DissolveSpec, elapsed: number): number {
  if (!(spec.duration > 0)) return elapsed >= spec.delay ? 1 : 0;
  return Math.min(Math.max((elapsed - spec.delay) / spec.duration, 0), 1);
}
