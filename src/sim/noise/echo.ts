// Echoes (mw-e24.10): a place that gives a landing back. A scene's echo volumes (its acoustics'
// `echoes`: a deep well shaft, a cistern vault) repeat every landing noise made inside them once,
// `delay` seconds later and `loss` dB quieter, from the same place and on behalf of the same entity
// and source. So a stone dropped down the Glen Well is heard to land twice, and a creature listening
// at the rim hears both. Nothing here names an object: any object's impact, splash or a character's
// landing echoes alike, and an echo never echoes again (it carries the `echo` tag).
//
// The delay is counted in ticks (rounded, at least one), so the echo is as deterministic as the
// landing it repeats. Pending echoes are transient (well under a second) and not saved.

import type { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import { noiseEmitted, type NoiseEvent } from './events';
import { LANDING_NOISE } from './footsteps';
import { ITEM_IMPACT_NOISE, OBJECT_IMPACT_NOISE, SPLASH_NOISE } from './impacts';
import { emitNoise } from './system';

/** The tag an echo carries (an echo is never echoed). */
export const ECHO_TAG = 'echo';

/** Noise kinds that are something landing: an item, an object, a splash, a character. */
export const LANDING_NOISE_KINDS: readonly string[] = Object.freeze([
  ITEM_IMPACT_NOISE,
  OBJECT_IMPACT_NOISE,
  SPLASH_NOISE,
  LANDING_NOISE,
]);

/** A box that echoes the landings made inside it. */
export interface EchoVolume {
  readonly id: string;
  /** Lower corner, metres. */
  readonly min: Vec3;
  /** Upper corner, metres. */
  readonly max: Vec3;
  /** Seconds from a landing to its echo (> 0). */
  readonly delay: number;
  /** How much quieter the echo is, dB (≥ 0). */
  readonly loss: number;
}

/** The echo volumes of the loaded scene; swapped with the scene. */
export interface NoiseEcho {
  /** Replaces the volumes (a scene swap); pending echoes are dropped. */
  setVolumes(volumes: readonly EchoVolume[]): void;
  /** Stops echoing and drops pending echoes. */
  stop(): void;
}

const inside = (p: Vec3, { min, max }: EchoVolume): boolean =>
  p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;

interface Pending {
  readonly due: number;
  readonly noise: NoiseEvent;
  readonly loudness: number;
}

/**
 * Echoes landing noises made inside `volumes` (see the file header). Install once; the returned
 * handle swaps the volumes with the scene.
 * @throws RangeError for a delay that is not positive or a loss that is negative.
 */
export function installNoiseEcho<T>(world: World<T>, volumes: readonly EchoVolume[]): NoiseEcho {
  const w = world as unknown as World<never>;
  let current: readonly EchoVolume[] = [];
  let pending: Pending[] = [];
  let running = true;
  const check = (list: readonly EchoVolume[]): readonly EchoVolume[] => {
    for (const v of list) {
      if (!(v.delay > 0)) throw new RangeError(`echo "${v.id}" needs a positive delay`);
      if (!(v.loss >= 0)) throw new RangeError(`echo "${v.id}" needs a loss of 0 dB or more`);
    }
    return [...list];
  };
  current = check(volumes);
  const off = w.events.on(noiseEmitted, (noise) => {
    if (!LANDING_NOISE_KINDS.includes(noise.kind) || noise.tags?.includes(ECHO_TAG) === true) {
      return;
    }
    const volume = current.find((v) => inside(noise.position, v));
    if (volume === undefined) return;
    const loudness = noise.loudness - volume.loss;
    if (loudness <= 0) return;
    const ticks = Math.max(1, Math.round(volume.delay * w.clock.hz));
    pending.push({ due: w.tick + ticks, noise, loudness });
  });
  w.addSystem({
    name: 'noise-echo',
    run({ tick }) {
      if (pending.length === 0) return;
      const due = pending.filter((p) => p.due <= tick);
      if (due.length === 0) return;
      pending = pending.filter((p) => p.due > tick);
      for (const { noise, loudness } of due) {
        emitNoise(w, {
          position: noise.position,
          loudness,
          kind: noise.kind,
          entity: noise.entity,
          source: noise.source,
          tags: [...(noise.tags ?? []), ECHO_TAG],
        });
      }
    },
  });
  return {
    setVolumes(next) {
      current = running ? check(next) : [];
      pending = [];
    },
    stop() {
      running = false;
      off();
      current = [];
      pending = [];
    },
  };
}
