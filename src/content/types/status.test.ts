import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { statusSchema, STATUS_MODIFIER_STATS } from './status.ts';

const valid = {
  id: 't-status',
  name: 'Test',
  description: 'A status for tests.',
  stack: { rule: 'refresh' },
};

const problems = (value: unknown) =>
  (statusSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('status schema (mw-e06.9)', () => {
  it('accepts a minimal status and fills defaults', () => {
    const parsed = statusSchema.parse(valid);
    expect(parsed.tags).toEqual([]);
    expect(parsed.modifiers).toEqual([]);
    expect(parsed.sourceBound).toBe(false);
    expect(parsed.breakWhen).toEqual([]);
  });

  it('AC-5: a modifier on an unknown stat fails validation', () => {
    const mod = { stat: 'moveSped', mode: 'multiply', value: 0.5 };
    expect(problems({ ...valid, modifiers: [mod] })).toHaveLength(1);
    for (const stat of STATUS_MODIFIER_STATS) {
      expect(problems({ ...valid, modifiers: [{ ...mod, stat }] })).toEqual([]);
    }
  });

  it('a stack max goes with rule "stack" and only with it', () => {
    expect(problems({ ...valid, stack: { rule: 'stack', max: 3 } })).toEqual([]);
    expect(problems({ ...valid, stack: { rule: 'stack' } })).toEqual([
      'stack.max: rule "stack" needs a max',
    ]);
    expect(problems({ ...valid, stack: { rule: 'refresh', max: 3 } })).toEqual([
      'stack.max: rule "refresh" takes no max',
    ]);
  });

  it('break conditions name canonical world properties and compare numbers with gte and lte', () => {
    const test = { entity: 'source', property: 'burning', is: 'eq', value: true };
    expect(problems({ ...valid, breakWhen: [test] })).toEqual([]);
    expect(problems({ ...valid, breakWhen: [{ ...test, property: 'on-fire' }] })).toHaveLength(1);
    expect(problems({ ...valid, breakWhen: [{ ...test, is: 'gte' }] })).toEqual([
      'breakWhen.0.value: "gte" compares numbers',
    ]);
  });
});

describeContent('status', 'AC-5: parses and names only known stat modifiers', (status) => {
  expect(status.modifiers.every((m) => STATUS_MODIFIER_STATS.includes(m.stat))).toBe(true);
});
