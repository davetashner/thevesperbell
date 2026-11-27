// The Millweir sluice walk's 2.5 m gap (mw-e25.30), on real content: three ways across it.
// A plank bridge hung level with both decks, a climbing rope tied at the far lip, and a blink.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  placeRope,
  PhysicsObjectComponent,
  ropeAt,
  sceneRopeAnchors,
  teleportCommand,
  ClimbRopeComponent,
  CharacterController,
  ropeVolume,
  type EntityId,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const river = content.get('scene', 'briar-glen-river');
type Input = ReturnType<typeof teleportCommand>;

/** The gap runs z 14..16.5 along the walk (x 150..151.5); the decks' tops are at y 2.2. */
const GAP = { near: 14, far: 16.5, deckTop: 2.2 };

const play = () => {
  const game = createGameWorld<Input>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'briar-glen-river',
    magic: true,
  });
  const byId = new Map<string, EntityId>();
  for (const { entity, spawn } of game.scene.spawns) byId.set(spawn.id, entity);
  const id = (name: string): EntityId => {
    const entity = byId.get(name);
    if (entity === undefined) throw new Error(`no spawn ${name}`);
    return entity;
  };
  return { game, id, byId };
};

describe('the sluice walk gap (mw-e25.30)', { timeout: 120_000 }, () => {
  it('AC-1: a plank bridge of five planks on two ropes spans the gap level with both decks', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-river');
    markExercised(task, 'testprop', 'bridge-plank');
    const { game, id, byId } = play();
    const planks = [...byId.keys()].filter((n) => n.startsWith('sluice-plank-bridge-plank-'));
    expect(planks).toHaveLength(5);
    const marker = river.spawns.find((s) => s.id === 'sluice-walk-gap');
    expect(marker?.tags).toContain('plank-site');
    const zs: number[] = [];
    for (const name of planks) {
      const body = game.world.get(id(name), PhysicsObjectComponent);
      if (body === undefined) throw new Error(`${name} has no body`);
      expect(Math.abs(body.position.y + 0.05 - GAP.deckTop)).toBeLessThan(0.15);
      expect(Math.abs(body.position.x - 150.75)).toBeLessThan(0.01);
      zs.push(body.position.z);
    }
    zs.sort((a, b) => a - b);
    // Planks cover the gap with at most a plank-width of daylight between neighbours and the decks.
    const gaps = [
      (zs[0] ?? NaN) - 0.23 - GAP.near,
      GAP.far - ((zs.at(-1) ?? NaN) + 0.23),
      ...zs.slice(1).map((z, i) => z - (zs[i] ?? NaN) - 0.46),
    ];
    for (const g of gaps) expect(g).toBeLessThanOrEqual(0.3);
    expect(byId.has('sluice-plank-bridge-rope-1') && byId.has('sluice-plank-bridge-rope-2')).toBe(
      true,
    );
  });

  it('AC-2: a climbing rope lies on the walk and, tied at the far lip, hangs from deck level into the lower pool', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-river');
    const { game, id, byId } = play();
    expect(river.spawns.find((s) => s.id === 'sluice-gap-rope')?.item?.id.id).toBe('climbing-rope');
    const hook = river.spawns.find((s) => s.id === 'sluice-gap-hook');
    expect(hook?.tags).toContain('rope-anchor');
    expect(hook?.interact?.affordances.map((a) => a.verb)).toEqual(['climb', 'release']);
    // The lip is within reach from the near deck's edge.
    expect(hook?.interact?.radius).toBeGreaterThanOrEqual((hook?.at[2] ?? 0) - GAP.near);
    const loaded = game.scene;
    const [anchor] = sceneRopeAnchors(game.world, loaded);
    expect(anchor).toBe(id('sluice-gap-hook'));
    const placed = placeRope(game.world, id('sluice-gap-hook'), {
      length: 6,
      item: 'climbing-rope',
      properties: { material: 'rope' },
    });
    expect(placed.ok).toBe(true);
    game.world.step();
    const rope = ropeAt(game.world, id('sluice-gap-hook'));
    if (rope === undefined) throw new Error('no rope tied');
    const line = game.world.get(rope, ClimbRopeComponent);
    if (line === undefined) throw new Error('no climb rope');
    const volume = ropeVolume(line);
    const lower = river.regions.find((r) => r.id === 'lower-pool');
    if (lower === undefined) throw new Error('no lower pool');
    // Top at the deck, foot in the pool: a swimmer climbs out onto the far deck and the volume
    // reaches the far deck's edge.
    expect(volume.max.y).toBeCloseTo(2, 5);
    expect(volume.min.y).toBeLessThan(lower.max[1]);
    expect(volume.max.z + 0.01).toBeGreaterThanOrEqual(GAP.far - 0.5);
    expect(byId.has('sluice-gap-hook')).toBe(true);
  });

  it('AC-3: a 2.5 m blink from the near deck edge lands on the far deck, with nothing between', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-river');
    const near = river.surfaces.find((s) => s.id === 'sluice-walk');
    const far = river.surfaces.find((s) => s.id === 'sluice-walk-far');
    if (near === undefined || far === undefined) throw new Error('no decks');
    const gap = far.min[2] - near.max[2];
    expect(gap).toBeCloseTo(2.5, 5);
    expect(gap).toBeLessThan(4); // blink: "teleport several meters" (CONSTITUTION)
    expect(near.max[1]).toBe(far.max[1]); // same height: no climb or drop
    const x = 150.75;
    const from = { x, y: near.max[1], z: near.max[2] - 0.3 };
    const to = { x, y: far.max[1], z: far.min[2] + 0.3 };
    // The landing is on the far deck; no placement solid crosses the line between the two points
    // above the deck, apart from the plank bridge (which is soft).
    expect(to.z).toBeGreaterThan(far.min[2]);
    expect(to.x).toBeGreaterThan(far.min[0]);
    expect(to.x).toBeLessThan(far.max[0]);
    const blockers = river.placements.filter((p) => {
      const [hx, hy, hz] = p.scale.map((n) => n / 2) as [number, number, number];
      return (
        p.at[1] + hy > near.max[1] + 0.1 &&
        p.at[1] - hy < near.max[1] + 2 &&
        Math.abs(p.at[0] - x) < hx &&
        p.at[2] + hz > from.z &&
        p.at[2] - hz < to.z
      );
    });
    expect(blockers.map((p) => p.piece.id)).toEqual([]);
    const { game } = play();
    const player = game.player;
    game.world.step([teleportCommand(player, from)]);
    game.world.step([teleportCommand(player, to)]);
    game.world.step();
    const body = game.world.get(player, CharacterController);
    expect(body?.position.z).toBeGreaterThan(far.min[2]);
  });
});
