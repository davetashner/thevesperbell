// mw-e17.14 AC-5: a quest-critical world object that leaves the scene returns to its recovery anchor
// and says so once (real Rapier world, no floor under the object so it falls past the kill plane).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { addProperties, registerWorldProperties } from '../properties/components';
import { registerSceneComponents } from '../scene/loader';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli } from '../stimulus/stimulus';
import {
  addRecoveryAnchor,
  installObjectRecovery,
  objectRecovered,
  type ObjectRecovered,
  type ObjectRecoveryOptions,
} from './recovery';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function setup(options: ObjectRecoveryOptions | (() => ObjectRecoveryOptions) = { killY: -10 }) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 2, physics }))),
  );
  installPhysicsObjects(world);
  // A floor patch with its top at y = 1 (x 1…5 and z −4…2, and a wide one past x = 20): the anchors
  // rest on it; everywhere else is a drop.
  physics.add(box(v(1, 0, -4), v(5, 1, 2)));
  physics.add(box(v(25, 0, -5), v(40, 1, 5)));
  installObjectRecovery(world, options);
  const recovered: ObjectRecovered[] = [];
  world.events.on(objectRecovered, (e) => recovered.push(e));
  /** A 20 kg box whose base rests at `at`, optionally anchored at `anchor`. */
  const object = (at: Vec3, anchor?: Vec3): EntityId => {
    const entity = world.spawn();
    addProperties(world, entity, { liftable: true, weight: 20 });
    addPhysicsObject(world, entity, {
      shape: { kind: 'box', halfExtents: v(0.25, 0.25, 0.25) },
      position: v(at.x, at.y + 0.25, at.z),
    });
    if (anchor !== undefined) addRecoveryAnchor(world, entity, anchor);
    return entity;
  };
  return { world, recovered, object };
}

const run = (world: World<never>, ticks: number): void => {
  for (let i = 0; i < ticks; i += 1) world.step();
};

describe('recovery anchors (mw-e17.14)', () => {
  it('AC-5: a quest-critical object below the kill plane reappears at its anchor and emits object.recovered once', () => {
    const s = setup();
    const anchor = v(3, 1, -2);
    const statue = s.object(v(0, 5, 0), anchor);
    run(s.world, 600); // no floor: it falls well past y = −10
    expect(s.recovered).toHaveLength(1);
    expect(s.recovered[0]).toMatchObject({
      entity: statue,
      reason: 'below-kill-plane',
      to: anchor,
    });
    expect(s.recovered[0]?.from.y).toBeLessThan(-10);
    // Back at rest on its anchor: the base (a quarter metre under the centre) is at the anchor.
    const at = placementOf(s.world, statue);
    expect(at?.x).toBeCloseTo(3, 3);
    expect(at?.z).toBeCloseTo(-2, 3);
    expect(at?.y).toBeCloseTo(1.25, 2);
    // It is not recovered again while it sits in bounds (and has no speed left from the fall).
    s.world.events.flush();
    const count = s.recovered.length;
    run(s.world, 5);
    expect(s.recovered.length).toBe(count);
  });

  it('is also recovered when it leaves the bounds of the scene', () => {
    const bounds = { min: v(-10, -5, -10), max: v(10, 20, 10) };
    const s = setup({ killY: -50, bounds });
    const inside = s.object(v(2, 5, 0), v(2, 1, 0));
    const outside = s.object(v(30, 5, 0), v(1, 1, 1));
    s.world.step();
    s.world.events.flush();
    expect(s.recovered.map((r) => [r.entity, r.reason])).toEqual([[outside, 'out-of-bounds']]);
    expect(placementOf(s.world, outside)).toMatchObject({ x: 1, z: 1 });
    expect(placementOf(s.world, inside)?.x).toBeCloseTo(2, 1);
  });

  it('an object with no anchor is left alone, and the scene’s limits are read live', () => {
    let killY = -1000;
    const s = setup(() => ({ killY }));
    const plain = s.object(v(0, 5, 0));
    const anchored = s.object(v(-3, 5, 0), v(2, 1, 0));
    run(s.world, 300);
    expect(s.recovered).toEqual([]);
    killY = -10;
    run(s.world, 300);
    expect(s.recovered.map((r) => r.entity)).toEqual([anchored]);
    expect(placementOf(s.world, plain)?.y).toBeLessThan(-10);
  });

  it('a sphere or a capsule comes to rest on its anchor like a box does', () => {
    const s = setup();
    const ball = s.world.spawn();
    addProperties(s.world, ball, { liftable: true, weight: 5 });
    addPhysicsObject(s.world, ball, {
      shape: { kind: 'sphere', radius: 0.3 },
      position: v(0, 5, 0),
    });
    addRecoveryAnchor(s.world, ball, v(3, 1, 0));
    const log = s.world.spawn();
    addProperties(s.world, log, { liftable: true, weight: 5 });
    addPhysicsObject(s.world, log, {
      shape: { kind: 'capsule', halfHeight: 0.4, radius: 0.2 },
      position: v(-3, 5, 0),
    });
    addRecoveryAnchor(s.world, log, v(3, 1, 1));
    run(s.world, 600);
    s.world.events.flush();
    expect(s.recovered.map((r) => r.entity).sort()).toEqual([ball, log].sort());
    expect(s.world.get(ball, PhysicsObjectComponent)?.position.y).toBeCloseTo(1.3, 1);
    expect(s.world.get(log, PhysicsObjectComponent)?.position.y).toBeCloseTo(1.6, 1);
  });

  it('installs after a scene has already given an object its anchor', () => {
    const world = registerWorldProperties(
      new World<never>({ seed: 2, physics: new RapierPhysics(RAPIER) }),
    );
    installPhysicsObjects(world);
    addRecoveryAnchor(world, world.spawn(), v(1, 1, 1));
    expect(() => {
      installObjectRecovery(world, { killY: -10 });
      world.step();
    }).not.toThrow();
  });
});
