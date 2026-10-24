import { describe, expect, it } from 'vitest';
import {
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  DamageModel,
  installStimuli,
  registerWorldProperties,
  SpellProjectileComponent,
  World,
  type CollisionWorld,
} from '@sim/index';
import { makeSpell, projectileDelivery } from '@sim/magic/testing';
import { RenderSync, type SceneBinding } from '../loop/render-sync';
import { installGameMagic } from './install';
import { bindBolts, MIN_BOLT_RADIUS, readBoltTransform, viewRay } from './view';

const level: CollisionWorld = {
  sweepCapsule: () => undefined,
  overlapCapsule: () => false,
  raycast: () => undefined,
  bodyVelocity: () => ({ x: 0, y: 0, z: 0 }),
};

function magicWorld(radius: number) {
  const world = new World<never>({ seed: 1 });
  installStimuli(registerWorldProperties(world));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const bolt = makeSpell('t-bolt', { delivery: projectileDelivery({ radius }) });
  const magic = installGameMagic(world, {
    spells: [bolt],
    damage: new DamageModel(),
    collision: level,
    invulnerable: () => false,
  });
  return { world, magic };
}

const binding = (made: number[]): SceneBinding<{ r: number }> => ({
  object: { r: 0 },
  read: readBoltTransform,
  apply: () => undefined,
  dispose: () => undefined,
  ...(made.length < 0 && {}),
});

describe('spell projectile views (mw-e06.15)', () => {
  it('binds one sphere per projectile, once, sized by its delivery', () => {
    const { world, magic } = magicWorld(0.3);
    const sync = new RenderSync(world);
    const radii: number[] = [];
    const create = (_entity: number, radius: number) => {
      radii.push(radius);
      return binding(radii);
    };
    expect(bindBolts(world, sync, magic.spells, create)).toBe(0);
    const bolt = world.spawn();
    world.add(bolt, SpellProjectileComponent, {
      spell: 't-bolt',
      caster: bolt,
      position: { x: 1, y: 2, z: 3 },
      velocity: { x: 0, y: 0, z: -1 },
      flown: 0,
      travelled: 0,
      bouncesLeft: 0,
      pierceLeft: 0,
      struck: [],
    });
    expect(bindBolts(world, sync, magic.spells, create)).toBe(1);
    expect(bindBolts(world, sync, magic.spells, create)).toBe(0);
    expect(radii).toEqual([0.3]);
    expect(readBoltTransform(world, bolt)?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(readBoltTransform(world, world.spawn())).toBeUndefined();
  });

  it('never draws a bolt smaller than a spark, or for a spell that is gone', () => {
    const { world, magic } = magicWorld(0.01);
    const sync = new RenderSync(world);
    const radii: number[] = [];
    const bolt = world.spawn();
    world.add(bolt, SpellProjectileComponent, {
      spell: 'gone',
      caster: bolt,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      flown: 0,
      travelled: 0,
      bouncesLeft: 0,
      pierceLeft: 0,
      struck: [],
    });
    bindBolts(world, sync, magic.spells, (_e, radius) => {
      radii.push(radius);
      return binding(radii);
    });
    expect(radii).toEqual([MIN_BOLT_RADIUS]);
  });

  it('a world without spell projectiles binds nothing and reads nothing', () => {
    const bare = new World<never>({ seed: 1 });
    expect(
      bindBolts(
        bare,
        new RenderSync(bare),
        () => undefined,
        () => binding([]),
      ),
    ).toBe(0);
    expect(readBoltTransform(bare, bare.spawn())).toBeUndefined();
  });
});

describe('the view ray', () => {
  it('looks along -z with no rotation, and follows a turn about y', () => {
    const straight = viewRay({
      position: { x: 1, y: 2, z: 3 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(straight.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(straight.direction.z).toBeCloseTo(-1, 9);
    const half = Math.SQRT1_2;
    const left = viewRay({
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: half, z: 0, w: half },
    });
    expect(left.direction.x).toBeCloseTo(-1, 9);
    const up = viewRay({
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: Math.sin(Math.PI / 8), y: 0, z: 0, w: Math.cos(Math.PI / 8) },
    });
    expect(up.direction.y).toBeGreaterThan(0.7);
  });
});
