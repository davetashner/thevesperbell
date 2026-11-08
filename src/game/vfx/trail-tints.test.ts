import { DAMAGE_TYPES } from '@content/index';
import { describe, expect, it } from 'vitest';
import tintsJson from './data/trail-tints.json';
import { compileTrailTints, dominantDamageType, swingTint, trailTints } from './trail-tints';

describe('trail tints (mw-e29.6)', () => {
  it('holds a tint for every damage type, in data', () => {
    const tints = trailTints();
    for (const type of DAMAGE_TYPES) expect(tints.damage[type]).toHaveLength(3);
    expect(tints.damage.fire).toEqual([1, 122 / 255, 46 / 255]);
    expect(tints.glow).toHaveLength(3);
    expect(tints.arrowAlpha).toBeLessThan(tints.swingAlpha);
  });

  it('names the offending path for a bad or missing tint', () => {
    expect(() => compileTrailTints({ ...tintsJson, arrow: 'tan' })).toThrow(/arrow/);
    const rest: Record<string, string> = { ...tintsJson.damage };
    delete rest['fire'];
    expect(() => compileTrailTints({ ...tintsJson, damage: rest })).toThrow(/fire/);
  });

  it('picks the dominant damage type, earlier canonical type winning ties', () => {
    expect(dominantDamageType({ slash: 5, fire: 20 })).toBe('fire');
    expect(dominantDamageType({ blunt: 10, fire: 10 })).toBe('blunt');
    expect(dominantDamageType({})).toBeUndefined();
    expect(dominantDamageType({ slash: 0 })).toBeUndefined();
  });

  it('tints by dominant type, neutral when nothing is dealt', () => {
    const tints = trailTints();
    expect(swingTint(tints, { frost: 3, slash: 1 })).toBe(tints.damage.frost);
    expect(swingTint(tints, {})).toBe(tints.neutral);
  });
});
