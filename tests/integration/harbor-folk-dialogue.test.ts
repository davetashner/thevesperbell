// mw-e39.19: Mags Oakum, Nell Gannet, Big Oona and Old Reed, played by the real DialogueRuntime against
// the shipped content. Each AC names its test. AC-6 (read-through against bible 5.13 and the tone guide)
// is manual and awaits the owner.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { gameContentSources, loadGameContent } from '@content/index';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime, type DialogueView } from '@sim/dialogue/runtime';
import type { DialogueDef } from '@content/types/dialogue';
import { main } from '../../src/tools/dialogue/cli';

const content = loadGameContent();
const NPC_OF: Record<string, string> = {
  'mags-patient-ann': 'npc-mags',
  'nell-drowned-gull': 'npc-nell',
  'oona-arm-wrestling': 'npc-oona',
  'reed-kestrel-lock': 'npc-reed',
};
const FOUR = Object.keys(NPC_OF);
NPC_OF['dot-sleeping-ox'] = 'npc-dot';
const CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;
const MORNING = 8 * 60;
const AFTERNOON = 15 * 60;
const NIGHT = 23 * 60;

function session(init: ConstructorParameters<typeof MemoryLogicHost>[0] = {}) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost(init);
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const start = (dialogue: string): DialogueView => runtime.start(dialogue, NPC_OF[dialogue] ?? '');
  const settle = (): DialogueView => {
    let view = runtime.view;
    for (let i = 0; view?.kind === 'line' && i < 50; i++) view = runtime.advance();
    return view ?? { kind: 'ended', reason: 'completed' };
  };
  const ids = (): string[] => runtime.choices().map((c) => c.id);
  let last: string[] = [];
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  const pick = (id: string): DialogueView => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok, id).toBe(true);
    last = lines();
    return settle();
  };
  /** The line now showing, else everything spoken after the last choice. */
  const text = (): string => {
    const view = runtime.view;
    return view?.kind === 'line' ? view.text : last.join(' ');
  };
  return { host, runtime, start, settle, ids, pick, text, lines };
}

const factOf = (s: ReturnType<typeof session>, key: string) => s.host.facts.get(key);

describe('the four harbour dialogues', () => {
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

  it('AC-1: every fact the four read or write is registered with its default', () => {
    const keys = new Set(content.all('fact').flatMap((g) => g.facts.map((f) => f.key)));
    const group = content.get('fact', 'harbor-folk-dialogue');
    expect(group.facts.length).toBeGreaterThan(10);
    for (const fact of group.facts) expect(keys.has(fact.key), fact.key).toBe(true);
  });

  it('AC-2: Mags and Nell greet each class on a first meeting with their own line (4 distinct)', () => {
    for (const id of [
      'mags-patient-ann',
      'nell-drowned-gull',
      'oona-arm-wrestling',
      'reed-kestrel-lock',
    ]) {
      const greetings = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass });
        s.start(id);
        greetings.add(s.text());
      }
      expect(greetings.size, `${id} greetings`).toBe(4);
      const any = session({});
      any.start(id);
      expect(greetings.has(any.text())).toBe(false);
      any.settle();
      any.pick('leave');
      any.start(id);
      expect(any.text()).toMatch(/\w/);
    }
  });

  it('AC-2: Mags and Nell each offer four class-only branches, one per class', () => {
    for (const id of ['mags-patient-ann', 'nell-drowned-gull']) {
      const gated = new Set<string>();
      for (const playerClass of CLASSES) {
        const s = session({ playerClass });
        s.start(id);
        s.settle();
        const mine = s.ids().filter((o) => o.endsWith(`-${playerClass}`));
        expect(mine.length, `${id} ${playerClass}`).toBe(1);
        for (const other of CLASSES.filter((c) => c !== playerClass))
          expect(s.ids().some((o) => o.endsWith(`-${other}`))).toBe(false);
        gated.add(mine[0] ?? '');
      }
      expect(gated.size).toBe(4);
    }
  });

  it('AC-3: at night Mags refuses the barge and no travel is started', () => {
    for (const minuteOfDay of [NIGHT, 2 * 60, 4 * 60 + 59]) {
      const s = session({ gold: 20, minuteOfDay });
      s.start('mags-patient-ann');
      s.settle();
      s.pick('ask-ride');
      expect(s.text()).toMatch(/Not in the dark/);
      expect(s.ids()).not.toContain('ride-pay');
      s.pick('leave');
      expect(s.host.emitted.some((e) => e.event === 'barge.ride-booked')).toBe(false);
    }
  });

  it('AC-3: in the morning she books the barge for a fare, or on a class deal, and emits the hook', () => {
    const paid = session({ gold: 10, minuteOfDay: MORNING });
    paid.start('mags-patient-ann');
    paid.settle();
    paid.pick('ask-ride');
    expect(paid.ids()).toContain('ride-pay');
    expect(paid.ids()).not.toContain('ride-deal');
    paid.pick('ride-pay');
    expect(paid.host.gold()).toBe(6);
    expect(paid.host.emitted.filter((e) => e.event === 'barge.ride-booked')).toHaveLength(1);

    const deal = session({ playerClass: 'knight', minuteOfDay: MORNING });
    deal.start('mags-patient-ann');
    deal.settle();
    deal.pick('fare-knight');
    expect(factOf(deal, 'mags.fare-deal')).toBe('tow-rope');
    deal.pick('ask-ride');
    deal.pick('ride-deal');
    expect(deal.host.emitted.some((e) => e.event === 'barge.ride-booked')).toBe(true);

    const broke = session({ gold: 1, minuteOfDay: MORNING });
    broke.start('mags-patient-ann');
    broke.settle();
    broke.pick('ask-ride');
    broke.pick('ride-pay');
    expect(broke.text()).toMatch(/not four promises/);
    expect(broke.host.emitted.some((e) => e.event === 'barge.ride-booked')).toBe(false);

    const late = session({ gold: 10, minuteOfDay: AFTERNOON });
    late.start('mags-patient-ann');
    late.settle();
    late.pick('ask-ride');
    expect(late.text()).toMatch(/missed the morning tide/);
  });

  it('Mags: class deals, the humming and the secrets are gated by class and disposition', () => {
    const deals: Record<string, string> = {
      knight: 'tow-rope',
      archer: 'herons',
      sorcerer: 'gust',
      thief: 'tarpaulin',
    };
    for (const playerClass of CLASSES) {
      const s = session({ playerClass, gold: 10 });
      s.start('mags-patient-ann');
      s.settle();
      s.pick(`fare-${playerClass}`);
      expect(factOf(s, 'mags.fare-deal')).toBe(deals[playerClass]);
    }
    const poor = session({ playerClass: 'thief', gold: 1 });
    poor.start('mags-patient-ann');
    poor.settle();
    poor.pick('fare-thief');
    expect(factOf(poor, 'mags.fare-deal')).toBeUndefined();
    expect(poor.text()).toMatch(/Five coins/);

    const cold = session({});
    cold.start('mags-patient-ann');
    cold.settle();
    cold.pick('ask-hum');
    expect(factOf(cold, 'mags.adit-open')).toBeUndefined();
    cold.pick('ask-crates');
    expect(factOf(cold, 'mags.crates-confessed')).toBeUndefined();
    expect(cold.text()).toMatch(/Stone, love/);

    const warm = session({ dispositions: { 'npc-mags': 8 }, gold: 10, minuteOfDay: MORNING });
    warm.start('mags-patient-ann');
    warm.settle();
    warm.pick('ask-hum');
    expect(factOf(warm, 'mags.adit-open')).toBe(true);
    warm.pick('ask-crates');
    expect(factOf(warm, 'mags.crates-confessed')).toBe(true);
    expect(factOf(warm, 'mags.coin-confessed')).toBe(true);
    warm.pick('ask-crates');
    expect(warm.text()).toMatch(/Same as I told you/);
    warm.pick('ask-ride');
    warm.pick('ride-adit');
    expect(
      warm.host.emitted.some(
        (e) => e.event === 'barge.ride-booked' && e.data['route'] === 'weeping-adit',
      ),
    ).toBe(true);
  });

  it('Mags: river lore tells rumours 16 and 18 and her son talk is once only', () => {
    const s = session({});
    s.start('mags-patient-ann');
    s.settle();
    s.pick('ask-son');
    expect(s.ids()).not.toContain('ask-son');
    s.pick('ask-river');
    s.pick('river-fish');
    s.pick('river-serpent');
    s.pick('river-back');
    const told = s.host.emitted.filter((e) => e.event === 'rumor.told').map((e) => e.data['rumor']);
    expect(told).toEqual([16, 18]);
  });

  it('AC-4: a thief holding the commission coin is offered deliver, keep and fake, each sets commission.outcome', () => {
    const cases = [
      ['commission-deliver', 'delivered'],
      ['commission-keep', 'kept'],
      ['commission-fake', 'faked'],
    ] as const;
    for (const [option, outcome] of cases) {
      const s = session({ playerClass: 'thief', facts: { 'commission.coin-held': true } });
      s.start('nell-drowned-gull');
      s.settle();
      expect(s.ids()).toEqual(['commission-deliver', 'commission-keep', 'commission-fake']);
      s.pick(option);
      expect(factOf(s, 'commission.outcome')).toBe(outcome);
      expect(
        s.host.emitted.some(
          (e) => e.event === 'commission.dropped' && e.data['outcome'] === outcome,
        ),
      ).toBe(true);
      expect(factOf(s, 'commission.coin-held')).toBe(outcome === 'kept');
    }
    const deliver = session({ playerClass: 'thief', facts: { 'commission.coin-held': true } });
    deliver.start('nell-drowned-gull');
    deliver.settle();
    deliver.pick('commission-deliver');
    expect(deliver.host.gold()).toBe(30);
  });

  it('AC-4: the commission is not offered to other classes, without the coin, or twice', () => {
    for (const init of [
      { playerClass: 'knight', facts: { 'commission.coin-held': true } },
      { playerClass: 'thief', facts: {} },
      {
        playerClass: 'thief',
        facts: { 'commission.coin-held': true, 'commission.outcome': 'kept' },
      },
    ]) {
      const s = session(init);
      s.start('nell-drowned-gull');
      s.settle();
      expect(s.ids()).not.toContain('commission-deliver');
    }
  });

  it('Nell: class deals, secrets and the Undertow are gated', () => {
    const knight = session({ playerClass: 'knight' });
    knight.start('nell-drowned-gull');
    knight.settle();
    knight.pick('deal-knight');
    expect(knight.text()).toMatch(/Smash with confidence/);

    const archer = session({ playerClass: 'archer' });
    archer.start('nell-drowned-gull');
    archer.settle();
    archer.pick('deal-archer');
    expect(factOf(archer, 'nell.gull-shoot-sponsored')).toBe(true);

    const sorcerer = session({ playerClass: 'sorcerer' });
    sorcerer.start('nell-drowned-gull');
    sorcerer.settle();
    sorcerer.pick('deal-sorcerer');
    expect(factOf(sorcerer, 'nell.books-offered')).toBe(true);

    const thief = session({ playerClass: 'thief' });
    thief.start('nell-drowned-gull');
    thief.settle();
    thief.pick('ask-jobs');
    expect(thief.host.emitted.some((e) => e.event === 'lowtide.job-offered')).toBe(true);
    thief.pick('deal-thief');
    expect(factOf(thief, 'nell.undertow-open')).toBe(true);
    thief.pick('ask-undertow');
    expect(thief.text()).toMatch(/The Undertow/);
    thief.pick('ask-bay-nine');
    expect(factOf(thief, 'nell.bay-nine-told')).toBe(true);

    const stranger = session({ playerClass: 'knight' });
    stranger.start('nell-drowned-gull');
    stranger.settle();
    stranger.pick('ask-jobs');
    stranger.pick('ask-undertow');
    expect(stranger.text()).toMatch(/bilges/);
    stranger.pick('ask-bay-nine');
    expect(factOf(stranger, 'nell.bay-nine-told')).toBeUndefined();
    stranger.pick('ask-skim');
    expect(factOf(stranger, 'nell.skimming-confessed')).toBeUndefined();

    const friend = session({ playerClass: 'knight', dispositions: { 'npc-nell': 10 } });
    friend.start('nell-drowned-gull');
    friend.settle();
    friend.pick('ask-undertow');
    expect(friend.text()).toMatch(/The Undertow/);
    friend.pick('ask-bay-nine');
    expect(factOf(friend, 'nell.bay-nine-told')).toBe(true);
    friend.pick('ask-skim');
    expect(factOf(friend, 'nell.skimming-confessed')).toBe(true);
  });

  it('Nell: drinks cost gold and warm her, gossip tells rumours 13 and 14', () => {
    const s = session({ gold: 2 });
    s.start('nell-drowned-gull');
    s.settle();
    s.pick('ask-drink');
    expect(s.host.gold()).toBe(0);
    s.pick('ask-drink');
    expect(s.text()).toMatch(/not two sighs/);
    s.pick('ask-gossip');
    s.pick('gossip-nine');
    s.pick('gossip-cray');
    s.pick('gossip-back');
    const told = s.host.emitted.filter((e) => e.event === 'rumor.told').map((e) => e.data['rumor']);
    expect(told).toEqual([13, 14]);
  });

  it('Oona and Reed: the table, the Tidefair and the toll in coin or gossip', () => {
    const o = session({});
    o.start('oona-arm-wrestling');
    o.settle();
    o.pick('ask-tidefair');
    o.pick('ask-brawl');
    o.pick('ask-nell');
    o.pick('ask-wrestle');
    expect(o.host.emitted.some((e) => e.event === 'armwrestle.requested')).toBe(true);

    const coin = session({ gold: 1 });
    coin.start('reed-kestrel-lock');
    coin.settle();
    coin.pick('ask-lock');
    coin.pick('ask-barges');
    coin.pick('ask-toll');
    coin.pick('toll-coin');
    expect(factOf(coin, 'reed.toll-paid')).toBe(true);
    expect(coin.host.gold()).toBe(0);

    const broke = session({ gold: 0 });
    broke.start('reed-kestrel-lock');
    broke.settle();
    broke.pick('ask-toll');
    broke.pick('toll-coin');
    expect(broke.ids()).toContain('gossip-tern');
    broke.pick('gossip-none');
    expect(factOf(broke, 'reed.toll-paid')).toBeUndefined();
    broke.pick('ask-toll');
    broke.pick('toll-no');

    const gossip = session({});
    gossip.start('reed-kestrel-lock');
    gossip.settle();
    gossip.pick('ask-toll');
    gossip.pick('toll-gossip');
    gossip.pick('gossip-vane');
    expect(factOf(gossip, 'reed.toll-paid')).toBe(true);
    gossip.pick('ask-toll');
    gossip.pick('toll-gossip');
    gossip.pick('gossip-tern');
    expect(
      gossip.host.emitted.some((e) => e.event === 'rumor.told' && e.data['rumor'] === 17),
    ).toBe(true);
  });

  it('AC-5: before Wendmouth Briar Glen only has hearsay of Nell and Mags; after, the line is gone', () => {
    const before = session({});
    before.start('dot-sleeping-ox');
    before.settle();
    expect(before.ids()).toContain('ask-downriver');
    before.pick('ask-downriver');
    const hearsay = before.text();
    expect(hearsay).toMatch(/Mags Oakum/);
    expect(hearsay).toMatch(/Nell Gannet/);
    expect(hearsay).toMatch(/never met either/);
    expect(hearsay).toMatch(/So the carters tell me/i);
    expect(before.ids()).not.toContain('ask-downriver');

    const after = session({ facts: { 'wendmouth.visited': true } });
    after.start('dot-sleeping-ox');
    after.settle();
    expect(after.ids()).not.toContain('ask-downriver');
  });

  it('AC-5: no other Briar Glen dialogue names Nell, Mags or the Gull unless gated on wendmouth.visited', () => {
    const harbour = new Set(FOUR);
    for (const dialogue of content.all('dialogue')) {
      if (harbour.has(dialogue.id)) continue;
      for (const node of dialogue.nodes) {
        const texts =
          node.kind === 'line'
            ? [node.text]
            : node.kind === 'choice'
              ? node.options.map((o) => o.text)
              : [];
        for (const t of texts) {
          if (!/Nell|Mags|Gannet|Oakum|Drowned Gull/.test(t)) continue;
          expect(
            dialogue.id === 'dot-sleeping-ox' && node.id === 'downriver-1',
            `${dialogue.id}/${node.id}: ${t}`,
          ).toBe(true);
        }
      }
    }
  });
});
