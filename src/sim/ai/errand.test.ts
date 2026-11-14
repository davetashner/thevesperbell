// Errands (mw-8551): a creature sent to walk to a point is walked by the AI system, outside its
// behaviour, and is gone on arrival when it is leaving.

import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { HealthComponent } from '../combat/damage/components';
import { World } from '../core/world';
import { CreatureComponent } from '../creatures/components';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { compileBehaviours } from './behaviour';
import { beginConversing, endConversing } from './conversing';
import { endErrand, ERRAND_WITHIN, errandOf, onErrand, sendOnErrand } from './errand';
import { giveBrain, installAi } from './runtime';
import type { AiNavigation } from './navigation';

const stroller = {
  id: 'stroller',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 60,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: { transitions: [], timeoutFrom: 'entered', postAlert: false, activities: ['go'] },
  },
  activities: {
    go: {
      weight: 1,
      interruptible: true,
      retryAfterS: 0,
      considerations: [],
      steps: [{ do: 'follow-route', dwellS: 0, gait: 'walk' }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

const loop = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 10 },
];

function setup(navigation?: AiNavigation, brain = true) {
  const world = new World<never>({ seed: 3 });
  world.register(PlacementComponent, CreatureComponent, HealthComponent);
  installAi(world, {
    behaviours: compileBehaviours([stroller]),
    ...(navigation !== undefined && { navigation }),
  });
  const npc = world.spawn();
  placeEntity(world, npc, { x: 0, y: 0, z: 0 }, 0.4);
  world.add(npc, CreatureComponent, {
    origin: { creature: 'c', at: loop[0] as Vec3, facing: { x: 0, y: 0, z: 1 }, patrol: loop },
    behaviour: 'stroller',
    tuning: {},
    needs: {},
  });
  if (brain) giveBrain(world, npc, { behaviour: 'stroller', gaits: { sneak: 1, walk: 2, run: 4 } });
  const x = (): number => world.get(npc, PlacementComponent)?.x ?? NaN;
  const z = (): number => world.get(npc, PlacementComponent)?.z ?? NaN;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, npc, x, z, run };
}

describe('errands (mw-8551)', () => {
  it('AC-1: a creature sent to a point walks there at its walking pace and the brain waits', () => {
    const { world, npc, x, z, run } = setup();
    sendOnErrand(world, npc, { x: 8, y: 0, z: 0 }, false);
    expect(onErrand(world, npc)).toBe(true);
    run(60);
    // A second at 2 m/s along x: the patrol (which heads for +z) did not run.
    expect(x()).toBeCloseTo(2, 1);
    expect(z()).toBeCloseTo(0, 5);
    run(60 * 2);
    expect(onErrand(world, npc)).toBe(true);
    run(40);
    expect(onErrand(world, npc)).toBe(false);
    expect(x()).toBeGreaterThan(8 - ERRAND_WITHIN - 0.3);
  });

  it('AC-1: on arrival an arriving creature is free and takes up its routine', () => {
    const { world, npc, z, run } = setup();
    sendOnErrand(world, npc, { x: 1, y: 0, z: 0 }, false);
    run(120);
    expect(onErrand(world, npc)).toBe(false);
    run(120);
    expect(z()).toBeGreaterThan(1);
  });

  it('AC-1: a leaving creature is gone on arrival', () => {
    const { world, npc, run } = setup();
    sendOnErrand(world, npc, { x: 2, y: 0, z: 0 }, true);
    expect(errandOf(world, npc)?.leave).toBe(true);
    run(30);
    expect(world.isAlive(npc)).toBe(true);
    run(120);
    expect(world.isAlive(npc)).toBe(false);
  });

  it('AC-3: a walk that cannot be done is dropped, not ended with the creature gone', () => {
    const blocked: AiNavigation = { travel: () => 'failure' };
    const { world, npc, run } = setup(blocked);
    sendOnErrand(world, npc, { x: 5, y: 0, z: 0 }, true);
    run(2);
    expect(world.isAlive(npc)).toBe(true);
    expect(onErrand(world, npc)).toBe(false);
  });

  it('AC-3: a conversation holds the walk where it stands and it goes on after', () => {
    const { world, npc, x, run } = setup();
    sendOnErrand(world, npc, { x: 8, y: 0, z: 0 }, true);
    run(30);
    beginConversing(world, npc, world.spawn());
    const held = x();
    run(60);
    expect(x()).toBe(held);
    expect(onErrand(world, npc)).toBe(true);
    endConversing(world, npc);
    run(30);
    expect(x()).toBeGreaterThan(held);
  });

  it('a creature that dies on its way is not walked on', () => {
    const { world, npc, x, run } = setup();
    world.add(npc, HealthComponent, { current: 0, max: 10 });
    sendOnErrand(world, npc, { x: 8, y: 0, z: 0 }, true);
    run(5);
    expect(x()).toBe(0);
    expect(onErrand(world, npc)).toBe(false);
  });

  it('walks a creature that has no brain at a default pace, and a brain with no walking pace too', () => {
    const bare = setup(undefined, false);
    sendOnErrand(bare.world, bare.npc, { x: 8, y: 0, z: 0 }, false);
    bare.run(60);
    expect(bare.x()).toBeCloseTo(1.4, 1);
    const slow = setup();
    giveBrain(slow.world, slow.world.spawn(), { behaviour: 'stroller' });
    expect(slow.x()).toBe(0);
  });

  it('ending an errand that is not on one says so, and a new one replaces the old', () => {
    const { world, npc } = setup();
    expect(endErrand(world, npc)).toBe(false);
    sendOnErrand(world, npc, { x: 1, y: 0, z: 0 }, true);
    sendOnErrand(world, npc, { x: 2, y: 0, z: 0 }, false);
    expect(errandOf(world, npc)).toEqual({ goal: { x: 2, y: 0, z: 0 }, leave: false });
    expect(endErrand(world, npc)).toBe(true);
    expect(errandOf(world, npc)).toBeUndefined();
  });
});
