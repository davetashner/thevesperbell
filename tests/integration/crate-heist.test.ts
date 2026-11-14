// mw-e39.21: the Wendmouth side quest The Crate for Mr. S— as quest data, run through the real
// quest runtime over the real game content. Each test names the acceptance criterion it proves.
// AC-6 (a thief's playtest rates the undetected heist at least as satisfying as the watchtower
// fight) is a manual playtest and awaits the owner; it is not automated here.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import type { DialogueDef } from '@content/types/dialogue';
import type { QuestDef } from '@content/types/quest';
import { DialogueRuntime } from '@sim/dialogue/runtime';
import { declareFacts, QuestRuntime, validateQuestLogic, World } from '@sim/index';
import { MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';

const QUEST = 'quest-crate-for-mr-s';
const MAIN = 'quest-labyrinth-beneath-briar-glen';
const content = loadGameContent();
const quest = content.get('quest', QUEST) as unknown as QuestDef;

class WorldHost extends MemoryLogicHost {
  constructor(private readonly world: World) {
    super({ capabilities: [] });
    Object.defineProperty(this, 'facts', { value: world.facts });
  }

  override setFact(key: string, value: boolean | number | string): undefined {
    this.world.facts.set(key, value);
    return undefined;
  }
}

interface Game {
  readonly world: World;
  readonly runtime: QuestRuntime;
}

function boot(): Game {
  const world = new World({ seed: 21 });
  declareFacts(world.facts, content.all('fact'), { mode: 'throw' });
  const runtime = new QuestRuntime({
    quests: content.all('quest') as never,
    facts: world.facts,
    host: new WorldHost(world),
    events: world.events,
  });
  return { world, runtime };
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
const done = (g: Game, ...objectives: string[]): void => {
  for (const objective of objectives) {
    expect(g.runtime.completeObjective(QUEST, objective), objective).toBeUndefined();
    tick(g);
  }
};
const fact = (g: Game, key: string) => g.world.facts.get(key);
const state = (g: Game) => g.runtime.questState(QUEST);
const resolution = (g: Game) => g.world.facts.get(`quest.${QUEST}.resolution`);

/** A game with the quest started by Nell telling the player about bay nine. */
function started(): Game {
  const g = boot();
  expect(state(g)).toBe('unstarted');
  set(g, { 'nell.bay-nine-told': true });
  expect(state(g)).toBe('active');
  return g;
}

const ROUTES: { id: string; method: string; steps: string[]; facts?: Record<string, boolean> }[] = [
  {
    id: 'ballast-swap',
    method: 'heist',
    steps: ['open-bay-nine', 'swap-for-ballast', 'reseal-the-crate'],
  },
  {
    id: 'paper-seizure',
    method: 'paper',
    steps: ['cray-seizes-the-crate'],
    facts: { 'cray.seizure.agreed': true },
  },
  { id: 'net-cut', method: 'net', steps: ['cut-the-net', 'fish-it-out'] },
  { id: 'force', method: 'force', steps: ['win-the-brawl'] },
  { id: 'ice-or-gust', method: 'ice', steps: ['divert-the-crate'] },
  {
    id: 'leverage-on-quell',
    method: 'leverage',
    steps: ['collect-from-quell'],
    facts: { 'quell.crate-access': true },
  },
];

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

describe('The Crate for Mr. S—: data', () => {
  it('AC-1: validates, exposes at least five resolutions and each one sets crate.method', ({
    task,
  }) => {
    markExercised(task, 'quest', QUEST);
    expect(validateQuestLogic(quest, referencesIn())).toEqual([]);
    expect(quest.resolutions.length).toBeGreaterThanOrEqual(5);
    for (const r of quest.resolutions) {
      const methods = (r.effects ?? []).filter(
        (e) => e.kind === 'setFact' && e['fact'] === 'crate.method',
      );
      expect(methods.length, r.id).toBe(1);
    }
    const approaches = new Set(quest.resolutions.map((r) => r.approach));
    for (const a of ['stealth', 'diplomacy', 'combat', 'magic', 'trickery'])
      expect(approaches.has(a as never), a).toBe(true);
    const keys = [...JSON.stringify(quest).matchAll(/"fact":"([^"]+)"/g)].map((m) => m[1] ?? '');
    const known = factIndex(content.all('fact'));
    for (const key of keys) expect(lookupFact(known, key), key).toBeDefined();
  });

  it('is a side quest: it never writes tern.sailed or a main-quest fact other than the harbour ones', () => {
    const written = [...JSON.stringify(quest).matchAll(/"setFact","fact":"([^"]+)"/g)].map(
      (m) => m[1] ?? '',
    );
    expect(written).not.toContain('tern.sailed');
    expect(written).toContain('crate.intercepted');
    const mainFacts = new Set(content.get('fact', 'main-quest').facts.map((f) => f.key));
    for (const key of written)
      if (mainFacts.has(key)) expect(['crate.intercepted'], key).toContain(key);
    expect(JSON.stringify(content.get('quest', MAIN))).not.toContain(QUEST);
  });
});

describe('The Crate for Mr. S—: start and stages', () => {
  it('starts on any harbour lead, and not before', () => {
    for (const lead of [
      'nell.bay-nine-told',
      'mags.crates-confessed',
      'cray.bay-nine.suspicion',
      'quell.collapsed',
    ]) {
      const g = boot();
      set(g, { 'player.class': 'thief' });
      expect(state(g), lead).toBe('unstarted');
      set(g, { [lead]: true });
      expect(state(g), lead).toBe('active');
      // Cray's suspicion already points at a way in, so it skips the rumour.
      expect(g.runtime.stage(QUEST), lead).toBe(
        lead === 'cray.bay-nine.suspicion' ? 'plan' : 'rumour',
      );
    }
  });

  it('moves from the rumour to the plan once the player casing, a lead or a route is under way', () => {
    for (const step of [
      'case-the-warehouse',
      'visit-the-undertow',
      'cut-the-net',
      'open-bay-nine',
    ]) {
      const g = started();
      done(g, step);
      expect(g.runtime.stage(QUEST), step).toBe('plan');
    }
    const g = started();
    set(g, { 'cray.seizure.agreed': true });
    expect(g.runtime.stage(QUEST)).toBe('plan');
  });
});

describe('The Crate for Mr. S—: resolutions', () => {
  for (const route of ROUTES) {
    it(`${route.method}: ${route.id} takes the crate, writes the outcome facts and sets crate.method`, () => {
      const g = started();
      if (route.facts) set(g, route.facts);
      expect(state(g)).toBe('active');
      for (const step of route.steps) {
        expect(state(g), step).toBe('active');
        done(g, step);
      }
      expect(state(g)).toBe('resolved');
      expect(resolution(g)).toBe(route.id);
      expect(fact(g, 'crate.method')).toBe(route.method);
      expect(fact(g, 'crate.intercepted')).toBe(true);
      expect(fact(g, 'namestone.obtained')).toBe(true);
      expect(fact(g, 'horn.name-stone-held')).toBe(true);
      expect(fact(g, 'manifest.honest.obtained')).toBe(true);
      expect(fact(g, 'tern.sailed')).toBe(false);
    });
  }

  it('a route needs its own steps: legal seizure needs Cray, leverage needs Quell', () => {
    const g = started();
    done(g, 'cray-seizes-the-crate', 'collect-from-quell');
    expect(state(g)).toBe('active');
    set(g, { 'cray.seizure.agreed': true });
    expect(resolution(g)).toBe('paper-seizure');
  });

  it('AC-2: an undetected heist leaves no alarm or Low Tide hostility, and the Tern then sails with ballast', () => {
    const g = started();
    set(g, { 'player.class': 'thief' });
    done(g, 'case-the-warehouse', 'open-bay-nine', 'swap-for-ballast', 'reseal-the-crate');
    expect(resolution(g)).toBe('ballast-swap');
    expect(fact(g, 'heist.undetected')).toBe(true);
    expect(fact(g, 'tern.sails-with-ballast')).toBe(true);
    // Act III begins: the main quest writes tern.sailed.
    set(g, { 'tern.sailed': true });
    expect(fact(g, 'tern.sailed')).toBe(true);
    expect(fact(g, 'crate.intercepted')).toBe(true);
    expect(fact(g, 'heist.alarm')).toBe(false);
    expect(fact(g, 'lowtide.standing')).toBe('neutral');
    expect(fact(g, 'cray.arrival.flagged')).toBe(false);
    expect(fact(g, 'crate.method')).toBe('heist');
    expect(resolution(g)).toBe('ballast-swap');
  });

  it('a heist with the alarm raised still takes the crate but is not undetected', () => {
    const g = started();
    set(g, { 'heist.alarm': true });
    done(g, 'swap-for-ballast', 'reseal-the-crate');
    expect(resolution(g)).toBe('ballast-swap-spotted');
    expect(fact(g, 'crate.method')).toBe('heist');
    expect(fact(g, 'heist.undetected')).toBe(false);
    expect(fact(g, 'lowtide.standing')).toBe('neutral');
  });

  it("AC-3: force makes the Low Tide Company hostile and flags Cray's arrival", () => {
    const g = started();
    done(g, 'win-the-brawl');
    expect(fact(g, 'crate.method')).toBe('force');
    expect(fact(g, 'lowtide.standing')).toBe('hostile');
    expect(fact(g, 'cray.arrival.flagged')).toBe(true);
    expect(fact(g, 'heist.alarm')).toBe(true);
    expect(fact(g, 'heist.undetected')).toBe(false);
  });

  it("AC-4: the name-stone offers Horn's befriend branch on the first meeting", () => {
    const g = started();
    done(g, 'cut-the-net', 'fish-it-out');
    expect(fact(g, 'namestone.obtained')).toBe(true);
    for (const facts of [{ 'namestone.obtained': true }, { 'horn.name-stone-held': true }]) {
      const host = new MemoryLogicHost({
        playerClass: 'thief',
        facts: { 'horn.fate': 'alive', 'horn.rescues': 0, 'abbot.fate': 'unresolved', ...facts },
      });
      const dialogue = new DialogueRuntime({
        world: new World<never>({ seed: 1, hz: 60 }),
        host,
        dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
      });
      let view = dialogue.start('horn-warden', 'npc-horn');
      const said: string[] = [];
      for (let i = 0; view.kind === 'line' && i < 80; i++) {
        said.push(view.text);
        view = dialogue.advance();
      }
      expect(said.join(' | ')).toMatch(/That is her name/);
      expect(host.facts.get('horn.befriended')).toBe(true);
    }
  });

  it('AC-5: Act III before the crate is taken resolves the quest as sailed and the customs copy stays obtainable', () => {
    const g = started();
    done(g, 'case-the-warehouse');
    set(g, { 'tern.sailed': true });
    expect(state(g)).toBe('resolved');
    expect(resolution(g)).toBe('sailed');
    expect(fact(g, 'crate.method')).toBe('sailed');
    expect(fact(g, 'crate.intercepted')).toBe(false);
    expect(fact(g, 'manifest.customs-copy.obtainable')).toBe(true);
    expect(fact(g, 'namestone.obtained')).toBe(false);
    expect(content.has('note', 'note-cargo-manifest')).toBe(true);
    // The main quest is unaffected: it writes tern.sailed itself and reads no harbour fact to advance.
    expect(fact(g, 'quest.' + MAIN + '.state')).toBe('unstarted');
  });

  it('once the Tern has sailed the crate can no longer be taken', () => {
    const g = boot();
    set(g, { 'tern.sailed': true, 'nell.bay-nine-told': true });
    expect(state(g)).toBe('resolved');
    expect(resolution(g)).toBe('sailed');
    expect(g.runtime.completeObjective(QUEST, 'win-the-brawl')).toBeDefined();
    expect(fact(g, 'lowtide.standing')).toBe('neutral');
    expect(fact(g, 'namestone.obtained')).toBe(false);
  });
});
