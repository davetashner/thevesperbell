// Light components (mw-e03.15). Brightness itself is the `lightEmitter` world property (intensity and
// radius) plus `burning`; these two components add the shape information that property leaves out:
// a spotlight's cone, and the box an opaque object blocks light with instead of its bounding sphere.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import { normalize, type Vec3 } from '../stimulus/shapes';

/** Makes an entity's light a spotlight: it only lights positions inside this cone. */
export interface LightCone {
  /** The cone's axis, unit length (a non-zero direction is normalised on the way in). */
  readonly direction: Vec3;
  /** Half the opening angle, radians, in (0, π]; π lights every direction. */
  readonly halfAngle: number;
}

/** Makes an opaque entity block light as this box (centred on its placement), not as its sphere. */
export interface LightOccluderBox {
  /** Half the box's size on each axis, metres, each > 0. */
  readonly halfExtents: Vec3;
}

function finiteVec(what: string, value: unknown): Vec3 {
  if (typeof value !== 'object' || value === null) throw new RangeError(`${what} must be a vector`);
  const { x, y, z } = value as Record<string, unknown>;
  for (const [name, n] of [
    ['x', x],
    ['y', y],
    ['z', z],
  ] as const) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new RangeError(`${what}.${name} must be a finite number`);
    }
  }
  return { x: x as number, y: y as number, z: z as number };
}

function asObject(what: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null)
    throw new RangeError(`${what} must be an object`);
  return value as Record<string, unknown>;
}

/** A validated, frozen copy of `value` with a unit direction. Throws a RangeError. */
export function toLightCone(value: unknown): LightCone {
  const { direction, halfAngle } = asObject('light cone', value);
  const unit = normalize(finiteVec('light cone direction', direction));
  if (unit === undefined) throw new RangeError('light cone direction must not be zero');
  if (typeof halfAngle !== 'number' || !(halfAngle > 0 && halfAngle <= Math.PI)) {
    throw new RangeError('light cone halfAngle must be in (0, π]');
  }
  return Object.freeze({ direction: Object.freeze(unit), halfAngle });
}

/** A validated, frozen copy of `value`. Throws a RangeError. */
export function toLightOccluderBox(value: unknown): LightOccluderBox {
  const { halfExtents } = asObject('light occluder', value);
  const half = finiteVec('light occluder halfExtents', halfExtents);
  if (!(half.x > 0 && half.y > 0 && half.z > 0)) {
    throw new RangeError('light occluder halfExtents must all be > 0');
  }
  return Object.freeze({ halfExtents: Object.freeze(half) });
}

/**
 * Marks an entity as a light source prefab (mw-e03.16: candle, torch, brazier, lantern…). Its
 * `lightEmitter` only shines while it is `burning`; the rest is what designers set per instance.
 */
export interface LightSourceData {
  /** Which prefab it is (`torch`, `brazier`…); informational, behaviour comes from properties. */
  readonly variant: string;
  /** Its fuel never runs out: it is topped up every tick while it burns. */
  readonly infiniteFuel: boolean;
  /** The actor carrying it (a guard's lantern), or null when it is fixed in the world. */
  readonly carrier: EntityId | null;
  /** Where it hangs relative to its carrier, metres. */
  readonly offset: Vec3;
}

/** The spotlight cone component (`light.cone`; a snapshot and save key, never renamed). */
export const LightConeComponent = defineComponent<LightCone>('light.cone', {
  deserialize: toLightCone,
});

/** The occluder box component (`light.occluder`; a snapshot and save key, never renamed). */
export const LightOccluderComponent = defineComponent<LightOccluderBox>('light.occluder', {
  deserialize: toLightOccluderBox,
});

/** The light source component (`light.source`; a snapshot and save key, never renamed). */
export const LightSourceComponent = defineComponent<LightSourceData>('light.source');

/** Every component the light field reads besides placements and world properties. */
export const lightComponents = [
  LightConeComponent,
  LightOccluderComponent,
  LightSourceComponent,
] as const;

/** Gives `entity`'s light the cone `cone` (validated; structural during a step, like `World.add`). */
export function setLightCone(world: World<never>, entity: EntityId, cone: LightCone): void {
  const value = toLightCone(cone);
  if (world.has(entity, LightConeComponent)) world.set(entity, LightConeComponent, value);
  else world.add(entity, LightConeComponent, value);
}

/** Makes opaque `entity` block light as a box with these half extents (validated). */
export function setLightOccluderBox(
  world: World<never>,
  entity: EntityId,
  halfExtents: Vec3,
): void {
  const value = toLightOccluderBox({ halfExtents });
  if (world.has(entity, LightOccluderComponent)) world.set(entity, LightOccluderComponent, value);
  else world.add(entity, LightOccluderComponent, value);
}
