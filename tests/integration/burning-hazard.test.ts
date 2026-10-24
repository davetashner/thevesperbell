// mw-b1a AC-1 and mw-akb: a wooden prop lit by heat burns, and a creature within its reach takes fire
// damage in 250 ms pulses. The real game content drives it: the shipped wood material (a prop gets
// its temperature from it, no scene data), the game's fire rules (src/game/fire.ts) and the shipped
// environmental damage rules, on the sim's Rapier physics.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  loadGameContent,
  materialPresets,
  PLAYER_CONTROLLER_ID,
} from '@content/index';
import { installGameFire } from '@game/fire';
import {
  addMaterialProperties,
  applyStimulus,
  box,
  CharacterController,
  characterControllerSystem,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  fireIgnited,
  giveCombatant,
  healthOf,
  installEnvironmentDamage,
  installPhysicsObjects,
  installStimuli,
  placeEntity,
  RapierCollisionWorld,
  RapierPhysics,
  readProperty,
  registerWorldProperties,
  SKIN,
  spawnCharacter,
  stimulusSystem,
  World,
  type DamageResult,
} from '@sim/index';

describe('burning hazards in the game world (mw-b1a, mw-akb)', () => {
  it('AC-1: a creature within reach of a burning wooden prop takes fire damage in 250 ms pulses', () => {
    const content = loadGameContent();
    const rules = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 3, physics })));
    installPhysicsObjects(world);
    world.register(CharacterController, ...DAMAGE_COMPONENTS);
    physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
    world.addSystem(stimulusSystem());
    world.addSystem(
      characterControllerSystem({
        collision: new RapierCollisionWorld(physics),
        tuning,
        input: () => undefined,
      }),
    );
    installEnvironmentDamage(world, {
      damage: new DamageModel(),
      tuning: rules,
      capsule: tuning.capsule,
    });
    installGameFire(world, content);
    const crate = world.spawn();
    // No temperature given: the wood material makes the prop heat-reachable.
    addMaterialProperties(world, crate, materialPresets(content.all('material')), {
      material: 'wood',
    });
    placeEntity(world, crate, { x: 0, y: 0.5, z: 0 }, 0.5);
    const knight = spawnCharacter(world, { x: 0.5, y: SKIN, z: 0 });
    giveCombatant(world, knight, { health: 1000 });
    const lit: number[] = [];
    world.events.on(fireIgnited, (e) => lit.push(e.entity));
    const hits: DamageResult[] = [];
    world.events.on(DamageApplied, (r) => {
      if (r.target === knight) hits.push(r);
    });
    world.step();
    expect(readProperty(world, crate, 'temperature')).toBe(20);
    applyStimulus(world, {
      shape: { kind: 'contact', target: crate },
      element: 'heat',
      intensity: 500,
    });
    for (let i = 0; i < 90 && lit.length === 0; i++) world.step();
    expect(lit).toContain(crate);
    hits.length = 0;
    for (let i = 0; i < 120; i++) world.step(); // 2 s at 60 Hz
    const fire = hits.filter((h) => h.packet.tags.includes('hazard'));
    expect(fire.length).toBeGreaterThanOrEqual(7);
    expect(fire.length).toBeLessThanOrEqual(8);
    expect(fire.every((h) => h.packet.amounts.fire === 2)).toBe(true);
    expect(healthOf(world, knight)?.current).toBeLessThan(1000);
  }, 30_000);
});
