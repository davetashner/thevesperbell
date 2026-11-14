import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { cos, sin } from '../math';
import { PhysicsObjectComponent } from '../physics/objects';
import { addProperties, registerWorldProperties } from '../properties/components';
import {
  bodyFacing,
  hasTag,
  matchesFilter,
  matchesPredicate,
  predicateProperties,
  tagEntity,
  TagsComponent,
  tagsChanged,
  type TagsChange,
} from './filter';
import type { PredicateOp } from './graph';

function world() {
  return registerWorldProperties(new World<never>({ seed: 1 })).register(TagsComponent);
}

describe('entity tags', () => {
  it('adds tags sorted and unique, and rejects malformed ones', () => {
    const w = world();
    const e = w.spawn();
    expect(hasTag(w, e, 'player')).toBe(false);
    tagEntity(w, e, 'player', 'actor');
    tagEntity(w, e, 'actor', 'hero');
    expect(w.get(e, TagsComponent)).toEqual(['actor', 'hero', 'player']);
    expect(hasTag(w, e, 'hero')).toBe(true);
    expect(() => {
      tagEntity(w, e, 'Not A Tag');
    }).toThrow(/kebab-case/);
    expect(() => TagsComponent.deserialize('player')).toThrow(/list of kebab-case ids/);
    expect(TagsComponent.deserialize(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('tag change events and predicate properties (mw-e15.2)', () => {
  it('tagEntity announces a changed tag list, and only a changed one', () => {
    const w = world();
    const seen: TagsChange[] = [];
    w.events.on(tagsChanged, (change) => seen.push(change));
    const e = w.spawn();
    tagEntity(w, e, 'player');
    tagEntity(w, e, 'player'); // nothing new
    tagEntity(w, e, 'actor');
    w.events.flush();
    expect(seen).toEqual([
      { entity: e, tags: ['player'] },
      { entity: e, tags: ['actor', 'player'] },
    ]);
  });

  it('says which world properties a predicate reads', () => {
    expect(predicateProperties({ test: 'tag', tag: 'x' })).toEqual([]);
    expect(predicateProperties({ test: 'element', element: 'water' })).toEqual(['wetness']);
    expect(predicateProperties({ test: 'element', element: 'fire' })).toEqual(['burning']);
    expect(
      predicateProperties({ test: 'property', property: 'weight', op: 'gt', value: 1 }),
    ).toEqual(['weight']);
  });
});

describe('signal filters', () => {
  it('compares number, boolean and id properties, reading defaults when absent', () => {
    const w = world();
    const crate = w.spawn();
    addProperties(w, crate, { weight: 20, owner: 'crown' });
    const test = (property: string, op: PredicateOp, value: number | boolean | string) =>
      matchesPredicate(w, crate, { test: 'property', property, op, value } as never);
    expect([20, 19, 21].map((v) => test('weight', 'eq', v))).toEqual([true, false, false]);
    expect([20, 19].map((v) => test('weight', 'ne', v))).toEqual([false, true]);
    expect([20, 21].map((v) => test('weight', 'lt', v))).toEqual([false, true]);
    expect([19, 20].map((v) => test('weight', 'lte', v))).toEqual([false, true]);
    expect([20, 19].map((v) => test('weight', 'gt', v))).toEqual([false, true]);
    expect([21, 20].map((v) => test('weight', 'gte', v))).toEqual([false, true]);
    expect(test('owner', 'eq', 'crown')).toBe(true);
    expect(test('burning', 'eq', false)).toBe(true); // absent: the default
  });

  it('an empty filter passes everything; every predicate must hold', () => {
    const w = world();
    const e = w.spawn();
    addProperties(w, e, { burning: true, flammable: true, weight: 5 });
    expect(matchesFilter(w, e, [])).toBe(true);
    const fire = { test: 'element', element: 'fire' } as const;
    expect(matchesFilter(w, e, [fire])).toBe(true);
    expect(matchesFilter(w, e, [fire, { test: 'tag', tag: 'player' }])).toBe(false);
  });
});

describe('facing predicate (mw-e15.4)', () => {
  const yaw = (degrees: number) => {
    const half = (degrees * Math.PI) / 360;
    return { x: 0, y: sin(half), z: 0, w: cos(half) };
  };
  const body = (w: World<never>, rotation: { x: number; y: number; z: number; w: number }) => {
    const e = w.spawn();
    w.add(e, PhysicsObjectComponent, {
      body: 0,
      shape: { kind: 'box', halfExtents: { x: 1, y: 1, z: 1 } },
      position: { x: 0, y: 0, z: 0 },
      rotation,
      sleeping: false,
      awakeSince: 0,
    });
    w.step();
    return e;
  };

  it('reads the compass direction a physics body faces: north +z, east +x, south -z, west -x', () => {
    const w = world().register(PhysicsObjectComponent);
    const facings = [0, 90, 180, 270, 360, -90].map((turn) => {
      const e = body(w, yaw(turn));
      return bodyFacing(w, e);
    });
    expect(facings).toEqual(['north', 'east', 'south', 'west', 'north', 'west']);
    const e = body(w, yaw(0));
    expect(matchesPredicate(w, e, { test: 'facing', facing: 'north' })).toBe(true);
    expect(matchesPredicate(w, e, { test: 'facing', facing: 'east' })).toBe(false);
    expect(matchesFilter(w, e, [{ test: 'facing', facing: 'north' }])).toBe(true);
    expect(predicateProperties({ test: 'facing', facing: 'north' })).toEqual([]);
  });

  it('is unknown for an entity with no physics body, or in a world without physics objects', () => {
    const plain = world();
    const e = plain.spawn();
    expect(bodyFacing(plain, e)).toBeUndefined();
    expect(matchesPredicate(plain, e, { test: 'facing', facing: 'north' })).toBe(false);
    const w = world().register(PhysicsObjectComponent);
    expect(bodyFacing(w, w.spawn())).toBeUndefined();
  });
});
