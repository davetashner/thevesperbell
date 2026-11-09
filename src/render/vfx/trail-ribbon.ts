// Ribbon trail geometry and pooling (mw-e29.6). Pure: a trail is a ring buffer of weapon-socket
// samples (each a base and a tip point, the two edges of the ribbon); the samples are smoothed with a
// Catmull-Rom spline and written into caller-owned typed arrays, so nothing is allocated per frame.
// At most TRAIL_MAX trails are live at once: asking for another releases the oldest. The Three.js side
// (trails.ts) only uploads what `writeRibbon` fills.

import type { Vec3 } from '@sim/index';

/** An sRGB colour, each channel 0–1. */
type Rgb = readonly [number, number, number];

/** Most trails live at once, swings and arrows together. */
export const TRAIL_MAX = 8;

/** Samples a trail remembers; older ones are overwritten. */
export const TRAIL_SAMPLES = 12;

/** Spline segments drawn between two samples. */
export const TRAIL_SUBDIVISIONS = 4;

/** Ribbon stations (a base/tip pair each) the largest trail can have. */
export const TRAIL_MAX_STATIONS = (TRAIL_SAMPLES - 1) * TRAIL_SUBDIVISIONS + 1;

const FLOATS = 6;

/** `items[index]` for an index known to be in range. */
export const at = <T>(items: ArrayLike<T>, index: number): T => items[index] as T;

/** A value known to be present. */
export const known = <T>(value: T): NonNullable<T> => value as NonNullable<T>;

/** Uniform Catmull-Rom between `p1` and `p2` at `t` (0–1), given neighbours `p0` and `p3`. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** One live trail: its samples, colour and age order. Owned by a `TrailSet`; never created elsewhere. */
export class Trail {
  /** Whoever asked for it (an entity id), so an eviction can tell its owner. */
  owner = -1;
  /** What it trails: a melee swing, an arrow, or the arrow of a focused shot (mw-e29.11). */
  kind: 'swing' | 'arrow' | 'arrow-focused' = 'swing';
  r = 1;
  g = 1;
  b = 1;
  alpha = 1;
  /** Order requested in; the smallest live one is the oldest. */
  serial = 0;
  live = false;
  readonly #samples = new Float32Array(TRAIL_SAMPLES * FLOATS);
  #head = 0;
  #count = 0;

  /** Samples held. */
  get length(): number {
    return this.#count;
  }

  /** Drawable: a ribbon needs two samples. */
  get visible(): boolean {
    return this.live && this.#count >= 2;
  }

  /** Records the socket's base and tip points, dropping the oldest sample when full. */
  push(base: Vec3, tip: Vec3): void {
    const at = this.#head * FLOATS;
    const s = this.#samples;
    s[at] = base.x;
    s[at + 1] = base.y;
    s[at + 2] = base.z;
    s[at + 3] = tip.x;
    s[at + 4] = tip.y;
    s[at + 5] = tip.z;
    this.#head = (this.#head + 1) % TRAIL_SAMPLES;
    if (this.#count < TRAIL_SAMPLES) this.#count++;
  }

  /** Forgets every sample. */
  clear(): void {
    this.#head = 0;
    this.#count = 0;
  }

  /** Component `c` (0–5: base xyz, tip xyz) of sample `i`, 0 the oldest; indices are clamped. */
  at(i: number, c: number): number {
    const k = Math.min(this.#count - 1, Math.max(0, i));
    const slot = (this.#head - this.#count + k + TRAIL_SAMPLES * 2) % TRAIL_SAMPLES;
    return at(this.#samples, slot * FLOATS + c);
  }
}

/**
 * Smooths `trail` with Catmull-Rom and writes it as ribbon stations, tail first: `positions` gets
 * 6 floats per station (base xyz, tip xyz), `colours` 8 (rgba base, rgba tip) with alpha rising from
 * 0 at the tail to the trail's alpha at the head. Returns the number of stations (0 when not
 * drawable). Both arrays must hold TRAIL_MAX_STATIONS stations.
 */
export function writeRibbon(
  trail: Trail,
  positions: Float32Array,
  colours: Float32Array,
  subdivisions: number = TRAIL_SUBDIVISIONS,
): number {
  const n = trail.length;
  if (n < 2) return 0;
  const stations = (n - 1) * subdivisions + 1;
  let station = 0;
  for (let i = 0; i < n - 1; i++) {
    const last = i === n - 2;
    const steps = last ? subdivisions + 1 : subdivisions;
    for (let step = 0; step < steps; step++) {
      const t = step / subdivisions;
      for (let c = 0; c < FLOATS; c++) {
        positions[station * FLOATS + c] = catmullRom(
          trail.at(i - 1, c),
          trail.at(i, c),
          trail.at(i + 1, c),
          trail.at(i + 2, c),
          t,
        );
      }
      const a = trail.alpha * (station / (stations - 1));
      const o = station * 8;
      colours[o] = colours[o + 4] = trail.r;
      colours[o + 1] = colours[o + 5] = trail.g;
      colours[o + 2] = colours[o + 6] = trail.b;
      colours[o + 3] = colours[o + 7] = a;
      station++;
    }
  }
  return stations;
}

/** What `TrailSet.request` did. */
export interface TrailRequest {
  readonly trail: Trail;
  /** The owner whose trail was released to make room, or undefined when there was a free slot. */
  readonly evicted: number | undefined;
}

/** A fixed pool of TRAIL_MAX trails: requests beyond it release the oldest. */
export class TrailSet {
  readonly trails: readonly Trail[] = Array.from({ length: TRAIL_MAX }, () => new Trail());
  #serial = 0;

  /** Live trail count. */
  get live(): number {
    let n = 0;
    for (const trail of this.trails) if (trail.live) n++;
    return n;
  }

  /** Takes a trail for `owner` coloured `rgb` at `alpha`; releases the oldest when all are live. */
  request(owner: number, kind: Trail['kind'], rgb: Rgb, alpha: number): TrailRequest {
    let slot: Trail | undefined;
    let evicted: number | undefined;
    for (const trail of this.trails) {
      if (!trail.live) {
        slot = trail;
        break;
      }
      if (slot === undefined || trail.serial < slot.serial) slot = trail;
    }
    const trail = known(slot);
    if (trail.live) evicted = trail.owner;
    trail.clear();
    trail.live = true;
    trail.owner = owner;
    trail.kind = kind;
    trail.r = rgb[0];
    trail.g = rgb[1];
    trail.b = rgb[2];
    trail.alpha = alpha;
    trail.serial = this.#serial++;
    return { trail, evicted };
  }

  /** Releases `trail` (a no-op when it is not live). */
  release(trail: Trail): void {
    trail.live = false;
    trail.clear();
  }
}
