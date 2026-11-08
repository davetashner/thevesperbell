// Ambient beds and randomised positional one-shots (mw-e28.13). Each scene places ambience zones
// (content type `ambience`) over its regions; the zone the listener stands in loops its bed, and
// when the listener crosses into another zone the beds crossfade over 2 s with an equal-power curve
// so the loudness never dips. Zones also fire one-shots (drips, gusts, birds, creaks) at random
// intervals and random points in an annulus around the listener. Everything plays through the
// engine's cues, which sit on the ambience bus, so the player's volume, snapshots and ducks apply.
// Presentation only. Time and randomness are injected (a seeded PRNG, the caller's clock), so the
// logic is deterministic in tests. A cue the manifest lacks is skipped quietly by the engine.
import type { PlayOptions, SoundHandle, Vec3 } from '@audio/index';
import { dbToGain } from '@audio/index';
import { AMBIENCE_CROSSFADE_S, type AmbienceEntry, type AmbienceOneShot } from '@content/index';

/** The engine as ambience uses it (the AudioEngine satisfies it). */
export interface AmbienceEngine {
  readonly context: { readonly state: string } | undefined;
  play(cueId: string, options?: PlayOptions): SoundHandle | null;
}

/** A uniform random number in [0, 1). */
export type Random = () => number;

/** An ambience zone placed in a scene: the zone data and the box it covers (metres), if any. */
export interface PlacedZone {
  readonly zone: Pick<AmbienceEntry, 'id' | 'bed' | 'oneShots'>;
  /** Corners of the covered box; absent = the whole scene. Only x and z are tested. */
  readonly box?: { readonly min: Vec3; readonly max: Vec3 } | undefined;
}

/** What a scene says about its ambience, and the regions it can name. */
export interface SceneAmbience {
  readonly ambience: readonly {
    readonly zone: { readonly id: string };
    readonly region?: string | undefined;
  }[];
}

/** Places a scene's ambience entries: each covers its region's box, or all of the scene. */
export function placeZones(
  scene: SceneAmbience,
  regions: readonly { readonly id: string; readonly min: Vec3; readonly max: Vec3 }[],
  zone: (id: string) => PlacedZone['zone'],
): readonly PlacedZone[] {
  return scene.ambience.map((entry) => {
    const region =
      entry.region === undefined ? undefined : regions.find((r) => r.id === entry.region);
    return {
      zone: zone(entry.zone.id),
      box: region === undefined ? undefined : { min: region.min, max: region.max },
    };
  });
}

/** The zone holding the listener: the last placed one whose box contains it (x and z). */
export function zoneAt(zones: readonly PlacedZone[], listener: Vec3): PlacedZone | undefined {
  let found: PlacedZone | undefined;
  for (const placed of zones) {
    const { box } = placed;
    const inside =
      box === undefined ||
      (listener.x >= box.min.x &&
        listener.x <= box.max.x &&
        listener.z >= box.min.z &&
        listener.z <= box.max.z);
    if (inside) found = placed;
  }
  return found;
}

/** Equal-power fade gain for crossfade progress `p` (0 silent, 1 full): sin(p·π/2). */
export function equalPowerGain(p: number): number {
  return Math.sin((Math.min(1, Math.max(0, p)) * Math.PI) / 2);
}

/** A uniformly random point of the annulus `minRadius`–`maxRadius` around `centre` (horizontal). */
export function spawnInAnnulus(
  centre: Vec3,
  minRadius: number,
  maxRadius: number,
  height: number,
  random: Random,
): Vec3 {
  // Uniform over area: radius from the square-root of a uniform in r².
  const radius = Math.sqrt(minRadius ** 2 + random() * (maxRadius ** 2 - minRadius ** 2));
  const angle = random() * 2 * Math.PI;
  return {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + height,
    z: centre.z + radius * Math.sin(angle),
  };
}

/**
 * Times one repeating one-shot: every gap between scheduled plays is random in
 * [minIntervalS, maxIntervalS]. A long stall (a hidden tab) never fires a burst; the next play is
 * rescheduled from the present.
 */
export class OneShotSchedule {
  readonly #min: number;
  readonly #max: number;
  readonly #random: Random;
  #next: number;

  constructor(minIntervalS: number, maxIntervalS: number, random: Random, startS: number) {
    this.#min = minIntervalS;
    this.#max = maxIntervalS;
    this.#random = random;
    this.#next = startS + this.#gap();
  }

  #gap(): number {
    return this.#min + this.#random() * (this.#max - this.#min);
  }

  /** The scheduled time of a play now due at `nowS`, or undefined when none is. */
  due(nowS: number): number | undefined {
    if (nowS < this.#next) return undefined;
    const fired = this.#next;
    this.#next = fired + this.#gap();
    if (this.#next < nowS) this.#next = nowS + this.#gap();
    return fired;
  }
}

interface Bed {
  readonly cue: string;
  readonly handle: SoundHandle;
  /** Linear trim of the zone's bed. */
  readonly trim: number;
  /** Crossfade progress, 0–1. */
  progress: number;
  /** Where it is heading: 1 while its zone is current, else 0. */
  target: 0 | 1;
}

export interface AmbienceControllerOptions {
  readonly engine: AmbienceEngine;
  readonly zones: readonly PlacedZone[];
  /** Seeded generator for gaps and spawn points. */
  readonly random: Random;
  /** Crossfade length in seconds; default 2. */
  readonly crossfadeS?: number;
}

/** What ambience is doing, for debug overlays and the e2e probe. */
export interface AmbienceState {
  /** The zone the listener is in, or undefined. */
  readonly zone: string | undefined;
  /** Beds currently playing or fading, by cue id. */
  readonly beds: readonly string[];
}

export class AmbienceController {
  readonly #engine: AmbienceEngine;
  readonly #zones: readonly PlacedZone[];
  readonly #random: Random;
  readonly #crossfadeS: number;
  readonly #beds = new Map<string, Bed>();
  #current: PlacedZone | undefined;
  #schedules: { readonly spec: AmbienceOneShot; readonly schedule: OneShotSchedule }[] = [];
  #lastS: number | undefined;

  constructor(options: AmbienceControllerOptions) {
    this.#engine = options.engine;
    this.#zones = options.zones;
    this.#random = options.random;
    this.#crossfadeS = options.crossfadeS ?? AMBIENCE_CROSSFADE_S;
  }

  get state(): AmbienceState {
    return { zone: this.#current?.zone.id, beds: [...this.#beds.keys()] };
  }

  /**
   * Once per frame, with the listener's position and the presentation clock in seconds: switches
   * zones, advances the crossfade and fires the zone's due one-shots. Does nothing until the audio
   * context is running (the autoplay policy), so the first zone starts on the first gesture.
   */
  update(listener: Vec3, nowS: number): void {
    if (this.#engine.context?.state !== 'running') {
      this.#lastS = undefined;
      return;
    }
    const dt = this.#lastS === undefined ? 0 : Math.max(0, nowS - this.#lastS);
    const first = this.#lastS === undefined && this.#current === undefined;
    this.#lastS = nowS;
    const here = zoneAt(this.#zones, listener);
    if (here !== this.#current || first) this.#enter(here, nowS);
    this.#advance(dt);
    for (const { spec, schedule } of this.#schedules) {
      if (schedule.due(nowS) === undefined) continue;
      this.#engine.play(spec.cue, {
        position: spawnInAnnulus(
          listener,
          spec.minRadius,
          spec.maxRadius,
          spec.height,
          this.#random,
        ),
        volume: dbToGain(spec.gainDb),
      });
    }
  }

  /** Fades every bed out (leaving the scene). */
  dispose(): void {
    for (const bed of this.#beds.values()) bed.handle.stop(this.#crossfadeS);
    this.#beds.clear();
    this.#schedules = [];
    this.#current = undefined;
    this.#lastS = undefined;
  }

  #enter(next: PlacedZone | undefined, nowS: number): void {
    this.#current = next;
    for (const bed of this.#beds.values()) bed.target = 0;
    const spec = next?.zone.bed;
    if (spec !== undefined) {
      const kept = this.#beds.get(spec.cue);
      if (kept !== undefined) {
        // The next zone shares this bed: it just carries on.
        kept.target = 1;
      } else {
        const trim = dbToGain(spec.gainDb);
        const handle = this.#engine.play(spec.cue, { volume: 0 });
        if (handle !== null) {
          this.#beds.set(spec.cue, { cue: spec.cue, handle, trim, progress: 0, target: 1 });
        }
      }
    }
    this.#schedules = (next?.zone.oneShots ?? []).map((one) => ({
      spec: one,
      schedule: new OneShotSchedule(one.minIntervalS, one.maxIntervalS, this.#random, nowS),
    }));
  }

  #advance(dt: number): void {
    const step = this.#crossfadeS > 0 ? dt / this.#crossfadeS : 1;
    for (const [cue, bed] of this.#beds) {
      bed.progress =
        bed.target === 1 ? Math.min(1, bed.progress + step) : Math.max(0, bed.progress - step);
      if (bed.target === 0 && bed.progress === 0) {
        bed.handle.stop(0);
        this.#beds.delete(cue);
        continue;
      }
      // A ramp as long as the frame keeps the engine's linear ramps on the equal-power curve.
      bed.handle.fade(equalPowerGain(bed.progress) * bed.trim, dt);
    }
  }
}
