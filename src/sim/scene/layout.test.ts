import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import { TEST_SCENE, testKit } from './fixtures';
import {
  layoutScene,
  rotateYaw,
  SceneLayoutError,
  yawRotation,
  type Quat,
  type SceneSpec,
} from './layout';

/** Rotates `v` by the unit quaternion `q` (q v q*). */
function rotateByQuat(v: Vec3, q: Quat): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const close = (actual: Vec3, expected: Vec3): void => {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(actual.z).toBeCloseTo(expected.z, 9);
};

describe('scene layout (mw-e00.21)', () => {
  it('turns vectors counter-clockwise about +y, matching the yaw quaternion', () => {
    expect(rotateYaw({ x: 0, y: 1, z: 1 }, 90)).toEqual({ x: 1, y: 1, z: 0 });
    expect(rotateYaw({ x: 1, y: 0, z: 0 }, 270)).toEqual({ x: 0, y: 0, z: 1 });
    expect(rotateYaw({ x: 1, y: 2, z: 3 }, 180)).toEqual({ x: -1, y: 2, z: -3 });
    for (const yaw of [0, 90, 180, 270] as const) {
      const v = { x: 1.5, y: -2, z: 3.25 };
      close(rotateByQuat(v, yawRotation(yaw)), rotateYaw(v, yaw));
      const q = yawRotation(yaw);
      expect(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).toBeCloseTo(1, 12);
    }
  });

  it('places scaled parts on the grid with exact axis-aligned bounds', () => {
    const layout = layoutScene(TEST_SCENE, testKit);
    expect(layout.id).toBe('test-room');
    const floor = layout.parts[0];
    expect(floor).toMatchObject({
      placement: 0,
      piece: 'floor',
      purpose: 'walkable',
      shape: 'box',
      center: { x: 0, y: -0.1, z: 0 },
      size: { x: 10, y: 0.2, z: 10 },
      min: { x: -5, y: -0.2, z: -5 },
      max: { x: 5, y: 0, z: 5 },
      collider: { kind: 'box', min: { x: -5, y: -0.2, z: -5 }, max: { x: 5, y: 0, z: 5 } },
    });
  });

  it('turns a piece’s parts, offsets and bounds with its yaw', () => {
    const layout = layoutScene(TEST_SCENE, testKit);
    const door = layout.parts.filter((part) => part.piece === 'doorway');
    expect(door).toHaveLength(3);
    const left = door[0];
    close(left?.center ?? { x: NaN, y: NaN, z: NaN }, { x: 0, y: 1.5, z: 5.8 });
    close(left?.min ?? { x: NaN, y: NaN, z: NaN }, { x: -0.1, y: 0, z: 5.6 });
    close(left?.max ?? { x: NaN, y: NaN, z: NaN }, { x: 0.1, y: 3, z: 6 });
    expect(left?.size).toEqual({ x: 0.4, y: 3, z: 0.2 });
    expect(left?.rotation).toEqual(yawRotation(90));
    const piece = layout.pieces[1];
    expect(piece?.piece).toBe('doorway');
    close(piece?.min ?? { x: NaN, y: NaN, z: NaN }, { x: -0.1, y: 0, z: 4 });
    close(piece?.max ?? { x: NaN, y: NaN, z: NaN }, { x: 0.1, y: 3, z: 6 });
  });

  it('turns a wedge into a ramp collider rising the way the piece faces', () => {
    const ramp = layoutScene(TEST_SCENE, testKit).parts.find((part) => part.piece === 'ramp');
    expect(ramp?.collider).toEqual({
      kind: 'ramp',
      min: { x: 1, y: 0, z: -1.5 },
      max: { x: 3, y: 1, z: 1.5 },
      rises: '-z',
    });
    const rises = ([0, 90, 180, 270] as const).map((yaw) => {
      const scene: SceneSpec = {
        ...TEST_SCENE,
        placements: [{ piece: { id: 'ramp' }, at: [0, 0, 0], yaw, scale: [1, 1, 1] }],
      };
      const collider = layoutScene(scene, testKit).parts[0]?.collider;
      return collider?.kind === 'ramp' ? collider.rises : undefined;
    });
    expect(rises).toEqual(['+z', '+x', '-z', '-x']);
  });

  it('applies a placement’s purpose override and leaves non-solid parts without a collider', () => {
    const decal = layoutScene(TEST_SCENE, testKit).parts.find((part) => part.piece === 'decal');
    expect(decal?.purpose).toBe('interactive');
    expect(decal?.collider).toBeUndefined();
  });

  it('scales grid cells to metres and lays out spawns', () => {
    const scene: SceneSpec = { ...TEST_SCENE, grid: 2 };
    const layout = layoutScene(scene, testKit);
    expect(layout.pieces[1]?.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(layout.spawns).toEqual([
      {
        id: 'player-start',
        position: { x: 0, y: 0, z: -4 },
        yaw: 0,
        rotation: yawRotation(0),
        prop: undefined,
        tags: ['player-start'],
      },
      {
        id: 'crate',
        position: { x: 2, y: 0, z: 4 },
        yaw: 270,
        rotation: yawRotation(270),
        prop: 'crate',
        tags: [],
      },
    ]);
  });

  it('lays out a creature spawn with its faction override and patrol route in metres (mw-e12.4)', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      grid: 2,
      spawns: [
        {
          id: 'den',
          at: [1, 0, 1],
          yaw: 90,
          tags: [],
          creature: { id: 'fixture-hound' },
          faction: { id: 'unaligned' },
          patrol: [
            [1, 0, 1],
            [3, 0, 1],
          ],
        },
      ],
    };
    const [den] = layoutScene(scene, testKit).spawns;
    expect(den).toMatchObject({
      creature: 'fixture-hound',
      faction: 'unaligned',
      patrol: [
        { x: 2, y: 0, z: 2 },
        { x: 6, y: 0, z: 2 },
      ],
    });
    expect(Object.isFrozen(den?.patrol)).toBe(true);
  });

  it('mw-e11.9: resolves a spawn’s routine to its routes in metres, links by index', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      grid: 2,
      waypoints: [
        {
          id: 'gate',
          at: [1, 0, 1],
          dwellS: 2,
          look: 90,
          scanArc: 60,
          scanS: 4,
          idle: 'guard-lean',
        },
        { id: 'well', at: [3, 0, 1] },
        { id: 'tower', at: [3, 0, 3] },
      ],
      routes: [
        { id: 'post', kind: 'post', waypoints: ['gate'] },
        {
          id: 'wander',
          kind: 'random',
          waypoints: ['well', 'tower'],
          links: [
            { from: 'well', to: 'tower', weight: 2 },
            { from: 'tower', to: 'well', weight: 1 },
          ],
        },
      ],
      spawns: [
        {
          id: 'guard',
          at: [1, 0, 1],
          yaw: 0,
          tags: [],
          creature: { id: 'fixture-guard' },
          routine: [{ route: 'post', hours: [20, 6] }, { route: 'wander' }],
        },
      ],
    };
    const [guard] = layoutScene(scene, testKit).spawns;
    const routine = guard?.routine ?? [];
    expect(routine).toEqual([
      {
        route: {
          id: 'post',
          kind: 'post',
          waypoints: [
            {
              id: 'gate',
              at: { x: 2, y: 0, z: 2 },
              dwellS: 2,
              look: 90,
              scanArc: 60,
              scanS: 4,
              idle: 'guard-lean',
            },
          ],
        },
        hours: [20, 6],
      },
      {
        route: {
          id: 'wander',
          kind: 'random',
          waypoints: [
            { id: 'well', at: { x: 6, y: 0, z: 2 } },
            { id: 'tower', at: { x: 6, y: 0, z: 6 } },
          ],
          links: [
            { from: 0, to: 1, weight: 2 },
            { from: 1, to: 0, weight: 1 },
          ],
        },
      },
    ]);
    expect(Object.isFrozen(routine)).toBe(true);
    expect(Object.isFrozen(routine[1]?.route.links)).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).spawns.every((s) => s.routine === undefined)).toBe(
      true,
    );
  });

  it('mw-e01.17: lays out a creature’s leash in metres, its post defaulting to the spawn point', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      grid: 2,
      spawns: [
        {
          id: 'skeleton',
          at: [1, 0, 3],
          yaw: 180,
          tags: [],
          creature: { id: 'forgotten-miner' },
          leash: { radius: 25 },
        },
        {
          id: 'warden',
          at: [0, 0, 0],
          yaw: 0,
          tags: [],
          creature: { id: 'forgotten-miner' },
          leash: { radius: 8, post: [2, 0, 1] },
        },
      ],
    };
    const [skeleton, warden] = layoutScene(scene, testKit).spawns;
    expect(skeleton?.leash).toEqual({ radius: 25, post: { x: 2, y: 0, z: 6 } });
    expect(warden?.leash).toEqual({ radius: 8, post: { x: 4, y: 0, z: 2 } });
    expect(Object.isFrozen(skeleton?.leash)).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).spawns.every((s) => s.leash === undefined)).toBe(true);
  });

  it('mw-ju8.29: lays out a creature’s repopulation rule, and none for a spawn without one', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      spawns: [
        {
          id: 'skeleton',
          at: [0, 0, 0],
          yaw: 0,
          tags: [],
          creature: { id: 'forgotten-miner' },
          repopulate: { afterDays: 2 },
        },
        { id: 'brute', at: [1, 0, 0], yaw: 0, tags: [], creature: { id: 'forgotten-brute' } },
      ],
    };
    const [skeleton, brute] = layoutScene(scene, testKit).spawns;
    expect(skeleton?.repopulate).toEqual({ afterDays: 2 });
    expect(Object.isFrozen(skeleton?.repopulate)).toBe(true);
    expect(brute?.repopulate).toBeUndefined();
  });

  it('mw-ju8.14: lays out the phases a spawn is there for, and none for a spawn without any', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      spawns: [
        {
          id: 'teacher',
          at: [0, 0, 0],
          yaw: 0,
          tags: [],
          creature: { id: 'npc-quillon' },
          presence: { phases: ['dusk', 'night'] },
        },
        { id: 'always', at: [1, 0, 0], yaw: 0, tags: [], creature: { id: 'npc-ottilie' } },
      ],
    };
    const [teacher, always] = layoutScene(scene, testKit).spawns;
    expect(teacher?.presence).toEqual({ phases: ['dusk', 'night'] });
    expect(Object.isFrozen(teacher?.presence?.phases)).toBe(true);
    expect(always?.presence).toBeUndefined();
  });

  it('mw-e01.5: lays out what a creature carries as plain item ids, in order', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      spawns: [
        {
          id: 'skeleton',
          at: [1, 0, 3],
          yaw: 180,
          tags: [],
          creature: { id: 'forgotten-miner' },
          carries: [
            { item: { id: 'rusted-gallery-key' }, count: 1 },
            { item: { id: 'gold' }, count: 4 },
          ],
        },
      ],
    };
    const [skeleton] = layoutScene(scene, testKit).spawns;
    expect(skeleton?.carries).toEqual([
      { item: 'rusted-gallery-key', count: 1 },
      { item: 'gold', count: 4 },
    ]);
    expect(Object.isFrozen(skeleton?.carries)).toBe(true);
    expect(Object.isFrozen(skeleton?.carries?.[0])).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).spawns.every((s) => s.carries === undefined)).toBe(
      true,
    );
  });

  it('mw-e11.9: throws for a route naming an unknown waypoint, a link off the route or an unknown route', () => {
    const base: SceneSpec = {
      ...TEST_SCENE,
      waypoints: [{ id: 'a', at: [0, 0, 0] }],
      routes: [{ id: 'loop', kind: 'loop', waypoints: ['a'] }],
    };
    const guard = (route: string) => ({
      id: 'guard',
      at: [0, 0, 0] as const,
      yaw: 0 as const,
      tags: [],
      creature: { id: 'fixture-guard' },
      routine: [{ route }],
    });
    expect(() =>
      layoutScene({ ...base, routes: [{ id: 'r', kind: 'loop', waypoints: ['a', 'b'] }] }, testKit),
    ).toThrow(new SceneLayoutError('scene "test-room" route "r" names unknown waypoint "b"'));
    expect(() =>
      layoutScene(
        {
          ...base,
          routes: [
            {
              id: 'r',
              kind: 'random',
              waypoints: ['a'],
              links: [{ from: 'a', to: 'z', weight: 1 }],
            },
          ],
        },
        testKit,
      ),
    ).toThrow('route "r" links waypoint "z", which it does not list');
    expect(() => layoutScene({ ...base, spawns: [guard('nowhere')] }, testKit)).toThrow(
      'scene "test-room" spawn "guard" names unknown route "nowhere"',
    );
    expect(layoutScene({ ...base, spawns: [guard('loop')] }, testKit).spawns[0]?.routine).toEqual([
      { route: { id: 'loop', kind: 'loop', waypoints: [{ id: 'a', at: { x: 0, y: 0, z: 0 } }] } },
    ]);
  });

  it('lays out an item spawn with its item and count (mw-e17.7)', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      spawns: [
        { id: 'loot', at: [1, 0, 1], yaw: 0, tags: [], item: { id: { id: 'gold' }, count: 12 } },
      ],
    };
    const [loot] = layoutScene(scene, testKit).spawns;
    expect(loot?.item).toEqual({ id: 'gold', count: 12 });
    expect(Object.isFrozen(loot?.item)).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).spawns.every((s) => s.item === undefined)).toBe(true);
  });

  it('lays out a container spawn with its loot table, contents and lock as plain ids (mw-e18.3)', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      spawns: [
        {
          id: 'chest',
          at: [1, 0, 1],
          yaw: 0,
          tags: [],
          container: {
            loot: { id: 'supplies' },
            contents: [{ item: { id: 'bread' }, count: 2 }],
            lock: { id: 'chest-lock' },
            locked: false,
          },
        },
        { id: 'barrel', at: [2, 0, 1], yaw: 0, tags: [], container: {} },
      ],
    };
    const [chest, barrel] = layoutScene(scene, testKit).spawns;
    expect(chest?.container).toEqual({
      loot: 'supplies',
      contents: [{ item: 'bread', count: 2 }],
      lock: 'chest-lock',
      locked: false,
    });
    expect(Object.isFrozen(chest?.container?.contents[0])).toBe(true);
    expect(barrel?.container).toEqual({ contents: [] });
    expect(layoutScene(TEST_SCENE, testKit).spawns.every((s) => s.container === undefined)).toBe(
      true,
    );
  });

  it('lays out placed signal graphs with their bindings and checkpoints (mw-e01.4)', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      signals: [
        { graph: { id: 'gate' }, bindings: { lever: 'gate-lever' }, checkpoints: ['cp-1'] },
        { graph: { id: 'plain' } },
      ],
    };
    const { signals } = layoutScene(scene, testKit);
    expect(signals).toEqual([
      { graph: 'gate', bindings: { lever: 'gate-lever' }, checkpoints: ['cp-1'] },
      { graph: 'plain', bindings: {}, checkpoints: [] },
    ]);
    expect(Object.isFrozen(signals[0]?.checkpoints)).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).signals).toEqual([]);
  });

  it('lays out tagged regions as boxes in metres, in scene order (mw-e02.14)', () => {
    const scene: SceneSpec = {
      ...TEST_SCENE,
      grid: 2,
      regions: [
        { id: 'river', min: [-3, -3, 1], max: [-1, -1, 23], tags: ['water', 'river'] },
        { id: 'mud', min: [0, 0, 0], max: [1, 1, 1], tags: [] },
      ],
    };
    const { regions } = layoutScene(scene, testKit);
    expect(regions).toEqual([
      {
        id: 'river',
        min: { x: -6, y: -6, z: 2 },
        max: { x: -2, y: -2, z: 46 },
        tags: ['water', 'river'],
      },
      { id: 'mud', min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 }, tags: [] },
    ]);
    expect(Object.isFrozen(regions[0]?.tags)).toBe(true);
    expect(layoutScene(TEST_SCENE, testKit).regions).toEqual([]);
  });

  it('is deterministic and frozen', () => {
    const a = layoutScene(TEST_SCENE, testKit);
    expect(layoutScene(TEST_SCENE, testKit)).toEqual(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.parts[0]?.center)).toBe(true);
    expect(Object.isFrozen(a.spawns[0]?.tags)).toBe(true);
  });

  it('refuses a scene naming an unknown kit piece, or a piece with no parts', () => {
    const unknown: SceneSpec = {
      ...TEST_SCENE,
      placements: [{ piece: { id: 'nope' }, at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] }],
    };
    expect(() => layoutScene(unknown, testKit)).toThrow(SceneLayoutError);
    expect(() => layoutScene(unknown, testKit)).toThrow(
      /placement 0 uses unknown kit piece "nope"/,
    );
    const empty = () => ({ id: 'nope', purpose: 'walkable' as const, parts: [] });
    expect(() => layoutScene(unknown, empty)).toThrow(/kit piece "nope" has no parts/);
  });
});
