import { describe, expect, it } from 'vitest';
import { describeContent } from '../testing.ts';
import { PERSUASION_BANDS, persuasionSchema } from './persuasion.ts';

const valid = () => ({
  id: 'persuasion',
  notes: 'Tests.',
  base: 2,
  bandModifiers: { hostile: -6, cold: -3, neutral: 0, friendly: 3, devoted: 6 },
  labels: { easyFrom: 5, fairFrom: 0, hardFrom: -4 },
});

const problems = (value: unknown) =>
  (persuasionSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('persuasion schema (mw-e22.7)', () => {
  it('e22.7 AC-5: accepts a table; thresholds must descend', () => {
    expect(problems(valid())).toEqual([]);
    expect(persuasionSchema.parse(valid()).modifiers).toEqual([]);
    expect(problems({ ...valid(), labels: { easyFrom: 0, fairFrom: 0, hardFrom: -4 } })).toEqual(
      [': thresholds must descend: easyFrom > fairFrom > hardFrom'].map((m) => `labels${m}`),
    );
  });

  it('e22.7: every band needs a modifier, and unknown bands are rejected', () => {
    expect(PERSUASION_BANDS).toEqual(['hostile', 'cold', 'neutral', 'friendly', 'devoted']);
    const missing: Record<string, number> = { ...valid().bandModifiers };
    delete missing['devoted'];
    expect(problems({ ...valid(), bandModifiers: missing })).toHaveLength(1);
    expect(
      problems({ ...valid(), bandModifiers: { ...valid().bandModifiers, wary: 1 } }),
    ).toHaveLength(1);
  });

  it('e22.7: modifiers must change the score; personality needs a bound', () => {
    const when = { kind: 'playerClass', class: 'thief' };
    expect(problems({ ...valid(), modifiers: [{ when, bonus: 0, label: 'x' }] })).toEqual([
      'modifiers.0.bonus: must not be zero',
    ]);
    expect(
      problems({
        ...valid(),
        personality: [{ trait: 'greed', bonus: 1, label: 'x' }],
      }),
    ).toEqual(['personality.0: give `atLeast` or `atMost`']);
    expect(
      problems({
        ...valid(),
        personality: [{ trait: 'greed', atLeast: 0.5, bonus: 0, label: 'x' }],
      }),
    ).toEqual(['personality.0.bonus: must not be zero']);
    expect(
      problems({
        ...valid(),
        personality: [{ trait: 'luck', atLeast: 0.5, bonus: 1, label: 'x' }],
      }),
    ).toHaveLength(1);
  });
});

describeContent('persuasion', 'e22.7: the shipped table loads with descending labels', (entry) => {
  expect(entry.id).toBe('persuasion');
  expect(entry.labels.easyFrom).toBeGreaterThan(entry.labels.fairFrom);
});
