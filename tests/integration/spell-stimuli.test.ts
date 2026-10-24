// Spell stimuli against real material data and the real fire rules (mw-e06.5): a spell's heat
// ignites what is flammable, opposing stimuli in one tick resolve the same way every time, and
// nothing in src/sim/magic names an object. (src/sim tests cannot load content at runtime.)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { burntMaterials, loadGameContent, materialPresets } from '@content/index';
import {
  addMaterialProperties,
  ElementRuleSet,
  elementFieldOf,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  hashWorld,
  installElementField,
  installSpells,
  installSpellVolumes,
  installStimuli,
  learnSpell,
  placeEntity,
  readProperty,
  registerWorldProperties,
  STIMULUS_ELEMENTS,
  stimulusSystem,
  World,
  type CastCommand,
  type EntityId,
} from '@sim/index';
import { makeSpell, stimulusOp } from '@sim/magic/testing';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const burnt = burntMaterials(content.all('material'));

const heatSpell = makeSpell('t-heat', {
  delivery: { kind: 'touch', reach: 5 },
  effects: [stimulusOp('heat', 400)],
});
const coldSpell = makeSpell('t-cold', {
  delivery: { kind: 'touch', reach: 5 },
  effects: [stimulusOp('cold', 300)],
});

function scene(material: string, props: Parameters<typeof addMaterialProperties>[3] = {}) {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 21, hz: 60 }))),
    { maxChunks: 16 },
  );
  elementFieldOf(world).setConductivity(
    { min: { x: -3.9, y: -3.9, z: -3.9 }, max: { x: 11.9, y: 3.9, z: 3.9 } },
    1,
  );
  const spells = new Map([heatSpell, coldSpell].map((s) => [s.id, s]));
  const pipeline = installSpells(world, { spells: (id) => spells.get(id) });
  installSpellVolumes(world, pipeline);
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(new ElementRuleSet(fireRules({ presets, burnt }))))
    .addSystem(elementFieldSystem());
  const mage = (x: number): EntityId => {
    const e = world.spawn();
    placeEntity(world, e, { x, y: 0.5, z: 0.25 }, 0.5);
    learnSpell(world, e, 't-heat');
    learnSpell(world, e, 't-cold');
    return e;
  };
  const crate = world.spawn();
  addMaterialProperties(world, crate, presets, { material, temperature: 20, ...props });
  placeEntity(world, crate, { x: 2.25, y: 0.5, z: 0.25 }, 0.5);
  return { world, mage, crate };
}

describe('spell stimuli (mw-e06.5)', () => {
  it('AC-1: a heat spell ≥ the ignition threshold sets any flammable object burning within 1 s', () => {
    const s = scene('wood');
    expect(readProperty(s.world, s.crate, 'flammable')).toBe(true);
    const caster = s.mage(0);
    s.world.step([{ type: 'cast', caster, spell: 't-heat', target: s.crate }]);
    for (let i = 0; i < 59; i++) s.world.step();
    expect(readProperty(s.world, s.crate, 'burning')).toBe(true);
  });

  it('AC-1: the same spell leaves a non-flammable object, and a soaked flammable one, unlit', () => {
    const stone = scene('stone');
    stone.world.step([
      { type: 'cast', caster: stone.mage(0), spell: 't-heat', target: stone.crate },
    ]);
    for (let i = 0; i < 59; i++) stone.world.step();
    expect(readProperty(stone.world, stone.crate, 'burning')).toBe(false);

    const soaked = scene('wood', { wetness: 1 });
    soaked.world.step([
      { type: 'cast', caster: soaked.mage(0), spell: 't-heat', target: soaked.crate },
    ]);
    for (let i = 0; i < 59; i++) soaked.world.step();
    expect(readProperty(soaked.world, soaked.crate, 'burning')).toBe(false);
  });

  it(
    'AC-5: heat and cold overlapping a burning object in one tick resolve identically on replay and in either command order',
    { timeout: 30_000 },
    () => {
      const run = (order: readonly ('t-heat' | 't-cold')[]) => {
        const s = scene('wood');
        const a = s.mage(0);
        const b = s.mage(1);
        s.world.step([{ type: 'cast', caster: a, spell: 't-heat', target: s.crate }]);
        for (let i = 0; i < 90; i++) s.world.step();
        expect(readProperty(s.world, s.crate, 'burning')).toBe(true);
        const who = { 't-heat': a, 't-cold': b };
        s.world.step(
          order.map((spell) => ({
            type: 'cast' as const,
            caster: who[spell],
            spell,
            target: s.crate,
          })),
        );
        for (let i = 0; i < 300; i++) s.world.step();
        return hashWorld(s.world);
      };
      const first = run(['t-heat', 't-cold']);
      expect(run(['t-heat', 't-cold'])).toBe(first);
      expect(run(['t-cold', 't-heat'])).toBe(first);
    },
  );
});

describe('spell stimuli are property-only (mw-e06.5)', () => {
  const dir = join(process.cwd(), 'src/sim/magic');
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'testing.ts')
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('AC-6: no magic source names a material, creature or item id (or a spell id), so interactions come from properties alone', () => {
    const elements: readonly string[] = STIMULUS_ELEMENTS;
    const ids = [
      ...content.all('material'),
      ...content.all('creature'),
      ...content.all('item'),
      ...content.all('spell'),
    ]
      .map((entry) => entry.id)
      .filter((id) => !elements.includes(id));
    expect(ids.length).toBeGreaterThan(20);
    expect(sources.length).toBeGreaterThan(5);
    for (const [file, text] of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const id of ids) {
        expect(code, `${file} names "${id}"`).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
      }
    }
  });
});
