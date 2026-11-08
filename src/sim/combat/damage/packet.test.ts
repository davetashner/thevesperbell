import { describe, expect, it } from 'vitest';
import { createDamagePacket, normalizeAmounts, normalizeTags, totalDamage } from './packet';
import { DAMAGE_TYPES, isDamageType, scaleUnits, toPoiseQuanta, fromPoiseQuanta } from './types';

describe('damage packet', () => {
  it('fills defaults and freezes a minimal packet', () => {
    const packet = createDamagePacket({ amounts: { fire: 3, slash: 2, pierce: 0 } });
    expect(packet).toEqual({
      instigator: null,
      source: null,
      amounts: { slash: 2, fire: 3 },
      poiseDamage: 0,
      staminaDamage: 0,
      impulse: { x: 0, y: 0, z: 0 },
      impactForce: 0,
      regionMultiplier: 1,
      tags: [],
    });
    expect(Object.keys(packet.amounts)).toEqual(['slash', 'fire']);
    expect(Object.isFrozen(packet)).toBe(true);
  });

  it('keeps every field of a full packet, rounded to hundredths, with tags sorted and unique', () => {
    const packet = createDamagePacket({
      instigator: 4,
      source: 5,
      amounts: { blunt: 12.345 },
      poiseDamage: 15,
      staminaDamage: 20,
      impulse: { x: 1, y: 2, z: 3 },
      impactForce: 900,
      direction: { x: 0, y: 0, z: 1 },
      region: 'head',
      regionMultiplier: 1.333,
      tags: ['weakpoint', 'critical', 'weakpoint'],
    });
    expect(packet).toMatchObject({
      instigator: 4,
      source: 5,
      amounts: { blunt: 12.35 },
      direction: { x: 0, y: 0, z: 1 },
      region: 'head',
      regionMultiplier: 1.333,
      tags: ['critical', 'weakpoint'],
    });
  });

  it('rejects invalid packets with a RangeError naming the field', () => {
    const bad = [
      [{ amounts: { holy: 3 } }, /unknown damage type "holy"/],
      [{ amounts: { slash: -1 } }, /amounts.slash/],
      [{ amounts: { slash: Number.NaN } }, /amounts.slash/],
      [{ amounts: {}, poiseDamage: Number.POSITIVE_INFINITY }, /poiseDamage/],
      [{ amounts: {}, instigator: 0 }, /instigator/],
      [{ amounts: {}, source: 1.5 }, /source/],
      [{ amounts: {}, impulse: { x: Number.NaN, y: 0, z: 0 } }, /impulse/],
      [{ amounts: {}, regionMultiplier: -2 }, /regionMultiplier/],
      [{ amounts: {}, armor: -1 }, /armor/],
      [{ amounts: {}, penetration: Number.NaN }, /penetration/],
      [{ amounts: {}, tags: [''] }, /tags/],
    ] as const;
    for (const [input, message] of bad) {
      expect(() => createDamagePacket(input as never)).toThrow(message);
    }
  });

  it('carries armour and penetration only when given', () => {
    expect(createDamagePacket({ amounts: {} })).not.toHaveProperty('armor');
    expect(createDamagePacket({ amounts: {}, armor: 30, penetration: 20 })).toMatchObject({
      armor: 30,
      penetration: 20,
    });
  });

  it('normalizes amounts, tags and totals', () => {
    expect(normalizeAmounts('x', { poison: 1, slash: 0.004 })).toEqual({ poison: 1 });
    expect(normalizeTags(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(totalDamage({ slash: 0.1, fire: 0.2 })).toBe(0.3);
    expect(totalDamage({})).toBe(0);
  });
});

describe('damage types and fixed point', () => {
  it('lists the eight damage types in canonical order', () => {
    expect(DAMAGE_TYPES).toEqual([
      'slash',
      'pierce',
      'blunt',
      'fire',
      'frost',
      'shock',
      'arcane',
      'poison',
    ]);
    expect(isDamageType('fire')).toBe(true);
    expect(isDamageType('holy')).toBe(false);
    expect(isDamageType('toString')).toBe(false);
  });

  it('scales whole hundredths by basis-point factors, rounding half up', () => {
    expect(scaleUnits(3000, 0.15)).toBe(450);
    expect(scaleUnits(1, 0.5)).toBe(1);
    expect(scaleUnits(100, 1 / 3)).toBe(33);
    expect(fromPoiseQuanta(toPoiseQuanta(12.5))).toBe(12.5);
  });
});
