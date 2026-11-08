// Remote holds (mw-e03.12): the one world-side way to hold, levitate and fling a liftable object from
// a distance. Mage Hand, Telekinesis, Gravity Well and "catch the arrow" are all callers of this API;
// nothing here names a spell, and the target is reached through properties only (`liftable`, `weight`,
// `remoteActuatable`), never by what it is.
//
// - A hold (`holdRemotely`) attaches a critically damped spring to a physics object: every tick the
//   body's velocity is changed towards the target point (acceleration ω²·error − 2ω·velocity, speed
//   capped at HOLD_MAX_SPEED), and gravity is cancelled, so the object tracks the point and settles on
//   it in well under half a second. Move the point with `setHoldPoint`.
// - Strength against weight: a holder of strength S (kg it can hold) holds a liftable body up to S.
//   Heavier is refused with reason `overweight` (and `ForceResisted`), and a hold whose body becomes
//   heavier than the strength breaks as `overload`.
// - A hold breaks as `obstructed` when the body has not moved HOLD_STALL_DISTANCE for HOLD_STALL_SECONDS
//   while still further than HOLD_REACHED from its point (it is jammed against geometry), when either
//   party is gone (`lost`), or when the world saves (`saved`, see `settleRemoteHolds`).
// - `releaseHold` lets go, optionally with a velocity (a fling): the body leaves at exactly that velocity.
// - Gravity-scale zones (`addGravityZone`: scale 0 floats, 0.2 drifts, 2 doubles) and point attractors
//   (`addAttractor`, a Gravity Well: acceleration S / mass towards the point inside a radius) act on
//   every loose liftable physics object; non-liftable ones are unaffected. Both may expire.
// - `actuateRemotely` operates a lever, switch or door from range through the Interact verb's own door
//   (`interactRemotely`), only when it is flagged `remoteActuatable`.
//
// All state is one ledger entity (`magic.remoteHolds`), so a snapshot, a state hash and a replay carry it.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import { defineEvent } from '../core/events';
import type { System, World } from '../core/world';
import { interactRemotely, type Interaction } from '../interaction';
import { hypot } from '../math';
import { DEFAULT_GRAVITY } from '../physics/rapier';
import {
  MIN_BODY_MASS,
  PhysicsObjectComponent,
  rigidBodiesOf,
  setPhysicsObjectVelocity,
} from '../physics/objects';
import type { ColliderHandle } from '../physics/static-colliders';
import { readProperty } from '../properties/components';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { ForceResisted } from './tether';

/** The spring's natural frequency, rad/s: a critically damped approach settles in about 0.3 s. */
export const HOLD_OMEGA = 20;
/** The fastest a held body is steered, m/s. */
export const HOLD_MAX_SPEED = 12;
/** Within this distance of its point a held body counts as arrived (never obstructed), metres. */
export const HOLD_REACHED = 0.5;
/** A held body that moves less than this over HOLD_STALL_SECONDS is stalled, metres. */
export const HOLD_STALL_DISTANCE = 0.1;
/** Seconds stalled short of the point before an obstructed hold breaks. */
export const HOLD_STALL_SECONDS = 1;

const GRAVITY = -DEFAULT_GRAVITY.y;

/** One remote hold (a row of `magic.remoteHolds`). */
export interface RemoteHold {
  readonly holder: EntityId;
  readonly target: EntityId;
  /** Where the body is steered to, metres. */
  readonly point: Vec3;
  /** The most weight the holder holds, kg. */
  readonly strength: number;
  /** Where the body was when it last moved HOLD_STALL_DISTANCE, and the tick that was. */
  readonly anchor: Vec3;
  readonly anchorTick: number;
}

/** A box where gravity is scaled for loose liftable objects. */
export interface GravityZone {
  readonly id: number;
  readonly min: Vec3;
  readonly max: Vec3;
  /** 1 = normal gravity, 0 = none, negative = rises. */
  readonly scale: number;
  /** First tick it is over, or null when it stays. */
  readonly expiresTick: number | null;
}

/** A point that draws loose liftable objects within `radius` with acceleration `strength` / mass. */
export interface Attractor {
  readonly id: number;
  readonly point: Vec3;
  readonly radius: number;
  /** Force, N. */
  readonly strength: number;
  readonly expiresTick: number | null;
}

/** Everything the remote-hold rules keep (`magic.remoteHolds`; a snapshot key, never renamed). */
export interface RemoteHoldLedger {
  readonly holds: readonly RemoteHold[];
  readonly zones: readonly GravityZone[];
  readonly attractors: readonly Attractor[];
  readonly nextId: number;
}
export const RemoteHoldLedgerComponent = defineComponent<RemoteHoldLedger>('magic.remoteHolds');

export type RemoteHoldReleaseReason =
  'released' | 'replaced' | 'obstructed' | 'overload' | 'lost' | 'saved';

export interface RemoteHoldReleasedInfo {
  readonly tick: number;
  readonly holder: EntityId;
  readonly target: EntityId;
  readonly reason: RemoteHoldReleaseReason;
}
export const RemoteHoldReleased = defineEvent<RemoteHoldReleasedInfo>('RemoteHoldReleased');

/** Why a hold was refused. */
export type RemoteHoldRefusal = 'overweight' | 'not-liftable' | 'no-body';

export type RemoteHoldResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: RemoteHoldRefusal };

const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const lengthOf = (a: Vec3): number => hypot(a.x, a.y, a.z);
const frozen = (a: Vec3): Vec3 => Object.freeze({ x: a.x, y: a.y, z: a.z });
const massOf = (world: World<never>, entity: EntityId): number =>
  Math.max(MIN_BODY_MASS, readProperty(world, entity, 'weight'));

type LedgerEntry = readonly [EntityId, RemoteHoldLedger];

/** The ledger of a world that has `installRemoteHold` (it makes the entity, which is never destroyed). */
function entryOf(world: World<never>): LedgerEntry {
  let found: LedgerEntry | undefined;
  world.query(RemoteHoldLedgerComponent).forEach((id, ledger) => {
    found = [id, ledger];
  });
  // the ledger entity is made by installRemoteHold and never destroyed
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return found!;
}

/** The ledger, or undefined where remote holds are not installed. */
function requireLedger(world: World<never>): LedgerEntry {
  const entry = ledgerOf(world);
  if (entry === undefined) throw new Error('install remote holds first');
  return entry;
}

const ledgerOf = (world: World<never>): LedgerEntry | undefined =>
  world.isRegistered(RemoteHoldLedgerComponent) ? entryOf(world) : undefined;

/** Rewrites the ledger from its current value. */
function update(
  world: World<never>,
  change: (ledger: RemoteHoldLedger) => Partial<RemoteHoldLedger>,
): void {
  const [id, ledger] = entryOf(world);
  world.set(id, RemoteHoldLedgerComponent, Object.freeze({ ...ledger, ...change(ledger) }));
}

/**
 * Whether a holder of `strength` kg could hold `target` now: `ok`, or the reason it could not
 * (`no-body` without a physics object, `not-liftable` without `liftable`, `overweight` above strength).
 */
export function canHoldRemotely(
  world: World<never>,
  target: EntityId,
  strength: number,
): RemoteHoldResult {
  if (!world.has(target, PhysicsObjectComponent)) return { ok: false, reason: 'no-body' };
  if (!readProperty(world, target, 'liftable')) return { ok: false, reason: 'not-liftable' };
  if (readProperty(world, target, 'weight') > strength) return { ok: false, reason: 'overweight' };
  return { ok: true };
}

/**
 * Holds `target` for `holder` at `point` with `strength` kg of grip (see the header). Replaces any
 * hold on the same target. A refused hold changes nothing; an overweight one fires `ForceResisted`.
 * Needs `installRemoteHold`.
 */
export function holdRemotely(
  world: World<never>,
  holder: EntityId,
  target: EntityId,
  point: Vec3,
  strength: number,
): RemoteHoldResult {
  const entry = requireLedger(world);
  const result = canHoldRemotely(world, target, strength);
  if (!result.ok) {
    if (result.reason === 'overweight') {
      world.events.emit(ForceResisted, {
        tick: world.tick,
        caster: holder,
        spell: null,
        target,
        weight: readProperty(world, target, 'weight'),
        limit: strength,
      });
    }
    return result;
  }
  const previous = entry[1].holds.find((h) => h.target === target);
  if (previous !== undefined) emitReleased(world, previous, 'replaced');
  const hold: RemoteHold = {
    holder,
    target,
    point: frozen(point),
    strength,
    anchor: frozen(positionOf(world, target)),
    anchorTick: world.tick,
  };
  update(world, ({ holds }) => ({
    holds: Object.freeze([...holds.filter((h) => h.target !== target), hold]),
  }));
  return result;
}

/** The centre of physics object `entity` (its pose, kept current by the physics-object system). */
function positionOf(world: World<never>, entity: EntityId): Vec3 {
  // canHoldRemotely has checked the body
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return world.get(entity, PhysicsObjectComponent)!.position;
}

/** Moves the point `target`'s hold steers to; false when `target` is not held. */
export function setHoldPoint(world: World<never>, target: EntityId, point: Vec3): boolean {
  const hold = holdOnTarget(world, target);
  if (hold === undefined) return false;
  const next = { ...hold, point: frozen(point) };
  update(world, ({ holds }) => ({
    holds: Object.freeze(holds.map((h) => (h === hold ? next : h))),
  }));
  return true;
}

function emitReleased(
  world: World<never>,
  hold: RemoteHold,
  reason: RemoteHoldReleaseReason,
): void {
  world.events.emit(RemoteHoldReleased, {
    tick: world.tick,
    holder: hold.holder,
    target: hold.target,
    reason,
  });
}

function drop(
  world: World<never>,
  hold: RemoteHold,
  reason: RemoteHoldReleaseReason,
  velocity?: Vec3,
): void {
  update(world, ({ holds }) => ({ holds: Object.freeze(holds.filter((h) => h !== hold)) }));
  if (velocity !== undefined && world.has(hold.target, PhysicsObjectComponent)) {
    setPhysicsObjectVelocity(world, hold.target, velocity);
  }
  emitReleased(world, hold, reason);
}

/**
 * Lets go of `target`. With `velocity` (m/s) the body leaves at exactly that velocity (a fling);
 * without, it keeps the velocity it has and gravity takes it. False when `target` was not held.
 */
export function releaseHold(world: World<never>, target: EntityId, velocity?: Vec3): boolean {
  const hold = holdOnTarget(world, target);
  if (hold === undefined) return false;
  drop(world, hold, 'released', velocity);
  return true;
}

/** The hold on `target`, or undefined. */
export function holdOnTarget(world: World<never>, target: EntityId): RemoteHold | undefined {
  return ledgerOf(world)?.[1].holds.find((h) => h.target === target);
}

/** Every remote hold, oldest first. */
export function remoteHolds(world: World<never>): readonly RemoteHold[] {
  return ledgerOf(world)?.[1].holds ?? [];
}

/**
 * Lets go of every remote hold where it is, as a save does before it is written (a save never stores
 * a hold: the object is a placed world object). Does nothing where remote holds are not installed.
 */
export function settleRemoteHolds(world: World<never>): void {
  for (const hold of remoteHolds(world)) drop(world, hold, 'saved');
}

/** Adds a gravity-scale zone for `seconds` (forever when omitted); returns its id. */
export function addGravityZone(
  world: World<never>,
  zone: {
    readonly min: Vec3;
    readonly max: Vec3;
    readonly scale: number;
    readonly seconds?: number;
  },
): number {
  const [, { nextId }] = requireLedger(world);
  const added: GravityZone = {
    id: nextId,
    min: frozen(zone.min),
    max: frozen(zone.max),
    scale: zone.scale,
    expiresTick: expiry(world, zone.seconds),
  };
  update(world, ({ zones }) => ({ zones: Object.freeze([...zones, added]), nextId: nextId + 1 }));
  return nextId;
}

/** Adds a point attractor for `seconds` (forever when omitted); returns its id. */
export function addAttractor(
  world: World<never>,
  attractor: {
    readonly point: Vec3;
    readonly radius: number;
    readonly strength: number;
    readonly seconds?: number;
  },
): number {
  const [, { nextId }] = requireLedger(world);
  const added: Attractor = {
    id: nextId,
    point: frozen(attractor.point),
    radius: attractor.radius,
    strength: attractor.strength,
    expiresTick: expiry(world, attractor.seconds),
  };
  update(world, ({ attractors }) => ({
    attractors: Object.freeze([...attractors, added]),
    nextId: nextId + 1,
  }));
  return nextId;
}

/** Removes a zone or attractor by id; false when there is none. */
export function removeField(world: World<never>, id: number): boolean {
  const entry = ledgerOf(world);
  if (entry === undefined) return false;
  const { zones, attractors } = entry[1];
  if (!zones.some((z) => z.id === id) && !attractors.some((a) => a.id === id)) return false;
  update(world, () => ({
    zones: Object.freeze(zones.filter((z) => z.id !== id)),
    attractors: Object.freeze(attractors.filter((a) => a.id !== id)),
  }));
  return true;
}

const expiry = (world: World<never>, seconds: number | undefined): number | null =>
  seconds === undefined ? null : world.tick + Math.max(1, Math.round(seconds * world.clock.hz));

/** Why a remote actuation did nothing. */
export type ActuationRefusal = 'not-actuatable' | 'out-of-range' | 'unusable';

export type ActuationResult =
  | { readonly ok: true; readonly interaction: Interaction }
  | { readonly ok: false; readonly reason: ActuationRefusal };

/**
 * Operates `target` (a lever, switch or door) for `holder` from up to `range` metres (to its surface),
 * exactly as if the holder interacted with it: through `interactRemotely`. Only a `remoteActuatable`
 * target answers; anything else, or anything out of range or without a usable affordance, is refused
 * and nothing is dispatched.
 */
export function actuateRemotely(
  world: World<never>,
  holder: EntityId,
  target: EntityId,
  range: number,
): ActuationResult {
  if (!readProperty(world, target, 'remoteActuatable')) {
    return { ok: false, reason: 'not-actuatable' };
  }
  const from = placementOf(world, holder);
  const at = placementOf(world, target);
  if (from === undefined || at === undefined || lengthOf(minus(from, at)) - at.radius > range) {
    return { ok: false, reason: 'out-of-range' };
  }
  const interaction = interactRemotely(world, holder, target);
  return interaction === undefined ? { ok: false, reason: 'unusable' } : { ok: true, interaction };
}

/** One tick of one hold: lose, overload, jam check, then steer. */
function steer(world: World<never>, hold: RemoteHold, tick: number, dt: number): void {
  const { target } = hold;
  const object = world.get(target, PhysicsObjectComponent);
  if (!world.isAlive(hold.holder) || !world.isAlive(target) || object === undefined) {
    drop(world, hold, 'lost');
    return;
  }
  if (readProperty(world, target, 'weight') > hold.strength) {
    drop(world, hold, 'overload');
    return;
  }
  const at = object.position;
  const toPoint = minus(hold.point, at);
  // Jammed: short of the point and not moving for HOLD_STALL_SECONDS.
  const moved = lengthOf(minus(at, hold.anchor)) >= HOLD_STALL_DISTANCE;
  if (moved || lengthOf(toPoint) <= HOLD_REACHED) {
    const next = { ...hold, anchor: frozen(at), anchorTick: tick };
    update(world, ({ holds }) => ({
      holds: Object.freeze(holds.map((h) => (h === hold ? next : h))),
    }));
  } else if (tick - hold.anchorTick > HOLD_STALL_SECONDS * world.clock.hz) {
    drop(world, hold, 'obstructed');
    return;
  }
  const { linvel } = rigidBodiesOf(world).motionOf(object.body as ColliderHandle);
  const k = HOLD_OMEGA;
  // Spring-damper acceleration plus the lift that cancels the gravity this tick's step just applied.
  const wanted = {
    x: linvel.x + (k * k * toPoint.x - 2 * k * linvel.x) * dt,
    y: linvel.y + (k * k * toPoint.y - 2 * k * linvel.y + GRAVITY) * dt,
    z: linvel.z + (k * k * toPoint.z - 2 * k * linvel.z) * dt,
  };
  const speed = lengthOf(wanted);
  const scale = speed > HOLD_MAX_SPEED ? HOLD_MAX_SPEED / speed : 1;
  setPhysicsObjectVelocity(world, target, {
    x: wanted.x * scale,
    y: wanted.y * scale,
    z: wanted.z * scale,
  });
}

/** Pushes loose liftable bodies: zones scale gravity, attractors pull. */
function applyFields(
  world: World<never>,
  ledger: RemoteHoldLedger,
  held: ReadonlySet<EntityId>,
  dt: number,
): void {
  if (ledger.zones.length === 0 && ledger.attractors.length === 0) return;
  const port = rigidBodiesOf(world);
  world.query(PhysicsObjectComponent).forEach((entity, object) => {
    if (held.has(entity) || !readProperty(world, entity, 'liftable')) return;
    const at = object.position;
    const mass = massOf(world, entity);
    let dvx = 0;
    let dvy = 0;
    let dvz = 0;
    for (const zone of ledger.zones) {
      const inside =
        at.x >= zone.min.x &&
        at.x <= zone.max.x &&
        at.y >= zone.min.y &&
        at.y <= zone.max.y &&
        at.z >= zone.min.z &&
        at.z <= zone.max.z;
      if (inside) dvy += (1 - zone.scale) * GRAVITY * dt;
    }
    for (const attractor of ledger.attractors) {
      const toPoint = minus(attractor.point, at);
      const distance = lengthOf(toPoint);
      if (distance > attractor.radius || distance <= 0) continue;
      const dv = (attractor.strength / mass) * dt;
      dvx += (toPoint.x / distance) * dv;
      dvy += (toPoint.y / distance) * dv;
      dvz += (toPoint.z / distance) * dv;
    }
    if (dvx === 0 && dvy === 0 && dvz === 0) return;
    port.applyImpulse(object.body as ColliderHandle, {
      x: dvx * mass,
      y: dvy * mass,
      z: dvz * mass,
    });
  });
}

/**
 * The remote-hold system: steers every hold, then applies zones and attractors. Add it after the
 * physics objects have published their poses; `installRemoteHold` does.
 */
export function remoteHoldSystem(): System<never> {
  return {
    name: 'magic-remote-holds',
    run: ({ world, tick, clock }) => {
      const dt = 1 / clock.hz;
      for (const hold of entryOf(world)[1].holds) steer(world, hold, tick, dt);
      const now = entryOf(world)[1];
      const live = <T extends { readonly expiresTick: number | null }>(list: readonly T[]) =>
        list.filter((f) => f.expiresTick === null || tick < f.expiresTick);
      const zones = live(now.zones);
      const attractors = live(now.attractors);
      if (zones.length !== now.zones.length || attractors.length !== now.attractors.length) {
        update(world, () => ({
          zones: Object.freeze(zones),
          attractors: Object.freeze(attractors),
        }));
      }
      const held = new Set(now.holds.map((h) => h.target));
      applyFields(world, { ...now, zones, attractors }, held, dt);
    },
  };
}

/** Makes `world` run remote holds: registers the ledger and adds the system. Once, at setup. */
export function installRemoteHold<W extends World<never>>(world: W): W {
  world.register(RemoteHoldLedgerComponent);
  world.add(
    world.spawn(),
    RemoteHoldLedgerComponent,
    Object.freeze({
      holds: Object.freeze([]),
      zones: Object.freeze([]),
      attractors: Object.freeze([]),
      nextId: 1,
    }),
  );
  world.addSystem(remoteHoldSystem());
  return world;
}
