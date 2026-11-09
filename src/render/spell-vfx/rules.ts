// The rules and contract of the spell VFX drawings (mw-e29.10), with no GPU in sight so they are unit
// tested: what a ring and a beam are asked to draw (`RingSpec`, `BeamSpec`), what the surface hands
// back to move or close them, and how a ground ring opens. src/render/spell-vfx draws them;
// src/game/spell-vfx resolves templates into these specs and drives the drawings.
//
// How a spell's ground ring opens: it expands from its centre to the spell radius over the
// template's `growSeconds` (eased out), then holds at exactly the radius. Pure, so the rule that the
// ring never overshoots its radius is unit tested; src/render/spell-vfx applies it to the mesh.

import type { Vec3 } from '@sim/index';

/** Fraction of its radius a ring has reached `elapsed` seconds after opening (0 at once, 1 when grown). */
export function ringGrowth(elapsed: number, growSeconds: number): number {
  if (!(growSeconds > 0)) return 1;
  const t = Math.min(Math.max(elapsed / growSeconds, 0), 1);
  return 1 - (1 - t) * (1 - t);
}

/** Reduced motion shows the ring at its full radius at once. */
export function ringScale(elapsed: number, growSeconds: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : Math.max(ringGrowth(elapsed, growSeconds), 0.001);
}

/** What a ground ring draws: the numbers of an area template, tint and scale applied. */
export interface RingSpec {
  /** `#RRGGBB`. */
  readonly tint: string;
  readonly intensity: number;
  /** Turns per second. */
  readonly spin: number;
  readonly growSeconds: number;
  readonly pulseHz: number;
}

/** What a beam draws. */
export interface BeamSpec {
  /** `#RRGGBB`. */
  readonly tint: string;
  /** Metres. */
  readonly width: number;
  readonly alpha: number;
  /** Lengths per second the energy streams along the beam. */
  readonly scrollSpeed: number;
  readonly pulseHz: number;
}

/** A drawn beam: the surface moves it each frame and closes it when the beam ends. */
export interface BeamDrawing {
  setEnds(start: Vec3, end: Vec3): void;
  close(): void;
}

/** A drawn ground ring. */
export interface RingDrawing {
  close(): void;
}

/** What draws the two spell slots that are not particles. */
export interface SpellVfxSurfaces {
  /** A ring on the ground at `centre` whose edge is `radius` metres out. */
  openRing(spec: {
    readonly centre: Vec3;
    readonly radius: number;
    readonly ring: RingSpec;
  }): RingDrawing;
  openBeam(spec: BeamSpec): BeamDrawing;
}
