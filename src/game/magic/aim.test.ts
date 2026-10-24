import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import {
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  PlacementComponent,
  placeEntity,
  World,
  type CollisionHit,
  type CollisionWorld,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { makeSpell, projectileDelivery } from '@sim/magic/testing';
import { spawnTrainingDummy } from '../combat/training-dummy';
import {
  previewRadius,
  resolveAim,
  spellRange,
  targetingMode,
  type AimContext,
  type AimRay,
} from './aim';

type Delivery = SpellEntry['delivery'];
const spell = (delivery: Delivery) => makeSpell('t', { delivery });
const bolt = spell(projectileDelivery({ maxRange: 20 }));
const aoe = (origin: 'aim' | 'caster', range = 10): SpellEntry =>
  spell({
    kind: 'aoe',
    shape: { kind: 'sphere', radius: 3 },
    origin,
    range,
    lineOfSight: false,
  });
const summon = (lineOfSight: boolean): SpellEntry =>
  spell({ kind: 'summonPoint', range: 8, lineOfSight });
const touch = spell({ kind: 'touch', reach: 2 });

/** A level: a floor at y = 0 (unless `floor` is false) and optionally a wall across z = `wall`. */
function level(options: { floor?: boolean; wall?: number; floorEndsAt?: number } = {}) {
  const { floor = true, wall, floorEndsAt } = options;
  const world: Pick<CollisionWorld, 'raycast'> = {
    raycast(origin: Vec3, d: Vec3, max: number): CollisionHit | undefined {
      const hits: number[] = [];
      if (floor && d.y < 0 && origin.y >= 0) {
        const t = origin.y / -d.y;
        const z = origin.z + d.z * t;
        if (floorEndsAt === undefined || z > floorEndsAt) hits.push(t);
      }
      if (wall !== undefined && d.z < 0) {
        const t = (origin.z - wall) / -d.z;
        if (t >= 0) hits.push(t);
      }
      const t = Math.min(...hits);
      if (!Number.isFinite(t) || t > max) return undefined;
      const point = { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t };
      return { distance: t, normal: { x: 0, y: 1, z: 0 }, point, body: 1 };
    },
  };
  return world;
}

function setup(collision = level()) {
  const world = new World<never>({ seed: 1 });
  world.register(PlacementComponent, ...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  const caster = world.spawn();
  placeEntity(world, caster, { x: 0, y: 0, z: 0 }, 0.4);
  const ctx: AimContext = { world, collision, caster };
  return { world, caster, ctx };
}

/** A camera 3 m behind and 2 m above the caster, looking along −z and slightly down. */
const behind: AimRay = (() => {
  const d = { x: 0, y: -0.2, z: -Math.sqrt(1 - 0.04) };
  return { origin: { x: 0, y: 3, z: 4 }, direction: d };
})();
const level0: AimRay = { origin: { x: 0, y: 1.5, z: 4 }, direction: { x: 0, y: 0, z: -1 } };

describe('targeting modes follow the delivery (mw-e06.15)', () => {
  it('maps every delivery kind to a mode and a range', () => {
    expect(targetingMode(bolt)).toBe('reticle');
    expect(targetingMode(spell({ kind: 'beam', length: 9, width: 1, maxBounces: 0 }))).toBe(
      'reticle',
    );
    expect(targetingMode(aoe('aim'))).toBe('ground');
    expect(targetingMode(aoe('caster'))).toBe('self');
    expect(targetingMode(summon(true))).toBe('ground');
    expect(targetingMode(touch)).toBe('target');
    expect(targetingMode(spell({ kind: 'self' }))).toBe('self');
    expect(spellRange(bolt)).toBe(20);
    expect(spellRange(spell({ kind: 'beam', length: 9, width: 1, maxBounces: 0 }))).toBe(9);
    expect(spellRange(aoe('aim', 7))).toBe(7);
    expect(spellRange(summon(true))).toBe(8);
    expect(spellRange(touch)).toBe(2);
    expect(spellRange(spell({ kind: 'self' }))).toBe(0);
  });

  it('previews an area at its radius, a cone or line at half its length, else a small ring', () => {
    expect(previewRadius(aoe('aim'))).toBe(3);
    const cone = spell({
      kind: 'aoe',
      shape: { kind: 'cone', length: 6, angle: 90 },
      origin: 'aim',
      range: 5,
      lineOfSight: false,
    });
    expect(previewRadius(cone)).toBe(3);
    expect(previewRadius(bolt)).toBe(0.5);
  });
});

describe('reticle aim', () => {
  it('AC-1: aims at the first wall the camera ray meets, from the caster outward', () => {
    const { ctx } = setup(level({ wall: -10 }));
    const aim = resolveAim(bolt, level0, ctx);
    expect(aim.mode).toBe('reticle');
    expect(aim.valid).toBe(true);
    expect(aim.point?.z).toBeCloseTo(-10, 5);
    expect(aim.clamped).toBe(false);
  });

  it('ignores a wall behind the caster that sits between the camera and the player', () => {
    const { ctx } = setup(level({ wall: 2 }));
    const aim = resolveAim(bolt, level0, ctx);
    // The wall at z = 2 is behind the head (z = 0) along −z: the ray is cast from the head on.
    expect(aim.point?.z).toBeCloseTo(-20, 5);
    expect(aim.clamped).toBe(true);
  });

  it('with nothing in reach aims at max range straight ahead, still valid', () => {
    const { ctx } = setup(level({ floor: false }));
    const aim = resolveAim(bolt, level0, ctx);
    expect(aim).toMatchObject({ valid: true, clamped: true, reason: null });
    expect(aim.point?.z).toBeCloseTo(-20, 5);
  });

  it('finds a creature in open air with no level behind it', () => {
    const { world, ctx } = setup(level({ floor: false }));
    const dummy = spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -6 },
      yaw: 0,
      tags: [],
    } as never);
    const ray = { ...level0, origin: { x: 0, y: 1, z: 4 } };
    expect(resolveAim(bolt, ray, ctx).target).toBe(dummy);
  });

  it('aims at a creature the ray passes through, and reports it', () => {
    const { world, ctx } = setup(level({ wall: -15 }));
    const dummy = spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -6 },
      yaw: 0,
      tags: [],
    } as never);
    const aim = resolveAim(bolt, { ...level0, origin: { x: 0, y: 1, z: 4 } }, ctx);
    expect(aim.target).toBe(dummy);
    expect(aim.point?.z).toBeGreaterThan(-6.5);
    expect(aim.point?.z).toBeLessThan(-5.5);
  });

  it('a creature past the spell range is not reached', () => {
    const { world, ctx } = setup(level({ floor: false }));
    spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -40 },
      yaw: 0,
      tags: [],
    } as never);
    expect(resolveAim(bolt, { ...level0, origin: { x: 0, y: 1, z: 4 } }, ctx).target).toBeNull();
  });

  it('has no aim without a caster placement', () => {
    const { world, ctx } = setup();
    const ghost = world.spawn();
    const aim = resolveAim(bolt, level0, { ...ctx, caster: ghost });
    expect(aim).toMatchObject({ point: null, valid: false, reason: 'no-caster' });
  });
});

describe('ground aim', () => {
  const lookDown: AimRay = behind;

  it('AC-2: puts the marker on the floor under the reticle when it is in range', () => {
    const { ctx } = setup();
    const aim = resolveAim(aoe('aim', 20), lookDown, ctx);
    expect(aim).toMatchObject({ mode: 'ground', valid: true, clamped: false, reason: null });
    expect(aim.point?.y).toBeCloseTo(0, 5);
    expect(aim.point?.z).toBeCloseTo(-10.7, 0);
  });

  it('AC-2: an aim point beyond max range clamps to max range, still valid with a floor', () => {
    const { ctx } = setup();
    const aim = resolveAim(aoe('aim', 5), lookDown, ctx);
    expect(aim.clamped).toBe(true);
    expect(aim.valid).toBe(true);
    expect(Math.hypot(aim.point?.x ?? 0, aim.point?.z ?? 0)).toBeCloseTo(5, 5);
  });

  it('AC-2: flags the clamped marker invalid when no floor exists there', () => {
    const { ctx } = setup(level({ floorEndsAt: -3 }));
    // The floor stops 3 m ahead; the clamped point is 5 m out.
    const aim = resolveAim(aoe('aim', 5), lookDown, ctx);
    expect(aim).toMatchObject({ clamped: true, valid: false, reason: 'no-floor' });
    expect(Math.hypot(aim.point?.x ?? 0, aim.point?.z ?? 0)).toBeCloseTo(5, 5);
  });

  it('looking at the sky clamps too (the far point on the ray), at the caster height', () => {
    const { ctx } = setup(level({ floor: false }));
    const aim = resolveAim(aoe('aim', 5), level0, ctx);
    expect(aim).toMatchObject({ clamped: true, valid: false, reason: 'no-floor' });
    expect(aim.point?.y).toBe(0);
  });

  it('a point straight below the caster does not divide by zero', () => {
    const { ctx } = setup();
    const down: AimRay = { origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: -1, z: 0 } };
    const aim = resolveAim(aoe('aim', 5), down, ctx);
    expect(aim.valid).toBe(true);
  });

  it('summonPoint with line of sight is valid when the view is open', () => {
    const { ctx } = setup();
    expect(resolveAim(summon(true), lookDown, ctx).valid).toBe(true);
  });

  it('summonPoint without line of sight ignores blockers', () => {
    const { ctx } = setup(level({ wall: -3 }));
    expect(resolveAim(summon(false), lookDown, ctx).reason).not.toBe('blocked');
  });

  it('flags a view blocked by a wall in front of the floor point', () => {
    // Floor everywhere; a wall at z = -2 lies between the caster's chest and the point 5 m out.
    const base = level({ wall: -2 });
    const collision: Pick<CollisionWorld, 'raycast'> = {
      raycast: (o, d, m) =>
        // The look ray and the floor probes see only the floor; the sight line sees the wall.
        d.y === -1 || d.y === 0 ? level().raycast(o, d, m) : base.raycast(o, d, m),
    };
    const { ctx } = setup(collision);
    const aim = resolveAim(summon(true), level0, ctx);
    expect(aim.reason).toBe('blocked');
    expect(aim.valid).toBe(false);
  });
});

describe('self and target aim', () => {
  it('self spells aim at the caster', () => {
    const { ctx } = setup();
    const aim = resolveAim(spell({ kind: 'self' }), level0, ctx);
    expect(aim).toMatchObject({ mode: 'self', valid: true, point: { x: 0, y: 0, z: 0 } });
  });

  it('touch targets the locked creature when in reach', () => {
    const { world, ctx } = setup();
    const dummy = spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -1.5 },
      yaw: 0,
      tags: [],
    } as never);
    const aim = resolveAim(touch, level0, { ...ctx, locked: () => dummy });
    expect(aim).toMatchObject({ mode: 'target', target: dummy, valid: true });
  });

  it('touch is out of reach for a far creature', () => {
    const { world, ctx } = setup();
    const dummy = spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -9 },
      yaw: 0,
      tags: [],
    } as never);
    const aim = resolveAim(touch, level0, { ...ctx, locked: () => dummy });
    expect(aim).toMatchObject({ valid: false, reason: 'out-of-reach' });
  });

  it('touch falls back to the creature under the reticle, else has no target', () => {
    const { world, ctx } = setup();
    const dummy: EntityId = spawnTrainingDummy(world, {
      id: 'd',
      position: { x: 0, y: 0, z: -1.5 },
      yaw: 0,
      tags: [],
    } as never);
    const ray = { ...level0, origin: { x: 0, y: 1, z: 4 } };
    expect(resolveAim(touch, ray, ctx).target).toBe(dummy);
    world.destroy(dummy);
    expect(resolveAim(touch, ray, ctx)).toMatchObject({ valid: false, reason: 'no-target' });
    // A lock on something dead is ignored too.
    expect(resolveAim(touch, ray, { ...ctx, locked: () => dummy }).reason).toBe('no-target');
  });
});
