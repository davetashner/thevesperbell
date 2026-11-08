// A loaded scene's physics (mw-e03.39): after `loadScene`, this makes the scene's movable props
// physics objects and its level geometry part of the physics-object layer (mw-e03.10).
//
// - Level colliders: every placed kit piece with solid parts gets the level material's world
//   properties (stone by default) and its colliders are bound to it, so an impact on a wall names
//   the wall and "stone", and the colliders take stone's friction and bounciness. A placement's own
//   `properties` override the level material's (mw-e03.22: an ivy wall, a ladder, a wooden beam);
//   a piece without solid parts gets only the properties its placement sets.
// - Props: a spawn whose prop has a body becomes a dynamic body standing on the spawn point (the
//   spawn is the middle of the body's base), turned by the spawn's yaw, with the prop's mass as its
//   weight and its material's properties. From then on the sim moves it; the renderer draws it from
//   its `physics.object` pose.
//
// - Other spawns with world properties (mw-e03.37: a torch that burns, a glowing crystal) get those
//   properties and a placement at the spawn point, so the light field, stimuli and element rules
//   reach them. A prop spawn's own properties go over its prop's.
//
// `addPropPhysics` is the one way a prop becomes a physics object: the debug console's spawners
// (src/sim/debug) use it too.
//
// Unloading needs nothing extra: destroying a spawn entity takes its body with it (mw-e03.41), and
// destroying a piece takes its bound colliders with it (mw-e03.42: an ivy wall that burns away leaves
// no invisible wall); `unloadScene` removes the rest. The sim never imports content: the game passes the
// prop bodies and material presets in as plain lookups.

import type { EntityId } from '../core/component';
import { at } from '../geom/vec';
import type { World } from '../core/world';
import { addRecoveryAnchor } from '../carry/recovery';
import { addPhysicsObject, bindCollider } from '../physics/objects';
import type { ColliderHandle } from '../physics/static-colliders';
import {
  addMaterialProperties,
  resolveProperties,
  type MaterialPresets,
} from '../properties/materials';
import type { WorldPropertyInit } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import type { Quat, ScenePropertiesSpec } from './layout';
import type { LoadedScene } from './loader';

/** The material level geometry is made of unless the scene physics says otherwise. */
export const DEFAULT_LEVEL_MATERIAL = 'stone';

/** A movable prop's rigid body. */
export interface PropBody {
  /** Box size along the prop's own x, y, z, metres. */
  readonly size: Vec3;
  /** Material preset id. */
  readonly material: string;
  /** kg: the body's `weight`. */
  readonly weight: number;
  /** Overrides the material's `flammable` when given. */
  readonly flammable?: boolean;
}

/** Prop id → its body, or undefined when the prop is not movable. */
export type PropBodyLookup = (prop: string) => PropBody | undefined;

export interface ScenePhysicsOptions {
  readonly props: PropBodyLookup;
  readonly materials: MaterialPresets;
  /** Material of the level geometry; defaults to DEFAULT_LEVEL_MATERIAL. */
  readonly levelMaterial?: string;
}

/** What `addScenePhysics` did. */
export interface ScenePhysics {
  /** Spawn entities that became physics objects, in scene order. */
  readonly objects: readonly EntityId[];
  /** Piece entities whose colliders were bound, in scene order. */
  readonly solids: readonly EntityId[];
  /** Spawn entities without a body that were given properties and a placement, in scene order. */
  readonly placed: readonly EntityId[];
}

/**
 * Adds `loaded`'s physics to `world`, which needs world properties registered and physics objects
 * installed (`registerWorldProperties`, a placement component, `installPhysicsObjects`). Call
 * between steps, straight after `loadScene` with the same physics as the collider sink.
 * @throws RangeError when a prop or the level names a material `materials` does not have.
 */
export function addScenePhysics<T>(
  world: World<T>,
  loaded: LoadedScene,
  options: ScenePhysicsOptions,
): ScenePhysics {
  const sim = world as unknown as World<never>; // the physics layer never reads inputs
  const level = options.levelMaterial ?? DEFAULT_LEVEL_MATERIAL;
  // loadScene adds one collider per solid part, in part order.
  const owned = new Map<number, ColliderHandle[]>();
  let next = 0;
  for (const part of loaded.layout.parts) {
    if (part.collider === undefined) continue;
    const collider = loaded.colliders[next++];
    if (collider === undefined) break; // a scene whose colliders were already taken out
    owned.set(part.placement, [...(owned.get(part.placement) ?? []), collider]);
  }
  const solids: EntityId[] = [];
  loaded.pieces.forEach((entity, placement) => {
    const colliders = owned.get(placement);
    const own = placementProperties(at(loaded.layout.pieces, placement).properties);
    if (colliders === undefined) {
      // A piece with no solid parts (a decal, a hanging vine) has only the properties it sets.
      if (Object.keys(own).length > 0) addMaterialProperties(sim, entity, options.materials, own);
      return;
    }
    addMaterialProperties(sim, entity, options.materials, { material: level, ...own });
    for (const collider of colliders) bindCollider(sim, entity, collider);
    solids.push(entity);
  });
  const objects: EntityId[] = [];
  const placed: EntityId[] = [];
  for (const { entity, spawn } of loaded.spawns) {
    const own = placementProperties(spawn.properties);
    const body = spawn.prop === undefined ? undefined : options.props(spawn.prop);
    if (body !== undefined) {
      addPropPhysics(sim, entity, body, options.materials, spawn.position, spawn.rotation, own);
      if (spawn.recovery !== undefined) addRecoveryAnchor(sim, entity, spawn.recovery);
      objects.push(entity);
    } else if (Object.keys(own).length > 0) {
      addMaterialProperties(sim, entity, options.materials, own);
      placeEntity(sim, entity, spawn.position);
      placed.push(entity);
    }
  }
  return Object.freeze({
    objects: Object.freeze(objects),
    solids: Object.freeze(solids),
    placed: Object.freeze(placed),
  });
}

/**
 * A placement's data-file properties as the sim takes them: the material reference becomes its id
 * and absent fields are left out.
 */
export function placementProperties(
  properties: ScenePropertiesSpec | undefined,
): WorldPropertyInit {
  if (properties === undefined) return {};
  const { material, ...rest } = properties;
  const init: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) init[key] = value;
  }
  // The same keys and value types, the material as its id.
  return material === undefined ? init : { ...init, material: material.id };
}

/**
 * Makes `entity` a movable prop: gives it `body`'s material properties and makes it a physics object
 * standing on `at` (the middle of the body's base), turned by `rotation`, with `extra` properties
 * over the prop's (a scene spawn's own, mw-e03.37). Works between steps and
 * during one (a debug spawn inside `World.step`): the body is built from the resolved properties, so
 * it has the prop's mass and material at once, while the properties and the `physics.object`
 * component go live with the rest of the tick's structural changes.
 * @throws RangeError when `body` names a material `materials` does not have.
 */
export function addPropPhysics(
  world: World<never>,
  entity: EntityId,
  body: PropBody,
  materials: MaterialPresets,
  at: Vec3,
  rotation?: Quat,
  extra: WorldPropertyInit = {},
): void {
  const init: WorldPropertyInit = {
    material: body.material,
    weight: body.weight,
    ...(body.flammable !== undefined && { flammable: body.flammable }),
    ...extra,
  };
  const { weight, friction, impactAbsorb } = resolveProperties(materials, init);
  addMaterialProperties(world, entity, materials, init);
  const { x, y, z } = body.size;
  addPhysicsObject(world, entity, {
    shape: { kind: 'box', halfExtents: { x: x / 2, y: y / 2, z: z / 2 } },
    position: { x: at.x, y: at.y + y / 2, z: at.z },
    ...(rotation !== undefined && { rotation }),
    properties: { weight, friction, impactAbsorb },
  });
}
