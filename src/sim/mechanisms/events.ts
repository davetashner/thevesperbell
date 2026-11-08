// The events mechanisms emit (mw-e03.18). Audio and VFX cue sheets, quests, crime (the source), the
// UI's prompt hints and stealth (doors that shut sound out, mw-e09.3) read them; nothing here plays a
// sound. Doors and switches that start to move also emit a `noiseEmitted` for hearing.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { Vec3 } from '../stimulus/shapes';
import type { DoorKind, SwitchKind, UnlockMethod } from './components';

/** A door's state as the world sees it (locked and jammed are its lock's and its own flags). */
export const DOOR_STATES = ['closed', 'opening', 'open', 'closing', 'blocked', 'broken'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

/** A door changed state. */
export interface DoorStateChange {
  readonly tick: number;
  readonly entity: EntityId;
  readonly kind: DoorKind;
  readonly from: DoorState;
  readonly to: DoorState;
  /** Who moved it (the actor, the graph that signalled it), or null. */
  readonly source: EntityId | null;
  /** Its leaf's centre when closed, metres. */
  readonly position: Vec3;
}

export const doorStateChanged = defineEvent<DoorStateChange>('doorStateChanged');

/** A moving door met something and stopped against it. */
export interface DoorBlocked {
  readonly tick: number;
  readonly entity: EntityId;
  readonly kind: DoorKind;
  /** What it met. */
  readonly by: EntityId;
  /** Where it stopped, 0 closed … 1 open. */
  readonly openness: number;
  /** It was closing with a crush and dealt it (what did not break wedges it). */
  readonly crushed: boolean;
  /** The centre of what it met, metres. */
  readonly position: Vec3;
  /** Present when it met it while being slammed open (a kick, mw-e04.18): who slammed it, or null. */
  readonly slammedBy?: EntityId | null;
}

export const doorBlocked = defineEvent<DoorBlocked>('doorBlocked');

/** A lock was opened. */
export interface LockUnlocked {
  readonly tick: number;
  /** What the lock is on: a door, a chest (mw-e18.3). */
  readonly entity: EntityId;
  readonly lock: string;
  readonly by: UnlockMethod;
  /** Who opened it, or null. */
  readonly source: EntityId | null;
  /** The key item that opened it (by key), else null. */
  readonly key: string | null;
}

export const lockUnlocked = defineEvent<LockUnlocked>('lockUnlocked');

/**
 * A key from an actor's keyring opened a lock (mw-e17.5): what quests listen to ("open the tower
 * with the warden's key"). It follows the lock's `lockUnlocked`, which every way past a lock fires.
 */
export interface LockOpened {
  readonly tick: number;
  /** What the lock is on: a door, a chest (mw-e18.3). */
  readonly entity: EntityId;
  readonly lock: string;
  /** The key item that opened it. */
  readonly keyId: string;
  /** Whose keyring it was on. */
  readonly actor: EntityId;
  /** A single-use key, used up opening it. */
  readonly consumed: boolean;
}

export const lockOpened = defineEvent<LockOpened>('lock.opened');

/** Why a lock held. */
export type LockRefusal = 'no-key' | 'sealed' | 'unpickable' | 'pick-failed' | 'locked';

/** Something tried a lock and it held. */
export interface LockRefused {
  readonly tick: number;
  readonly entity: EntityId;
  readonly lock: string;
  readonly reason: LockRefusal;
  /** The lock's hint ("Locked."). */
  readonly hint: string;
  /** Who tried, or null (a signal). */
  readonly source: EntityId | null;
}

export const lockRefused = defineEvent<LockRefused>('lockRefused');

/** A switch moved. */
export interface SwitchUsed {
  readonly tick: number;
  readonly entity: EntityId;
  readonly kind: SwitchKind;
  /** Its position now (a button is back at 0: it pressed and sprang back). */
  readonly position: number;
  readonly positions: number;
  readonly source: EntityId | null;
}

export const switchUsed = defineEvent<SwitchUsed>('switchUsed');

/** A jammed or frozen door or switch was tried and did not move. */
export interface MechanismJammed {
  readonly tick: number;
  readonly entity: EntityId;
  /** Frozen solid (it frees itself when it thaws), else jammed. */
  readonly frozen: boolean;
  readonly source: EntityId | null;
}

export const mechanismJammed = defineEvent<MechanismJammed>('mechanismJammed');
