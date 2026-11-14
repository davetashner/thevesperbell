// Conversing NPCs (mw-e22.9): a talking NPC's routine is paused and it faces the player; ending the
// conversation returns it to its route.

import type { BehaviourDef, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { CombatFacingComponent } from '../combat/melee/components';
import { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import { CreatureComponent } from '../creatures/components';
import { hashWorld } from '../snapshot';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { compileBehaviours } from './behaviour';
import {
  beginConversing,
  ConversingComponent,
  conversingEntities,
  endConversing,
  isConversing,
} from './conversing';
import { brainOf, giveBrain, installAi } from './runtime';

const walker = {
  id: 'walker',
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

const route = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
];

function setup() {
  const world = new World<never>({ seed: 3 });
  world.register(PlacementComponent, CombatFacingComponent, CreatureComponent);
  installAi(world, { behaviours: compileBehaviours([walker]) });
  const npc = world.spawn();
  placeEntity(world, npc, { x: 0, y: 0, z: 0 }, 0.4);
  world.add(
    npc,
    CombatFacingComponent,
    Object.freeze({ facing: Object.freeze({ x: 0, y: 0, z: 1 }) }),
  );
  world.add(npc, CreatureComponent, {
    origin: { creature: 'c', at: route[0] as Vec3, facing: { x: 0, y: 0, z: 1 }, patrol: route },
    behaviour: 'walker',
    tuning: {},
    needs: {},
  });
  giveBrain(world, npc, { behaviour: 'walker', gaits: { sneak: 1, walk: 1.5, run: 3 } });
  const player = world.spawn();
  placeEntity(world, player, { x: 3, y: 0, z: 0 }, 0.4);
  const x = (): number => world.get(npc, PlacementComponent)?.x ?? NaN;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) world.step();
  };
  return { world, npc, player, x, run };
}

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value');
  return value;
};

describe('conversing NPCs', () => {
  it('AC-1: a conversing NPC stops its routine and faces the player; ending it resumes the route', () => {
    const { world, npc, player, x, run } = setup();
    run(120);
    const walked = x();
    expect(walked).toBeGreaterThan(1);
    expect(beginConversing(world, npc, player, { x: 3, z: 0 })).toBe(true);
    expect(isConversing(world, npc)).toBe(true);
    expect(world.get(npc, ConversingComponent)).toEqual({ with: player, sinceTick: world.tick });
    expect(world.get(npc, CombatFacingComponent)?.facing).toEqual({ x: 1, y: 0, z: 0 });
    run(120);
    expect(x()).toBe(walked);
    expect(brainOf(world, npc)?.state).toBe('unaware');
    expect(endConversing(world, npc)).toBe(true);
    run(120);
    expect(x()).toBeGreaterThan(walked + 1);
  });

  it('is registered on first use and gone again at the end, so an unused world hashes as before', () => {
    const { world, npc, player } = setup();
    world.set(player, PlacementComponent, {
      ...must(world.get(player, PlacementComponent)),
      x: 0,
      z: 3,
    });
    const before = hashWorld(world);
    expect(world.isRegistered(ConversingComponent)).toBe(false);
    expect(conversingEntities(world)).toEqual([]);
    expect(isConversing(world, npc)).toBe(false);
    beginConversing(world, npc, player);
    expect(conversingEntities(world)).toEqual([npc]);
    expect(hashWorld(world)).not.toBe(before);
    endConversing(world, npc);
    expect(world.isRegistered(ConversingComponent)).toBe(false);
    expect(hashWorld(world)).toBe(before);
  });

  it('refuses a second conversation, an NPC that is gone, and ending one that never began', () => {
    const { world, npc, player } = setup();
    expect(endConversing(world, npc)).toBe(false);
    expect(beginConversing(world, npc, player)).toBe(true);
    expect(beginConversing(world, npc, player)).toBe(false);
    world.destroy(npc);
    world.step();
    expect(beginConversing(world, npc, player)).toBe(false);
  });

  it('two NPCs can be in conversation at once, each released on its own', () => {
    const { world, npc, player } = setup();
    const other = world.spawn();
    expect(beginConversing(world, npc, player)).toBe(true);
    expect(beginConversing(world, other, player)).toBe(true);
    expect(conversingEntities(world)).toEqual([npc, other]);
    endConversing(world, npc);
    expect(world.isRegistered(ConversingComponent)).toBe(true);
    expect(conversingEntities(world)).toEqual([other]);
  });

  it('keeps its facing when either party has no position', () => {
    const { world, npc } = setup();
    const ghost = world.spawn();
    beginConversing(world, npc, ghost);
    expect(world.get(npc, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: 1 });
  });
});
