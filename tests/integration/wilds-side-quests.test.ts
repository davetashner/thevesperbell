// mw-e39.11: the wilderness and dungeon side quests The Watch Still Stands, Framed in Brass and The Name
// on the Bones as data, run through the real quest runtime and the real dialogues (the Sentinels, Dot,
// Kettleback, Vane, Clatter, Hollis, Juniper, the Abbot) over the shipped content. Each test names the
// acceptance criterion it proves. Event objectives are completed through the runtime and readables
// through the facts the reader writes, as the other side quest suites do; the bindings that listen for
// them are tested where they live.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import type { DialogueDef } from '@content/types/dialogue';
import type { QuestDef } from '@content/types/quest';
import { DialogueRuntime, type CheckResolver } from '@sim/dialogue/runtime';
import { declareFacts, QuestRuntime, validateQuestLogic, World } from '@sim/index';
import { MemoryLogicHost, type LogicRefChecker } from '@sim/logic/index';

const WATCH = 'quest-watch-still-stands';
const FRAMED = 'quest-framed-in-brass';
const BONES = 'quest-name-on-the-bones';
const NPC_OF: Record<string, string> = {
  'sentinel-watch': 'npc-hollow-sentinel',
  'dot-sleeping-ox': 'npc-dot',
  'kettleback-kitchen': 'npc-kettleback',
  'duggan-testimony': 'npc-duggan',
  'vane-bounty': 'npc-vane',
  'clatter-garden': 'npc-clatter',
  'hollis-pell': 'npc-hollis',
  'juniper-fenn': 'npc-juniper',
  'abbot-cradle': 'npc-abbot',
};
const content = loadGameContent();
const quests = {
  watch: content.get('quest', WATCH) as unknown as QuestDef,
  framed: content.get('quest', FRAMED) as unknown as QuestDef,
  bones: content.get('quest', BONES) as unknown as QuestDef,
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

const sentinels = (g: Game, ...picks: string[]): string[] => talk(g, 'sentinel-watch', picks);
const tellClatter = (g: Game, ...picks: string[]): string[] => talk(g, 'clatter-garden', picks);
/** Hollis lends the Bible (or a thief lifts it): the letter is a real item and the fact records it. */
const LETTER = 'letter-anselm-hobb';
function lend(g: Game): void {
  g.host.giveItem(LETTER, 1);
  set(g, { 'hollis.bible-lent': true });
}
/** Gives Clatter the three pieces (psalter, pear, letter) through the real dialogue. */
function giveAllThree(g: Game): void {
  lend(g);
  set(g, { 'evidence.clatter-psalter': true, 'bones.pear-bloomed': true });
  tellClatter(g, 'give-psalter', 'give-pear', 'give-letter');
}

describe('The Watch Still Stands, Framed in Brass and The Name on the Bones: data', () => {
  it('AC-1: the three quests validate, every fact they name exists and each has at least 3 resolutions', ({
    task,
  }) => {
    for (const id of [WATCH, FRAMED, BONES]) markExercised(task, 'quest', id);
    markExercised(task, 'fact', 'wilds-side-quests');
    markExercised(task, 'creature', 'npc-hollow-sentinel');
    markExercised(task, 'dialogue', 'sentinel-watch');
    markExercised(task, 'note', 'note-keepers-last-leaf');
    markExercised(task, 'note', 'note-clatter-psalter');
    const known = factIndex(content.all('fact'));
    for (const q of [quests.watch, quests.framed, quests.bones]) {
      expect(validateQuestLogic(q, referencesIn()), q.id).toEqual([]);
      const keys = [...JSON.stringify(q).matchAll(/"fact":"([^"]+)"/g)].map((m) => m[1] ?? '');
      for (const key of keys) expect(lookupFact(known, key), key).toBeDefined();
      expect(q.resolutions.length, q.id).toBeGreaterThanOrEqual(3);
    }
    expect(quests.watch.resolutions.map((r) => r.id).sort()).toEqual([
      'bell-cord',
      'dispel',
      'formal-relief',
      'smashed',
      'unseen',
      'watchword',
    ]);
    expect(quests.framed.resolutions.map((r) => r.id).sort()).toEqual([
      'by-force',
      'kettle-trade',
      'planting-kit',
      'talked-out',
    ]);
    expect(quests.bones.resolutions.map((r) => r.id).sort()).toEqual([
      'joins-you',
      'rest-at-altar',
      'rest-with-rites',
    ]);
  });

  it('are side quests: the main quest names none of them', () => {
    const main = JSON.stringify(content.get('quest', 'quest-labyrinth-beneath-briar-glen'));
    for (const id of [WATCH, FRAMED, BONES]) expect(main).not.toContain(id);
  });

  it('place the three readables on their scenes, on the navmesh, and tag the texts they read', () => {
    const onMesh = (sceneId: string, spawnId: string): void => {
      const scene = content.get('scene', sceneId);
      const nav = content.get('navmesh', sceneId);
      const [ox, oz] = nav.origin;
      const cell = nav.settings.cellSize;
      const found = scene.spawns.find((s) => s.id === spawnId);
      expect(found?.tags, spawnId).toContain('readable');
      expect(found?.interact?.affordances[0]?.verb, spawnId).toBe('read');
      const at = found?.at ?? [0, 0, 0];
      expect(
        nav.polys.some(
          (p) =>
            at[0] >= ox + p[0] * cell &&
            at[0] < ox + p[2] * cell &&
            at[2] >= oz + p[1] * cell &&
            at[2] < oz + p[3] * cell,
        ),
        spawnId,
      ).toBe(true);
    };
    onMesh('moorings-watch', 'read-keepers-last-leaf');
    onMesh('moorings-watch', 'keepers-log');
    onMesh('knot-outer', 'read-clatter-psalter');
    onMesh('deepworks', 'ledger');
    const tags = (scene: string, id: string) =>
      content.get('scene', scene).spawns.find((s) => s.id === id)?.tags;
    expect(tags('moorings-watch', 'read-keepers-last-leaf')).toContain('note-keepers-last-leaf');
    expect(tags('knot-outer', 'read-clatter-psalter')).toContain('note-clatter-psalter');
    expect(tags('deepworks', 'ledger')).toContain('book-deepworks-ledger');
  });
});

describe('The Watch Still Stands', () => {
  it("starts when Dot tells the rumour of Old Mooring, or the keeper's last leaf is read", () => {
    const g = boot();
    expect(state(g, WATCH)).toBe('unstarted');
    const said = talk(g, 'dot-sleeping-ox', ['ask-rumours', 'ask-mooring']).join(' | ');
    expect(said).toMatch(/Old Mooring never left his tower/);
    expect(fact(g, 'watch.told')).toBe(true);
    expect(state(g, WATCH)).toBe('active');
    const leaf = boot();
    set(leaf, { 'evidence.keepers-last-leaf': true });
    expect(state(leaf, WATCH)).toBe('active');
    expect(stage(leaf, WATCH)).toBe('word-known');
  });

  it('AC-2: only a knight is offered the formal relief at the Sentinels, and only a knight can resolve it so', () => {
    const options = (cls: string): string[] =>
      offered(boot({ playerClass: cls }), 'sentinel-watch').filter((id) =>
        ['relieve-knight', 'shoot-cord', 'dispel', 'sneak', 'smash'].includes(id),
      );
    expect(options('knight')).toEqual(['relieve-knight', 'smash']);
    expect(options('archer')).toEqual(['shoot-cord', 'smash']);
    expect(options('sorcerer')).toEqual(['dispel', 'smash']);
    expect(options('thief')).toEqual(['sneak', 'smash']);
    const knight = boot({ playerClass: 'knight' });
    set(knight, { 'watch.told': true });
    sentinels(knight, 'relieve-knight');
    expect(fact(knight, 'sentinels.method')).toBe('knight');
    expect(resolution(knight, WATCH)).toBe('formal-relief');
    // The resolution itself is class-gated: the same fact with another class resolves nothing.
    const archer = boot({ playerClass: 'archer' });
    set(archer, { 'watch.told': true, 'sentinels.method': 'knight', 'sentinels.relieved': true });
    expect(state(archer, WATCH)).toBe('active');
  });

  it('the watchword works for any class once the last leaf is read, and not before', () => {
    const g = boot({ playerClass: 'archer' });
    set(g, { 'watch.told': true });
    expect(offered(g, 'sentinel-watch')).toContain('no-word');
    expect(offered(g, 'sentinel-watch')).not.toContain('say-word');
    set(g, { 'evidence.keepers-last-leaf': true });
    expect(offered(g, 'sentinel-watch')).toContain('say-word');
    expect(offered(g, 'sentinel-watch')).not.toContain('no-word');
    sentinels(g, 'say-word', 'word-relief');
    expect(resolution(g, WATCH)).toBe('watchword');
    expect(fact(g, 'sentinels.relieved')).toBe(true);
    expect(fact(g, 'moorings.safe-base')).toBe(true);
    expect(fact(g, 'watch.key-held')).toBe(true);
    expect(fact(g, 'watch.mirror-held')).toBe(true);
    expect(sentinels(g).join(' ')).toMatch(/post is relieved|resting/);
  });

  it.each([
    ['archer', 'shoot-cord', 'bell-cord'],
    ['sorcerer', 'dispel', 'dispel'],
    ['knight', 'smash', 'smashed'],
  ])('a %s settling it with %s resolves %s and the tower is a safe base', (cls, pick, resolved) => {
    const g = boot({ playerClass: cls });
    set(g, { 'watch.told': true });
    sentinels(g, pick);
    expect(resolution(g, WATCH)).toBe(resolved);
    expect(fact(g, 'sentinels.relieved')).toBe(true);
    expect(fact(g, 'moorings.safe-base')).toBe(true);
    expect(fact(g, 'watch.key-held')).toBe(true);
  });

  it('a thief walks past unseen: the Sentinels keep their post, so there is no safe base', () => {
    const g = boot({ playerClass: 'thief' });
    set(g, { 'watch.told': true });
    sentinels(g, 'sneak');
    expect(resolution(g, WATCH)).toBe('unseen');
    expect(fact(g, 'sentinels.relieved')).toBe(false);
    expect(fact(g, 'moorings.safe-base')).toBe(false);
    expect(fact(g, 'watch.key-held')).toBe(true);
    expect(fact(g, 'watch.mirror-held')).toBe(true);
    expect(sentinels(g).join(' ')).toMatch(/draught/);
  });
});

describe('Framed in Brass', () => {
  const kettle = (g: Game, ...picks: string[]): string[] => talk(g, 'kettleback-kitchen', picks);
  const vane = (g: Game, ...picks: string[]): string[] => talk(g, 'vane-bounty', picks);

  it('starts when the player finds Duggan in his crate, with the proof still to find', () => {
    const g = boot();
    expect(state(g, FRAMED)).toBe('unstarted');
    kettle(g, 'ask-duggan', 'duggan-back');
    expect(fact(g, 'framed.crate-found')).toBe(true);
    expect(state(g, FRAMED)).toBe('active');
    expect(stage(g, FRAMED)).toBe('hunt');
    const quell = boot();
    set(quell, { 'evidence.foundry-invoice': true });
    expect(state(quell, FRAMED)).toBe('active');
  });

  it('Duggan is got four ways, each written as framed.method', () => {
    const ways: [string, string[], string, Record<string, boolean>][] = [
      ['persuade', ['ask-duggan', 'duggan-persuade'], 'freed', {}],
      ['trade', ['ask-duggan', 'duggan-kettle'], 'freed', { 'kettleback.kettle-brought': true }],
      ['kit', ['ask-duggan', 'duggan-kit', 'duggan-back'], 'crated', {}],
      ['force', ['ask-duggan', 'duggan-force'], 'freed', {}],
    ];
    for (const [method, picks, crate, init] of ways) {
      const g = boot();
      set(g, init);
      kettle(g, ...picks);
      expect(fact(g, 'framed.method'), method).toBe(method);
      expect(fact(g, 'duggan.crate'), method).toBe(crate);
      expect(stage(g, FRAMED), method).toBe('hunt-proof');
    }
    const forced = boot();
    kettle(forced, 'ask-duggan', 'duggan-force');
    expect(fact(forced, 'goblins.standing')).toBe('hostile');
    expect(offered(forced, 'kettleback-kitchen')).toContain('parley-persuade');
  });

  it('AC-3: with the ledger and Duggan freed, the confrontation exposes Vane and the quest sets vane.exposed', () => {
    const g = boot();
    kettle(g, 'ask-duggan', 'duggan-persuade');
    talk(g, 'duggan-testimony', ['ask-testify']);
    expect(fact(g, 'duggan.testimony')).toBe(true);
    expect(stage(g, FRAMED)).toBe('hunt-proof');
    set(g, { 'evidence.vane-ledger': true });
    expect(fact(g, 'vane.ledger.obtained')).toBe(true);
    expect(stage(g, FRAMED)).toBe('confront');
    expect(fact(g, 'vane.exposed')).toBe(false);
    vane(g, 'confront', 'confront-expose');
    expect(fact(g, 'vane.fate')).toBe('exposed');
    expect(fact(g, 'vane.exposed')).toBe(true);
    expect(fact(g, 'framed.undeniable')).toBe(false);
    expect(resolution(g, FRAMED)).toBe('talked-out');
  });

  it("Quell's foundry invoice makes it undeniable, and is never required", () => {
    const g = boot();
    set(g, { 'evidence.foundry-invoice': true, 'evidence.vane-ledger': true });
    kettle(g, 'ask-duggan', 'duggan-kit', 'duggan-back');
    expect(stage(g, FRAMED)).toBe('confront');
    vane(g, 'confront', 'confront-expose');
    expect(fact(g, 'vane.exposed')).toBe(true);
    expect(fact(g, 'framed.undeniable')).toBe(true);
    expect(resolution(g, FRAMED)).toBe('planting-kit');
  });

  it('the planting kit is proof enough: it unlocks the confrontation as a witness', () => {
    const g = boot();
    set(g, { 'vane.ledger.obtained': true });
    expect(offered(g, 'vane-bounty')).toContain('confront');
    kettle(g, 'ask-duggan', 'duggan-kit', 'duggan-back');
    expect(fact(g, 'duggan.kit-taken')).toBe(true);
    g.dialogue.start('vane-bounty', 'npc-vane');
    for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance());
    const confront = g.dialogue.choices().findIndex((c) => c.id === 'confront');
    expect(g.dialogue.choose(confront).ok).toBe(true);
    for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance());
    expect(g.dialogue.choices().map((c) => c.id)).toContain('confront-expose');
    g.dialogue.abort();
  });

  it.each([
    ['confront-confess', 'confessed', true],
    ['confront-bribe', 'bribed-player', false],
    ['confront-flee', 'fled', false],
  ])("Vane's fate %s (%s) resolves the quest; vane.exposed is %s", (pick, fate, exposed) => {
    const g = boot();
    set(g, { 'framed.crate-found': true });
    set(g, { 'evidence.vane-ledger': true, 'duggan.testimony': true, 'duggan.crate': 'freed' });
    set(g, { 'framed.method': 'trade' });
    vane(g, 'confront', pick);
    expect(fact(g, 'vane.fate')).toBe(fate);
    expect(fact(g, 'vane.exposed')).toBe(exposed);
    expect(resolution(g, FRAMED)).toBe('kettle-trade');
  });

  it('by force is a way too: the goblins stay hostile and Vane still has to answer', () => {
    const g = boot();
    set(g, { 'evidence.vane-ledger': true });
    kettle(g, 'ask-duggan', 'duggan-force');
    set(g, { 'duggan.testimony': true });
    vane(g, 'confront', 'confront-expose');
    expect(resolution(g, FRAMED)).toBe('by-force');
    expect(fact(g, 'goblins.standing')).toBe('hostile');
  });
});

/** The Abbot's hub in the Cradle, with any temptation turned down. */
function cradleOptions(g: Game): string[] {
  set(g, { 'abbot.in-cradle': true });
  g.dialogue.start('abbot-cradle', 'npc-abbot');
  for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance());
  const refuse = g.dialogue.choices().find((c) => c.id.endsWith('-no'));
  if (refuse !== undefined) {
    g.dialogue.choose(g.dialogue.choices().findIndex((c) => c.id === refuse.id));
    for (let view = g.dialogue.view; view?.kind === 'line'; view = g.dialogue.advance());
  }
  const ids = g.dialogue.choices().map((c) => c.id);
  g.dialogue.abort();
  return ids;
}

describe('The Name on the Bones', () => {
  it('starts when the player meets Clatter, and the first meeting sets clatter.met', () => {
    const g = boot();
    expect(state(g, BONES)).toBe('unstarted');
    tellClatter(g);
    expect(fact(g, 'clatter.met')).toBe(true);
    expect(state(g, BONES)).toBe('active');
    expect(stage(g, BONES)).toBe('gather');
  });

  it('three pieces in any order each lift his memories by one, and the third gives him his name', () => {
    const g = boot();
    tellClatter(g);
    lend(g);
    tellClatter(g, 'give-letter');
    expect(fact(g, 'clatter.memories')).toBe(1);
    set(g, { 'bones.pear-bloomed': true });
    tellClatter(g, 'give-pear');
    expect(fact(g, 'clatter.memories')).toBe(2);
    expect(stage(g, BONES)).toBe('gather');
    expect(fact(g, 'clatter.restored')).toBe(false);
    set(g, { 'evidence.clatter-psalter': true });
    const said = tellClatter(g, 'give-psalter').join(' | ');
    expect(said).toMatch(/Brother Anselm Hobb, who tended the pears/);
    expect(fact(g, 'clatter.memories')).toBe(3);
    tick(g);
    expect(stage(g, BONES)).toBe('remembered');
    expect(fact(g, 'clatter.restored')).toBe(true);
    expect(fact(g, 'tansy.kin.known')).toBe(true);
    expect(tellClatter(g, 'restored-name').join(' ')).toMatch(/well-oiled one/);
  });

  it('Juniper grafts the pear tree once he has told you about it, and a thief can take the letter', () => {
    const g = boot();
    expect(offered(g, 'juniper-fenn')).not.toContain('ask-pear');
    set(g, { 'clatter.met': true });
    expect(offered(g, 'juniper-fenn')).toContain('ask-pear');
    talk(g, 'juniper-fenn', ['ask-pear']);
    expect(fact(g, 'bones.pear-bloomed')).toBe(true);
    const thief = boot({ playerClass: 'thief' });
    const said = talk(thief, 'hollis-pell', ['steal-bible-grief']).join(' | ');
    expect(said).toMatch(/thought he heard a stair/);
    expect(fact(thief, 'hollis.bible-lent')).toBe(true);
    expect(fact(thief, 'bones.letter-stolen')).toBe(true);
    expect(thief.host.disposition('npc-hollis')).toBe(-3);
    expect(thief.host.itemCount(LETTER)).toBe(1);
    expect(offered(boot(), 'hollis-pell')).not.toContain('steal-bible-grief');
  });

  it('AC-6: the letter is a real item, given by Hollis (lent or lifted) and taken by Clatter, not a stand-in fact', () => {
    expect(content.get('item', LETTER).category).toBe('quest');
    const g = boot();
    talk(g, 'hollis-pell', ['ask-bible']);
    expect(g.host.itemCount(LETTER)).toBe(1);
    expect(fact(g, 'hollis.bible-lent')).toBe(true);
    // The fact alone is not the letter: without the item Clatter has nothing to read.
    const bare = boot();
    set(bare, { 'hollis.bible-lent': true });
    expect(offered(bare, 'clatter-garden')).not.toContain('give-letter');
    expect(offered(g, 'clatter-garden')).toContain('give-letter');
    tellClatter(g, 'give-letter');
    expect(g.host.itemCount(LETTER)).toBe(0);
    expect(fact(g, 'bones.letter-given')).toBe(true);
  });

  it('AC-7: Clatter, the bloom and the altar offering are placed; the bloom and offering follow the facts', () => {
    const outer = content.get('scene', 'knot-outer');
    const npc = outer.spawns.find((s) => s.id === 'npc-clatter');
    expect(npc?.creature?.id).toBe('npc-clatter');
    const garden = outer.spawns.find((s) => s.id === 'clatter-garden')?.at ?? [0, 0, 0];
    const at = npc?.at ?? [0, 0, 0];
    expect(Math.hypot(at[0] - garden[0], at[2] - garden[2])).toBeLessThan(4);
    const nav = content.get('navmesh', 'knot-outer');
    const [ox, oz] = nav.origin;
    const cell = nav.settings.cellSize;
    expect(
      nav.polys.some(
        (p) =>
          at[0] >= ox + p[0] * cell &&
          at[0] < ox + p[2] * cell &&
          at[2] >= oz + p[1] * cell &&
          at[2] < oz + p[3] * cell,
      ),
    ).toBe(true);
    const priory = content.get('scene', 'bellwater-priory').spawns;
    const tree = priory.find((s) => s.id === 'dead-pear-tree')?.at;
    const bloom = priory.find((s) => s.id === 'pear-tree-bloom');
    expect(bloom?.at).toEqual(tree);
    expect(bloom?.spawnIf).toEqual({ fact: 'bones.pear-bloomed' });
    const psalter = priory.find((s) => s.id === 'choir-altar-psalter');
    expect(psalter?.spawnIf).toEqual({ fact: 'bones.psalter-given' });
    const altar = priory.find((s) => s.id === 'choir-altar')?.at ?? [0, 0, 0];
    expect(
      Math.hypot((psalter?.at[0] ?? 0) - altar[0], (psalter?.at[2] ?? 0) - altar[2]),
    ).toBeLessThan(2);
  });

  it("AC-5: after he is restored the join or rest choice is Clatter's, written as clatter.fate and read by the Cradle", () => {
    const g = boot();
    giveAllThree(g);
    tick(g);
    expect(fact(g, 'clatter.restored')).toBe(true);
    tellClatter(g, 'join-ask');
    expect(fact(g, 'clatter.fate')).toBe('joined');
    expect(resolution(g, BONES)).toBe('joins-you');
    // The Cradle's abbot reads it: Clatter's Persuade is offered once he has joined.
    expect(cradleOptions(g)).toContain('persuade');
    const rested = boot();
    giveAllThree(rested);
    tick(rested);
    tellClatter(rested, 'rest-ask');
    expect(cradleOptions(rested)).not.toContain('persuade');
  });

  it("resting is the other right answer: the knight's rites or the psalter on the priory altar", () => {
    const knight = boot({ playerClass: 'knight' });
    giveAllThree(knight);
    tick(knight);
    tellClatter(knight, 'rest-ask');
    expect(fact(knight, 'clatter.fate')).toBe('rested');
    expect(fact(knight, 'clatter.rites')).toBe(true);
    expect(resolution(knight, BONES)).toBe('rest-with-rites');
    const archer = boot({ playerClass: 'archer' });
    giveAllThree(archer);
    tick(archer);
    tellClatter(archer, 'rest-ask');
    expect(fact(archer, 'clatter.rites')).toBe(false);
    expect(resolution(archer, BONES)).toBe('rest-at-altar');
  });

  it("a sorcerer's successful reading skips a piece: two pieces and a reading are enough", () => {
    const g = boot({ playerClass: 'sorcerer' });
    tellClatter(g, 'read-sorcerer');
    expect(fact(g, 'clatter.read-success')).toBe(true);
    expect(fact(g, 'clatter.memories')).toBe(1);
    lend(g);
    set(g, { 'evidence.clatter-psalter': true });
    tellClatter(g, 'give-psalter', 'give-letter');
    expect(fact(g, 'clatter.memories')).toBe(3);
    tick(g);
    expect(fact(g, 'clatter.restored')).toBe(true);
  });

  it('AC-4: a failed memory-reading costs one memory and lowers the maximum by exactly one, and the quest stays completable', () => {
    const g = boot({ playerClass: 'sorcerer', checks: fails });
    lend(g);
    tellClatter(g, 'give-letter');
    expect(fact(g, 'clatter.memories')).toBe(1);
    expect(fact(g, 'clatter.memories.max')).toBe(3);
    tellClatter(g, 'read-sorcerer');
    expect(fact(g, 'clatter.read-success')).toBe(false);
    expect(fact(g, 'clatter.memories.max')).toBe(2);
    expect(fact(g, 'clatter.memories')).toBe(0);
    expect(stage(g, BONES)).toBe('lost-one');
    expect(state(g, BONES)).toBe('active');
    expect(offered(g, 'clatter-garden')).not.toContain('read-sorcerer');
    set(g, { 'evidence.clatter-psalter': true, 'bones.pear-bloomed': true });
    tellClatter(g, 'give-psalter', 'give-pear');
    expect(fact(g, 'clatter.memories')).toBe(2);
    tick(g);
    expect(stage(g, BONES)).toBe('remembered');
    expect(fact(g, 'clatter.restored')).toBe(true);
    tellClatter(g, 'rest-ask');
    expect(state(g, BONES)).toBe('resolved');
    expect(fact(g, 'clatter.memories.max')).toBe(2);
  });

  it("the restored Clatter's name carries into the epilogue: he is restored and Tansy is family", () => {
    const slide = JSON.stringify(
      content
        .all('narration')
        .flatMap((n) => JSON.stringify(n))
        .filter((s) => s.includes('vr-clatter-name')),
    );
    expect(slide).toContain('clatter.restored');
    expect(slide).toContain('Tansy Pell carries a loaf');
    const g = boot();
    giveAllThree(g);
    tick(g);
    expect(fact(g, 'clatter.restored')).toBe(true);
    expect(fact(g, 'tansy.kin.known')).toBe(true);
  });
});
