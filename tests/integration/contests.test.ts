// mw-e40.5: the shipped contests (src/content/data/contest) against the real game content. Every
// contest has entry, win and lose; every condition and effect is valid logic DSL whose item, NPC,
// fact and class references resolve; every cheat names who would notice it and what it costs even
// unseen; and a contest runs end to end on the runner with the world's own event bus.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import type { GameContent } from '@content/registry';
import { describeContent } from '@content/testing';
import { EventBus } from '@sim/core/events';
import {
  ContestCheatDetected,
  ContestEnded,
  ContestRunner,
  validateContestLogic,
} from '@sim/contest/index';
import { MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';
import { Rng } from '@sim/rng';

function referencesIn(content: GameContent): LogicRefChecker {
  const facts = factIndex(content.all('fact'));
  const known: Record<string, (id: string) => boolean> = {
    item: (id) => content.has('item', id),
    npc: (id) => content.has('creature', id),
    class: (id) => content.has('class', id),
    fact: (key) => lookupFact(facts, key) !== undefined,
  };
  return (ref) =>
    known[ref.type]?.(ref.id) === false ? `unknown ${ref.type} "${ref.id}"` : undefined;
}

describeContent(
  'contest',
  'AC-4: has entry, win and lose, and its effects resolve',
  (contest, content) => {
    expect(contest.entry).toBeDefined();
    expect(contest.win.effects.length).toBeGreaterThan(0);
    expect(contest.lose.effects.length).toBeGreaterThan(0);
    expect(validateContestLogic(contest as never, referencesIn(content))).toEqual([]);
    for (const cheat of contest.cheats) {
      expect(cheat.undetected.effects.length, `cheat ${cheat.id} is free`).toBeGreaterThan(0);
    }
  },
);

describe('the Drowned Gull arm-wrestling', () => {
  it('AC-1..3: runs end to end: enter, bet to throw, cheat, and Nell or Oona catches the cast', () => {
    const content = loadGameContent();
    const def = content.get('contest', 'drowned-gull-arm-wrestling');
    const host = new MemoryLogicHost({ gold: 30 });
    const bus = new EventBus();
    const log: string[] = [];
    bus.on(ContestEnded, (e) => log.push(`ended:${e.outcome}`));
    bus.on(ContestCheatDetected, (e) => log.push(`caught:${e.watcher}`));
    const runner = new ContestRunner({
      contests: [def],
      host,
      rng: Rng.create(1),
      events: bus,
      perception: { perceives: (watcher) => watcher === 'npc-oona' },
    });
    expect(runner.enter(def.id, 0)).toEqual({ ok: true });
    expect(runner.bet(def.id, { kind: 'onPlayer', stake: 10 })).toEqual({ ok: true });
    runner.record({ name: 'spell.cast', tick: 5 });
    bus.flush();
    expect(log).toEqual(['caught:npc-oona', 'ended:disqualified']);
    expect(host.gold()).toBe(30 - 2 - 10); // the stake is gone with the match
    expect(host.disposition('npc-nell')).toBe(-3);
  });

  it('Oona wins on her own pace if the player does nothing, and the loss is graceful', () => {
    const def = loadGameContent().get('contest', 'drowned-gull-arm-wrestling');
    const host = new MemoryLogicHost({ gold: 5 });
    const runner = new ContestRunner({ contests: [def], host, rng: Rng.create(1) });
    runner.enter(def.id, 0);
    runner.update(90 * 5);
    expect(runner.result(def.id)).toBe('lost');
    expect(host.disposition('npc-oona')).toBe(1);
  });
});
