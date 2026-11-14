// mw-e03.8: conduction budget. A scene full of conductors with no charge in it must cost next to
// nothing (the rules look at the charge component and stop), and a live strike over a capped
// 256-node network (graph cached, flood, shock, discharge) must stay well inside a tick: each mean
// ≤ 1 ms on the Node baseline.
import { describe, expect, test } from 'vitest';
import {
  addMaterialProperties,
  conductionRules,
  ElementRuleSet,
  installElementField,
  installLiquids,
  placeEntity,
  registerWorldProperties,
  setProperty,
  installStimuli,
  World,
  type MaterialPresets,
  type WorldPropertyInit,
} from '@sim/index';

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['iron', { conductive: true, absorbency: 0.1 }],
]);

function scene(count: number) {
  const world = new World<never>({ seed: 1, hz: 60 });
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 4 });
  installLiquids(world);
  const rules = new ElementRuleSet(conductionRules());
  const first = world.spawn();
  for (let i = 0; i < count; i++) {
    const entity = i === 0 ? first : world.spawn();
    addMaterialProperties(world, entity, PRESETS, { material: 'iron' });
    placeEntity(world, entity, { x: i * 0.9, y: 0, z: 0 }, 0.5);
  }
  world.step(); // spawns land
  return { world, rules, first };
}

describe('conduction', () => {
  test('1,000 conductors with no charge: the rules average ≤ 0.1 ms', async ({ bench }) => {
    const { world, rules } = scene(1000);
    const result = await bench('conduction rules, no charge', () => {
      rules.run(world);
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(0.1);
  });

  test('a 256-node network with charge in it: the rules average ≤ 1 ms', async ({ bench }) => {
    const { world, rules, first } = scene(256);
    const result = await bench('conduction rules, charged chain', () => {
      setProperty(world, first, 'charge', 1000); // a strike on one end every tick
      rules.run(world);
    }).run();
    expect(result.latency.mean).toBeLessThanOrEqual(1);
  });
});
