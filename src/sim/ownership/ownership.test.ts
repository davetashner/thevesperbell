// Ownership and theft (mw-e27.9): the owner tag, the permission predicate, the theft facts and their
// filters, witness resolution and returns across several thefts. The take and put paths themselves are
// exercised through world items and containers (world-items.test.ts, containers.test.ts).
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { SceneSpawnComponent } from '../scene/loader';
import {
  flagsOnPut,
  isOwnerActor,
  ownerOf,
  recordTheft,
  resolveWitness,
  stolenFlags,
  tagOwner,
  theftTag,
  thefts,
  THEFT_COUNT_FACT,
} from './ownership';

const TAG = { owner: 'mirela', level: 'inn', place: 'shelf' };
const TOMA = { owner: 'toma', level: 'store', place: 'till' };

function setup() {
  const world = new World<never>({ seed: 1 });
  return { world, thief: world.spawn(), shelf: world.spawn(), till: world.spawn() };
}

describe('owner tags and permission (mw-e27.9)', () => {
  it('a thing has no owner until tagged, even in a world that never registered the tag', () => {
    const { world, shelf } = setup();
    expect(ownerOf(world, shelf)).toBeUndefined();
    tagOwner(world, shelf, TAG);
    expect(ownerOf(world, shelf)).toEqual(TAG);
  });

  it('the default rule permits only the owner itself, by scene spawn id', () => {
    const { world, thief, shelf } = setup();
    expect(isOwnerActor(world, thief, 'mirela')).toBe(false); // no scene components registered
    world.register(SceneSpawnComponent);
    expect(isOwnerActor(world, thief, 'mirela')).toBe(false);
    const mirela = world.spawn();
    world.add(mirela, SceneSpawnComponent, { id: 'mirela', tags: [] });
    expect(isOwnerActor(world, mirela, 'mirela')).toBe(true);
    tagOwner(world, shelf, TAG);
    const take = { item: 'bread', count: 1, flags: {} };
    expect(theftTag(world, thief, shelf, take)).toEqual(TAG);
    expect(theftTag(world, mirela, shelf, take)).toBeUndefined();
    expect(theftTag(world, thief, shelf, take, () => true)).toBeUndefined();
    expect(theftTag(world, thief, shelf, { ...take, flags: { stolen: true } })).toBeUndefined();
  });

  it('stolen flags keep the other flags and name the owner', () => {
    expect(stolenFlags({ bound: true }, TAG)).toEqual({
      bound: true,
      stolen: true,
      ownerId: 'mirela',
    });
  });
});

describe('theft facts (mw-e27.9)', () => {
  it('records owner, item, units, place, tick and unknown witnesses, and counts thefts', () => {
    const { world, thief } = setup();
    world.step();
    const ref = recordTheft(world, thief, TAG, { item: 'bread', count: 2, flags: {} });
    expect(ref).toEqual({ level: 'inn', id: 'theft-1' });
    expect(world.facts.get(THEFT_COUNT_FACT)).toBe(1);
    expect(thefts(world)).toEqual([
      {
        ...ref,
        owner: 'mirela',
        item: 'bread',
        units: 2,
        place: 'shelf',
        tick: 1,
        witnessed: 'unknown',
        status: 'stolen',
      },
    ]);
  });

  it('witness resolution marks a theft seen or unseen', () => {
    const { world, thief } = setup();
    const a = recordTheft(world, thief, TAG, { item: 'bread', count: 1, flags: {} });
    const b = recordTheft(world, thief, TAG, { item: 'bread', count: 1, flags: {} });
    resolveWitness(world, a, true);
    resolveWitness(world, b, false);
    expect(thefts(world).map((t) => t.witnessed)).toEqual(['seen', 'unseen']);
  });

  it('lists thefts oldest first and filters by owner, item and status; other facts are ignored', () => {
    const { world, thief } = setup();
    world.facts.set('entity:inn/chest.looted', true);
    for (let i = 0; i < 10; i += 1) {
      recordTheft(world, thief, i % 2 === 0 ? TAG : TOMA, {
        item: i < 5 ? 'bread' : 'arrow',
        count: 1,
        flags: {},
      });
    }
    expect(thefts(world).map((t) => t.id)[9]).toBe('theft-10'); // numeric, not lexical, order
    expect(thefts(world, { owner: 'toma' })).toHaveLength(5);
    expect(thefts(world, { item: 'arrow' })).toHaveLength(5);
    expect(thefts(world, { status: 'returned' })).toEqual([]);
    expect(thefts(world, { owner: 'mirela', item: 'bread', status: 'stolen' })).toHaveLength(3);
  });
});

describe('returning stolen goods (mw-e27.9)', () => {
  const stolen = { stolen: true, ownerId: 'mirela' } as const;

  it('covers the oldest open thefts of that owner and item first, then part of the next', () => {
    const { world, thief, shelf } = setup();
    tagOwner(world, shelf, TAG);
    for (const count of [2, 3, 4])
      recordTheft(world, thief, TAG, { item: 'bread', count, flags: {} });
    recordTheft(world, thief, TAG, { item: 'arrow', count: 1, flags: {} });
    expect(flagsOnPut(world, thief, shelf, { item: 'bread', count: 3, flags: stolen })).toEqual({});
    expect(thefts(world).map((t) => [t.id, t.status, t.units])).toEqual([
      ['theft-1', 'returned', 2],
      ['theft-2', 'stolen', 2],
      ['theft-3', 'stolen', 4],
      ['theft-4', 'stolen', 1],
    ]);
  });

  it('leaves flags alone for clean units, unowned places, another owner and unknown owners', () => {
    const { world, thief, shelf, till } = setup();
    tagOwner(world, shelf, TAG);
    tagOwner(world, till, TOMA);
    const put = (entity: number, flags: object) =>
      flagsOnPut(world, thief, entity, { item: 'bread', count: 1, flags });
    expect(put(shelf, {})).toEqual({});
    expect(put(till, stolen)).toEqual(stolen);
    expect(put(world.spawn(), stolen)).toEqual(stolen);
    expect(put(shelf, { stolen: true })).toEqual({ stolen: true });
  });

  it('clears the flags even when no open theft is left to resolve', () => {
    const { world, thief, shelf } = setup();
    tagOwner(world, shelf, TAG);
    expect(flagsOnPut(world, thief, shelf, { item: 'bread', count: 1, flags: stolen })).toEqual({});
  });
});
