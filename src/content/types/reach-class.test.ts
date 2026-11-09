import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import {
  compileReachClasses,
  REACH_CLASS_TABLE_ID,
  reachClassSchema,
  type ReachClassDefInput,
} from './reach-class.ts';

const valid = {
  id: 'test-reach',
  notes: 'A table for tests.',
  metres: { close: 0.6, short: 1.2, medium: 2, long: 3 },
  wallRecoil: { ticks: 30, reaches: ['medium', 'long'] },
} satisfies ReachClassDefInput;

const problems = (value: unknown) =>
  (reachClassSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('reach-class schema (mw-e04.15)', () => {
  it('accepts a table and compiles it to frozen metres and a recoil rule', () => {
    const table = compileReachClasses(reachClassSchema.parse(valid));
    expect(table.metres).toEqual(valid.metres);
    expect(table.wallRecoil.ticks).toBe(30);
    expect([...table.wallRecoil.reaches]).toEqual(['medium', 'long']);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.metres)).toBe(true);
  });

  it('rejects metres that do not grow with the class, missing classes and bad recoil data', () => {
    expect(problems({ ...valid, metres: { ...valid.metres, medium: 1.2 } })).toEqual([
      'metres: each class must reach farther than the one before it (close < short < medium < long)',
    ]);
    expect(problems({ ...valid, metres: { close: 1, short: 2, medium: 3 } })).toHaveLength(1);
    expect(problems({ ...valid, metres: { ...valid.metres, close: 0 } })).toHaveLength(1);
    expect(problems({ ...valid, wallRecoil: { ticks: 0, reaches: [] } })).toHaveLength(1);
    expect(problems({ ...valid, wallRecoil: { ticks: 30, reaches: ['huge'] } })).toHaveLength(1);
  });
});

describeContent('reach-class', 'AC-5: the game table is the bead’s numbers', (table) => {
  expect(table.id).toBe(REACH_CLASS_TABLE_ID);
  expect(table.metres).toEqual({ close: 0.6, short: 1.2, medium: 2, long: 3 });
  expect(table.wallRecoil.ticks).toBe(30);
  expect(table.wallRecoil.reaches).toEqual(['medium', 'long']);
});
