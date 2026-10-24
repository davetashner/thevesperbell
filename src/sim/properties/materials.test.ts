import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { getProperty, readProperty, registerWorldProperties } from './components';
import {
  addMaterialProperties,
  applyMaterial,
  resolveProperties,
  type MaterialPresets,
} from './materials';
import { WORLD_PROPERTY_KEYS, WORLD_PROPERTY_SPECS } from './spec';

const presets: MaterialPresets = new Map([
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 120, density: 700, friction: 0.5 }],
  ['ice', { frozen: true, temperature: -5, friction: 0.05, transparent: true }],
]);

describe('material presets', () => {
  it('AC-2: material=wood with weight=3 resolves weight 3 and every other property from wood', () => {
    const resolved = resolveProperties(presets, { material: 'wood', weight: 3 });
    expect(resolved.weight).toBe(3);
    expect(resolved).toMatchObject({
      material: 'wood',
      flammable: true,
      ignitionPoint: 300,
      fuel: 120,
      density: 700,
      friction: 0.5,
    });
  });

  it('object value > preset > global default', () => {
    const resolved = resolveProperties(presets, { material: 'wood', friction: 0.9 });
    expect(resolved.friction).toBe(0.9); // object
    expect(resolved.density).toBe(700); // preset
    expect(resolved.hp).toBe(WORLD_PROPERTY_SPECS.hp.default); // global default
    expect(Object.keys(resolved).sort()).toEqual([...WORLD_PROPERTY_KEYS]);
  });

  it('applyMaterial merges sparsely and never mutates its inputs', () => {
    const init = { material: 'ice', friction: 0.2 };
    expect(applyMaterial(presets, init)).toEqual({
      material: 'ice',
      frozen: true,
      temperature: -5,
      friction: 0.2,
      transparent: true,
    });
    expect(init).toEqual({ material: 'ice', friction: 0.2 });
    expect(presets.get('ice')?.friction).toBe(0.05);
  });

  it('an object without a material gets only its own values and the global defaults', () => {
    const init = { weight: 2 };
    const applied = applyMaterial(presets, init);
    expect(applied).toEqual({ weight: 2 });
    expect(applied).not.toBe(init);
    const resolved = resolveProperties(presets, init);
    expect(resolved.material).toBe(WORLD_PROPERTY_SPECS.material.default);
    expect(resolved.flammable).toBe(false);
  });

  it('AC-3: an unknown material id throws naming the id and the known materials', () => {
    expect(() => applyMaterial(presets, { material: 'mithril' })).toThrow(
      new RangeError('unknown material "mithril"; known materials: ice, wood'),
    );
  });

  it('rejects an invalid override while resolving', () => {
    expect(() => resolveProperties(presets, { material: 'wood', wetness: 2 })).toThrow(
      /wetness must be ≤ 1/,
    );
  });

  it('addMaterialProperties stores the preset and overrides, leaving the rest to defaults', () => {
    const w = registerWorldProperties(new World<string>({ seed: 1 }));
    const id = w.spawn();
    addMaterialProperties(w, id, presets, { material: 'wood', weight: 3 });
    expect(getProperty(w, id, 'weight')).toBe(3);
    expect(getProperty(w, id, 'ignitionPoint')).toBe(300);
    expect(getProperty(w, id, 'hp')).toBeUndefined();
    expect(readProperty(w, id, 'hp')).toBe(WORLD_PROPERTY_SPECS.hp.default);
  });
});

describe('thermal state of things that can burn (mw-akb)', () => {
  it('AC-1: a flammable thing without a temperature is born at ambient; its own value wins', () => {
    expect(applyMaterial(presets, { material: 'wood' }).temperature).toBe(20);
    expect(applyMaterial(presets, { flammable: true }).temperature).toBe(20);
    expect(applyMaterial(presets, { material: 'wood', temperature: 5 }).temperature).toBe(5);
  });

  it('AC-1: a burning thing without a temperature is born at flame temperature', () => {
    const lit = applyMaterial(presets, { flammable: true, burning: true });
    expect(lit.temperature).toBeGreaterThanOrEqual(300 + 1);
    expect(applyMaterial(presets, { material: 'wood', burning: true }).temperature).toBeGreaterThan(
      300,
    );
  });

  it('AC-1: things that cannot burn stay sparse', () => {
    expect(applyMaterial(presets, { material: 'ice' }).temperature).toBe(-5);
    expect(applyMaterial(presets, { friction: 0.2 })).toEqual({ friction: 0.2 });
  });
});
