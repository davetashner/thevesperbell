// The Rapier implementation of the sim's physics port (ADR-0001, mw-e03.35), on the deterministic
// build of Rapier (@dimforge/rapier3d-deterministic, the non-compat package with a separate .wasm).
//
// The sim never imports Rapier at runtime: WASM has to be fetched and compiled asynchronously, and the
// sim is synchronous. The game loads the module (src/game/physics-loader.ts) and injects it here,
// exactly like the clock and the RNG seed; this file only imports Rapier's types.
//
// Colliders come from greybox shapes (src/sim/character/greybox.ts). A box is a cuboid; a ramp is the
// convex hull of its six wedge corners. Shapes without a velocity become fixed colliders; a shape
// with one is a kinematic, velocity-based body (a moving platform) that Rapier moves every step.
// Handles are this port's own small integers (1, 2, 3… never reused), mapped to Rapier's handles.
// Dynamic bodies (mw-e03.10, bodies.ts) share the handle sequence: one collider on one dynamic body,
// with collision events on so each step can report the contacts that started (impacts).
//
// State: `snapshot()` is Rapier's own world snapshot (bit-exact: restoring it and stepping on gives
// the same bytes as never stopping) as base64, plus the handle table. It is part of every
// WorldSnapshot, so the sim state hash covers physics.

import type * as Rapier from '@dimforge/rapier3d-deterministic';
import type { GreyboxShape } from '../character/greybox';
import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';
import { decodeBase64, encodeBase64 } from './base64';
import {
  checkBodyDesc,
  type BodyDesc,
  type BodyMaterial,
  type BodyMotion,
  type BodyPose,
  type BodyShape,
  type ContactImpact,
  type RigidBodyPort,
} from './bodies';
import { PhysicsStateError, type PhysicsState } from './port';
import type { ColliderHandle } from './static-colliders';

/** The loaded @dimforge/rapier3d-deterministic module, injected by the game or by test setup. */
export type RapierModule = typeof Rapier;

export interface RapierPhysicsOptions {
  /** Gravity, m/s²; defaults to 9.81 straight down. */
  readonly gravity?: Vec3;
}

/** Standard gravity, m/s², pointing down. */
export const DEFAULT_GRAVITY: Vec3 = Object.freeze({ x: 0, y: -9.81, z: 0 });

/** One collider this port added: Rapier's collider handle and, for a moving one, its body's. */
interface Entry {
  readonly collider: number;
  readonly body: number | undefined;
}

/** A collider on a body. */
interface BodyEntry extends Entry {
  readonly body: number;
}

type HandleRow = readonly [number, number] | readonly [number, number, number];

/** `data` of a Rapier PhysicsState. */
interface RapierStateData {
  /** Rapier's world snapshot, base64. */
  readonly world: string;
  /** The next handle `add` will issue. */
  readonly next: number;
  /** [handle, Rapier collider handle] or [handle, Rapier collider handle, Rapier body handle]. */
  readonly colliders: readonly HandleRow[];
}

const AXES = ['x', 'y', 'z'] as const;

const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** A collider's linear velocity just before a step and its mass (Infinity when not dynamic). */
interface Before {
  readonly velocity: Vec3;
  readonly mass: number;
}

const vec = ({ x, y, z }: Vec3): Vec3 => ({ x, y, z });
const quat = ({ x, y, z, w }: Quat): Quat => ({ x, y, z, w });

/** Throws unless the shape has volume on every axis. */
function checkShape(shape: GreyboxShape): void {
  for (const axis of AXES) {
    if (!(shape.max[axis] > shape.min[axis])) {
      throw new RangeError(`greybox ${shape.kind}: max.${axis} must be above min.${axis}`);
    }
  }
}

/** The six corners of a ramp's wedge, relative to the centre of its box. */
function wedgeCorners(shape: GreyboxShape & { kind: 'ramp' }, centre: Vec3): Float32Array {
  const along = shape.rises === '+x' || shape.rises === '-x' ? 'x' : 'z';
  const across = along === 'x' ? 'z' : 'x';
  const high = shape.rises.startsWith('+') ? shape.max[along] : shape.min[along];
  const corner = (a: number, y: number, c: number): number[] => {
    const p = { x: 0, y, z: 0, [along]: a, [across]: c } as Vec3;
    return [p.x - centre.x, p.y - centre.y, p.z - centre.z];
  };
  const { min, max } = shape;
  return new Float32Array([
    ...corner(min[along], min.y, min[across]),
    ...corner(min[along], min.y, max[across]),
    ...corner(max[along], min.y, min[across]),
    ...corner(max[along], min.y, max[across]),
    ...corner(high, max.y, min[across]),
    ...corner(high, max.y, max[across]),
  ]);
}

const isHandleRow = (row: unknown): row is HandleRow =>
  Array.isArray(row) &&
  (row.length === 2 || row.length === 3) &&
  row.every((n) => typeof n === 'number');

/** `data` checked as RapierStateData, with the world snapshot decoded. */
function stateData(data: unknown): RapierStateData & { readonly bytes: Uint8Array } {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Partial<RapierStateData>;
  if (
    typeof d.world !== 'string' ||
    !Number.isSafeInteger(d.next) ||
    !Array.isArray(d.colliders) ||
    !d.colliders.every(isHandleRow)
  ) {
    throw new PhysicsStateError('malformed Rapier physics state');
  }
  try {
    return { ...(d as RapierStateData), bytes: decodeBase64(d.world) };
  } catch (error) {
    throw new PhysicsStateError('malformed Rapier physics state', { cause: error });
  }
}

/** The sim's physics port on Rapier's deterministic build. */
export class RapierPhysics implements RigidBodyPort {
  /** `rapier3d-deterministic@<version>`, written into every snapshot. */
  readonly engine: string;
  private world: Rapier.World;
  private readonly worldGravity: Vec3;
  private readonly entries = new Map<ColliderHandle, Entry>();
  /** Rapier collider handle → this port's handle (for query results). */
  private readonly byRapierCollider = new Map<number, ColliderHandle>();
  /** Dynamic bodies (mw-e03.10), a subset of `entries`. */
  private readonly dynamic = new Map<ColliderHandle, BodyEntry>();
  /** Rapier collider handle → Rapier body handle, for colliders on a (kinematic or dynamic) body. */
  private readonly bodyByCollider = new Map<number, number>();
  private readonly events: Rapier.EventQueue;
  private lastImpacts: readonly ContactImpact[] = [];
  private next = 1;

  constructor(
    /** The injected Rapier module (for building query shapes). */
    readonly rapier: RapierModule,
    options: RapierPhysicsOptions = {},
  ) {
    this.engine = `rapier3d-deterministic@${rapier.version()}`;
    const gravity = options.gravity ?? DEFAULT_GRAVITY;
    this.worldGravity = Object.freeze({ x: gravity.x, y: gravity.y, z: gravity.z });
    this.world = new rapier.World({ ...gravity });
    this.events = new rapier.EventQueue(true);
  }

  add(shape: GreyboxShape): ColliderHandle {
    checkShape(shape);
    const { rapier, world } = this;
    const { min, max } = shape;
    const centre = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const desc =
      shape.kind === 'box'
        ? rapier.ColliderDesc.cuboid((max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2)
        : new rapier.ColliderDesc(new rapier.ConvexPolyhedron(wedgeCorners(shape, centre)));
    let body: Rapier.RigidBody | undefined;
    if (shape.velocity === undefined) {
      desc.setTranslation(centre.x, centre.y, centre.z);
    } else {
      const { x, y, z } = shape.velocity;
      body = world.createRigidBody(
        rapier.RigidBodyDesc.kinematicVelocityBased()
          .setTranslation(centre.x, centre.y, centre.z)
          .setLinvel(x, y, z),
      );
    }
    const collider = world.createCollider(desc, body);
    const handle = this.next++ as ColliderHandle;
    this.track(handle, collider.handle, body?.handle, false);
    return handle;
  }

  remove(handle: ColliderHandle): void {
    const entry = this.entries.get(handle);
    if (entry === undefined) throw new Error(`collider ${String(handle)} is not in this sink`);
    const { world } = this;
    world.removeCollider(world.getCollider(entry.collider), false);
    if (entry.body !== undefined) world.removeRigidBody(world.getRigidBody(entry.body));
    this.entries.delete(handle);
    this.dynamic.delete(handle);
    this.byRapierCollider.delete(entry.collider);
    this.bodyByCollider.delete(entry.collider);
  }

  has(handle: ColliderHandle): boolean {
    return this.entries.has(handle);
  }

  /** Records one of this port's colliders in the handle tables. */
  private track(
    handle: ColliderHandle,
    collider: number,
    body: number | undefined,
    dynamic: boolean,
  ): void {
    this.entries.set(handle, { collider, body });
    this.byRapierCollider.set(collider, handle);
    if (body === undefined) return;
    this.bodyByCollider.set(collider, body);
    if (dynamic) this.dynamic.set(handle, { collider, body });
  }

  addBody(desc: BodyDesc): ColliderHandle {
    checkBodyDesc(desc);
    const { rapier, world } = this;
    const { position, rotation, velocity = ZERO } = desc;
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z);
    if (rotation !== undefined) bodyDesc.setRotation(quat(rotation));
    const body = world.createRigidBody(bodyDesc);
    const collider = world.createCollider(
      colliderFor(rapier, desc.shape)
        .setMass(desc.mass)
        .setFriction(desc.friction)
        .setRestitution(desc.restitution)
        .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const handle = this.next++ as ColliderHandle;
    this.track(handle, collider.handle, body.handle, true);
    return handle;
  }

  setMass(handle: ColliderHandle, mass: number): void {
    if (!(Number.isFinite(mass) && mass > 0)) throw new RangeError('body mass must be positive');
    const collider = this.world.getCollider(this.bodyEntry(handle).collider);
    collider.setMass(mass);
  }

  setMaterial(handle: ColliderHandle, material: BodyMaterial): void {
    const entry = this.entries.get(handle);
    if (entry === undefined) throw new RangeError(`collider ${String(handle)} is not in this port`);
    const collider = this.world.getCollider(entry.collider);
    collider.setFriction(material.friction);
    collider.setRestitution(material.restitution);
  }

  applyImpulse(handle: ColliderHandle, impulse: Vec3): void {
    this.bodyOf(handle).applyImpulse(vec(impulse), true);
  }

  poseOf(handle: ColliderHandle): BodyPose {
    const body = this.bodyOf(handle);
    return {
      position: vec(body.translation()),
      rotation: quat(body.rotation()),
      sleeping: body.isSleeping(),
    };
  }

  isSleeping(handle: ColliderHandle): boolean {
    return this.bodyOf(handle).isSleeping();
  }

  motionOf(handle: ColliderHandle): BodyMotion {
    const body = this.bodyOf(handle);
    return {
      position: vec(body.translation()),
      rotation: quat(body.rotation()),
      linvel: vec(body.linvel()),
      angvel: vec(body.angvel()),
      sleeping: body.isSleeping(),
      mass: body.mass(),
    };
  }

  sleep(handle: ColliderHandle): void {
    this.bodyOf(handle).sleep();
  }

  gravity(): Vec3 {
    return this.worldGravity;
  }

  moveBody(handle: ColliderHandle, position: Vec3, rotation?: Quat): void {
    if (!(
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
    )) {
      throw new RangeError('body position must be finite');
    }
    if (
      rotation !== undefined &&
      ![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)
    ) {
      throw new RangeError('body rotation must be finite');
    }
    const body = this.bodyOf(handle);
    body.setTranslation(vec(position), true);
    if (rotation !== undefined) body.setRotation(quat(rotation), true);
    body.setLinvel(vec(ZERO), true);
    body.setAngvel(vec(ZERO), true);
  }

  impacts(): readonly ContactImpact[] {
    return this.lastImpacts;
  }

  /** A dynamic body's entry; a RangeError for any other handle. */
  private bodyEntry(handle: ColliderHandle): BodyEntry {
    const entry = this.dynamic.get(handle);
    if (entry === undefined) throw new RangeError(`collider ${String(handle)} is not a body`);
    return entry;
  }

  private bodyOf(handle: ColliderHandle): Rapier.RigidBody {
    return this.world.getRigidBody(this.bodyEntry(handle).body);
  }

  /** Linear velocity just before a step of every awake body, by Rapier body handle. */
  private velocitiesBefore(): Map<number, Vec3> {
    const before = new Map<number, Vec3>();
    // linvel() hands back a fresh vector, so it is stored as is (no copy).
    this.world.forEachActiveRigidBody((body) => {
      before.set(body.handle, body.linvel());
    });
    return before;
  }

  /**
   * A collider's velocity before the step and mass: a fixed collider stands still and a kinematic one
   * cannot be pushed (both infinitely heavy); a body asleep before the step stood still.
   */
  private beforeOf(before: Map<number, Vec3>, rapierCollider: number): Before {
    const body = this.bodyByCollider.get(rapierCollider);
    if (body === undefined) return { velocity: ZERO, mass: Infinity };
    const rigid = this.world.getRigidBody(body);
    return {
      velocity: before.get(body) ?? ZERO,
      mass: rigid.isDynamic() ? rigid.mass() : Infinity,
    };
  }

  /** The contacts that started during the step just taken (see bodies.ts). */
  private collectImpacts(before: Map<number, Vec3>): ContactImpact[] {
    const impacts: ContactImpact[] = [];
    const { world } = this;
    this.events.drainCollisionEvents((c1, c2, started) => {
      if (!started) return;
      let normal: Vec3 = ZERO;
      world.contactPair(world.getCollider(c1), world.getCollider(c2), (manifold, flipped) => {
        const n = manifold.normal();
        const sign = 1 - 2 * Number(flipped); // a flipped manifold's normal points from c2 to c1
        normal = { x: sign * n.x, y: sign * n.y, z: sign * n.z };
      });
      const a = this.beforeOf(before, c1);
      const b = this.beforeOf(before, c2);
      const speed =
        (a.velocity.x - b.velocity.x) * normal.x +
        (a.velocity.y - b.velocity.y) * normal.y +
        (a.velocity.z - b.velocity.z) * normal.z;
      // Reduced mass; a fixed or kinematic side (Infinity) leaves the body's own mass. At least one
      // side is dynamic (only bodies report events), so it is finite.
      const reduced = 1 / (1 / a.mass + 1 / b.mass);
      const closing = Math.max(0, speed);
      impacts.push({
        a: this.handleOf(c1),
        b: this.handleOf(c2),
        normal,
        speed,
        energy: 0.5 * reduced * closing * closing,
        impulse: reduced * closing,
      });
    });
    return impacts;
  }

  /** Colliders in the Rapier world (not just in this port's table). */
  count(): number {
    return this.world.colliders.len();
  }

  step(dt: number): void {
    const before = this.velocitiesBefore();
    this.world.timestep = dt;
    this.world.step(this.events);
    this.lastImpacts = this.collectImpacts(before);
  }

  snapshot(): PhysicsState {
    const data: RapierStateData = {
      world: encodeBase64(this.world.takeSnapshot()),
      next: this.next,
      colliders: [...this.entries].map(([handle, { collider, body }]) =>
        body === undefined ? [handle, collider] : [handle, collider, body],
      ),
    };
    return { engine: this.engine, data };
  }

  restore(state: PhysicsState): void {
    if (state.engine !== this.engine) {
      throw new PhysicsStateError(
        `physics state from ${state.engine} cannot be restored into ${this.engine}`,
      );
    }
    const data = stateData(state.data);
    // restoreSnapshot is typed as always returning a World, but gives null for bytes it cannot read.
    const world = this.rapier.World.restoreSnapshot(data.bytes) as Rapier.World | null;
    if (world === null) throw new PhysicsStateError('Rapier could not read the physics state');
    const missing = data.colliders.find(
      ([, collider, body]) =>
        !world.colliders.contains(collider) || (body !== undefined && !world.bodies.contains(body)),
    );
    if (missing !== undefined) {
      world.free();
      throw new PhysicsStateError(`physics state has no collider for handle ${String(missing[0])}`);
    }
    this.world.free();
    this.world = world;
    this.next = data.next;
    this.entries.clear();
    this.dynamic.clear();
    this.byRapierCollider.clear();
    this.bodyByCollider.clear();
    this.events.clear();
    this.lastImpacts = [];
    for (const [handle, collider, body] of data.colliders) {
      const dynamic = body !== undefined && world.getRigidBody(body).isDynamic();
      this.track(handle as ColliderHandle, collider, body, dynamic);
    }
  }

  /**
   * The Rapier world behind this port, for Rapier-specific queries (rapier-collision-world.ts).
   * `restore` replaces it, so read it afresh for every query rather than keeping it.
   */
  get rapierWorld(): Rapier.World {
    return this.world;
  }

  /**
   * This port's handle for one of its colliders, by Rapier's collider handle.
   * @throws RangeError for a collider this port did not add.
   */
  handleOf(rapierCollider: number): ColliderHandle {
    const handle = this.byRapierCollider.get(rapierCollider);
    if (handle === undefined) {
      throw new RangeError(`Rapier collider ${String(rapierCollider)} was not added by this port`);
    }
    return handle;
  }

  /** Rapier's handle for one of this port's colliders, or undefined for one it does not have. */
  rapierHandleOf(handle: ColliderHandle): number | undefined {
    return this.entries.get(handle)?.collider;
  }

  /** Linear velocity of a collider, m/s: zero for a fixed one or a handle this port does not have. */
  velocityOf(handle: ColliderHandle): Vec3 {
    const body = this.entries.get(handle)?.body;
    if (body === undefined) return { x: 0, y: 0, z: 0 };
    const { x, y, z } = this.world.getRigidBody(body).linvel();
    return { x, y, z };
  }

  /** Releases the Rapier world's WASM memory; the port is unusable afterwards. */
  dispose(): void {
    this.world.free();
    this.events.free();
  }
}

/** A collider description (without position) for a body shape. */
function colliderFor(rapier: RapierModule, shape: BodyShape): Rapier.ColliderDesc {
  switch (shape.kind) {
    case 'box': {
      const { x, y, z } = shape.halfExtents;
      return rapier.ColliderDesc.cuboid(x, y, z);
    }
    case 'sphere':
      return rapier.ColliderDesc.ball(shape.radius);
    case 'capsule':
      return rapier.ColliderDesc.capsule(shape.halfHeight, shape.radius);
  }
}
