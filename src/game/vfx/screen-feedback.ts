// Screen feedback (mw-e29.5): the damage vignette, the low-health grade and the flash limiter. Pure
// models on explicit milliseconds, never the wall clock; the UI overlay (src/ui/screen-feedback.ts)
// draws what they say.

/** How long a damage vignette lasts, ms. */
export const VIGNETTE_MS = 300;

/** Health fraction below which the screen starts to lose its colour. */
export const LOW_HEALTH = 0.25;

/** How much colour is gone at 0 health (1 = fully grey). */
export const MAX_DESATURATION = 0.7;

/** WCAG 2.3.1: no more than this many full-screen flashes in any one second. */
export const MAX_FLASHES_PER_SECOND = 3;

/** Allows at most `MAX_FLASHES_PER_SECOND` flashes in any sliding 1000 ms window. */
export class FlashLimiter {
  #times: number[] = [];

  /** Whether a flash requested at `nowMs` may render; an allowed flash counts against the window. */
  request(nowMs: number): boolean {
    this.#times = this.#times.filter((time) => nowMs - time < 1000);
    if (this.#times.length >= MAX_FLASHES_PER_SECOND) return false;
    this.#times.push(nowMs);
    return true;
  }
}

/** Colour lost at `health` of `max`: 0 at or above 25%, rising linearly to MAX_DESATURATION at 0. */
export function desaturation(health: number, max: number): number {
  if (!(max > 0)) return 0;
  const fraction = Math.min(1, Math.max(0, health / max));
  if (fraction >= LOW_HEALTH) return 0;
  return MAX_DESATURATION * (1 - fraction / LOW_HEALTH);
}

/** The damage vignette: a hit sets it to the fraction of max health lost, and it fades in 300 ms. */
export class DamageVignette {
  readonly #limiter: FlashLimiter;
  #peak = 0;
  #start = 0;

  constructor(limiter = new FlashLimiter()) {
    this.#limiter = limiter;
  }

  /**
   * A hit that removed `lostFraction` of max health at `nowMs`. The vignette is a full-screen flash,
   * so the limiter may refuse it (the current one keeps fading). Returns whether it was shown.
   */
  hit(lostFraction: number, nowMs: number): boolean {
    const lost = Math.min(1, Math.max(0, lostFraction));
    if (!(lost > 0) || !this.#limiter.request(nowMs)) return false;
    this.#peak = Math.max(this.intensity(nowMs), lost);
    this.#start = nowMs;
    return true;
  }

  /** The vignette at `nowMs` as a fraction of its maximum: the peak, fading linearly to 0. */
  intensity(nowMs: number): number {
    const left = 1 - (nowMs - this.#start) / VIGNETTE_MS;
    return left <= 0 ? 0 : this.#peak * Math.min(1, left);
  }
}
