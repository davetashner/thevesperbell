import { describe, expect, it } from 'vitest';
import {
  assertProperty,
  isWorldPropertyKey,
  validateProperty,
  WORLD_PROPERTIES_VERSION,
  WORLD_PROPERTY_KEYS,
  WORLD_PROPERTY_SPECS,
} from './spec';

describe('world property spec', () => {
  it('is a closed, versioned set: changing the keys means bumping the version', () => {
    // Update both together; a save migration (e30) keys off WORLD_PROPERTIES_VERSION.
    expect(WORLD_PROPERTIES_VERSION).toBe(3);
    expect(WORLD_PROPERTY_KEYS).toEqual([
      'bashable',
      'breakable',
      'burning',
      'charge',
      'chargeActivated',
      'climbable',
      'conductive',
      'container',
      'cuttable',
      'density',
      'extinguishable',
      'flammable',
      'flammableGas',
      'fragile',
      'freezePoint',
      'friction',
      'frozen',
      'fuel',
      'hidden',
      'hideable',
      'hp',
      'ignitionPoint',
      'impactAbsorb',
      'liftable',
      'lightActivated',
      'lightEmitter',
      'liquid',
      'material',
      'noiseMultiplier',
      'opaque',
      'owner',
      'pushable',
      'reflective',
      'remains',
      'shootable',
      'softAnchor',
      'soundDamping',
      'support',
      'surfaceHardness',
      'suspended',
      'temperature',
      'toughness',
      'transparent',
      'trap',
      'trapped',
      'unstable',
      'waterSurface',
      'weight',
      'wetness',
    ]);
    expect(Object.isFrozen(WORLD_PROPERTY_KEYS)).toBe(true);
  });

  it('every default is a valid value with a doc string', () => {
    const problems = WORLD_PROPERTY_KEYS.flatMap((key) => {
      const spec = WORLD_PROPERTY_SPECS[key];
      return [
        validateProperty(key, spec.default) ?? [],
        spec.doc === '' ? `${key} has no doc` : [],
      ];
    }).flat();
    expect(problems).toEqual([]);
  });

  it('recognises property keys', () => {
    expect(isWorldPropertyKey('wetness')).toBe(true);
    expect(isWorldPropertyKey('wet')).toBe(false);
    expect(isWorldPropertyKey('toString')).toBe(false);
  });

  it('AC-3: rejects out-of-range numbers, naming the property', () => {
    expect(validateProperty('wetness', 1.4)).toBe('wetness must be ≤ 1, got 1.4');
    expect(validateProperty('wetness', -0.1)).toBe('wetness must be ≥ 0, got -0.1');
    expect(validateProperty('temperature', -300)).toBe('temperature must be ≥ -273.15, got -300');
    expect(validateProperty('wetness', 0.8)).toBeUndefined();
    expect(validateProperty('wetness', 1)).toBeUndefined();
  });

  it('rejects non-numbers and non-finite numbers', () => {
    expect(validateProperty('weight', '3')).toBe('weight must be a finite number');
    expect(validateProperty('weight', Number.NaN)).toBe('weight must be a finite number');
    expect(validateProperty('weight', Number.POSITIVE_INFINITY)).toBe(
      'weight must be a finite number',
    );
  });

  it('enforces whole-number properties', () => {
    expect(validateProperty('support', 2)).toBeUndefined();
    expect(validateProperty('support', 1.5)).toBe('support must be a whole number, got 1.5');
  });

  it('mw-e03.22: climbable is a named grade, defaulting to none', () => {
    expect(WORLD_PROPERTY_SPECS.climbable.default).toBe('none');
    expect(validateProperty('climbable', 'ivy')).toBeUndefined();
    expect(validateProperty('climbable', 2)).toBe(
      'climbable must be one of none, ladder, rope, ivy, rough, sheer',
    );
  });

  it('checks booleans and ids', () => {
    expect(validateProperty('flammable', 1)).toBe('flammable must be true or false');
    expect(validateProperty('flammable', false)).toBeUndefined();
    expect(validateProperty('material', 'dry-wood')).toBeUndefined();
    expect(validateProperty('material', 'Dry Wood')).toBe(
      'material must be a lowercase kebab-case id',
    );
    expect(validateProperty('owner', 7)).toBe('owner must be a lowercase kebab-case id');
  });

  it('checks flat records field by field', () => {
    expect(validateProperty('lightEmitter', { intensity: 100, radius: 8 })).toBeUndefined();
    expect(validateProperty('lightEmitter', null)).toBe('lightEmitter must be a plain object');
    expect(validateProperty('lightEmitter', 5)).toBe('lightEmitter must be a plain object');
    expect(validateProperty('lightEmitter', [100, 8])).toBe('lightEmitter must be a plain object');
    expect(validateProperty('lightEmitter', { intensity: 1, radius: 1, hue: 3 })).toBe(
      'lightEmitter has unknown field "hue"',
    );
    expect(validateProperty('lightEmitter', { intensity: 1 })).toBe(
      'lightEmitter .radius must be a finite number',
    );
    expect(validateProperty('lightEmitter', { intensity: 1, radius: 101 })).toBe(
      'lightEmitter .radius must be ≤ 100, got 101',
    );
  });

  it('mw-e03.31: checks enum values', () => {
    expect(validateProperty('surfaceHardness', 'hard')).toBeUndefined();
    expect(validateProperty('surfaceHardness', 'firm')).toBe(
      'surfaceHardness must be one of soft, medium, hard',
    );
    expect(validateProperty('surfaceHardness', 2)).toBe(
      'surfaceHardness must be one of soft, medium, hard',
    );
  });

  it('mw-e03.31: a partial record (toughness) may leave fields out but checks the ones it has', () => {
    expect(validateProperty('toughness', {})).toBeUndefined();
    expect(validateProperty('toughness', { blunt: 200, slash: 800 })).toBeUndefined();
    expect(validateProperty('toughness', { blunt: -1 })).toBe(
      'toughness .blunt must be ≥ 0, got -1',
    );
    expect(validateProperty('toughness', { fire: 5 })).toBe('toughness has unknown field "fire"');
  });

  it('mw-e03.31: threshold properties default to their maximum (never triggers)', () => {
    for (const key of [
      'fragile',
      'unstable',
      'shootable',
      'chargeActivated',
      'lightActivated',
    ] as const) {
      const spec = WORLD_PROPERTY_SPECS[key];
      expect([key, spec.default]).toEqual([key, spec.max]);
    }
    expect(WORLD_PROPERTY_SPECS.chargeActivated.default).toBeGreaterThan(
      WORLD_PROPERTY_SPECS.charge.max,
    );
    expect(WORLD_PROPERTY_SPECS.lightActivated.default).toBeGreaterThan(
      WORLD_PROPERTY_SPECS.lightEmitter.fields.intensity.max,
    );
  });

  it('assertProperty throws a RangeError for invalid values only', () => {
    expect(() => {
      assertProperty('wetness', 1.4);
    }).toThrow(new RangeError('wetness must be ≤ 1, got 1.4'));
    expect(() => {
      assertProperty('wetness', 0.4);
    }).not.toThrow();
  });
});
