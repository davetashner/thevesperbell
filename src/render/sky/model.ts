// The procedural sky (sky dome) of an outdoor scene: where the sun and moon stand at a minute of the
// game day, how far night has fallen, and the colours the dome paints from the scene's sky colour.
// Render-only and deterministic: everything here is a pure function of the scene's dome settings,
// its (time-of-day blended) sky colour and the game minute, so screenshots and tests are repeatable.
// The shader in ./index.ts draws what this computes; the style bible's palette sets the tints
// (ink-violet night #1E1B2E, hearth amber #E8A24A at sunrise and sunset, parchment #EFE2C4 clouds).

/** A 3-vector, unit length where it is a direction. */
export type Vec3Tuple = readonly [number, number, number];
/** An sRGB colour, each channel 0–1. */
export type Rgb = readonly [number, number, number];

/** A scene's dome settings (content `environment.dome`, defaults applied). */
export interface SkyDomeSettings {
  /** How many stars show at full night, 0–1. */
  readonly stars: number;
  /** Cloud cover, 0 (clear) to 1 (overcast). */
  readonly clouds: number;
  /** Bearing the clouds drift towards, degrees clockwise from +z (north). */
  readonly wind: number;
  /** Fixes the star field and cloud shapes, so a scene's sky is the same every time. */
  readonly seed: number;
  /** Minute shown by a scene without a day and night look. */
  readonly minute: number;
}

/** Everything the dome shader needs at one minute. */
export interface SkyState {
  readonly sun: Vec3Tuple;
  readonly moon: Vec3Tuple;
  /** 0 by day, 1 at full night; stars and the moon fade with it. */
  readonly night: number;
  /** 0 outside dawn and dusk, 1 when the sun is on the horizon: the warm horizon glow. */
  readonly twilight: number;
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly sunColour: Rgb;
  readonly cloudColour: Rgb;
  readonly stars: number;
  readonly clouds: number;
  /** Unit drift direction of the clouds on the ground plane (x, z). */
  readonly wind: readonly [number, number];
  readonly seed: number;
}

const MINUTES_PER_DAY = 1440;
/** Sunrise and sunset, minutes: the sun crosses the horizon at 06:00 in the east and 18:00 in the west. */
export const SUNRISE = 360;
export const SUNSET = 1080;
/** How far the sun's path leans towards the south (−z), radians: it never stands straight overhead. */
const PATH_TILT = (35 * Math.PI) / 180;

/** Palette tokens (style bible §2.1). */
const INK: Rgb = hexToRgb('#1E1B2E');
const HEARTH: Rgb = hexToRgb('#E8A24A');
const PARCHMENT: Rgb = hexToRgb('#EFE2C4');
const MOONLIGHT: Rgb = hexToRgb('#CFC6F2');

/** `#RRGGBB` to 0–1 channels. */
export function hexToRgb(hex: string): Rgb {
  const channel = (i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return [channel(0), channel(1), channel(2)];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** Hermite step from `edge0` to `edge1` (either order), 0–1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * The sun's direction at `minute` (0–1439, fractions allowed): rising due east (+x) at 06:00, highest
 * at noon (leaning south), setting due west (−x) at 18:00, and below the horizon through the night.
 */
export function sunDirection(minute: number): Vec3Tuple {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const angle = ((m - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  const up = Math.sin(angle);
  return [Math.cos(angle), up * Math.cos(PATH_TILT), -up * Math.sin(PATH_TILT)];
}

/** The moon stands opposite the sun. */
export function moonDirection(minute: number): Vec3Tuple {
  const [x, y, z] = sunDirection(minute);
  return [-x, -y, -z];
}

/** How dark it is for a sun at height `sunY` (the y of its direction): 0 by day, 1 at night. */
export function nightAmount(sunY: number): number {
  return smoothstep(0.12, -0.12, sunY);
}

/** The dawn and dusk glow for a sun at height `sunY`: strongest with the sun on the horizon. */
export function twilightAmount(sunY: number): number {
  return 1 - smoothstep(0, 0.28, Math.abs(sunY));
}

/** The dome at `minute` for a scene whose (blended) sky colour is `skyHex`. */
export function skyAt(dome: SkyDomeSettings, skyHex: string, minute: number): SkyState {
  const sun = sunDirection(minute);
  const night = nightAmount(sun[1]);
  const twilight = twilightAmount(sun[1]);
  const sky = hexToRgb(skyHex);
  // The zenith is the sky colour deepened towards ink; the horizon lifts towards parchment by day,
  // stays close to the sky colour at night, and warms to hearth amber at sunrise and sunset.
  const zenith = mix(sky, INK, 0.25 + 0.35 * night);
  const lifted = mix(sky, PARCHMENT, 0.35 * (1 - night));
  const horizon = mix(lifted, HEARTH, 0.55 * twilight);
  const sunColour = mix(PARCHMENT, HEARTH, twilight);
  // Clouds catch the light: parchment by day, amber-lit at twilight, a dim moonlit ink at night.
  const lit = mix(PARCHMENT, HEARTH, 0.6 * twilight);
  const cloudColour = mix(lit, mix(INK, MOONLIGHT, 0.25), night);
  const bearing = (dome.wind * Math.PI) / 180;
  return {
    sun,
    moon: moonDirection(minute),
    night,
    twilight,
    zenith,
    horizon,
    sunColour,
    cloudColour,
    stars: clamp01(dome.stars) * night,
    clouds: clamp01(dome.clouds),
    wind: [Math.sin(bearing), Math.cos(bearing)],
    seed: dome.seed,
  };
}
