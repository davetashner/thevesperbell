// Bow and quiver state (mw-e05.3): the bow an archer carries, whether it is out, the arrow type
// selected and the draw in progress; and the quiver of arrows it shoots. Plain frozen data, replaced
// never mutated, so snapshots, saves and replays carry an archer mid-draw.
//
// The quiver is a stand-in for the inventory (mw-e17.3): arrow counts by type, in the order the cycle
// input steps through them. When the inventory lands, the quiver's slots become a view of its arrow
// stacks and `takeArrow` / `returnArrow` its remove / add.

import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { ActionInputComponent } from '../timeline/components';

/** A draw in progress. */
export interface BowDraw {
  /** Arrow content id of the nocked arrow (already taken from the quiver). */
  readonly arrow: string;
  /** Ticks drawn: 0 on the tick fire was pressed, +1 every tick it stays held. */
  readonly ticks: number;
  /** World tick the draw started on. */
  readonly startedAt: number;
}

/** One archer's bow. */
export interface BowState {
  /** Bow content id (its RuntimeBow in the bow system's table). */
  readonly bow: string;
  /** The bow is out: fire draws it (and the primary attack button does not start the melee move). */
  readonly equipped: boolean;
  /** Arrow content id the next draw nocks. */
  readonly selected: string;
  /** The draw in progress, or null. */
  readonly draw: BowDraw | null;
  /**
   * The move the primary attack started before the bow came out (the knight's light attack), put
   * back when the bow is put away; null when it started none.
   */
  readonly stowed: string | null;
}

/** Arrows of one type in the quiver. */
export interface QuiverSlot {
  readonly arrow: string;
  /** Whole arrows, ≥ 0 (an empty slot stays, so its type can still be selected). */
  readonly count: number;
}

/** One archer's quiver. */
export interface Quiver {
  /** In cycle order. */
  readonly slots: readonly QuiverSlot[];
}

/** The bow component (`combat.bow`; a snapshot and save key, never renamed). */
export const BowComponent = defineComponent<BowState>('combat.bow');

/** The quiver component (`combat.quiver`; a snapshot and save key, never renamed). */
export const QuiverComponent = defineComponent<Quiver>('combat.quiver');

/** Every bow component, for `world.register(...BOW_COMPONENTS)`. */
export const BOW_COMPONENTS = Object.freeze([BowComponent, QuiverComponent] as const);

/** What `giveBow` hands an archer. */
export interface BowLoadout {
  /** Bow content id. */
  readonly bow: string;
  /** Arrow counts in cycle order; the first is selected unless `selected` says otherwise. */
  readonly quiver: readonly QuiverSlot[];
  /** Arrow type selected at the start; defaults to the first slot's. */
  readonly selected?: string;
  /** Whether the bow starts out; defaults to false (put away). */
  readonly equipped?: boolean;
}

/**
 * Gives `entity` a bow and a quiver (a bow starting out also takes the primary attack button, see
 * BowState.stowed). Throws for an empty quiver, a count that is not a whole number ≥ 0, a type listed
 * twice or a selected type the quiver does not hold. Adding components is structural, so during a
 * step they exist from the end of the tick.
 */
export function giveBow(world: World<never>, entity: EntityId, loadout: BowLoadout): void {
  const [first] = loadout.quiver;
  if (first === undefined) throw new RangeError('a quiver needs at least one arrow type');
  const seen = new Set<string>();
  for (const { arrow, count } of loadout.quiver) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`quiver count of "${arrow}" must be a whole number ≥ 0`);
    }
    if (seen.has(arrow)) throw new RangeError(`quiver lists "${arrow}" twice`);
    seen.add(arrow);
  }
  const selected = loadout.selected ?? first.arrow;
  if (!seen.has(selected)) throw new RangeError(`the quiver holds no "${selected}" slot`);
  world.add(
    entity,
    QuiverComponent,
    Object.freeze({
      slots: Object.freeze(loadout.quiver.map((slot) => Object.freeze({ ...slot }))),
    }),
  );
  const bow: BowState = Object.freeze({
    bow: loadout.bow,
    equipped: false,
    selected,
    draw: null,
    stowed: null,
  });
  world.add(entity, BowComponent, loadout.equipped === true ? toggledBow(world, entity, bow) : bow);
}

/**
 * `bow` taken out (or, already out, put away), with the primary attack button's move stowed or put
 * back in `entity`'s ActionInput (when it has one). Writes the ActionInput; the caller stores the
 * returned bow. Any draw in progress must be ended first.
 */
export function toggledBow(world: World<never>, entity: EntityId, bow: BowState): BowState {
  const input = world.isRegistered(ActionInputComponent)
    ? world.get(entity, ActionInputComponent)
    : undefined;
  let stowed: string | null = null;
  if (input !== undefined) {
    const { primaryAttack, ...rest } = input.bindings;
    const bindings = bow.equipped
      ? { ...rest, ...(bow.stowed !== null && { primaryAttack: bow.stowed }) }
      : rest;
    if (!bow.equipped) stowed = primaryAttack ?? null;
    world.set(
      entity,
      ActionInputComponent,
      Object.freeze({ ...input, bindings: Object.freeze(bindings) }),
    );
  }
  return Object.freeze({ ...bow, equipped: !bow.equipped, draw: null, stowed });
}

/** Arrows of type `arrow` in `entity`'s quiver (0 without a quiver or that type). */
export function quiverCount(world: World<never>, entity: EntityId, arrow: string): number {
  const slots = world.get(entity, QuiverComponent)?.slots ?? [];
  return slots.find((slot) => slot.arrow === arrow)?.count ?? 0;
}

/** `quiver` with `delta` arrows of type `arrow` (the slot exists). */
function adjusted(quiver: Quiver, arrow: string, delta: number): Quiver {
  return Object.freeze({
    slots: Object.freeze(
      quiver.slots.map((slot) =>
        slot.arrow === arrow ? Object.freeze({ arrow, count: slot.count + delta }) : slot,
      ),
    ),
  });
}

/** Takes one `arrow` from `entity`'s quiver; false (and nothing changes) when it has none. */
export function takeArrow(world: World<never>, entity: EntityId, arrow: string): boolean {
  const quiver = world.get(entity, QuiverComponent);
  if (quiver === undefined || quiverCount(world, entity, arrow) === 0) return false;
  world.set(entity, QuiverComponent, adjusted(quiver, arrow, -1));
  return true;
}

/** Puts one `arrow` back into `entity`'s quiver (a cancelled draw); no-op without that slot. */
export function returnArrow(world: World<never>, entity: EntityId, arrow: string): void {
  const quiver = world.get(entity, QuiverComponent);
  if (!quiver?.slots.some((slot) => slot.arrow === arrow)) return;
  world.set(entity, QuiverComponent, adjusted(quiver, arrow, 1));
}

/**
 * Puts `count` whole arrows of type `arrow` into `entity`'s quiver (arrows taken back from the world,
 * mw-e05.7), adding the slot when the quiver has none of that type. False (and nothing changes)
 * without a quiver.
 */
export function addArrows(
  world: World<never>,
  entity: EntityId,
  arrow: string,
  count: number,
): boolean {
  const quiver = world.get(entity, QuiverComponent);
  if (quiver === undefined) return false;
  if (quiver.slots.some((slot) => slot.arrow === arrow)) {
    world.set(entity, QuiverComponent, adjusted(quiver, arrow, count));
  } else {
    world.set(
      entity,
      QuiverComponent,
      Object.freeze({ slots: Object.freeze([...quiver.slots, Object.freeze({ arrow, count })]) }),
    );
  }
  return true;
}
