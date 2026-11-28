// The shared stylized material's parameters as data (mw-e37.13, style bible §2.1, §3, §6.1): one set
// per lighting preset, plus the palette limits every surface obeys. Pure numbers and the CPU mirror of
// the shader's maths, so the look can be unit tested and tuned without a GPU. The shader itself lives
// in stylized.ts; it reads these through shared uniforms, so switching preset never recompiles.

/** The style bible's time-of-day presets (§3). Interior covers underground and cellars too. */
export const LIGHTING_PRESETS = [
  'dawn',
  'day',
  'golden-hour',
  'dusk',
  'night',
  'interior',
] as const;
export type LightingPreset = (typeof LIGHTING_PRESETS)[number];

/** Graphics quality, as the Graphics quality setting names it. Low never samples a normal map. */
export type StylizedQuality = 'high' | 'low';

/** Palette tokens the material clamps and tints toward (style bible §2.1, sRGB). */
export const PALETTE = {
  /** Darkest albedo allowed. */
  ink: 0x1e1b2e,
  /** Shadow fill: shadows tint toward it. */
  dusk: 0x3b3a5a,
  /** Highest albedo allowed, and the brightest a lit surface may reach. */
  cream: 0xfff4dc,
  /** Warm key: the default rim colour. */
  hearth: 0xe8a24a,
} as const;

/** How the material lights a surface under one preset. Colours are sRGB hex. */
export interface StylizedParams {
  /** Colour shadowed surfaces lean toward and are lifted to (never neutral grey, never black). */
  readonly shadowTint: number;
  /** How far (0–1) a fully shadowed surface's colour moves toward the shadow tint's hue. */
  readonly shadowHue: number;
  /** How much of the shadow tint a black surface in full shadow shows, scaled by the ambient fill. */
  readonly shadowLift: number;
  /** Rim light colour. */
  readonly rimColour: number;
  /** Rim light strength (0 turns it off). */
  readonly rimStrength: number;
  /** Rim falloff exponent: higher is a thinner rim. */
  readonly rimPower: number;
  /** The ramp's two band edges in N·L (−1…1), low then high. */
  readonly bandEdges: readonly [number, number];
  /** Half-width of the soft step at each band edge, in N·L. */
  readonly bandSoftness: number;
  /** Light taken by the shadow, middle and lit bands (0–1). */
  readonly bandLevels: readonly [number, number, number];
}

const base: StylizedParams = {
  shadowTint: PALETTE.dusk,
  shadowHue: 0.35,
  shadowLift: 1,
  rimColour: PALETTE.hearth,
  rimStrength: 0.35,
  rimPower: 3,
  bandEdges: [0.02, 0.45],
  bandSoftness: 0.08,
  bandLevels: [0, 0.5, 1],
};

/**
 * One parameter set per preset. Rim follows the preset's key colour (§3 table); shadows lean toward
 * dusk everywhere and harder at night and underground, where the rim is weaker so darkness stays dark.
 */
export const STYLIZED_PRESETS: Readonly<Record<LightingPreset, StylizedParams>> = {
  dawn: { ...base, rimColour: 0xf6c38b, rimStrength: 0.3 },
  day: { ...base, rimColour: 0xfff1d6, rimStrength: 0.25, shadowHue: 0.3 },
  'golden-hour': { ...base, rimColour: 0xffb870, rimStrength: 0.4 },
  dusk: { ...base, rimColour: 0xe07a5a, rimStrength: 0.35, shadowHue: 0.45 },
  night: { ...base, rimColour: 0x8fa0d8, rimStrength: 0.2, shadowHue: 0.5, shadowLift: 0.35 },
  interior: { ...base, rimColour: 0xf08a3c, rimStrength: 0.2, shadowHue: 0.45, shadowLift: 0.35 },
};

/** How much darker a fully wet surface's albedo is (AC-3: a 20–30 % drop). */
export const WET_DARKEN = 0.25;
/** Strength of the wet sheen's highlight. */
export const WET_SHEEN = 0.6;

/** The albedo multiplier at `wetness` (0 = dry … 1 = soaked; out-of-range values are clamped). */
export function wetAlbedoFactor(wetness: number): number {
  return 1 - WET_DARKEN * Math.min(1, Math.max(0, wetness));
}

/** GLSL's smoothstep. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The light the ramp gives a surface whose normal makes `nDotL` with the light (the shader's vbRamp). */
export function rampLevel(nDotL: number, params: StylizedParams): number {
  const [low, high] = params.bandEdges;
  const [shadow, mid, lit] = params.bandLevels;
  const s = params.bandSoftness;
  const a = smoothstep(low - s, low + s, nDotL);
  const b = smoothstep(high - s, high + s, nDotL);
  return shadow + (mid + (lit - mid) * b - shadow) * a;
}

/** One sRGB channel (0–1) in linear light. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** An sRGB hex colour as linear rgb (0–1 each). */
export function hexToLinear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

/** The albedo the material actually lights: each channel held between ink and cream (§2: no pure black or white). */
export function clampAlbedo(linear: readonly [number, number, number]): [number, number, number] {
  const lo = hexToLinear(PALETTE.ink);
  const hi = hexToLinear(PALETTE.cream);
  return [0, 1, 2].map((i) => Math.min(hi[i] ?? 1, Math.max(lo[i] ?? 0, linear[i] ?? 0))) as [
    number,
    number,
    number,
  ];
}

/** Below this key-light level (a sim light level, 0–1) the key is moonlight, not sun. */
export const NIGHT_KEY_LEVEL = 0.2;

/**
 * The preset for a scene lit by a key light of `level` (null: no key light, so torchlit), until scenes
 * name their own: interior without a key, night under a dim one, day otherwise.
 */
export function presetForKeyLight(level: number | null): LightingPreset {
  if (level === null) return 'interior';
  return level < NIGHT_KEY_LEVEL ? 'night' : 'day';
}

/** Whether `value` names a lighting preset. */
export function isLightingPreset(value: string): value is LightingPreset {
  return (LIGHTING_PRESETS as readonly string[]).includes(value);
}
