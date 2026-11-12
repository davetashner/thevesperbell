// mw-e39.7: Brother Horn's dialogue (horn-warden), played by the real DialogueRuntime against the shipped
// content. Each AC names its test; conversations use a MemoryLogicHost so the facts, items and
// disposition they change are visible.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { gameContentSources, loadGameContent } from '@content/index';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime, type DialogueView } from '@sim/dialogue/runtime';
import type { DialogueDef } from '@content/types/dialogue';
import { main } from '../../src/tools/dialogue/cli';

const content = loadGameContent();
const HORN = 'horn-warden';
const CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

// MemoryLogicHost has no registry, so the registered defaults the dialogue compares against are given here.
const DEFAULT_FACTS = {
  'horn.fate': 'alive',
  'horn.rescues': 0,
  'abbot.fate': 'unresolved',
  'goblins.standing': 'neutral',
};

function session(init: ConstructorParameters<typeof MemoryLogicHost>[0] = {}) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost({ ...init, facts: { ...DEFAULT_FACTS, ...init.facts } });
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const start = (): DialogueView => runtime.start(HORN, 'npc-horn');
  const settle = (): DialogueView => {
    let view = runtime.view;
    for (let i = 0; view?.kind === 'line' && i < 60; i++) view = runtime.advance();
    return view ?? { kind: 'ended', reason: 'completed' };
  };
  const ids = (): string[] => runtime.choices().map((c) => c.id);
  const pick = (id: string): DialogueView => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok, id).toBe(true);
    return settle();
  };
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  const text = (): string => {
    const view = runtime.view;
    return view?.kind === 'line' ? view.text : '';
  };
  /** Starts and reads everything up to the first choice (or the end); returns the whole thing said. */
  const play = (): string => {
    start();
    return lines().join(' | ');
  };
  /** Chooses an option and returns what he says before the next choice. */
  const ask = (id: string): string => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok, id).toBe(true);
    return lines().join(' | ');
  };
  const fact = (key: string): unknown => host.facts.get(key);
  return { world, host, runtime, start, settle, ids, pick, lines, text, play, ask, fact };
}

const TRIGGERS: { fact: string; says: RegExp }[] = [
  { fact: 'horn.hymn-hummed', says: /Vespers\./ },
  { fact: 'horn.ring-held', says: /My mother's\. Bronze/ },
  { fact: 'horn.name-stone-held', says: /That is her name/ },
  { fact: 'snig.vouched', says: /Snig told me you would come/ },
  { fact: 'clatter.vouched', says: /Anselm sent you/ },
  { fact: 'horn.weapon-lowered', says: /circles you once/i },
];

describe('Brother Horn: the dialogue file', () => {
  it('AC-1: validates with zero errors, warnings and unreachable nodes, and the creature names it', ({
    task,
  }) => {
    markExercised(task, 'dialogue', HORN);
    expect(content.has('dialogue', HORN)).toBe(true);
    expect(content.get('creature', 'npc-horn').dialogue?.id).toBe(HORN);
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

  it('every fact he reads or writes is registered; the Warden facts keep their types', () => {
    const facts = new Map(content.all('fact').flatMap((g) => g.facts.map((f) => [f.key, f])));
    const group = content.get('fact', 'horn-dialogue');
    expect(group.facts.length).toBeGreaterThan(10);
    for (const fact of group.facts) expect(facts.has(fact.key), fact.key).toBe(true);
    const used = [
      ...JSON.stringify(content.get('dialogue', HORN)).matchAll(/"fact":"([^"]+)"/g),
    ].map((m) => m[1] ?? '');
    for (const key of used) expect(facts.has(key), `${key} registered`).toBe(true);
    expect(facts.get('horn.rescues')?.type).toBe('int');
    expect(facts.get('horn.fate')).toMatchObject({ type: 'enum', values: ['alive', 'dead'] });
  });

  it('every line stays in his voice: short sentences, no shouting, no exclamation marks', () => {
    const def = content.get('dialogue', HORN) as unknown as DialogueDef;
    for (const node of def.nodes) {
      if (node.kind !== 'line' || node.speaker !== 'horn') continue;
      expect(node.text, node.id).not.toMatch(/!|[A-Z]{4,}/);
      for (const sentence of node.text.split(/(?<=[.?])\s+/))
        expect(sentence.split(/\s+/).length, `${node.id}: ${sentence}`).toBeLessThanOrEqual(32);
    }
  });

  it('every class has its own first-meeting line (bible 4.3) and four class-only branches', () => {
    const said = new Set<string>();
    for (const playerClass of CLASSES) said.add(session({ playerClass }).play());
    expect(said.size).toBe(4);
    expect(session({ playerClass: 'knight' }).play()).toMatch(/barony's men stood/);
    expect(session({ playerClass: 'archer' }).play()).toMatch(/Look longer/);
    expect(session({ playerClass: 'sorcerer' }).play()).toMatch(/read my walls/);
    expect(session({ playerClass: 'thief' }).play()).toMatch(/Small steps\. Careful hands/);
    const gated = new Set<string>();
    for (const playerClass of CLASSES) {
      const s = session({ playerClass });
      s.play();
      for (const c of s.runtime.choices())
        if (c.tags.some((t) => t.kind === 'class')) gated.add(c.id);
    }
    expect([...gated].sort()).toEqual([
      'quiet-thief',
      'runes-sorcerer',
      'tracks-archer',
      'trial-knight',
    ]);
  });
});

describe('The six Warden resolutions', () => {
  const fateEffects = (): Map<string, unknown> => {
    const def = content.get('dialogue', HORN) as unknown as DialogueDef;
    const out = new Map<string, unknown>();
    for (const node of def.nodes) {
      if (node.kind !== 'effect') continue;
      const set = node.effects.find((e) => e.kind === 'setFact' && e['fact'] === 'horn.fate');
      if (set?.kind === 'setFact') out.set(node.id, set['value']);
    }
    return out;
  };

  it('AC-1: each of the six resolutions has a node that sets horn.fate (kill sets dead, the rest alive)', () => {
    const fates = fateEffects();
    expect(fates.get('kill-fx')).toBe('dead');
    for (const id of ['spare-fx', 'honest-fx', 'befriend-fx', 'trial-fx2', 'help-fx'])
      expect(fates.get(id), id).toBe('alive');
  });

  it('AC-1: fight and kill: the yield, then finishing him sets horn.fate to dead', () => {
    const s = session({ facts: { 'horn.defeated': true } });
    s.start();
    expect(s.text()).toBe('Enough.');
    s.settle();
    expect(s.ids()).toEqual(['yield-why', 'yield-listen', 'yield-finish']);
    s.pick('yield-why');
    expect(s.ids()).not.toContain('yield-why');
    expect(s.pick('yield-finish').kind).toBe('ended');
    expect(s.fact('horn.fate')).toBe('dead');
    expect(s.host.emitted.map((e) => e.event)).toContain('horn.slain');
  });

  it('AC-1: fight and spare: listening sets horn.spared, he tells the truth wounded and asks for healing', () => {
    const s = session({ facts: { 'horn.defeated': true } });
    s.start();
    s.settle();
    const told = s.ask('yield-listen');
    expect(told).toMatch(/You listened\. Thank you/);
    expect(told).toMatch(/cannot hold the shaft/);
    expect(told).toMatch(/Juniper's salve/);
    expect(s.fact('horn.spared')).toBe(true);
    expect(s.fact('horn.fate')).toBe('alive');
    expect(s.host.disposition('npc-horn')).toBe(3);
  });

  it('AC-1: trick: angry, then weary, then honest; hearing him out sets horn.fate and he is no ally yet', () => {
    const s = session({ facts: { 'horn.tricked': true } });
    const said = s.play();
    expect(said).toMatch(/Moss beds in rows/);
    expect(said.indexOf('Away from them')).toBeGreaterThan(said.indexOf('Moss beds'));
    expect(said.indexOf('No. Sit')).toBeGreaterThan(said.indexOf('Away. Now'));
    expect(s.ids()).toEqual(['fold-listen', 'fold-flee']);
    expect(s.ask('fold-listen')).toMatch(/Waking is the dangerous part/);
    expect(s.fact('horn.fate')).toBe('alive');
    expect(s.fact('horn.befriended')).toBeUndefined();
    // next time he is not repeating the confrontation
    s.start();
    expect(s.text()).toMatch(/You are still here\. Good/);
    s.settle();
    expect(s.ids()).toContain('ask-sleepers');
  });

  it('AC-1: the thief found in the Fold hears the bible line', () => {
    const s = session({ facts: { 'horn.tricked': true }, playerClass: 'thief' });
    expect(s.play()).toMatch(/You walk quietly\. So did the abbot\. Why are you here\?/);
    expect(session({ facts: { 'horn.tricked': true }, playerClass: 'knight' }).play()).toMatch(
      /You are in the Fold\./,
    );
  });

  it('AC-1: befriend: a trigger ends in horn.befriended, horn.fate alive and an invitation to the Fold', () => {
    const s = session({ facts: { 'horn.hymn-hummed': true } });
    expect(s.play()).toMatch(/Come\. I will not tell it\. It is shorter to see/);
    expect(s.fact('horn.befriended')).toBe(true);
    expect(s.fact('horn.fate')).toBe('alive');
    expect(s.host.emitted.map((e) => e.event)).toContain('horn.befriended');
  });

  it('AC-1: the knight asks for the Trial of Horns; winning it counts as befriending him', () => {
    const asked = session({ playerClass: 'knight' });
    asked.play();
    expect(asked.pick('trial-knight').kind).toBe('ended');
    expect(asked.fact('horn.trial-offered')).toBe(true);
    expect(asked.host.emitted.map((e) => e.event)).toContain('horn.trial.begin');
    const won = session({ playerClass: 'knight', facts: { 'horn.trial-won': true } });
    const said = won.play();
    expect(said).toMatch(/Three\. Clean/);
    expect(said).toMatch(/laughing/);
    expect(won.fact('horn.befriended')).toBe(true);
    expect(won.fact('horn.fate')).toBe('alive');
    // delighted once, not every time
    won.start();
    expect(won.text()).toMatch(/Good\. You came back/);
  });

  it('AC-1: help: bread, a healing draught and a sealed breach earn his thanks and set horn.helped', () => {
    const s = session({
      facts: { 'horn.befriended': true },
      items: { 'bread-loaf': 3, 'healing-draught': 1 },
    });
    s.play();
    s.pick('give-bread');
    expect(s.host.itemCount('bread-loaf')).toBe(0);
    s.pick('give-heal');
    expect(s.fact('horn.healed')).toBe(true);
    expect(s.ids()).not.toContain('give-bread');
    expect(s.ids()).not.toContain('give-heal');
    s.pick('leave-open');
    expect(s.fact('horn.helped')).toBeUndefined();
    // the breach is sealed: the next time he thanks them and the best outcome is set
    s.host.setFact('knot.breach-sealed', true);
    s.start();
    expect(s.lines().join(' | ')).toMatch(/The breach is sealed\. I can feel it/);
    expect(s.fact('horn.helped')).toBe(true);
    expect(s.fact('horn.fate')).toBe('alive');
  });

  it('befriended allies share lore, open the crypt and explain the breach; he is honest about dying', () => {
    const s = session({ facts: { 'horn.befriended': true } });
    s.play();
    expect(s.ids()).toEqual(
      expect.arrayContaining(['ask-crypt', 'ask-breach', 'ask-dying', 'show-fold']),
    );
    s.pick('ask-crypt');
    expect(s.fact('horn.crypt-open')).toBe(true);
    expect(s.host.emitted.map((e) => e.event)).toContain('horn.crypt-opened');
    expect(s.ask('ask-dying')).toMatch(/They would do it badly\. They would do it/);
    for (const topic of ['ask-novices', 'ask-abbot', 'ask-sleepers', 'ask-song', 'ask-hornfolk'])
      expect(s.ask(topic), topic).not.toBe('');
    expect(s.ask('ask-axe')).toMatch(/It was a kindness/);
    expect(s.ask('ask-breach')).toMatch(/goblins wall it/);
    expect(s.pick('show-fold').kind).toBe('ended');
    expect(s.host.emitted.map((e) => e.event)).toContain('horn.fold-opened');
  });
});

describe('Befriend triggers', () => {
  it('AC-2: each trigger fact alone offers the befriend branch at the first meeting', () => {
    const said = new Set<string>();
    for (const trigger of TRIGGERS) {
      const s = session({ facts: { [trigger.fact]: true } });
      const line = s.play();
      expect(line, trigger.fact).toMatch(trigger.says);
      expect(s.fact('horn.befriended'), trigger.fact).toBe(true);
      expect(s.fact('horn.fate'), trigger.fact).toBe('alive');
      said.add(line);
    }
    expect(said.size).toBe(TRIGGERS.length);
  });

  it('AC-2: it works in every class, and with no trigger Horn stays the stranger at the door', () => {
    for (const playerClass of CLASSES) {
      for (const trigger of TRIGGERS) {
        const s = session({ playerClass, facts: { [trigger.fact]: true } });
        s.play();
        expect(s.fact('horn.befriended'), `${playerClass} ${trigger.fact}`).toBe(true);
      }
      const none = session({ playerClass });
      none.play();
      expect(none.fact('horn.befriended')).toBeUndefined();
      expect(none.ids()).toContain('ask-who');
    }
  });

  it('AC-2: a trigger found after the first meeting works on the return', () => {
    const s = session();
    s.play();
    s.pick('leave-hall');
    s.host.setFact('horn.ring-held', true);
    s.start();
    expect(s.text()).toMatch(/You came back/);
    s.lines();
    expect(s.fact('horn.befriended')).toBe(true);
  });

  it('a trigger found after sparing him, or after the Fold, makes them friends', () => {
    const spared = session({ facts: { 'horn.spared': true, 'snig.vouched': true } });
    spared.play();
    expect(spared.fact('horn.befriended')).toBe(true);
    const tricked = session({ facts: { 'horn.tricked': true } });
    tricked.play();
    tricked.pick('fold-listen');
    tricked.host.setFact('horn.hymn-hummed', true);
    tricked.play();
    expect(tricked.fact('horn.befriended')).toBe(true);
  });

  it('peace is met with a hint, not a pass; the sorcerer reads the runes on his axe aloud', () => {
    const s = session();
    s.play();
    expect(s.ask('peace')).toMatch(/Put it down, then\. And wait/);
    const sorcerer = session({ playerClass: 'sorcerer' });
    sorcerer.play();
    expect(sorcerer.ask('runes-sorcerer')).toMatch(
      /The last one who read that well took the bell's tongue/,
    );
    expect(sorcerer.fact('horn.befriended')).toBe(true);
  });

  it('the first meeting is the stranger at the door: the canon line, the bounty, the class remarks', () => {
    const s = session();
    s.play();
    expect(s.ask('ask-who')).toMatch(
      /The monks called me Brother Horn\. It was a kindness\. I have kept it\./,
    );
    expect(s.ask('bounty')).toMatch(/I will not let you pass/);
    expect(s.ask('ask-below')).toMatch(/Go back up the stair/);
    expect(s.ids()).not.toContain('ask-below');
    expect(s.pick('leave-hall').kind).toBe('ended');
    const thief = session({ playerClass: 'thief' });
    thief.play();
    expect(thief.ids()).not.toContain('trial-knight');
    expect(thief.ask('quiet-thief')).toMatch(/So did the abbot/);
    const archer = session({ playerClass: 'archer' });
    archer.play();
    expect(archer.ask('tracks-archer')).toMatch(/Yes\. I carry them/);
  });
});

describe('Rescues', () => {
  const remark = (rescues: number): string => {
    const s = session({ facts: { 'horn.rescues': rescues, 'horn.rescue-pending': true } });
    const said = s.play();
    expect(s.fact('horn.rescue-pending'), `${String(rescues)} cleared`).toBe(false);
    return said;
  };

  it('AC-3: rescues 1, 2, 3 and 6 each select their own line', () => {
    expect(remark(1)).toMatch(/You were on the stair\. Not breathing well/);
    expect(remark(2)).toMatch(/^Again\. \| Twice now/);
    expect(remark(3)).toMatch(/^Three\. \| I keep a tally on the wall/);
    expect(remark(6)).toMatch(/I ran out of wall to count on/);
    expect(new Set([1, 2, 3, 6].map(remark)).size).toBe(4);
  });

  it('AC-3: four and five-plus have their own lines, and the remark is made once', () => {
    expect(remark(4)).toMatch(/^Four\. \| I am not angry/);
    expect(remark(5)).toMatch(/I ran out of wall/);
    expect(remark(12)).toMatch(/I ran out of wall/);
    const s = session({ facts: { 'horn.rescues': 2, 'horn.rescue-pending': true } });
    s.play();
    s.start();
    expect(s.text()).toMatch(/Stop\./);
  });
});

describe('The trick and the flight', () => {
  it('AC-4: having fled the Fold, he is next met "angry, then weary", not at the first meeting', () => {
    const s = session({ facts: { 'horn.tricked': true } });
    s.start();
    s.settle();
    expect(s.pick('fold-flee').kind).toBe('ended');
    expect(s.fact('horn.fold-fled')).toBe(true);
    s.start();
    const first = s.text();
    expect(first).toBe('You ran.');
    const said = [first, ...s.lines().slice(1)].join(' | ');
    expect(said).not.toMatch(/Stop\./);
    expect(said).toMatch(/And you came back\. To the Fold/);
    expect(said).toMatch(/Away from them/);
    expect(said).toMatch(/No\. Sit\./);
    expect(said).toMatch(/tired/);
    expect(s.ids()).toEqual(['fold-listen', 'fold-flee']);
    // he lets them hear it this time, and the flight is forgotten
    s.pick('fold-listen');
    expect(s.fact('horn.fold-fled')).toBe(false);
    expect(s.fact('horn.fate')).toBe('alive');
  });

  it('AC-4: the quest can set horn.fold-fled itself (leaving the Fold unresolved)', () => {
    const s = session({ facts: { 'horn.tricked': true, 'horn.fold-fled': true } });
    expect(s.play()).toMatch(/^You ran\./);
  });
});

describe('Act III and the endings', () => {
  it('shaft barks: he holds the foot, differently each time; a spared Horn cannot until healed', () => {
    const s = session({ facts: { 'horn.at-shaft': true, 'horn.befriended': true } });
    const said = [s.play(), s.play(), s.play(), s.play()];
    expect(said[0]).toMatch(/I have the foot/);
    expect(said[1]).toMatch(/They are loud tonight/);
    expect(said[2]).toMatch(/Ring it/);
    expect(said[3]).toBe(said[2]);
    const weak = session({ facts: { 'horn.at-shaft': true, 'horn.spared': true } });
    expect(weak.play()).toMatch(/I cannot hold it/);
    const healed = session({
      facts: { 'horn.at-shaft': true, 'horn.spared': true, 'horn.healed': true },
    });
    expect(healed.play()).toMatch(/I have the foot/);
  });

  it('endings: Vespers Rung lines vary with the breach, Clatter, Tansy, the goblins and the help', () => {
    const plain = session({ facts: { 'abbot.fate': 'at-rest' } }).play();
    expect(plain).toMatch(/The bell rang\. I heard it from the foot of the shaft/);
    expect(plain).toMatch(/I will stay below/);
    expect(plain).not.toMatch(/breach is closed|Anselm|baker's girl|Kettleback|bread to the gate/);
    const full = session({
      facts: {
        'abbot.fate': 'defeated',
        'knot.breach-sealed': true,
        'clatter.restored': true,
        'tansy.saved': true,
        'goblins.standing': 'friendly',
        'horn.helped': true,
      },
    }).play();
    for (const part of [
      /breach is closed/,
      /Anselm walked past me/,
      /funny thing to call a bull/,
      /Kettleback's people will keep the watch/,
      /bread to the gate/,
      /Rest, when you can/,
    ])
      expect(full).toMatch(part);
  });

  it('endings: when the player joined the abbot he is awake and alone; a dead Horn does not speak', () => {
    const said = session({ facts: { 'abbot.fate': 'joined' } }).play();
    expect(said).toMatch(/You did not ring it/);
    expect(said).toMatch(/I tried, once/);
    const dead = session({ facts: { 'abbot.fate': 'at-rest', 'horn.fate': 'dead' } });
    expect(dead.play()).toMatch(/Stop\./);
  });
});

describe('The spared Horn', () => {
  it('returns wounded, takes a healing draught or rest, and is not yet a friend', () => {
    const s = session({ facts: { 'horn.spared': true }, items: { 'healing-draught': 1 } });
    s.start();
    expect(s.text()).toMatch(/I am glad you stayed your hand/);
    s.settle();
    expect(s.ids()).toEqual(expect.arrayContaining(['give-heal', 'rest-fold', 'ask-sleepers']));
    expect(s.ids()).not.toContain('ask-crypt');
    s.pick('give-heal');
    expect(s.host.itemCount('healing-draught')).toBe(0);
    expect(s.fact('horn.healed')).toBe(true);
    expect(s.ids()).not.toContain('rest-fold');
    const rest = session({ facts: { 'horn.spared': true } });
    rest.play();
    expect(rest.pick('rest-fold').kind).toBe('ended');
    expect(rest.fact('horn.healed')).toBe(true);
    expect(rest.host.emitted.map((e) => e.event)).toContain('horn.rests');
  });
});
