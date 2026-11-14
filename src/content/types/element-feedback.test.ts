import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import {
  compileElementFeedback,
  ELEMENT_FEEDBACK_ID,
  elementFeedbackSchema,
} from './element-feedback.ts';

const content = loadGameContent();

const valid = {
  id: 'test-table',
  notes: 'For tests.',
  handleCap: 4,
  fullDetailCap: 2,
  lowLodIntensity: 0.3,
  hysteresis: 1,
  states: [
    {
      id: 'hot',
      precedence: 1,
      property: 'temperature',
      when: { atLeast: 100 },
      effect: 'vfx-fire-burn-loop',
      referenceRadius: 0.5,
      scale: { min: 0.5, max: 2 },
    },
  ],
};

const problems = (value: unknown) =>
  (elementFeedbackSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('element-feedback content type (mw-e03.28)', () => {
  it('the shipped table maps burning, wet, frozen and charged by property, not entity type', () => {
    const table = compileElementFeedback(content.get('element-feedback', ELEMENT_FEEDBACK_ID));
    expect(table.handleCap).toBe(64);
    expect(table.fullDetailCap).toBeLessThan(table.handleCap);
    // Documented look precedence: wet < burning < charged < frozen.
    const rank = (id: string) => table.states.find((s) => s.id === id)?.precedence ?? -1;
    expect(rank('wet')).toBeLessThan(rank('burning'));
    expect(rank('burning')).toBeLessThan(rank('charged'));
    expect(rank('charged')).toBeLessThan(rank('frozen'));
    const [steam] = table.transitions;
    expect([steam?.from, steam?.to, steam?.effect]).toEqual([
      table.states.findIndex((s) => s.id === 'burning'),
      table.states.findIndex((s) => s.id === 'wet'),
      'vfx-element-steam-puff',
    ]);
    expect(table.states.map((s) => [s.id, s.property])).toEqual([
      ['burning', 'burning'],
      ['wet', 'wetness'],
      ['frozen', 'frozen'],
      ['charged', 'charge'],
    ]);
    const [burning, wet, frozen, charged] = table.states;
    expect(burning?.matches(true)).toBe(true);
    expect(burning?.matches(false)).toBe(false);
    expect(wet?.matches(0.2)).toBe(false);
    expect(wet?.matches(0.5)).toBe(true);
    expect(wet?.matches('wet')).toBe(false);
    expect(frozen?.matches(true)).toBe(true);
    expect(charged?.matches(0.5)).toBe(false);
    expect(charged?.matches(5)).toBe(true);
    expect(table.fields.map((f) => f.gas)).toEqual(['smoke', 'steam']);
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('rejects a non-property, a bad cue, a duplicate id, an inverted scale and a pulse over 3 Hz', () => {
    expect(problems(valid)).toEqual([]);
    const [state] = valid.states;
    if (state === undefined) throw new Error('fixture has a state');
    const withState = (patch: object) => ({ ...valid, states: [{ ...state, ...patch }] });
    expect(problems(withState({ property: 'wet' }))).toHaveLength(1);
    expect(problems(withState({ audioCue: 'zap' }))).toHaveLength(1);
    expect(problems(withState({ scale: { min: 3, max: 1 } }))).toHaveLength(1);
    expect(problems(withState({ look: { pulseHz: 4 } }))).toHaveLength(1);
    expect(problems({ ...valid, states: [state, state] })).toEqual([
      'states.1.id: duplicate state id "hot"',
    ]);
    expect(problems({ ...valid, fullDetailCap: 5 })).toEqual([
      'fullDetailCap: fullDetailCap must not exceed handleCap',
    ]);
    const steam = {
      from: 'hot',
      to: 'cold',
      effect: 'vfx-element-steam-puff',
      referenceRadius: 0.25,
      scale: { min: 0.6, max: 3 },
    };
    expect(problems({ ...valid, transitions: [steam] })).toEqual([
      'transitions.0.to: unknown state id "cold"',
    ]);
    expect(problems({ ...valid, transitions: [{ ...steam, to: 'hot' }] })).toEqual([]);
  });
});
