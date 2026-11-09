import { DAMAGE_TYPES } from '@content/index';
import { describe, expect, it } from 'vitest';
import tintsJson from './data/trail-tints.json';
import {
  ARROW_HALF_WIDTH,
  arrowTrailLook,
  compileTrailTints,
  dominantDamageType,
  swingTint,
  trailTints,
} from './trail-tints';

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

  it('AC-4: a focused shot gets the focused trail variant, brighter and wider than the plain one', () => {
    const tints = trailTints();
    const plain = arrowTrailLook(tints, 'standard', false);
    const focused = arrowTrailLook(tints, 'standard', true);
    expect(plain).toMatchObject({ variant: 'standard', alpha: tints.arrowAlpha });
    expect(plain.halfWidth).toBe(ARROW_HALF_WIDTH);
    expect(focused.variant).toBe('focused');
    expect(focused.alpha).toBe(tints.arrowFocusedAlpha);
    expect(focused.alpha).toBeGreaterThan(plain.alpha);
    expect(focused.halfWidth).toBeGreaterThan(plain.halfWidth);
    for (const c of [0, 1, 2] as const) expect(focused.rgb[c]).toBeGreaterThan(plain.rgb[c]);
  });

  it('a trick arrow keeps its own hue for both variants, falling back to the plain arrow colour', () => {
    const tints = trailTints();
    expect(arrowTrailLook(tints, 'fire', false).rgb).toBe(tints.arrowTypes['fire']);
    expect(arrowTrailLook(tints, 'unknown', false).rgb).toBe(tints.arrow);
    const fire = arrowTrailLook(tints, 'fire', true).rgb;
    const water = arrowTrailLook(tints, 'water', true).rgb;
    expect(fire[0]).toBeGreaterThan(fire[2]); // still orange
    expect(water[2]).toBeGreaterThan(water[0]); // still blue
  });
});
