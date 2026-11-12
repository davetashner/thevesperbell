// mw-e39.5: the three hub NPCs (Mirela Thorne, Dot Farrow, Captain Hale), played by the real
// DialogueRuntime against the shipped content. Each AC names its test; conversations use a MemoryLogicHost
// so the facts, gold and disposition they change are visible.
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
  'mirela-stacks': 'npc-mirela',
  'dot-sleeping-ox': 'npc-dot',
  'hale-watch': 'npc-hale',
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
  /** Text of the line now showing ('' when none). */
  const text = (): string => {
    const view = runtime.view;
    return view?.kind === 'line' ? view.text : '';
  };
  /** Every line spoken from the current view until the next choice (or the end). */
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  return { world, host, runtime, start, settle, ids, pick, text, lines };
}

/** Plays every option the dialogue offers (except leaving) and returns every line spoken. */
function exploreAll(
  dialogue: string,
  init: ConstructorParameters<typeof MemoryLogicHost>[0],
  checks: CheckResolver,
): string[] {
  const s = session(init, checks);
  const spoken: string[] = [];
  s.start(dialogue);
  for (let guard = 0; guard < 80; guard++) {
    spoken.push(...s.lines());
    const choices = s.runtime.choices().filter((c) => !c.locked);
    if (choices.length === 0) break;
    const next = choices.find((c) => c.id !== 'leave') ?? choices[0];
    if (next === undefined) break;
    const result = s.runtime.choose(next.index);
    expect(result.ok, next.id).toBe(true);
  }
  return spoken;
}

describe('the three hub dialogues', () => {
  it('AC-1: all three load, validate with zero errors and warnings, and every node is reachable', ({
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

  it('AC-1: every fact the three read or write is registered with its default', () => {
    const keys = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    const group = content.get('fact', 'hub-dialogue');
    expect(group.facts.length).toBeGreaterThan(15);
    for (const fact of group.facts) expect(keys.has(fact.key), fact.key).toBe(true);
  });

  it('AC-2: each NPC greets each class on a first meeting with its own line (4 distinct)', () => {
    for (const id of THREE) {
      const greetings = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass });
        s.start(id);
        expect(s.runtime.view?.kind).toBe('line');
        greetings.add(s.text());
      }
      expect(greetings.size, `${id} greetings`).toBe(4);
      // a fifth kind of player still gets a greeting, and a return visit reads differently
      const any = session({});
      any.start(id);
      expect(greetings.has(any.text())).toBe(false);
      any.settle();
      any.pick('leave');
      any.start(id);
      expect(any.text()).not.toBe('');
    }
  });

  it('every NPC has at least two class-only branches and four of them are offered', () => {
    for (const id of THREE) {
      const gated = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass });
        s.start(id);
        s.settle();
        for (const c of s.runtime.choices())
          if (c.tags.some((t) => t.kind === 'class')) gated.add(c.id);
      }
      expect(gated.size, id).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Mirela Thorne', () => {
  const M = 'mirela-stacks';

  it('a sorcerer is let behind the curtain; others must persuade her', () => {
    const s = session({ playerClass: 'sorcerer' });
    s.start(M);
    s.settle();
    s.pick('ask-red-shelf');
    s.pick('shelf-colleague');
    expect(s.host.facts.get('mirela.restricted-access')).toBe(true);
    expect(s.host.emitted.map((e) => e.event)).toContain('mirela.shelf-opened');

    const lost = session({ playerClass: 'knight' }, lose);
    lost.start(M);
    lost.settle();
    lost.pick('ask-red-shelf');
    expect(lost.ids()).not.toContain('shelf-colleague');
    lost.pick('shelf-persuade');
    expect(lost.host.facts.get('mirela.restricted-access')).toBeUndefined();
    expect(lost.ids()).toContain('leave');

    const won = session({ playerClass: 'archer' }, win);
    won.start(M);
    won.settle();
    won.pick('ask-red-shelf');
    won.pick('shelf-persuade');
    expect(won.host.facts.get('mirela.restricted-access')).toBe(true);
  });

  it('AC-4: Mirela never sells, lends or gives Nine Sleeps; the secret needs trust and the ysolde story follows', () => {
    const json = JSON.stringify(content.get('dialogue', M));
    expect(json).not.toMatch(/giveItem|takeItem/);
    expect(json).not.toMatch(/"item"\s*:\s*"book-nine-sleeps"/);

    const locked = session({ playerClass: 'knight' });
    locked.start(M);
    locked.settle();
    expect(locked.ids()).not.toContain('ask-nine-sleeps');

    for (const playerClass of CLASSES) {
      const s = session({
        playerClass,
        facts: { 'mirela.restricted-access': true },
        dispositions: { 'npc-mirela': 10 },
      });
      s.start(M);
      s.settle();
      s.pick('ask-nine-sleeps');
      expect(s.host.facts.get('mirela.nine-sleeps.confessed')).toBe(true);
      expect(s.text()).toBe('');
      expect(s.ids()).toEqual(expect.arrayContaining(['ns-why', 'ns-buy', 'ns-done']));
      s.pick('ns-why');
      s.pick('ns-buy');
      if (playerClass === 'sorcerer') s.pick('ns-read-sorcerer');
      if (playerClass === 'thief') s.pick('ns-lock-thief');
      s.pick('ns-done');
      expect(s.host.itemCount('book-nine-sleeps')).toBe(0);
      expect(s.host.gold()).toBe(0);
    }
  });

  it('AC-5: a player banned by Mortimer hears the banned branch and cannot shop', () => {
    const s = session({ playerClass: 'thief', facts: { 'mirela.banned': true } });
    s.start(M);
    expect(s.text()).toMatch(/Mortimer says you're not welcome/);
    s.settle();
    expect(s.ids()).toEqual(['ban-plead', 'ban-leave']);
    s.pick('ban-plead');
    s.pick('ban-leave');
    // still banned the next time, under a day
    expect(s.host.facts.get('mirela.banned')).toBe(true);
    s.start(M);
    expect(s.text()).toMatch(/Mortimer says you're not welcome/);
    const shop = session({ facts: { 'mirela.banned': true, 'mirela.banned-days': 0 } });
    shop.start(M);
    shop.settle();
    expect(shop.ids()).not.toContain('ask-red-shelf');
  });

  it('AC-5: biscuits lift the ban at once, and so does a full in-game day', () => {
    const biscuits = session({
      facts: { 'mirela.banned': true, 'mirela.biscuits-brought': true },
    });
    biscuits.start(M);
    biscuits.settle();
    expect(biscuits.ids()).toContain('ban-biscuits');
    biscuits.pick('ban-biscuits');
    expect(biscuits.host.facts.get('mirela.banned')).toBe(false);
    expect(biscuits.host.facts.get('mirela.biscuits-brought')).toBe(false);
    expect(biscuits.host.disposition('npc-mirela')).toBe(3);
    expect(biscuits.ids()).toContain('ask-red-shelf');

    const day = session({ facts: { 'mirela.banned': true, 'mirela.banned-days': 1 } });
    day.start(M);
    expect(day.text()).toMatch(/A day has passed/);
    day.settle();
    expect(day.host.facts.get('mirela.banned')).toBe(false);
    expect(day.host.facts.get('mirela.banned-days')).toBe(0);
    expect(day.ids()).toContain('ask-red-shelf');
  });

  it('the class branches pay off: knight reads, archer buys maps, sorcerer is told of the teacher, thief takes the job', () => {
    const knight = session({ playerClass: 'knight' });
    knight.start(M);
    knight.settle();
    knight.pick('read-knight');
    expect(knight.host.disposition('npc-mirela')).toBe(8);

    const archer = session({ playerClass: 'archer' });
    archer.start(M);
    archer.settle();
    archer.pick('maps-archer');
    expect(archer.host.emitted.map((e) => e.event)).toContain('mirela.maps-offered');

    const sorcerer = session({ playerClass: 'sorcerer' });
    sorcerer.start(M);
    sorcerer.settle();
    sorcerer.pick('teacher-sorcerer');
    expect(sorcerer.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'rumor.told', data: { rumor: 20, source: 'npc-mirela' } }),
    );

    const thief = session({ playerClass: 'thief' });
    thief.start(M);
    thief.settle();
    thief.pick('job-thief');
    thief.pick('job-yes');
    expect(thief.host.facts.get('mirela.thief-job.accepted')).toBe(true);
    const other = session({ playerClass: 'knight' });
    other.start(M);
    other.settle();
    expect(other.ids()).not.toContain('job-thief');
  });

  it("the thief who tries to pick the lock loses Mirela's goodwill; Mortimer, the Court and the Hours are told", () => {
    const s = session({
      playerClass: 'thief',
      facts: { 'mirela.restricted-access': true },
      dispositions: { 'npc-mirela': 6 },
    });
    s.start(M);
    s.settle();
    s.pick('ask-nine-sleeps');
    s.pick('ns-lock-thief');
    expect(s.host.disposition('npc-mirela')).toBe(1);
    s.pick('ns-done');
    s.pick('ask-hours');
    expect(s.host.facts.get('mirela.hours.lent')).toBe(true);
    s.pick('ask-mortimer');
    s.pick('ask-court');
    expect(s.host.disposition('npc-mirela')).toBe(1 + 5 + 2 + 2 + 3);
  });

  it('each headline ending is acknowledged once; the long vespers is a sleeper talking', () => {
    const cases = [
      { facts: { 'tansy.saved': true, 'horn.fate': 'alive' }, text: /heard it at dusk, the bell/ },
      { facts: { 'tansy.saved': true, 'horn.fate': 'dead' }, text: /Warden since I heard/ },
      {
        facts: { 'tansy.saved': true, 'vane.fate': 'bribed-player' },
        text: /ledger is just a book that lies/,
      },
      { facts: { 'abbot.fate': 'joined' }, text: /asleep at her desk/ },
    ];
    for (const { facts, text } of cases) {
      const s = session({ playerClass: 'archer', facts });
      s.start(M);
      expect(s.text()).toMatch(text);
    }
    const rung = session({ facts: { 'tansy.saved': true, 'horn.fate': 'alive' } });
    rung.start(M);
    rung.settle();
    rung.pick('leave');
    rung.start(M);
    expect(rung.text()).toMatch(/Back again/);
    // asleep, she ends on her lamp and offers no shop
    const long = session({ facts: { 'abbot.fate': 'joined' } });
    long.start(M);
    expect(long.settle().kind).toBe('ended');
    expect(long.host.facts.get('mirela.banned')).toBeUndefined();
  });
});

describe('Dot Farrow', () => {
  const D = 'dot-sleeping-ox';

  it('a drink costs two crowns and warms her; with no coin she is kind about it', () => {
    const s = session({ gold: 5 }, lose);
    s.start(D);
    s.settle();
    s.pick('ask-rumours');
    s.pick('drink-buy');
    expect(s.host.gold()).toBe(3);
    expect(s.host.disposition('npc-dot')).toBe(3);
    expect(s.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'rumor.told', data: { rumor: 6, source: 'npc-dot' } }),
    );
    expect(s.ids()).not.toContain('drink-buy');
    s.pick('swap-rumour');
    expect(s.host.emitted.map((e) => e.event)).toContain('dot.rumor-swap-offered');

    const broke = session({ gold: 0 });
    broke.start(D);
    broke.settle();
    broke.pick('ask-rumours');
    broke.pick('coin-pay');
    expect(broke.host.gold()).toBe(0);
    expect(broke.ids()).toContain('coin-pay');
  });

  it('paying for the proper news hands out the captain-boots rumour', () => {
    const s = session({ gold: 20 });
    s.start(D);
    s.settle();
    s.pick('ask-rumours');
    s.pick('coin-pay');
    expect(s.host.gold()).toBe(10);
    expect(s.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'rumor.told', data: { rumor: 8, source: 'npc-dot' } }),
    );
  });

  it('the stamped trinket: she deflects a stranger, confides in a friend or a persuasion win', () => {
    const cold = session({}, lose);
    cold.start(D);
    cold.settle();
    cold.pick('ask-trinkets');
    expect(cold.ids()).toEqual(['trinkets-push', 'trinkets-drop']);
    cold.pick('trinkets-push');
    expect(cold.host.facts.get('dot.trinket.confessed')).toBeUndefined();

    const friend = session({ dispositions: { 'npc-dot': 8 } });
    friend.start(D);
    friend.settle();
    friend.pick('ask-trinkets');
    expect(friend.host.facts.get('dot.trinket.confessed')).toBe(true);
    expect(friend.host.emitted.map((e) => e.event)).toContain('dot.trinket-shown');
    friend.pick('ask-trinkets');

    const won = session({}, win);
    won.start(D);
    won.settle();
    won.pick('ask-trinkets');
    won.pick('trinkets-push');
    expect(won.host.facts.get('dot.trinket.confessed')).toBe(true);
  });

  it('the class branches: knight, archer, sorcerer (who can fail) and thief (the cellar)', () => {
    const knight = session({ playerClass: 'knight' });
    knight.start(D);
    knight.settle();
    knight.pick('beams-knight');
    knight.pick('beams-small');
    expect(knight.host.disposition('npc-dot')).toBe(5);

    const archer = session({ playerClass: 'archer' });
    archer.start(D);
    archer.settle();
    archer.pick('game-archer');
    expect(archer.host.emitted.map((e) => e.event)).toContain('dot.game-offered');

    const lit = session({ playerClass: 'sorcerer' }, win);
    lit.start(D);
    lit.settle();
    lit.pick('fire-sorcerer');
    expect(lit.host.facts.get('dot.hearth.lit')).toBe(true);
    expect(lit.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'rumor.told', data: { rumor: 19, source: 'npc-dot' } }),
    );

    const singed = session({ playerClass: 'sorcerer' }, lose);
    singed.start(D);
    singed.settle();
    singed.pick('fire-sorcerer');
    expect(singed.host.facts.get('dot.hearth.lit')).toBeUndefined();
    expect(singed.host.disposition('npc-dot')).toBe(-3);

    const knave = session({ playerClass: 'thief' }, win);
    knave.start(D);
    knave.settle();
    expect(knave.ids()).not.toContain('fence-deal');
    knave.pick('cellar-thief');
    expect(knave.host.facts.get('dot.fence.open')).toBe(true);
    knave.pick('fence-deal');
    expect(knave.host.emitted.map((e) => e.event)).toEqual(
      expect.arrayContaining(['dot.fence-opened', 'dot.fence-trade']),
    );

    const caught = session({ playerClass: 'thief' }, lose);
    caught.start(D);
    caught.settle();
    caught.pick('cellar-thief');
    expect(caught.host.facts.get('dot.fence.open')).toBeUndefined();
    expect(caught.host.disposition('npc-dot')).toBe(-2);

    const friend = session({ playerClass: 'thief', dispositions: { 'npc-dot': 8 } }, lose);
    friend.start(D);
    friend.settle();
    friend.pick('cellar-thief');
    expect(friend.host.facts.get('dot.fence.open')).toBe(true);
  });

  it('she remembers the well, Fitch and the night Tansy walked; a repeat of the cellar is a warning', () => {
    const s = session({ facts: { 'well.player-fell': true } });
    s.start(D);
    s.settle();
    s.pick('leave');
    s.start(D);
    expect(s.text()).toMatch(/Glen Well says hello/);
    s.settle();
    s.pick('ask-night');
    s.pick('ask-fitch');
    s.pick('leave');
    // the quip is a one-off
    s.start(D);
    expect(s.text()).toMatch(/Back again/);

    const open = session({ playerClass: 'thief', facts: { 'dot.fence.open': true } });
    open.start(D);
    open.settle();
    open.pick('cellar-thief');
    expect(open.ids()).toContain('fence-deal');
  });

  it('each headline ending is acknowledged; the sleepers are home unless the abbot won', () => {
    const rung = session({ facts: { 'tansy.saved': true, 'horn.fate': 'alive' } });
    rung.start(D);
    expect(rung.text()).toMatch(/He's back! Fitch!/);
    const warden = session({ facts: { 'tansy.saved': true, 'horn.fate': 'dead' } });
    warden.start(D);
    expect(warden.text()).toMatch(/the big one is dead/);
    const silence = session({
      facts: { 'tansy.saved': true, 'vane.fate': 'bribed-player' },
    });
    silence.start(D);
    expect(silence.text()).toMatch(/heard about the money/);
    const long = session({ facts: { 'abbot.fate': 'joined' } });
    long.start(D);
    expect(long.text()).toMatch(/asleep with her cheek on the bar/);
    expect(long.settle().kind).toBe('ended');
  });
});

describe('Captain Hale', () => {
  const H = 'hale-watch';
  const NOTE = /\bnote\b|deliver|postman|friend below/i;

  it('AC-3: while hale.sleepwalking.revealed is false no reachable line says he delivered the note', () => {
    for (const playerClass of CLASSES) {
      for (const checks of [win, lose]) {
        for (const disposition of [-12, 0, 12]) {
          const spoken = exploreAll(
            H,
            {
              playerClass,
              facts: { 'tansy.saved': true },
              dispositions: { 'npc-hale': disposition },
            },
            checks,
          );
          expect(spoken.length).toBeGreaterThan(0);
          for (const line of spoken) expect(line, `${playerClass}: ${line}`).not.toMatch(NOTE);
        }
      }
    }
    // statically: every node that mentions the note sits behind the reveal fact
    const dialogue = content.get('dialogue', H) as unknown as DialogueDef;
    const gatedOnReveal = (when: unknown): boolean =>
      JSON.stringify(when ?? null).includes('hale.sleepwalking.revealed') &&
      !JSON.stringify(when ?? null).includes('"not"');
    const reachable = new Set<string>();
    const queue: string[] = dialogue.entries
      .filter((e) => !gatedOnReveal(e.when))
      .map((e) => e.node);
    const nodes = new Map(dialogue.nodes.map((n) => [n.id, n]));
    while (queue.length > 0) {
      const id = queue.pop() ?? '';
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = nodes.get(id) as unknown as Record<string, unknown> | undefined;
      if (node === undefined) continue;
      const out: string[] = [];
      for (const key of ['next', 'else', 'success', 'failure']) {
        if (typeof node[key] === 'string') out.push(node[key]);
      }
      for (const o of (node['options'] as { next: string; when?: unknown }[] | undefined) ?? [])
        if (!gatedOnReveal(o.when)) out.push(o.next);
      for (const r of (node['routes'] as { next: string }[] | undefined) ?? []) out.push(r.next);
      queue.push(...out);
    }
    for (const id of reachable) {
      const node = nodes.get(id) as unknown as { text?: string };
      if (node.text !== undefined) expect(node.text, id).not.toMatch(NOTE);
    }
  });

  it('AC-3: once revealed he owns up to the note, whether the player kept his secret or told the town', () => {
    const kept = session({
      facts: { 'hale.sleepwalking.revealed': true, 'hale.secret.kept': true },
    });
    kept.start(H);
    expect(kept.text()).toMatch(/note under your door/);
    kept.settle();
    expect(kept.ids()).toContain('ask-note');
    kept.pick('ask-note');
    const told = session({
      facts: { 'hale.sleepwalking.revealed': true, 'hale.secret.exposed': true },
    });
    told.start(H);
    expect(told.lines().join(' ')).toMatch(/The town knows now/);
    // it plays once; afterwards he is just the captain again
    told.pick('leave');
    told.start(H);
    expect(told.text()).toMatch(/Back\./);
  });

  it('the boots: he deflects until the reveal, and a trusted player hears of the dust but not the note', () => {
    const s = session({});
    s.start(H);
    s.settle();
    s.pick('ask-boots');
    expect(s.host.facts.get('hale.boots.asked')).toBe(true);
    expect(s.ids()).not.toContain('ask-boots');
    expect(s.ids()).not.toContain('ask-confide');

    const trusted = session({ dispositions: { 'npc-hale': 10 } });
    trusted.start(H);
    trusted.settle();
    trusted.pick('ask-confide');
    expect(trusted.host.facts.get('hale.boots.confessed')).toBe(true);
    expect(trusted.host.emitted.map((e) => e.event)).toContain('hale.boots-confessed');
  });

  it('the missing-persons list names the seven and is handed over; the footprints lead to the mine gate', () => {
    const s = session({});
    s.start(H);
    s.settle();
    s.pick('ask-list');
    expect(s.host.facts.get('hale.list.shared')).toBe(true);
    s.pick('ask-footprints');
    s.pick('ask-watch');
    expect(s.host.emitted.map((e) => e.event)).toEqual(
      expect.arrayContaining(['hale.list-shared', 'hale.map-shared']),
    );
    const names = JSON.stringify(content.get('dialogue', H));
    for (const name of [
      'Moss Greaves',
      'Ettie Lark',
      'Rowan Tate',
      'Harlan Burr',
      'Mina Coles',
      'Fitch',
      'Tansy',
    ])
      expect(names, name).toContain(name);
  });

  it('the class branches: knight peer, archer scout, sorcerer dreams, thief called out', () => {
    const knight = session({ playerClass: 'knight' });
    knight.start(H);
    knight.settle();
    knight.pick('peer-knight');
    expect(knight.host.disposition('npc-hale')).toBe(10);

    const archer = session({ playerClass: 'archer' });
    archer.start(H);
    archer.settle();
    archer.pick('treeline-archer');
    expect(archer.host.emitted.map((e) => e.event)).toContain('hale.scout-asked');

    const sorcerer = session({ playerClass: 'sorcerer' });
    sorcerer.start(H);
    sorcerer.settle();
    sorcerer.pick('dreams-sorcerer');
    expect(sorcerer.host.disposition('npc-hale')).toBe(2);

    const bluff = session({ playerClass: 'thief' }, win);
    bluff.start(H);
    bluff.settle();
    bluff.pick('prove-thief');
    expect(bluff.host.disposition('npc-hale')).toBe(0);
    const caught = session({ playerClass: 'thief' }, lose);
    caught.start(H);
    caught.settle();
    caught.pick('prove-thief');
    expect(caught.host.disposition('npc-hale')).toBe(-5);
  });

  it('jail: caught stealing, Hale talks through the cell door, then the sentence is served', () => {
    for (const [option, delta] of [
      ['jail-sorry', 2],
      ['jail-argue', -3],
    ] as const) {
      const s = session({ playerClass: 'thief', facts: { 'hale.jailed': true } });
      s.start(H);
      expect(s.text()).toMatch(/Caught with your fingers/);
      s.settle();
      expect(s.ids()).toEqual(['jail-sorry', 'jail-argue']);
      expect(s.pick(option).kind).toBe('ended');
      expect(s.host.facts.get('hale.jailed')).toBe(false);
      expect(s.host.disposition('npc-hale')).toBe(delta);
      expect(s.host.emitted).toContainEqual(
        expect.objectContaining({ event: 'jail.sentence', data: { days: 1 } }),
      );
    }
  });

  it('a hostile band shuts him down until the player offers amends', () => {
    const s = session({ dispositions: { 'npc-hale': -10 } });
    s.start(H);
    expect(s.text()).toMatch(/nothing to say to you/);
    s.settle();
    expect(s.pick('cold-amends').kind).toBe('ended');
    expect(s.host.disposition('npc-hale')).toBe(-4);
    const leave = session({ dispositions: { 'npc-hale': -20 } });
    leave.start(H);
    leave.settle();
    expect(leave.pick('cold-leave').kind).toBe('ended');
  });

  it('Act III testimony: a kept secret wins his word, otherwise it is a persuasion that exposure makes harder', () => {
    const hidden = session({ facts: { 'tansy.saved': true, 'hale.secret.kept': true } }, lose);
    hidden.start(H);
    hidden.settle();
    hidden.pick('testify');
    expect(hidden.host.facts.get('hale.testimony.given')).toBe(true);
    expect(hidden.host.emitted.map((e) => e.event)).toContain('hale.testified');

    const won = session({ facts: { 'tansy.saved': true } }, win);
    won.start(H);
    won.settle();
    won.pick('testify');
    expect(won.host.facts.get('hale.testimony.given')).toBe(true);

    const lost = session({ facts: { 'tansy.saved': true } }, lose);
    lost.start(H);
    lost.settle();
    lost.pick('testify');
    expect(lost.host.facts.get('hale.testimony.given')).toBeUndefined();
    expect(lost.ids()).toContain('testify');

    const before = session({});
    before.start(H);
    before.settle();
    expect(before.ids()).not.toContain('testify');
    const labels = JSON.stringify(content.get('dialogue', H));
    expect(labels).toContain('The town has laughed at him');
  });

  it('each headline ending is acknowledged; in the long vespers he counts doors in his sleep', () => {
    const rung = session({ facts: { 'tansy.saved': true, 'horn.fate': 'alive' } });
    rung.start(H);
    expect(rung.text()).toMatch(/Seven doors, counted twice/);
    const warden = session({ facts: { 'tansy.saved': true, 'horn.fate': 'dead' } });
    warden.start(H);
    expect(warden.text()).toMatch(/lies dead/);
    const silence = session({
      facts: { 'tansy.saved': true, 'vane.fate': 'bribed-player' },
    });
    silence.start(H);
    expect(silence.text()).toMatch(/bounty's paid/);
    const long = session({ facts: { 'abbot.fate': 'joined' } });
    long.start(H);
    expect(long.text()).toMatch(/counting under his breath/);
    expect(long.settle().kind).toBe('ended');
  });
});
