// Spell state (mw-e06.2): what a caster knows, the delivery entity a cast creates, and the statuses
// spells have applied. All plain data, snapshot-safe, and part of every state hash.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { CastSource } from './events';

/** Spells an entity has learned (`magic.known`; a snapshot and save key, never renamed). */
export interface KnownSpells {
  readonly spells: readonly string[];
}
export const KnownSpellsComponent = defineComponent<KnownSpells>('magic.known');

/**
 * A spell in flight (`magic.delivery`): created when a cast starts, and removed once its effects
 * have landed (the tick of the cast for self and touch; later for projectiles and beams).
 */
export interface SpellDeliveryState {
  readonly spell: string;
  readonly caster: EntityId;
  readonly kind: string;
  readonly source: CastSource;
  /** Tick the cast started. */
  readonly spawned: number;
}
export const SpellDeliveryComponent = defineComponent<SpellDeliveryState>('magic.delivery');

/** A status a spell applied to an entity. */
export interface AppliedStatus {
  readonly target: EntityId;
  readonly status: string;
  readonly stacks: number;
  /** First tick the status is gone. */
  readonly expiresTick: number;
  readonly source: EntityId;
}

/**
 * Every status spells applied, in application order (`magic.statuses`, on one ledger entity).
 * Applying a status the target already has refreshes it (longest expiry, stacks added up to the
 * cap); richer rules, dispel and effects of statuses belong to the status system (mw-e06.9), which
 * reads and replaces this ledger.
 */
export interface StatusLedger {
  readonly entries: readonly AppliedStatus[];
}
export const StatusLedgerComponent = defineComponent<StatusLedger>('magic.statuses');

/** Most stacks of one status on one target. */
export const MAX_STATUS_STACKS = 99;

/** Every component the spell pipeline uses. */
export const MAGIC_COMPONENTS = [
  KnownSpellsComponent,
  SpellDeliveryComponent,
  StatusLedgerComponent,
] as const;

/** Makes `caster` know `spell` (idempotent). Outside a step, or on a caster that already knows spells. */
export function learnSpell(world: World<never>, caster: EntityId, spell: string): void {
  const known = world.get(caster, KnownSpellsComponent);
  if (known === undefined) {
    world.add(caster, KnownSpellsComponent, { spells: [spell] });
  } else if (!known.spells.includes(spell)) {
    world.set(caster, KnownSpellsComponent, { spells: [...known.spells, spell] });
  }
}

/** Whether `caster` has learned `spell`. */
export function knowsSpell(world: World<never>, caster: EntityId, spell: string): boolean {
  return world.get(caster, KnownSpellsComponent)?.spells.includes(spell) ?? false;
}

/** The ledger's entity and value; throws when the spell pipeline is not installed. */
export function statusLedger(world: World<never>): readonly [EntityId, StatusLedger] {
  const found: (readonly [EntityId, StatusLedger])[] = [];
  world.query(StatusLedgerComponent).forEach((id, ledger) => found.push([id, ledger]));
  const first = found[0];
  if (first === undefined) throw new Error('spells are not installed in this world');
  return first;
}

/** Statuses currently on `target`, in application order. */
export function spellStatusesOf(world: World<never>, target: EntityId): readonly AppliedStatus[] {
  return statusLedger(world)[1].entries.filter((entry) => entry.target === target);
}
