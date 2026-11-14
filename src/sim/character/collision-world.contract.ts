// The CollisionWorld contract (mw-e02.2): the behaviour the character controller relies on, as a
// reusable Vitest suite. The in-memory fake runs it (fake-collision-world.test.ts) and the Rapier port
// (mw-e02.21) must pass it unchanged against the same greybox scenes, so the controller behaves the
// same on both. Only face contacts are pinned: edges and corners legitimately differ between an
// exact rounded Minkowski sum and the fake's sharp one.
//
// Test-only: imports vitest, so it is not exported from index.ts.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../stimulus/shapes';
import type { BodyId, Capsule, CollisionWorld } from './collision-world';
import { box, rampAt, type GreyboxShape } from './greybox';
import { cos, sin } from '../math';

/** A world built from `shapes`, with the id of each shape's collider in the same order. */
export interface ContractWorld {
  readonly world: CollisionWorld;
  readonly bodies: readonly BodyId[];
}

/** Builds a CollisionWorld holding exactly `shapes` (static unless a shape has a velocity). */
export type MakeContractWorld = (shapes: readonly GreyboxShape[]) => ContractWorld;

/** Distance and position tolerance, metres (room for an engine's iterative shape casts). */
const TOL = 1e-3;

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const UP = v(0, 1, 0);
const DOWN = v(0, -1, 0);
const EAST = v(1, 0, 0);
const WEST = v(-1, 0, 0);

const STANDING: Capsule = { radius: 0.35, height: 1.8 };
const CROUCHED: Capsule = { radius: 0.35, height: 1.0 };

/** A 20 m square floor whose top is at y = 0. */
const FLOOR = box(v(-10, -1, -10), v(10, 0, 10));
/** A wall whose west face is at x = 2. */
const WALL = box(v(2, 0, -5), v(3, 3, 5));

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  expect(actual?.x).toBeCloseTo(expected.x, 3);
  expect(actual?.y).toBeCloseTo(expected.y, 3);
  expect(actual?.z).toBeCloseTo(expected.z, 3);
}

/** Runs the CollisionWorld contract against worlds built by `makeWorld`. */
export function describeCollisionWorldContract(label: string, makeWorld: MakeContractWorld): void {
  describe(`CollisionWorld contract: ${label}`, () => {
    describe('sweepCapsule', () => {
      it('lands on a floor: the gap as distance, an up normal, the contact on the top face', () => {
        const { world, bodies } = makeWorld([FLOOR]);
        const hit = world.sweepCapsule(STANDING, v(1, 0.5, -1), DOWN, 2);
        expect(hit?.distance).toBeCloseTo(0.5, 3);
        expectVec(hit?.normal, UP);
        expectVec(hit?.point, v(1, 0, -1));
        expect(hit?.body).toBe(bodies[0]);
      });

      it('meets a wall at radius from its face, with the face normal and a point on the face', () => {
        const { world } = makeWorld([WALL]);
        const hit = world.sweepCapsule(STANDING, v(0, 0.1, 0), EAST, 5);
        expect(hit?.distance).toBeCloseTo(2 - STANDING.radius, 3);
        expectVec(hit?.normal, WEST);
        expect(hit?.point.x).toBeCloseTo(2, 3);
        expect(hit?.point.y).toBeGreaterThanOrEqual(0.1 - TOL);
        expect(hit?.point.y).toBeLessThanOrEqual(1.9 + TOL);
      });

      it('does not see the collider it is told to ignore, but sees the ones behind it', () => {
        const front = box(v(1, 0, -1), v(1.5, 2, 1));
        const { world, bodies } = makeWorld([front, WALL]);
        expect(world.sweepCapsule(STANDING, v(0, 0.1, 0), EAST, 5)?.body).toBe(bodies[0]);
        expect(world.sweepCapsule(STANDING, v(0, 0.1, 0), EAST, 5, bodies[0])?.body).toBe(
          bodies[1],
        );
      });

      it('reports nothing when the path is clear or contact lies beyond maxDistance', () => {
        const { world } = makeWorld([WALL, box(v(-3, 0, 4), v(3, 0.2, 6))]);
        expect(world.sweepCapsule(STANDING, v(0, 0.1, 0), EAST, 1)).toBeUndefined();
        expect(world.sweepCapsule(STANDING, v(0, 0.1, 0), WEST, 5)).toBeUndefined();
        // Passing over a low box whose top is below the feet.
        expect(world.sweepCapsule(STANDING, v(-2, 0.3, 5), EAST, 3)).toBeUndefined();
      });

      it('reports the nearest of several colliders', () => {
        const { world, bodies } = makeWorld([box(v(4, 0, -5), v(5, 3, 5)), WALL]);
        const hit = world.sweepCapsule(STANDING, v(0, 0.1, 0), EAST, 10);
        expect(hit?.body).toBe(bodies[1]);
        expect(hit?.distance).toBeCloseTo(2 - STANDING.radius, 3);
      });

      it('lets a capsule resting on a floor slide along it and lift off, but not sink into it', () => {
        const { world } = makeWorld([FLOOR]);
        const feet = v(0, 0, 0);
        expect(world.sweepCapsule(STANDING, feet, EAST, 1)).toBeUndefined();
        expect(world.sweepCapsule(STANDING, feet, UP, 1)).toBeUndefined();
        const hit = world.sweepCapsule(STANDING, feet, DOWN, 1);
        expect(hit?.distance).toBeLessThanOrEqual(TOL);
        expectVec(hit?.normal, UP);
      });

      it('stops under a ceiling by the capsule top', () => {
        const { world } = makeWorld([box(v(-2, 2.5, -2), v(2, 3, 2))]);
        const hit = world.sweepCapsule(STANDING, v(0, 0, 0), UP, 2);
        expect(hit?.distance).toBeCloseTo(0.7, 3);
        expectVec(hit?.normal, DOWN);
      });

      it('reports a ramp’s slope normal and a contact point on its surface', () => {
        const ramp = rampAt(v(0, 0, -2), 30, 1, 4);
        const { world } = makeWorld([ramp]);
        const a = (30 * Math.PI) / 180;
        const hit = world.sweepCapsule(STANDING, v(0.9, 2, 0), DOWN, 3);
        expectVec(hit?.normal, v(-sin(a), cos(a), 0));
        // The sphere centre above x = 0.9 rests one radius off the slope plane (through the origin).
        const r = STANDING.radius;
        const centreY = (r + sin(a) * 0.9) / cos(a);
        expect(hit?.distance).toBeCloseTo(2 + r - centreY, 3);
        expectVec(hit?.point, v(0.9 + sin(a) * r, centreY - cos(a) * r, 0));
        expect(hit?.point.x).toBeLessThan(ramp.max.x);
      });

      it('gives the same answer every time', () => {
        const { world } = makeWorld([FLOOR, WALL]);
        const dir = v(0.6, -0.8, 0);
        expect(world.sweepCapsule(STANDING, v(0, 1, 0), dir, 4)).toEqual(
          world.sweepCapsule(STANDING, v(0, 1, 0), dir, 4),
        );
      });
    });

    describe('raycast', () => {
      it('hits the first face along the ray with its normal and point', () => {
        const { world, bodies } = makeWorld([FLOOR]);
        const hit = world.raycast(v(1, 5, 2), DOWN, 10);
        expect(hit?.distance).toBeCloseTo(5, 3);
        expectVec(hit?.normal, UP);
        expectVec(hit?.point, v(1, 0, 2));
        expect(hit?.body).toBe(bodies[0]);
      });

      it('misses when pointing away or when the face is beyond maxDistance', () => {
        const { world } = makeWorld([FLOOR]);
        expect(world.raycast(v(0, 5, 0), UP, 10)).toBeUndefined();
        expect(world.raycast(v(0, 5, 0), DOWN, 4)).toBeUndefined();
      });

      it('reports the nearest collider and a ramp’s slope normal', () => {
        const { world, bodies } = makeWorld([FLOOR, rampAt(v(0, 0, -2), 30, 1, 4)]);
        const hit = world.raycast(v(1, 5, 0), DOWN, 10);
        const a = (30 * Math.PI) / 180;
        expect(hit?.body).toBe(bodies[1]);
        expectVec(hit?.normal, v(-sin(a), cos(a), 0));
        expect(hit?.distance).toBeCloseTo(5 - (1 * sin(a)) / cos(a), 3);
      });
    });

    describe('overlapCapsule', () => {
      const CEILING = box(v(-2, 1.2, -2), v(2, 2, 2));

      it('finds a ceiling too low to stand under but high enough to crouch under', () => {
        const { world } = makeWorld([FLOOR, CEILING]);
        const feet = v(0, 0.01, 0);
        expect(world.overlapCapsule(STANDING, feet)).toBe(true);
        expect(world.overlapCapsule(CROUCHED, feet)).toBe(false);
      });

      it('is clear away from colliders and true for a capsule inside a solid', () => {
        const { world } = makeWorld([FLOOR, CEILING]);
        expect(world.overlapCapsule(STANDING, v(5, 0.01, 0))).toBe(false);
        expect(world.overlapCapsule(STANDING, v(0, -0.5, 0))).toBe(true);
      });
    });

    describe('isStatic (mw-e04.15)', () => {
      it('is true for level geometry and false for a collider that moves', () => {
        const platform: GreyboxShape = { ...box(v(0, 0, 0), v(2, 0.2, 2)), velocity: v(1.5, 0, 0) };
        const { world, bodies } = makeWorld([FLOOR, platform]);
        const [floor = 0, moving = 0] = bodies;
        const asked = world as Required<CollisionWorld>;
        expect(asked.isStatic(floor)).toBe(true);
        expect(asked.isStatic(moving)).toBe(false);
        expect(asked.isStatic(9999)).toBe(false);
      });
    });

    describe('bodyVelocity', () => {
      it('is zero for static colliders and the set velocity for moving ones', () => {
        const platform: GreyboxShape = { ...box(v(0, 0, 0), v(2, 0.2, 2)), velocity: v(1.5, 0, 0) };
        const { world, bodies } = makeWorld([FLOOR, platform]);
        const [still, moving] = bodies.map((body) => world.bodyVelocity(body));
        expectVec(still, v(0, 0, 0));
        expectVec(moving, v(1.5, 0, 0));
      });
    });
  });
}
