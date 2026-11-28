import { describe, expect, it } from 'vitest';
import type { AlertState } from '@content/index';
import { BrainComponent, type Brain } from '../ai/components';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { World } from '../core/world';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { REST_HOSTILE_RADIUS, restHostility } from './safety';

function setup() {
  const world = new World<never>({ seed: 1 });
  world.register(BrainComponent, PlacementComponent, ...DAMAGE_COMPONENTS);
  const point = world.spawn();
  placeEntity(world, point, { x: 0, y: 0, z: 0 }, 0.5);
  const creature = (state: AlertState, x: number, health = 10) => {
    const entity = world.spawn();
    world.add(entity, BrainComponent, { state } as unknown as Brain);
    giveCombatant(world, entity, { health: 10 });
    if (health === 0) world.set(entity, HealthComponent, { max: 10, current: 0 });
    placeEntity(world, entity, { x, y: 0, z: 0 }, 0.4);
    return entity;
  };
  return { world, point, creature };
}

describe('is it safe to rest here? (mw-e27.13)', () => {
  it('AC-2: a hostile within 20 m vetoes resting; the same one 25 m off does not', () => {
    const s = setup();
    s.creature('suspicious', REST_HOSTILE_RADIUS - 1);
    expect(restHostility(s.world, s.point)).toBe('Something hostile is too close');
    const far = setup();
    far.creature('suspicious', REST_HOSTILE_RADIUS + 5);
    expect(restHostility(far.world, far.point)).toBeNull();
  });

  it('AC-2: any alert state of Searching or worse vetoes it wherever the creature is', () => {
    for (const state of ['searching', 'alerted', 'combat'] as const) {
      const s = setup();
      s.creature(state, 500);
      expect(restHostility(s.world, s.point)).toBe('Enemies are searching for you');
    }
    const calm = setup();
    calm.creature('investigating', 500);
    expect(restHostility(calm.world, calm.point)).toBeNull();
  });

  it('the unaware, the dead and creatures with no position do not count', () => {
    const s = setup();
    s.creature('unaware', 1);
    s.creature('combat', 1, 0);
    const unplaced = s.world.spawn();
    s.world.add(unplaced, BrainComponent, { state: 'suspicious' } as unknown as Brain);
    expect(restHostility(s.world, s.point)).toBeNull();
    // A rest point with no position of its own cannot be near anything.
    const floating = s.world.spawn();
    s.creature('suspicious', 1);
    expect(restHostility(s.world, floating)).toBeNull();
  });

  it('a world with no creatures is safe', () => {
    expect(restHostility(new World<never>({ seed: 1 }), 1)).toBeNull();
  });
});
