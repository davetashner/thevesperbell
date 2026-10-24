// Spells on screen (mw-e06.15): the glue between the sim's spell projectiles and their placeholder
// glow spheres (src/render/magic), and the view ray the reticle aims along. Presentation only.
//
// - `readBoltTransform` places a bolt for render sync at the projectile's position.
// - `bindBolts` gives every flying spell projectile without one a sphere after each step; render sync
//   drops it when the projectile leaves the world.
// - `viewRay` is the camera's centre ray: the reticle's aim.

import {
  SpellProjectileComponent,
  type EntityId,
  type SpellLookup,
  type Vec3,
  type World,
} from '@sim/index';
import type { RenderSync, SceneBinding, SimView, Transform } from '../loop/render-sync';
import type { AimRay } from './aim';

const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** A bolt's transform for render sync; undefined for anything that is not a spell projectile. */
export function readBoltTransform(view: SimView, entity: EntityId): Transform | undefined {
  if (!view.isRegistered(SpellProjectileComponent)) return undefined;
  const flight = view.get(entity, SpellProjectileComponent);
  return flight === undefined ? undefined : { position: flight.position, rotation: IDENTITY };
}

/** The visual radius of a bolt: the delivery's collision radius, never smaller than a spark. */
export const MIN_BOLT_RADIUS = 0.08;

/**
 * Binds a sphere to every spell projectile not bound yet (call after each sim step); `create` builds
 * it from the bolt's radius. Returns how many it bound.
 */
export function bindBolts<TObject>(
  world: World<never>,
  sync: RenderSync,
  spells: SpellLookup,
  create: (entity: EntityId, radius: number) => SceneBinding<TObject>,
): number {
  if (!world.isRegistered(SpellProjectileComponent)) return 0;
  const unbound: { entity: EntityId; radius: number }[] = [];
  world.query(SpellProjectileComponent).forEach((entity, flight) => {
    if (sync.has(entity)) return;
    const delivery = spells(flight.spell)?.delivery;
    const radius = delivery?.kind === 'projectile' ? delivery.radius : 0;
    unbound.push({ entity, radius: Math.max(MIN_BOLT_RADIUS, radius) });
  });
  for (const { entity, radius } of unbound) sync.bind(entity, create(entity, radius));
  return unbound.length;
}

/** A camera's pose: position and rotation (a camera looks along its local −z). */
export interface ViewPose {
  readonly position: Vec3;
  readonly quaternion: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
}

/** The ray through the centre of the view. */
export function viewRay({ position, quaternion: q }: ViewPose): AimRay {
  return {
    origin: { x: position.x, y: position.y, z: position.z },
    direction: {
      x: -2 * (q.x * q.z + q.w * q.y),
      y: -2 * (q.y * q.z - q.w * q.x),
      z: -(1 - 2 * (q.x * q.x + q.y * q.y)),
    },
  };
}
