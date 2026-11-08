// What the carry rules keep in the world (mw-e02.17): who holds what, as one snapshotted ledger, and
// the marker that makes an object a shoulder-carry. Kept apart from the rules (carry.ts) so the
// player's movement can read a carrier's restraint without depending on them.
//
// The ledger lives on one entity (made when carrying is installed) so a pick-up or a release takes
// effect at once inside a tick, and so a snapshot, a state hash and a replay carry every hold.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';

/** How an object is carried: in the hands (light enough to keep moving) or on the shoulder (bulky). */
export type CarryMode = 'hand' | 'shoulder';

/** One hold: an actor carrying an object (a row of `carry.ledger`). */
export interface Hold {
  readonly actor: EntityId;
  readonly target: EntityId;
  readonly mode: CarryMode;
  /** Tick it was picked up. */
  readonly since: number;
  /** Share of normal speed the carrier keeps, 0…1 (no sprint at all while carrying). */
  readonly speedScale: number;
  /** The carrier may not jump. */
  readonly noJump: boolean;
  /** Ticks the throw button has been held, or −1 when no throw is being charged. */
  readonly charge: number;
  /** Ticks the object has been burning in the hands. */
  readonly burning: number;
}

/** Every hold, ascending actor id (`carry.ledger`; a snapshot key, never renamed). */
export interface CarryLedger {
  readonly holds: readonly Hold[];
}

export const CarryLedgerComponent = defineComponent<CarryLedger>('carry.ledger');

/**
 * An object that is carried on the shoulder and may be heavier than a hand-carry (`carry.bulky`): a
 * body, a statue part. `kind` says what for the people reading a save; the rules only read that it is
 * there. ADR-0003 names this a world property; it stays a component until a property schema bump is
 * worth it (a body gets it when it falls, mw-e10.5).
 */
export interface Bulky {
  readonly kind: string;
}

export const CarryBulkyComponent = defineComponent<Bulky>('carry.bulky');

const NO_HOLDS: readonly Hold[] = Object.freeze([]);

/** Every hold in `world` (none when carrying is not installed). */
export function holdsOf(world: World<never>): readonly Hold[] {
  if (!world.isRegistered(CarryLedgerComponent)) return NO_HOLDS;
  let holds = NO_HOLDS;
  world.query(CarryLedgerComponent).forEach((_entity, ledger) => {
    holds = ledger.holds;
  });
  return holds;
}

/** What `actor` is carrying, or undefined. */
export function holdOf(world: World<never>, actor: EntityId): Hold | undefined {
  return holdsOf(world).find((hold) => hold.actor === actor);
}

/** Who carries `target`, or undefined. */
export function holderOf(world: World<never>, target: EntityId): Hold | undefined {
  return holdsOf(world).find((hold) => hold.target === target);
}

/** How a carrier's movement is held back. */
export interface CarryRestraint {
  /** Share of normal speed, 0…1. */
  readonly scale: number;
  readonly noJump: boolean;
}

/** The restraint on `actor`'s movement from what it carries, or undefined when it carries nothing. */
export function carryRestraint(world: World<never>, actor: EntityId): CarryRestraint | undefined {
  const hold = holdOf(world, actor);
  return hold === undefined ? undefined : { scale: hold.speedScale, noJump: hold.noJump };
}

/** What a grab was for: a ladder, rope or ivy (`climb`) or a ledge (`ledge`). */
export type GrabKind = 'climb' | 'ledge';

/** A grab refused because the carrier's hands are full (ADR-0003: the prompt reads "Hands full"). */
export interface GrabRefused {
  readonly tick: number;
  readonly actor: EntityId;
  readonly grab: GrabKind;
  readonly reason: 'hands-full';
}

/** Fired once as a carrier presses into something it may not grab (`carry.grabRefused`). */
export const grabRefused = defineEvent<GrabRefused>('carry.grabRefused');

/** The last tick each actor's grab was refused, per world: a held press is one refusal, not sixty. */
const lastRefusal = new WeakMap<object, Map<EntityId, number>>();

/**
 * Whether `actor` may not grab a ladder, rope, ivy or ledge because it carries something. Emits
 * `grabRefused` when the refusal begins (not on every tick a press goes on). Climbing and ledge hooks
 * call this where they would start a grab.
 */
export function refuseGrab(
  world: World<never>,
  actor: EntityId | undefined,
  grab: GrabKind,
): boolean {
  if (actor === undefined || holdOf(world, actor) === undefined) return false;
  let ticks = lastRefusal.get(world);
  if (ticks === undefined) {
    ticks = new Map();
    lastRefusal.set(world, ticks);
  }
  const last = ticks.get(actor);
  ticks.set(actor, world.tick);
  if (last === undefined || world.tick - last > 1) {
    world.events.emit(grabRefused, { tick: world.tick, actor, grab, reason: 'hands-full' });
  }
  return true;
}
