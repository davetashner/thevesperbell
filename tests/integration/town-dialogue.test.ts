// mw-e39.6: the first real character dialogue, played by the real DialogueRuntime against the shipped
// content (Vane, the Pells, Juniper, Oswin and Duggan). Each AC names its test; the conversations use a
// MemoryLogicHost so the facts they read and write are visible.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { gameContentSources, loadGameContent } from '@content/index';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime, type CheckResolver, type DialogueView } from '@sim/dialogue/runtime';
import type { DialogueDef } from '@content/types/dialogue';
import { main } from '../../src/tools/dialogue/cli';

const content = loadGameContent();
const NPC_OF: Record<string, string> = {
  'vane-bounty': 'npc-vane',
  'hollis-pell': 'npc-hollis',
  'tansy-after': 'npc-tansy',
  'juniper-fenn': 'npc-juniper',
  'oswin-forge': 'npc-oswin',
  'duggan-testimony': 'npc-duggan',
};
const SIX = Object.keys(NPC_OF);

function session(
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  checks?: CheckResolver,
) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost(init);
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
  /** Chooses without running on, so the line that follows can be read. */
  const say = (id: string): DialogueView => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    const result = runtime.choose(index);
    expect(result.ok, id).toBe(true);
    return result.view;
  };
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  return { world, host, runtime, start, settle, ids, pick, say, lines };
}

describe('the six town dialogues', () => {
  it('AC-1: all six load, validate with zero errors and warnings, and have no unreachable node', ({
    task,
  }) => {
    for (const id of SIX) markExercised(task, 'dialogue', id);
    for (const id of SIX) {
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

  it('AC-1: every merchant (Hollis, Juniper, Oswin) greets and parts differently per class', () => {
    for (const id of ['hollis-pell', 'juniper-fenn', 'oswin-forge']) {
      const greetings = new Set<string>();
      const farewells = new Set<string>();
      for (const playerClass of ['knight', 'archer', 'sorcerer', 'thief']) {
        const s = session({ playerClass });
        s.start(id);
        const greeting = s.runtime.view;
        expect(greeting?.kind).toBe('line');
        greetings.add(greeting?.kind === 'line' ? greeting.text : '');
        s.settle();
        s.say('leave');
        // leaving ends on a class farewell line
        const farewell = s.runtime.view;
        farewells.add(farewell?.kind === 'line' ? farewell.text : '');
      }
      expect(greetings.size, `${id} greetings`).toBe(4);
      expect(farewells.size, `${id} farewells`).toBe(4);
    }
  });
});

describe('Harrow Vane', () => {
  const combos = [
    { ledger: false, testimony: false, outcomes: [] },
    { ledger: true, testimony: false, outcomes: ['confront-confess', 'confront-bribe'] },
    { ledger: false, testimony: true, outcomes: ['confront-bribe', 'confront-flee'] },
    {
      ledger: true,
      testimony: true,
      outcomes: ['confront-expose', 'confront-confess', 'confront-bribe', 'confront-flee'],
    },
  ];

  for (const { ledger, testimony, outcomes } of combos) {
    it(`AC-2: ledger=${String(ledger)} testimony=${String(testimony)} offers ${outcomes.length === 0 ? 'no outcome' : outcomes.join(', ')}`, () => {
      const s = session({
        playerClass: 'knight',
        facts: { 'vane.ledger.obtained': ledger, 'duggan.testimony': testimony },
      });
      s.start('vane-bounty');
      s.settle();
      const confront = s.runtime.choices().find((c) => c.id === 'confront');
      expect(confront?.locked).toBe(!ledger && !testimony);
      if (outcomes.length === 0) {
        expect(s.runtime.choose(s.ids().indexOf('confront')).ok).toBe(false);
        return;
      }
      s.pick('confront');
      const offered = s.ids().filter((id) => id.startsWith('confront-') && id !== 'confront-back');
      expect(offered).toEqual(outcomes);
    });
  }

  it('AC-2: each outcome sets vane.fate and Vane then only speaks his aftermath', () => {
    const table = {
      'confront-expose': 'exposed',
      'confront-confess': 'confessed',
      'confront-bribe': 'bribed-player',
      'confront-flee': 'fled',
    } as const;
    for (const [option, fate] of Object.entries(table)) {
      const s = session({
        playerClass: 'archer',
        facts: { 'vane.ledger.obtained': true, 'duggan.testimony': true },
      });
      s.start('vane-bounty');
      s.settle();
      s.pick('confront');
      expect(s.pick(option).kind).toBe('ended');
      expect(s.host.facts.get('vane.fate'), option).toBe(fate);
      // a new conversation is the aftermath, not the pitch
      s.start('vane-bounty');
      const first = s.runtime.view;
      expect(first?.kind === 'line' ? first.text : '').not.toMatch(/employ a third/);
      expect(s.settle().kind).toBe('ended');
    }
  });

  it('AC-2: the bribe pays and a confession is not a bribe; the confession names the Pells and the bell', () => {
    const s = session({ playerClass: 'knight', facts: { 'vane.ledger.obtained': true } });
    s.start('vane-bounty');
    s.settle();
    s.pick('confront');
    s.pick('confront-bribe');
    expect(s.host.gold()).toBeGreaterThan(0);
    const c = session({ playerClass: 'knight', facts: { 'vane.ledger.obtained': true } });
    c.start('vane-bounty');
    c.settle();
    c.pick('confront');
    c.pick('confront-confess');
    expect(c.host.gold()).toBe(0);
    expect(c.host.emitted.map((e) => e.event)).toContain('vane.confessed');
  });

  it('AC-5 support: the four classes meet him differently and the thief is turned away by daylight', () => {
    const texts = new Set<string>();
    for (const playerClass of ['knight', 'archer', 'sorcerer', 'thief']) {
      const s = session({ playerClass, minuteOfDay: 23 * 60 });
      s.start('vane-bounty');
      texts.add((s.runtime.view as { text: string }).text);
    }
    expect(texts.size).toBe(4);
    const day = session({ playerClass: 'thief', minuteOfDay: 12 * 60 });
    day.start('vane-bounty');
    expect(day.settle().kind).toBe('ended');
    // with the ledger in hand the thief is not shut out by daylight
    const proof = session({
      playerClass: 'thief',
      minuteOfDay: 12 * 60,
      facts: { 'vane.ledger.obtained': true },
    });
    proof.start('vane-bounty');
    expect(proof.settle().kind).toBe('choice');
  });

  it('the class options only the right class sees, and the other topics, are all reachable', () => {
    const s = session({ playerClass: 'sorcerer' });
    s.start('vane-bounty');
    s.settle();
    expect(s.ids()).toContain('carvings-sorcerer');
    expect(s.ids()).not.toContain('champion-knight');
    for (const id of ['ask-bounty', 'ask-mine', 'ask-missing', 'ask-breach', 'carvings-sorcerer']) {
      s.pick(id);
    }
    s.pick('leave');
    expect(s.runtime.active).toBe(false);
    s.start('vane-bounty');
    expect(s.settle().kind).toBe('choice');
  });
});

describe('Hollis and Tansy Pell', () => {
  it('AC-3: with tansy.saved Hollis plays the reunion, without it the grief branch', () => {
    const saved = session({ playerClass: 'knight', facts: { 'tansy.saved': true } });
    saved.start('hollis-pell');
    expect((saved.runtime.view as { text: string }).text).toMatch(/She's upstairs/);
    expect(saved.settle().kind).toBe('choice');
    expect(saved.ids()).toContain('ask-tansy');
    expect(saved.ids()).not.toContain('ask-night');
    // spoken to again, the reunion is "again", still the reunion branch
    saved.pick('leave-glad');
    saved.start('hollis-pell');
    expect((saved.runtime.view as { text: string }).text).toMatch(/Tansy's at the Stacks/);
    saved.settle();
    expect(saved.ids()).toContain('ask-tansy');

    const lost = session({ playerClass: 'knight', facts: { 'tansy.saved': false } });
    lost.start('hollis-pell');
    expect((lost.runtime.view as { text: string }).text).toMatch(/Thank God/);
    expect(lost.settle().kind).toBe('choice');
    expect(lost.ids()).toContain('ask-night');
    expect(lost.ids()).not.toContain('ask-tansy');
  });

  it('AC-3: the grief branch hands each class their gift once, and the bible once', () => {
    const gifts: Record<string, string> = {
      knight: 'gift-knight',
      archer: 'gift-archer',
      sorcerer: 'gift-sorcerer',
      thief: 'gift-thief',
    };
    for (const [playerClass, gift] of Object.entries(gifts)) {
      const s = session({ playerClass });
      s.start('hollis-pell');
      s.settle();
      for (const other of Object.values(gifts)) {
        expect(s.ids().includes(other), `${playerClass} sees ${other}`).toBe(other === gift);
      }
      s.pick(gift);
      expect(s.ids()).not.toContain(gift);
      s.pick('ask-bible');
      expect(s.host.facts.get('hollis.bible-lent')).toBe(true);
      expect(s.ids()).not.toContain('ask-bible');
    }
    const knight = session({ playerClass: 'knight' });
    knight.start('hollis-pell');
    knight.settle();
    knight.pick('gift-knight');
    expect(knight.host.itemCount('bread-loaf')).toBe(2);
  });

  it('AC-3: the reunion branch mentions Vane only when he confessed, and hands over the loaf once', () => {
    const base = { playerClass: 'archer', facts: { 'tansy.saved': true } };
    const quiet = session(base);
    quiet.start('hollis-pell');
    quiet.settle();
    expect(quiet.ids()).not.toContain('vane-purse');
    const confessed = session({ ...base, facts: { ...base.facts, 'vane.fate': 'confessed' } });
    confessed.start('hollis-pell');
    confessed.settle();
    for (const id of ['vane-purse', 'ask-tansy', 'ask-bible-glad', 'reunion-loaf'])
      confessed.pick(id);
    expect(confessed.host.itemCount('bread-loaf')).toBe(1);
    expect(confessed.ids()).not.toContain('reunion-loaf');
    expect(confessed.host.facts.get('hollis.bible-lent')).toBe(true);
  });

  it('Hollis tells the night and the bible in order, and the other classes hear a different farewell', () => {
    const s = session({ playerClass: 'thief' });
    s.start('hollis-pell');
    s.settle();
    s.pick('ask-night');
    s.pick('gift-thief');
    expect(s.host.facts.get('hollis.spare-key-given')).toBe(true);
    s.pick('leave');
    s.start('hollis-pell');
    expect((s.runtime.view as { text: string }).text).toMatch(/Back\./);
  });

  it('Tansy sleepwalks until she is saved, then asks who you are and answers about Horn', () => {
    const asleep = session({});
    asleep.start('tansy-after');
    expect(asleep.settle().kind).toBe('ended');

    const s = session({ facts: { 'tansy.saved': true } });
    s.start('tansy-after');
    expect((s.runtime.view as { text: string }).text).toMatch(/Who are you\?/);
    s.settle();
    for (const id of ['ask-dark', 'ask-books', 'ask-anselm']) s.pick(id);
    const alive = s.pick('ask-horn');
    expect(alive.kind).toBe('choice');
    s.pick('leave');
    s.start('tansy-after');
    expect((s.runtime.view as { text: string }).text).toMatch(/I'm not supposed to be out/);

    const dead = session({ facts: { 'tansy.saved': true, 'horn.fate': 'dead' } });
    dead.start('tansy-after');
    dead.settle();
    dead.runtime.choose(dead.ids().indexOf('ask-horn'));
    expect((dead.runtime.view as { text: string }).text).toMatch(/They told me/);
  });
});

describe('Oswin Brand', () => {
  it('AC-4: with the tongue destroyed the recast is offered exactly once', () => {
    const s = session({ playerClass: 'archer', facts: { 'bell-tongue.destroyed': true } });
    s.start('oswin-forge');
    s.settle();
    expect(s.ids().filter((id) => id === 'recast-tongue')).toHaveLength(1);
    s.pick('recast-tongue');
    expect(s.host.facts.get('oswin.recast-commissioned')).toBe(true);
    expect(s.host.emitted.map((e) => e.event)).toContain('smith.recast-tongue');
    expect(s.ids()).not.toContain('recast-tongue');
    // and not in a later conversation either
    s.pick('leave');
    s.start('oswin-forge');
    s.settle();
    expect(s.ids()).not.toContain('recast-tongue');
  });

  it('AC-4: with the tongue intact the recast is never offered', () => {
    const s = session({ playerClass: 'archer' });
    s.start('oswin-forge');
    s.settle();
    expect(s.ids()).not.toContain('recast-tongue');
    expect(s.runtime.choices().some((c) => c.id === 'recast-tongue')).toBe(false);
    // the mould is still a story he tells
    s.pick('ask-mould');
    expect(s.ids()).not.toContain('ask-mould');
  });

  it('class options: knight free repair, sorcerer heats the forge, thief picks "for miners"', () => {
    const k = session({ playerClass: 'knight' });
    k.start('oswin-forge');
    k.settle();
    k.pick('repair-knight');
    expect(k.host.emitted.map((e) => e.event)).toContain('smith.repair-armour');
    expect(k.ids()).not.toContain('repair-knight');

    const s = session({ playerClass: 'sorcerer' });
    s.start('oswin-forge');
    s.settle();
    s.pick('ember-sorcerer');
    expect(s.host.emitted.map((e) => e.event)).toContain('smith.forge-heated');

    const t = session({ playerClass: 'thief' });
    t.start('oswin-forge');
    t.settle();
    t.pick('picks-thief');
    const a = session({ playerClass: 'archer' });
    a.start('oswin-forge');
    a.settle();
    a.pick('heads-archer');
    for (const id of ['ask-sharper', 'ask-commission']) a.pick(id);
    a.start('oswin-forge');
    expect((a.runtime.view as { text: string }).text).toMatch(/Back again/);
  });
});

describe('Juniper Fenn', () => {
  it('the wolves, the path and the draughts; forgiving her warms her to the thief and blaming does not', () => {
    const forgive = session({ playerClass: 'thief' });
    forgive.start('juniper-fenn');
    forgive.settle();
    for (const id of ['ask-wolves', 'ask-path', 'ask-draughts']) forgive.pick(id);
    expect(forgive.ids()).toEqual(['draughts-forgive', 'draughts-blame']);
    forgive.pick('draughts-forgive');
    expect(forgive.host.facts.get('juniper.draught-confessed')).toBe(true);
    forgive.pick('poison-thief');
    expect(forgive.ids()).not.toContain('poison-thief');
    expect(forgive.runtime.view?.kind).toBe('choice');

    const blame = session({ playerClass: 'thief' });
    blame.start('juniper-fenn');
    blame.settle();
    blame.pick('ask-draughts');
    blame.pick('draughts-blame');
    blame.pick('poison-thief');
    expect(blame.runtime.active).toBe(true);
    expect(blame.host.facts.get('juniper.draught-confessed')).toBe(true);
  });

  it('thief poisons: refused until she likes you, then offered at the counter', () => {
    const cold = session({ playerClass: 'thief' });
    cold.start('juniper-fenn');
    cold.settle();
    const view = cold.pick('poison-thief');
    expect(view.kind).toBe('choice');
    const warm = session({ playerClass: 'thief', dispositions: { 'npc-juniper': 12 } });
    warm.start('juniper-fenn');
    warm.settle();
    warm.pick('poison-thief');
    expect(warm.runtime.active).toBe(true);
    expect(cold.lines()).toBeDefined();
  });

  it('archer, sorcerer and knight each get their own option', () => {
    for (const [playerClass, option] of [
      ['archer', 'trail-archer'],
      ['sorcerer', 'herbs-sorcerer'],
      ['knight', 'clank-knight'],
    ] as const) {
      const s = session({ playerClass });
      s.start('juniper-fenn');
      s.settle();
      expect(s.ids()).toContain(option);
      s.pick(option);
      s.say('leave');
      expect(s.runtime.active).toBe(true);
      s.runtime.advance();
      expect(s.runtime.active).toBe(false);
      s.start('juniper-fenn');
      expect((s.runtime.view as { text: string }).text).toMatch(/Back\./);
    }
  });
});

describe('Duggan Marl', () => {
  const win: CheckResolver = () => true;
  const lose: CheckResolver = () => false;

  it('a lost persuasion check continues the conversation and can be retried; a win sets duggan.testimony', () => {
    const s = session({}, lose);
    s.start('duggan-testimony');
    s.settle();
    s.pick('ask-testify');
    expect(s.ids()).toContain('ask-testify');
    expect(s.host.facts.get('duggan.testimony')).toBeUndefined();

    const w = session({}, win);
    w.start('duggan-testimony');
    w.settle();
    for (const id of ['ask-trinkets', 'ask-vane', 'ask-guilt', 'ask-goblins', 'ask-testify'])
      w.pick(id);
    expect(w.host.facts.get('duggan.testimony')).toBe(true);
    expect(w.host.emitted.map((e) => e.event)).toContain('duggan.testify');
    w.pick('leave');
    // later he is a witness already
    w.start('duggan-testimony');
    expect((w.runtime.view as { text: string }).text).toMatch(/I've said it/);
    w.settle();
    w.pick('ask-vane-again');
    w.pick('leave-again');
  });

  it('a second visit reads differently, and the odds show the ledger and trust as modifiers', () => {
    const s = session({ facts: { 'vane.ledger.obtained': true } }, lose);
    s.start('duggan-testimony');
    s.settle();
    s.pick('leave');
    s.start('duggan-testimony');
    expect((s.runtime.view as { text: string }).text).toMatch(/You came back/);
    const labels = JSON.stringify(content.get('dialogue', 'duggan-testimony'));
    expect(labels).toContain("You hold Vane's ledger");
    expect(labels).toContain('He trusts you');
  });
});

describe('the confrontation facts', () => {
  it('registers every fact the six dialogues read or write', () => {
    const keys = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    for (const key of [
      'vane.ledger.obtained',
      'duggan.testimony',
      'bell-tongue.destroyed',
      'oswin.recast-commissioned',
      'tansy.saved',
      'vane.fate',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
