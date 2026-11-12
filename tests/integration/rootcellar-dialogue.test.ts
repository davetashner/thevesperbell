// mw-e39.8: Clatter, Mother Kettleback and Snig, played by the real DialogueRuntime against the shipped
// content. Each AC names its test; conversations use a MemoryLogicHost so the facts, gold and
// disposition they change are visible.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { gameContentSources, loadGameContent } from '@content/index';
import { loadDevContent } from '@content/dev-content';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime, type CheckResolver, type DialogueView } from '@sim/dialogue/runtime';
import type { DialogueDef } from '@content/types/dialogue';
import { main } from '../../src/tools/dialogue/cli';

const content = loadGameContent();
const NPC_OF: Record<string, string> = {
  'clatter-garden': 'npc-clatter',
  'kettleback-kitchen': 'npc-kettleback',
  'snig-tunnels': 'npc-snig',
};
const THREE = Object.keys(NPC_OF);
const CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;
const win: CheckResolver = () => true;
const lose: CheckResolver = () => false;

function session(
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  checks?: CheckResolver,
) {
  const world = new World<never>({ seed: 1, hz: 60 });
  // MemoryLogicHost has no registry, so the registered defaults the dialogues compare against are given here.
  const host = new MemoryLogicHost({
    ...init,
    facts: { ...DEFAULT_FACTS, ...init.facts },
  });
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
    ...(checks !== undefined && { checks }),
  });
  const start = (dialogue: string): DialogueView => runtime.start(dialogue, NPC_OF[dialogue] ?? '');
  /** Advances through lines until a choice (or the end). */
  const settle = (): DialogueView => {
    let view = runtime.view;
    for (let i = 0; view?.kind === 'line' && i < 50; i++) view = runtime.advance();
    return view ?? { kind: 'ended', reason: 'completed' };
  };
  const ids = (): string[] => runtime.choices().map((c) => c.id);
  const pick = (id: string): DialogueView => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    const result = runtime.choose(index);
    expect(result.ok, id).toBe(true);
    return settle();
  };
  /** Every line spoken from the current view until the next choice (or the end). */
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  /** Text of the line now showing ('' when none). */
  const text = (): string => {
    const view = runtime.view;
    return view?.kind === 'line' ? view.text : '';
  };
  /** Starts, reads the opening and runs to the first choice. */
  const open = (dialogue: string): string => {
    start(dialogue);
    const first = text();
    settle();
    return first;
  };
  return { world, host, runtime, start, settle, ids, pick, lines, text, open };
}

const DEFAULT_FACTS = {
  'clatter.memories': 0,
  'burglar.outcome': 'open',
  'duggan.crate': 'crated',
};
const CLATTER = 'clatter-garden';
const KETTLEBACK = 'kettleback-kitchen';
const SNIG = 'snig-tunnels';

describe('Clatter, Mother Kettleback and Snig', () => {
  it('AC-1: all three load, validate with zero errors, warnings and unreachable nodes', ({
    task,
  }) => {
    for (const id of THREE) markExercised(task, 'dialogue', id);
    for (const id of THREE) {
      expect(content.has('dialogue', id), id).toBe(true);
      // every creature names its dialogue, so walking up to each talks (mw-e22.9)
      expect(content.get('creature', NPC_OF[id] ?? '').dialogue?.id, id).toBe(id);
    }
    const log: string[] = [];
    const code = main(['--max-length', '240'], {
      log: (line) => log.push(line),
      sources: gameContentSources,
      content: () => content,
    });
    expect(log.join('\n')).toMatch(/0 error\(s\), 0 warning\(s\)/);
    expect(log.join('\n')).not.toMatch(/unreachable/);
    expect(code).toBe(0);
  });

  it('AC-1: every fact they read or write is registered with the right type', () => {
    const facts = new Map(content.all('fact').flatMap((g) => g.facts.map((f) => [f.key, f])));
    const group = content.get('fact', 'rootcellar-dialogue');
    expect(group.facts.length).toBeGreaterThan(12);
    for (const fact of group.facts) expect(facts.has(fact.key), fact.key).toBe(true);
    expect(facts.get('clatter.memories')?.type).toBe('int');
    expect(facts.get('goblins.standing')).toMatchObject({
      type: 'enum',
      values: ['hostile', 'neutral', 'friendly'],
    });
    // the dialogues use only registered keys
    const used = THREE.flatMap((id) =>
      [...JSON.stringify(content.get('dialogue', id)).matchAll(/"fact":"([^"]+)"/g)].map(
        (m) => m[1],
      ),
    );
    for (const key of used) expect(facts.has(key ?? ''), `${key ?? ''} registered`).toBe(true);
  });

  it('every character has at least four class-only branches between the classes', () => {
    for (const id of THREE) {
      const gated = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass, facts: { 'burglar.outcome': 'deal' } });
        s.open(id);
        for (const c of s.runtime.choices())
          if (c.tags.some((t) => t.kind === 'class')) gated.add(c.id);
      }
      expect(gated.size, id).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Clatter', () => {
  const lineSetFor = (memories: number): string => {
    const s = session({ facts: { 'clatter.memories': memories } });
    const greeting = s.open(CLATTER);
    s.runtime.choose(s.ids().indexOf('ask-memory'));
    return [greeting, ...s.lines()].join('|');
  };

  it('AC-2: clatter.memories 0, 1, 2 and 3 each use a distinct greeting and memory-fragment set', () => {
    const sets = [0, 1, 2, 3].map(lineSetFor);
    expect(new Set(sets).size).toBe(4);
    expect(sets[0]).toMatch(/Mushrooms\. I remember mushrooms/);
    expect(sets[1]).toMatch(/pear tree/);
    expect(sets[2]).toMatch(/sister/);
    expect(sets[3]).toMatch(/Corvin/);
  });

  it('AC-2: the first meeting is its own scene and only happens once', () => {
    const s = session();
    s.start(CLATTER);
    expect(s.text()).toMatch(/I wasn't\.\.\. Do mind the mushrooms/);
    s.settle();
    s.pick('leave');
    s.start(CLATTER);
    expect(s.text()).toMatch(/Hello again/);
  });

  it('a swelling song takes the recovered memories: he notices, then starts over', () => {
    const s = session({ facts: { 'clatter.memories': 0, 'clatter.song-swelled': true } });
    s.start(CLATTER);
    expect(s.text()).toMatch(/Was someone humming/);
    s.settle();
    expect(s.host.facts.get('clatter.song-swelled')).toBe(false);
    // the quest, not the dialogue, owns the count: it is not touched here
    expect(s.host.facts.get('clatter.memories')).toBe(0);
    // once restored, a later swell no longer takes anything
    const restored = session({
      facts: { 'clatter.song-swelled': true, 'clatter.restored': true },
    });
    restored.start(CLATTER);
    expect(restored.text()).toMatch(/Brother Anselm Hobb/);
  });

  it('a hostile Clatter only apologises until you lower a weapon or hum; he stays friendly', () => {
    const s = session({ facts: { 'clatter.hostile': true } });
    s.start(CLATTER);
    expect(s.text()).toMatch(/Sorry! Sorry\. I don't want to hit you/);
    s.settle();
    expect(s.ids()).toEqual(['bark-lower', 'bark-hum', 'bark-back']);
    s.pick('bark-back');
    expect(s.host.facts.get('clatter.hostile')).toBe(true);
    s.start(CLATTER);
    expect(s.text()).toMatch(/Oh, you again\. Sorry/);
    s.settle();
    s.pick('bark-hum');
    expect(s.host.facts.get('clatter.hostile')).toBe(false);
    expect(s.host.disposition('npc-clatter')).toBe(2);
    expect(s.ids()).toContain('ask-memory');

    const lowered = session({ facts: { 'clatter.hostile': true, 'clatter.memories': 2 } });
    lowered.open(CLATTER);
    lowered.pick('bark-lower');
    expect(lowered.host.facts.get('clatter.hostile')).toBe(false);
    expect(lowered.ids()).toContain('ask-memory');
  });

  it('restored, he asks to join or rest; either is right, and the knight gives the rites', () => {
    const join = session({ facts: { 'clatter.restored': true } });
    join.open(CLATTER);
    join.pick('restored-name');
    const joined = join.pick('join-ask');
    expect(joined.kind).toBe('ended');
    expect(join.host.facts.get('clatter.fate')).toBe('joined');
    expect(join.host.emitted.map((e) => e.event)).toContain('clatter.joined');
    // afterwards he walks with you
    join.start(CLATTER);
    expect(join.text()).toMatch(/I'm right behind you/);
    join.settle();
    join.pick('joined-chat');
    expect(join.ids()).toEqual(['joined-leave']);

    const knight = session({ playerClass: 'knight', facts: { 'clatter.restored': true } });
    knight.open(CLATTER);
    knight.runtime.choose(knight.ids().indexOf('rest-ask'));
    expect(knight.text()).toMatch(/Vesperine rites/);
    knight.settle();
    expect(knight.host.facts.get('clatter.fate')).toBe('rested');
    expect(knight.host.emitted.map((e) => e.event)).toContain('clatter.rested');

    const other = session({ playerClass: 'thief', facts: { 'clatter.restored': true } });
    other.open(CLATTER);
    other.runtime.choose(other.ids().indexOf('rest-ask'));
    expect(other.text()).toMatch(/Lay my psalter on the altar/);
    expect(other.host.facts.get('clatter.fate')).toBeUndefined();
    other.settle();
    expect(other.host.facts.get('clatter.fate')).toBe('rested');
  });

  it('the class branches: sorcerer gambles on a memory, thief returns a trowel, knight and archer keep watch', () => {
    // a successful reading skips a piece, a failed one costs a piece (never below 0)
    for (const [from, up] of [
      [0, 1],
      [1, 2],
      [2, 3],
    ] as const) {
      const s = session({ playerClass: 'sorcerer', facts: { 'clatter.memories': from } }, win);
      s.open(CLATTER);
      s.pick('read-sorcerer');
      expect(s.host.facts.get('clatter.memories'), `up from ${String(from)}`).toBe(up);
      expect(s.ids()).not.toContain('read-sorcerer');
    }
    for (const [from, down] of [
      [0, 0],
      [1, 0],
      [2, 1],
    ] as const) {
      const s = session({ playerClass: 'sorcerer', facts: { 'clatter.memories': from } }, lose);
      s.open(CLATTER);
      s.pick('read-sorcerer');
      expect(Number(s.host.facts.get('clatter.memories') ?? 0), `down from ${String(from)}`).toBe(
        down,
      );
    }
    // a fully remembering Clatter needs no reading
    const full = session({ playerClass: 'sorcerer', facts: { 'clatter.memories': 3 } });
    full.open(CLATTER);
    expect(full.ids()).not.toContain('read-sorcerer');

    const thief = session({ playerClass: 'thief' });
    thief.open(CLATTER);
    thief.pick('return-thief');
    expect(thief.host.disposition('npc-clatter')).toBe(4);
    const knight = session({ playerClass: 'knight' });
    knight.open(CLATTER);
    knight.pick('guard-knight');
    expect(knight.host.disposition('npc-clatter')).toBe(3);
    const archer = session({ playerClass: 'archer' });
    archer.open(CLATTER);
    archer.pick('watch-archer');
    expect(archer.host.disposition('npc-clatter')).toBe(3);
    const none = session({ playerClass: 'knight' });
    none.open(CLATTER);
    expect(none.ids()).not.toEqual(expect.arrayContaining(['return-thief', 'watch-archer']));
  });

  it('the small talk about the garden, the goblins and the humming plays and returns to the menu', () => {
    const s = session({ facts: { 'clatter.memories': 1 } });
    s.open(CLATTER);
    for (const id of ['ask-garden', 'ask-goblins', 'ask-humming']) {
      s.pick(id);
      expect(s.ids(), id).toContain('leave');
      expect(s.ids(), id).not.toContain(id);
    }
    expect(s.pick('leave').kind).toBe('ended');
  });
});

describe('Mother Kettleback', () => {
  const openingFor = (standing: string | undefined): string => {
    const s = session(standing === undefined ? {} : { facts: { 'goblins.standing': standing } });
    s.start(KETTLEBACK);
    return s.text();
  };

  it('AC-3: hostile, wary and friendly each play their own opening branch', () => {
    const hostile = openingFor('hostile');
    const wary = openingFor('neutral');
    const friendly = openingFor('friendly');
    expect(new Set([hostile, wary, friendly]).size).toBe(3);
    expect(hostile).toMatch(/elbows out/);
    expect(wary).toMatch(/Stay by the door/);
    expect(friendly).toMatch(/good boots and the better manners/);
    // the default (never set) standing is the wary one
    expect(openingFor(undefined)).toBe(wary);
  });

  it('AC-3: each opening leads somewhere different: hostile can only parley, the others do business', () => {
    const hostile = session({ facts: { 'goblins.standing': 'hostile' } });
    hostile.open(KETTLEBACK);
    expect(hostile.ids()).toEqual(['parley-persuade', 'parley-bread', 'parley-leave']);
    for (const standing of ['neutral', 'friendly']) {
      const s = session({ facts: { 'goblins.standing': standing } });
      s.open(KETTLEBACK);
      expect(s.ids(), standing).toEqual(expect.arrayContaining(['ask-dream', 'ask-horn', 'leave']));
    }
    // the second visit is short, in each voice
    for (const standing of ['hostile', 'neutral', 'friendly']) {
      const s = session({ facts: { 'goblins.standing': standing } });
      const first = s.open(KETTLEBACK);
      const second = ((): string => {
        s.pick(standing === 'hostile' ? 'parley-leave' : 'leave');
        s.start(KETTLEBACK);
        return s.text();
      })();
      expect(second, standing).not.toBe(first);
    }
  });

  it('a hostile player can parley: a won check, or a loaf of bread, cools the clan to wary', () => {
    const won = session({ facts: { 'goblins.standing': 'hostile' } }, win);
    won.open(KETTLEBACK);
    won.pick('parley-persuade');
    expect(won.host.facts.get('goblins.standing')).toBe('neutral');
    expect(won.ids()).toContain('ask-dream');

    const lost = session({ facts: { 'goblins.standing': 'hostile' } }, lose);
    lost.open(KETTLEBACK);
    lost.pick('parley-persuade');
    expect(lost.host.facts.get('goblins.standing')).toBe('hostile');
    expect(lost.ids()).toEqual(['parley-persuade', 'parley-bread', 'parley-leave']);

    const bread = session({ facts: { 'goblins.standing': 'hostile' }, items: { 'bread-loaf': 1 } });
    bread.open(KETTLEBACK);
    bread.pick('parley-bread');
    expect(bread.host.facts.get('goblins.standing')).toBe('neutral');
    expect(bread.host.itemCount('bread-loaf')).toBe(0);
    const empty = session({ facts: { 'goblins.standing': 'hostile' } });
    empty.open(KETTLEBACK);
    expect(empty.runtime.choices().find((c) => c.id === 'parley-bread')?.locked).toBe(true);
    expect(empty.pick('parley-leave').kind).toBe('ended');
  });

  it('AC-4: captured while hostile, the player is offered a negotiation, never a game over', () => {
    const paths: {
      name: string;
      init: Parameters<typeof session>[0];
      checks?: CheckResolver;
      go: (s: ReturnType<typeof session>) => void;
    }[] = [
      { name: 'pay', init: { gold: 40 }, go: (s) => s.pick('cap-pay') },
      { name: 'work it off', init: {}, go: (s) => s.pick('cap-work') },
      { name: 'talk her down', init: {}, checks: win, go: (s) => s.pick('cap-persuade') },
      { name: 'talk and fail', init: {}, checks: lose, go: (s) => s.pick('cap-persuade') },
    ];
    for (const standing of ['hostile', 'neutral', 'friendly']) {
      for (const { name, init, checks, go } of paths) {
        const s = session(
          { ...init, facts: { 'goblins.standing': standing, 'player.captured-by-goblins': true } },
          checks,
        );
        s.start(KETTLEBACK);
        expect(s.text(), `${standing}/${name}`).toMatch(/Look what the nets caught/);
        s.settle();
        // the negotiation options are all there (the fee only when affordable)
        expect(s.ids()).toEqual(['cap-pay', 'cap-work', 'cap-persuade']);
        const view = (go(s), s.runtime.view);
        // captivity ends, the conversation carries on to ordinary business and was never aborted
        expect(view?.kind, `${standing}/${name}`).toBe('choice');
        expect(s.host.facts.get('player.captured-by-goblins')).toBe(false);
        expect(s.host.facts.get('goblins.standing') ?? 'neutral').not.toBe('hostile');
        expect(s.host.emitted.map((e) => e.event)).toContain('kettleback.released');
        expect(s.ids()).toContain('leave');
        expect(s.pick('leave').kind).toBe('ended');
      }
    }
    // paying costs 15; working it off leaves an errand
    const pay = session({ gold: 40, facts: { 'player.captured-by-goblins': true } });
    pay.open(KETTLEBACK);
    pay.pick('cap-pay');
    expect(pay.host.gold()).toBe(25);
    const work = session({ facts: { 'player.captured-by-goblins': true } });
    work.open(KETTLEBACK);
    work.pick('cap-work');
    expect(work.host.facts.get('kettleback.errand')).toBe(true);
    // a broke player sees the fee locked, with the way out still open
    const broke = session({ facts: { 'player.captured-by-goblins': true } });
    broke.open(KETTLEBACK);
    expect(broke.runtime.choices().find((c) => c.id === 'cap-pay')?.locked).toBe(true);
  });

  it('dying while Horn is dead wakes the player in the camp and charges a carrying fee', () => {
    const paid = session({ gold: 30, facts: { 'player.woke-in-camp': true } });
    paid.start(KETTLEBACK);
    expect(paid.text()).toMatch(/carrying fee/);
    paid.settle();
    paid.pick('fee-pay');
    expect(paid.host.gold()).toBe(10);
    expect(paid.host.facts.get('player.woke-in-camp')).toBe(false);
    expect(paid.ids()).toContain('leave');

    const owed = session({ facts: { 'player.woke-in-camp': true } });
    owed.open(KETTLEBACK);
    expect(owed.runtime.choices().find((c) => c.id === 'fee-pay')?.locked).toBe(true);
    owed.pick('fee-owe');
    expect(owed.host.disposition('npc-kettleback')).toBe(-2);
    expect(owed.host.facts.get('player.woke-in-camp')).toBe(false);
  });

  it('goblins do not dream, and the Big One feeds the sleepers; the Horn arrangement is told by trust', () => {
    const s = session();
    s.open(KETTLEBACK);
    s.start(KETTLEBACK);
    s.settle();
    s.runtime.choose(s.ids().indexOf('ask-dream'));
    const said = s.lines().join(' ');
    expect(said).toMatch(/Goblins don't dream, sweetling\. Nothing up here to sing to\./);
    expect(said).toMatch(/Big One carries the sleepers to the soft room/);
    expect(s.host.facts.get('kettleback.sleepers-told')).toBe(true);

    const friendly = session({ facts: { 'goblins.standing': 'friendly' } });
    friendly.open(KETTLEBACK);
    friendly.pick('ask-horn');
    expect(friendly.host.facts.get('kettleback.horn-deal-told')).toBe(true);
    expect(friendly.ids()).not.toContain('ask-horn');

    const lost = session({}, lose);
    lost.open(KETTLEBACK);
    lost.pick('ask-horn');
    expect(lost.host.facts.get('kettleback.horn-deal-told')).toBeUndefined();
    expect(lost.ids()).toContain('ask-horn');
    const won = session({}, win);
    won.open(KETTLEBACK);
    won.pick('ask-horn');
    expect(won.host.facts.get('kettleback.horn-deal-told')).toBe(true);
    expect(won.host.disposition('npc-kettleback')).toBe(1);
  });

  it("Duggan's crate: talk her round, bring the kettle, or take the planting kit", () => {
    const talked = session({}, win);
    talked.open(KETTLEBACK);
    talked.pick('ask-duggan');
    talked.pick('duggan-persuade');
    expect(talked.host.facts.get('duggan.crate')).toBe('freed');
    expect(talked.host.emitted.map((e) => e.event)).toContain('duggan.released');
    expect(talked.ids()).not.toContain('ask-duggan');

    const refused = session({}, lose);
    refused.open(KETTLEBACK);
    refused.pick('ask-duggan');
    refused.pick('duggan-persuade');
    expect(refused.host.facts.get('duggan.crate')).toBe('crated');
    expect(refused.ids()).toContain('duggan-kit');
    refused.pick('duggan-kit');
    expect(refused.host.facts.get('duggan.kit-taken')).toBe(true);
    expect(refused.ids()).not.toContain('duggan-kit');
    refused.pick('duggan-back');
    expect(refused.ids()).toContain('ask-duggan');

    const trade = session({ facts: { 'kettleback.kettle-brought': true } });
    trade.open(KETTLEBACK);
    trade.pick('ask-duggan');
    trade.pick('duggan-kettle');
    expect(trade.host.facts.get('duggan.crate')).toBe('freed');
    expect(trade.host.facts.get('kettleback.kettle-brought')).toBe(false);
    expect(trade.host.disposition('npc-kettleback')).toBe(5);

    const noKettle = session();
    noKettle.open(KETTLEBACK);
    noKettle.pick('ask-duggan');
    expect(noKettle.runtime.choices().find((c) => c.id === 'duggan-kettle')?.locked).toBe(true);
  });

  it('trade lines: she buys bread for coin and a class remark each', () => {
    const s = session({ items: { 'bread-loaf': 2 }, gold: 1 });
    s.open(KETTLEBACK);
    s.pick('ask-trade');
    s.pick('trade-bread');
    expect(s.host.gold()).toBe(5);
    expect(s.host.itemCount('bread-loaf')).toBe(1);
    const none = session();
    none.open(KETTLEBACK);
    expect(none.runtime.choices().find((c) => c.id === 'trade-bread')?.locked).toBe(true);

    const remarks: [string, string, RegExp, number][] = [
      ['thief', 'kin-thief', /smell like pockets/, 3],
      ['knight', 'stand-knight', /Stand over there/, -1],
      ['archer', 'rat-archer', /orty paces/i, 3],
      ['sorcerer', 'kitchen-sorcerer', /Don't do magic in my kitchen/, -1],
    ];
    for (const [playerClass, id, text, disposition] of remarks) {
      const c = session({ playerClass });
      c.open(KETTLEBACK);
      c.runtime.choose(c.ids().indexOf(id));
      expect(c.text(), id).toMatch(text);
      c.settle();
      expect(c.host.disposition('npc-kettleback'), id).toBe(disposition);
      expect(c.ids()).not.toContain(id);
    }
  });

  it("Snig's word counts: his vouch eases four of her checks", () => {
    const json = JSON.stringify(content.get('dialogue', KETTLEBACK));
    expect(json.match(/"fact":"snig\.vouched"/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Snig', () => {
  it('the Stacks burglar: caught with a book, he can be won with a deal, a sale, mercy or Hale', () => {
    const deal = session({}, win);
    deal.start(SNIG);
    expect(deal.text()).toMatch(/I'm very small and mostly string/);
    deal.settle();
    expect(deal.ids()).toEqual(['deal-offer', 'caught-hale', 'caught-let-go']);
    deal.pick('deal-offer');
    expect(deal.host.facts.get('burglar.outcome')).toBe('deal');
    expect(deal.ids()).toContain('ask-vouch');

    const failed = session({}, lose);
    failed.open(SNIG);
    failed.pick('deal-offer');
    expect(failed.host.facts.get('burglar.outcome')).toBe('open');
    // he stays caught: the offer is spent, but there is still a way forward
    expect(failed.ids()).toEqual(['caught-hale', 'caught-let-go']);

    const thief = session({ playerClass: 'thief' });
    thief.open(SNIG);
    thief.pick('caught-sell-thief');
    expect(thief.host.facts.get('burglar.outcome')).toBe('sold-book');
    const other = session({ playerClass: 'knight' });
    other.open(SNIG);
    expect(other.ids()).not.toContain('caught-sell-thief');

    const mercy = session();
    mercy.open(SNIG);
    mercy.pick('caught-let-go');
    expect(mercy.host.disposition('npc-snig')).toBe(2);
    expect(mercy.host.facts.get('burglar.outcome')).toBe('open');

    const hale = session();
    hale.open(SNIG);
    expect(hale.pick('caught-hale').kind).toBe('ended');
    expect(hale.host.facts.get('burglar.outcome')).toBe('turned-in');
    expect(hale.host.emitted.map((e) => e.event)).toContain('snig.turned-in');
  });

  it('once the burglar is settled he meets you plainly; after a sorcerer\'s light he is "the scary reading one"', () => {
    const settled = session({ facts: { 'burglar.outcome': 'deal' } });
    settled.start(SNIG);
    settled.settle();
    expect(settled.ids()).toContain('try-primer');
    expect(settled.ids()).not.toContain('deal-offer');
    settled.pick('leave');
    settled.start(SNIG);
    expect(settled.text()).toMatch(/Hello again/);

    const scary = session({ facts: { 'burglar.outcome': 'light' } });
    scary.start(SNIG);
    expect(scary.text()).toMatch(/Don't do the thing with the light/);
    scary.settle();
    scary.pick('scary-sorry');
    expect(scary.ids()).toContain('try-primer');
  });

  it('a hostile standing sends him hiding, and he gets over it', () => {
    const s = session({ facts: { 'goblins.standing': 'hostile' } });
    s.start(SNIG);
    expect(s.text()).toMatch(/Don't hit me/);
    s.settle();
    s.pick('hostile-peace');
    expect(s.host.disposition('npc-snig')).toBe(2);
    expect(s.ids()).toContain('try-primer');
  });

  it('reading attempts fail funnily; the primer needs trust; vouching needs a settled burglar', () => {
    const s = session({ facts: { 'burglar.outcome': 'deal' }, dispositions: { 'npc-snig': 3 } });
    s.open(SNIG);
    s.pick('try-primer');
    expect(s.host.disposition('npc-snig')).toBe(4);
    s.pick('try-sign');
    s.pick('ask-goblins');
    s.pick('ask-vouch');
    expect(s.host.facts.get('snig.vouched')).toBe(true);

    const stranger = session({ facts: { 'burglar.outcome': 'deal' } });
    stranger.open(SNIG);
    stranger.pick('try-primer');
    expect(stranger.host.disposition('npc-snig')).toBe(0);

    const open = session({ facts: { 'burglar.outcome': 'turned-in' } });
    open.open(SNIG);
    expect(open.runtime.choices().find((c) => c.id === 'ask-vouch')?.locked).toBe(true);
    expect(open.pick('leave').kind).toBe('ended');
  });

  it('the class branches: thief followed, knight scary until the helm is off, sorcerer asked for the trick, archer challenged', () => {
    const lines: [string, string, RegExp][] = [
      ['thief', 'follow-thief', /You're letting me/],
      ['knight', 'armour-knight', /There's a face in there/],
      ['sorcerer', 'trick-sorcerer', /The reading trick/],
      ['archer', 'contest-archer', /A contest/],
    ];
    for (const [playerClass, id, text] of lines) {
      const s = session({ playerClass, facts: { 'burglar.outcome': 'deal' } });
      s.open(SNIG);
      s.runtime.choose(s.ids().indexOf(id));
      expect(s.lines().join(' '), id).toMatch(text);
      expect(s.host.disposition('npc-snig'), id).toBeGreaterThan(0);
    }
  });

  it('after the lessons he reads, and says so', () => {
    const s = session({ facts: { 'snig.lessons': true } });
    s.start(SNIG);
    expect(s.text()).toMatch(/I've been to the lessons/);
    s.settle();
    s.pick('lessons-read');
    expect(s.host.disposition('npc-snig')).toBe(0);
    s.pick('lessons-vouch');
    expect(s.host.facts.get('snig.vouched')).toBe(true);
    s.pick('lessons-book');
    expect(s.pick('lessons-leave').kind).toBe('ended');
  });
});

// ---- AC-5: a content lint over Snig's lines -------------------------------------------------------

interface LooseNode {
  id: string;
  kind: string;
  text?: string;
  next?: string;
  success?: string;
  failure?: string;
  else?: string;
  onFail?: string;
  routes?: { when?: unknown; next: string }[];
  options?: { when?: unknown; next?: string; onFail?: string; text: string }[];
}
interface LooseDialogue {
  entries: { when?: unknown; node: string }[];
  nodes: LooseNode[];
}

const GATE = 'snig.lessons';
const mentionsGate = (when: unknown): boolean => JSON.stringify(when ?? null).includes(GATE);

/** Nodes a player can reach without the lessons outcome (entries, routes and options that mention it are skipped). */
function nodesBeforeLessons(dialogue: LooseDialogue): LooseNode[] {
  const byId = new Map(dialogue.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = dialogue.entries.filter((e) => !mentionsGate(e.when)).map((e) => e.node);
  while (queue.length > 0) {
    const id = queue.pop() ?? '';
    const node = byId.get(id);
    if (node === undefined || seen.has(id)) continue;
    seen.add(id);
    queue.push(
      ...[node.next, node.success, node.failure, node.else, node.onFail].filter(
        (t): t is string => t !== undefined,
      ),
      ...(node.routes ?? []).filter((r) => !mentionsGate(r.when)).map((r) => r.next),
      ...(node.options ?? [])
        .filter((o) => !mentionsGate(o.when))
        .flatMap((o) => [o.next, o.onFail].filter((t): t is string => t !== undefined)),
    );
  }
  return dialogue.nodes.filter((n) => seen.has(n.id));
}

const wordCount = (text: string): number => text.trim().split(/\s+/).length;

/**
 * Does this line depict a goblin successfully reading a full sentence? Pragmatic rule: Snig reads
 * aloud something quoted in double quotes of four or more words (with a reading cue), or claims to
 * have read a whole sentence, page or book.
 */
function readsFullSentence(text: string): boolean {
  const quoted = [...text.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1] ?? '');
  const readsAloud = quoted.some((q) => wordCount(q) >= 4);
  const claims =
    /\bI (just |actually )?read (it|this|that|a whole|the whole|a sentence|a page|all of)\b/i.test(
      text,
    );
  return readsAloud || claims;
}

describe("Snig's lines (AC-5)", () => {
  const snig = content.get('dialogue', SNIG) as unknown as LooseDialogue;

  it('AC-5: no line before the lessons outcome depicts a goblin reading a full sentence', () => {
    const before = nodesBeforeLessons(snig);
    // the lint scans real text, and a lot of it
    const spoken = before.filter((n) => n.kind === 'line');
    expect(spoken.length).toBeGreaterThan(30);
    const offenders = spoken.filter((n) => readsFullSentence(n.text ?? '')).map((n) => n.id);
    expect(offenders).toEqual([]);
    // he also reaches for the word, so the lint is not passing by silence
    expect(spoken.map((n) => n.text).join(' ')).toMatch(/snake/);
  });

  it('AC-5: the lessons nodes are gated, hold the successful reading, and the lint recognises it', () => {
    const before = new Set(nodesBeforeLessons(snig).map((n) => n.id));
    const lessons = snig.nodes.filter((n) => n.id.startsWith('lessons-'));
    expect(lessons.length).toBeGreaterThan(5);
    for (const node of lessons) expect(before.has(node.id), node.id).toBe(false);
    const reading = snig.nodes.find((n) => n.id === 'lessons-read-1');
    expect(readsFullSentence(reading?.text ?? '')).toBe(true);
    // the only entry into them is gated on the fact
    expect(snig.entries.filter((e) => mentionsGate(e.when)).map((e) => e.node)).toEqual([
      'lessons-1',
    ]);
  });

  it('AC-5: the lint flags a goblin who reads a sentence aloud, or says he read a whole page', () => {
    expect(readsFullSentence('Listen! "The cat sat on the mat." Did you hear me?')).toBe(true);
    expect(readsFullSentence('I read it! All of it, start to finish!')).toBe(true);
    expect(readsFullSentence('I read a whole page and nobody believes me.')).toBe(true);
    expect(
      readsFullSentence('That one is a snake. S. Snake. Is the whole book about snakes?'),
    ).toBe(false);
    expect(readsFullSentence('The book lady says "Again, Snig" a lot.')).toBe(false);
  });
});

describe('placement', () => {
  it('they are unplaced in the real world (E26) but can be talked to in the debug conversation room', () => {
    const shipped = loadGameContent();
    for (const scene of shipped.all('scene'))
      for (const spawn of scene.spawns)
        expect(['npc-clatter', 'npc-kettleback', 'npc-snig']).not.toContain(spawn.creature?.id);
    const dev = loadDevContent();
    const room = dev.get('scene', 'conversation-room');
    const placed = room.spawns.map((s) => s.creature?.id);
    expect(placed).toEqual(expect.arrayContaining(['npc-clatter', 'npc-kettleback', 'npc-snig']));
    for (const id of ['npc-clatter', 'npc-kettleback', 'npc-snig'])
      expect(dev.get('creature', id).dialogue?.id).toBeDefined();
    for (const id of THREE) {
      const file = content.get('dialogue', id) as unknown as { notes?: string };
      expect(file.notes ?? '', id).toMatch(/unplaced|Not placed yet/);
    }
  });
});
