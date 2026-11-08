// mw-e02.26: interaction reach in the testbed as the game wires it (createTestbedWorld: Rapier
// physics, scene props as physics objects, the player with interaction and `physicsBodiesOf`). A
// physics prop's own collider must not hide it from reach; anything else solid still does.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  addProperties,
  box,
  InteractionFocusComponent,
  PhysicsObjectComponent,
  PlayerLook,
  SceneSpawnComponent,
  type ActionFrame,
  type EntityId,
  type RapierPhysics,
  type World,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';

function only(world: World<ActionFrame>, predicate: (id: EntityId) => boolean): EntityId {
  const found = world.query(SceneSpawnComponent).ids().filter(predicate);
  if (found.length !== 1 || found[0] === undefined) throw new Error('expected one entity');
  return found[0];
}

/** The testbed with its loose crate liftable and the player turned to face it. */
function facingCrate() {
  const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
  const crate = only(world, (id) => world.get(id, SceneSpawnComponent)?.id === 'loose-crate');
  const [player] = world.query(PlayerLook).ids();
  if (player === undefined) throw new Error('no player');
  expect(world.has(crate, PhysicsObjectComponent)).toBe(true);
  addProperties(world, crate, { liftable: true });
  // The player stands at (0, 0, −1); the crate at (−1, 0, −2): 45° to the left of −z.
  world.set(player, PlayerLook, { yaw: Math.PI / 4, pitch: 0 });
  return { world, crate, player };
}

describe('interaction reach with physics objects (mw-e02.26)', () => {
  it("AC-1: a liftable physics crate in reach and view takes focus; its own collider doesn't block it", () => {
    const { world, crate, player } = facingCrate();
    for (let i = 0; i < 5; i++) world.step([]);
    expect(world.get(player, InteractionFocusComponent)?.target).toBe(crate);
  });

  it('AC-2: the same crate behind a wall is not focused', () => {
    const { world, crate, player } = facingCrate();
    const physics = world.physics as RapierPhysics;
    physics.add(box({ x: -0.6, y: 0, z: -1.6 }, { x: -0.3, y: 2, z: -1.3 }));
    for (let i = 0; i < 5; i++) world.step([]);
    // The testbed's bottle (mw-e02.38) stands in the same view cone, so only the crate is ruled out.
    expect(world.get(player, InteractionFocusComponent)?.target).not.toBe(crate);
  });
});
