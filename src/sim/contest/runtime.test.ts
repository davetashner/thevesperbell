import { describe, expect, it } from 'vitest';
import type { ContestEntry as ContestDef } from '../../content/types/contest';
import { EventBus } from '../core/events';
import { MemoryLogicHost } from '../logic';
import { Rng } from '../rng';
import { ContestCheatDetected, ContestEnded, ContestStarted } from './events';
import {
  CONTEST_PLAYER,
  ContestError,
  ContestRunner,
  type ContestEvent,
  type ContestPerception,
  type ContestSnapshot,
} from './runtime';

const gold = (delta: number) => ({ kind: 'gold', delta });
const disposition = (npc: string, delta: number) => ({ kind: 'disposition', npc, delta });

const creature = (id: string) => ({ type: 'creature', id });

/** A small contest, as content would load it: hits on target tag gull score, first to 3 ends it. */
function contest(over: Record<string, unknown> = {}): ContestDef {
  return {
    id: 'gull-shoot',
    name: 'The Gull Shoot',
    entry: { fee: 3 },
    participants: [{ id: 'rival', name: 'Rival' }],
    scoring: [{ event: 'arrow.hit', where: { targetTag: 'gull' }, points: 1 }],
    finish: { firstTo: 3 },
    win: { placement: 1, effects: [gold(20)] },
    lose: { effects: [disposition('npc-oona', 1)] },
    cheats: [],
    ...over,
  };
}

const cheater = (over: Record<string, unknown> = {}) => ({
  id: 'magic',
  event: 'spell.cast',
  where: {},
  observedBy: [creature('npc-cray')],
  bonusPoints: 1,
  detected: { disqualify: true, effects: [disposition('npc-cray', -3)] },
  undetected: { effects: [disposition('npc-cray', -1)] },
  ...over,
});

const book = {
  book: creature('npc-nell'),
  onPlayer: { minStake: 2, maxStake: 10, odds: { numerator: 3, denominator: 2 } },
  throwMatch: {
    payout: [gold(15)],
    grudge: [disposition('npc-nell', -4)],
  },
};

function setup(
  def: ContestDef = contest(),
  options: { perception?: ContestPerception; gold?: number; seed?: number } = {},
) {
  const host = new MemoryLogicHost({ gold: options.gold ?? 50 });
  const bus = new EventBus();
  const ended: unknown[] = [];
  const started: unknown[] = [];
  const caught: unknown[] = [];
  bus.on(ContestEnded, (e) => ended.push(e));
  bus.on(ContestStarted, (e) => started.push(e));
  bus.on(ContestCheatDetected, (e) => caught.push(e));
  const runner = new ContestRunner({
    contests: [def],
    host,
    rng: Rng.create(options.seed ?? 7),
    events: bus,
    ...(options.perception === undefined ? {} : { perception: options.perception }),
  });
  const flush = () => {
    bus.flush();
  };
  return { host, runner, ended, started, caught, flush };
}

const hit = (tick: number, extra: Partial<ContestEvent> = {}): ContestEvent => ({
  name: 'arrow.hit',
  data: { targetTag: 'gull' },
  tick,
  ...extra,
});

describe('contest runner (mw-e40.5)', () => {
  it('AC-1: three matching hit events score 3, and the contest ends with the player placed first', () => {
    const t = setup();
    expect(t.runner.enter('gull-shoot', 0)).toEqual({ ok: true });
    t.runner.record(hit(1));
    t.runner.record({ name: 'arrow.hit', data: { targetTag: 'crate' }, tick: 2 }); // wrong tag
    t.runner.record({ name: 'arrow.miss', data: { targetTag: 'gull' }, tick: 2 }); // wrong event
    t.runner.record(hit(3));
    expect(t.runner.standings('gull-shoot').find((s) => s.id === CONTEST_PLAYER)?.score).toBe(2);
    t.runner.record(hit(4));
    t.flush();
    expect(t.runner.isActive('gull-shoot')).toBe(false);
    expect(t.ended).toMatchObject([
      { contest: 'gull-shoot', outcome: 'won', placement: 1, score: 3 },
    ]);
    expect(t.runner.result('gull-shoot')).toBe('won');
    expect(t.host.gold()).toBe(50 - 3 + 20);
  });

  it('AC-1: ties break by earliest completion', () => {
    const t = setup(contest({ finish: { afterTicks: 100 } }));
    t.runner.enter('gull-shoot', 0);
    // The rival reaches 2 at tick 5; the player reaches 2 at tick 9: the rival is ahead.
    t.runner.record(hit(5, { actor: 'rival' }));
    t.runner.record(hit(6, { actor: 'rival' }));
    t.runner.record(hit(8));
    t.runner.record(hit(9));
    expect(t.runner.standings('gull-shoot').map((s) => s.id)).toEqual(['rival', CONTEST_PLAYER]);
    t.runner.update(100);
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'lost', placement: 2 }]);
    // And the other way round: the player completes first.
    t.runner.enter('gull-shoot', 200);
    t.runner.record(hit(201));
    t.runner.record(hit(202));
    t.runner.record(hit(203, { actor: 'rival' }));
    t.runner.record(hit(204, { actor: 'rival' }));
    expect(t.runner.standings('gull-shoot').map((s) => s.id)).toEqual([CONTEST_PLAYER, 'rival']);
  });

  it('a dead heat from the same tick goes to the rival, and nobody scoring is a loss', () => {
    const t = setup(contest({ finish: { afterTicks: 10 } }));
    t.runner.enter('gull-shoot', 0);
    expect(t.runner.standings('gull-shoot').map((s) => s.id)).toEqual(['rival', CONTEST_PLAYER]);
    t.runner.record(hit(3));
    t.runner.record(hit(3, { actor: 'rival' }));
    expect(t.runner.standings('gull-shoot')[0]?.id).toBe('rival');
    t.runner.update(10);
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'lost', placement: 2, score: 1 }]);
  });

  it('events from someone who is not in the contest are ignored', () => {
    const t = setup();
    t.runner.enter('gull-shoot', 0);
    t.runner.record(hit(1, { actor: 'stranger' }));
    expect(t.runner.standings('gull-shoot').every((s) => s.score === 0)).toBe(true);
  });

  it('entry: refused for a failed condition, too little gold, a running contest; applies entry effects', () => {
    const gated = contest({
      entry: {
        fee: 5,
        when: { kind: 'hasItem', item: 'ribbon', count: 1 },
        effects: [disposition('npc-oona', 1)],
      },
    });
    const t = setup(gated, { gold: 4 });
    expect(t.runner.canEnter('gull-shoot')).toEqual({ ok: false, reason: 'not-eligible' });
    t.host.giveItem('ribbon', 1);
    expect(t.runner.enter('gull-shoot', 0)).toEqual({ ok: false, reason: 'cannot-afford' });
    t.host.adjustGold(10);
    expect(t.runner.enter('gull-shoot', 0)).toEqual({ ok: true });
    expect(t.host.gold()).toBe(9);
    expect(t.host.disposition('npc-oona')).toBe(1);
    expect(t.runner.enter('gull-shoot', 1)).toEqual({ ok: false, reason: 'already-active' });
  });

  it('entry: a refusing entry effect keeps the fee and does not start', () => {
    const t = setup(
      contest({ entry: { fee: 3, effects: [{ kind: 'takeItem', item: 'x', count: 1 }] } }),
    );
    const answer = t.runner.enter('gull-shoot', 0);
    expect(answer.ok).toBe(false);
    expect(t.host.gold()).toBe(50);
    expect(t.runner.isActive('gull-shoot')).toBe(false);
  });

  it('a free contest charges nothing, and an unknown id is a caller error', () => {
    const t = setup(contest({ entry: { fee: 0 } }));
    t.runner.enter('gull-shoot', 0);
    expect(t.host.gold()).toBe(50);
    expect(() => t.runner.isActive('nope')).toThrow(ContestError);
    expect(setup().runner.standings('gull-shoot')).toEqual([]);
    expect(t.runner.standings('gull-shoot')).toHaveLength(2);
    expect(t.started).toEqual([]);
    t.flush();
    expect(t.started).toEqual([{ contest: 'gull-shoot', participants: ['rival'] }]);
  });

  it('losing gracefully: a forfeit ends as a loss with the lose effects', () => {
    const t = setup();
    expect(t.runner.forfeit('gull-shoot')).toEqual({ ok: false, reason: 'not-active' });
    t.runner.enter('gull-shoot', 0);
    t.runner.record(hit(1));
    expect(t.runner.forfeit('gull-shoot')).toEqual({ ok: true });
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'forfeit', placement: 2, score: 1 }]);
    expect(t.host.disposition('npc-oona')).toBe(1);
  });

  it('paced rivals score from the seeded stream, deterministically, and a rival can win', () => {
    const def = contest({
      participants: [
        { id: 'rival', name: 'Rival', pace: { everyTicks: 10, points: 1, spread: 1 } },
      ],
      finish: { firstTo: 4 },
    });
    const run = (seed: number) => {
      const t = setup(def, { seed });
      t.runner.enter('gull-shoot', 0);
      t.runner.update(5); // nothing due yet
      t.runner.update(1000); // catches up tick by tick and ends the contest
      t.flush();
      return t.ended;
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).toMatchObject([{ outcome: 'lost', placement: 2, score: 0 }]);
    const noSpread = setup(
      contest({
        participants: [{ id: 'rival', name: 'R', pace: { everyTicks: 10, points: 2, spread: 0 } }],
        finish: { afterTicks: 99 },
      }),
    );
    noSpread.runner.enter('gull-shoot', 0);
    noSpread.runner.update(20);
    expect(noSpread.runner.standings('gull-shoot')[0]).toEqual({
      id: 'rival',
      score: 4,
      reachedAt: 20,
    });
  });

  it('a time limit ends the contest', () => {
    const t = setup(contest({ finish: { afterTicks: 50 } }));
    t.runner.enter('gull-shoot', 10);
    t.runner.record(hit(11));
    t.runner.update(59);
    expect(t.runner.isActive('gull-shoot')).toBe(true);
    t.runner.update(60);
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'won', placement: 1 }]);
  });

  it('a win needs the configured placement', () => {
    const t = setup(
      contest({ win: { placement: 2, effects: [gold(1)] }, finish: { afterTicks: 5 } }),
    );
    t.runner.enter('gull-shoot', 0);
    t.runner.record(hit(1, { actor: 'rival' }));
    t.runner.update(5);
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'won', placement: 2 }]);
  });

  describe('cheating', () => {
    const watch = (...who: string[]): ContestPerception => ({
      perceives: (watcher, event) => who.includes(watcher) && event.name === 'spell.cast',
    });
    const cast = (tick: number): ContestEvent => ({ name: 'spell.cast', tick });

    it('AC-2: a cast Cray perceives fires contest.cheatDetected and disqualifies', () => {
      const t = setup(contest({ cheats: [cheater()] }), { perception: watch('npc-cray') });
      t.runner.enter('gull-shoot', 0);
      t.runner.record(hit(1));
      t.runner.record(cast(2));
      t.flush();
      expect(t.caught).toEqual([
        { contest: 'gull-shoot', cheat: 'magic', watcher: 'npc-cray', disqualified: true },
      ]);
      expect(t.ended).toMatchObject([{ outcome: 'disqualified', placement: 2 }]);
      expect(t.host.disposition('npc-cray')).toBe(-3);
      expect(t.runner.isActive('gull-shoot')).toBe(false);
    });

    it('AC-2 (edge): an unobserved cast fires nothing, scores its bonus and costs the undetected effects at the end', () => {
      const t = setup(contest({ cheats: [cheater()] }), { perception: watch('someone-else') });
      t.runner.enter('gull-shoot', 0);
      t.runner.record(cast(2));
      t.flush();
      expect(t.caught).toEqual([]);
      expect(t.runner.isActive('gull-shoot')).toBe(true);
      expect(t.runner.standings('gull-shoot')[0]).toMatchObject({ id: CONTEST_PLAYER, score: 1 });
      t.runner.forfeit('gull-shoot');
      expect(t.host.disposition('npc-cray')).toBe(-1); // cheating always has a consequence
    });

    it('with no perception nobody ever notices', () => {
      const t = setup(contest({ cheats: [cheater()] }));
      t.runner.enter('gull-shoot', 0);
      t.runner.record(cast(2));
      expect(t.runner.isActive('gull-shoot')).toBe(true);
    });

    it('a rival casting is not the player cheating, and a failed `when` is no cheat', () => {
      const t = setup(
        contest({
          cheats: [cheater({ when: { kind: 'hasItem', item: 'ring', count: 1 }, bonusPoints: 0 })],
        }),
        { perception: watch('npc-cray') },
      );
      t.runner.enter('gull-shoot', 0);
      t.runner.record({ ...cast(1), actor: 'rival' });
      t.runner.record(cast(2)); // no ring
      expect(t.runner.isActive('gull-shoot')).toBe(true);
      t.host.giveItem('ring', 1);
      t.runner.record(cast(3)); // seen, but zero bonus; disqualified
      expect(t.runner.isActive('gull-shoot')).toBe(false);
    });

    it('a seen cheat that does not disqualify applies its effects and the contest goes on', () => {
      const def = contest({
        cheats: [
          cheater({
            detected: { disqualify: false, effects: [disposition('npc-cray', -2)] },
            bonusPoints: 0,
          }),
        ],
      });
      const t = setup(def, { perception: watch('npc-cray') });
      t.runner.enter('gull-shoot', 0);
      t.runner.record(cast(1));
      t.flush();
      expect(t.caught).toMatchObject([{ disqualified: false }]);
      expect(t.runner.isActive('gull-shoot')).toBe(true);
      expect(t.host.disposition('npc-cray')).toBe(-2);
      t.runner.forfeit('gull-shoot');
      expect(t.host.disposition('npc-cray')).toBe(-2); // caught: no undetected cost on top
      expect(t.host.disposition('npc-oona')).toBe(1);
    });

    it('a disqualification applies the disqualified effects when the contest has them', () => {
      const def = contest({
        cheats: [cheater({ detected: { disqualify: true } })],
        disqualified: { effects: [disposition('npc-oona', -5)] },
      });
      const t = setup(def, { perception: watch('npc-cray') });
      t.runner.enter('gull-shoot', 0);
      t.runner.record(cast(1));
      expect(t.host.disposition('npc-oona')).toBe(-5);
    });
  });

  describe('betting', () => {
    const betting = () => contest({ betting: book });

    it("AC-3: accepting Nell's bet to throw the match: a loss applies the payout", () => {
      const t = setup(betting());
      t.runner.enter('gull-shoot', 0);
      expect(t.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({ ok: true });
      t.runner.record(hit(1, { actor: 'rival' }));
      t.runner.record(hit(2, { actor: 'rival' }));
      t.runner.record(hit(3, { actor: 'rival' }));
      t.flush();
      expect(t.ended).toMatchObject([{ outcome: 'lost' }]);
      expect(t.host.gold()).toBe(50 - 3 + 15);
      expect(t.host.disposition('npc-nell')).toBe(0);
    });

    it('AC-3: ... and if they win, the betting-book grudge applies instead', () => {
      const t = setup(betting());
      t.runner.enter('gull-shoot', 0);
      t.runner.bet('gull-shoot', { kind: 'throw' });
      t.runner.record(hit(1));
      t.runner.record(hit(2));
      t.runner.record(hit(3));
      t.flush();
      expect(t.ended).toMatchObject([{ outcome: 'won' }]);
      expect(t.host.disposition('npc-nell')).toBe(-4);
      expect(t.host.gold()).toBe(50 - 3 + 20); // the win prize, not the bribe
    });

    it('a forfeit is a clean loss for a thrown match; a disqualification is not', () => {
      const t = setup(betting());
      t.runner.enter('gull-shoot', 0);
      t.runner.bet('gull-shoot', { kind: 'throw' });
      t.runner.forfeit('gull-shoot');
      expect(t.host.gold()).toBe(50 - 3 + 15);
      const dq = setup(contest({ betting: book, cheats: [cheater()] }), {
        perception: { perceives: () => true },
      });
      dq.runner.enter('gull-shoot', 0);
      dq.runner.bet('gull-shoot', { kind: 'throw' });
      dq.runner.record({ name: 'spell.cast', tick: 1 });
      expect(dq.host.disposition('npc-nell')).toBe(-4);
      expect(dq.host.gold()).toBe(50 - 3);
    });

    it('a stake on the player pays stake plus odds on a win and is lost otherwise', () => {
      const win = setup(betting());
      win.runner.enter('gull-shoot', 0);
      expect(win.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 5 })).toEqual({ ok: true });
      expect(win.host.gold()).toBe(50 - 3 - 5);
      for (const tick of [1, 2, 3]) win.runner.record(hit(tick));
      expect(win.host.gold()).toBe(50 - 3 - 5 + 5 + 7 + 20); // 5 * 3/2 = 7 (rounded down)
      const lose = setup(betting());
      lose.runner.enter('gull-shoot', 0);
      lose.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 5 });
      lose.runner.forfeit('gull-shoot');
      expect(lose.host.gold()).toBe(50 - 3 - 5);
    });

    it('refuses bets that are not offered, too early or late, badly sized or unaffordable', () => {
      const t = setup(betting(), { gold: 6 });
      expect(t.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({
        ok: false,
        reason: 'not-active',
      });
      t.runner.enter('gull-shoot', 0);
      expect(t.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 1 })).toEqual({
        ok: false,
        reason: 'bad-stake',
      });
      expect(t.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 2.5 })).toEqual({
        ok: false,
        reason: 'bad-stake',
      });
      expect(t.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 4 })).toEqual({
        ok: false,
        reason: 'cannot-afford',
      });
      expect(t.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({ ok: true });
      expect(t.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({
        ok: false,
        reason: 'already-bet',
      });
      t.runner.record(hit(1));
      const late = setup(betting());
      late.runner.enter('gull-shoot', 0);
      late.runner.record(hit(1));
      expect(late.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({
        ok: false,
        reason: 'betting-closed',
      });
      const bare = setup();
      bare.runner.enter('gull-shoot', 0);
      expect(bare.runner.bet('gull-shoot', { kind: 'throw' })).toEqual({
        ok: false,
        reason: 'no-such-bet',
      });
      expect(bare.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 2 })).toEqual({
        ok: false,
        reason: 'no-such-bet',
      });
    });

    it('a stake that the host refuses is reported', () => {
      const t = setup(betting());
      t.runner.enter('gull-shoot', 0);
      t.host.adjustGold = () => 'busted';
      expect(t.runner.bet('gull-shoot', { kind: 'onPlayer', stake: 2 }).ok).toBe(false);
    });
  });

  it('an outcome batch that refuses is reported on contest.ended, and the contest still ends', () => {
    const t = setup(
      contest({
        win: { placement: 1, effects: [{ kind: 'takeItem', item: 'nothing', count: 1 }] },
      }),
    );
    t.runner.enter('gull-shoot', 0);
    for (const tick of [1, 2, 3]) t.runner.record(hit(tick));
    t.flush();
    expect(t.ended).toMatchObject([{ outcome: 'won', refused: 'takeItem:missing-item:nothing' }]);
    expect(t.runner.isActive('gull-shoot')).toBe(false);
  });

  it('works without an event sink and a second contest runs independently', () => {
    const host = new MemoryLogicHost({ gold: 10 });
    const other = contest({ id: 'other', scoring: [{ event: 'arrow.hit', where: {}, points: 1 }] });
    const runner = new ContestRunner({ contests: [contest(), other], host, rng: Rng.create(1) });
    runner.enter('gull-shoot', 0);
    runner.enter('other', 0);
    runner.record(hit(1));
    expect(runner.standings('other')[0]?.score).toBe(1);
    expect(runner.result('other')).toBeUndefined();
  });

  it('serialize and restore resume a contest in progress, with its rng stream', () => {
    const def = contest({
      participants: [
        { id: 'rival', name: 'Rival', pace: { everyTicks: 10, points: 1, spread: 3 } },
      ],
      finish: { afterTicks: 1000 },
    });
    const a = setup(def, { seed: 9 });
    a.runner.enter('gull-shoot', 0);
    a.runner.record(hit(1));
    a.runner.update(30);
    const saved = JSON.parse(JSON.stringify(a.runner.serialize())) as ContestSnapshot;
    a.runner.update(100);

    const b = setup(def, { seed: 1234 });
    b.runner.restore(saved);
    expect(b.runner.isActive('gull-shoot')).toBe(true);
    b.runner.update(100);
    expect(b.runner.standings('gull-shoot')).toEqual(a.runner.standings('gull-shoot'));
    b.runner.forfeit('gull-shoot');
    const done = JSON.parse(JSON.stringify(b.runner.serialize())) as ContestSnapshot;
    const c = setup(def);
    c.runner.restore(done);
    expect(c.runner.result('gull-shoot')).toBe('forfeit');
    expect(c.runner.isActive('gull-shoot')).toBe(false);
  });
});
