// Arrow effects that are not particles (mw-e29.11). The particle effects of an arrow (trail, flames,
// the water burst, deflect sparks, blunt dust) are VFX content played by the arrows cue sheet; what
// is left needs state per impact, so it lives here, driven by the sim's `arrowImpact` event:
//
// - Water arrow: a wet decal on the struck surface at the radius its payload wets (1.5 m).
// - Noise arrow: a subtle ring pulse where it lands, at most MAX_MAGIC_PULSE_HZ (the shared pulse
//   ceiling). Reduced motion shows one still ring that fades instead of pulsing outward.
// - Rope arrow: a ribbon that unfurls down from where it stuck, as long as its rope.
// - An arrow that sticks intact wobbles for 400 ms; one that cannot be picked up again (it shattered,
//   or a non-retrievable one came to rest) shows the broken shaft instead of the intact one.
//
// Presentation only: it reads events and content and never writes to the sim. Each frame it rebuilds
// `view`, plain numbers the Three.js side (src/render/combat/arrow-fx.ts) draws, so every rule here
// is unit tested without a renderer. What each arrow does is read from its content payload, never
// from its name: a new arrow that wets, rings or unfurls gets the effect from its data.

import type { ArrowDefinition } from '@content/index';
import { MAX_MAGIC_PULSE_HZ } from '@render/magic-materials/rules';
import {
  arrowBroken,
  arrowImpact,
  type ArrowImpactInfo,
  type EntityId,
  type Quat,
  type World,
} from '@sim/index';

/** How long a stuck arrow wobbles, ms. */
export const STUCK_WOBBLE_MS = 400;
/** Wobble swing at the start, radians (about 8 degrees). */
export const WOBBLE_AMPLITUDE = 0.14;
/** Wobble rate, hertz: a quivering shaft, not a flash. */
export const WOBBLE_HZ = 9;

/** How long a wet decal lasts, ms, and how much of that it spends fading out. */
export const WET_DECAL_MS = 12_000;
export const WET_DECAL_FADE_MS = 4_000;
/** Peak opacity of a wet decal. */
export const WET_DECAL_OPACITY = 0.4;

/** Seconds between a noise arrow's rings: never faster than the shared pulse ceiling allows. */
export const NOISE_RING_INTERVAL_S = Math.max(0.6, 1 / MAX_MAGIC_PULSE_HZ);
/** Seconds one ring lasts. */
export const NOISE_RING_LIFE_S = 0.9;
/** A ring that would have to wait longer than this to keep the spacing is not drawn, ms. */
export const RING_QUEUE_MS = 1500;
/** Peak opacity of a noise ring. */
export const NOISE_RING_OPACITY = 0.25;

/** Seconds a rope ribbon takes to unfurl, hangs, and fades out. */
export const ROPE_UNFURL_S = 0.7;
export const ROPE_LIFE_S = 1.8;

/** How long a broken shaft stays where it landed, ms, and its fade-out. */
export const BROKEN_SHAFT_MS = 8_000;
export const BROKEN_SHAFT_FADE_MS = 2_000;

/** Most of each effect alive at once; the oldest goes first. */
export const MAX_DECALS = 12;
export const MAX_RINGS = 8;
export const MAX_ROPES = 4;
export const MAX_BROKEN = 12;

/** What an arrow definition needs for these effects (the whole content type satisfies it). */
type PayloadOp = ArrowDefinition['payload'][number];
export interface ArrowFxDef {
  readonly id: string;
  readonly retrievable: boolean;
  readonly payload: readonly PayloadOp[];
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The widest radius the arrow's payload wets, metres; 0 when it wets nothing. */
export function wetRadius(def: Pick<ArrowFxDef, 'payload'>): number {
  let radius = 0;
  for (const op of def.payload) {
    if (op.op === 'applyProperty' && op.property === 'wetness' && op.value !== false) {
      radius = Math.max(radius, op.radius);
    }
  }
  return radius;
}

/** The loudness (dB) and duration (s) of the arrow's noise payload; undefined when it makes none. */
export function noiseOf(
  def: Pick<ArrowFxDef, 'payload'>,
): { readonly loudness: number; readonly duration: number } | undefined {
  for (const op of def.payload) {
    if (op.op === 'noise') return { loudness: op.loudness, duration: op.duration };
  }
  return undefined;
}

/** The rope length (m) the arrow's payload unfurls; undefined when it spawns no rope. */
export function ropeLengthOf(def: Pick<ArrowFxDef, 'payload'>): number | undefined {
  for (const op of def.payload) {
    if (op.op === 'spawn' && op.entity === 'rope') return op.length ?? 4;
  }
  return undefined;
}

/**
 * Does the arrow end up broken: it shattered, or it came to rest and the sim's roll left it broken
 * (`intact`, mw-e05.7: by what it landed in, fire, or a kind that cannot be picked up again)?
 */
export function arrowBreaks(impact: Pick<ArrowImpactInfo, 'outcome' | 'intact'>): boolean {
  if (impact.outcome === 'shatter') return true;
  return impact.intact === false;
}

/** How far a ring of a noise arrow reaches, metres: louder sounds carry further, up to 6 m. */
export function noiseRingRadius(loudness: number): number {
  return Math.min(6, 1 + loudness / 20);
}

/** When a noise arrow's rings start, seconds after the impact: a single one for an instant noise. */
export function noiseRingStarts(duration: number, reducedMotion: boolean): number[] {
  if (reducedMotion || !(duration > 0)) return [0];
  const starts: number[] = [];
  for (let t = 0; t < duration; t += NOISE_RING_INTERVAL_S) starts.push(t);
  return starts;
}

/**
 * One noise ring `age` seconds after it started: it grows from the contact to `radius` and fades, so
 * it never pops. Reduced motion holds it still at three quarters of the reach and only fades it.
 * Opacity is 0 before it starts and after it ends.
 */
export function noiseRingAt(
  age: number,
  radius: number,
  reducedMotion: boolean,
): { readonly radius: number; readonly opacity: number } {
  if (age < 0 || age >= NOISE_RING_LIFE_S) return { radius: 0, opacity: 0 };
  const t = age / NOISE_RING_LIFE_S;
  return {
    radius: reducedMotion ? radius * 0.75 : radius * (0.15 + 0.85 * t),
    opacity: NOISE_RING_OPACITY * (1 - t),
  };
}

/** A wet decal's opacity `ageMs` after the splash: quick in, a long hold, then it dries out. */
export function wetDecalOpacity(ageMs: number): number {
  if (ageMs < 0 || ageMs >= WET_DECAL_MS) return 0;
  const fadeIn = clamp01(ageMs / 150);
  const fadeOut = clamp01((WET_DECAL_MS - ageMs) / WET_DECAL_FADE_MS);
  return WET_DECAL_OPACITY * Math.min(fadeIn, fadeOut);
}

/**
 * A stuck arrow's wobble `elapsedMs` after it stuck, radians: a quiver that dies away over 400 ms
 * and is exactly 0 outside that window. Reduced motion keeps the arrow still.
 */
export function wobbleAngle(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion || elapsedMs < 0 || elapsedMs >= STUCK_WOBBLE_MS) return 0;
  const t = elapsedMs / STUCK_WOBBLE_MS;
  const damping = (1 - t) * (1 - t);
  return WOBBLE_AMPLITUDE * damping * Math.sin(2 * Math.PI * WOBBLE_HZ * (elapsedMs / 1000));
}

/** `rotation` turned by `angle` about the arrow's own sideways axis (it points along +z), at its tip. */
export function withWobble(rotation: Quat, angle: number): Quat {
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  // rotation * (s, 0, 0, c): the quiver is about local x.
  return {
    x: rotation.w * s + rotation.x * c,
    y: rotation.y * c + rotation.z * s,
    z: rotation.z * c - rotation.y * s,
    w: rotation.w * c - rotation.x * s,
  };
}

/** A rope ribbon `ageS` seconds after it was loosed: how much has unfurled (0-1) and its opacity. */
export function ropeAt(ageS: number): { readonly unfurled: number; readonly opacity: number } {
  if (ageS < 0 || ageS >= ROPE_LIFE_S) return { unfurled: 0, opacity: 0 };
  const t = clamp01(ageS / ROPE_UNFURL_S);
  const fade = clamp01((ROPE_LIFE_S - ageS) / 0.5);
  return { unfurled: 1 - (1 - t) * (1 - t), opacity: 0.85 * fade };
}

/** A broken shaft's opacity `ageMs` after it landed. */
export function brokenShaftOpacity(ageMs: number): number {
  if (ageMs < 0 || ageMs >= BROKEN_SHAFT_MS) return 0;
  return clamp01((BROKEN_SHAFT_MS - ageMs) / BROKEN_SHAFT_FADE_MS);
}

/** A disc or ring on a surface: centre, the way it faces, radius (m) and opacity. */
export interface FlatDraw {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly opacity: number;
}

/** A rope ribbon hanging from where its arrow stuck. */
export interface RopeDraw {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Metres hanging now (the rope's length times how much has unfurled). */
  readonly length: number;
  readonly opacity: number;
  /** Seconds since it was loosed, for the ribbon's sway. */
  readonly age: number;
}

/** A broken arrow shaft where an arrow landed, pointing the way it was flying. */
export interface BrokenDraw {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly opacity: number;
}

/** What the renderer draws this frame. */
export interface ArrowFxView {
  readonly decals: readonly FlatDraw[];
  readonly rings: readonly FlatDraw[];
  readonly ropes: readonly RopeDraw[];
  readonly broken: readonly BrokenDraw[];
}

export interface ArrowFxOptions {
  readonly world: World<never>;
  readonly arrows: readonly ArrowFxDef[];
  /** Presentation clock, ms. */
  readonly now: () => number;
  /** Reduced-motion preference, read as effects start and as they draw; default: off. */
  readonly reducedMotion?: () => boolean;
  /**
   * Swaps the shaft bound to `entity` for the broken one; true once done, false when it has no shaft
   * yet (tried again next frame while the arrow lives).
   */
  readonly breakShaft?: (entity: EntityId) => boolean;
}

interface Flat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly radius: number;
  readonly start: number;
}

interface Piece {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly start: number;
}

/** Drops the oldest of `list` until there is room for one more. */
function room(list: unknown[], max: number): void {
  while (list.length >= max) list.shift();
}

/** Arrow effects driven by arrowImpact (see the file header). One per world. */
export class ArrowFx {
  readonly view: {
    decals: FlatDraw[];
    rings: FlatDraw[];
    ropes: RopeDraw[];
    broken: BrokenDraw[];
  } = { decals: [], rings: [], ropes: [], broken: [] };
  readonly #o: ArrowFxOptions;
  readonly #defs: ReadonlyMap<string, ArrowFxDef>;
  readonly #decals: Flat[] = [];
  readonly #rings: (Flat & { readonly reduced: boolean })[] = [];
  readonly #ropes: { x: number; y: number; z: number; length: number; start: number }[] = [];
  readonly #pieces: Piece[] = [];
  readonly #wobbling = new Map<EntityId, number>();
  readonly #breaking = new Set<EntityId>();
  /** Earliest time the next noise ring may start, ms. */
  #nextRing = 0;
  #wobbleCount = 0;
  #off: (() => void) | undefined;

  constructor(options: ArrowFxOptions) {
    this.#o = options;
    this.#defs = new Map(options.arrows.map((def) => [def.id, def]));
  }

  /** Starts listening for arrow impacts; returns the function that stops. */
  attach(): () => void {
    this.#off?.();
    const stopImpacts = this.#o.world.events.on(arrowImpact, (impact) => {
      this.#impact(impact);
    });
    // An arrow that breaks after it came to rest (it burned) swaps to the broken shaft too.
    const stopBreaks = this.#o.world.events.on(arrowBroken, ({ entity }) => {
      this.#wobbling.delete(entity);
      this.#breaking.add(entity);
    });
    this.#off = () => {
      stopImpacts();
      stopBreaks();
    };
    return () => {
      this.#off?.();
      this.#off = undefined;
    };
  }

  /** The wobble angle (radians) of a stuck arrow's shaft now; 0 when it is not quivering. */
  wobble(entity: EntityId): number {
    const start = this.#wobbling.get(entity);
    if (start === undefined) return 0;
    return wobbleAngle(this.#o.now() - start, this.#reduced());
  }

  /** Arrows whose shaft is still waiting to be swapped for the broken one. */
  get breaking(): number {
    return this.#breaking.size;
  }

  /** Wobbles started since the start (a probe for the e2e, which cannot catch a 400 ms window). */
  get wobblesStarted(): number {
    return this.#wobbleCount;
  }

  /** Arrows wobbling right now (some may have just finished; `frame` drops those). */
  get wobbling(): number {
    return this.#wobbling.size;
  }

  #reduced(): boolean {
    return this.#o.reducedMotion?.() === true;
  }

  #impact(impact: ArrowImpactInfo): void {
    const def = this.#defs.get(impact.arrow);
    if (def === undefined) return;
    const now = this.#o.now();
    const { position: p, normal: n } = impact;
    const onSurface = impact.hurtbox === undefined;
    const base = { x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z, start: now };
    const wet = wetRadius(def);
    if (wet > 0 && onSurface) {
      room(this.#decals, MAX_DECALS);
      this.#decals.push({ ...base, radius: wet });
    }
    const noise = noiseOf(def);
    if (noise !== undefined) {
      const reduced = this.#reduced();
      const radius = noiseRingRadius(noise.loudness);
      for (const delay of noiseRingStarts(noise.duration, reduced)) {
        // However many noises land (an arrow that bounces makes one each time), rings start no
        // closer together than the pulse ceiling allows; one that would have to wait too long is
        // skipped.
        const start = Math.max(now + delay * 1000, this.#nextRing);
        if (start - now > RING_QUEUE_MS) continue;
        this.#nextRing = start + NOISE_RING_INTERVAL_S * 1000;
        room(this.#rings, MAX_RINGS);
        // Rings lie flat on the ground whatever was struck: sound spreads every way.
        this.#rings.push({ ...base, nx: 0, ny: 1, nz: 0, start, radius, reduced });
      }
    }
    const rope = ropeLengthOf(def);
    if (rope !== undefined && impact.outcome === 'stick') {
      room(this.#ropes, MAX_ROPES);
      this.#ropes.push({ x: p.x, y: p.y, z: p.z, length: rope, start: now });
    }
    if (arrowBreaks(impact)) {
      if (impact.outcome === 'shatter') {
        if (onSurface) {
          room(this.#pieces, MAX_BROKEN);
          // The stub stays in the surface, pointing the way the arrow was flying.
          this.#pieces.push({ x: p.x, y: p.y, z: p.z, dx: -n.x, dy: -n.y, dz: -n.z, start: now });
        }
      } else {
        this.#breaking.add(impact.entity);
      }
    } else if (impact.outcome === 'stick') {
      this.#wobbling.set(impact.entity, now);
      this.#wobbleCount++;
    }
  }

  /** Rebuilds `view` and retires what has run out; call once per rendered frame. */
  frame(): void {
    const now = this.#o.now();
    const view = this.view;
    view.decals.length = view.rings.length = view.ropes.length = view.broken.length = 0;
    prune(this.#decals, (d) => now - d.start >= WET_DECAL_MS);
    for (const d of this.#decals) {
      view.decals.push({ ...flat(d), radius: d.radius, opacity: wetDecalOpacity(now - d.start) });
    }
    prune(this.#rings, (r) => now - r.start >= NOISE_RING_LIFE_S * 1000);
    for (const r of this.#rings) {
      const ring = noiseRingAt((now - r.start) / 1000, r.radius, r.reduced);
      if (ring.opacity > 0) view.rings.push({ ...flat(r), ...ring });
    }
    prune(this.#ropes, (r) => now - r.start >= ROPE_LIFE_S * 1000);
    for (const r of this.#ropes) {
      const age = (now - r.start) / 1000;
      const rope = ropeAt(age);
      view.ropes.push({
        x: r.x,
        y: r.y,
        z: r.z,
        length: r.length * rope.unfurled,
        opacity: rope.opacity,
        age,
      });
    }
    prune(this.#pieces, (p) => now - p.start >= BROKEN_SHAFT_MS);
    for (const p of this.#pieces) {
      view.broken.push({ ...p, opacity: brokenShaftOpacity(now - p.start) });
    }
    for (const [entity, start] of this.#wobbling) {
      if (now - start >= STUCK_WOBBLE_MS || !this.#o.world.isAlive(entity)) {
        this.#wobbling.delete(entity);
      }
    }
    for (const entity of this.#breaking) {
      if (!this.#o.world.isAlive(entity) || this.#o.breakShaft?.(entity) === true) {
        this.#breaking.delete(entity);
      }
    }
  }
}

function flat(f: Flat): Omit<FlatDraw, 'radius' | 'opacity'> {
  return { x: f.x, y: f.y, z: f.z, nx: f.nx, ny: f.ny, nz: f.nz };
}

/** Removes every item of `list` that `done` says has run out. */
function prune<T>(list: T[], done: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (done(list[i] as T)) list.splice(i, 1);
  }
}
