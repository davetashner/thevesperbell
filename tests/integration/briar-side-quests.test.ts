// mw-e39.10: the Briar Glen side quests The Bookshop Burglar and The Captain's Boots as data, run through
// the real quest runtime and the real town dialogues (Mirela, Snig, Hale, Juniper, Dot) over the shipped
// content. Each test names the acceptance criterion it proves. AC-5 (each quest finished two different
// ways feels intentional, and neither way reads as a failure) is a manual playtest and awaits the owner.
// Event objectives and delivered items are completed through the runtime, as the harbour tests do; the
// bindings that listen for them are tested where they live.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import type { DialogueDef } from '@content/types/dialogue';
import type { QuestDef } from '@content/types/quest';
import { DialogueRuntime, type CheckResolver } from '@sim/dialogue/runtime';
import { declareFacts, QuestRuntime, validateQuestLogic, World } from '@sim/index';
import { MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';

const BURGLAR = 'quest-bookshop-burglar';
const BOOTS = 'quest-captains-boots';
const NPC_OF: Record<string, string> = {
  'mirela-stacks': 'npc-mirela',
  'snig-tunnels': 'npc-snig',
  'hale-watch': 'npc-hale',
  'juniper-fenn': 'npc-juniper',
  'dot-sleeping-ox': 'npc-dot',
};
const NIGHT = 23 * 60;
const SMALL_HOURS = 90;
const DAY = 10 * 60;
const content = loadGameContent();
const quests = {
  burglar: content.get('quest', BURGLAR) as unknown as QuestDef,
  boots: content.get('quest', BOOTS) as unknown as QuestDef,
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

const passes: CheckResolver = () => true;
const fails: CheckResolver = () => false;

function boot(options: { gold?: number; playerClass?: string; checks?: CheckResolver } = {}): Game {
  const world = new World({ seed: 10 });
  declareFacts(world.facts, content.all('fact'), { mode: 'throw' });
  if (options.playerClass !== undefined) world.facts.set('player.class', options.playerClass);
  const host = new WorldHost(world, { gold: options.gold ?? 0 });
  const runtime = new QuestRuntime({
    quests: content.all('quest') as never,
    facts: world.facts,
    host,
    events: world.events,
  });
  const dialogue = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
    checks: options.checks ?? passes,
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
const clock = (g: Game, minute: number): void => {
  g.host.minute = minute;
  // The clock is not announced, so the quest runtime polls for it every QUEST_POLL_TICKS.
  for (let i = 0; i < 30; i++) tick(g);
};
const fact = (g: Game, key: string) => g.world.facts.get(key);
const state = (g: Game, quest: string) => g.runtime.questState(quest);
const resolution = (g: Game, quest: string) => g.runtime.resolution(quest);
const stage = (g: Game, quest: string) => g.runtime.stage(quest);

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
/** The option ids a dialogue offers at its first choice (after its opening lines). */
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

/** Meets Snig in his tunnels (the stakeout is over) and takes the option that settles him. */
const meetSnig = (g: Game, ...picks: string[]): string[] => talk(g, 'snig-tunnels', picks);
/** A burglar quest that has reached the trail: told, sat up, and (as the player) the trail read. */
function toTheTrail(g: Game): void {
  talk(g, 'mirela-stacks', ['ask-books']);
  expect(state(g, BURGLAR)).toBe('active');
  expect(stage(g, BURGLAR)).toBe('stakeout');
  clock(g, NIGHT);
  talk(g, 'mirela-stacks', ['stake-follow']);
  expect(fact(g, 'burglar.staked-out')).toBe(true);
  expect(stage(g, BURGLAR)).toBe('trail');
  done(g, BURGLAR, 'read-the-shop-prints', 'follow-the-trail', 'find-snig');
  expect(stage(g, BURGLAR)).toBe('settle');
}

describe("The Bookshop Burglar and The Captain's Boots: data", () => {
  it('AC-1: both quests validate, every fact they name exists and each has at least 3 resolutions', ({
    task,
  }) => {
    markExercised(task, 'quest', BURGLAR);
    markExercised(task, 'quest', BOOTS);
    markExercised(task, 'fact', 'briar-side-quests');
    markExercised(task, 'note', 'note-ink-prints-stacks');
    markExercised(task, 'note', 'note-ink-prints-well');
    const known = factIndex(content.all('fact'));
    for (const q of [quests.burglar, quests.boots]) {
      expect(validateQuestLogic(q, referencesIn()), q.id).toEqual([]);
      const keys = [...JSON.stringify(q).matchAll(/"fact":"([^"]+)"/g)].map((m) => m[1] ?? '');
      for (const key of keys) expect(lookupFact(known, key), key).toBeDefined();
      expect(q.resolutions.length, q.id).toBeGreaterThanOrEqual(3);
    }
    expect(quests.burglar.resolutions.map((r) => r.id).sort()).toEqual([
      'deal',
      'light',
      'sold-book',
      'turned-in',
    ]);
    expect(quests.boots.resolutions.map((r) => r.id).sort()).toEqual([
      'bell-on-door',
      'follow-the-route',
      'tied-down',
      'wakeful-tea',
      'wrong-draught',
    ]);
  });

  it('are side quests: the main quest names neither', () => {
    const main = JSON.stringify(content.get('quest', 'quest-labyrinth-beneath-briar-glen'));
    expect(main).not.toContain(BURGLAR);
    expect(main).not.toContain(BOOTS);
  });

  it('place the two ink-footprint notes as readable spawns on Market Green, on the navmesh', () => {
    const scene = content.get('scene', 'briar-glen-green');
    const nav = content.get('navmesh', 'briar-glen-green');
    const [ox, oz] = nav.origin;
    const cell = nav.settings.cellSize;
    for (const [spawn, text] of [
      ['read-ink-prints-stacks', 'note-ink-prints-stacks'],
      ['read-ink-prints-well', 'note-ink-prints-well'],
    ] as const) {
      const found = scene.spawns.find((s) => s.id === spawn);
      expect(found?.tags).toEqual(['readable', text]);
      expect(found?.interact?.affordances[0]?.verb).toBe('read');
      const at = found?.at ?? [0, 0, 0];
      expect(
        nav.polys.some(
          (p) =>
            at[0] >= ox + p[0] * cell &&
            at[0] < ox + p[2] * cell &&
            at[2] >= oz + p[1] * cell &&
            at[2] < oz + p[3] * cell,
        ),
        spawn,
      ).toBe(true);
    }
    const stacks = scene.spawns.find((s) => s.id === 'lamplit-stacks')?.at ?? [0, 0, 0];
    const prints = scene.spawns.find((s) => s.id === 'read-ink-prints-stacks')?.at ?? [0, 0, 0];
    expect(Math.hypot(stacks[0] - prints[0], stacks[2] - prints[2])).toBeLessThan(5);
    const well = scene.spawns.find((s) => s.id === 'glen-well')?.at ?? [0, 0, 0];
    const wellPrints = scene.spawns.find((s) => s.id === 'read-ink-prints-well')?.at ?? [0, 0, 0];
    expect(Math.hypot(well[0] - wellPrints[0], well[2] - wellPrints[2])).toBeLessThan(5);
  });
});

describe('The Bookshop Burglar', () => {
  it('starts when Mirela asks for a night watch, and a thief taking her job starts it too', () => {
    const g = boot();
    expect(state(g, BURGLAR)).toBe('unstarted');
    const said = talk(g, 'mirela-stacks', ['ask-books']).join(' | ');
    expect(said).toMatch(/Eleven books in nine nights/);
    expect(said).toMatch(/Bum\. Left\. Bit\. Bum\./);
    expect(state(g, BURGLAR)).toBe('active');
    const thief = boot({ playerClass: 'thief' });
    talk(thief, 'mirela-stacks', ['job-thief', 'job-yes']);
    expect(state(thief, BURGLAR)).toBe('active');
  });

  it('the stakeout plays only at night once told, with Mirela, Mortimer and Snig speaking', () => {
    const g = boot();
    talk(g, 'mirela-stacks', ['ask-books']);
    clock(g, DAY);
    expect(talk(g, 'mirela-stacks').join(' ')).not.toMatch(/Hello, teeth/);
    clock(g, NIGHT);
    expect(offered(g, 'mirela-stacks')).toEqual(['stake-follow', 'stake-grab']);
    const said = talk(g, 'mirela-stacks', ['stake-grab']).join(' | ');
    expect(said).toMatch(/Hello, teeth/);
    expect(said).toMatch(/Mortimer/);
    expect(said).toMatch(/Ink\./);
    expect(fact(g, 'burglar.staked-out')).toBe(true);
    expect(fact(g, 'burglar.outcome')).toBe('open');
    expect(state(g, BURGLAR)).toBe('active');
  });

  it("AC-2: a deal sets goblins friendly and Snig's lessons, and gives the rare book", () => {
    const g = boot();
    toTheTrail(g);
    meetSnig(g, 'deal-offer');
    expect(fact(g, 'burglar.outcome')).toBe('deal');
    expect(state(g, BURGLAR)).toBe('active');
    talk(g, 'mirela-stacks', ['report-snig']);
    expect(fact(g, 'burglar.lessons-agreed')).toBe(true);
    expect(state(g, BURGLAR)).toBe('resolved');
    expect(resolution(g, BURGLAR)).toBe('deal');
    expect(fact(g, 'goblins.standing')).toBe('friendly');
    expect(fact(g, 'snig.lessons')).toBe(true);
    expect(g.host.itemCount('book-silence-of-goblins')).toBe(1);
    expect(meetSnig(g)[0]).toMatch(/I've been to the lessons/);
  });

  it('AC-2: a deal Snig turns down (the persuasion fails) is not a dead end', () => {
    const g = boot({ checks: fails });
    toTheTrail(g);
    meetSnig(g, 'deal-offer', 'caught-hale');
    expect(fact(g, 'burglar.outcome')).toBe('turned-in');
  });

  it('AC-2: turning Snig in to Hale sets goblins hostile, no lessons, and pays the bounty', () => {
    const g = boot();
    toTheTrail(g);
    meetSnig(g, 'caught-hale');
    expect(fact(g, 'burglar.outcome')).toBe('turned-in');
    expect(state(g, BURGLAR)).toBe('active');
    const said = talk(g, 'hale-watch').join(' | ');
    expect(said).toMatch(/oblin the size of a loaf/);
    expect(said).toMatch(/older than the Watch/);
    expect(fact(g, 'burglar.snig-jailed')).toBe(true);
    expect(resolution(g, BURGLAR)).toBe('turned-in');
    expect(fact(g, 'goblins.standing')).toBe('hostile');
    expect(fact(g, 'snig.lessons')).toBe(false);
    expect(g.host.gold()).toBe(20);
    talk(g, 'mirela-stacks', ['report-snig']);
    expect(fact(g, 'burglar.reported')).toBe(true);
  });

  it('AC-2: a thief selling Snig a book sets goblins neutral and no lessons', () => {
    const g = boot({ playerClass: 'thief' });
    talk(g, 'mirela-stacks', ['job-thief', 'job-yes']);
    clock(g, NIGHT);
    talk(g, 'mirela-stacks', ['stake-follow']);
    done(g, BURGLAR, 'find-snig');
    meetSnig(g, 'caught-sell-thief');
    expect(resolution(g, BURGLAR)).toBe('sold-book');
    expect(fact(g, 'goblins.standing')).toBe('neutral');
    expect(fact(g, 'snig.lessons')).toBe(false);
    const said = talk(g, 'mirela-stacks', ['report-snig']).join(' ');
    expect(said).toMatch(/professional courtesy/);
  });

  it("AC-2: a sorcerer's light in the Stacks ends it at once, and only a sorcerer is offered it", () => {
    for (const playerClass of ['knight', 'archer', 'thief']) {
      const g = boot({ playerClass });
      talk(g, 'mirela-stacks', ['ask-books']);
      clock(g, NIGHT);
      expect(offered(g, 'mirela-stacks'), playerClass).not.toContain('stake-light-sorcerer');
    }
    const g = boot({ playerClass: 'sorcerer' });
    talk(g, 'mirela-stacks', ['ask-books']);
    clock(g, NIGHT);
    const said = talk(g, 'mirela-stacks', ['stake-light-sorcerer']).join(' | ');
    expect(said).toMatch(/He's got a MOUTH\. On the INSIDE\./);
    expect(said).toMatch(/Is that a hat\?/);
    expect(resolution(g, BURGLAR)).toBe('light');
    expect(fact(g, 'goblins.standing')).toBe('neutral');
    expect(fact(g, 'snig.lessons')).toBe(false);
    expect(meetSnig(g)[0]).toMatch(/The scary one/);
    expect(talk(g, 'mirela-stacks', ['report-snig']).join(' ')).toMatch(
      /I do not wish to discuss the light/,
    );
  });

  it('AC-5: no resolution is written as a failure and all four can be reached from the same trail', () => {
    expect(quests.burglar.failures).toEqual([]);
    for (const r of quests.burglar.resolutions)
      expect(r.journal, r.id).not.toMatch(/\b(fail|failed|failure|lost)\b/i);
  });
});

describe("The Captain's Boots", () => {
  /** A quest started from Juniper and a night watched from the lane. */
  function followed(options: Parameters<typeof boot>[0] = {}): Game {
    const g = boot(options);
    talk(g, 'juniper-fenn', ['ask-hale']);
    expect(state(g, BOOTS)).toBe('active');
    expect(stage(g, BOOTS)).toBe('noticed');
    clock(g, SMALL_HOURS);
    talk(g, 'hale-watch', ['night-lane']);
    expect(fact(g, 'hale.night-followed')).toBe(true);
    clock(g, DAY);
    expect(stage(g, BOOTS)).toBe('followed');
    return g;
  }

  it('starts from the rumour (Dot), from Juniper, or from asking Hale about his boots', () => {
    const dot = boot({ gold: 10 });
    expect(state(dot, BOOTS)).toBe('unstarted');
    talk(dot, 'dot-sleeping-ox', ['ask-rumours', 'coin-pay']);
    expect(fact(dot, 'boots.noticed')).toBe(true);
    expect(state(dot, BOOTS)).toBe('active');
    const hale = boot();
    set(hale, { 'player.class': 'knight' });
    talk(hale, 'hale-watch', ['ask-boots']);
    expect(state(hale, BOOTS)).toBe('active');
    const juniper = boot();
    talk(juniper, 'juniper-fenn', ['ask-hale']);
    expect(state(juniper, BOOTS)).toBe('active');
  });

  it('the night scene needs the quest, the small hours and plays once; the cures wait for it', () => {
    const g = boot();
    clock(g, SMALL_HOURS);
    expect(talk(g, 'hale-watch').join(' ')).not.toMatch(/Door's open, Fitch/);
    talk(g, 'juniper-fenn', ['ask-hale']);
    clock(g, DAY);
    expect(offered(g, 'hale-watch')).not.toContain('tie-bed');
    expect(offered(g, 'hale-watch')).not.toContain('hang-bell');
    expect(offered(g, 'hale-watch')).not.toContain('keep-secret');
    clock(g, SMALL_HOURS);
    expect(offered(g, 'hale-watch')).toEqual(['night-route', 'night-lane', 'night-wake']);
    const said = talk(g, 'hale-watch', ['night-lane']).join(' | ');
    expect(said).toMatch(/Door's open, Fitch/);
    expect(said).toMatch(/Bell Line stones/);
    expect(offered(g, 'hale-watch')).not.toContain('night-lane');
  });

  it('AC-2: wakeful tea needs bellwort from the counter, then the choice who knows', () => {
    const g = followed();
    expect(offered(g, 'juniper-fenn')).not.toContain('bring-bellwort');
    g.host.giveItem('bellwort-root', 2);
    g.runtime.notifyItem('bellwort-root');
    tick(g);
    expect(g.runtime.objectiveState(BOOTS, 'buy-bellwort')).toBe('complete');
    talk(g, 'juniper-fenn', ['bring-bellwort']);
    expect(fact(g, 'juniper.tea-ready')).toBe(true);
    expect(g.host.itemCount('bellwort-root')).toBe(0);
    done(g, BOOTS, 'bring-bellwort');
    const said = talk(g, 'hale-watch', ['give-tea']).join(' | ');
    expect(said).toMatch(/It tastes of boots/);
    expect(said).toMatch(/I'd rather be useful/);
    expect(fact(g, 'boots.method')).toBe('tea');
    expect(state(g, BOOTS)).toBe('active');
    talk(g, 'hale-watch', ['keep-secret']);
    expect(resolution(g, BOOTS)).toBe('wakeful-tea');
    expect(fact(g, 'hale.sleepwalking.revealed')).toBe(true);
    expect(fact(g, 'hale.secret.kept')).toBe(true);
  });

  it('AC-4: with the secret kept, Hale backs the Act III testimony without a check', () => {
    const g = followed({ checks: fails });
    talk(g, 'hale-watch', ['hang-bell', 'keep-secret']);
    expect(resolution(g, BOOTS)).toBe('bell-on-door');
    expect(talk(g, 'hale-watch').join(' | ')).toMatch(/You kept it between us/);
    set(g, { 'tansy.saved': true });
    const said = talk(g, 'hale-watch', ['testify']).join(' | ');
    expect(said).toMatch(/I'll stand\./);
    expect(fact(g, 'hale.testimony.given')).toBe(true);
  });

  it('AC-4: with the town told, Hale loses authority and the testimony needs a check', () => {
    const g = followed({ checks: fails });
    talk(g, 'hale-watch', ['hang-bell']);
    const said = talk(g, 'dot-sleeping-ox', ['tell-dot', 'tell-all']).join(' | ');
    expect(said).toMatch(/It does get about/);
    expect(fact(g, 'hale.secret.exposed')).toBe(true);
    expect(fact(g, 'hale.secret.kept')).toBe(false);
    expect(resolution(g, BOOTS)).toBe('bell-on-door');
    set(g, { 'tansy.saved': true });
    expect(talk(g, 'hale-watch', ['testify']).join(' | ')).toMatch(/captain's arithmetic/);
    expect(fact(g, 'hale.testimony.given')).toBe(false);
    const wins = followed({ checks: passes });
    talk(wins, 'hale-watch', ['hang-bell']);
    talk(wins, 'dot-sleeping-ox', ['tell-dot', 'tell-all']);
    set(wins, { 'tansy.saved': true });
    talk(wins, 'hale-watch', ['testify']);
    expect(fact(wins, 'hale.testimony.given')).toBe(true);
  });

  it('AC-2: tying him down needs his consent, which a waking at night earns', () => {
    const g = boot();
    talk(g, 'juniper-fenn', ['ask-hale']);
    clock(g, SMALL_HOURS);
    const said = talk(g, 'hale-watch', ['night-wake']).join(' | ');
    expect(said).toMatch(/I tie my laces to the bedpost/);
    expect(fact(g, 'hale.boots.confessed')).toBe(true);
    clock(g, DAY);
    talk(g, 'hale-watch', ['tie-bed']);
    expect(fact(g, 'hale.tied-consent')).toBe(true);
    expect(fact(g, 'boots.method')).toBe('tied');
    talk(g, 'hale-watch', ['keep-secret']);
    expect(resolution(g, BOOTS)).toBe('tied-down');
  });

  it('AC-2: walking his route behind him reveals the Briarwood shortcut', () => {
    const g = boot();
    talk(g, 'juniper-fenn', ['ask-hale']);
    clock(g, SMALL_HOURS);
    talk(g, 'hale-watch', ['night-route']);
    expect(fact(g, 'hale.route-followed')).toBe(true);
    expect(fact(g, 'route.briarwood.revealed')).toBe(false);
    clock(g, DAY);
    done(g, BOOTS, 'learn-the-route');
    talk(g, 'hale-watch', ['route-plan', 'keep-secret']);
    expect(resolution(g, BOOTS)).toBe('follow-the-route');
    expect(fact(g, 'route.briarwood.revealed')).toBe(true);
  });

  it('AC-3: the sleep draught sends Hale walking at nightfall, and the quest stays completable', () => {
    const g = followed({ gold: 20 });
    talk(g, 'juniper-fenn', ['ask-sleep-draught', 'sd-buy']);
    expect(fact(g, 'juniper.draught-sold')).toBe(true);
    expect(g.host.gold()).toBe(12);
    talk(g, 'hale-watch', ['give-draught']);
    expect(fact(g, 'hale.draught')).toBe('sleep');
    expect(fact(g, 'boots.method')).toBe('sleep');
    tick(g);
    expect(stage(g, BOOTS)).toBe('followed');
    expect(fact(g, 'hale.walked-in')).toBe(false);
    clock(g, NIGHT);
    expect(stage(g, BOOTS)).toBe('walked-in');
    expect(fact(g, 'hale.walked-in')).toBe(true);
    expect(state(g, BOOTS)).toBe('active');
    expect(g.runtime.objectiveState(BOOTS, 'bring-hale-home')).toBe('active');
    clock(g, DAY);
    const said = talk(g, 'hale-watch').join(' | ');
    expect(said).toMatch(/Juniper's draught, was it/);
    expect(said).toMatch(/barred gate/);
    expect(fact(g, 'hale.retrieved')).toBe(true);
    expect(fact(g, 'hale.walked-in')).toBe(false);
    expect(fact(g, 'hale.draught')).toBe('none');
    expect(stage(g, BOOTS)).toBe('followed');
    expect(state(g, BOOTS)).toBe('active');
    talk(g, 'hale-watch', ['keep-secret']);
    expect(resolution(g, BOOTS)).toBe('wrong-draught');
    expect(state(g, BOOTS)).toBe('resolved');
  });

  it('AC-3: after being fetched home he can still be settled another way', () => {
    const g = followed({ gold: 20 });
    talk(g, 'juniper-fenn', ['ask-sleep-draught', 'sd-buy']);
    talk(g, 'hale-watch', ['give-draught']);
    clock(g, NIGHT);
    clock(g, DAY);
    talk(g, 'hale-watch');
    expect(offered(g, 'hale-watch')).not.toContain('give-draught');
    talk(g, 'hale-watch', ['hang-bell']);
    expect(fact(g, 'boots.method')).toBe('bell');
    talk(g, 'dot-sleeping-ox', ['tell-dot', 'tell-never']);
    expect(state(g, BOOTS)).toBe('active');
    talk(g, 'hale-watch', ['keep-secret']);
    expect(resolution(g, BOOTS)).toBe('bell-on-door');
  });

  it('Juniper warns about the draught when she has confessed what it does, and still sells it', () => {
    const g = followed({ gold: 20 });
    set(g, { 'juniper.draught-confessed': true });
    const said = talk(g, 'juniper-fenn', ['ask-sleep-draught', 'sd-buy']).join(' | ');
    expect(said).toMatch(/They sleep deeper/);
    expect(fact(g, 'juniper.draught-sold')).toBe(true);
  });

  it('AC-5: no resolution is written as a failure', () => {
    expect(quests.boots.failures).toEqual([]);
    for (const r of quests.boots.resolutions)
      expect(r.journal, r.id).not.toMatch(/\b(fail|failed|failure|lost)\b/i);
  });
});
