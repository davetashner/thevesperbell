// mw-e39.20: Inspector Cray, Tereza Maelo, Jasper Quell and Captain Hesketh, played by the real
// DialogueRuntime against the shipped content. Each AC names its test. Evidence items do not exist yet,
// so the tests set the stand-in facts (evidence.*) the dialogues read.
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
  'cray-customs': 'npc-cray',
  'tereza-arms-stall': 'npc-tereza',
  'quell-harbor-agent': 'npc-quell',
  'hesketh-gilded-tern': 'npc-hesketh',
};
const FOUR = Object.keys(NPC_OF);
const CRAY = 'cray-customs';
const TEREZA = 'tereza-arms-stall';
const QUELL = 'quell-harbor-agent';
const HESKETH = 'hesketh-gilded-tern';
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
  const text = (): string => {
    const view = runtime.view;
    return view?.kind === 'line' ? view.text : '';
  };
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  const events = (): string[] => host.emitted.map((e) => e.event);
  return { world, host, runtime, start, settle, ids, pick, text, lines, events };
}

/** Starts a dialogue and plays its opening lines up to the first choice (or the end). */
function open(
  dialogue: string,
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  checks?: CheckResolver,
) {
  const s = session(init, checks);
  s.start(dialogue);
  s.settle();
  return s;
}

type Json = Record<string, unknown>;
function walk(value: unknown, visit: (node: Json) => void): void {
  if (Array.isArray(value)) for (const v of value) walk(v, visit);
  else if (value !== null && typeof value === 'object') {
    visit(value as Json);
    for (const v of Object.values(value)) walk(v, visit);
  }
}
const dialogueJson = (id: string): DialogueDef =>
  content.get('dialogue', id) as unknown as DialogueDef;

describe('the four harbour trade dialogues', () => {
  it('AC-1: all four load, validate with zero errors and warnings, and every node is reachable', ({
    task,
  }) => {
    for (const id of FOUR) markExercised(task, 'dialogue', id);
    for (const id of FOUR) {
      expect(content.has('dialogue', id), id).toBe(true);
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

  it('AC-1: every fact the four read or write is registered, and the group holds them', () => {
    const keys = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    const group = content.get('fact', 'harbor-trade-dialogue');
    expect(group.facts.length).toBeGreaterThan(25);
    for (const fact of group.facts) expect(keys.has(fact.key), fact.key).toBe(true);
    const used = new Set<string>();
    for (const id of FOUR)
      walk(dialogueJson(id), (n) => {
        if (typeof n['fact'] === 'string') used.add(n['fact']);
      });
    for (const key of used) expect(keys.has(key), key).toBe(true);
  });

  it('each NPC greets each class on a first meeting with its own line (4 distinct, plus a fallback)', () => {
    for (const id of FOUR.filter((d) => d !== QUELL || true)) {
      const greetings = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass });
        s.start(id);
        expect(s.runtime.view?.kind).toBe('line');
        greetings.add(s.text());
      }
      expect(greetings.size, `${id} greetings`).toBe(4);
      const any = session({});
      any.start(id);
      expect(greetings.has(any.text())).toBe(false);
    }
  });

  it('every NPC offers at least four class-only options across the classes', () => {
    for (const id of FOUR) {
      const gated = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = open(id, { playerClass });
        for (const c of s.runtime.choices())
          if (c.tags.some((t) => t.kind === 'class')) gated.add(c.id);
      }
      expect(gated.size, id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Inspector Prudence Cray', () => {
  it('AC-2: every bribe option fails, sets cray.bribe.attempted and lowers disposition', () => {
    const bribes = ['bribe-purse', 'bribe-fund'];
    for (const playerClass of CLASSES)
      for (const option of bribes) {
        const s = open(CRAY, { playerClass });
        // a sorcerer's search comes first; step past it where it is offered
        if (s.ids().includes('refuse-sorcerer')) s.pick('refuse-sorcerer');
        const before = s.host.disposition('npc-cray');
        s.pick(option);
        expect(s.host.facts.get('cray.bribe.attempted'), option).toBe(true);
        expect(s.host.disposition('npc-cray'), option).toBeLessThan(before);
        expect(s.events()).toContain('cray.bribe-recorded');
        // she never lets it work: no seizure, no release, no item, and she stays at the hub
        expect(s.host.facts.get('cray.seizure.agreed')).toBeUndefined();
        expect(s.host.facts.get('cray.books-released')).toBeUndefined();
        expect(s.ids()).toContain('leave');
      }
  });

  it('AC-2: no branch reachable from a bribe option rewards it', () => {
    const def = dialogueJson(CRAY);
    const success = [
      'cray.seizure.agreed',
      'cray.books-released',
      'cray.writ.offered',
      'cray.romance-accepted',
    ];
    const byId = new Map(def.nodes.map((n) => [n.id, n]));
    for (const node of def.nodes) {
      if (node.kind !== 'choice') continue;
      for (const option of node.options.filter((o) => o.id.startsWith('bribe'))) {
        expect(JSON.stringify(option.effects ?? []), option.id).not.toMatch(
          /giveItem|takeItem|"gold"/,
        );
        // follow next pointers until the hub, collecting what the route does
        const route: string[] = [];
        let cursor = option.next === undefined ? undefined : byId.get(option.next);
        for (let hops = 0; cursor !== undefined && cursor.id !== 'hub' && hops < 10; hops++) {
          route.push(JSON.stringify(cursor));
          const next: string | undefined = 'next' in cursor ? cursor.next : undefined;
          cursor = next === undefined ? undefined : byId.get(next);
        }
        const text = route.join(' ');
        expect(text, option.id).toContain('"cray.bribe.attempted"');
        expect(text, option.id).toMatch(/"delta":-\d+/);
        expect(text, option.id).not.toMatch(/giveItem|takeItem|"gold"/);
        for (const key of success) expect(text, option.id).not.toContain(key);
      }
    }
    // the only way a bribe could "succeed" is a fact the bribe route never sets
    expect(JSON.stringify(def)).not.toMatch(/bribe[a-z-]*success|bribe-accepted/);
  });

  it('a sorcerer is searched on sight: the search confiscates restricted spellbooks only', () => {
    const s = open(CRAY, { playerClass: 'sorcerer' });
    expect(s.ids()).toEqual(['submit-sorcerer', 'refuse-sorcerer']);
    s.pick('submit-sorcerer');
    expect(s.host.facts.get('cray.searched')).toBe(true);
    const hook = s.host.emitted.find((e) => e.event === 'cray.confiscate');
    expect(hook?.data).toMatchObject({ scope: 'restricted-spellbooks' });

    const refused = open(CRAY, { playerClass: 'sorcerer' });
    refused.pick('refuse-sorcerer');
    expect(refused.events()).not.toContain('cray.confiscate');
  });

  it('the writ-by-post is explained to a sorcerer (six to eight months) and not to others', () => {
    const s = open(CRAY, { playerClass: 'sorcerer' });
    s.pick('refuse-sorcerer');
    s.pick('ask-writ');
    expect(s.host.facts.get('cray.writ.offered')).toBe(true);
    expect(open(CRAY, { playerClass: 'knight' }).ids()).not.toContain('ask-writ');
  });

  it('a romance novel in the pack raises disposition once', () => {
    const none = open(CRAY, { playerClass: 'knight' });
    expect(none.ids()).not.toContain('offer-romance');
    const s = open(CRAY, {
      playerClass: 'knight',
      items: { 'romance-hearts-against-the-tide': 1 },
    });
    s.pick('offer-romance');
    expect(s.host.disposition('npc-cray')).toBe(10);
    expect(s.host.facts.get('cray.romance-accepted')).toBe(true);
    expect(s.host.itemCount('romance-hearts-against-the-tide')).toBe(0);
    expect(s.events()).toContain('cray.romance-received');
    expect(s.ids()).not.toContain('offer-romance');
  });

  it('evidence about bay nine (any of the three) opens the legal seizure route; the off-the-record release follows', () => {
    for (const evidence of [
      'evidence.foundry-invoice',
      'evidence.honest-manifest',
      'evidence.dead-clerk-seal',
    ]) {
      const s = open(CRAY, { playerClass: 'archer', facts: { [evidence]: true } });
      s.pick('give-evidence');
      expect(s.host.facts.get('cray.seizure.agreed'), evidence).toBe(true);
      expect(s.host.facts.get('cray.evidence-given')).toBe(true);
      expect(s.events()).toContain('cray.seizure-opened');
      expect(s.ids()).not.toContain('give-evidence');
      s.pick('ask-release');
      expect(s.host.facts.get('cray.books-released')).toBe(true);
      expect(s.events()).toContain('cray.books-released');
    }
    expect(open(CRAY, {}).ids()).not.toContain('give-evidence');
    expect(open(CRAY, {}).ids()).not.toContain('ask-release');
  });

  it('she shares the dead-clerk seal only to a trusted player, and a cold Cray still takes evidence', () => {
    expect(open(CRAY, {}).ids()).not.toContain('ask-seal');
    const trusted = open(CRAY, { dispositions: { 'npc-cray': 10 } });
    trusted.pick('ask-seal');
    expect(trusted.host.facts.get('cray.bay-nine.suspicion')).toBe(true);

    const cold = open(CRAY, {
      dispositions: { 'npc-cray': -10 },
      facts: { 'evidence.dead-clerk-seal': true },
    });
    expect(cold.ids()).toEqual(['cold-evidence', 'cold-leave']);
    cold.pick('cold-evidence');
    expect(cold.host.facts.get('cray.seizure.agreed')).toBe(true);
    const coldNoEvidence = open(CRAY, { dispositions: { 'npc-cray': -10 } });
    expect(coldNoEvidence.ids()).toEqual(['cold-leave']);
    coldNoEvidence.pick('cold-leave');
  });

  it('the class branches: knight witness, archer ledger, thief unnoticed, plain declarations', () => {
    const knight = open(CRAY, { playerClass: 'knight' });
    knight.pick('witness-knight');
    expect(knight.host.disposition('npc-cray')).toBe(3);
    const archer = open(CRAY, { playerClass: 'archer' });
    archer.pick('ledger-archer');
    expect(archer.host.facts.get('cray.ledger.counting')).toBe(true);
    const thief = open(CRAY, { playerClass: 'thief' });
    thief.pick('nothing-thief');
    expect(thief.text()).toBe('');
    const s = open(CRAY, {});
    for (const id of ['ask-customs', 'ask-bay-nine']) s.pick(id);
    s.pick('leave');
    s.start(CRAY);
    expect(s.text()).toMatch(/You again/);
  });
});

describe('Tereza Maelo', () => {
  it('AC-4: a knight meeting her is offered the duel; others are not', () => {
    const knight = open(TEREZA, { playerClass: 'knight' });
    expect(knight.ids()).toEqual(['accept-duel', 'decline-duel', 'later-duel']);
    for (const playerClass of ['archer', 'sorcerer', 'thief'] as const) {
      const s = open(TEREZA, { playerClass });
      expect(s.ids()).not.toContain('accept-duel');
      expect(s.ids()).not.toContain('duel-again');
    }
    knight.pick('accept-duel');
    expect(knight.host.facts.get('tereza.duel.accepted')).toBe(true);
    expect(knight.host.emitted).toContainEqual(
      expect.objectContaining({
        event: 'tereza.duel-start',
        data: { stakes: 'first-blood', arena: 'tidemarket' },
      }),
    );
  });

  it('declining relieves her and keeps the offer open; a knight can ask again later', () => {
    const s = open(TEREZA, { playerClass: 'knight' });
    s.pick('decline-duel');
    expect(s.host.facts.get('tereza.duel.declined')).toBe(true);
    expect(s.host.disposition('npc-tereza')).toBe(3);
    const later = open(TEREZA, { playerClass: 'knight' });
    later.pick('later-duel');
    expect(later.ids()).not.toContain('accept-duel');
    later.pick('leave');
  });

  it('AC-4: winning the duel sets tereza.duel.result to won and opens the under-the-counter stock', () => {
    const s = session({
      playerClass: 'knight',
      facts: { 'tereza.duel.fought': true, 'tereza.duel.victor': 'player' },
    });
    s.start(TEREZA);
    s.settle();
    expect(s.host.facts.get('tereza.duel.result')).toBe('won');
    expect(s.host.facts.get('tereza.under-counter')).toBe(true);
    expect(s.host.disposition('npc-tereza')).toBe(10);
    expect(s.events()).toContain('tereza.under-counter-opened');
    // it plays once: the next visit is an ordinary return
    s.pick('leave');
    s.start(TEREZA);
    expect(s.text()).toMatch(/Back again/);
  });

  it('AC-4: losing sets tereza.duel.result to lost, withholds the stock and offers a rematch', () => {
    const s = session({
      playerClass: 'knight',
      facts: { 'tereza.duel.fought': true, 'tereza.duel.victor': 'tereza' },
    });
    s.start(TEREZA);
    s.settle();
    expect(s.host.facts.get('tereza.duel.result')).toBe('lost');
    expect(s.host.facts.get('tereza.under-counter')).toBeUndefined();
    s.pick('rematch');
    expect(s.host.facts.get('tereza.duel.result')).toBe('none');
    expect(s.events()).toContain('tereza.duel-start');
  });

  it('an accepted but unfought duel can be re-offered', () => {
    const s = open(TEREZA, { playerClass: 'knight', facts: { 'tereza.duel.accepted': true } });
    s.pick('later-duel');
    s.pick('duel-again');
    expect(s.events()).toContain('tereza.duel-start');
  });

  it('the class branches: archer arrows and draw, sorcerer story for a spellbook, thief put it back', () => {
    const archer = open(TEREZA, { playerClass: 'archer' });
    archer.pick('arrows-archer');
    archer.pick('draw-archer');
    expect(archer.events()).toContain('tereza.arrows-offered');

    const told = open(TEREZA, { playerClass: 'sorcerer' }, win);
    told.pick('story-sorcerer');
    expect(told.host.facts.get('tereza.spellbook-traded')).toBe(true);
    expect(told.events()).toContain('tereza.spellbook-traded');
    expect(told.ids()).not.toContain('story-sorcerer');

    const dull = open(TEREZA, { playerClass: 'sorcerer' }, lose);
    dull.pick('story-sorcerer');
    expect(dull.host.facts.get('tereza.spellbook-traded')).toBeUndefined();
    expect(dull.ids()).toContain('story-sorcerer');

    const thief = open(TEREZA, { playerClass: 'thief' });
    thief.pick('sorry-thief');
    expect(thief.host.disposition('npc-tereza')).toBe(-2);
  });

  it('Tern access through the debt of honour needs trust or a duel win, and is once only', () => {
    expect(open(TEREZA, { playerClass: 'archer' }).ids()).not.toContain('ask-tern');
    for (const init of [
      { dispositions: { 'npc-tereza': 10 } },
      { facts: { 'tereza.duel.result': 'won' } },
    ]) {
      const s = open(TEREZA, { playerClass: 'archer', ...init });
      s.pick('ask-tern');
      expect(s.host.facts.get('tereza.tern-access')).toBe(true);
      expect(s.events()).toContain('tereza.tern-introduced');
      expect(s.ids()).not.toContain('ask-tern');
    }
  });

  it('the stall, the Saltmarch Isles and her fear of enjoying it too much', () => {
    const s = open(TEREZA, { playerClass: 'archer', dispositions: { 'npc-tereza': 10 } });
    s.pick('ask-stall');
    expect(s.events()).toContain('tereza.shop-requested');
    s.pick('ask-saltmarch');
    s.pick('ask-fear');
    expect(s.host.facts.get('tereza.confided')).toBe(true);
    s.pick('leave');
  });
});

describe('Jasper Quell', () => {
  it('AC-3: without evidence he only denies; the collapse branch needs the invoice or the manifest', () => {
    const s = open(QUELL, { playerClass: 'archer' });
    expect(s.ids()).not.toContain('confront-invoice');
    expect(s.ids()).not.toContain('confront-manifest');
    s.pick('ask-stone');
    expect(s.host.facts.get('quell.collapsed')).toBeUndefined();
    s.pick('ask-manifest');
    s.pick('ask-factors');
  });

  it('AC-3: holding the foundry invoice or the honest manifest, the collapse is offered and the deal hands over the crate and the manifest', () => {
    for (const [evidence, option] of [
      ['evidence.foundry-invoice', 'confront-invoice'],
      ['evidence.honest-manifest', 'confront-manifest'],
    ] as const) {
      const s = open(QUELL, { playerClass: 'archer', facts: { [evidence]: true } });
      expect(s.ids()).toContain(option);
      s.pick(option);
      expect(s.host.facts.get('quell.collapsed')).toBe(true);
      expect(s.ids()).toEqual(['deal', 'demand', 'later']);
      s.pick('deal');
      expect(s.host.facts.get('quell.crate-access')).toBe(true);
      expect(s.host.facts.get('evidence.honest-manifest')).toBe(true);
      expect(s.host.facts.get('quell.manifest-given')).toBe(true);
      expect(s.host.facts.get('quell.head-start.given')).toBe(true);
      expect(s.host.facts.get('quell.left')).toBe(true);
      expect(s.events()).toEqual(
        expect.arrayContaining([
          'quell.collapsed',
          'quell.crate-opened',
          'quell.manifest-handed',
          'quell.departs',
        ]),
      );
    }
  });

  it('AC-3: he can also be made to hand it over without a head start, or left to think', () => {
    const forced = open(QUELL, { facts: { 'evidence.foundry-invoice': true } }, win);
    forced.pick('confront-invoice');
    forced.pick('demand');
    expect(forced.host.facts.get('quell.crate-access')).toBe(true);
    expect(forced.host.facts.get('quell.manifest-given')).toBe(true);
    expect(forced.host.facts.get('quell.left')).toBeUndefined();
    expect(forced.ids()).toContain('leave');

    const stalled = open(QUELL, { facts: { 'evidence.foundry-invoice': true } }, lose);
    stalled.pick('confront-invoice');
    stalled.pick('demand');
    expect(stalled.host.facts.get('quell.crate-access')).toBeUndefined();
    expect(stalled.ids()).toEqual(['deal', 'demand', 'later']);
    stalled.pick('later');
    // he is still collapsed on the next visit and goes straight to the bargain
    stalled.start(QUELL);
    expect(stalled.text()).toMatch(/decided/);
    stalled.settle();
    expect(stalled.ids()).toContain('deal');
  });

  it('the class branches: knight stern look, archer job, sorcerer curse, thief desk', () => {
    const knight = open(QUELL, { playerClass: 'knight' });
    knight.pick('stern-knight');
    expect(knight.host.facts.get('quell.foundry.named')).toBe(true);
    const archer = open(QUELL, { playerClass: 'archer' });
    archer.pick('guard-archer');
    expect(archer.events()).toContain('quell.guard-job-offered');
    const sorcerer = open(QUELL, { playerClass: 'sorcerer' });
    sorcerer.pick('cursed-sorcerer');
    expect(sorcerer.events()).toContain('quell.curse-asked');
    const thief = open(QUELL, { playerClass: 'thief' });
    thief.pick('desk-thief');
    expect(thief.host.facts.get('quell.desk-noticed')).toBe(true);
    thief.pick('leave');
    thief.start(QUELL);
    expect(thief.text()).toMatch(/Again/);
  });

  it('AC-6: once he has left, his office plays a note and no reachable line has him present', () => {
    for (const playerClass of CLASSES) {
      const s = session({ playerClass, facts: { 'quell.left': true, 'quell.collapsed': true } });
      s.start(QUELL);
      const spoken: string[] = [];
      let guard = 0;
      for (let view = s.runtime.view; view?.kind === 'line' && guard < 20; guard++) {
        expect(view.speaker, 'only the narrator speaks').toBe('narrator');
        spoken.push(view.text);
        view = s.runtime.advance();
      }
      expect(spoken.length).toBeGreaterThan(0);
      expect(spoken.join(' ')).toMatch(/Gone to see my mother/);
      expect(spoken.join(' ')).not.toMatch(/\b(Mr\. Quell|he is|he's) (here|in|at)\b/i);
      expect(s.runtime.view).toBeUndefined();
    }
  });

  it('AC-6: statically, every node reachable from the gone entry is narrator-only and ends', () => {
    const def = dialogueJson(QUELL);
    const gone = def.entries.find((e) => e.id === 'gone');
    expect(gone, 'a gone entry exists').toBeDefined();
    expect(def.entries[0]?.id, 'it is checked first').toBe('gone');
    const byId = new Map(def.nodes.map((n) => [n.id, n]));
    let cursor = byId.get(gone?.node ?? '');
    let hops = 0;
    while (cursor !== undefined && hops++ < 10) {
      expect(cursor.kind).toBe('line');
      if (cursor.kind !== 'line') break;
      expect(cursor.speaker).toBe('narrator');
      if (cursor.next === undefined) {
        expect(cursor.end).toBe(true);
        break;
      }
      cursor = byId.get(cursor.next);
    }
    expect(hops).toBeLessThan(10);
  });
});

describe('Captain Hesketh', () => {
  it('crew hiring signs the player on once, with the hook', () => {
    const s = open(HESKETH, { playerClass: 'knight' });
    s.pick('hire');
    s.pick('sign-crew');
    expect(s.host.facts.get('hesketh.crew-hired')).toBe(true);
    expect(s.events()).toContain('hesketh.crew-signed');
    expect(s.ids()).not.toContain('hire');
    const wait = open(HESKETH, {});
    wait.pick('hire');
    wait.pick('not-now');
    expect(wait.ids()).toContain('hire');
  });

  it('the shanghai scene opens the conversation and resolves to work or release', () => {
    const work = open(HESKETH, { facts: { 'hesketh.shanghaied': true } });
    expect(work.ids()).toEqual(['work-passage', 'argue-release']);
    work.pick('work-passage');
    expect(work.host.facts.get('hesketh.shanghaied')).toBe(false);
    expect(work.host.facts.get('hesketh.shanghai.served')).toBe(true);
    expect(work.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'hesketh.shanghai-scene', data: { outcome: 'work' } }),
    );

    const freed = open(HESKETH, { facts: { 'hesketh.shanghaied': true } }, win);
    freed.pick('argue-release');
    expect(freed.host.emitted).toContainEqual(
      expect.objectContaining({ event: 'hesketh.shanghai-scene', data: { outcome: 'released' } }),
    );
    expect(freed.host.facts.get('hesketh.shanghai.served')).toBeUndefined();

    // losing the argument is not a dead end: he puts you to work
    const lost = open(HESKETH, { facts: { 'hesketh.shanghaied': true } }, lose);
    lost.pick('argue-release');
    expect(lost.host.facts.get('hesketh.shanghai.served')).toBe(true);
  });

  it("Tereza's word opens the gangway; the locked berth is never explained", () => {
    expect(open(HESKETH, {}).ids()).not.toContain('ask-passage');
    const s = open(HESKETH, { facts: { 'tereza.tern-access': true } });
    s.pick('ask-passage');
    expect(s.host.facts.get('hesketh.gangway-open')).toBe(true);
    expect(s.events()).toContain('hesketh.board-requested');
    s.pick('ask-berth');
    s.pick('ask-tern');
    s.pick('ask-sail');
    expect(JSON.stringify(dialogueJson(HESKETH))).not.toMatch(/Mr\. S/);
  });

  it('the class branches: marine, lookout, wind, hold', () => {
    const cases = [
      ['knight', 'marine-knight', 'hesketh.guard-berth-offered'],
      ['archer', 'crow-archer', 'hesketh.lookout-offered'],
      ['sorcerer', 'wind-sorcerer', 'hesketh.wind-asked'],
    ] as const;
    for (const [playerClass, option, event] of cases) {
      const s = open(HESKETH, { playerClass });
      s.pick(option);
      expect(s.events()).toContain(event);
    }
    const thief = open(HESKETH, { playerClass: 'thief' });
    thief.pick('hold-thief');
    thief.pick('leave');
    thief.start(HESKETH);
    expect(thief.text()).toMatch(/Back on the quay/);
  });
});

describe('plot-critical items and surnames', () => {
  it('AC-5: no option lets Cray confiscate a plot-critical item', () => {
    const def = dialogueJson(CRAY);
    let hooks = 0;
    const tagsOf = (item: string): string[] =>
      ((content.get('item', item) as { tags?: string[] }).tags ?? []).map(String);
    for (const id of FOUR) {
      walk(dialogueJson(id), (n) => {
        // no effect takes an item a player might need: nothing is taken by name at all
        if (n['kind'] === 'takeItem') {
          const item = String(n['item']);
          expect(tagsOf(item), `${id} takes ${item}`).not.toContain('plot-critical');
          expect(tagsOf(item), `${id} takes ${item}`).not.toContain('forbidden-plot');
        }
      });
    }
    walk(def, (n) => {
      if (n['kind'] === 'emit' && String(n['event']).includes('confiscat')) {
        hooks++;
        const data = n['data'] as Record<string, string> | undefined;
        expect(data?.['scope'], 'confiscation is scoped to restricted books').toBe(
          'restricted-spellbooks',
        );
        expect(data?.['exclude']).toContain('plot-critical');
        expect(data?.['exclude']).toContain('forbidden-plot');
      }
    });
    expect(hooks).toBeGreaterThan(0);
    // and the other three do not confiscate at all
    for (const id of [TEREZA, QUELL, HESKETH])
      expect(JSON.stringify(dialogueJson(id))).not.toMatch(/confiscat/);
    // nothing names a plot-critical thing as one she takes
    expect(JSON.stringify(def)).not.toMatch(/"item"\s*:\s*"(?:book-|evidence)/);
  });

  it("no human character's surname in the four files starts with S (bible 11.1)", () => {
    const names = ['Prudence Cray', 'Tereza Maelo', 'Jasper Quell', 'Hesketh'];
    for (const name of names) expect(name.split(' ').at(-1)).not.toMatch(/^S/);
    for (const id of FOUR)
      expect(JSON.stringify(dialogueJson(id))).not.toMatch(
        /\b[A-Z][a-z]+ S[a-z]+\b(?<!Saltmarch Isles)(?<!Stone Wharf)/,
      );
  });
});
