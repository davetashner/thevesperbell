import { describe, expect, it } from 'vitest';
import { serviceSchema } from './service.ts';

describe('service schema (mw-e20.9)', () => {
  const base = { id: 'x', notes: 'n', name: 'X', providerNpcId: 'npc-a' };

  it('AC-4: needs exactly one of price and priceFormula, and a sane formula', () => {
    expect(serviceSchema.safeParse({ ...base, price: 5 }).success).toBe(true);
    expect(serviceSchema.safeParse(base).success).toBe(false);
    const formula = { base: 5, floor: 1, perDisposition: 1 };
    expect(serviceSchema.safeParse({ ...base, price: 1, priceFormula: formula }).success).toBe(
      false,
    );
    expect(
      serviceSchema.safeParse({ ...base, priceFormula: { ...formula, floor: 9 } }).success,
    ).toBe(false);
    expect(serviceSchema.safeParse({ ...base, priceFormula: formula }).success).toBe(true);
  });

  it('defaults to no conditions, hidden when locked, no effects', () => {
    const parsed = serviceSchema.parse({ ...base, price: 5 });
    expect(parsed.conditions).toEqual([]);
    expect(parsed.showWhenLocked).toBe(false);
    expect(parsed.effects).toEqual([]);
  });
});
