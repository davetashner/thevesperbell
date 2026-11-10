// The aim camera's zoom (mw-e05.21): while the player draws a bow the orbit camera's vertical field
// of view narrows from the camera's own (70°) to the bow's aim.fov (55° for the shortbow), and widens
// back once the draw ends. Presentation only: the sim says whether the player draws (isDrawing); this
// eases the lens toward the matching field of view each drawn frame.
//
// The ease is exponential with the bow's aim.time as its time constant: each frame closes
// 1 − e^(−dt / time) of the gap, so after `time` seconds the lens has come about two thirds (63%) of
// the way, fast at first and settling without overshoot, the same at any frame rate. Within
// SETTLE_DEGREES of its goal it snaps there, so a settled lens stops changing (and the camera's
// projection is not rebuilt every frame).

/** Degrees within which the field of view snaps to its goal. */
export const SETTLE_DEGREES = 0.01;

/** The field of view the orbit camera draws with, easing between its rest and aim values. */
export class AimZoom {
  #fov: number;

  /**
   * `rest`: the camera's own vertical field of view, degrees. It can be changed while playing (the
   * FOV option, mw-e31.6); the lens eases to the new value.
   */
  constructor(public rest: number) {
    this.#fov = rest;
  }

  /** The field of view now, degrees. */
  get fov(): number {
    return this.#fov;
  }

  /**
   * The field of view `dt` seconds on, easing toward `aim` (degrees) while `aiming`, else back to
   * rest, with time constant `time` seconds (see the file header).
   */
  update(aiming: boolean, aim: number, time: number, dt: number): number {
    const goal = aiming ? aim : this.rest;
    const gap = goal - this.#fov;
    const next = this.#fov + gap * (1 - Math.exp(-dt / time));
    this.#fov = Math.abs(goal - next) < SETTLE_DEGREES ? goal : next;
    return this.#fov;
  }
}
