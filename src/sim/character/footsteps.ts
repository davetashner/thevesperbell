// Footstep surface and loudness (mw-e02.11): what a footstep event says about the ground it fell
// on. The material is the world property `material` of the entity owning the collider the character
// stands on (unbound geometry reads the property's default), with its `wetness`, `frozen` and
// `burning` states; wading reports the material `water` instead. Loudness is data, never code:
//
//   surfaceDb = material footstepLoudness (dB relative to stone) + wetDb if wet + frozenDb if frozen
//   loudness  = profile noise × 10^(surfaceDb / 20)
//
// `profile noise` is the character's MovementProfile noise (stance × gait × encumbrance, 0–1), so
// loudness is a normalised multiplier: 1 is a sprinting, unencumbered step on stone. Stealth
// (mw-e09.5) turns it into dB with its own gait table, or adds `surfaceDb` to that table directly.
// Nothing here is noise: no sound is emitted into propagation.
//
// Everything is read from sim state at the step, so it is deterministic and replays; the audio and
// animation layers only read the event.

import type { Frozen, FootstepSurfaces } from '@content/index';
import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { ownerOfCollider } from '../climb/surfaces';
import { pow } from '../math';
import {
  WORLD_PROPERTY_SPECS,
  type WorldPropertyKey,
  type WorldPropertyValues,
} from '../properties/spec';
import { readProperty, WorldProperties } from '../properties/components';
import { CharacterController } from './system';

/** The defaults when a controller profile's `stealth` block has no `surfaces`: +3 dB wet, +2 dB frozen. */
export const DEFAULT_FOOTSTEP_SURFACES: Frozen<FootstepSurfaces> = Object.freeze({
  wetFrom: 0.5,
  wetDb: 3,
  frozenDb: 2,
});

/** The ground under a character's feet: what its footsteps are tagged with. */
export interface FootSurface {
  /** Material id (`stone`, `gravel`, `water` while wading). */
  readonly material: string;
  /** Wet enough to splash or slap (wetness at or above `wetFrom`, or wading). */
  readonly wet: boolean;
  readonly frozen: boolean;
  readonly burning: boolean;
  /** The surface's loudness offset, dB relative to stone, wet and frozen included. */
  readonly surfaceDb: number;
}

/** What the ground reads before its loudness is worked out. */
export interface GroundReading {
  readonly material: string;
  readonly wetness: number;
  readonly frozen: boolean;
  readonly burning: boolean;
}

/** Material id → footstep loudness offset, dB relative to stone (unknown materials: 0). */
export type SurfaceOffsets = (material: string) => number | undefined;

/** The tagged surface of `ground` (see the file header). Pure. */
export function footSurface(
  ground: GroundReading,
  offsetOf: SurfaceOffsets,
  tuning: Frozen<FootstepSurfaces>,
): FootSurface {
  const wet = ground.wetness >= tuning.wetFrom && ground.wetness > 0;
  return {
    material: ground.material,
    wet,
    frozen: ground.frozen,
    burning: ground.burning,
    surfaceDb:
      (offsetOf(ground.material) ?? 0) +
      (wet ? tuning.wetDb : 0) +
      (ground.frozen ? tuning.frozenDb : 0),
  };
}

/** A footstep's loudness: the profile's noise times the surface's pressure ratio (see the header). */
export function footstepLoudness(profileNoise: number, surfaceDb: number): number {
  return profileNoise * pow(10, surfaceDb / 20);
}

/**
 * The ground `entity` stands on: the properties of the entity that owns its ground collider, or the
 * defaults for unbound geometry; undefined when it stands on nothing (airborne, no controller).
 */
export function groundUnder(world: World<never>, entity: EntityId): GroundReading | undefined {
  const body = world.get(entity, CharacterController)?.groundBody;
  if (body === undefined || body === null) return undefined;
  const owner = ownerOfCollider(world, body);
  const read = <K extends WorldPropertyKey>(key: K): WorldPropertyValues[K] =>
    owner !== undefined && world.isAlive(owner) && world.isRegistered(WorldProperties[key])
      ? readProperty(world, owner, key)
      : (WORLD_PROPERTY_SPECS[key].default as WorldPropertyValues[K]);
  return {
    material: read('material'),
    wetness: read('wetness'),
    frozen: read('frozen'),
    burning: read('burning'),
  };
}
