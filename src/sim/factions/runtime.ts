// Factions in the world (mw-e12.8): who belongs where, and what play has changed. Two components,
// both plain data and so part of snapshots, state hashes and saves:
//
// - `faction.member` on each creature (and the player): its faction plus per-creature overrides
//   (`toward`, keyed by faction id or `player`), e.g. the one goblin who likes the player, or
//   Brother Horn once befriended.
// - `faction.stances` on one holder entity made by `installFactions`: faction-wide changes caused
//   by play, as [from, to, stance] rows sorted by (from, to). Only stances that differ from the
//   base table are stored; setting a stance back to its base removes the row.
//
// `relation(a, b)` answers "how does a regard b?" for perception, alerts and combat: a's own
// override toward b's faction, else the faction-wide stance (changed, else base). Every change of a
// faction-wide stance emits FactionRelationChanged once. The witnessed-kill rule is the first thing
// that changes stances: killing a member in front of its kin worsens the kin's faction one step
// toward the killer's. Perception (e11) decides who witnessed; this module only applies the rule.

import type { GameEntry } from '@content/index';
import { Died, type Death } from '../combat/damage/events';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { improveStance, isFriendlyStance, isStance, worsenStance, type Stance } from './stance';
import { PLAYER_FACTION, UNALIGNED_FACTION, type FactionTable } from './table';

/** A creature's (or the player's) faction and its own stances that override the faction's. */
export interface FactionMembership {
  readonly faction: string;
  /** Faction id (or `player`) → this individual's stance toward members of it. */
  readonly toward: Readonly<Record<string, Stance>>;
}

/** One faction-wide change: `from`'s stance toward `to` (a faction id or `player`). */
export type FactionStanceRow = readonly [from: string, to: string, stance: Stance];

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '';

function restoreMembership(data: unknown): FactionMembership {
  const m = data as Partial<Record<string, unknown>> | null;
  const toward = m?.['toward'];
  if (
    !isId(m?.['faction']) ||
    typeof toward !== 'object' ||
    toward === null ||
    Array.isArray(toward) ||
    !Object.values(toward).every(isStance)
  ) {
    throw new RangeError('faction membership must be { faction: id, toward: { id: stance } }');
  }
  return freezeMembership(m['faction'], toward as Record<string, Stance>);
}

function freezeMembership(faction: string, toward: Readonly<Record<string, Stance>>) {
  // Default sort is UTF-16 code-unit order: locale-independent, so equal worlds hash equal.
  const sorted = Object.fromEntries(
    Object.keys(toward)
      .sort()
      .map((key) => [key, toward[key]]),
  ) as Record<string, Stance>;
  return Object.freeze({ faction, toward: Object.freeze(sorted) });
}

/** Sort key of a row: from, then to (ids are non-empty, and U+0000 sorts before any character). */
const rowKey = (row: FactionStanceRow) => `${row[0]}\u0000${row[1]}`;

/** Code-unit order of row keys (unique, so never equal); locale-independent. */
const byRowKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]) =>
  a < b ? -1 : 1;

/** Rows in (from, to) order, frozen; throws if a (from, to) pair appears twice. */
function freezeRows(rows: readonly FactionStanceRow[]): readonly FactionStanceRow[] {
  const byKey = new Map(rows.map((row) => [rowKey(row), row]));
  if (byKey.size !== rows.length) throw new RangeError('a faction stance is stored twice');
  return Object.freeze(
    [...byKey].sort(byRowKey).map(([, row]) => Object.freeze([...row] as const)),
  );
}

function restoreRows(data: unknown): readonly FactionStanceRow[] {
  const valid =
    Array.isArray(data) &&
    data.every(
      (r) => Array.isArray(r) && r.length === 3 && isId(r[0]) && isId(r[1]) && isStance(r[2]),
    );
  if (!valid) throw new RangeError('faction stances must be [from, to, stance] rows');
  return freezeRows(data as FactionStanceRow[]);
}

/** Faction membership (`faction.member`; a snapshot and save key, never renamed). */
export const FactionMemberComponent = defineComponent<FactionMembership>('faction.member', {
  deserialize: restoreMembership,
});

/** Faction-wide changes caused by play (`faction.stances`; a snapshot and save key, never renamed). */
export const FactionStancesComponent = defineComponent<readonly FactionStanceRow[]>(
  'faction.stances',
  { deserialize: restoreRows },
);

/** Payload of FactionRelationChanged. */
export interface FactionRelationChange {
  readonly tick: number;
  /** The faction whose stance changed. */
  readonly from: string;
  /** Toward whom: a faction id or `player`. */
  readonly to: string;
  readonly before: Stance;
  readonly after: Stance;
  /** Why, e.g. `witnessed-kill`, or a quest's own reason (`horn-befriended`). */
  readonly cause: string;
}

/** A faction-wide stance changed (AI re-evaluates targets; UI, dialogue and quests can react). */
export const FactionRelationChanged = defineEvent<FactionRelationChange>('FactionRelationChanged');

/**
 * Makes `world` track factions: registers both components and spawns the entity that holds the
 * faction-wide stances. Call once at setup, outside a step (a restored snapshot brings its own).
 */
export function installFactions<W extends World<never>>(world: W): W {
  world.register(FactionMemberComponent, FactionStancesComponent);
  world.add(world.spawn(), FactionStancesComponent, freezeRows([]));
  return world;
}

/** The entity holding the faction-wide stances, and those stances. */
function holder(world: World<never>): {
  readonly id: EntityId;
  readonly rows: readonly FactionStanceRow[];
} {
  let found: { id: EntityId; rows: readonly FactionStanceRow[] } | undefined;
  world.query(FactionStancesComponent).forEach((id, rows) => {
    found = { id, rows };
  });
  if (found === undefined) throw new Error('factions are not installed (call installFactions)');
  return found;
}

function requireFaction(table: FactionTable, id: string): void {
  if (!table.has(id)) throw new RangeError(`unknown faction "${id}"`);
}

/**
 * Makes `entity` a member of `faction` (a faction id, or `PLAYER_FACTION` for the player), with its
 * own overriding stances. Replaces any membership it had. Adding the component is structural, so
 * during a step it applies at the end of the tick.
 */
export function joinFaction(
  world: World<never>,
  table: FactionTable,
  entity: EntityId,
  faction: string,
  toward: Readonly<Record<string, Stance>> = {},
): void {
  requireFaction(table, faction);
  for (const id of Object.keys(toward)) requireFaction(table, id);
  world.add(entity, FactionMemberComponent, freezeMembership(faction, toward));
}

/** The membership a creature definition describes: its faction and its stance toward the player. */
export function membershipFromCreature(
  creature: Pick<GameEntry<'creature'>, 'faction' | 'disposition'>,
): {
  readonly faction: string;
  readonly toward: Readonly<Record<string, Stance>>;
} {
  const towardPlayer = creature.disposition.towardPlayer;
  return {
    faction: creature.faction?.id ?? UNALIGNED_FACTION,
    toward: towardPlayer === undefined ? {} : { [PLAYER_FACTION]: towardPlayer },
  };
}

/** `entity`'s faction, or undefined when it belongs to none (props, projectiles). */
export function factionOf(world: World<never>, entity: EntityId): string | undefined {
  return world.get(entity, FactionMemberComponent)?.faction;
}

/** Faction `from`'s current stance toward `to` (a faction id or `player`): changed, else base. */
export function factionStance(
  world: World<never>,
  table: FactionTable,
  from: string,
  to: string,
): Stance {
  const base = table.base(from, to);
  const row = holder(world).rows.find(([f, t]) => f === from && t === to);
  return row === undefined ? base : row[2];
}

/**
 * How `a` regards `b`: a's own override toward b's faction, else a's faction's current stance
 * toward it. Either side without a faction (a crate, an arrow) → neutral.
 */
export function relation(
  world: World<never>,
  table: FactionTable,
  a: EntityId,
  b: EntityId,
): Stance {
  const self = world.get(a, FactionMemberComponent);
  const other = world.get(b, FactionMemberComponent);
  if (self === undefined || other === undefined) return 'neutral';
  return self.toward[other.faction] ?? factionStance(world, table, self.faction, other.faction);
}

/**
 * How `entity` regards the player: its own override, else its faction's current stance toward
 * `player`; undefined when it belongs to no faction.
 */
export function stanceTowardPlayer(
  world: World<never>,
  table: FactionTable,
  entity: EntityId,
): Stance | undefined {
  const self = world.get(entity, FactionMemberComponent);
  if (self === undefined) return undefined;
  return self.toward[PLAYER_FACTION] ?? factionStance(world, table, self.faction, PLAYER_FACTION);
}

/** Whether `entity` is an ally or friend of the player (a shopkeeper, the Watch), now. */
export function isFriendlyToPlayer(
  world: World<never>,
  table: FactionTable,
  entity: EntityId,
): boolean {
  const stance = stanceTowardPlayer(world, table, entity);
  return stance !== undefined && isFriendlyStance(stance);
}

/**
 * Sets faction `from`'s stance toward `to` (a faction id or `player`). Returns whether it changed;
 * a change emits FactionRelationChanged once. The player's own row cannot be set.
 */
export function setFactionStance(
  world: World<never>,
  table: FactionTable,
  from: string,
  to: string,
  stance: Stance,
  cause: string,
): boolean {
  if (from === PLAYER_FACTION) throw new RangeError('the player has no faction-wide stance');
  const before = factionStance(world, table, from, to);
  if (before === stance) return false;
  const { id, rows: current } = holder(world);
  const others = current.filter(([f, t]) => f !== from || t !== to);
  const rows = stance === table.base(from, to) ? others : [...others, [from, to, stance] as const];
  world.set(id, FactionStancesComponent, freezeRows(rows));
  world.events.emit(FactionRelationChanged, {
    tick: world.tick,
    from,
    to,
    before,
    after: stance,
    cause,
  });
  return true;
}

/** Moves `from`'s stance toward `to` one step colder (see `worsenStance`); returns whether it changed. */
export function worsenFactionStance(
  world: World<never>,
  table: FactionTable,
  from: string,
  to: string,
  cause: string,
): boolean {
  const next = worsenStance(factionStance(world, table, from, to));
  return setFactionStance(world, table, from, to, next, cause);
}

/** Moves `from`'s stance toward `to` one step warmer (see `improveStance`); returns whether it changed. */
export function improveFactionStance(
  world: World<never>,
  table: FactionTable,
  from: string,
  to: string,
  cause: string,
): boolean {
  const next = improveStance(factionStance(world, table, from, to));
  return setFactionStance(world, table, from, to, next, cause);
}

/** A kill and who saw it. */
export interface WitnessedKill {
  readonly victim: EntityId;
  readonly killer: EntityId;
  /** Entities that perceived the kill (perception decides; the victim and killer are ignored). */
  readonly witnesses: readonly EntityId[];
}

/** Cause of the stance change the witnessed-kill rule makes. */
export const WITNESSED_KILL = 'witnessed-kill';

/**
 * The witnessed-kill rule: when a member of faction A is killed by a member of another faction K
 * (or the player) and at least one other member of A saw it, A's stance toward K worsens one step —
 * once, however many witnesses. Returns whether a stance changed.
 */
export function applyWitnessedKill(
  world: World<never>,
  table: FactionTable,
  kill: WitnessedKill,
): boolean {
  const victims = factionOf(world, kill.victim);
  const killers = factionOf(world, kill.killer);
  if (victims === undefined || killers === undefined || victims === killers) return false;
  const seen = kill.witnesses.some(
    (w) => w !== kill.victim && w !== kill.killer && factionOf(world, w) === victims,
  );
  return seen && worsenFactionStance(world, table, victims, killers, WITNESSED_KILL);
}

/**
 * Runs the witnessed-kill rule on every `Died` with a killer, asking `witnessesOf` who saw it
 * (perception, e11). Returns the unsubscribe function.
 */
export function factionKillRule(
  world: World<never>,
  table: FactionTable,
  witnessesOf: (world: World<never>, death: Death) => readonly EntityId[],
): () => void {
  return world.events.on(Died, (death) => {
    if (death.killer === null) return;
    applyWitnessedKill(world, table, {
      victim: death.target,
      killer: death.killer,
      witnesses: witnessesOf(world, death),
    });
  });
}
