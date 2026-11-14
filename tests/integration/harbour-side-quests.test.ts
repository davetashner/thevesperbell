// mw-e39.22: the Wendmouth side quests The Tidefair and Contraband Pages as data, run through the real
// quest runtime and the real harbour dialogues over the shipped content. Each test names the
// acceptance criterion it proves. AC-6 (a knight, an archer and a sorcerer each name their class
// event as a highlight of the harbour) is a manual playtest and awaits the owner. The gull shoot,
// regatta and pocket race are mw-e40.7 to mw-e40.9, so their outcomes are set as the facts those
// contests will write.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import type { DialogueDef } from '@content/types/dialogue';
import type { QuestDef } from '@content/types/quest';
import { EventBus } from '@sim/core/events';
import { ContestRunner } from '@sim/contest/index';
import { DialogueRuntime } from '@sim/dialogue/runtime';
import { declareFacts, QuestRuntime, validateQuestLogic, World } from '@sim/index';
import { MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';
import { Rng } from '@sim/rng';

const TIDE = 'quest-tidefair';
const PAGES = 'quest-contraband-pages';
const CRATE_ITEM = 'crate-impounded-books';
const VANE_WRIT = 'writ-vane-chair';
const FORGED_WRIT = 'writ-forged-lantern';
const ROMANCE = 'romance-hearts-against-the-tide';
const CRATE = 'quest-crate-for-mr-s';
const MAIN = 'quest-labyrinth-beneath-briar-glen';
const EVENTS = ['arm-wrestling', 'gull-shoot', 'regatta', 'pocket-race'] as const;
const CLASS_EVENT = {
  knight: 'arm-wrestling',
  archer: 'gull-shoot',
  sorcerer: 'regatta',
  thief: 'pocket-race',
} as const;
const NPC_OF: Record<string, string> = {
  'cray-customs': 'npc-cray',
  'mirela-stacks': 'npc-mirela',
  'vane-bounty': 'npc-vane',
  'oona-arm-wrestling': 'npc-oona',
  'nell-drowned-gull': 'npc-nell',
  'tereza-arms-stall': 'npc-tereza',
};
const content = loadGameContent();
const quests = {
  tide: content.get('quest', TIDE) as unknown as QuestDef,
  pages: content.get('quest', PAGES) as unknown as QuestDef,
};

class WorldHost extends MemoryLogicHost {
  constructor(
    private readonly world: World,
    init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  ) {
    super({ capabilities: [], ...init });
    Object.defineProperty(this, 'facts', { value: world.facts });
  }

  override playerClass(): string | undefined {
    const value = this.world.facts.get('player.class');
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  override setFact(key: string, value: boolean | number | string): undefined {
    this.world.facts.set(key, value);
    return undefined;
  }
}

interface Game {
  readonly world: World;
  readonly runtime: QuestRuntime;
  readonly host: WorldHost;
  readonly dialogue: DialogueRuntime;
}

function boot(gold = 0): Game {
  const world = new World({ seed: 22 });
  declareFacts(world.facts, content.all('fact'), { mode: 'throw' });
  const host = new WorldHost(world, { gold });
  const runtime = new QuestRuntime({
    quests: content.all('quest') as never,
    facts: world.facts,
    host,
    events: world.events,
  });
  const dialogue = new DialogueRuntime({
    world: world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  return { world, runtime, host, dialogue };
}

const tick = (g: Game): void => {
  g.world.step();
  g.runtime.update();
};
const set = (g: Game, facts: Record<string, boolean | number | string>): void => {
  g.world.facts.transaction(() => {
    for (const [key, value] of Object.entries(facts)) g.world.facts.set(key, value);
  });
  tick(g);
};
const done = (g: Game, quest: string, ...objectives: string[]): void => {
  for (const objective of objectives) {
    expect(g.runtime.completeObjective(quest, objective), objective).toBeUndefined();
    tick(g);
  }
};
const fact = (g: Game, key: string) => g.world.facts.get(key);
const state = (g: Game, quest: string) => g.runtime.questState(quest);
const resolution = (g: Game, quest: string) => g.world.facts.get(`quest.${quest}.resolution`);

/** Plays a dialogue: opens it, then picks each option id in turn; returns every line spoken. */
function talk(g: Game, dialogue: string, picks: string[] = []): string[] {
  const said: string[] = [];
  const play = (): void => {
    for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance())
      said.push(view.text);
  };
  g.dialogue.start(dialogue, NPC_OF[dialogue] ?? '');
  play();
  for (const id of picks) {
    const index = g.dialogue.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(g.dialogue.choose(index).ok, id).toBe(true);
    play();
  }
  g.dialogue.abort();
  tick(g);
  return said;
}
const offered = (g: Game, dialogue: string): string[] => {
  g.dialogue.start(dialogue, NPC_OF[dialogue] ?? '');
  for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance());
  const ids = g.dialogue.choices().map((c) => c.id);
  g.dialogue.abort();
  return ids;
};

function referencesIn(): LogicRefChecker {
  const facts = factIndex(content.all('fact'));
  const objectives = new Set(
    content.all('quest').flatMap((q) => q.objectives.map((o) => `${q.id}/${o.id}`)),
  );
  const known: Record<string, (id: string) => boolean> = {
    item: (id) => content.has('item', id),
    npc: (id) => content.has('creature', id),
    class: (id) => content.has('class', id),
    quest: (id) => content.has('quest', id),
    objective: (id) => objectives.has(id),
    fact: (key) => lookupFact(facts, key) !== undefined,
  };
  return (ref) =>
    known[ref.type]?.(ref.id) === false ? `unknown ${ref.type} "${ref.id}"` : undefined;
}

const results = (g: Game, values: Record<string, string>) => {
  set(g, Object.fromEntries(Object.entries(values).map(([e, v]) => [`tidefair.results.${e}`, v])));
};

describe('The Tidefair and Contraband Pages: data', () => {
  it('AC-1: both quests validate; the Tidefair has four events with win, cheat, throw and lose outcomes', ({
    task,
  }) => {
    markExercised(task, 'quest', TIDE);
    markExercised(task, 'quest', PAGES);
    markExercised(task, 'fact', 'harbour-side-quests');
    markExercised(task, 'signal-graph', 'wendmouth-harbour-areas');
    for (const q of [quests.tide, quests.pages]) {
      expect(validateQuestLogic(q, referencesIn()), q.id).toEqual([]);
      const keys = [...JSON.stringify(q).matchAll(/"fact":"([^"]+)"/g)].map((m) => m[1] ?? '');
      const known = factIndex(content.all('fact'));
      for (const key of keys) expect(lookupFact(known, key), key).toBeDefined();
    }
    const known = factIndex(content.all('fact'));
    for (const event of EVENTS) {
      const def = lookupFact(known, `tidefair.results.${event}`);
      expect(def?.type, event).toBe('enum');
      for (const outcome of ['won', 'cheated', 'thrown', 'lost'])
        expect((def as { values?: string[] }).values, `${event} ${outcome}`).toContain(outcome);
      expect(quests.tide.objectives.map((o) => o.id)).toContain(
        `win-the-${event === 'arm-wrestling' ? 'table' : event}`,
      );
    }
    expect(quests.pages.resolutions.length).toBeGreaterThanOrEqual(5);
    for (const r of quests.pages.resolutions) {
      const methods = (r.effects ?? []).filter(
        (e) => e.kind === 'setFact' && e['fact'] === 'books.method',
      );
      expect(methods.length, r.id).toBe(1);
    }
    const approaches = new Set(quests.pages.resolutions.map((r) => r.approach));
    for (const a of ['diplomacy', 'stealth', 'trickery'])
      expect(approaches.has(a as never), a).toBe(true);
  });

  it('are side quests: the main quest names neither and neither writes tern.sailed', ({ task }) => {
    markExercised(task, 'note', 'note-tidefair-board');
    markExercised(task, 'note', 'note-impound-ledger');
    for (const q of [quests.tide, quests.pages]) {
      const written = [...JSON.stringify(q).matchAll(/"setFact","fact":"([^"]+)"/g)].map(
        (m) => m[1] ?? '',
      );
      expect(written).not.toContain('tern.sailed');
      expect(written).not.toContain('crate.intercepted');
      expect(JSON.stringify(content.get('quest', MAIN))).not.toContain(q.id);
    }
    expect(content.get('note', 'note-tidefair-board').pages[0]?.text).toMatch(/No Magic/);
    expect(content.get('note', 'note-impound-ledger').pages[0]?.text).toMatch(/Thorne/);
  });

  it('the new areas are volumes of the harbour scene', () => {
    const scene = content.get('scene', 'wendmouth-harbour');
    expect(scene.signals.map((s) => s.graph.id)).toContain('wendmouth-harbour-areas');
    const nodes = content.get('signal-graph', 'wendmouth-harbour-areas').nodes.map((n) => n.id);
    for (const area of ['tidefair-ground', 'customs-house', 'customs-strongroom'])
      expect(nodes).toContain(area);
  });
});

describe('The Tidefair', () => {
  it('starts when the player signs up or Nell opens her book, and not before', () => {
    for (const lead of ['tidefair.joined', 'nell.book-open', 'nell.gull-shoot-sponsored']) {
      const g = boot();
      set(g, { 'player.class': 'knight' });
      expect(state(g, TIDE), lead).toBe('unstarted');
      set(g, { [lead]: true });
      expect(state(g, TIDE), lead).toBe('active');
    }
  });

  for (const [cls, event] of Object.entries(CLASS_EVENT)) {
    it(`AC-2: a ${cls} who joins has the ${event} highlighted and all four events enterable`, () => {
      const g = boot();
      set(g, { 'player.class': cls });
      talk(g, 'oona-arm-wrestling', ['ask-enter']);
      expect(fact(g, 'tidefair.joined')).toBe(true);
      expect(state(g, TIDE)).toBe('active');
      tick(g);
      expect(g.runtime.stage(TIDE)).toBe('events');
      expect(fact(g, 'tidefair.highlight')).toBe(event);
      for (const e of EVENTS) {
        const id = `win-the-${e === 'arm-wrestling' ? 'table' : e}`;
        expect(g.runtime.objectiveState(TIDE, id), id).toBe('active');
      }
    });
  }

  it("AC-2: Oona's pointer to the player's own event is class-flavoured, and every event is named", () => {
    for (const [cls, event] of Object.entries(CLASS_EVENT)) {
      const g = boot();
      set(g, { 'player.class': cls });
      const said = talk(g, 'oona-arm-wrestling', ['ask-enter']).join(' | ');
      const flavour = {
        'arm-wrestling': /Table's yours/,
        'gull-shoot': /Gull Shoot's yours/,
        regatta: /The Regatta, I'd say/,
        'pocket-race': /Pocket Race, love/,
      }[event];
      expect(said, cls).toMatch(flavour);
      for (const name of ['Gull Shoot', 'Regatta', 'Pocket Race'])
        expect(said, cls).toContain(name);
    }
  });

  it('AC-3: a regatta win with magic while Cray is present is voided, tidefair.cheated is set and a fine branch plays', () => {
    const g = boot(20);
    set(g, { 'player.class': 'sorcerer', 'tidefair.joined': true });
    expect(g.runtime.stage(TIDE)).toBe('events');
    set(g, {
      'tidefair.results.regatta': 'won',
      'tidefair.regatta.magic-used': true,
      'tidefair.regatta.cray-present': true,
    });
    expect(g.runtime.stage(TIDE)).toBe('fined');
    expect(fact(g, 'tidefair.results.regatta')).toBe('cheated');
    expect(fact(g, 'tidefair.cheated')).toBe(true);
    expect(fact(g, 'tidefair.regatta.fine-due')).toBe(true);
    const said = talk(g, 'cray-customs', ['pay-fine']);
    expect(said.join(' | ')).toMatch(/Your win is void/);
    expect(said.join(' | ')).toMatch(/Ten crowns, paid in full/);
    expect(g.host.gold()).toBe(10);
    expect(fact(g, 'tidefair.regatta.fine-paid')).toBe(true);
    expect(g.runtime.stage(TIDE)).toBe('after-the-fine');
  });

  it('AC-3: a player who cannot pay has the fine entered as a debt and the quest moves on', () => {
    const g = boot(0);
    set(g, { 'player.class': 'sorcerer', 'tidefair.joined': true });
    set(g, {
      'tidefair.results.regatta': 'won',
      'tidefair.regatta.magic-used': true,
      'tidefair.regatta.cray-present': true,
    });
    expect(g.runtime.stage(TIDE)).toBe('fined');
    expect(offered(g, 'cray-customs')).toEqual(['owe-fine']);
    const said = talk(g, 'cray-customs', ['owe-fine']);
    expect(said.join(' | ')).toMatch(/entered in the ledger/);
    expect(fact(g, 'tidefair.regatta.fine-owed')).toBe(true);
    expect(g.runtime.stage(TIDE)).toBe('after-the-fine');
  });

  it("AC-3: magic out of Cray's sight, or Cray without magic, leaves the win standing", () => {
    for (const facts of [
      { 'tidefair.regatta.magic-used': true },
      { 'tidefair.regatta.cray-present': true },
    ]) {
      const g = boot();
      set(g, { 'player.class': 'sorcerer', 'tidefair.joined': true });
      set(g, { 'tidefair.results.regatta': 'won', ...facts });
      expect(g.runtime.stage(TIDE)).toBe('events');
      expect(fact(g, 'tidefair.results.regatta')).toBe('won');
      expect(fact(g, 'tidefair.cheated')).toBe(false);
    }
  });

  it('AC-5: losing every event is a consolation: Oona buys a drink and no disposition falls', () => {
    const g = boot();
    set(g, { 'player.class': 'archer', 'tidefair.joined': true });
    results(g, { 'arm-wrestling': 'lost', 'gull-shoot': 'lost', regatta: 'lost' });
    expect(state(g, TIDE)).toBe('active');
    results(g, { 'pocket-race': 'lost' });
    expect(state(g, TIDE)).toBe('resolved');
    expect(resolution(g, TIDE)).toBe('graceful-loser');
    expect(fact(g, 'tidefair.outcome')).toBe('consolation');
    expect(fact(g, 'tidefair.consolation')).toBe(true);
    expect(fact(g, 'tidefair.cheated')).toBe(false);
    expect(g.host.disposition('npc-oona')).toBeGreaterThan(0);
    expect(g.host.disposition('npc-nell')).toBeGreaterThan(0);
    const said = talk(g, 'oona-arm-wrestling');
    expect(said.join(' | ')).toMatch(/lost like a gentleman/);
    expect(fact(g, 'oona.drink-bought')).toBe(true);
    expect(g.host.disposition('npc-oona')).toBeGreaterThanOrEqual(3);
    expect(fact(g, 'tereza.under-counter')).toBe(false);
  });

  it('the real arm-wrestling contest writes the result facts the quest reads', () => {
    const def = content.get('contest', 'drowned-gull-arm-wrestling');
    const run = (
      act: (runner: ContestRunner, host: MemoryLogicHost, bus: EventBus) => void,
      perceived = false,
    ) => {
      const host = new MemoryLogicHost({ gold: 40 });
      const bus = new EventBus();
      const runner = new ContestRunner({
        contests: [def],
        host,
        rng: Rng.create(1),
        events: bus,
        perception: { perceives: () => perceived },
      });
      runner.enter(def.id, 0);
      act(runner, host, bus);
      bus.flush();
      return host;
    };
    expect(
      run((r) => {
        r.update(90 * 5);
      }).facts.get('tidefair.results.arm-wrestling'),
    ).toBe('lost');
    const won = run((r) => {
      for (let i = 0; i < 5; i++) r.record({ name: 'armwrestle.push', tick: i });
    });
    expect(won.facts.get('tidefair.results.arm-wrestling')).toBe('won');
    const thrown = run((r) => {
      r.bet(def.id, { kind: 'throw' });
      r.update(90 * 5);
    });
    expect(thrown.facts.get('tidefair.results.arm-wrestling')).toBe('thrown');
    const caught = run((r) => {
      r.record({ name: 'spell.cast', tick: 5 });
    }, true);
    expect(caught.facts.get('tidefair.results.arm-wrestling')).toBe('cheated');
    expect(caught.facts.get('tidefair.cheated')).toBe(true);
  });

  const SCENARIOS: {
    id: string;
    outcome: string;
    setup: Record<string, string | boolean>;
    cls?: string;
  }[] = [
    {
      id: 'class-champion',
      outcome: 'champion',
      cls: 'knight',
      setup: { 'tidefair.results.arm-wrestling': 'won', 'tidefair.concluded': true },
    },
    {
      id: 'honest-sport',
      outcome: 'honest',
      cls: 'knight',
      setup: {
        'tidefair.results.gull-shoot': 'won',
        'tidefair.results.arm-wrestling': 'lost',
        'tidefair.concluded': true,
      },
    },
    {
      id: 'bookies-friend',
      outcome: 'bookie',
      cls: 'knight',
      setup: { 'tidefair.results.arm-wrestling': 'thrown', 'tidefair.concluded': true },
    },
    {
      id: 'crooked-winner',
      outcome: 'crooked',
      cls: 'thief',
      setup: {
        'tidefair.results.pocket-race': 'cheated',
        'tidefair.cheated': true,
        'tidefair.concluded': true,
      },
    },
  ];
  for (const s of SCENARIOS) {
    it(`resolves ${s.id} once the day is called`, () => {
      const g = boot();
      set(g, { 'player.class': s.cls ?? 'knight', 'tidefair.joined': true });
      set(g, { ...s.setup, 'tidefair.concluded': false });
      expect(state(g, TIDE)).toBe('active');
      set(g, s.setup);
      expect(resolution(g, TIDE)).toBe(s.id);
      expect(fact(g, 'tidefair.outcome')).toBe(s.outcome);
    });
  }

  it('an honest winner is rewarded by Tereza with the under-counter stock and a discount', () => {
    const g = boot();
    set(g, { 'player.class': 'knight', 'tidefair.joined': true });
    set(g, { 'tidefair.results.arm-wrestling': 'won', 'tidefair.concluded': true });
    expect(fact(g, 'tidefair.regarded')).toBe(true);
    const said = talk(g, 'tereza-arms-stall');
    expect(said.join(' | ')).toMatch(/won something on the Stone Wharf/);
    expect(fact(g, 'tereza.under-counter')).toBe(true);
    expect(fact(g, 'tereza.tidefair-discount')).toBe(true);
  });

  it("Oona's close-the-day option waits for a result, and Nell's book starts the quest", () => {
    const g = boot();
    set(g, { 'player.class': 'archer' });
    talk(g, 'oona-arm-wrestling', ['ask-enter']);
    expect(offered(g, 'oona-arm-wrestling')).not.toContain('close-day');
    set(g, { 'tidefair.results.gull-shoot': 'won' });
    expect(offered(g, 'oona-arm-wrestling')).toContain('close-day');
    const h = boot();
    talk(h, 'nell-drowned-gull', ['ask-book']);
    expect(state(h, TIDE)).toBe('active');
  });

  it("Cray's ribbon: lifted unseen she is bothered, caught she is not", () => {
    const lifted = boot();
    set(lifted, { 'tidefair.pocket.cray-lifted': true });
    expect(talk(lifted, 'cray-customs').join(' | ')).toMatch(/My ribbon is gone/);
    const caught = boot();
    set(caught, { 'tidefair.pocket.cray-caught': true });
    expect(talk(caught, 'cray-customs').join(' | ')).toMatch(/My hand was on your wrist/);
    expect(caught.host.disposition('npc-cray')).toBe(-2);
  });
});

describe('Contraband Pages', () => {
  const startedBy = (g: Game, lead: Record<string, boolean>) => {
    set(g, lead);
    expect(state(g, PAGES)).toBe('active');
  };

  it('starts on any lead, and not before', () => {
    for (const lead of ['books.impounded', 'mirela.order.told', 'cray.writ.offered']) {
      const g = boot();
      expect(state(g, PAGES), lead).toBe('unstarted');
      set(g, { [lead]: true });
      expect(state(g, PAGES), lead).toBe('active');
    }
    const g = boot();
    talk(g, 'mirela-stacks', ['ask-order']);
    expect(state(g, PAGES)).toBe('active');
    const h = boot();
    talk(h, 'cray-customs', ['ask-crate']);
    expect(fact(h, 'books.impounded')).toBe(true);
    expect(state(h, PAGES)).toBe('active');
  });

  it("a searched sorcerer's own books are in the crate", () => {
    const g = boot();
    set(g, { 'player.class': 'sorcerer' });
    talk(g, 'cray-customs', ['submit-sorcerer']);
    expect(fact(g, 'books.impounded')).toBe(true);
    expect(state(g, PAGES)).toBe('active');
  });

  it('moves from the lead to the route once the player is under way', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true });
    expect(g.runtime.stage(PAGES)).toBe('lead');
    done(g, PAGES, 'visit-the-customs');
    expect(g.runtime.stage(PAGES)).toBe('route');
  });

  it('a failed bribe is recorded and never recovers the books', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true });
    talk(g, 'cray-customs', ['bribe-purse', 'bribe-fund']);
    expect(g.runtime.objectiveState(PAGES, 'try-a-bribe')).toBe('complete');
    expect(state(g, PAGES)).toBe('active');
    expect(fact(g, 'books.recovered')).toBe(false);
  });

  it('AC-4: the bay-nine evidence route releases the books in gratitude and opens the lawful seizure', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true, 'evidence.dead-clerk-seal': true });
    talk(g, 'cray-customs', ['give-evidence']);
    expect(fact(g, 'cray.seizure.agreed')).toBe(true);
    talk(g, 'cray-customs', ['ask-release']);
    expect(state(g, PAGES)).toBe('resolved');
    expect(resolution(g, PAGES)).toBe('evidence-gratitude');
    expect(g.host.itemCount(CRATE_ITEM)).toBe(1);
    expect(fact(g, 'books.recovered')).toBe(true);
    expect(fact(g, 'books.method')).toBe('evidence');
    expect(['grateful', 'fond']).toContain(fact(g, 'cray.disposition'));
    // Next time Cray is spoken to she says so, and the seizure route of the Crate quest is open.
    expect(talk(g, 'cray-customs').join(' | ')).toMatch(/Mr\. Vane|useful|matter of the crate/);
    expect(fact(g, 'cray.thanked')).toBe(true);
    set(g, { 'nell.bay-nine-told': true });
    expect(state(g, CRATE)).toBe('active');
    done(g, CRATE, 'cray-seizes-the-crate');
    expect(resolution(g, CRATE)).toBe('paper-seizure');
  });

  it('the romance novel route: Cray accepts it and the books go quietly', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true });
    expect(offered(g, 'cray-customs')).not.toContain('offer-romance');
    g.host.giveItem(ROMANCE, 1);
    g.runtime.notifyItem(ROMANCE);
    tick(g);
    expect(g.runtime.objectiveState(PAGES, 'find-a-romance')).toBe('complete');
    talk(g, 'cray-customs', ['offer-romance']);
    expect(g.host.itemCount(ROMANCE)).toBe(0);
    expect(fact(g, 'cray.romance-accepted')).toBe(true);
    expect(state(g, PAGES)).toBe('active');
    talk(g, 'cray-customs', ['ask-swap']);
    expect(resolution(g, PAGES)).toBe('romance-trade');
    expect(fact(g, 'cray.disposition')).toBe('fond');
    expect(fact(g, 'books.method')).toBe('romance');
    expect(g.host.itemCount(CRATE_ITEM)).toBe(1);
  });

  it("Vane's writ costs a hundred crowns and Cray accepts it", () => {
    const g = boot(150);
    set(g, { 'cray.writ.offered': true });
    expect(offered(g, 'vane-bounty')).toContain('ask-writ');
    talk(g, 'vane-bounty', ['ask-writ', 'writ-pay']);
    expect(g.host.gold()).toBe(50);
    expect(fact(g, 'writ.source')).toBe('vane');
    expect(g.host.itemCount(VANE_WRIT)).toBe(1);
    tick(g);
    expect(g.runtime.objectiveState(PAGES, 'buy-vanes-writ')).toBe('complete');
    expect(offered(g, 'vane-bounty')).not.toContain('ask-writ');
    talk(g, 'cray-customs', ['present-writ']);
    expect(resolution(g, PAGES)).toBe('vane-writ');
    expect(g.host.itemCount(VANE_WRIT)).toBe(0);
    expect(g.host.itemCount(CRATE_ITEM)).toBe(1);
    expect(fact(g, 'cray.disposition')).toBe('neutral');
  });

  it("Vane's price is out of reach for a player without the gold, and he will not sign once exposed", () => {
    const poor = boot(20);
    set(poor, { 'cray.writ.offered': true });
    const say = talk(poor, 'vane-bounty', ['ask-writ']);
    expect(say.join(' | ')).toMatch(/hundred crowns/);
    const exposed = boot(150);
    set(exposed, { 'cray.writ.offered': true, 'vane.fate': 'exposed' });
    expect(offered(exposed, 'vane-bounty')).not.toContain('ask-writ');
  });

  it("Mirela's forged Lantern seal passes Cray's desk if the player has not tried a bribe", () => {
    const g = boot();
    talk(g, 'mirela-stacks', ['ask-order']);
    expect(offered(g, 'mirela-stacks')).not.toContain('ask-forge');
    set(g, { 'cray.writ.offered': true });
    talk(g, 'mirela-stacks', ['ask-forge']);
    expect(fact(g, 'writ.source')).toBe('forged');
    expect(g.host.itemCount(FORGED_WRIT)).toBe(1);
    talk(g, 'cray-customs', ['present-writ']);
    expect(g.host.itemCount(FORGED_WRIT)).toBe(0);
    expect(resolution(g, PAGES)).toBe('forged-writ');
    expect(fact(g, 'books.method')).toBe('forged-writ');
  });

  it('Cray catches the forgery from a player who already tried to buy her', () => {
    const g = boot();
    set(g, { 'mirela.order.told': true, 'cray.writ.offered': true });
    talk(g, 'cray-customs', ['bribe-purse']);
    talk(g, 'mirela-stacks', ['ask-forge']);
    const said = talk(g, 'cray-customs', ['present-writ']);
    expect(said.join(' | ')).toMatch(/wrong side of the lamp/);
    expect(fact(g, 'cray.writ.rejected')).toBe(true);
    expect(g.host.itemCount(FORGED_WRIT)).toBe(0);
    expect(g.host.itemCount(CRATE_ITEM)).toBe(0);
    expect(fact(g, 'cray.disposition')).toBe('wary');
    expect(state(g, PAGES)).toBe('active');
    expect(fact(g, 'books.recovered')).toBe(false);
  });

  it('the strongroom route resolves from the thief event and Cray notices afterwards', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true });
    talk(g, 'nell-drowned-gull', ['ask-strongroom']);
    expect(fact(g, 'nell.strongroom-tip')).toBe(true);
    done(g, PAGES, 'reach-the-strongroom', 'lift-the-books');
    expect(resolution(g, PAGES)).toBe('strongroom-theft');
    expect(fact(g, 'books.method')).toBe('strongroom');
    expect(g.host.itemCount(CRATE_ITEM)).toBe(1);
    expect(fact(g, 'cray.disposition')).toBe('wary');
    expect(talk(g, 'cray-customs').join(' | ')).toMatch(/Someone has been in my strongroom/);
  });

  it('the inspector guise route: a passed guise recovers the books, a blown one leaves Cray wary', () => {
    const g = boot();
    startedBy(g, { 'books.impounded': true });
    done(g, PAGES, 'wear-the-coat');
    expect(resolution(g, PAGES)).toBe('inspector-guise');
    expect(fact(g, 'books.method')).toBe('guise');
    expect(g.host.itemCount(CRATE_ITEM)).toBe(1);
    const h = boot();
    startedBy(h, { 'books.impounded': true });
    done(h, PAGES, 'guise-blown');
    expect(h.runtime.stage(PAGES)).toBe('watched');
    expect(fact(h, 'cray.disposition')).toBe('wary');
    expect(h.host.disposition('npc-cray')).toBe(-3);
    expect(state(h, PAGES)).toBe('active');
    done(h, PAGES, 'lift-the-books');
    expect(resolution(h, PAGES)).toBe('strongroom-theft');
  });

  it("Mirela's book is delivered or kept, and she knows which", () => {
    const delivered = boot();
    set(delivered, { 'books.recovered': true });
    expect(offered(delivered, 'mirela-stacks')).not.toContain('deliver-order');
    delivered.host.giveItem(CRATE_ITEM, 1);
    talk(delivered, 'mirela-stacks', ['deliver-order']);
    expect(delivered.host.itemCount(CRATE_ITEM)).toBe(0);
    expect(fact(delivered, 'mirela.order.delivered')).toBe(true);
    expect(fact(delivered, 'mirela.illusion-stocked')).toBe(true);
    expect(delivered.host.gold()).toBe(80);
    expect(delivered.host.disposition('npc-mirela')).toBe(4);
    const kept = boot();
    set(kept, { 'books.recovered': true });
    kept.host.giveItem(CRATE_ITEM, 1);
    talk(kept, 'mirela-stacks', ['keep-order']);
    expect(kept.host.itemCount(CRATE_ITEM)).toBe(0);
    expect(fact(kept, 'mirela.order.kept')).toBe(true);
    expect(fact(kept, 'mirela.order.delivered')).toBe(false);
    expect(kept.host.disposition('npc-mirela')).toBe(-3);
    expect(offered(kept, 'mirela-stacks')).not.toContain('deliver-order');
    expect(offered(boot(), 'mirela-stacks')).not.toContain('deliver-order');
  });

  it('AC-4: every resolution puts the crate in the pack, and no route leaves a stand-in fact behind', ({
    task,
  }) => {
    for (const id of [CRATE_ITEM, VANE_WRIT, FORGED_WRIT, ROMANCE]) markExercised(task, 'item', id);
    for (const r of quests.pages.resolutions) {
      expect(JSON.stringify(r.effects), r.id).toContain(`"item":"${CRATE_ITEM}"`);
    }
    for (const key of ['writ.held', 'cray.romance-brought']) {
      expect(lookupFact(factIndex(content.all('fact')), key), key).toBeUndefined();
    }
  });

  it('Cray stays incorruptible: no new option takes a bribe', () => {
    const g = boot();
    const ids = offered(g, 'cray-customs');
    for (const id of ids) expect(id).not.toMatch(/^pay-/);
    const text = JSON.stringify(content.get('dialogue', 'cray-customs'));
    expect(text).not.toMatch(/"fact":"cray\.bribe\.attempted","value":false/);
  });
});
