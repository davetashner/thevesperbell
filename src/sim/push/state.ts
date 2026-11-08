// What the push rules keep in the world (mw-e02.18): who has hold of which heavy object, the objects
// still gliding after a release, the optional per-object constraints, and the restraint a pusher's
// movement is held to. Kept apart from the rules (push.ts) so the player's movement can read a
// pusher's restraint without depending on them (as carry/state.ts does for carrying).
//
// The ledger lives on one entity (made when pushing is installed) so a grab or a release takes effect
// at once inside a tick, and so a snapshot, a state hash and a replay carry every grab and glide.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';

/** One grab: an actor with hold of a pushable object (a row of `push.ledger`). */
export interface Grab {
  readonly actor: EntityId;
  readonly target: EntityId;
  /** Tick it was grabbed. */
  readonly since: number;
  /** Horizontal velocity the object moved at on the last tick, m/s (what a release carries on with). */
  readonly vx: number;
  readonly vz: number;
}

/** An object that glides on after a release: coasting to a stop on friction, or to a grid cell centre. */
export interface Glide {
  readonly target: EntityId;
  readonly vx: number;
  readonly vz: number;
  /** The grid cell centre it completes to, or null when it coasts on friction. */
  readonly goal: { readonly x: number; readonly z: number } | null;
}

/** Every grab (ascending actor id) and glide (ascending target id); `push.ledger`, never renamed. */
export interface PushLedger {
  readonly grabs: readonly Grab[];
  readonly glides: readonly Glide[];
}

export const PushLedgerComponent = defineComponent<PushLedger>('push.ledger');

/**
 * Constraints and rotation an object declares as data (`push.config`). An absent component is a free
 * pushable. Plain data: scene content and prefabs (e15) set it.
 */
export interface PushConfig {
  /** Unit direction (x, z) the object may only move along (a rail), or null when it moves freely. */
  readonly axis: readonly [number, number] | null;
  /** Grid cell size, metres (0 = not grid-snapped): moves along one cardinal axis at a time and, once released, completes to a cell centre (centres at multiples of the size). */
  readonly grid: number;
  /** Degrees one rotate turns it by (0 = not rotatable). */
  readonly rotateStep: number;
  /** Degrees it has been turned in total, 0…360 (the rules keep it). */
  readonly angle: number;
}

export const PushConfigComponent = defineComponent<PushConfig>('push.config');

const NO_GRABS: readonly Grab[] = Object.freeze([]);

/** Every grab in `world` (none when pushing is not installed). */
export function grabsOf(world: World<never>): readonly Grab[] {
  if (!world.isRegistered(PushLedgerComponent)) return NO_GRABS;
  let grabs = NO_GRABS;
  world.query(PushLedgerComponent).forEach((_entity, ledger) => {
    grabs = ledger.grabs;
  });
  return grabs;
}

/** What `actor` has hold of, or undefined. */
export function grabOf(world: World<never>, actor: EntityId): Grab | undefined {
  return grabsOf(world).find((grab) => grab.actor === actor);
}

/** Who has hold of `target`, or undefined. */
export function grabberOf(world: World<never>, target: EntityId): Grab | undefined {
  return grabsOf(world).find((grab) => grab.target === target);
}

/** How a pusher's movement is held back. */
export interface PushRestraint {
  /** Share of normal speed, 0…1 (0: the object is blocked, so the pusher stays put too). */
  readonly scale: number;
  /** A pusher may not jump. */
  readonly noJump: boolean;
}

type Planner = (actor: EntityId, move: { readonly x: number; readonly y: number }) => number;

/** The planner installed in each world: what share of speed `actor` keeps for a move input. */
const planners = new WeakMap<object, Planner>();

/** Registers how installed pushing answers `pushRestraint` (installPush only). */
export function setPushPlanner(world: World<never>, planner: Planner): void {
  planners.set(world, planner);
}

/**
 * The restraint on `actor`'s movement from what it pushes, or undefined when it has hold of nothing.
 * `move` is this tick's move stick: a push the object cannot make (a wall or another object behind
 * it) holds the pusher still too, so neither moves and nothing is pushed into the other.
 */
export function pushRestraint(
  world: World<never>,
  actor: EntityId,
  move: { readonly x: number; readonly y: number },
): PushRestraint | undefined {
  if (grabOf(world, actor) === undefined) return undefined;
  // A grab only exists where installPush ran, and that registered the planner.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { scale: planners.get(world)!(actor, move), noJump: true };
}

/** An actor took hold of an object (`push.grabbed`). */
export interface PushGrabbed {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly weight: number;
  /** The fastest the object moves for this actor on this surface, m/s. */
  readonly speed: number;
}
export const pushGrabbed = defineEvent<PushGrabbed>('push.grabbed');

/** Why a grab ended. */
export type PushReleaseReason = 'released' | 'lost' | 'far' | 'staggered' | 'exit' | 'saved';

/** An actor let go of an object, or lost it (`push.released`). */
export interface PushReleased {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly reason: PushReleaseReason;
}
export const pushReleased = defineEvent<PushReleased>('push.released');

/** A rotatable object was turned (`rotationChanged`). */
export interface RotationChanged {
  readonly tick: number;
  readonly actor: EntityId;
  readonly target: EntityId;
  /** Degrees it was turned by. */
  readonly step: number;
  /** Degrees it has been turned in total, 0…360. */
  readonly angle: number;
}
export const rotationChanged = defineEvent<RotationChanged>('rotationChanged');

/** Why a grab was refused. */
export type PushRefusal = 'not-pushable' | 'hands-full' | 'held' | 'too-heavy';

/** The prompt text of each refusal. */
export const PUSH_REFUSAL_TEXT: Readonly<Record<PushRefusal, string>> = Object.freeze({
  'not-pushable': 'Not pushable',
  'hands-full': 'Hands full',
  held: 'Held',
  'too-heavy': 'Too heavy',
});
