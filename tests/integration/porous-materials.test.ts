// mw-e03.59: wood, straw, cloth, rope and paper soak up water by default (material-level wetness and
// absorbency), so rain, rivers and Frost act on a plain crate with no per-spawn overrides: it gets
// wet up to its absorbency, soaked wood freezes in the cold, dry wood only chills, and soaked wood
// will not catch fire.
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import { markExercised } from '@content/testing';
import {
  addMaterialProperties,
  applyStimulus,
  ElementRuleSet,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  freezeRules,
  hasProperty,
  installElementField,
  installIce,
  installLiquids,
  installStimuli,
  placeEntity,
  readProperty,
  registerWorldProperties,
  stimulusSystem,
  World,
} from '@sim/index';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const SOAKED = 0.5; // wetness at which a fire goes out (mw-e03.5)

/** One plain crate of `material`, spawned with no property overrides, in open air. */
function crateWorld(material: string) {
  const world = new World<never>({ seed: 3, hz: 60 });
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 16 });
  installLiquids(world);
  installIce(world);
  world
    .addSystem(stimulusSystem())
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([...fireRules({ presets, burnt: new Map() }), ...freezeRules()]),
      ),
    )
    .addSystem(elementFieldSystem());
  const crate = world.spawn();
  addMaterialProperties(world, crate, presets, { material });
  placeEntity(world, crate, { x: 0.5, y: 0.5, z: 0.5 }, 0.5);
  return { world, crate };
}

const stimulus = (
  world: World<never>,
  target: number,
  element: 'water' | 'cold' | 'heat',
  n: number,
) => applyStimulus(world, { shape: { kind: 'contact', target }, element, intensity: n });

function soak(material: string) {
  const scene = crateWorld(material);
  for (let i = 0; i < 4; i++) stimulus(scene.world, scene.crate, 'water', 1);
  scene.world.step([]);
  return scene;
}

describe('porous materials soak and freeze by default (mw-e03.59)', () => {
  it('AC-1: a plain wood crate starts dry and water soaks it to its absorbency, no higher', ({
    task,
  }) => {
    markExercised(task, 'material', 'wood');
    const { world, crate } = crateWorld('wood');
    expect(hasProperty(world, crate, 'wetness')).toBe(true);
    expect(readProperty(world, crate, 'wetness')).toBe(0);
    expect(readProperty(world, crate, 'absorbency')).toBe(0.6);
    for (let i = 0; i < 6; i++) stimulus(world, crate, 'water', 0.3);
    world.step([]);
    expect(readProperty(world, crate, 'wetness')).toBeCloseTo(0.6, 9);
    stimulus(world, crate, 'water', 1);
    world.step([]);
    expect(readProperty(world, crate, 'wetness')).toBeCloseTo(0.6, 9);
  });

  it('AC-2: a soaked wood crate freezes in the cold, with no per-spawn freeze point', () => {
    const { world, crate } = soak('wood');
    expect(readProperty(world, crate, 'wetness')).toBeGreaterThanOrEqual(SOAKED);
    for (let i = 0; i < 120 && !readProperty(world, crate, 'frozen'); i++) {
      if (i === 0) stimulus(world, crate, 'cold', 60);
      world.step([]);
    }
    expect(readProperty(world, crate, 'frozen')).toBe(true);
    expect(readProperty(world, crate, 'temperature')).toBeLessThanOrEqual(0);
  });

  it('AC-3: a dry wood crate in the same cold chills but does not freeze', () => {
    const { world, crate } = crateWorld('wood');
    stimulus(world, crate, 'cold', 60);
    let coldest = 20;
    for (let i = 0; i < 120; i++) {
      world.step([]);
      coldest = Math.min(coldest, readProperty(world, crate, 'temperature'));
    }
    expect(coldest).toBeLessThanOrEqual(0);
    expect(readProperty(world, crate, 'frozen')).toBe(false);
  });

  it('AC-4: a soaked wood crate will not light, a dry one does', () => {
    const wet = soak('wood');
    const dry = crateWorld('wood');
    for (const { world, crate } of [wet, dry]) {
      stimulus(world, crate, 'heat', 400);
      for (let i = 0; i < 30; i++) world.step([]);
    }
    expect(readProperty(wet.world, wet.crate, 'burning')).toBe(false);
    expect(readProperty(dry.world, dry.crate, 'burning')).toBe(true);
  });

  it.each(['dry-wood', 'straw', 'cloth', 'rope', 'paper'])(
    'AC-5: %s carries wetness and soaks past the point that puts a fire out',
    (material) => {
      const { world, crate } = crateWorld(material);
      expect(readProperty(world, crate, 'wetness')).toBe(0);
      expect(readProperty(world, crate, 'absorbency')).toBeGreaterThanOrEqual(SOAKED);
      const soaked = soak(material);
      expect(readProperty(soaked.world, soaked.crate, 'wetness')).toBeGreaterThanOrEqual(SOAKED);
    },
  );
});
