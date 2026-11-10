// Ownership and theft (mw-e27.9): who a thing in the world belongs to, and a record of what was
// taken from them. A world item or a container carries an owner tag (`ownership.owner`: the owning
// faction or NPC id, and the level and spot it stands at); a scene spawn's `owner` field puts it
// there. Ownership is a plain property of the thing, never a pairwise script.
//
// - Taking: the permission predicate decides whether an actor may take what an owned thing holds
//   (default: the owner itself; the game can pass a wider rule). Without permission, the units that
//   leave the thing are flagged `stolen` with the owner's id on their inventory instance, and a theft
//   is recorded as world facts (AC-1). An unowned thing, or one the actor may take from, flags nothing
//   (AC-4); so does a purchase or a gift, which never come from an owned thing without consent (AC-2).
//   Units already flagged stolen stay stolen, and taking them back off the floor is not a new theft.
// - A theft is the entity-scoped facts `entity:<level>/theft-<n>.theft.*` (src/content/data/fact/
//   ownership.json): owner, item, units, where, when, and `witnessed`, which stays `unknown` until
//   whoever resolves witnesses (the AI, e10/e11) calls `resolveWitness`. `ownership.thefts` counts
//   them, so ids are deterministic and every fact saves with the world (AC-5), like the flag.
// - Returning: a stolen stack put into a container of the owner it was stolen from clears the flag on
//   those units and resolves the oldest open thefts of that owner and item to `returned` (AC-3).
// - `ownership.theft` and `ownership.returned` events let witness resolution and reactions follow.
//
// Out of scope here: noticing a theft (witnesses, e10/e11), fences and prices (e20), and what an owner
// does about it. What counts as a witness is therefore left to whoever emits `resolveWitness`.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { entityFactKey } from '../facts/store';
import type { ItemInstanceFlags } from '../inventory/inventory';
import { SceneSpawnComponent } from '../scene/loader';

/** Whom a thing belongs to and where it is (`ownership.owner`; a snapshot key, never renamed). */
export interface OwnerTag {
  /** The owning faction or NPC id. */
  readonly owner: string;
  /** The level the thing stands in. */
  readonly level: string;
  /** Where in the level: the spawn id of the thing. */
  readonly place: string;
}

export const OwnerComponent = defineComponent<OwnerTag>('ownership.owner');

/** The level a thing's thefts are filed under when its scene is not known. */
export const UNKNOWN_LEVEL = 'world';

/** Whether `actor` may take what `owner`'s things hold without it being theft. */
export type PermissionCheck = (world: World<never>, actor: EntityId, owner: string) => boolean;

/** The default rule: only the owner itself (an actor whose scene spawn id is the owner's) may. */
export const isOwnerActor: PermissionCheck = (world, actor, owner) =>
  world.isRegistered(SceneSpawnComponent) && world.get(actor, SceneSpawnComponent)?.id === owner;

/** The name of the fact counting every theft ever recorded. */
export const THEFT_COUNT_FACT = 'ownership.thefts';

/** How sure the world is that someone saw a theft. */
export const WITNESSED_VALUES = ['unknown', 'seen', 'unseen'] as const;
export type Witnessed = (typeof WITNESSED_VALUES)[number];

/** Where a theft stands. */
export const THEFT_STATUSES = ['stolen', 'returned'] as const;
export type TheftStatus = (typeof THEFT_STATUSES)[number];

/** A theft's address: the level it happened in and its entity id there (`theft-<n>`). */
export interface TheftRef {
  readonly level: string;
  readonly id: string;
}

/** One theft as read back from the facts. */
export interface Theft extends TheftRef {
  readonly owner: string;
  readonly item: string;
  /** Units still unreturned. */
  readonly units: number;
  /** The spot it was taken from (a spawn id). */
  readonly place: string;
  readonly tick: number;
  readonly witnessed: Witnessed;
  readonly status: TheftStatus;
}

/** A theft was recorded. */
export interface TheftRecorded extends TheftRef {
  readonly tick: number;
  readonly thief: EntityId;
  readonly owner: string;
  readonly item: string;
  readonly count: number;
  readonly place: string;
  /** Always `unknown`: witness resolution is the AI's (see `resolveWitness`). */
  readonly witnessed: 'unknown';
}

/** Stolen units went back to their owner. */
export interface TheftReturned extends TheftRef {
  readonly tick: number;
  readonly actor: EntityId;
  readonly owner: string;
  readonly item: string;
  /** Units this return covered. */
  readonly count: number;
  /** True when the theft is now fully returned, false when units are still out. */
  readonly resolved: boolean;
}

export const theftRecorded = defineEvent<TheftRecorded>('ownership.theft');
export const theftReturned = defineEvent<TheftReturned>('ownership.returned');

/** Tags `entity` as owned. */
export function tagOwner(world: World<never>, entity: EntityId, tag: OwnerTag): void {
  if (!world.isRegistered(OwnerComponent)) world.register(OwnerComponent);
  world.add(entity, OwnerComponent, Object.freeze({ ...tag }));
}

/** The owner tag of `entity`, if it has one. */
export function ownerOf(world: World<never>, entity: EntityId): OwnerTag | undefined {
  return world.isRegistered(OwnerComponent) ? world.get(entity, OwnerComponent) : undefined;
}

const factOf = (ref: TheftRef, name: string): string =>
  entityFactKey(ref.level, ref.id, `theft.${name}`);

/** What leaves an owned thing. */
export interface Take {
  readonly item: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
}

/**
 * The owner tag of `entity` when taking `take` from it is a theft by `actor`: it is owned, the actor
 * has no permission and the units are not already stolen (taking stolen goods off the floor again is
 * the same theft). Reads only.
 */
export function theftTag(
  world: World<never>,
  actor: EntityId,
  entity: EntityId,
  take: Take,
  permits: PermissionCheck = isOwnerActor,
): OwnerTag | undefined {
  const tag = ownerOf(world, entity);
  if (tag === undefined || take.flags.stolen === true || permits(world, actor, tag.owner)) {
    return undefined;
  }
  return tag;
}

/** The flags the units carry once stolen from `tag`'s owner (what `recordTheft` records). */
export const stolenFlags = (flags: ItemInstanceFlags, tag: OwnerTag): ItemInstanceFlags => ({
  ...flags,
  stolen: true,
  ownerId: tag.owner,
});

/**
 * Records the theft of `take` from `tag`'s thing by `actor` as facts and fires `ownership.theft`
 * (call once the units have really changed hands). Returns the theft's address.
 */
export function recordTheft(
  world: World<never>,
  actor: EntityId,
  tag: OwnerTag,
  take: Take,
): TheftRef {
  const n = world.facts.increment(THEFT_COUNT_FACT);
  const ref: TheftRef = { level: tag.level, id: `theft-${String(n)}` };
  const { facts, tick } = world;
  facts.transaction(() => {
    facts.set(factOf(ref, 'owner'), tag.owner);
    facts.set(factOf(ref, 'item'), take.item);
    facts.set(factOf(ref, 'units'), take.count);
    facts.set(factOf(ref, 'place'), tag.place);
    facts.set(factOf(ref, 'tick'), tick);
    facts.set(factOf(ref, 'witnessed'), 'unknown');
    facts.set(factOf(ref, 'status'), 'stolen');
  });
  world.events.emit(theftRecorded, {
    ...ref,
    tick,
    thief: actor,
    owner: tag.owner,
    item: take.item,
    count: take.count,
    place: tag.place,
    witnessed: 'unknown',
  });
  return ref;
}

/**
 * The units of `flags` after they are put into `entity`: clean when `entity` belongs to the owner they
 * were stolen from, which also resolves that owner's oldest open thefts of this item to `returned`.
 */
export function flagsOnPut(
  world: World<never>,
  actor: EntityId,
  entity: EntityId,
  put: { readonly item: string; readonly count: number; readonly flags: ItemInstanceFlags },
): ItemInstanceFlags {
  const tag = ownerOf(world, entity);
  const { stolen, ownerId, ...rest } = put.flags;
  if (tag === undefined || stolen !== true || ownerId !== tag.owner) return put.flags;
  let left = put.count;
  for (const theft of thefts(world, { owner: tag.owner, item: put.item, status: 'stolen' })) {
    if (left === 0) break;
    const covered = Math.min(left, theft.units);
    const resolved = covered === theft.units;
    const { facts } = world;
    facts.transaction(() => {
      if (resolved) facts.set(factOf(theft, 'status'), 'returned');
      facts.set(factOf(theft, 'units'), resolved ? theft.units : theft.units - covered);
    });
    world.events.emit(theftReturned, {
      level: theft.level,
      id: theft.id,
      tick: world.tick,
      actor,
      owner: tag.owner,
      item: put.item,
      count: covered,
      resolved,
    });
    left -= covered;
  }
  return rest;
}

/**
 * Records whether anyone saw theft `ref`: what witness resolution (the AI) calls once it knows. The
 * theft stays `unknown` until then.
 */
export function resolveWitness(world: World<never>, ref: TheftRef, seen: boolean): void {
  world.facts.set(factOf(ref, 'witnessed'), seen ? 'seen' : 'unseen');
}

/** Filters for `thefts`. */
export interface TheftFilter {
  readonly owner?: string;
  readonly item?: string;
  readonly status?: TheftStatus;
}

const THEFT_STATUS_SUFFIX = '.theft.status';
const THEFT_KEY = /^entity:([^/]+)\/(theft-\d+)\.theft\.status$/;

/** Every recorded theft matching `filter`, oldest first (by id). */
export function thefts(world: World<never>, filter: TheftFilter = {}): Theft[] {
  const found: Theft[] = [];
  for (const [key, status] of world.facts.entries('entity:')) {
    const match = key.endsWith(THEFT_STATUS_SUFFIX) ? THEFT_KEY.exec(key) : null;
    if (match === null) continue;
    const [, level = '', id = ''] = match;
    const ref: TheftRef = { level, id };
    const read = (name: string) => world.facts.get(factOf(ref, name));
    const theft: Theft = {
      ...ref,
      owner: read('owner') as string,
      item: read('item') as string,
      units: read('units') as number,
      place: read('place') as string,
      tick: read('tick') as number,
      witnessed: read('witnessed') as Witnessed,
      status: status as TheftStatus,
    };
    if (filter.owner !== undefined && theft.owner !== filter.owner) continue;
    if (filter.item !== undefined && theft.item !== filter.item) continue;
    if (filter.status !== undefined && theft.status !== filter.status) continue;
    found.push(theft);
  }
  return found.sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)));
}
