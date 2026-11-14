import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { contestSchema } from './contest.ts';

const effects = [{ kind: 'gold', delta: 1 }];
const valid = () => ({
  id: 'arm-wrestle',
  name: 'Arm-wrestling',
  entry: { fee: 2 },
  participants: [{ id: 'oona', name: 'Oona', creature: 'npc-oona' }],
  scoring: [{ event: 'armwrestle.push', points: 1 }],
  finish: { firstTo: 5 },
  win: { effects },
  lose: { effects },
});
const cheat = {
  id: 'magic',
  event: 'spell.cast',
  observedBy: ['npc-cray'],
  detected: { effects },
  undetected: { effects },
};

const problems = (value: unknown) =>
  (contestSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('contest schema (mw-e40.5)', () => {
  it('AC-4: accepts a contest and fills defaults', () => {
    expect(problems(valid())).toEqual([]);
    const parsed = contestSchema.parse(valid());
    expect(parsed.cheats).toEqual([]);
    expect(parsed.win.placement).toBe(1);
    expect(parsed.scoring[0]?.where).toEqual({});
  });

  it('AC-4: entry, win and lose are required, with effects', () => {
    for (const field of ['entry', 'win', 'lose', 'finish', 'scoring', 'participants']) {
      const copy = Object.fromEntries(Object.entries(valid()).filter(([key]) => key !== field));
      expect(problems(copy).join('\n'), field).toContain(field);
    }
    expect(problems({ ...valid(), win: { effects: [] } })).toHaveLength(1);
    expect(problems({ ...valid(), lose: {} })).toHaveLength(1);
  });

  it('rejects a finish with neither limit, duplicate or reserved participants, zero points', () => {
    expect(problems({ ...valid(), finish: {} })).toEqual([
      'finish: give `firstTo` or `afterTicks`',
    ]);
    const dup = [
      { id: 'a', name: 'A' },
      { id: 'a', name: 'B' },
    ];
    expect(problems({ ...valid(), participants: dup })).toEqual([
      'participants: participant ids must be unique',
    ]);
    expect(problems({ ...valid(), participants: [{ id: 'player', name: 'P' }] })).toEqual([
      'participants: "player" is the player, not a rival',
    ]);
    expect(problems({ ...valid(), scoring: [{ event: 'e', points: 0 }] })).toEqual([
      'scoring.0.points: must not be zero',
    ]);
  });

  it('a cheat names who would notice, what a catch costs and what going unseen costs', () => {
    expect(problems({ ...valid(), cheats: [cheat] })).toEqual([]);
    const noCost = { ...cheat, undetected: undefined };
    expect(problems({ ...valid(), cheats: [noCost] }).join()).toContain('undetected');
    expect(problems({ ...valid(), cheats: [{ ...cheat, observedBy: [] }] }).join()).toContain(
      'observedBy',
    );
    expect(
      problems({ ...valid(), cheats: [{ ...cheat, detected: { disqualify: false } }] }),
    ).toEqual(['cheats.0.detected: a caught cheat must disqualify or have effects']);
    expect(problems({ ...valid(), cheats: [cheat, cheat] })).toEqual([
      'cheats: cheat ids must be unique',
    ]);
  });

  it('a betting book offers something and its stake range is ordered', () => {
    const onPlayer = { minStake: 1, maxStake: 5, odds: { numerator: 2, denominator: 1 } };
    expect(problems({ ...valid(), betting: { book: 'npc-nell', onPlayer } })).toEqual([]);
    expect(problems({ ...valid(), betting: { book: 'npc-nell' } })).toEqual([
      'betting: a book offers at least one of onPlayer, throwMatch',
    ]);
    expect(
      problems({
        ...valid(),
        betting: { book: 'npc-nell', onPlayer: { ...onPlayer, minStake: 9 } },
      }),
    ).toEqual(['betting.onPlayer: minStake must not exceed maxStake']);
  });
});

describeContent('contest', 'AC-4: is valid and round-trips', (contest) => {
  expect(contestSchema.parse(JSON.parse(serializeContent(contest)))).toEqual(contest);
});
