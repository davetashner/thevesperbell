import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import {
  addMaterialProperties,
  addProperties,
  applyStimulus,
  ElementFieldComponent,
  entitiesWithProperty,
  fireIgnited,
  installStimuli,
  placeEntity,
  readProperty,
  registerWorldProperties,
  stimulusSystem,
  World,
} from '@sim/index';
import { installGameFire, settleAuthoredFires } from './fire';

describe('fire in the game (mw-e06.15)', () => {
  it('heat on a wooden crate sets it alight through the installed fire rules', () => {
    const content = loadGameContent();
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    world.addSystem(stimulusSystem());
    installGameFire(world, content);
    expect(world.isRegistered(ElementFieldComponent)).toBe(true);
    const crate = world.spawn();
    addMaterialProperties(world, crate, materialPresets(content.all('material')), {
      material: 'wood',
      temperature: 20,
    });
    placeEntity(world, crate, { x: 0, y: 0.5, z: 0 }, 0.5);
    const lit: number[] = [];
    world.events.on(fireIgnited, (e) => lit.push(e.entity));
    applyStimulus(world, {
      shape: { kind: 'contact', target: crate },
      element: 'heat',
      intensity: 500,
    });
    for (let i = 0; i < 90 && lit.length === 0; i++) world.step([]);
    expect(lit).toContain(crate);
    expect(readProperty(world, crate, 'burning')).toBe(true);
    expect(entitiesWithProperty(world, 'burning')).toContain(crate);
  }, 30_000); // loads game content and steps Rapier; overran the 5 s default on CI

  it('an authored torch (burning, no temperature) would go out cold; settled, it keeps burning', () => {
    const content = loadGameContent();
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 1 })));
    world.addSystem(stimulusSystem());
    installGameFire(world, content);
    const torch = world.spawn();
    addProperties(world, torch, { flammable: true, burning: true, fuel: 3600 });
    placeEntity(world, torch, { x: 0, y: 2, z: 0 }, 0.1);
    const crate = world.spawn();
    addMaterialProperties(world, crate, materialPresets(content.all('material')), {
      material: 'wood',
      temperature: 20,
    });
    const hot = world.spawn();
    addProperties(world, hot, { flammable: true, burning: true, temperature: 900 });
    const out = world.spawn();
    addProperties(world, out, { flammable: true, burning: false });
    expect(settleAuthoredFires(world)).toBe(1);
    expect(settleAuthoredFires(world)).toBe(0);
    for (let i = 0; i < 300; i++) world.step([]);
    expect(readProperty(world, torch, 'burning')).toBe(true);
    expect(readProperty(world, torch, 'temperature')).toBeGreaterThanOrEqual(300);
    expect(readProperty(world, crate, 'burning')).toBe(false);
  }, 30_000);
});
