// Noise propagation in a world (mw-e09.3): the bus side of propagation.ts. Emitters (footsteps,
// impacts, shouts, spells; doors and breakables already do) raise `noiseEmitted` through `emitNoise`;
// once installed, every noise is propagated through the level's sound graph with the doors' states
// as they are at that moment, and each listener (an entity with a `noise.listener` and a placement)
// that hears it at or above its threshold, within its range, gets a `noiseHeard` with the perceived
// level and position. Perception (e11) reads `noiseHeard`; it never sees the source unless the sound
// came straight to it. The audio engine (e28) reuses the same answer through `propagate`.
//
// Door gains come from the door's state when the sound passes (`doorSoundState`): open or broken →
// open, part-way or moving → ajar, shut → closed; a door that does not block sound (a grille) is
// always open. A door entity that is gone (burnt away) leaves its portal open.

import type { DoorSoundState, NoiseTuning } from '@content/index';
import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { DoorComponent, type Door } from '../mechanisms/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { noiseEmitted, type NoiseEvent } from './events';
import type { SoundGraph, SoundPortal } from './graph';
import {
  DEFAULT_NOISE_TUNING,
  doorGainDb,
  propagateNoise,
  type NoiseField,
  type PortalGain,
} from './propagation';

/** Something that hears noises (a sense profile's hearing, e12). */
export interface NoiseListener {
  /** Quietest level it hears, dB at the listener after propagation. */
  readonly thresholdDb: number;
  /** Metres (straight line from the source) beyond which it hears nothing, however loud. */
  readonly range: number;
}

/** A listener (`noise.listener`; a snapshot and save key, never renamed). */
export const NoiseListenerComponent = defineComponent<NoiseListener>('noise.listener');

/** A listener heard a noise. */
export interface NoiseHeard {
  readonly tick: number;
  readonly listener: EntityId;
  readonly noise: NoiseEvent;
  /** Perceived level, dB. */
  readonly level: number;
  /** Where it seemed to come from: the last portal it came through, else the source. */
  readonly perceived: Vec3;
  /** That portal's id, or null. */
  readonly via: string | null;
  /** dB lost to doors, walls and floors. */
  readonly occlusion: number;
}

/** Fired for each listener that hears a noise, in listener id order. */
export const noiseHeard = defineEvent<NoiseHeard>('noiseHeard');

/** The state noise propagation weighs for `door`. */
export function doorSoundState(door: Door): DoorSoundState {
  if (door.broken || !door.blocks.sound || door.openness >= 1) return 'open';
  return door.openness <= 0 ? 'closed' : 'ajar';
}

/**
 * Portal gains read from the world's doors at call time. `doorMaterial` maps a door profile id to
 * its leaf material (for the tuning's per-material gains); without it every door uses the defaults.
 */
export function worldPortalGain(
  world: World<never>,
  tuning: NoiseTuning = DEFAULT_NOISE_TUNING,
  doorMaterial?: (profile: string) => string | undefined,
): PortalGain {
  return (portal: SoundPortal) => {
    if (portal.door === null) return 0;
    const door = world.get(portal.door, DoorComponent);
    if (door === undefined) return 0;
    return doorGainDb(doorSoundState(door), doorMaterial?.(door.profile) ?? null, tuning);
  };
}

/** What a noise emitter supplies; the tick is the world's. */
export interface NoiseSpec {
  readonly position: Vec3;
  /** Level 1 m from the source, dB. */
  readonly loudness: number;
  readonly kind: string;
  readonly entity?: EntityId | null;
  readonly source?: EntityId | null;
  readonly tags?: readonly string[];
}

/**
 * Raises a noise on the world's bus (footsteps, impacts, shouts, spells).
 * @throws RangeError when the loudness or position is not finite.
 */
export function emitNoise(world: World<never>, spec: NoiseSpec): void {
  const { position, loudness } = spec;
  if (!Number.isFinite(loudness)) {
    throw new RangeError(`noise loudness must be finite, got ${String(loudness)}`);
  }
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new RangeError('noise position must be finite');
  }
  world.events.emit(noiseEmitted, {
    tick: world.tick,
    position: Object.freeze({ x: position.x, y: position.y, z: position.z }),
    loudness,
    kind: spec.kind,
    entity: spec.entity ?? null,
    source: spec.source ?? null,
    tags: Object.freeze([...(spec.tags ?? [])]),
  });
}

export interface NoisePropagationOptions {
  /** The level's sound graph (scene.ts builds it from a scene). */
  readonly graph: SoundGraph;
  readonly tuning?: NoiseTuning;
  /** Door profile id → leaf material, for per-material door gains. */
  readonly doorMaterial?: (profile: string) => string | undefined;
}

/** An installed noise propagation. */
export interface NoisePropagation {
  readonly graph: SoundGraph;
  /** Swaps the level's graph (a level change). */
  setGraph(graph: SoundGraph): void;
  /** Propagates a noise with the doors as they are now: the hook the audio engine reuses. */
  propagate(position: Vec3, loudness: number): NoiseField;
  /** Stops listening to the bus. */
  uninstall(): void;
}

function straightDistance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Propagates every `noiseEmitted` to the world's listeners as `noiseHeard`. A listener does not hear
 * a noise it is the source of or the sounding entity of (a creature never chases its own footfall).
 */
export function installNoisePropagation<T>(
  world: World<T>,
  options: NoisePropagationOptions,
): NoisePropagation {
  const w = world as unknown as World<never>;
  w.register(NoiseListenerComponent);
  const tuning = options.tuning ?? DEFAULT_NOISE_TUNING;
  const portalGain = worldPortalGain(w, tuning, options.doorMaterial);
  let graph = options.graph;
  const propagate = (position: Vec3, loudness: number): NoiseField =>
    propagateNoise(graph, position, loudness, { tuning, portalGain });
  const listeners = w.query(NoiseListenerComponent, PlacementComponent);
  const unsubscribe = w.events.on(noiseEmitted, (noise) => {
    let field: NoiseField | null = null;
    listeners.forEach((listener, hearing, placement) => {
      if (listener === noise.source || listener === noise.entity) return;
      if (straightDistance(noise.position, placement) > hearing.range) return;
      field ??= propagate(noise.position, noise.loudness);
      const heard = field.hear(placement);
      if (heard === null || heard.level < hearing.thresholdDb) return;
      w.events.emit(noiseHeard, {
        tick: noise.tick,
        listener,
        noise,
        level: heard.level,
        perceived: heard.perceived,
        via: heard.via,
        occlusion: heard.occlusion,
      });
    });
  });
  return {
    get graph() {
      return graph;
    },
    setGraph(next) {
      graph = next;
    },
    propagate,
    uninstall: unsubscribe,
  };
}
