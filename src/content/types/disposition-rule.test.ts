import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { ATTACKED_EVENT, dispositionRuleSchema } from './disposition-rule.ts';

const valid = { id: 'fed', notes: 'Fed it.', delta: 15 };
const problems = (value: unknown) =>
  (dispositionRuleSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('disposition-rule schema (mw-e12.9)', () => {
  it('accepts a rule keyed by its event type, with a negative or positive delta', () => {
    expect(dispositionRuleSchema.parse(valid).delta).toBe(15);
    expect(dispositionRuleSchema.parse({ ...valid, delta: -200 }).delta).toBe(-200);
  });

  it('rejects a no-op delta, one off the scale, a fractional one and unknown fields', () => {
    expect(problems({ ...valid, delta: 0 })).toEqual([
      'delta: a rule that changes nothing is not a rule',
    ]);
    expect(problems({ ...valid, delta: 201 })).toHaveLength(1);
    expect(problems({ ...valid, delta: 1.5 })).toHaveLength(1);
    expect(problems({ ...valid, extra: 1 })).toHaveLength(1);
    expect(problems({ id: 'fed', delta: 5 })).toHaveLength(1);
  });
});

const EXPECTED: Readonly<Record<string, number>> = {
  attacked: -40,
  theft: -10,
  fed: 15,
  'witnessed-theft': -20,
  'helped-ally': 25,
};

describe('disposition-rule value tiers (mw-e22.4)', () => {
  it('AC-4: tiers default to none, take a positive scale and must ascend by minValue', () => {
    expect(dispositionRuleSchema.parse(valid).valueTiers).toEqual([]);
    const tiers = [
      { minValue: 0, scale: 1 },
      { minValue: 50, scale: 2 },
    ];
    expect(dispositionRuleSchema.parse({ ...valid, valueTiers: tiers }).valueTiers).toEqual(tiers);
    expect(problems({ ...valid, valueTiers: [tiers[1], tiers[0]] })).toEqual([
      'valueTiers.1.minValue: tiers must ascend by minValue',
    ]);
    expect(problems({ ...valid, valueTiers: [tiers[0], tiers[0]] })).toHaveLength(1);
    expect(problems({ ...valid, valueTiers: [{ minValue: 0, scale: 0 }] })).toHaveLength(1);
  });
});

describeContent('disposition-rule', 'AC-1: the game rules are the bead’s deltas', (rule) => {
  expect(EXPECTED[rule.id]).toBe(rule.delta);
});

describe('disposition rules in the game', () => {
  it('AC-1: the built-in attacked event has a rule', () => {
    expect(ATTACKED_EVENT).toBe('attacked');
    expect(Object.keys(EXPECTED)).toContain(ATTACKED_EVENT);
  });
});
