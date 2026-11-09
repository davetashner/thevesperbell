// Mechanisms (mw-e03.18): doors that open, close, lock, jam, break and burn, and the levers, buttons,
// cranks and wheels that drive them. There is always more than one way through, and every way arrives
// through a channel other systems already use, never a pairing of object types:
//
// - Interact (`interacted`): open or close a manual door; unlock it with a key from the actor's
//   keyring (the `keys` keyring reads the inventory, mw-e17.3; keys.ts) or pick it (the `pick-lock`
//   affordance is gated on the lockpick capability; the `pick` hook is where the mw-e10 minigame
//   plugs in), and it opens straight away; pull a lever, press a button, turn a crank or wheel.
//   Unlock is gated on the keyring (mw-e17.5): without a fitting key (or on a sealed lock) it is
//   offered greyed with the lock's hint, so Interact moves on to Pick lock or does nothing. A key
//   that opens its lock fires `lock.opened` with the key, and a single-use key is used up. A lock on
//   anything that is not a door (a chest, src/sim/loot/containers.ts) is unlocked and picked the
//   same way; whatever carries it decides what unlocking lets the actor do.
// - Signals (`signalReceived`): a `door` or `mechanism` receiver bound to a door opens it while its
//   input is on and closes it when it goes off (a lever, a pressure plate, a shot bell, mw-e05.13);
//   one bound to a switch sets it. A switch drives every lever and button node bound to it.
// - Properties: a frozen door or switch does not move and reports `mechanismJammed` until it thaws;
//   a door that burns out (`fireBurntOut`) or breaks (breakables, `breakableBroken`) is broken: it
//   stands open for good and shuts nothing out. Magic unlocks through `unlockDoor` (`magic`), which
//   also lifts a seal.
//
// A moving door advances by 1 / (seconds × hz) a tick towards its target; reversing it mid-motion
// turns it round from where it is. It stops where its leaf first touches a placed body in its way
// (geometry.ts) and reports `doorBlocked` once; when the body goes it carries on. A door that closes
// with a crush deals it once to what it met, as a blunt stimulus through the stimulus API: what breaks
// is gone next tick and the door closes; what holds wedges it (a crate under a portcullis).
//
// The door's world presence follows its state at the end of every tick it changes: its leaf collider
// (the `colliders` sink, bound to the door so reach and impacts know it), a light occluder (the
// `occluders` sink) and walled-off element-field cells while it is closed and its profile blocks
// light or gas. `doorShutsOut` tells noise propagation (mw-e09.3) whether it muffles sound. A door's
// prompt follows its state too (Open, Close, Unlock, Pick lock). With no doors or switches, the
// system costs one empty query a tick.

import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { breakableBroken } from '../breakables/events';
import { fireBurntOut } from '../elements/fire';
import { ElementFieldComponent, elementFieldOf } from '../field/install';
import {
  addAffordanceGate,
  InteractableComponent,
  interacted,
  interactableOf,
  type AffordanceGate,
} from '../interaction/system';
import type { AffordanceSpec } from '../interaction/affordance';
import { noiseEmitted } from '../noise/events';
import { bodyMaterialOf, PhysicsColliderComponent, rigidBodiesOf } from '../physics/objects';
import type { ColliderHandle, StaticColliderSink } from '../physics/static-colliders';
import { log } from '../math';
import { readProperty } from '../properties/components';
import { ScenePieceComponent } from '../scene/loader';
import { pressButton, setLever, signalReceived } from '../signals/runtime';
import {
  boundingSphereOf,
  PlacementCentreComponent,
  PlacementComponent,
  placeEntity,
  type Placement,
} from '../stimulus/placement';
import type { Bounds, Vec3 } from '../stimulus/shapes';
import { applyStimulus, StimulusQueueComponent } from '../stimulus/stimulus';
import {
  DoorComponent,
  LockComponent,
  MECHANISM_COMPONENTS,
  SwitchComponent,
  type Door,
  type DoorBlocks,
  type DoorProfile,
  type DoorSlam,
  type Lock,
  type LockSpec,
  type Switch,
  type SwitchKind,
  type UnlockMethod,
} from './components';
import {
  doorBlocked,
  doorStateChanged,
  lockOpened,
  lockRefused,
  lockUnlocked,
  mechanismJammed,
  switchUsed,
  type DoorState,
  type LockRefusal,
} from './events';
import { boundNodes } from './bindings';
import { closedBox, contactOpenness, leafBox, leafCentre, type Obstacle } from './geometry';
import type { Keyring } from './keys';
import {
  impactFeeds,
  ImpactSwitchComponent,
  impactSwitchesSystem,
  resetImpactSwitch,
} from './impacts';
import { CuttableComponent, ropeFeeds, ropesSystem, SuspendedComponent } from './ropes';
import { SupportComponent, supportFeeds, supportsSystem } from './supports';
import { PlateComponent, platesSystem, resetPlate, type PlateOptions } from './plates';
import {
  BeamEmitterComponent,
  beamsSystem,
  BeamTracer,
  LightReceiverComponent,
  OpticComponent,
} from '../light/beams';
import type { StaticOccluders } from '../light/occluders';
import { ChargeReceiverComponent, resetChargeReceiver } from './charge-receivers';
import { lightReceiversSystem, resetLightReceiver } from './receivers';

/** How much faster than by hand a kicked door swings open (mw-e04.18). */
export const SLAM_SPEED = 4;

/**
 * Noise of `door` setting off, dB 1 m away: its profile's loudness (a hand-swung door) plus
 * 20·log10 of how many times faster than that it swings, so a door slammed at 4× is 4× the
 * sound pressure (+12 dB) of the same door eased shut (mw-e03.25).
 */
export function doorLoudness(door: Pick<Door, 'loudness' | 'slam'>): number {
  return door.slam === undefined
    ? door.loudness
    : door.loudness + (20 * log(door.slam.speed)) / Math.LN10;
}

/** `door` without its slam (the key is absent, not undefined, so snapshots match ordinary doors). */
function unslammed(door: Door): Door {
  const plain: { -readonly [K in keyof Door]: Door[K] } = { ...door };
  delete plain.slam;
  return plain;
}

/** Noise of a switch moving, dB 1 m away. */
export const SWITCH_LOUDNESS = 45;

/** Lockpicks' capability (ADR-0004): what the Pick lock affordance asks of the actor. */
export const LOCKPICK_CAPABILITY = 'tool.lockpick';

/** Whether `actor` picks `lock` (the mw-e10 minigame plugs in here). */
export type LockPick = (world: World<never>, actor: EntityId, lock: Lock) => boolean;

export interface MechanismsOptions {
  /** Where door leaf colliders go: the world's physics port in the game. None: doors don't collide. */
  readonly colliders?: StaticColliderSink;
  /** Where closed doors' light occluders go: the light field's statics. None: no light occlusion. */
  readonly occluders?: StaticColliderSink;
  /** Actors' keys for locks (keys.ts); none: keys open nothing. */
  readonly keys?: Keyring;
  /** Decides a pick attempt; none: a pickable lock always yields to someone with lockpicks. */
  readonly pick?: LockPick;
  /** What pressure plates read beyond properties: gravity felt and worn gear (plates.ts). */
  readonly plates?: PlateOptions;
  /** Traces light beams (light/beams.ts); none: one is made, blocked by `occluders` when that is the light field's statics. */
  readonly beams?: BeamTracer;
}

/** How a door is placed (a scene spawn's door data). */
export interface DoorInstance {
  /** The middle of the bottom of the closed leaf, metres. */
  readonly origin: Vec3;
  readonly yaw?: Door['yaw'];
  readonly hinge?: Door['hinge'];
  readonly swing?: Door['swing'];
  /** How it starts; closed by default. */
  readonly state?: 'closed' | 'open' | 'jammed';
  readonly lock?: LockSpec;
  /** Starts locked; defaults to whether it has a lock. */
  readonly locked?: boolean;
}

/** A door's state with its lock and jam: what the prompt and the UI show. */
export type DoorStatus = DoorState | 'locked' | 'jammed';

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
function known<T>(value: T | undefined): T {
  return value as T;
}

const NONE: DoorBlocks = Object.freeze({ light: false, gas: false, sound: false });

/** A door's state (see DOOR_STATES). */
export function doorState(door: Door): DoorState {
  if (door.broken) return 'broken';
  if (door.blockedBy !== null) return 'blocked';
  if (door.openness === door.target) return door.target === 1 ? 'open' : 'closed';
  return door.target === 1 ? 'opening' : 'closing';
}

const frozen = (world: World<never>, entity: EntityId): boolean =>
  readProperty(world, entity, 'frozen');

/** Whether a door is stuck: jammed, or frozen while it is. */
function stuck(world: World<never>, entity: EntityId, door: Door): boolean {
  return door.jammed || frozen(world, entity);
}

const lockOf = (world: World<never>, entity: EntityId): Lock | undefined =>
  world.get(entity, LockComponent);

/** `entity`'s door status, or undefined when it is not a door. */
export function doorStatus(world: World<never>, entity: EntityId): DoorStatus | undefined {
  const door = world.get(entity, DoorComponent);
  if (door === undefined) return undefined;
  const state = doorState(door);
  if (state !== 'closed') return state;
  if (lockOf(world, entity)?.locked === true) return 'locked';
  return stuck(world, entity, door) ? 'jammed' : state;
}

/** What `entity`'s door shuts out now: its profile's blocks while closed, nothing otherwise. */
export function doorShutsOut(world: World<never>, entity: EntityId): DoorBlocks {
  const door = world.get(entity, DoorComponent);
  return door !== undefined && doorState(door) === 'closed' ? door.blocks : NONE;
}

/**
 * The affordances a locked lock offers on whatever carries it (a door, a chest): Unlock, gated on
 * the keyring, and Pick lock, gated on lockpicks, unless the lock is sealed or cannot be picked.
 */
export function lockAffordances(lock: Lock): AffordanceSpec[] {
  const unlock: AffordanceSpec = { verb: 'unlock', label: 'Unlock' };
  if (lock.sealed || lock.pickTier === null) return [unlock];
  return [unlock, { verb: 'pick-lock', requires: [{ capability: LOCKPICK_CAPABILITY }] }];
}

/** The affordances a door offers in its state (none for a broken door or a shut signal door). */
export function doorAffordances(door: Door, lock: Lock | undefined): AffordanceSpec[] {
  if (door.broken) return [];
  if (lock?.locked === true) return lockAffordances(lock);
  if (!door.manual) return [];
  return door.target === 1
    ? [{ verb: 'close', label: 'Close door' }]
    : [{ verb: 'open', label: 'Open door' }];
}

/**
 * Brings a door's Interactable in line with its state (when interaction is installed): mechanisms
 * call it whenever a door's state changes; call it after making a door between steps.
 */
export function refreshAffordances(world: World<never>, entity: EntityId): void {
  const door = world.get(entity, DoorComponent);
  if (door === undefined || !world.isRegistered(InteractableComponent)) return;
  const affordances = doorAffordances(door, lockOf(world, entity));
  const has = world.has(entity, InteractableComponent);
  if (affordances.length === 0) {
    if (has) world.remove(entity, InteractableComponent);
    return;
  }
  const interactable = interactableOf({ affordances });
  if (has) world.set(entity, InteractableComponent, interactable);
  else world.add(entity, InteractableComponent, interactable);
}

/**
 * Makes `entity` a door with `profile` (see the file header), placed at its leaf's centre so
 * stimuli, fire and focus reach it. Like `World.add`, deferred to the end of the tick during a step.
 */
export function makeDoor(
  world: World<never>,
  entity: EntityId,
  profile: DoorProfile,
  instance: DoorInstance,
): void {
  const open = instance.state === 'open' ? 1 : 0;
  const { id, ...rest } = profile;
  const door: Door = {
    ...rest,
    profile: id,
    size: { ...profile.size },
    blocks: { ...profile.blocks },
    origin: { ...instance.origin },
    yaw: instance.yaw ?? 0,
    hinge: instance.hinge ?? 'left',
    swing: instance.swing ?? 'forward',
    openness: open,
    target: open,
    jammed: instance.state === 'jammed',
    broken: false,
    blockedBy: null,
    collider: null,
    solid: null,
    occluder: null,
    sealed: false,
  };
  world.add(entity, DoorComponent, door);
  const { lock } = instance;
  if (lock !== undefined) {
    const { id: lockId, ...spec } = lock;
    world.add(entity, LockComponent, {
      ...spec,
      tags: [...spec.tags],
      lock: lockId,
      locked: instance.locked ?? true,
    });
  }
  placeEntity(world, entity, leafCentre(door), Math.min(profile.size.x, profile.size.y) / 2);
}

/** Positions of a switch kind with `positions` asked for (cranks and wheels only). */
export function switchPositions(kind: SwitchKind, positions?: number): number {
  if (kind === 'button') return 1;
  if (kind === 'lever') return 2;
  return positions ?? 2;
}

/**
 * Makes `entity` a switch of `kind` starting at `position`. Like `World.add`, deferred to the end of
 * the tick during a step.
 * @throws RangeError for a crank or wheel with fewer than 2 positions or a start outside them.
 */
export function makeSwitch(
  world: World<never>,
  entity: EntityId,
  kind: SwitchKind,
  options: { readonly positions?: number; readonly position?: number } = {},
): void {
  const positions = switchPositions(kind, options.positions);
  const position = options.position ?? 0;
  if (!Number.isSafeInteger(positions) || (kind !== 'button' && positions < 2)) {
    throw new RangeError(`a ${kind} needs at least 2 positions, got ${String(positions)}`);
  }
  if (!Number.isSafeInteger(position) || position < 0 || position >= positions) {
    throw new RangeError(
      `switch position must be 0…${String(positions - 1)}, got ${String(position)}`,
    );
  }
  world.add(entity, SwitchComponent, { kind, positions, position });
}

function emitState(
  world: World<never>,
  entity: EntityId,
  before: Door,
  after: Door,
  source: EntityId | null,
): void {
  const from = doorState(before);
  const to = doorState(after);
  if (from === to) return;
  const position = leafCentre(after);
  world.events.emit(doorStateChanged, {
    tick: world.tick,
    entity,
    kind: after.kind,
    from,
    to,
    source,
    position,
  });
  const resting = from === 'closed' || from === 'open';
  if (resting && (to === 'opening' || to === 'closing')) {
    world.events.emit(noiseEmitted, {
      tick: world.tick,
      position,
      loudness: doorLoudness(after),
      kind: 'door',
      entity,
      source,
    });
  }
}

function writeDoor(
  world: World<never>,
  entity: EntityId,
  before: Door,
  after: Door,
  source: EntityId | null,
): void {
  world.set(entity, DoorComponent, after);
  emitState(world, entity, before, after, source);
}

function refuse(
  world: World<never>,
  entity: EntityId,
  lock: Lock,
  reason: LockRefusal,
  source: EntityId | null,
): false {
  world.events.emit(lockRefused, {
    tick: world.tick,
    entity,
    lock: lock.lock,
    reason,
    hint: lock.hint,
    source,
  });
  return false;
}

function jam(world: World<never>, entity: EntityId, source: EntityId | null): false {
  world.events.emit(mechanismJammed, {
    tick: world.tick,
    entity,
    frozen: frozen(world, entity),
    source,
  });
  return false;
}

/**
 * Sends `entity`'s door towards `target` (1 open, 0 closed). Returns whether it set off: a broken
 * door, or one already heading there, does nothing; a locked one reports `lockRefused`, a stuck one
 * `mechanismJammed`.
 */
export function moveDoor(
  world: World<never>,
  entity: EntityId,
  target: 0 | 1,
  source: EntityId | null = null,
  slam?: DoorSlam,
): boolean {
  const door = world.get(entity, DoorComponent);
  if (door === undefined || door.broken || door.target === target) return false;
  const lock = lockOf(world, entity);
  if (lock?.locked === true) return refuse(world, entity, lock, 'locked', source);
  if (stuck(world, entity, door)) return jam(world, entity, source);
  const moving = { ...unslammed(door), target, blockedBy: null };
  writeDoor(world, entity, door, slam === undefined ? moving : { ...moving, slam }, source);
  refreshAffordances(world, entity);
  return true;
}

/**
 * Slams `entity`'s closed door open (a kick, mw-e04.18): it opens like `moveDoor` but swings `speed`
 * times as fast until it is open or stops against something, and what it hits while slamming is
 * reported as `doorBlocked` with `slammedBy`. Returns whether it set off: a locked, stuck, broken or
 * already moving door does not (a locked one reports `lockRefused`, a stuck one `mechanismJammed`).
 */
export function slamDoor(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
  speed = SLAM_SPEED,
): boolean {
  const door = world.get(entity, DoorComponent);
  return (
    door !== undefined &&
    doorState(door) === 'closed' &&
    moveDoor(world, entity, 1, source, { speed, source })
  );
}

/** Opens `entity`'s door (see `moveDoor`). */
export const openDoor = (world: World<never>, entity: EntityId, source: EntityId | null = null) =>
  moveDoor(world, entity, 1, source);

/** Closes `entity`'s door (see `moveDoor`). */
export const closeDoor = (world: World<never>, entity: EntityId, source: EntityId | null = null) =>
  moveDoor(world, entity, 0, source);

/** Sets whether `entity`'s door is jammed (a wedge, rust); returns whether it changed. */
export function jamDoor(world: World<never>, entity: EntityId, jammed: boolean): boolean {
  const door = world.get(entity, DoorComponent);
  if (door === undefined || door.jammed === jammed) return false;
  world.set(entity, DoorComponent, { ...door, jammed });
  return true;
}

/** How a lock was got past. */
export interface UnlockHow {
  readonly by: UnlockMethod;
  readonly source?: EntityId | null;
  /** The key item (by key). */
  readonly key?: string | null;
}

/**
 * Unlocks the lock on `entity`'s door and fires `lockUnlocked`. A sealed lock yields only to magic,
 * which also lifts the seal (anything else reports `lockRefused`). Returns whether it unlocked.
 */
export function unlockDoor(world: World<never>, entity: EntityId, how: UnlockHow): boolean {
  const lock = lockOf(world, entity);
  if (!lock?.locked) return false;
  const source = how.source ?? null;
  if (lock.sealed && how.by !== 'magic') return refuse(world, entity, lock, 'sealed', source);
  world.set(entity, LockComponent, { ...lock, locked: false, sealed: false });
  world.events.emit(lockUnlocked, {
    tick: world.tick,
    entity,
    lock: lock.lock,
    by: how.by,
    source,
    key: how.key ?? null,
  });
  refreshAffordances(world, entity);
  return true;
}

/** Locks `entity`'s door again; only a closed, unbroken door with a lock. Returns whether it did. */
export function lockDoor(world: World<never>, entity: EntityId): boolean {
  const door = world.get(entity, DoorComponent);
  const lock = lockOf(world, entity);
  if (door === undefined || lock === undefined || lock.locked) return false;
  if (doorState(door) !== 'closed') return false;
  world.set(entity, LockComponent, { ...lock, locked: true });
  refreshAffordances(world, entity);
  return true;
}

/**
 * Sets every lever node bound to `entity`'s switch to its position (on unless 0), without the events
 * of moving it: a scene's switches that start on. Between steps, after placing the graphs.
 */
export function syncSwitchNodes(world: World<never>, entity: EntityId): void {
  const own = world.get(entity, SwitchComponent);
  if (own === undefined) return;
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'lever') setLever(world, graph, node, own.position !== 0);
  }
}

function writeSwitch(
  world: World<never>,
  entity: EntityId,
  own: Switch,
  position: number,
  source: EntityId | null,
): void {
  world.set(entity, SwitchComponent, { ...own, position });
  for (const [graph, node, kind] of boundNodes(world, entity)) {
    if (kind === 'button') pressButton(world, graph, node);
    else setLever(world, graph, node, position !== 0);
  }
  world.events.emit(switchUsed, {
    tick: world.tick,
    entity,
    kind: own.kind,
    position,
    positions: own.positions,
    source,
  });
  const at = world.get(entity, PlacementComponent);
  if (at !== undefined) {
    world.events.emit(noiseEmitted, {
      tick: world.tick,
      position: { x: at.x, y: at.y, z: at.z },
      loudness: SWITCH_LOUDNESS,
      kind: 'switch',
      entity,
      source,
    });
  }
}

/**
 * Uses `entity`'s switch: a lever flips, a crank or wheel steps to its next position (round to 0), a
 * button presses and springs back. Bound lever nodes follow the position (on unless 0); bound button
 * nodes pulse. A frozen switch does not move and reports `mechanismJammed`. Returns whether it moved.
 */
export function useSwitch(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null = null,
): boolean {
  const own = world.get(entity, SwitchComponent);
  if (own === undefined) return false;
  if (frozen(world, entity)) return jam(world, entity, source);
  writeSwitch(world, entity, own, (own.position + 1) % own.positions, source);
  return true;
}

/**
 * Sets `entity`'s switch to `position` (a signal resetting a lever). Frozen switches don't move.
 * Returns whether it moved.
 */
export function setSwitch(
  world: World<never>,
  entity: EntityId,
  position: number,
  source: EntityId | null = null,
): boolean {
  const own = world.get(entity, SwitchComponent);
  if (own === undefined || own.kind === 'button') return false;
  const to = Math.min(own.positions - 1, Math.max(0, position));
  if (own.position === to) return false;
  if (frozen(world, entity)) return jam(world, entity, source);
  writeSwitch(world, entity, own, to, source);
  return true;
}

interface Rules {
  readonly colliders: StaticColliderSink | undefined;
  readonly occluders: StaticColliderSink | undefined;
  readonly keys: Keyring | undefined;
  readonly pick: LockPick | undefined;
}

/**
 * Tries `actor`'s keyring on `entity`'s lock: the first fitting key unlocks it (`lockUnlocked`, then
 * `lock.opened`), and a single-use one is used up.
 */
function tryKey(world: World<never>, entity: EntityId, actor: EntityId, rules: Rules): boolean {
  const lock = lockOf(world, entity);
  if (!lock?.locked) return lock !== undefined;
  if (lock.sealed) return refuse(world, entity, lock, 'sealed', actor);
  const match = rules.keys?.find(world, actor, lock);
  if (match === undefined) return refuse(world, entity, lock, 'no-key', actor);
  unlockDoor(world, entity, { by: 'key', source: actor, key: match.key });
  const consumed = known(rules.keys).use(world, actor, match);
  world.events.emit(lockOpened, {
    tick: world.tick,
    entity,
    lock: lock.lock,
    keyId: match.key,
    actor,
    consumed,
  });
  return true;
}

/**
 * The keyring's gate on Unlock: a locked door's Unlock is unavailable, with the lock's hint as the
 * reason, while the lock is sealed or the actor holds no key that fits it.
 */
function keyGate(rules: Rules): AffordanceGate {
  return (world, actor, target, affordance) => {
    if (affordance.verb !== 'unlock') return undefined;
    const lock = lockOf(world, target);
    if (!lock?.locked) return undefined;
    if (!lock.sealed && rules.keys?.find(world, actor, lock) !== undefined) return undefined;
    return lock.hint;
  };
}

/** `actor` tries to pick `entity`'s lock. */
function tryPick(world: World<never>, entity: EntityId, actor: EntityId, rules: Rules): boolean {
  const lock = lockOf(world, entity);
  if (!lock?.locked) return lock !== undefined;
  if (lock.sealed) return refuse(world, entity, lock, 'sealed', actor);
  if (lock.pickTier === null) return refuse(world, entity, lock, 'unpickable', actor);
  if (!(rules.pick?.(world, actor, lock) ?? true)) {
    return refuse(world, entity, lock, 'pick-failed', actor);
  }
  return unlockDoor(world, entity, { by: 'pick', source: actor });
}

const sameBox = (a: Bounds | null, b: Bounds | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.min.x === b.min.x &&
    a.min.y === b.min.y &&
    a.min.z === b.min.z &&
    a.max.x === b.max.x &&
    a.max.y === b.max.y &&
    a.max.z === b.max.z);

const boxDesc = (box: Bounds) => ({ kind: 'box' as const, min: box.min, max: box.max });

/** The cells a closed door walls off: its leaf, at least one cell thick. */
function doorway(world: World<never>, door: Door): Bounds {
  const half = elementFieldOf(world).config.cellSize / 2;
  const { min, max } = closedBox(door);
  const grow = (lo: number, hi: number): [number, number] => {
    const mid = (lo + hi) / 2;
    return hi - lo >= 2 * half ? [lo, hi] : [mid - half, mid + half];
  };
  const [x0, x1] = grow(min.x, max.x);
  const [y0, y1] = grow(min.y, max.y);
  const [z0, z1] = grow(min.z, max.z);
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

const removeFrom = (sink: StaticColliderSink | undefined, handle: number | null): void => {
  if (sink !== undefined && handle !== null && sink.has(handle as ColliderHandle)) {
    sink.remove(handle as ColliderHandle);
  }
};

/**
 * Brings `entity`'s door's collider, light occluder and field cells in line with its state; touches
 * the sinks and the field only when something changed.
 */
function syncDoor(world: World<never>, entity: EntityId, rules: Rules): void {
  const door = known(world.get(entity, DoorComponent)); // callers know it is a door
  let next = door;
  const { colliders, occluders } = rules;
  const solid = door.broken || colliders === undefined ? null : leafBox(door, door.openness);
  if (!sameBox(solid, door.solid)) {
    removeFrom(colliders, door.collider);
    const collider =
      solid === null || colliders === undefined ? null : colliders.add(boxDesc(solid));
    next = { ...next, collider, solid };
    if (world.isRegistered(PhysicsColliderComponent)) {
      const bound = { colliders: collider === null ? [] : [collider] };
      if (collider !== null) {
        rigidBodiesOf(world).setMaterial(collider, bodyMaterialOf(world, entity));
      }
      if (world.has(entity, PhysicsColliderComponent)) {
        world.set(entity, PhysicsColliderComponent, bound);
      } else world.add(entity, PhysicsColliderComponent, bound);
    }
  }
  const closed = doorState(door) === 'closed';
  const occlude = closed && door.blocks.light && occluders !== undefined;
  if (occlude !== (door.occluder !== null)) {
    removeFrom(occluders, door.occluder);
    const occluder = occlude ? occluders.add(boxDesc(closedBox(door))) : null;
    next = { ...next, occluder };
  }
  const seal = closed && door.blocks.gas && world.isRegistered(ElementFieldComponent);
  if (seal !== door.sealed && world.isRegistered(ElementFieldComponent)) {
    elementFieldOf(world).setConductivity(doorway(world, door), seal ? 0 : 1);
    next = { ...next, sealed: seal };
  }
  if (next !== door) world.set(entity, DoorComponent, next);
}

/** Something in a door's way: what the leaf meets (`body`) and its bounding sphere (`at`). */
interface InTheWay {
  readonly entity: EntityId;
  readonly at: Placement;
  readonly body: Obstacle;
}

/**
 * Bodies that can stand in a door's way: placed, with a size, and not level geometry or mechanisms.
 * One placed at its feet with a centre above them (a character, mw-e04.34) is an upright body as tall
 * as the top of its bounding sphere, so a leaf meets its capsule rather than that sphere (mw-e01.19).
 */
function obstacles(world: World<never>, self: EntityId): InTheWay[] {
  const found: InTheWay[] = [];
  const pieces = world.isRegistered(ScenePieceComponent);
  world.query(PlacementComponent).forEach((entity, placed) => {
    if (entity === self || placed.radius <= 0) return;
    if (world.has(entity, DoorComponent) || world.has(entity, SwitchComponent)) return;
    if (pieces && world.has(entity, ScenePieceComponent)) return;
    const at = boundingSphereOf(world, entity, placed);
    const centre = world.get(entity, PlacementCentreComponent);
    const body = centre === undefined ? at : { ...placed, height: centre.offset.y + centre.radius };
    found.push({ entity, at, body });
  });
  return found;
}

/** Moves one door a tick towards its target, stopping against the first thing in its way. */
function stepDoor(world: World<never>, entity: EntityId, door: Door): void {
  if (door.broken || door.openness === door.target) return;
  if (frozen(world, entity)) return; // frozen mid-motion: it waits for the thaw
  const step = (door.slam?.speed ?? 1) / (door.seconds * world.clock.hz);
  const from = door.openness;
  const to = door.target === 1 ? Math.min(1, from + step) : Math.max(0, from - step);
  let stop = to;
  let by: { entity: EntityId; at: Vec3 } | undefined;
  for (const obstacle of obstacles(world, entity)) {
    const contact = contactOpenness(door, from, to, obstacle.body);
    if (contact === undefined) continue;
    // Every contact lies between `from` and `to`, so the first one always comes before `to`.
    if (door.target === 1 ? contact < stop : contact > stop) {
      stop = contact;
      by = obstacle;
    }
  }
  const blockedBy = by?.entity ?? null;
  // A slam is over once the door is open or has met something.
  const spent = blockedBy !== null || stop === door.target;
  const after: Door = { ...(spent ? unslammed(door) : door), openness: stop, blockedBy };
  writeDoor(world, entity, door, after, null);
  if (by === undefined || blockedBy === door.blockedBy) return;
  const crushed = door.target === 0 && door.crush > 0 && world.isRegistered(StimulusQueueComponent);
  if (crushed) {
    applyStimulus(world, {
      shape: { kind: 'contact', target: by.entity },
      element: 'blunt',
      intensity: door.crush,
      source: entity,
    });
  }
  world.events.emit(doorBlocked, {
    tick: world.tick,
    entity,
    kind: door.kind,
    by: by.entity,
    openness: stop,
    crushed,
    position: { x: by.at.x, y: by.at.y, z: by.at.z },
    ...(door.slam !== undefined && { slammedBy: door.slam.source }),
  });
}

/** Breaks `entity`'s door for good: open, collider-less, shutting nothing out. */
function breakDoor(
  world: World<never>,
  entity: EntityId,
  source: EntityId | null,
  rules: Rules,
): void {
  const door = world.get(entity, DoorComponent);
  if (door === undefined || door.broken) return;
  writeDoor(
    world,
    entity,
    door,
    { ...door, broken: true, openness: 1, target: 1, blockedBy: null },
    source,
  );
  refreshAffordances(world, entity);
  syncDoor(world, entity, rules);
}

/** The mechanisms system: moves doors, then brings every door's world presence up to date. */
export function mechanismsSystem<TInput>(rules: Rules): System<TInput> {
  return {
    name: 'mechanisms',
    run: ({ world: w }) => {
      const world: World<never> = w;
      const doors = [...world.query(DoorComponent).ids()];
      for (const entity of doors) {
        stepDoor(world, entity, known(world.get(entity, DoorComponent)));
        syncDoor(world, entity, rules);
      }
    },
  };
}

/**
 * Makes `world` run mechanisms (see the file header): registers the door, lock and switch
 * components, listens to interactions, signals, burnouts and breaks, and adds the mechanisms system.
 * Needs world properties and placements; install it after interaction and signals, so a door moves
 * the tick it is told to. Call once at setup, between steps. Returns a function that removes the
 * subscriptions.
 */
export function installMechanisms<TInput>(
  world: World<TInput>,
  options: MechanismsOptions = {},
): () => void {
  const w: World<never> = world;
  const rules: Rules = {
    colliders: options.colliders,
    occluders: options.occluders,
    keys: options.keys,
    pick: options.pick,
  };
  world.register(
    ...MECHANISM_COMPONENTS,
    PlateComponent,
    ImpactSwitchComponent,
    CuttableComponent,
    SuspendedComponent,
    SupportComponent,
    BeamEmitterComponent,
    OpticComponent,
    LightReceiverComponent,
    ChargeReceiverComponent,
  );
  const occluders = options.occluders as Partial<StaticOccluders> | undefined;
  const tracer =
    options.beams ??
    new BeamTracer(
      occluders?.along === undefined
        ? {}
        : { statics: occluders as Pick<StaticOccluders, 'along'> },
    );
  world.addSystem(mechanismsSystem(rules));
  world.addSystem(platesSystem(options.plates));
  world.addSystem(impactSwitchesSystem());
  world.addSystem(beamsSystem(tracer));
  world.addSystem(lightReceiversSystem(tracer));
  world.addSystem(supportsSystem());
  world.addSystem(ropesSystem());
  // A door that goes (broken, burnt away, unloaded) takes its collider, occluder and seal with it.
  world.onRemove(DoorComponent, (_entity, door) => {
    removeFrom(rules.colliders, door.collider);
    removeFrom(rules.occluders, door.occluder);
    if (door.sealed && w.isRegistered(ElementFieldComponent)) {
      elementFieldOf(w).setConductivity(doorway(w, door), 1);
    }
  });
  // A rope that goes (cut, burnt away, unloaded) takes its collider with it.
  world.onRemove(CuttableComponent, (_entity, rope) => {
    removeFrom(rules.colliders, rope.collider);
  });
  world.onRemove(SupportComponent, (_entity, support) => {
    removeFrom(rules.colliders, support.collider);
  });
  const offs = [
    impactFeeds(world),
    ropeFeeds(world),
    supportFeeds(world),
    addAffordanceGate(world, keyGate(rules)),
    world.events.on(interacted, ({ actor, target, verb }) => {
      if (w.has(target, SwitchComponent)) {
        useSwitch(w, target, actor);
        return;
      }
      const door = w.get(target, DoorComponent);
      if (door === undefined) {
        // A lock on something else (a chest, mw-e18.3) yields the same way; its owner opens it.
        if (verb === 'unlock') tryKey(w, target, actor, rules);
        else if (verb === 'pick-lock') tryPick(w, target, actor, rules);
        return;
      }
      switch (verb) {
        case 'unlock':
          if (tryKey(w, target, actor, rules) && door.manual) openDoor(w, target, actor);
          return;
        case 'pick-lock':
          if (tryPick(w, target, actor, rules) && door.manual) openDoor(w, target, actor);
          return;
        case 'close':
          closeDoor(w, target, actor);
          return;
        default:
          moveDoor(w, target, verb === 'open' || door.target === 0 ? 1 : 0, actor);
      }
    }),
    world.events.on(signalReceived, ({ receiver, entity, value, graph }) => {
      if ((receiver !== 'door' && receiver !== 'mechanism') || entity === null) return;
      if (w.has(entity, PlateComponent)) {
        // A signal on resets a plate (a latching one's way off); off does nothing.
        if (value) resetPlate(w, entity, graph);
      } else if (w.has(entity, LightReceiverComponent)) {
        if (value) resetLightReceiver(w, entity, graph);
      } else if (w.has(entity, ChargeReceiverComponent)) {
        if (value) resetChargeReceiver(w, entity, graph);
      } else if (w.has(entity, ImpactSwitchComponent)) {
        // Likewise an impact switch: on resets it (a latching one's way off).
        if (value) resetImpactSwitch(w, entity, graph);
      } else if (w.has(entity, DoorComponent)) moveDoor(w, entity, value ? 1 : 0, graph);
      else setSwitch(w, entity, value ? 1 : 0, graph);
    }),
    world.events.on(fireBurntOut, ({ entity }) => {
      breakDoor(w, entity, null, rules);
    }),
    world.events.on(breakableBroken, ({ entity, source }) => {
      breakDoor(w, entity, source, rules);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
