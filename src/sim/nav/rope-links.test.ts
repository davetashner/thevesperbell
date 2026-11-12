import { describe, expect, it } from 'vitest';
import { ROPE_ANCHOR_TAG, ropeAt, sceneRopeAnchors } from '../climb/rope-anchors';
import { placeRope, retrieveRope } from '../climb/rope-anchors';
import { ClimbRopeComponent } from '../climb/ropes';
import { World } from '../core/world';
import { registerWorldProperties } from '../properties/components';
import type { LoadedScene } from '../scene/loader';
import { CLIMBER, IN_B, ON_PILLAR, twoRooms, WALKER } from './fixtures';
import { NavMeshQuery } from './path';
import { meshWithRopeLinks, ROPE_LINK_GRADE, ropeLinkRows } from './rope-links';

/** Room B's pillar (x 10–11, z 2.5–3.5) is 5 m tall and has nothing to climb. */
function pillarWorld(points: { id: string; x: number; y: number; z: number }[]) {
  const world = registerWorldProperties(new World<never>({ seed: 1 }));
  world.register(ClimbRopeComponent);
  const entities = points.map(() => world.spawn());
  sceneRopeAnchors(world, {
    spawns: points.map(({ id, ...position }, i) => ({
      entity: entities[i],
      spawn: { id, position, tags: [ROPE_ANCHOR_TAG] },
    })),
  } as unknown as LoadedScene);
  return { world, entities };
}

const route = (mesh: ReturnType<typeof twoRooms>, agent: typeof CLIMBER) =>
  new NavMeshQuery(mesh).findPath({ start: IN_B, goal: ON_PILLAR, agent });

describe('rope off-mesh links (mw-e10.9)', () => {
  it('AC-4: a placed rope gives climbers a climb link up the pillar until it is retrieved', () => {
    const base = twoRooms();
    const { world, entities } = pillarWorld([{ id: 'pillar-hook', x: 11.4, y: 5, z: 3 }]);
    const [hook] = entities as [number];
    expect(ropeLinkRows(base, world)).toEqual([]);
    expect(meshWithRopeLinks(base, world)).toBe(base);
    expect(route(base, CLIMBER).status).toBe('unreachable');

    const placed = placeRope(world, hook, { length: 5, item: 'climbing-rope' });
    expect(placed.ok).toBe(true);
    const rows = ropeLinkRows(base, world);
    expect(rows).toHaveLength(2);
    const [up, down] = rows as [(typeof rows)[number], (typeof rows)[number]];
    // Climb links (kind 2) between the foot of the rope and the top of the pillar, both ways.
    expect(up.slice(0, 1)).toEqual([2]);
    expect(up[9]).toBe(ROPE_LINK_GRADE);
    expect([up[4], up[7]]).toEqual([0, 5]);
    expect([down[1], down[2]]).toEqual([up[2], up[1]]);
    const roped = meshWithRopeLinks(base, world);
    expect(roped.linkCount).toBe(base.linkCount + 2);
    expect(roped.link(base.linkCount)).toMatchObject({ kind: 'climb', measure: ROPE_LINK_GRADE });
    // Climbers reach the pillar top over it; walkers still cannot; the baked mesh is untouched.
    const climbed = route(roped, CLIMBER);
    expect(climbed.status).not.toBe('unreachable');
    if (climbed.status !== 'found') throw new Error('no path');
    expect(climbed.points.some((point) => point.link === 'climb')).toBe(true);
    expect(route(roped, WALKER).status).toBe('unreachable');
    expect(base.linkCount).toBe(roped.linkCount - 2);

    // Retrieved: the link goes with the rope.
    retrieveRope(world, hook);
    expect(ropeAt(world, hook)).toBeUndefined();
    expect(ropeLinkRows(base, world)).toEqual([]);
    expect(route(meshWithRopeLinks(base, world), CLIMBER).status).toBe('unreachable');
  });

  it('ropes make links in anchor id order, and a rope no one could get on or off makes none', () => {
    const base = twoRooms();
    const { world, entities } = pillarWorld([
      { id: 'b-hook', x: 11.4, y: 5, z: 3 },
      // The edge of room A's 1.5 m platform: a short way up, listed first by its id.
      { id: 'a-hook', x: 2.4, y: 1.5, z: 3 },
      // Hangs in the open over room B: nothing to stand on at its top.
      { id: 'c-hook', x: 8.5, y: 5, z: 5 },
      // Its foot is far above the floor: nobody reaches it.
      { id: 'd-hook', x: 11.4, y: 12, z: 2.6 },
    ]);
    const [b, a, c, d] = entities as [number, number, number, number];
    placeRope(world, c, { length: 5, item: 'climbing-rope' });
    placeRope(world, d, { length: 2, item: 'climbing-rope' });
    expect(ropeLinkRows(base, world)).toEqual([]);
    placeRope(world, b, { length: 5, item: 'climbing-rope' });
    placeRope(world, a, { length: 1.5, item: 'climbing-rope' });
    const rows = ropeLinkRows(base, world);
    expect(rows).toHaveLength(4);
    // a-hook (the platform, top 1.5 m) before b-hook (the pillar, top 5 m).
    expect(rows.map((row) => row[7])).toEqual([1.5, 0, 5, 0]);
  });
});
