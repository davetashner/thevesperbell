import { describe, expect, it } from 'vitest';
import { loadGameContent, type ElementLookDef } from '@content/index';
import { combineLooks, pulseFactor } from './element-look.ts';

const look = (partial: Partial<ElementLookDef>): ElementLookDef => ({
  tintMix: 0,
  emissiveIntensity: 0,
  pulseHz: 0,
  ...partial,
});

describe('element looks (mw-e03.28)', () => {
  it('no looks leave the entity alone', () => {
    expect(combineLooks([])).toBeUndefined();
  });

  it('a tint mixes the albedo, a glow adds, the shiniest roughness wins and a pulse needs a glow', () => {
    const combined = combineLooks([
      look({ tint: '#000000', tintMix: 0.5, roughness: 0.4, pulseHz: 2 }),
      look({
        tint: '#FFFFFF',
        tintMix: 0.5,
        emissive: '#FF0000',
        emissiveIntensity: 0.5,
        roughness: 0.1,
        pulseHz: 1,
      }),
      look({ emissive: '#FF0000', emissiveIntensity: 0.25, pulseHz: 0.5 }),
    ]);
    // black at half then white at half: 0.5 of white over 0.5 of black-mix = 0.5 of the total pull.
    expect(combined?.tintMix).toBeCloseTo(0.75);
    expect(combined?.tint[0]).toBeCloseTo(0.5 / 0.75);
    expect(combined?.emissive[0]).toBeCloseTo(0.75);
    expect(combined?.emissive[1]).toBe(0);
    expect(combined?.roughness).toBe(0.1);
    expect(combined?.pulseHz).toBe(1);
  });

  it('a look with no tint keeps the albedo and a first roughness stands', () => {
    const combined = combineLooks([look({ roughness: 0.3 })]);
    expect(combined).toMatchObject({ tintMix: 0, tint: [1, 1, 1], roughness: 0.3, pulseHz: 0 });
  });

  it('a pulse stays between 0.55 and 1 at most 3 Hz; steady and reduced motion hold at 1', () => {
    expect(pulseFactor(0, 0.1, false)).toBe(1);
    expect(pulseFactor(2, 0.1, true)).toBe(1);
    for (let t = 0; t < 2; t += 0.01) {
      const f = pulseFactor(10, t, false);
      expect(f).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Capped at 3 Hz: 10 Hz asked, 3 Hz delivered.
    expect(pulseFactor(10, 0.1, false)).toBeCloseTo(pulseFactor(3, 0.1, false));
  });

  it('the shipped table: wet is darker and glossy, frozen icy, charged glows and pulses under 3 Hz', () => {
    const table = loadGameContent().get('element-feedback', 'element-feedback');
    const of = (id: string) => table.states.find((s) => s.id === id)?.look;
    const wet = combineLooks(of('wet') ? [of('wet') as ElementLookDef] : []);
    expect(wet?.tint.every((c) => c < 0.5)).toBe(true);
    expect(wet?.roughness).toBeLessThan(0.3);
    const charged = combineLooks([of('charged') as ElementLookDef]);
    expect(charged?.pulseHz).toBeGreaterThan(0);
    expect(charged?.pulseHz).toBeLessThanOrEqual(3);
    expect(combineLooks([of('frozen') as ElementLookDef])?.roughness).toBeLessThan(0.2);
  });
});
