// Entity tags and signal filters (mw-e03.21). A trigger volume or sensor decides what counts by
// reading an entity's world properties and tags ("anything burning", "weight ≥ 20 kg", "the player"),
// never its object type, so a burning crate, a burning goblin and a burning arrow all open the same
// fire-sealed door. Tags are the one non-property criterion: a short list of kebab-case ids an entity
// carries (`player`, `actor`, `companion`), set by whoever spawns it.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { readProperty } from '../properties/components';
import { PROPERTY_ID_PATTERN, type WorldPropertyKey } from '../properties/spec';
import type { ElementPredicate, PropertyPredicate, SignalPredicate } from './graph';

function tagList(data: unknown): readonly string[] {
  if (
    !Array.isArray(data) ||
    !data.every((t) => typeof t === 'string' && PROPERTY_ID_PATTERN.test(t))
  ) {
    throw new RangeError('tags must be a list of kebab-case ids');
  }
  return Object.freeze([...new Set(data as string[])].sort());
}

/** An entity's tags, sorted and unique (`entity.tags`; a snapshot and save key, never renamed). */
export const TagsComponent = defineComponent<readonly string[]>('entity.tags', {
  deserialize: tagList,
});

/** An entity's tag list changed (`tagEntity` added one), delivered at the next phase boundary. */
export interface TagsChange {
  readonly entity: EntityId;
  /** Every tag the entity carries now, sorted. */
  readonly tags: readonly string[];
}

/** Fired by `tagEntity` when it adds a tag the entity did not carry (puzzle goals watch it). */
export const tagsChanged = defineEvent<TagsChange>('tagsChanged');

/**
 * Gives `entity` these tags in addition to any it has (validated: kebab-case ids). Adding the
 * component is structural, so during a step a first tag applies at the end of the tick. Fires
 * `tagsChanged` when the list changes.
 */
export function tagEntity(world: World<never>, entity: EntityId, ...tags: string[]): void {
  const current = world.get(entity, TagsComponent);
  const next = tagList([...(current ?? []), ...tags]);
  if (current === undefined) world.add(entity, TagsComponent, next);
  else world.set(entity, TagsComponent, next);
  if (current?.length !== next.length) {
    world.events.emit(tagsChanged, { entity, tags: next });
  }
}

/** Whether `entity` carries `tag`. */
export function hasTag(world: World<never>, entity: EntityId, tag: string): boolean {
  return world.get(entity, TagsComponent)?.includes(tag) ?? false;
}

/** The property predicate an element test stands for. */
const ELEMENT_PREDICATES: Readonly<Record<ElementPredicate['element'], PropertyPredicate>> = {
  fire: { test: 'property', property: 'burning', op: 'eq', value: true },
  water: { test: 'property', property: 'wetness', op: 'gt', value: 0 },
  ice: { test: 'property', property: 'frozen', op: 'eq', value: true },
  charge: { test: 'property', property: 'charge', op: 'gt', value: 0 },
};

/** The world properties a predicate reads (none for a tag test). */
export function predicateProperties(predicate: SignalPredicate): readonly WorldPropertyKey[] {
  switch (predicate.test) {
    case 'tag':
      return [];
    case 'element':
      return predicateProperties(ELEMENT_PREDICATES[predicate.element]);
    case 'property':
      return [predicate.property];
  }
}

function compare(p: PropertyPredicate, actual: unknown): boolean {
  switch (p.op) {
    case 'eq':
      return actual === p.value;
    case 'ne':
      return actual !== p.value;
    case 'lt':
      return (actual as number) < (p.value as number);
    case 'lte':
      return (actual as number) <= (p.value as number);
    case 'gt':
      return (actual as number) > (p.value as number);
    case 'gte':
      return (actual as number) >= (p.value as number);
  }
}

/** Whether `entity` passes one predicate (properties read with their defaults when absent). */
export function matchesPredicate(
  world: World<never>,
  entity: EntityId,
  predicate: SignalPredicate,
): boolean {
  switch (predicate.test) {
    case 'tag':
      return hasTag(world, entity, predicate.tag);
    case 'element':
      return matchesPredicate(world, entity, ELEMENT_PREDICATES[predicate.element]);
    case 'property':
      return compare(predicate, readProperty(world, entity, predicate.property));
  }
}

/** Whether `entity` passes every predicate (an empty filter passes everything). */
export function matchesFilter(
  world: World<never>,
  entity: EntityId,
  filter: readonly SignalPredicate[],
): boolean {
  return filter.every((predicate) => matchesPredicate(world, entity, predicate));
}
