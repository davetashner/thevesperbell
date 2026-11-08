// Trauma-based camera shake (mw-e29.5). Hits, guard breaks and blasts add trauma (0–1); the camera
// offset is proportional to trauma squared, so small hits are a tremor and big ones a jolt, and
// trauma drains at 1.5 a second. The model is pure: it runs on explicit seconds, never the wall
// clock, and returns a camera-plane offset in metres that the player's camera adds after the orbit
// rig (and its collision) has resolved, so shake never fights the boom. With the shake scale at 0 or
// reduced motion on, the offset is exactly zero.

/** Trauma drained per second. */
export const TRAUMA_DECAY_PER_SECOND = 1.5;

/** Trauma added by each kind of impact. */
export const TRAUMA = Object.freeze({ light: 0.15, heavy: 0.3, guardBreak: 0.5 });

/** The biggest camera offset (metres, each axis) at full trauma and full shake scale. */
export const MAX_SHAKE_OFFSET = 0.12;

/** How quickly the shake wobbles, Hz. */
const SHAKE_HZ = 14;

export interface ShakeOffset {
  /** Camera-right metres. */
  readonly x: number;
  /** Camera-up metres. */
  readonly y: number;
}

const ZERO: ShakeOffset = Object.freeze({ x: 0, y: 0 });

/** Trauma for a blast `distance` metres away: full `power` at the centre, none at `radius`. */
export function explosionTrauma(distance: number, radius: number, power = 1): number {
  if (!(radius > 0) || !(distance < radius)) return 0;
  const near = 1 - Math.max(0, distance) / radius;
  return Math.min(1, Math.max(0, power * near));
}

/** A smooth wobble in [−1, 1]: two incommensurate sines, so it never visibly repeats. */
function wobble(seconds: number, phase: number): number {
  const t = seconds * SHAKE_HZ * 2 * Math.PI;
  return 0.6 * Math.sin(t + phase) + 0.4 * Math.sin(t * 0.37 + phase * 1.9);
}

export class CameraShake {
  #trauma = 0;
  #scale = 1;
  #reduced = false;
  #seconds = 0;

  /** Current trauma, 0–1. */
  get trauma(): number {
    return this.#trauma;
  }

  /** Whether shake is switched off (scale 0 or reduced motion). */
  get disabled(): boolean {
    return this.#scale <= 0 || this.#reduced;
  }

  /** Sets the shake scale (0–1, clamped; non-finite counts as 1) and the reduced-motion state. */
  configure(scale: number, reducedMotion: boolean): void {
    this.#scale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
    this.#reduced = reducedMotion;
  }

  /** Adds trauma (clamped to 1). Ignored while shake is disabled, so nothing builds up unseen. */
  add(amount: number): void {
    if (this.disabled || !(amount > 0)) return;
    this.#trauma = Math.min(1, this.#trauma + amount);
  }

  /** Adds the trauma of a blast `distance` metres away (see `explosionTrauma`). */
  addExplosion(distance: number, radius: number, power = 1): void {
    this.add(explosionTrauma(distance, radius, power));
  }

  /** Advances `dt` seconds: drains trauma. Returns the camera offset for the new moment. */
  update(dt: number): ShakeOffset {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.#seconds += step;
    const left = this.#trauma - TRAUMA_DECAY_PER_SECOND * step;
    // Float residue from many small steps (0.3 − 12 × 0.025) counts as drained.
    this.#trauma = left < 1e-9 ? 0 : left;
    return this.offset;
  }

  /** The offset now: MAX_SHAKE_OFFSET × scale × trauma² × a wobble. Exactly zero when disabled. */
  get offset(): ShakeOffset {
    if (this.disabled || this.#trauma <= 0) return ZERO;
    const amount = MAX_SHAKE_OFFSET * this.#scale * this.#trauma * this.#trauma;
    return { x: amount * wobble(this.#seconds, 0), y: amount * wobble(this.#seconds, 2.1) };
  }
}

/** A camera-plane offset as a world offset, given the camera's unit `forward` (y up). */
export function shakeWorldOffset(
  forward: { readonly x: number; readonly y: number; readonly z: number },
  offset: ShakeOffset,
): { x: number; y: number; z: number } {
  // right = forward × up(0,1,0) = (−fz, 0, fx), normalised; up = right × forward.
  const length = Math.hypot(forward.x, forward.z);
  if (length < 1e-6) return { x: 0, y: offset.y, z: 0 };
  const rx = -forward.z / length;
  const rz = forward.x / length;
  const ux = -forward.y * (forward.x / length);
  const uy = length;
  const uz = -forward.y * (forward.z / length);
  return {
    x: rx * offset.x + ux * offset.y,
    y: uy * offset.y,
    z: rz * offset.x + uz * offset.y,
  };
}
