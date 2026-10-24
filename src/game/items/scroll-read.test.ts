import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import {
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  PlacementComponent,
  placeEntity,
  World,
  type CollisionWorld,
} from '@sim/index';
import { makeSpell, projectileDelivery } from '@sim/magic/testing';
import { spawnTrainingDummy } from '../combat/training-dummy';
import { aimScroll, createScrollRules, scrollCasts } from './scroll-read';

const NO_WALLS = { raycast: () => undefined } as unknown as Pick<CollisionWorld, 'raycast'>;
const ray = { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: 1 } };

function context() {
  const world = new World<never>({ seed: 1 });
  world.register(PlacementComponent, ...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  const caster = world.spawn();
  placeEntity(world, caster, { x: 0, y: 0, z: 0 }, 0.4);
  return { world, caster, collision: NO_WALLS };
}

describe('scrollCasts / createScrollRules', () => {
  const content = {
    all: () =>
      [
        { id: 'a', category: 'book', book: { kind: 'scroll', casts: { id: 'spark' } } },
        { id: 'b', category: 'book', book: { kind: 'scroll' } },
        { id: 'c', category: 'book', book: { kind: 'tome', casts: undefined } },
        { id: 'd', category: 'tool' },
      ] as never,
  };

  it('maps each scroll that names a spell to it', () => {
    expect([...scrollCasts(content)]).toEqual([['a', 'spark']]);
    const rules = createScrollRules(
      content,
      { cast: () => ({ status: 'cast', delivery: 1 }) },
      { remove: () => ({ ok: true, instanceIds: [] }) },
    );
    expect(rules.castable('a')).toBe(true);
    expect(rules.castable('b')).toBe(false);
  });
});

describe('aimScroll', () => {
  it('names the locked creature for a touch spell in reach', () => {
    const c = context();
    const dummy = spawnTrainingDummy(c.world, {
      id: 'd',
      position: { x: 0, y: 0, z: 1.5 },
      yaw: 0,
      tags: [],
    } as never);
    const touch: SpellEntry = makeSpell('t', { delivery: { kind: 'touch', reach: 2 } });
    expect(aimScroll(touch, ray, { ...c, locked: () => dummy })).toMatchObject({
      valid: true,
      target: dummy,
    });
  });

  it('gives the aim point (and no target) for a bolt', () => {
    const bolt = makeSpell('t', { delivery: projectileDelivery({ maxRange: 20 }) });
    const aim = aimScroll(bolt, ray, context());
    expect(aim).toMatchObject({ valid: true, aim: { x: 0, y: 1.5, z: 20 } });
    expect('target' in aim).toBe(false);
  });

  it('says why a ground spell cannot be aimed with no floor', () => {
    const summon: SpellEntry = makeSpell('t', {
      delivery: { kind: 'summonPoint', range: 8, lineOfSight: false },
    });
    expect(aimScroll(summon, ray, context())).toEqual({
      valid: false,
      text: 'There is no floor there to aim at.',
    });
  });

  it('says a touch spell needs a target', () => {
    const touch: SpellEntry = makeSpell('t', { delivery: { kind: 'touch', reach: 2 } });
    expect(aimScroll(touch, ray, context())).toEqual({
      valid: false,
      text: 'The scroll needs someone to aim at.',
    });
  });
});
