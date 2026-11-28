import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { restPointSchema } from './rest-point.ts';

const base = {
  id: 'hearth',
  name: 'Hearth',
  durations: [{ kind: 'dawn' }],
};

describe('rest-point schema (mw-e27.13)', () => {
  it('fills the defaults: no fire needed, an 8 h full rest restoring everything, nothing interrupts', () => {
    expect(restPointSchema.parse(base)).toEqual({
      ...base,
      needsFire: false,
      fullRestHours: 8,
      restores: { health: 1, stamina: 1, mana: 1 },
      interrupts: [],
    });
  });

  it('rejects an empty duration list, a rest over a day, and chances outside 0-1', () => {
    expect(restPointSchema.safeParse({ ...base, durations: [] }).success).toBe(false);
    expect(
      restPointSchema.safeParse({ ...base, durations: [{ kind: 'hours', hours: 25 }] }).success,
    ).toBe(false);
    const chance = (chancePerHour: number) =>
      restPointSchema.safeParse({
        ...base,
        interrupts: [{ id: 'wolves', chancePerHour, message: 'Wolves.' }],
      }).success;
    expect(chance(0.5)).toBe(true);
    expect(chance(1.5)).toBe(false);
  });

  it('rejects two interrupts with one id', () => {
    const interrupt = { id: 'wolves', chancePerHour: 0.1, message: 'Wolves.' };
    const result = restPointSchema.safeParse({ ...base, interrupts: [interrupt, interrupt] });
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toEqual([
      'duplicate interrupt id "wolves"',
    ]);
  });
});

describeContent(
  'rest-point',
  'AC-3: a kind offers a duration and a rest that restores something',
  (entry) => {
    expect(entry.durations.length).toBeGreaterThan(0);
    expect(Object.values(entry.restores).some((fraction) => fraction > 0)).toBe(true);
  },
);

describeContent('rest-point', 'AC-1: only a campfire needs a burning fire', (entry) => {
  expect(entry.needsFire).toBe(entry.id === 'campfire');
});
