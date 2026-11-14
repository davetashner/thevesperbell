// The Rapier CollisionWorld adapter (mw-e02.21) against the shared contract, plus what the contract
// leaves open. The fake runs the same contract in src/sim/character/fake-collision-world.test.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { describeCollisionWorldContract } from '../character/collision-world.contract';
import { box } from '../character/greybox';
import { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import { RapierPhysics } from './rapier';
import { RapierCollisionWorld } from './rapier-collision-world';
import type { ColliderHandle } from './static-colliders';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const DOWN = v(0, -1, 0);
const STANDING = { radius: 0.35, height: 1.8 };
const FLOOR = box(v(-10, -1, -10), v(10, 0, 10));

describe('AC-1: the shared CollisionWorld contract (mw-e02.21)', () => {
  describeCollisionWorldContract('RapierCollisionWorld', (shapes) => {
    const physics = new RapierPhysics(RAPIER);
    const bodies = shapes.map((shape) => physics.add(shape));
    physics.step(0); // bring scene queries up to date without moving anything
    return { world: new RapierCollisionWorld(physics), bodies };
  });
});

describe('sweeping past an ignored collider (mw-e02.17)', () => {
  it('never sees the ignored collider, and sees the next one behind it', () => {
    const physics = new RapierPhysics(RAPIER);
    const crate = physics.add(box(v(1, 0, -0.5), v(1.5, 1, 0.5)));
    const wall = physics.add(box(v(3, 0, -2), v(3.5, 2, 2)));
    physics.step(0);
    const collision = new RapierCollisionWorld(physics);
    const east = v(1, 0, 0);
    const feet = v(0, 0.1, 0);
    expect(collision.sweepCapsule(STANDING, feet, east, 5)?.body).toBe(crate);
    expect(collision.sweepCapsule(STANDING, feet, east, 5, crate)?.body).toBe(wall);
    expect(physics.rapierHandleOf(crate)).toBeTypeOf('number');
    expect(physics.rapierHandleOf(999 as ColliderHandle)).toBeUndefined();
  });
});

describe('RapierCollisionWorld (mw-e02.21)', () => {
  it('answers from the physics world as of its last step, which the World takes every tick', () => {
    const physics = new RapierPhysics(RAPIER);
    const collision = new RapierCollisionWorld(physics);
    physics.add(FLOOR);
    expect(collision.raycast(v(0, 5, 0), DOWN, 10)).toBeUndefined();
    const world = new World({ seed: 1, physics });
    const seen: (number | undefined)[] = [];
    world.addSystem({
      name: 'probe',
      run: () => {
        seen.push(collision.raycast(v(0, 5, 0), DOWN, 10)?.distance);
      },
    });
    world.step();
    expect(seen[0]).toBeCloseTo(5, 5);
  });

  it('follows a moving collider and reports its velocity', () => {
    const physics = new RapierPhysics(RAPIER);
    const platform = physics.add({ ...box(v(-1, -0.2, -1), v(1, 0, 1)), velocity: v(0, 1, 0) });
    const world = new World({ seed: 1, physics, hz: 10 });
    const collision = new RapierCollisionWorld(physics);
    for (let tick = 0; tick < 10; tick++) world.step();
    // Queries run after the step at the start of a tick: ten 0.1 s steps have raised it 1 m.
    expect(collision.sweepCapsule(STANDING, v(0, 3, 0), DOWN, 5)?.distance).toBeCloseTo(2, 3);
    expect(collision.bodyVelocity(platform)).toEqual(v(0, 1, 0));
    expect(collision.bodyVelocity(999)).toEqual(v(0, 0, 0));
  });

  it('keeps answering after the physics state is restored', () => {
    const physics = new RapierPhysics(RAPIER);
    const floor = physics.add(FLOOR);
    physics.step(0);
    const saved = physics.snapshot();
    physics.remove(floor);
    physics.restore(saved);
    const hit = new RapierCollisionWorld(physics).raycast(v(0, 5, 0), DOWN, 10);
    expect(hit?.body).toBe(floor);
  });

  it('returns plain vectors, so hits can live in snapshotted state', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(FLOOR);
    physics.step(0);
    const hit = new RapierCollisionWorld(physics).sweepCapsule(STANDING, v(0, 1, 0), DOWN, 2);
    expect(Object.getPrototypeOf(hit?.normal)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(hit?.point)).toBe(Object.prototype);
  });

  it('treats a capsule no taller than its diameter as a sphere', () => {
    const physics = new RapierPhysics(RAPIER);
    physics.add(FLOOR);
    physics.step(0);
    const collision = new RapierCollisionWorld(physics);
    const ball = { radius: 0.5, height: 0.5 };
    expect(collision.sweepCapsule(ball, v(0, 2, 0), DOWN, 5)?.distance).toBeCloseTo(2, 3);
    expect(collision.overlapCapsule(ball, v(0, -0.1, 0))).toBe(true);
    expect(collision.overlapCapsule(ball, v(0, 0.1, 0))).toBe(false);
  });

  it('refuses to name a Rapier collider its port did not add', () => {
    const physics = new RapierPhysics(RAPIER);
    expect(() => physics.handleOf(0)).toThrow('Rapier collider 0 was not added by this port');
    expect(physics.velocityOf(1 as ColliderHandle)).toEqual(v(0, 0, 0));
  });
});

describe('isStatic (mw-e04.15)', () => {
  it('is true for level geometry and false for a dynamic body, which wall recoil must not clang off', () => {
    const physics = new RapierPhysics(RAPIER);
    const wall = physics.add(box(v(3, 0, -2), v(3.5, 2, 2)));
    const ball = physics.addBody({
      shape: { kind: 'sphere', radius: 0.3 },
      position: v(0, 0.5, 0),
      mass: 1,
      friction: 0.5,
      restitution: 0,
    });
    physics.step(0);
    const collision = new RapierCollisionWorld(physics);
    expect(collision.isStatic(wall)).toBe(true);
    expect(collision.isStatic(ball)).toBe(false);
    expect(physics.isFixed(wall)).toBe(true);
    expect(physics.isFixed(999 as ColliderHandle)).toBe(false);
  });
});
