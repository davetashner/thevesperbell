// Hit volumes in the sim (mw-e04.2): region-tagged hurtboxes an entity is struck through, and the
// swept hitboxes a swing strikes with. Both live in the sim, independent of the renderer; the render
// animation follows sim poses, never the other way round. Plain frozen data, replaced never mutated,
// so snapshots, saves and replays carry them mid-swing.
//
// Frames. An entity's frame is its placement (origin) turned to face a unit horizontal direction
// (+z forward, +y up, +x right, like move data). Shapes hang off sockets: a socket is a pose in that
// frame ("root" is the frame itself), and a shape is authored in its socket's frame, so animating a
// socket (a later animation bead updates socket poses) moves every shape attached to it.
//
// Hurtboxes carry a region (weakpoint > head > torso > limb: when one hit crosses several, the first
// in that order wins, then the larger multiplier, then the earlier hurtbox), an armored flag (e05.6
// deflects off it) and the damage multiplier the damage model's region stage applies.
//
// Hitboxes are driven by a socket track: the socket's pose before the first active tick (key 0) and
// on each active tick k (key k; a track shorter than the window holds its last key). Each active tick
// the hitbox is swept from where it was to where it is now, so a fast arc cannot skip a thin target.
// A hitbox strikes each target at most once per active window. It commits to the attacker's aim when
// opened and follows the attacker's placement.

import type { EntityId } from '../../core/component';
import { defineComponent } from '../../core/component';
import type { World } from '../../core/world';
import { IDENTITY_POSE, type GeomShape, type LocalShape, type Pose } from '../../geom';
import type { Vec3 } from '../../stimulus/shapes';
import { horizontalAim } from '../attacks/frame';

/** Hurtbox regions, highest priority first. */
export const HIT_REGIONS = ['weakpoint', 'head', 'torso', 'limb'] as const;

/** A hurtbox region. */
export type HitRegion = (typeof HIT_REGIONS)[number];

/** The socket every entity has: its frame itself. */
export const ROOT_SOCKET = 'root';

/** The region and multiplier a disabled weakpoint resolves against. */
export interface UnderlyingRegion {
  readonly region: Exclude<HitRegion, 'weakpoint'>;
  readonly multiplier: number;
}

/** One region-tagged hurtbox. */
export interface Hurtbox {
  /** Unique among the entity's hurtboxes, e.g. "head". */
  readonly id: string;
  /** Socket the shape hangs off (ROOT_SOCKET or a key of the set's sockets). */
  readonly socket: string;
  readonly region: HitRegion;
  /** Armored hurtboxes can deflect weak hits (e05.6); carried on every hit. */
  readonly armored: boolean;
  /**
   * Armour value of an armored hurtbox (e05.6): an arrow with less penetration ricochets off it.
   * Absent or 0 = it never deflects.
   */
  readonly armor?: number;
  /**
   * Weakpoints only (e05.6): the creature states (see `setRegionState`) in which it is enabled.
   * Absent = always enabled. Outside them a hit resolves against `underlying` instead.
   */
  readonly enabledIn?: readonly string[];
  /** What a disabled weakpoint resolves as (default: torso ×1). */
  readonly underlying?: UnderlyingRegion;
  /** Damage multiplier of the region (≥ 0), passed to the damage model as regionMultiplier. */
  readonly multiplier: number;
  /** Shape in the socket's frame. */
  readonly shape: LocalShape;
}

/** An entity's hurtboxes. */
export interface HurtboxSet {
  /** Unit horizontal facing of the entity's frame. */
  readonly facing: Vec3;
  /** Socket id → pose in the entity's frame (ROOT_SOCKET is implicit). */
  readonly sockets: Readonly<Record<string, Pose>>;
  readonly boxes: readonly Hurtbox[];
}

/** A socket's poses over an active window (see the file header). */
export interface SocketTrack {
  readonly id: string;
  /** Key 0: before the first active tick; key k: active tick k. At least one key. */
  readonly keys: readonly Pose[];
}

/** What `openHitbox` needs. */
export interface HitboxSpec {
  /** Unique among the attacker's open hitboxes, e.g. "sword-light-1". */
  readonly id: string;
  /** Hit volume in the track socket's frame. */
  readonly shape: LocalShape;
  readonly track: SocketTrack;
  /** Active ticks (≥ 1): the hitbox sweeps once per tick for this many ticks. */
  readonly activeTicks: number;
  /** Direction the attacker commits to (its horizontal part is used). */
  readonly aim: Vec3;
  /** Whether the attacker's allies are struck too (the move's hitbox.friendlyFire). */
  readonly friendlyFire: boolean;
}

/** An open hitbox. */
export interface LiveHitbox {
  readonly id: string;
  readonly shape: LocalShape;
  readonly track: SocketTrack;
  readonly activeTicks: number;
  /** Unit horizontal aim committed when opened. */
  readonly aim: Vec3;
  readonly friendlyFire: boolean;
  /** Active ticks swept so far; the hitbox is spent (no more sweeps) at activeTicks. */
  readonly elapsed: number;
  /** World shape the latest sweep started from, null before the first sweep. */
  readonly sweptFrom: GeomShape | null;
  /** World shape the latest sweep ended at, null before the first sweep. */
  readonly pose: GeomShape | null;
  /** Entities struck (or that dodged it, mw-e04.8) so far in this window, ascending. */
  readonly hit: readonly EntityId[];
}

/** An attacker's open hitboxes, in the order they were opened. */
export interface HitboxSet {
  readonly live: readonly LiveHitbox[];
}

/** The hurtbox component (`combat.hurtboxes`; a snapshot and save key, never renamed). */
export const HurtboxComponent = defineComponent<HurtboxSet>('combat.hurtboxes');

/** State that decides a creature's regions (e05.6). */
export interface RegionState {
  /** Whether the entity is a humanoid: an unaware one staggers from a head hit. */
  readonly humanoid: boolean;
  /** Creature state weakpoints are enabled by (e.g. "roaring"); "default" until set. */
  readonly state: string;
}

/** The region-state component (`combat.region-state`; a snapshot and save key, never renamed). */
export const RegionStateComponent = defineComponent<RegionState>('combat.region-state');

/** The hitbox component (`combat.hitboxes`; a snapshot and save key, never renamed). */
export const HitboxComponent = defineComponent<HitboxSet>('combat.hitboxes');

/** Every hit-volume component, for `world.register(...HIT_VOLUME_COMPONENTS)`. */
export const HIT_VOLUME_COMPONENTS = Object.freeze([
  HurtboxComponent,
  HitboxComponent,
  RegionStateComponent,
] as const);

const FORWARD: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });
const NO_HITBOXES: HitboxSet = Object.freeze({ live: Object.freeze([]) });

function checkFinite(what: string, values: readonly number[]): void {
  if (!values.every(Number.isFinite)) throw new RangeError(`${what} must be finite`);
}

function checkPose(what: string, pose: Pose): void {
  const { position: p, rotation: q } = pose;
  checkFinite(what, [p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
}

function checkShape(what: string, shape: LocalShape): void {
  switch (shape.kind) {
    case 'sphere':
      checkFinite(what, [shape.center.x, shape.center.y, shape.center.z, shape.radius]);
      if (shape.radius <= 0) throw new RangeError(`${what} radius must be > 0`);
      return;
    case 'capsule': {
      const { from: a, to: b } = shape;
      checkFinite(what, [a.x, a.y, a.z, b.x, b.y, b.z, shape.radius]);
      if (shape.radius <= 0) throw new RangeError(`${what} radius must be > 0`);
      return;
    }
    case 'box': {
      const { center: c, halfExtents: h } = shape;
      checkFinite(what, [c.x, c.y, c.z, h.x, h.y, h.z]);
      if (h.x <= 0 || h.y <= 0 || h.z <= 0) {
        throw new RangeError(`${what} half extents must be > 0`);
      }
      return;
    }
  }
}

/** What `giveHurtboxes` takes; facing defaults to +z and sockets to none but the root. */
export interface HurtboxSpec {
  readonly boxes: readonly Hurtbox[];
  readonly facing?: Vec3;
  readonly sockets?: Readonly<Record<string, Pose>>;
}

/**
 * A validated, frozen hurtbox set. Throws a RangeError for an empty or duplicate id, an unknown
 * socket or region, a negative or non-finite multiplier, a bad shape or pose, or a facing without a
 * horizontal direction.
 */
export function hurtboxSet(spec: HurtboxSpec): HurtboxSet {
  const sockets = { ...(spec.sockets ?? {}) };
  for (const [id, pose] of Object.entries(sockets)) {
    if (id === ROOT_SOCKET) throw new RangeError(`socket "${id}" is implicit and cannot be set`);
    checkPose(`socket "${id}"`, pose);
  }
  const seen = new Set<string>();
  for (const box of spec.boxes) {
    const what = `hurtbox "${box.id}"`;
    if (box.id === '' || seen.has(box.id)) throw new RangeError(`${what}: id must be unique`);
    seen.add(box.id);
    if (box.socket !== ROOT_SOCKET && !(box.socket in sockets)) {
      throw new RangeError(`${what}: unknown socket "${box.socket}"`);
    }
    if (!(HIT_REGIONS as readonly string[]).includes(box.region)) {
      throw new RangeError(`${what}: unknown region "${box.region}"`);
    }
    if (!Number.isFinite(box.multiplier) || box.multiplier < 0) {
      throw new RangeError(`${what}: multiplier must be a finite number ≥ 0`);
    }
    checkShape(what, box.shape);
    if (box.armor !== undefined && (!Number.isFinite(box.armor) || box.armor < 0)) {
      throw new RangeError(`${what}: armor must be a finite number ≥ 0`);
    }
    if (box.underlying !== undefined) {
      const { region, multiplier } = box.underlying;
      if (!['head', 'torso', 'limb'].includes(region)) {
        throw new RangeError(`${what}: underlying region must be head, torso or limb`);
      }
      if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new RangeError(`${what}: underlying multiplier must be a finite number ≥ 0`);
      }
    }
  }
  return Object.freeze({
    facing: horizontalAim(spec.facing ?? FORWARD),
    sockets: Object.freeze(sockets),
    boxes: Object.freeze(spec.boxes.map((box) => Object.freeze({ ...box }))),
  });
}

/** The creature state `entity`'s weakpoints are judged against ("default" when none was set). */
export function regionStateOf(world: World<never>, entity: EntityId): string {
  if (!world.isRegistered(RegionStateComponent)) return 'default';
  return world.get(entity, RegionStateComponent)?.state ?? 'default';
}

/**
 * Sets the creature state `entity`'s weakpoints are enabled by (a roar exposes a core). `humanoid`
 * is kept when already set, else false. Adding the component is structural (see `giveHurtboxes`).
 */
export function setRegionState(world: World<never>, entity: EntityId, state: string): void {
  const current = world.get(entity, RegionStateComponent);
  const next = Object.freeze({ humanoid: current?.humanoid ?? false, state });
  if (current === undefined) world.add(entity, RegionStateComponent, next);
  else world.set(entity, RegionStateComponent, next);
}

/** Marks `entity` a humanoid (e05.6); keeps its region state. */
export function markHumanoid(world: World<never>, entity: EntityId): void {
  const current = world.get(entity, RegionStateComponent);
  const next = Object.freeze({ humanoid: true, state: current?.state ?? 'default' });
  if (current === undefined) world.add(entity, RegionStateComponent, next);
  else world.set(entity, RegionStateComponent, next);
}

/**
 * The hurtbox as a hit resolves against it: a weakpoint outside its `enabledIn` states becomes its
 * underlying region (torso ×1 by default); anything else is itself.
 */
export function effectiveHurtbox(hurtbox: Hurtbox, state: string): Hurtbox {
  if (hurtbox.region !== 'weakpoint' || hurtbox.enabledIn?.includes(state) !== false) {
    return hurtbox;
  }
  const { region, multiplier } = hurtbox.underlying ?? { region: 'torso', multiplier: 1 };
  return Object.freeze({ ...hurtbox, region, multiplier });
}

/**
 * Gives `entity` hurtboxes (validated by `hurtboxSet`). Adding the component is structural, so
 * during a step it exists from the end of the tick; replacing an existing set is immediate.
 */
export function giveHurtboxes(world: World<never>, entity: EntityId, spec: HurtboxSpec): void {
  const set = hurtboxSet(spec);
  if (world.has(entity, HurtboxComponent)) world.set(entity, HurtboxComponent, set);
  else world.add(entity, HurtboxComponent, set);
}

function hurtboxesOf(world: World<never>, entity: EntityId): HurtboxSet {
  const set = world.get(entity, HurtboxComponent);
  if (set === undefined) throw new Error(`entity ${String(entity)} has no hurtboxes`);
  return set;
}

/** Turns `entity`'s hurtbox frame to face `facing` (horizontal part). Throws without hurtboxes. */
export function setHurtboxFacing(world: World<never>, entity: EntityId, facing: Vec3): void {
  const set = hurtboxesOf(world, entity);
  world.set(entity, HurtboxComponent, Object.freeze({ ...set, facing: horizontalAim(facing) }));
}

/**
 * Moves one of `entity`'s sockets (e.g. the animation posing the head). Throws without hurtboxes,
 * for the root or an unknown socket, or for a non-finite pose.
 */
export function setSocketPose(
  world: World<never>,
  entity: EntityId,
  socket: string,
  pose: Pose,
): void {
  const set = hurtboxesOf(world, entity);
  if (!(socket in set.sockets)) throw new RangeError(`unknown socket "${socket}"`);
  checkPose(`socket "${socket}"`, pose);
  const sockets = Object.freeze({ ...set.sockets, [socket]: pose });
  world.set(entity, HurtboxComponent, Object.freeze({ ...set, sockets }));
}

/** A socket's pose in its entity's frame (the root is the identity). */
export function socketPose(set: HurtboxSet, socket: string): Pose {
  return set.sockets[socket] ?? IDENTITY_POSE;
}

/**
 * Lets `entity` open hitboxes, with none open. Adding the component is structural, so give it at
 * setup: then `openHitbox` is a value change that sweeps in the same tick.
 */
export function giveHitboxes(world: World<never>, entity: EntityId): void {
  if (!world.has(entity, HitboxComponent)) world.add(entity, HitboxComponent, NO_HITBOXES);
}

/** `entity`'s open hitboxes (spent ones included until the next sweep), empty when it has none. */
export function liveHitboxes(world: World<never>, entity: EntityId): readonly LiveHitbox[] {
  return world.get(entity, HitboxComponent)?.live ?? NO_HITBOXES.live;
}

/**
 * Opens a hitbox on `attacker` (giving it the component when missing: structural, see
 * `giveHitboxes`). It sweeps on the next run of the hit-volume system — the same tick when that runs
 * after the caller. A spent hitbox with the same id is replaced. Throws a RangeError for an empty id
 * or one still active, an empty track, a bad shape or pose, activeTicks not a positive integer, or
 * an aim without a horizontal direction.
 */
export function openHitbox(world: World<never>, attacker: EntityId, spec: HitboxSpec): void {
  const what = `hitbox "${spec.id}"`;
  const live = liveHitboxes(world, attacker);
  if (spec.id === '') throw new RangeError('hitbox id must not be empty');
  if (live.some((h) => h.id === spec.id && h.elapsed < h.activeTicks)) {
    throw new RangeError(`${what} is already open`);
  }
  if (!Number.isSafeInteger(spec.activeTicks) || spec.activeTicks < 1) {
    throw new RangeError(`${what}: activeTicks must be a positive integer`);
  }
  if (spec.track.keys.length === 0) throw new RangeError(`${what}: track has no keys`);
  spec.track.keys.forEach((key, i) => {
    checkPose(`${what} track key ${String(i)}`, key);
  });
  checkShape(what, spec.shape);
  const hitbox: LiveHitbox = Object.freeze({
    id: spec.id,
    shape: spec.shape,
    track: spec.track,
    activeTicks: spec.activeTicks,
    aim: horizontalAim(spec.aim),
    friendlyFire: spec.friendlyFire,
    elapsed: 0,
    sweptFrom: null,
    pose: null,
    hit: Object.freeze([]),
  });
  const next = Object.freeze({
    live: Object.freeze([...live.filter((h) => h.id !== spec.id), hitbox]),
  });
  if (world.has(attacker, HitboxComponent)) world.set(attacker, HitboxComponent, next);
  else world.add(attacker, HitboxComponent, next);
}

/**
 * Closes `attacker`'s hitbox `id` (or every hitbox when `id` is omitted) before its window ends: no
 * further sweeps or hits. Returns how many were closed.
 */
export function closeHitboxes(world: World<never>, attacker: EntityId, id?: string): number {
  const set = world.get(attacker, HitboxComponent);
  if (set === undefined) return 0;
  const kept = set.live.filter((h) => id !== undefined && h.id !== id);
  const closed = set.live.length - kept.length;
  if (closed > 0)
    world.set(attacker, HitboxComponent, Object.freeze({ live: Object.freeze(kept) }));
  return closed;
}
