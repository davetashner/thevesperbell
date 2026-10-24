// Contract between layers (mw-e06.1): a spell's stimulus and volume ops name elements of the sim's one
// stimulus API (mw-e03.3). Content may import the sim only as types, so the spell schema mirrors the
// element list; this runtime comparison keeps the two equal.

import { describe, expect, it } from 'vitest';
import { SPELL_STIMULUS_ELEMENTS, spellSchema } from '@content/index';
import { STIMULUS_ELEMENTS } from '@sim/index';

describe('spell stimulus elements (mw-e06.1)', () => {
  it('are exactly the sim stimulus elements, in the same order', () => {
    expect([...SPELL_STIMULUS_ELEMENTS]).toEqual([...STIMULUS_ELEMENTS]);
  });

  it('every sim element is accepted by a stimulus op', () => {
    for (const element of STIMULUS_ELEMENTS) {
      const result = spellSchema.safeParse({
        id: 'contract-spell',
        name: 'Contract Spell',
        school: 'arcane',
        tier: 1,
        cost: { mana: 0 },
        castTime: 0,
        delivery: { kind: 'self' },
        effects: [
          {
            op: 'stimulus',
            element,
            intensity: 1,
            radius: 1,
            ...(element === 'gas' ? { gas: 'smoke' } : {}),
          },
        ],
        vfxCue: 'vfx-contract',
        sfxCue: 'sfx-contract',
      });
      expect(result.error?.issues ?? [], element).toEqual([]);
    }
  });
});
