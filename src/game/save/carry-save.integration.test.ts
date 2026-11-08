// mw-e17.14 AC-4: a save written while the player carries a body stores the body as a placed world
// object at the carrier's feet, and a load finds the player not carrying (real save registry, real
// Rapier world).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  addInteractor,
  box,
  addPhysicsObject,
  addProperties,
  CarryBulkyComponent,
  CharacterController,
  holdOf,
  holdsOf,
  initialCharacterState,
  installCarry,
  installInteraction,
  installPhysicsObjects,
  installStimuli,
  PhysicsObjectComponent,
  PlayerLook,
  placementOf,
  RapierPhysics,
  registerSceneComponents,
  registerWorldProperties,
  stimulusSystem,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** The player at the origin of a flat stone floor with a body 1 m ahead, carrying installed. */
function scene() {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World({ seed: 5, physics }))),
  );
  world.register(CharacterController, PlayerLook);
  installPhysicsObjects(world);
  physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
  world.addSystem(stimulusSystem());
  installInteraction(world);
  const carry = installCarry(world, {});
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player);
  const body = world.spawn();
  addProperties(world, body, { liftable: true, weight: 70 });
  world.add(body, CarryBulkyComponent, { kind: 'body' });
  addPhysicsObject(world, body, {
    shape: { kind: 'box', halfExtents: { x: 0.3, y: 0.2, z: 0.6 } },
    position: { x: 0, y: 0.2, z: -1 },
  });
  return { world, carry, player, body };
}

const feetY = (world: World, entity: EntityId): number => placementOf(world, entity)?.y ?? NaN;

describe('saving while carrying (mw-e17.14)', () => {
  it('AC-4: the body is saved as a placed object at the carrier’s feet and the load is not carrying', () => {
    const saved = scene();
    saved.world.step();
    expect(saved.carry.pickUp(saved.player, saved.body)).toEqual({ ok: true });
    saved.world.step();
    // Held: riding at chest height in front of the carrier.
    expect(feetY(saved.world, saved.body)).toBeGreaterThan(0.9);

    const registry = createGameSaveRegistry();
    const bytes = registry.write(saved.world, options);
    // The running game agrees with the save: the hold is gone, the body rests on the floor.
    expect(holdsOf(saved.world)).toEqual([]);
    const rest = placementOf(saved.world, saved.body);
    expect(rest?.y).toBeCloseTo(0.2, 1);
    expect(Math.hypot(rest?.x ?? 0, rest?.z ?? 0)).toBeLessThan(1.5);

    for (let i = 0; i < 30; i++) saved.world.step();
    expect(placementOf(saved.world, saved.body)?.y).toBeCloseTo(0.2, 1);
    const loaded = scene();
    expect(registry.read(loaded.world, bytes)).toMatchObject({ ok: true });
    expect(holdOf(loaded.world, loaded.player)).toBeUndefined();
    expect(holdsOf(loaded.world)).toEqual([]);
    const object = loaded.world.get(loaded.body, PhysicsObjectComponent);
    expect(object?.position.y).toBeCloseTo(0.2, 1);
    expect(placementOf(loaded.world, loaded.body)).toMatchObject({ x: rest?.x, z: rest?.z });
    // It stays where it was put when the world steps on.
    for (let i = 0; i < 30; i++) loaded.world.step();
    expect(placementOf(loaded.world, loaded.body)?.y).toBeCloseTo(0.2, 1);
  });

  it('a save written with nothing carried leaves the world as it was', () => {
    const quiet = scene();
    quiet.world.step();
    const before = placementOf(quiet.world, quiet.body);
    createGameSaveRegistry().write(quiet.world, options);
    expect(placementOf(quiet.world, quiet.body)).toEqual(before);
  });
});
