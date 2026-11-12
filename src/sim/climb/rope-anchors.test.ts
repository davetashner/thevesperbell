import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { readProperty, registerWorldProperties } from '../properties/components';
import type { LoadedScene } from '../scene/loader';
import {
  placedRopes,
  placeRope,
  PlacedRopeComponent,
  retrieveRope,
  ropeAt,
  RopeAnchorComponent,
  ropePlaced,
  ropeRetrieved,
  ropeVolume,
  ROPE_ANCHOR_TAG,
  ROPE_VOLUME_RADIUS,
  sceneRopeAnchors,
  type RopePlaced,
  type RopeRetrieved,
} from './rope-anchors';
import { ClimbRopeComponent } from './ropes';
import { climbabilityOf } from './surfaces';

const OPTIONS = { length: 5, item: 'climbing-rope', properties: { material: 'rope' } } as const;

/** A world with two anchors (and one plain spawn) the way a loaded scene would leave it. */
function hall() {
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(ClimbRopeComponent);
  const hookB = world.spawn();
  const hookA = world.spawn();
  const plain = world.spawn();
  const spawn = (id: string, x: number, tags: string[]) => ({
    id,
    position: { x, y: 6, z: 2 },
    tags,
  });
  const loaded = {
    spawns: [
      { entity: hookB, spawn: spawn('b-hook', 4, [ROPE_ANCHOR_TAG]) },
      { entity: hookA, spawn: spawn('a-hook', 1, ['x', ROPE_ANCHOR_TAG]) },
      { entity: plain, spawn: spawn('lamp', 2, ['light']) },
    ],
  } as unknown as LoadedScene;
  const anchors = sceneRopeAnchors(world, loaded);
  const placed: RopePlaced[] = [];
  const retrieved: RopeRetrieved[] = [];
  world.events.on(ropePlaced, (event) => placed.push(event));
  world.events.on(ropeRetrieved, (event) => retrieved.push(event));
  return { world, anchors, hookA, hookB, plain, placed, retrieved };
}

describe('rope anchors and placed ropes (mw-e10.9)', () => {
  it('level content tags a spawn rope-anchor and that spawn becomes a free anchor at its point', () => {
    const { world, anchors, hookA, hookB, plain } = hall();
    expect(anchors).toEqual([hookB, hookA]);
    expect(world.get(hookA, RopeAnchorComponent)).toEqual({
      id: 'a-hook',
      point: { x: 1, y: 6, z: 2 },
      rope: null,
    });
    expect(world.has(plain, RopeAnchorComponent)).toBe(false);
    expect(ropeAt(world, hookA)).toBeUndefined();
    expect(ropeAt(world, plain)).toBeUndefined();
    // A second load does not register twice.
    expect(() => sceneRopeAnchors(world, { spawns: [] } as unknown as LoadedScene)).not.toThrow();
  });

  it('AC-4: a rope tied at an anchor makes a climbable volume until it is retrieved', () => {
    const { world, hookA, placed, retrieved } = hall();
    const result = placeRope(world, hookA, OPTIONS);
    if (!result.ok) throw new Error('refused');
    world.events.flush();
    expect(placed).toEqual([{ tick: 0, actor: null, anchor: hookA, rope: result.rope }]);
    // The rope is a climbable rope entity hanging from the anchor's point.
    const line = world.get(result.rope, ClimbRopeComponent);
    expect(line).toEqual({ anchor: { x: 1, y: 6, z: 2 }, length: 5 });
    expect(climbabilityOf(world, result.rope)).toBe('rope');
    expect(readProperty(world, result.rope, 'material')).toBe('rope');
    expect(world.get(result.rope, PlacedRopeComponent)).toEqual({
      anchor: hookA,
      item: 'climbing-rope',
    });
    expect(ropeAt(world, hookA)).toBe(result.rope);
    const volume = ropeVolume(line ?? { anchor: { x: 0, y: 0, z: 0 }, length: 1 });
    expect(volume.min).toEqual({ x: 1 - ROPE_VOLUME_RADIUS, y: 1, z: 2 - ROPE_VOLUME_RADIUS });
    expect(volume.max).toEqual({ x: 1 + ROPE_VOLUME_RADIUS, y: 6, z: 2 + ROPE_VOLUME_RADIUS });
    expect(placedRopes(world)).toEqual([{ id: 'a-hook', rope: line }]);

    // Retrieved: the rope, its volume and its entry are gone, and the item is named for the pack.
    expect(retrieveRope(world, hookA, 7)).toBe('climbing-rope');
    world.events.flush();
    expect(retrieved).toEqual([{ tick: 0, actor: 7, anchor: hookA }]);
    expect(world.isAlive(result.rope)).toBe(false);
    expect(climbabilityOf(world, result.rope)).toBe('none');
    expect(ropeAt(world, hookA)).toBeUndefined();
    expect(placedRopes(world)).toEqual([]);
    // Nothing left to untie, and the anchor takes a new rope.
    expect(retrieveRope(world, hookA)).toBeUndefined();
    expect(placeRope(world, hookA, OPTIONS).ok).toBe(true);
  });

  it('refuses a second rope on an occupied anchor and a rope on a spawn that is no anchor', () => {
    const { world, hookA, plain } = hall();
    expect(placeRope(world, hookA, OPTIONS).ok).toBe(true);
    expect(placeRope(world, hookA, OPTIONS)).toEqual({ ok: false, reason: 'occupied' });
    expect(placeRope(world, plain, OPTIONS)).toEqual({ ok: false, reason: 'not-an-anchor' });
  });

  it('a rope destroyed some other way (cut, burnt) leaves its anchor free again', () => {
    const { world, hookB } = hall();
    const result = placeRope(world, hookB, { length: 3, item: 'climbing-rope' });
    if (!result.ok) throw new Error('refused');
    world.destroy(result.rope);
    expect(ropeAt(world, hookB)).toBeUndefined();
    expect(placedRopes(world)).toEqual([]);
    expect(retrieveRope(world, hookB)).toBeUndefined();
    expect(placeRope(world, hookB, { length: 3, item: 'climbing-rope' }).ok).toBe(true);
  });

  it('a world without anchors or ropes has none to report', () => {
    const bare = new World<never>({ seed: 1 });
    const entity = bare.spawn();
    expect(placedRopes(bare)).toEqual([]);
    expect(ropeAt(bare, entity)).toBeUndefined();
    expect(placeRope(bare, entity, OPTIONS)).toEqual({ ok: false, reason: 'not-an-anchor' });
    const anchorsOnly = new World<never>({ seed: 1 });
    anchorsOnly.register(RopeAnchorComponent);
    expect(placedRopes(anchorsOnly)).toEqual([]);
  });
});
