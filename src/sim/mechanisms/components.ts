// Mechanism components (mw-e03.18): doors, the locks they carry, and the switches (levers, buttons,
// cranks, wheels) that drive them through signal graphs. Everything is plain data on the entity, so
// doors and switches are part of snapshots, state hashes and saves like any other component. What a
// door is made of (wood burns, iron does not, a frozen door shatters) stays in its world properties;
// these components only hold what is specific to being a mechanism.

import type { SceneYaw } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import type { Bounds, Vec3 } from '../stimulus/shapes';

/** How a door's leaf moves. */
export const DOOR_KINDS = ['hinged', 'sliding', 'portcullis', 'trapdoor'] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

/** Switch kinds: a lever toggles, a button is momentary, a crank or wheel steps through positions. */
export const SWITCH_KINDS = ['lever', 'button', 'crank', 'wheel'] as const;
export type SwitchKind = (typeof SWITCH_KINDS)[number];

/** Ways past a lock. Breaking or burning the door is not unlocking it: the door is just gone. */
export const UNLOCK_METHODS = ['key', 'pick', 'magic'] as const;
export type UnlockMethod = (typeof UNLOCK_METHODS)[number];

/** Which side the hinge is on (−x or +x of the doorway before yaw); a sliding door slides that way. */
export type DoorHinge = 'left' | 'right';
/** Which way a hinged door swings: towards +z (forward) or −z (back) before yaw. */
export type DoorSwing = 'forward' | 'back';

/** What a closed door shuts out. */
export interface DoorBlocks {
  readonly light: boolean;
  readonly gas: boolean;
  readonly sound: boolean;
}

/** A door profile (content `door`). */
export interface DoorProfile {
  readonly id: string;
  readonly kind: DoorKind;
  /**
   * Leaf size, metres: x is the extent from the hinge (or across the doorway), y the height (a
   * trapdoor: its extent along the hinge), z the thickness.
   */
  readonly size: Vec3;
  /** Seconds from fully closed to fully open. */
  readonly seconds: number;
  /** Blunt hit, J, it delivers to what it closes on (0: it just stops). */
  readonly crush: number;
  /** Opens and closes by hand (Interact). */
  readonly manual: boolean;
  readonly blocks: DoorBlocks;
  /** Noise when it starts to move, dB 1 m away. */
  readonly loudness: number;
}

/** Profile id → profile, or undefined when there is none. */
export type DoorProfileLookup = (id: string) => DoorProfile | undefined;

/** A door being slammed open (a kick, mw-e04.18): it swings faster than by hand until it stops. */
export interface DoorSlam {
  /** Times its normal speed. */
  readonly speed: number;
  /** Who slammed it, or null. */
  readonly source: EntityId | null;
}

/** A door (`mechanisms.door`; a snapshot and save key, never renamed). */
export interface Door extends Omit<DoorProfile, 'id'> {
  /** Its profile id. */
  readonly profile: string;
  /** Where the door stands: the middle of the bottom of its closed leaf, metres. */
  readonly origin: Vec3;
  readonly yaw: SceneYaw;
  readonly hinge: DoorHinge;
  readonly swing: DoorSwing;
  /** 0 closed … 1 open. */
  readonly openness: number;
  /** Where it is heading: 0 closed, 1 open. */
  readonly target: 0 | 1;
  /** Stuck (rusted, wedged shut by hand); a frozen door is stuck too, while it is frozen. */
  readonly jammed: boolean;
  /** Broken or burnt: it stands open for good and shuts nothing out. */
  readonly broken: boolean;
  /** What it is pressing against right now, or null. */
  readonly blockedBy: EntityId | null;
  /** Its leaf collider in the collider sink, and the box it was made from; null when it has none. */
  readonly collider: number | null;
  readonly solid: Bounds | null;
  /** Its light occluder, or null. */
  readonly occluder: number | null;
  /** Whether it has walled off the element field's cells in its doorway (gas, smoke). */
  readonly sealed: boolean;
  /** Present only while it is being slammed open; absent otherwise (so ordinary doors hash as before). */
  readonly slam?: DoorSlam;
}

export const DoorComponent = defineComponent<Door>('mechanisms.door');

/** A lock (content `lock`). */
export interface LockSpec {
  readonly id: string;
  /** 0 (a latch) … 5 (a vault). */
  readonly tier: number;
  /** Lockpicking tier needed to pick it; null: it cannot be picked. */
  readonly pickTier: number | null;
  /** A magical seal: keys and picks fail until magic unlocks it. */
  readonly sealed: boolean;
  /** Tags a master key opens. */
  readonly tags: readonly string[];
  /** Shown when Interact finds no way past it. */
  readonly hint: string;
}

/** Lock id → lock, or undefined when there is none. */
export type LockLookup = (id: string) => LockSpec | undefined;

/** A lock on a door (`mechanisms.lock`; a snapshot and save key, never renamed). */
export interface Lock extends Omit<LockSpec, 'id'> {
  /** The lock id keys name. */
  readonly lock: string;
  readonly locked: boolean;
}

export const LockComponent = defineComponent<Lock>('mechanisms.lock');

/** A switch (`mechanisms.switch`; a snapshot and save key, never renamed). */
export interface Switch {
  readonly kind: SwitchKind;
  /** Positions it steps through: a lever 2, a button 1 (it springs back), a crank or wheel 2–8. */
  readonly positions: number;
  /** Where it is now, 0 (off) … positions − 1. */
  readonly position: number;
}

export const SwitchComponent = defineComponent<Switch>('mechanisms.switch');

/** Every component the mechanisms layer uses. */
export const MECHANISM_COMPONENTS = [DoorComponent, LockComponent, SwitchComponent] as const;
