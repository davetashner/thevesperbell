import { describe, expect, it } from 'vitest';
import type { ContestEntry as ContestDef } from '../../content/types/contest';
import { validateContestLogic } from './validate';

const effects = [{ kind: 'gold', delta: 1 }];

function contest(over: Record<string, unknown> = {}): ContestDef {
  return {
    id: 'c',
    name: 'C',
    entry: { fee: 0 },
    win: { placement: 1, effects },
    lose: { effects },
    cheats: [],
    ...over,
  } as unknown as ContestDef;
}

describe('contest logic validation (mw-e40.5)', () => {
  it('AC-4: a valid contest has no issues, with every effect reference resolved', () => {
    const full = contest({
      entry: { when: { kind: 'hasItem', item: 'ribbon', count: 1 }, effects },
      disqualified: { effects },
      cheats: [
        {
          id: 'x',
          event: 'spell.cast',
          when: { kind: 'hasItem', item: 'ring', count: 1 },
          observedBy: ['npc-a'],
          detected: { effects },
          undetected: { effects },
        },
      ],
      betting: { book: 'npc-b', throwMatch: { payout: effects, grudge: effects } },
    });
    expect(validateContestLogic(full, () => undefined)).toEqual([]);
  });

  it('AC-4: unknown kinds, bad fields and unresolved references are reported with pointers', () => {
    const bad = contest({
      entry: { when: { kind: 'nonsense' } },
      win: { effects: [{ kind: 'giveItem', item: 'missing-thing', count: 1 }] },
      cheats: [
        {
          id: 'x',
          event: 'spell.cast',
          observedBy: ['npc-a'],
          detected: { effects: [{ kind: 'gold', delta: 'lots' }] },
          undetected: { effects },
        },
      ],
      betting: { book: 'npc-b', throwMatch: { payout: effects, grudge: [{ kind: 'nope' }] } },
    });
    const issues = validateContestLogic(bad, (ref) =>
      ref.id === 'missing-thing' ? `unknown ${ref.type} "${ref.id}"` : undefined,
    );
    expect(issues.map((i) => i.pointer)).toEqual([
      '/entry/when',
      '/win/effects/0',
      '/cheats/0/detected/effects/0/delta',
      '/betting/throwMatch/grudge/0',
    ]);
  });
});
