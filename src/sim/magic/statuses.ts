// Statuses (mw-e06.9): buffs, debuffs and conditions defined as content (`status` entries) and kept
// on the spell-status ledger. What a status *does* is data: its stack rule, dispel tags, stat
// modifiers, tick damage and break conditions. Nothing here names a status or a spell.
//
//   apply   — `applyStatus` follows the definition's stack rule: `refresh` restarts the clock (one
//             stack), `stack` adds a stack up to its max and restarts the clock, `keep` leaves the
//             first application standing. A status with no definition keeps the original ledger
//             behaviour (stacks add up to 99, longest expiry wins).
//   end     — each tick the `spells` system ends a status that expired; whose target is gone; whose
//             source is gone when it is `sourceBound`; or one of whose `breakWhen` property tests
//             holds. Break tests read world properties through the one property API ("the restraining
//             entity is burning"), never a pairwise rule. A source removed between steps ends its
//             statuses in the very next tick; one destroyed during a step is gone when that tick's
//             changes apply, so it ends in the next system pass.
//   dispel  — `dispelStatuses` removes every status on a target carrying a tag, nothing else.
//   tick    — a definition's damage ops run through the pipeline's op registry every interval.
//   read    — `modifiedStat` folds the modifiers of every status on an entity into a stat.
//
// Every end is reported once as `StatusEnded` with its reason, every tick as `StatusTicked`.

import type { StatusEntry, StatusModifierStat } from '@content/index';
import type { DamageModel } from '../combat/damage';
import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import type { AiNavigation, TravelRequest } from '../ai/navigation';
import { readProperty } from '../properties/components';
import type { WorldPropertyKey } from '../properties/spec';
import { placementOf } from '../stimulus/placement';
import {
  MAX_STATUS_STACKS,
  statusLedger,
  StatusLedgerComponent,
  type AppliedStatus,
} from './components';
import type { OpContext, OpRegistry } from './registry';

/** Status id → loaded definition, or undefined. */
export type StatusLookup = (id: string) => StatusEntry | undefined;

/** Why a status left its target. */
export type StatusEndReason = 'expired' | 'source-gone' | 'target-gone' | 'broken' | 'dispelled';

export interface StatusEndedInfo {
  readonly tick: number;
  readonly target: EntityId;
  readonly status: string;
  readonly reason: StatusEndReason;
}
export const StatusEnded = defineEvent<StatusEndedInfo>('StatusEnded');

export interface StatusTickedInfo {
  readonly tick: number;
  readonly target: EntityId;
  readonly status: string;
  readonly source: EntityId;
  /** Damage the tick dealt, summed over its ops. */
  readonly total: number;
}
export const StatusTicked = defineEvent<StatusTickedInfo>('StatusTicked');

/** Whole ticks in `seconds`, at least one. */
function ticksOf(world: World<never>, seconds: number): number {
  return Math.max(1, Math.round(seconds * world.clock.hz));
}

export interface ApplyStatusRequest {
  readonly target: EntityId;
  readonly status: string;
  /** Entity the status belongs to (the caster, or the vine that holds you). */
  readonly source: EntityId;
  readonly seconds: number;
  readonly stacks?: number;
}

/**
 * Applies a status to `target` following `def`'s stack rule and returns the resulting ledger entry.
 * Pass `def` undefined for a status with no definition (the original refresh-and-add behaviour).
 */
export function applyStatus(
  world: World<never>,
  def: StatusEntry | undefined,
  request: ApplyStatusRequest,
): AppliedStatus {
  const [id, ledger] = statusLedger(world);
  const added = request.stacks ?? 1;
  const expiresTick = world.tick + ticksOf(world, request.seconds);
  const held = ledger.entries.find(
    (e) => e.target === request.target && e.status === request.status,
  );
  let next: AppliedStatus;
  if (def === undefined) {
    next = {
      target: request.target,
      status: request.status,
      stacks: Math.min(MAX_STATUS_STACKS, (held?.stacks ?? 0) + added),
      expiresTick: Math.max(held?.expiresTick ?? 0, expiresTick),
      source: request.source,
    };
  } else if (held !== undefined && def.stack.rule === 'keep') {
    return held;
  } else {
    const stacks =
      def.stack.rule === 'stack'
        ? Math.min(def.stack.max ?? 1, (held?.stacks ?? 0) + added)
        : added;
    next = {
      target: request.target,
      status: request.status,
      stacks,
      expiresTick,
      source: request.source,
      ...(def.tick === undefined
        ? {}
        : { nextTickAt: held?.nextTickAt ?? world.tick + ticksOf(world, def.tick.interval) }),
    };
  }
  const entries =
    held === undefined
      ? [...ledger.entries, next]
      : ledger.entries.map((entry) => (entry === held ? next : entry));
  world.set(id, StatusLedgerComponent, { entries });
  return next;
}

/** Removes the entries from the ledger and reports each as ended. */
function endStatuses(
  world: World<never>,
  removed: readonly (readonly [AppliedStatus, StatusEndReason])[],
): void {
  if (removed.length === 0) return;
  const [id, ledger] = statusLedger(world);
  const gone = new Set(removed.map(([entry]) => entry));
  world.set(id, StatusLedgerComponent, { entries: ledger.entries.filter((e) => !gone.has(e)) });
  for (const [entry, reason] of removed) {
    world.events.emit(StatusEnded, {
      tick: world.tick,
      target: entry.target,
      status: entry.status,
      reason,
    });
  }
}

/** Whether the entry's definition carries `tag`. */
function tagged(lookup: StatusLookup, entry: AppliedStatus, tag: string): boolean {
  return lookup(entry.status)?.tags.includes(tag) === true;
}

/**
 * Dispels every status on `target` whose definition carries `tag`; statuses without it (and ones with
 * no definition) stay. Returns what was removed, in application order.
 */
export function dispelStatuses(
  world: World<never>,
  lookup: StatusLookup,
  target: EntityId,
  tag: string,
): readonly AppliedStatus[] {
  const hit = statusLedger(world)[1].entries.filter(
    (e) => e.target === target && tagged(lookup, e, tag),
  );
  endStatuses(
    world,
    hit.map((e) => [e, 'dispelled'] as const),
  );
  return hit;
}

/** Whether `target` has any status carrying `tag`. */
export function hasStatusTag(
  world: World<never>,
  lookup: StatusLookup,
  target: EntityId,
  tag: string,
): boolean {
  return statusLedger(world)[1].entries.some((e) => e.target === target && tagged(lookup, e, tag));
}

/**
 * `base` after every status on `target` has modified `stat`: additive modifiers (value × stacks) are
 * summed first, then multiplicative ones (value ^ stacks) are applied.
 */
export function modifiedStat(
  world: World<never>,
  lookup: StatusLookup,
  target: EntityId,
  stat: StatusModifierStat,
  base: number,
): number {
  let add = 0;
  let mul = 1;
  for (const entry of statusLedger(world)[1].entries) {
    if (entry.target !== target) continue;
    for (const m of lookup(entry.status)?.modifiers ?? []) {
      if (m.stat !== stat) continue;
      if (m.mode === 'add') add += m.value * entry.stacks;
      else mul *= m.value ** entry.stacks;
    }
  }
  return (base + add) * mul;
}

/**
 * The fraction of normal speed `entity` moves at under its statuses (`moveSpeed`: slowed, rooted…), 1
 * with none and in a world with no spells installed. Never negative.
 */
export function statusMoveScale(
  world: World<never>,
  lookup: StatusLookup,
  entity: EntityId,
): number {
  if (!world.isRegistered(StatusLedgerComponent)) return 1;
  return Math.max(0, modifiedStat(world, lookup, entity, 'moveSpeed', 1));
}

/** `navigation` with every agent's travel speed scaled by its `moveSpeed` statuses. */
export function statusScaledNavigation(
  navigation: AiNavigation,
  lookup: StatusLookup,
): AiNavigation {
  const scaled = (
    world: World<never>,
    entity: EntityId,
    request: TravelRequest,
  ): TravelRequest => ({
    ...request,
    speed: request.speed * statusMoveScale(world, lookup, entity),
  });
  const { approach } = navigation;
  return {
    ...navigation,
    travel: (world, entity, request) =>
      navigation.travel(world, entity, scaled(world, entity, request)),
    ...(approach !== undefined && {
      approach: (world: World<never>, entity: EntityId, request: TravelRequest) =>
        approach.call(navigation, world, entity, scaled(world, entity, request)),
    }),
  };
}

type BreakTest = StatusEntry['breakWhen'][number];

function holds(test: BreakTest, actual: unknown): boolean {
  switch (test.is) {
    case 'eq':
      return actual === test.value;
    case 'ne':
      return actual !== test.value;
    case 'gte':
      return typeof actual === 'number' && actual >= Number(test.value);
    case 'lte':
      return typeof actual === 'number' && actual <= Number(test.value);
  }
}

function broken(world: World<never>, entry: AppliedStatus, def: StatusEntry): boolean {
  return def.breakWhen.some((test) => {
    const entity = test.entity === 'source' ? entry.source : entry.target;
    if (!world.isAlive(entity)) return false;
    // The schema only admits canonical property keys.
    return holds(test, readProperty(world, entity, test.property as WorldPropertyKey));
  });
}

/** What the status pass needs to run tick ops. */
export interface StatusRuntime {
  readonly lookup: StatusLookup;
  readonly ops: OpRegistry;
  readonly damage: DamageModel;
}

/**
 * One pass over the ledger for the current tick: ends expired, orphaned and broken statuses, then
 * runs due tick ops. Called by the `spells` system.
 */
export function updateStatuses(world: World<never>, runtime: StatusRuntime): void {
  const tick = world.tick;
  const ending: (readonly [AppliedStatus, StatusEndReason])[] = [];
  for (const entry of statusLedger(world)[1].entries) {
    const def = runtime.lookup(entry.status);
    if (entry.expiresTick <= tick) ending.push([entry, 'expired']);
    else if (!world.isAlive(entry.target)) ending.push([entry, 'target-gone']);
    else if (def?.sourceBound === true && !world.isAlive(entry.source)) {
      ending.push([entry, 'source-gone']);
    } else if (def !== undefined && broken(world, entry, def)) ending.push([entry, 'broken']);
  }
  endStatuses(world, ending);

  const due = statusLedger(world)[1].entries.flatMap((entry) => {
    const tickDef = runtime.lookup(entry.status)?.tick;
    return tickDef !== undefined && (entry.nextTickAt ?? Infinity) <= tick
      ? [[entry, tickDef] as const]
      : [];
  });
  for (const [entry, tickDef] of due) {
    const ctx: OpContext = {
      world,
      caster: world.isAlive(entry.source) ? entry.source : entry.target,
      target: entry.target,
      point: placementOf(world, entry.target) ?? { x: 0, y: 0, z: 0 },
      delivery: entry.source,
      damage: runtime.damage,
      statuses: runtime.lookup,
    };
    let total = 0;
    for (const op of tickDef.ops) {
      const dealt = runtime.ops.require(op.op)(ctx, op)?.['total'];
      if (typeof dealt === 'number') total += dealt;
    }
    const [id, current] = statusLedger(world);
    const nextTickAt = tick + ticksOf(world, tickDef.interval);
    world.set(id, StatusLedgerComponent, {
      entries: current.entries.map((e) => (e === entry ? { ...e, nextTickAt } : e)),
    });
    world.events.emit(StatusTicked, {
      tick,
      target: entry.target,
      status: entry.status,
      source: entry.source,
      total,
    });
  }
}
