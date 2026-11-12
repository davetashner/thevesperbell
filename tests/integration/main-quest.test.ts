// mw-e39.4: the main quest The Labyrinth Beneath Briar Glen and its epilogue, as quest data, run
// through the real quest runtime over the real game content (facts, NPCs, objectives). Each test
// names the acceptance criterion it proves. AC-8 (beats 1 to 16 play in order per class, no missing
// objective text) is a manual narrative-designer playthrough and is not automated here.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import type { QuestDef } from '@content/types/quest';
import { declareFacts, QuestRuntime, validateQuestLogic, World } from '@sim/index';
import { evaluateLogic, MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';

const MAIN = 'quest-labyrinth-beneath-briar-glen';
const EPILOGUE = 'quest-briar-glen-epilogue';
const content = loadGameContent();
const main = content.get('quest', MAIN) as unknown as QuestDef;
const epilogue = content.get('quest', EPILOGUE) as unknown as QuestDef;

/** The memory host reading the world's facts, so conditions see what the sim holds. */
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
  const world = new World({ seed: 11 });
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
    expect(g.runtime.completeObjective(MAIN, objective), objective).toBeUndefined();
    tick(g);
  }
};
const stage = (g: Game) => g.runtime.stage(MAIN);
const fact = (g: Game, key: string) => g.world.facts.get(key);

const HUB: Record<string, Record<string, boolean>> = {
  'hales-list': { 'hale.list.shared': true },
  'mirelas-hymn': { 'mirela.hours.lent': true },
  'dots-rumours': { 'dot.trinket.confessed': true },
  'junipers-path': { 'world.sleepers-path.revealed': true },
};
const ROUTES = [
  'front-gate',
  'side-boarding',
  'winch-cage',
  'inner-bar',
  'supply-tunnel',
  'weeping-adit',
] as const;

/** A fresh game with the quest started and walked through the first night to the hub. */
function toHub(): Game {
  const g = boot();
  expect(g.runtime.questState(MAIN)).toBe('unstarted');
  set(g, { 'player.class': 'archer' });
  expect(g.runtime.questState(MAIN)).toBe('unstarted');
  set(g, { 'briar-glen.arrived': true });
  expect(g.runtime.questState(MAIN)).toBe('active');
  expect(stage(g)).toBe('first-night');
  done(g, 'see-the-horned-shape');
  expect(stage(g)).toBe('morning');
  done(g, 'hear-the-bounty');
  expect(stage(g)).toBe('investigation');
  return g;
}

function toDeepworks(route: (typeof ROUTES)[number] = 'front-gate'): Game {
  const g = toHub();
  set(g, Object.assign({}, ...Object.values(HUB)) as Record<string, boolean>);
  expect(stage(g)).toBe('getting-in');
  done(g, `enter-by-${route}`);
  expect(stage(g)).toBe('deepworks');
  return g;
}

/** Through the Warden with `horn` facts: the quest is in Act III, at the second reveal. */
function toActIII(horn: Record<string, boolean | string>): Game {
  const g = toDeepworks();
  done(g, 'enter-the-knot', 'reach-the-ossuary', 'reach-horns-hall');
  expect(stage(g)).toBe('warden');
  set(g, horn);
  expect(stage(g)).toBe('second-reveal');
  return g;
}

const DEAD = { 'horn.fate': 'dead', 'horn.defeated': true };
const BEFRIENDED = { 'horn.befriended': true };

/** From the second reveal to the Cradle and through the abbot: the quest is choosing a climb. */
function throughAbbot(g: Game, abbot = 'defeated'): void {
  done(g, 'hear-the-friend-below', 'reach-the-cradle');
  set(g, { 'abbot.fate': abbot });
}

const sorted = (values: Iterable<string>) => [...values].sort();
const activeSlides = (g: Game) =>
  sorted(
    g.runtime
      .activeObjectives()
      .filter((a) => a.quest === EPILOGUE)
      .map((a) => a.objective.id),
  );

/** Conditions and effects of both quests, as one list of logic nodes with where they came from. */
function logicNodes(quest: QuestDef): { at: string; node: unknown; required: boolean }[] {
  const nodes: { at: string; node: unknown; required: boolean }[] = [];
  const add = (at: string, node: unknown, required = true) => {
    if (node !== undefined) nodes.push({ at, node, required });
  };
  add('startWhen', quest.startWhen);
  for (const s of quest.stages) {
    for (const t of s.transitions) {
      add(`${s.id}->${t.stage}`, t.when);
      for (const e of t.effects ?? []) add(`${s.id}->${t.stage} effect`, e, false);
    }
  }
  for (const r of quest.resolutions) add(`resolution ${r.id}`, r.when);
  for (const o of quest.objectives) {
    add(`objective ${o.id} activeWhen`, o.activeWhen);
  }
  return nodes;
}
const factsRead = (node: unknown): string[] => {
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n !== null && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if ((o['kind'] === 'fact' || o['kind'] === 'factCmp') && typeof o['fact'] === 'string')
        found.push(o['fact']);
      Object.values(o).forEach(walk);
    }
  };
  walk(node);
  return found;
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

describe('main quest: data', () => {
  it('AC-1: the quests validate with zero errors and every referenced fact is registered', ({
    task,
  }) => {
    markExercised(task, 'quest', MAIN);
    markExercised(task, 'quest', EPILOGUE);
    for (const quest of [main, epilogue]) {
      expect(validateQuestLogic(quest, referencesIn()), quest.id).toEqual([]);
      const keys = [
        ...logicNodes(quest).flatMap(({ node }) => factsRead(node)),
        ...quest.objectives.flatMap((o) => (o.kind === 'fact' ? [o.params.fact] : [])),
      ];
      const known = factIndex(content.all('fact'));
      for (const key of keys) expect(lookupFact(known, key), key).toBeDefined();
    }
    expect(main.stages.map((s) => s.id)).toContain('getting-in');
  });

  it('reuses the registered keys the story names: bell-tongue.destroyed, horn.fate, vane.fate', () => {
    const written = main.stages.flatMap((s) =>
      s.transitions.flatMap((t) => (t.effects ?? []).map((e) => String(e['fact']))),
    );
    expect(written).toContain('bell-tongue.destroyed');
    expect(written).toContain('deepworks.route');
    expect(written).toContain('tern.sailed');
    // Vane's fate is written by his dialogue, never by the quest.
    const quests = JSON.stringify([main, epilogue]);
    expect(quests).not.toMatch(/"setFact","fact":"vane\.fate"/);
  });

  it('Wendmouth is optional: no required objective, transition or ending rule reads a harbour fact', () => {
    const harbour =
      /^(wendmouth|crate|tern|mags|nell|cray|evidence|quell|tereza|hesketh|reed|commission)\.|^horn\.name-stone-held$/;
    for (const { at, node, required } of logicNodes(main)) {
      if (!required) continue;
      for (const key of factsRead(node)) expect(key, at).not.toMatch(harbour);
    }
    for (const o of main.objectives) {
      if (o.kind === 'fact' && harbour.test(o.params.fact)) {
        expect(o.optional, o.id).toBe(true);
        expect(o.stage, o.id).toBeUndefined();
      }
    }
  });
});

describe('main quest: start', () => {
  it('a new game does not start the quest or write any quest fact; arrival does', () => {
    const g = boot();
    set(g, { 'player.class': 'knight' });
    expect(g.runtime.questState(MAIN)).toBe('unstarted');
    expect(g.world.facts.entries('quest.').length).toBe(0);
    set(g, { 'briar-glen.arrived': true });
    expect(g.runtime.questState(MAIN)).toBe('active');
  });
});

describe('main quest: stages', () => {
  it('AC-3: the hub completes in any order and advances to Getting in identically', () => {
    const orders = [
      ['hales-list', 'mirelas-hymn', 'dots-rumours', 'junipers-path'],
      ['junipers-path', 'dots-rumours', 'mirelas-hymn', 'hales-list'],
      ['dots-rumours', 'hales-list', 'junipers-path', 'mirelas-hymn'],
    ];
    const snapshots = orders.map((order) => {
      const g = toHub();
      order.forEach((thread, i) => {
        expect(stage(g), `before ${thread}`).toBe('investigation');
        set(g, HUB[thread] ?? {});
        expect(g.runtime.objectiveState(MAIN, thread)).toBe('complete');
        expect(stage(g) === 'getting-in', `after ${thread}`).toBe(i === order.length - 1);
      });
      return JSON.stringify(
        main.objectives.map((o) => [o.id, g.runtime.objectiveState(MAIN, o.id)]),
      );
    });
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
  });

  it('a player who skips the hub and goes to the mine is not left behind', () => {
    const g = toHub();
    done(g, 'enter-by-supply-tunnel');
    expect(stage(g)).toBe('deepworks');
    const early = boot();
    set(early, { 'player.class': 'thief', 'briar-glen.arrived': true });
    expect(early.runtime.stage(MAIN)).toBe('first-night');
    expect(early.runtime.completeObjective(MAIN, 'enter-by-weeping-adit')).toBeUndefined();
    tick(early);
    expect(early.runtime.stage(MAIN)).toBe('deepworks');
    expect(fact(early, 'deepworks.route')).toBe('weeping-adit');
  });

  it('the first night ends with the next day even if the shape was never seen', () => {
    const g = boot();
    set(g, { 'player.class': 'knight', 'briar-glen.arrived': true });
    expect(stage(g)).toBe('first-night');
    set(g, { 'time.day': 2 });
    expect(stage(g)).toBe('morning');
    set(g, { 'hale.list.shared': true });
    expect(stage(g)).toBe('investigation');
  });

  it.each(ROUTES)('AC-4: entering by %s completes Getting in and records the route', (route) => {
    const g = toHub();
    set(g, Object.assign({}, ...Object.values(HUB)) as Record<string, boolean>);
    expect(stage(g)).toBe('getting-in');
    expect(fact(g, 'deepworks.route')).toBe('none');
    done(g, `enter-by-${route}`);
    expect(stage(g)).toBe('deepworks');
    expect(fact(g, 'deepworks.route')).toBe(route);
    expect(g.runtime.questState(MAIN)).toBe('active');
  });

  it('the six routes match the route matrix mine entries', () => {
    const entries = main.objectives.filter((o) => o.id.startsWith('enter-by-')).map((o) => o.id);
    expect(sorted(entries)).toEqual(sorted(ROUTES.map((r) => `enter-by-${r}`)));
  });

  it.each([
    ['kill', DEAD],
    ['spare', { 'horn.spared': true }],
    ['trick', { 'horn.tricked': true }],
    ['befriend', BEFRIENDED],
    ['help', { 'horn.befriended': true, 'horn.helped': true }],
    ['Trial of Horns', { 'horn.trial-won': true, 'horn.befriended': true }],
  ])('each Warden resolution (%s) opens Act III, and Horn yielding alone does not', (_, horn) => {
    const g = toDeepworks();
    done(g, 'reach-horns-hall');
    set(g, { 'horn.defeated': true });
    expect(stage(g)).toBe('warden');
    set(g, horn);
    expect(stage(g)).toBe('second-reveal');
    expect(fact(g, 'tern.sailed')).toBe(true);
  });

  it('AC-5: with Horn killed the Climb uses the goblins, else Clatter, else the chase', () => {
    const cases: [string, Record<string, string | boolean>, string][] = [
      ['goblins', { 'goblins.standing': 'friendly' }, 'climb-with-goblins'],
      ['Clatter', { 'clatter.restored': true }, 'climb-with-clatter'],
      [
        'both: goblins first',
        { 'goblins.standing': 'friendly', 'clatter.restored': true },
        'climb-with-goblins',
      ],
      [
        'hostile goblins, Clatter restored',
        { 'goblins.standing': 'hostile', 'clatter.restored': true },
        'climb-with-clatter',
      ],
      ['nobody', {}, 'climb-chased'],
    ];
    for (const [name, facts, variant] of cases) {
      const g = toActIII(DEAD);
      set(g, facts);
      throughAbbot(g);
      expect(stage(g), name).toBe(variant);
      expect(fact(g, 'horn.at-shaft'), name).toBe(false);
    }
  });

  it('AC-5: every Climb variant, the chase included, reaches the bell and an ending (no soft-lock)', () => {
    for (const variant of ['with-horn', 'with-goblins', 'with-clatter', 'chased']) {
      const g = toActIII(variant === 'with-horn' ? BEFRIENDED : DEAD);
      set(
        g,
        variant === 'with-goblins'
          ? { 'goblins.standing': 'friendly' }
          : variant === 'with-clatter'
            ? { 'clatter.restored': true }
            : {},
      );
      throughAbbot(g);
      expect(stage(g)).toBe(`climb-${variant}`);
      done(g, `climb-the-shaft-${variant}`);
      expect(stage(g)).toBe('vespers');
      set(g, { 'bell.rung': 'sour' });
      expect(stage(g)).toBe('vespers');
      set(g, { 'bell.rung': 'rung' });
      expect(stage(g)).toBe('morning-after');
      done(g, 'return-to-briar-glen');
      expect(g.runtime.questState(MAIN)).toBe('active');
      set(g, { 'bounty.outcome': 'paid' });
      expect(g.runtime.questState(MAIN)).toBe('resolved');
    }
  });

  it('a Horn who lives and can hold the shaft does, and a spared Horn needs healing first', () => {
    const holds = toActIII(BEFRIENDED);
    throughAbbot(holds);
    expect(stage(holds)).toBe('climb-with-horn');
    expect(fact(holds, 'horn.at-shaft')).toBe(true);

    const unhealed = toActIII({ 'horn.spared': true });
    throughAbbot(unhealed);
    expect(stage(unhealed)).toBe('climb-chased');

    const healed = toActIII({ 'horn.spared': true, 'horn.healed': true });
    throughAbbot(healed);
    expect(stage(healed)).toBe('climb-with-horn');
  });

  it('AC-6: Act III begins with the crate not intercepted: the Tern sails and nothing waits on Wendmouth', () => {
    const g = toActIII(DEAD);
    expect(fact(g, 'crate.intercepted')).toBe(false);
    expect(fact(g, 'wendmouth.visited')).toBe(false);
    expect(fact(g, 'tern.sailed')).toBe(true);
    throughAbbot(g);
    done(g, 'climb-the-shaft-chased');
    set(g, { 'bell.rung': 'rung' });
    done(g, 'return-to-briar-glen');
    set(g, { 'vane.fate': 'exposed' });
    expect(g.runtime.resolution(MAIN)).toBe('the-last-warden');
    const intercepted = toActIII({ ...DEAD, 'horn.defeated': true });
    expect(fact(intercepted, 'tern.sailed')).toBe(true);
  });

  it.each(['at-rest', 'defeated'])(
    'AC-7: Tansy not stopped: the Cradle is the hostage variant and the abbot can still be %s',
    (abbot) => {
      const g = toActIII(BEFRIENDED);
      expect(fact(g, 'tansy.saved')).toBe(false);
      done(g, 'hear-the-friend-below', 'reach-the-cradle');
      expect(stage(g)).toBe('cradle-hostage');
      expect(g.runtime.objectiveState(MAIN, 'free-tansy')).toBe('active');
      set(g, { 'abbot.fate': abbot });
      expect(stage(g)).toBe('climb-with-horn');
    },
  );

  it('AC-7: the hostage Cradle still ends in the Long Vespers if the player joins the abbot', () => {
    const g = toActIII(BEFRIENDED);
    done(g, 'reach-the-cradle');
    expect(stage(g)).toBe('cradle-hostage');
    set(g, { 'abbot.fate': 'joined' });
    expect(g.runtime.resolution(MAIN)).toBe('long-vespers');
  });

  it('AC-7: Tansy stopped in time gives the plain Cradle', () => {
    const g = toActIII(BEFRIENDED);
    set(g, { 'tansy.saved': true });
    done(g, 'reach-the-cradle');
    expect(stage(g)).toBe('cradle');
  });

  it('a destroyed tongue sets bell-tongue.destroyed and waits for the recast before the Climb', () => {
    const g = toActIII(DEAD);
    done(g, 'tongue-destroyed');
    expect(fact(g, 'bell-tongue.destroyed')).toBe(false);
    throughAbbot(g);
    expect(stage(g)).toBe('recast');
    expect(fact(g, 'bell-tongue.destroyed')).toBe(true);
    set(g, { 'oswin.recast-commissioned': true });
    expect(g.runtime.objectiveState(MAIN, 'commission-the-recast')).toBe('complete');
    expect(stage(g)).toBe('recast');
    done(g, 'collect-the-recast');
    expect(stage(g)).toBe('climb-chased');
    const horn = toActIII(BEFRIENDED);
    done(horn, 'tongue-destroyed');
    throughAbbot(horn, 'at-rest');
    done(horn, 'collect-the-recast');
    expect(stage(horn)).toBe('climb-with-horn');
  });
});

describe('main quest: endings', () => {
  /** A game just before the ending: the bell rung, back in town, Vane answered. */
  function atTheEnd(facts: Record<string, boolean | string>): Game {
    const g = toActIII(DEAD);
    set(g, { 'horn.fate': 'alive', ...facts });
    return g;
  }
  const FACT_SETS: [string, string, Record<string, boolean | string>][] = [
    ['vespers-rung', 'vespers-rung', { 'horn.fate': 'alive', 'vane.fate': 'exposed' }],
    ['the-last-warden', 'last-warden', { 'horn.fate': 'dead', 'vane.fate': 'confessed' }],
    [
      'hirelings-silence',
      'hirelings-silence',
      { 'horn.fate': 'dead', 'vane.fate': 'bribed-player' },
    ],
    ['long-vespers', 'long-vespers', { 'abbot.fate': 'joined' }],
  ];

  it.each(FACT_SETS)(
    'AC-2: %s is reachable, with wendmouth.visited false throughout',
    (resolution, headline, facts) => {
      const g = boot();
      set(g, { 'player.class': 'sorcerer', 'briar-glen.arrived': true, ...facts });
      if (resolution !== 'long-vespers') {
        done(g, 'return-to-briar-glen');
        set(g, { 'bell.rung': 'rung' });
      }
      expect(g.runtime.questState(MAIN)).toBe('resolved');
      expect(g.runtime.resolution(MAIN)).toBe(resolution);
      expect(fact(g, 'ending.headline')).toBe(headline);
      expect(fact(g, 'wendmouth.visited')).toBe(false);
      expect(g.runtime.questState(EPILOGUE)).toBe('active');
    },
  );

  it('AC-2: failing to ring the bell is the Long Vespers too', () => {
    const g = atTheEnd({ 'bell.rung': 'failed' });
    expect(g.runtime.resolution(MAIN)).toBe('long-vespers');
  });

  it('AC-2: every fact set maps to exactly one ending, or to none while the story is unfinished', () => {
    const g = boot();
    set(g, { 'player.class': 'knight', 'briar-glen.arrived': true });
    expect(g.runtime.completeObjective(MAIN, 'return-to-briar-glen')).toBeUndefined();
    const host = g.runtime.host;
    const holding = () =>
      main.resolutions.filter((r) => evaluateLogic(r.when as never, host)).map((r) => r.id);
    let seen = new Set<string>();
    for (const horn of ['alive', 'dead'])
      for (const abbot of ['unresolved', 'at-rest', 'defeated', 'joined'])
        for (const vane of ['unexposed', 'exposed', 'confessed', 'bribed-player', 'fled'])
          for (const bell of ['unrung', 'sour', 'rung', 'failed'])
            for (const bounty of ['unsettled', 'paid']) {
              g.world.facts.transaction(() => {
                g.world.facts.set('horn.fate', horn);
                g.world.facts.set('abbot.fate', abbot);
                g.world.facts.set('vane.fate', vane);
                g.world.facts.set('bell.rung', bell);
                g.world.facts.set('bounty.outcome', bounty);
              });
              const ids = holding();
              const lost = abbot === 'joined' || bell === 'failed';
              const ready = bell === 'rung' && (vane !== 'unexposed' || bounty !== 'unsettled');
              const label = [horn, abbot, vane, bell, bounty].join('/');
              if (lost) expect(ids, label).toEqual(['long-vespers']);
              else if (!ready) expect(ids, label).toEqual([]);
              else expect(ids, label).toHaveLength(1);
              ids.forEach((id) => (seen = seen.add(id)));
            }
    expect(sorted(seen)).toEqual(
      sorted(['long-vespers', 'hirelings-silence', 'the-last-warden', 'vespers-rung']),
    );
  });

  it('the headline ending never depends on a harbour fact', () => {
    const harbour = ['wendmouth.visited', 'crate.intercepted', 'tern.sailed'];
    const g = boot();
    set(g, { 'player.class': 'thief', 'briar-glen.arrived': true });
    for (const r of main.resolutions) {
      for (const key of harbour) expect(factsRead(r.when), r.id).not.toContain(key);
    }
    expect(g.runtime.questState(MAIN)).toBe('active');
  });
});

describe('main quest: epilogue slides', () => {
  const finish = (facts: Record<string, boolean | string>): Game => {
    const g = boot();
    set(g, { 'player.class': 'archer', 'briar-glen.arrived': true, ...facts });
    if (facts['abbot.fate'] !== 'joined') {
      done(g, 'return-to-briar-glen');
      set(g, { 'bell.rung': 'rung' });
    }
    expect(g.runtime.questState(MAIN)).toBe('resolved');
    return g;
  };

  it('Vespers Rung: the bell is rung by the goblins, else Hale, else Tansy; sealing and speaking add slides', () => {
    const base = { 'horn.fate': 'alive', 'vane.fate': 'exposed' };
    expect(activeSlides(finish(base))).toEqual(['vr-bell-tansy', 'vr-bread-at-the-gate']);
    expect(activeSlides(finish({ ...base, 'hale.testimony.given': true }))).toEqual([
      'vr-bell-hale',
      'vr-bread-at-the-gate',
    ]);
    expect(
      activeSlides(
        finish({
          ...base,
          'goblins.standing': 'friendly',
          'hale.testimony.given': true,
          'knot.breach-sealed': true,
          'horn.spoken-for': true,
        }),
      ),
    ).toEqual(['vr-bell-goblins', 'vr-bread-at-the-gate', 'vr-new-verse', 'vr-song-sealed']);
  });

  it('The Last Warden: goblins keep watch, else Clatter hums, else a lantern and footprints', () => {
    const base = { 'horn.fate': 'dead', 'vane.fate': 'confessed' };
    expect(activeSlides(finish({ ...base, 'goblins.standing': 'friendly' }))).toEqual([
      'lw-goblins-watch',
      'lw-sleepers-home',
    ]);
    expect(activeSlides(finish({ ...base, 'clatter.restored': true }))).toEqual([
      'lw-clatter-hums',
      'lw-sleepers-home',
    ]);
    expect(activeSlides(finish(base))).toEqual(['lw-lantern-and-footprints', 'lw-sleepers-home']);
  });

  it("The Hireling's Silence and The Long Vespers have their own slides", () => {
    expect(activeSlides(finish({ 'horn.fate': 'dead', 'vane.fate': 'bribed-player' }))).toEqual([
      'hs-silver-from-below',
      'hs-someone-sits-up',
    ]);
    expect(activeSlides(finish({ 'abbot.fate': 'joined' }))).toEqual(['lv-wake-in-the-cradle']);
  });

  it('harbour facts only add slides: the crate intercepted, or the Tern sailed with it', () => {
    const base = { 'horn.fate': 'alive', 'vane.fate': 'exposed' };
    const sailed = finish({ ...base, 'tern.sailed': true });
    expect(activeSlides(sailed)).toContain('harbor-tern-ox');
    expect(sailed.runtime.resolution(MAIN)).toBe('vespers-rung');
    const home = finish({ ...base, 'tern.sailed': true, 'crate.intercepted': true });
    expect(activeSlides(home)).toContain('harbor-name-stone-home');
    expect(activeSlides(home)).not.toContain('harbor-tern-ox');
    expect(home.runtime.resolution(MAIN)).toBe('vespers-rung');
  });

  it('the epilogue quest closes when the slideshow finishes', () => {
    const g = finish({ 'horn.fate': 'alive', 'vane.fate': 'exposed' });
    set(g, { 'epilogue.finished': true });
    expect(g.runtime.questState(EPILOGUE)).toBe('resolved');
  });
});
