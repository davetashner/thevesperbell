// Sim → render sync (mw-e00.20): a registry binding sim entities to scene objects. The sim publishes
// state; this reads it through a read-only view (never stepping or mutating it), keeps the transform
// from the previous and the latest sim step for each bound entity, and on every display frame writes
// the transform interpolated by the loop's alpha into the scene object. When an entity is destroyed
// in the sim, its scene object is disposed in the next render pass, i.e. the same frame the sim
// step that destroyed it ran in.
//
// Renderer-agnostic: a binding supplies how to read a transform from the sim and how to apply and
// dispose its scene object (see three-binding.ts for Three.js).

import type { EntityId, World } from '@sim/index';

/** Read-only sim access for render sync. `World` satisfies it; nothing here can step or mutate. */
export type SimView = Pick<World, 'tick' | 'isAlive' | 'get' | 'isRegistered'>;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A unit quaternion. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
}

export const IDENTITY_ROTATION: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** How one entity's scene object follows the sim. */
export interface SceneBinding<TObject> {
  readonly object: TObject;
  /** The entity's current transform in the sim, or undefined when it has none (object left as is). */
  read(view: SimView, entity: EntityId): Transform | undefined;
  /** Writes an (interpolated) transform into the scene object. */
  apply(object: TObject, transform: Transform): void;
  /** Frees the scene object (remove from the scene, release GPU resources). */
  dispose(object: TObject): void;
}

interface Bound {
  readonly binding: SceneBinding<unknown>;
  previous: Transform | undefined;
  current: Transform | undefined;
}

export class RenderSync {
  private readonly bindings = new Map<EntityId, Bound>();

  constructor(private readonly view: SimView) {}

  /** Number of bound entities. */
  get size(): number {
    return this.bindings.size;
  }

  has(entity: EntityId): boolean {
    return this.bindings.has(entity);
  }

  /** The scene object bound to `entity`, if any (read-only access for presentation layers). */
  objectOf(entity: EntityId): unknown {
    return this.bindings.get(entity)?.binding.object;
  }

  /**
   * Binds a scene object to a live entity. The object starts at the entity's current transform (no
   * interpolation from an old position). Rebinding an entity disposes its previous object.
   */
  bind<TObject>(entity: EntityId, binding: SceneBinding<TObject>): void {
    if (!this.view.isAlive(entity)) {
      throw new Error(`cannot bind entity ${String(entity)}: it is not alive in the sim`);
    }
    this.unbind(entity);
    const current = binding.read(this.view, entity);
    this.bindings.set(entity, {
      binding,
      previous: current,
      current,
    });
    if (current !== undefined) binding.apply(binding.object, current);
  }

  /** Disposes and forgets an entity's scene object. Returns whether one was bound. */
  unbind(entity: EntityId): boolean {
    const bound = this.bindings.get(entity);
    if (bound === undefined) return false;
    this.bindings.delete(entity);
    bound.binding.dispose(bound.binding.object);
    return true;
  }

  /** Records the state after a sim step: the latest becomes the previous. Call after every step. */
  capture(): void {
    for (const [entity, bound] of this.bindings) {
      if (!this.view.isAlive(entity)) continue; // disposed by the next render
      bound.previous = bound.current;
      bound.current = bound.binding.read(this.view, entity);
    }
  }

  /**
   * Updates every scene object for this frame: disposes objects whose entity the sim destroyed, then
   * applies transforms interpolated `alpha` ∈ [0, 1) of the way from the previous to the latest step.
   */
  render(alpha: number): void {
    for (const [entity, bound] of this.bindings) {
      if (!this.view.isAlive(entity)) {
        this.unbind(entity); // deleting the current entry while iterating a Map is safe
        continue;
      }
      const { previous, current, binding } = bound;
      if (current === undefined) continue;
      binding.apply(
        binding.object,
        previous === undefined ? current : interpolateTransform(previous, current, alpha),
      );
    }
  }

  /** Disposes every bound scene object. */
  dispose(): void {
    for (const entity of [...this.bindings.keys()]) this.unbind(entity);
  }
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Spherical interpolation along the shortest arc; falls back to normalised lerp when nearly equal. */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  // q and -q are the same rotation: flip b so we take the short way round.
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    wa = 1 - t;
    wb = t * sign;
  } else {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = (Math.sin(t * theta) / sin) * sign;
  }
  const x = a.x * wa + b.x * wb;
  const y = a.y * wa + b.y * wb;
  const z = a.z * wa + b.z * wb;
  const w = a.w * wa + b.w * wb;
  const length = Math.hypot(x, y, z, w);
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

export function interpolateTransform(a: Transform, b: Transform, t: number): Transform {
  return {
    position: lerpVec3(a.position, b.position, t),
    rotation: slerpQuat(a.rotation, b.rotation, t),
  };
}
