// What the hiding rules keep in the world (mw-e03.23): the hiding spots (a wardrobe, a haystack, a
// barrel) and, on whoever is inside one, the marker that says so. Kept apart from the rules
// (hiding.ts) so perception, the player's movement and the AI can ask who is hidden and where
// without depending on them.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { cos, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';

/** A place an actor can hide (`hiding.spot`; a snapshot key, never renamed). */
export interface HidingSpot {
  /** How many actors fit at once. */
  readonly capacity: number;
  /** How well it hides whoever is inside, 0 (not at all) to 1 (out of every sight query). */
  readonly concealment: number;
  /** Whether the occupant may look out through it (the peek camera). */
  readonly peek: boolean;
  /** Loudness of getting in and of getting out, dB at 1 m. */
  readonly enterDb: number;
  readonly exitDb: number;
  /** Where the spot stands, metres (its feet): a physics object's centre follows its body. */
  readonly origin: Vec3;
  /** Which way its opening faces: a yaw, radians, as the player's (0 faces −z). */
  readonly yaw: number;
  /**
   * Offsets in the spot's frame: x to the right of the opening, y up, z out of it. Where an occupant
   * stands inside, where the peek camera sits, and the exit points in order of preference.
   */
  readonly inside: Vec3;
  readonly eye: Vec3;
  readonly exits: readonly Vec3[];
  /** Who is inside, in the order they got in. */
  readonly occupants: readonly EntityId[];
  /** Where its physics body was last tick, so the spot moves with it; null for a fixed one. */
  readonly follow: Vec3 | null;
}

export const HidingSpotComponent = defineComponent<HidingSpot>('hiding.spot');

/** Whoever is inside a spot (`hiding.hidden`; a snapshot key, never renamed). */
export interface Hidden {
  readonly spot: EntityId;
  /** The spot's concealment when they got in. */
  readonly concealment: number;
  /** Tick they got in. */
  readonly since: number;
  /** Where they stood before, so they can be put back if the spot is gone. */
  readonly from: Vec3;
}

export const HiddenComponent = defineComponent<Hidden>('hiding.hidden');

/** Why an actor came out of a spot it did not choose to leave. */
export type EjectCause = 'burning' | 'broken' | 'submerged' | 'toppled' | 'died' | 'gone';

/** An actor got into a spot. */
export interface HidingEntered {
  readonly tick: number;
  readonly actor: EntityId;
  readonly spot: EntityId;
  readonly concealment: number;
}

/** An actor chose to get out of a spot. */
export interface HidingLeft {
  readonly tick: number;
  readonly actor: EntityId;
  readonly spot: EntityId;
  readonly to: Vec3;
}

/** An actor was thrown out of a spot (see `EjectCause`). */
export interface HidingEjected {
  readonly tick: number;
  readonly actor: EntityId;
  readonly spot: EntityId;
  readonly cause: EjectCause;
  readonly to: Vec3;
  /** Whether the way out was free: false when every exit was blocked and the first one was used. */
  readonly free: boolean;
  /** Heat the occupant took, °C (0 unless the spot was burning). */
  readonly heat: number;
}

/** A try to get in or out was refused. */
export interface HidingRefused {
  readonly tick: number;
  readonly actor: EntityId;
  readonly spot: EntityId;
  readonly action: 'enter' | 'leave';
  readonly reason: HidingRefusal;
}

export type HidingRefusal =
  | 'not-a-spot'
  /** Every place it holds is taken. */
  | 'full'
  | 'already-hidden'
  | 'burning'
  | 'hands-full'
  | 'busy'
  /** Every exit point is blocked. */
  | 'blocked'
  | 'not-inside';

export const hidingEntered = defineEvent<HidingEntered>('hiding.entered');
export const hidingLeft = defineEvent<HidingLeft>('hiding.left');
export const hidingEjected = defineEvent<HidingEjected>('hiding.ejected');
export const hidingRefused = defineEvent<HidingRefused>('hiding.refused');

/** The noise kinds hiding makes (docs/design/noise-events.md). */
export const HIDE_ENTER_NOISE = 'hide-enter';
export const HIDE_EXIT_NOISE = 'hide-exit';

/** What the prompt shows for each refusal. */
export const HIDING_REASONS: Readonly<Record<HidingRefusal, string>> = Object.freeze({
  'not-a-spot': 'Nowhere to hide',
  full: 'Occupied',
  'already-hidden': 'Hiding',
  burning: 'Burning',
  'hands-full': 'Hands full',
  busy: 'Busy',
  blocked: 'Blocked',
  'not-inside': 'Not hiding',
});

const NONE: readonly EntityId[] = Object.freeze([]);

/** `entity`'s spot, or undefined (also where hiding is not installed). */
export function spotOf(world: World<never>, entity: EntityId): HidingSpot | undefined {
  return world.isRegistered(HidingSpotComponent)
    ? world.get(entity, HidingSpotComponent)
    : undefined;
}

/** Who is inside `entity` (nobody when it is not a spot). The AI's search asks this. */
export function occupantsOf(world: World<never>, entity: EntityId): readonly EntityId[] {
  return spotOf(world, entity)?.occupants ?? NONE;
}

/** Whether anyone is hiding in `entity`. */
export function isOccupied(world: World<never>, entity: EntityId): boolean {
  return occupantsOf(world, entity).length > 0;
}

/** Where `actor` hides, or undefined when it does not (also where hiding is not installed). */
export function hiddenOf(world: World<never>, actor: EntityId): Hidden | undefined {
  return world.isRegistered(HiddenComponent) ? world.get(actor, HiddenComponent) : undefined;
}

/** Whether `actor` is hiding in a spot. */
export function isHidden(world: World<never>, actor: EntityId): boolean {
  return hiddenOf(world, actor) !== undefined;
}

/** How well `actor` is hidden, 0 (in plain sight) to 1 (out of every sight query). */
export function concealmentOf(world: World<never>, actor: EntityId): number {
  return hiddenOf(world, actor)?.concealment ?? 0;
}

/** A point of a spot's frame (x right of the opening, y up, z out of it) in the world. */
export function spotPoint(spot: Pick<HidingSpot, 'origin' | 'yaw'>, local: Vec3): Vec3 {
  const { yaw, origin } = spot;
  // The opening faces (−sin yaw, −cos yaw); its right hand is (cos yaw, −sin yaw).
  const rx = cos(yaw);
  const rz = -sin(yaw);
  const fx = -sin(yaw);
  const fz = -cos(yaw);
  return {
    x: origin.x + local.x * rx + local.z * fx,
    y: origin.y + local.y,
    z: origin.z + local.x * rz + local.z * fz,
  };
}

/** Where the occupants of `spot` stand, in the world. */
export function insidePoint(spot: HidingSpot): Vec3 {
  return spotPoint(spot, spot.inside);
}

/** The peek camera: where the eye sits and the way it faces by default, for `actor` (or undefined). */
export interface PeekPose {
  readonly eye: Vec3;
  /** The spot's opening, radians. */
  readonly yaw: number;
  readonly peek: boolean;
}

/** The peek view of `actor`, or undefined when it is not hiding. */
export function peekOf(world: World<never>, actor: EntityId): PeekPose | undefined {
  const hidden = hiddenOf(world, actor);
  const spot = hidden === undefined ? undefined : spotOf(world, hidden.spot);
  if (spot === undefined) return undefined;
  return { eye: spotPoint(spot, spot.eye), yaw: spot.yaw, peek: spot.peek };
}
