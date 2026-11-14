import { describe, expect, it } from 'vitest';
import { CLIMB_HINT_MS, climbHintModel, climbHintOf } from './climb-hint';

describe('the climb refusal prompt (mw-e10.9)', () => {
  it('AC-2: a refused climb shows a greyed Climb prompt with the reason, for 2.5 s of the draw clock', () => {
    const hint = climbHintOf({ text: 'Too hard for you to climb' }, 1000);
    expect(hint).toEqual({ text: 'Too hard for you to climb', until: 1000 + CLIMB_HINT_MS });
    expect(climbHintModel(hint, 1000)).toEqual({
      glyph: '',
      label: 'Climb',
      available: false,
      reason: 'Too hard for you to climb',
      hold: false,
      progress: 0,
    });
    expect(climbHintModel(hint, 1000 + CLIMB_HINT_MS - 1)).not.toBeNull();
    expect(climbHintModel(hint, 1000 + CLIMB_HINT_MS)).toBeNull();
  });

  it('shows nothing without a hint', () => {
    expect(climbHintModel(undefined, 0)).toBeNull();
  });
});
