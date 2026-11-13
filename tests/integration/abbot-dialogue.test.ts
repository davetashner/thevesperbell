// mw-e39.9: the Sleepless Abbot's dialogue (abbot-cradle), played by the real DialogueRuntime against the
// shipped content. AC-4 (the friend-below notes) moved to mw-e39.42. Conversations use a MemoryLogicHost
// so the facts and events they change are visible.
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { gameContentSources, loadGameContent } from '@content/index';
import { World } from '@sim/core/world';
import { MemoryLogicHost } from '@sim/logic';
import { DialogueRuntime, type DialogueView } from '@sim/dialogue/runtime';
import type { DialogueDef } from '@content/types/dialogue';
import { main } from '../../src/tools/dialogue/cli';

const content = loadGameContent();
const ABBOT = 'abbot-cradle';
const CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

// MemoryLogicHost has no registry, so the registered defaults the dialogue compares against are given here.
const DEFAULT_FACTS = {
  'abbot.fate': 'unresolved',
  'abbot.resolution': 'none',
  'horn.fate': 'alive',
  'horn.rescues': 0,
  'clatter.fate': 'waiting',
  'vane.fate': 'unexposed',
  'goblins.standing': 'neutral',
};

function session(
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  dialogue = ABBOT,
  npc = 'npc-abbot',
) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost({ ...init, facts: { ...DEFAULT_FACTS, ...init.facts } });
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const ids = (): string[] => runtime.choices().map((c) => c.id);
  const lines = (): string[] => {
    const out: string[] = [];
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance())
      out.push(view.text);
    return out;
  };
  const start = (): DialogueView => runtime.start(dialogue, npc);
  /** Starts and reads everything up to the first choice (or the end); returns the whole thing said. */
  const play = (): string => {
    start();
    return lines().join(' | ');
  };
  /** Chooses an option and returns what is said before the next choice (or the end). */
  const ask = (id: string): string => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok, id).toBe(true);
    return lines().join(' | ');
  };
  const fact = (key: string): unknown => host.facts.get(key);
  const events = (): string[] => host.emitted.map((e) => e.event);
  return { host, runtime, start, ids, lines, play, ask, fact, events };
}

/** The Cradle with any temptation turned down, so the hub is next. */
function cradle(init: ConstructorParameters<typeof MemoryLogicHost>[0] = {}) {
  const s = session({ ...init, facts: { 'abbot.in-cradle': true, ...init.facts } });
  s.play();
  const refuse = s.ids().find((id) => id.endsWith('-no'));
  if (refuse !== undefined) s.ask(refuse);
  expect(s.ids()).toContain('fight');
  return s;
}

describe('the Sleepless Abbot: the dialogue file', () => {
  it('AC-1: validates with zero errors, warnings and unreachable nodes, and the creature names it', ({
    task,
  }) => {
    markExercised(task, 'dialogue', ABBOT);
    expect(content.get('creature', 'npc-abbot').dialogue?.id).toBe(ABBOT);
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

  it('every fact he reads or writes is registered, and the dreamer mark is a bool', ({ task }) => {
    markExercised(task, 'fact', 'abbot-dialogue');
    const facts = new Map(content.all('fact').flatMap((g) => g.facts.map((f) => [f.key, f])));
    for (const fact of content.get('fact', 'abbot-dialogue').facts)
      expect(facts.has(fact.key), fact.key).toBe(true);
    const used = [
      ...JSON.stringify(content.get('dialogue', ABBOT)).matchAll(/"fact":"([^"]+)"/g),
    ].map((m) => m[1] ?? '');
    for (const key of used) expect(facts.has(key), `${key} registered`).toBe(true);
    expect(facts.get('dreamer.marked')?.type).toBe('bool');
    expect(facts.get('abbot.fate')).toMatchObject({
      values: ['unresolved', 'at-rest', 'defeated', 'joined'],
    });
  });

  it('every line stays in his voice: courteous, never raised, no exclamation marks', () => {
    const def = content.get('dialogue', ABBOT) as unknown as DialogueDef;
    for (const node of def.nodes) {
      if (node.kind !== 'line') continue;
      expect(node.text, node.id).not.toMatch(/!|[A-Z]{4,}/);
    }
  });
});

describe('the Sleepless Abbot: the Act III reveal', () => {
  it('thanks the player warmly and, if Horn lives, asks them to finish him', () => {
    const s = session();
    const said = s.play();
    expect(said).toMatch(/Corvin Ashgrove/);
    expect(said).toMatch(/He is old, and he is in my way, and you are so very good at this/);
    s.ask('reveal-notes');
    expect(s.fact('abbot.reveal-heard')).toBe(true);
    expect(s.events()).toContain('abbot.reveal-spoken');
  });

  it('walks past delighted if Horn is dead, and does not ask for anything', () => {
    const said = session({ facts: { 'horn.fate': 'dead' } }).play();
    expect(said).toMatch(/He is gone, then/);
    expect(said).not.toMatch(/very good at this/);
  });

  it('once heard, outside the Cradle he only says he is ahead of you', () => {
    expect(session({ facts: { 'abbot.reveal-heard': true } }).play()).toMatch(/a little ahead/);
  });
});

describe('the Sleepless Abbot: class temptations', () => {
  const SAYS: Record<(typeof CLASSES)[number], RegExp> = {
    sorcerer: /Somnomancy\. Lull/,
    knight: /brothers once/,
    archer: /watched you from the dark/,
    thief: /monks' plate/,
  };

  it('AC-3: each class gets its own temptation line, and nobody else its words', () => {
    const said = new Set<string>();
    for (const playerClass of CLASSES) {
      const text = session({ playerClass, facts: { 'abbot.in-cradle': true } }).play();
      said.add(text);
      expect(text, playerClass).toMatch(SAYS[playerClass]);
      for (const other of CLASSES)
        if (other !== playerClass)
          expect(text, `${playerClass} not ${other}`).not.toMatch(SAYS[other]);
    }
    expect(said.size).toBe(4);
  });

  it.each(CLASSES)('AC-5: the %s accepting leaves the dreamer mark', (playerClass) => {
    const s = session({ playerClass, facts: { 'abbot.in-cradle': true } });
    s.play();
    s.ask(`tempt-${playerClass}-yes`);
    expect(s.fact('dreamer.marked')).toBe(true);
    expect(s.events()).toContain('abbot.help-accepted');
    expect(s.events().includes('abbot.lull-taught')).toBe(playerClass === 'sorcerer');
    expect(s.ids()).toContain('fight');
  });

  it('turning it down leaves no mark', () => {
    const s = cradle({ playerClass: 'knight' });
    expect(s.fact('dreamer.marked')).toBeFalsy();
    expect(s.fact('abbot.temptation-refused')).toBe(true);
  });

  it('a second visit skips the temptation and goes straight to the hub', () => {
    const s = cradle({ playerClass: 'archer' });
    s.runtime.abort('left');
    expect(s.play()).toMatch(/Still here/);
    expect(s.ids()).toContain('fight');
  });
});

describe('the Sleepless Abbot: the four Cradle resolutions', () => {
  it('AC-1: fight begins the fight and, once the wraith is down, sets abbot.fate to defeated', () => {
    const s = cradle({ playerClass: 'knight' });
    s.ask('fight');
    expect(s.fact('abbot.resolution')).toBe('fight');
    expect(s.fact('abbot.fate')).toBe('unresolved');
    expect(s.events()).toContain('abbot.fight-begun');
    const during = session({ facts: { 'abbot.in-cradle': true, 'abbot.resolution': 'fight' } });
    expect(during.play()).toMatch(/We have begun/);
    const won = session({
      facts: { 'abbot.in-cradle': true, 'abbot.resolution': 'fight', 'abbot.wraith-down': true },
    });
    expect(won.play()).toMatch(/tongue is on the floor/);
    expect(won.fact('abbot.fate')).toBe('defeated');
    expect(won.fact('abbot.tongue-recovered')).toBe(true);
  });

  it.each([
    ['thief', /belt is lighter/],
    ['sorcerer', /in my voice/],
    ['archer', /My lanterns/],
  ] as const)('AC-1: the %s tricks him, which sets abbot.fate to defeated', (playerClass, says) => {
    const s = cradle({ playerClass });
    expect(s.ask(`trick-${playerClass}`)).toMatch(says);
    expect(s.fact('abbot.fate')).toBe('defeated');
    expect(s.fact('abbot.resolution')).toBe('trick');
    expect(s.fact('abbot.tongue-recovered')).toBe(true);
    expect(s.events()).toContain('abbot.trick-sprung');
  });

  it('only the thief, sorcerer and archer have a trick; the knight has none', () => {
    for (const playerClass of CLASSES) {
      const tricks = cradle({ playerClass })
        .ids()
        .filter((id) => id.startsWith('trick-'));
      expect(tricks, playerClass).toEqual(playerClass === 'knight' ? [] : [`trick-${playerClass}`]);
    }
  });

  it('AC-1, AC-2: persuade, with Clatter speaking, sets abbot.fate to at-rest', () => {
    const s = cradle({
      playerClass: 'knight',
      facts: { 'clatter.restored': true, 'clatter.fate': 'joined' },
    });
    const said = s.ask('persuade');
    expect(said).toMatch(/You promised we would go back up for pears/);
    expect(said).toMatch(/Anselm Hobb/);
    expect(s.fact('abbot.fate')).toBe('at-rest');
    expect(s.fact('abbot.resolution')).toBe('persuade');
    expect(s.events()).toContain('abbot.persuaded');
  });

  it('AC-1: join sets abbot.fate to joined, and he is glad of the company afterwards', () => {
    const s = cradle({ playerClass: 'thief' });
    expect(s.ask('join')).toMatch(/Oh, how lovely/);
    expect(s.fact('abbot.fate')).toBe('joined');
    expect(s.fact('abbot.tongue-recovered')).toBeFalsy();
    expect(s.events()).toContain('abbot.joined');
    expect(session({ facts: { 'abbot.fate': 'joined' } }).play()).toMatch(/Listen with me/);
  });

  it('after the other endings he has a last word', () => {
    expect(session({ facts: { 'abbot.fate': 'at-rest' } }).play()).toMatch(/Pears/);
    expect(session({ facts: { 'abbot.fate': 'defeated' } }).play()).toMatch(/only fog now/);
  });
});

describe('the Sleepless Abbot: persuade-to-rest is gated on Clatter', () => {
  it('AC-2: with clatter.restored false the option is not offered, whatever Clatter chose', () => {
    for (const fate of ['waiting', 'joined', 'rested']) {
      const s = cradle({ facts: { 'clatter.restored': false, 'clatter.fate': fate } });
      expect(s.ids(), fate).not.toContain('persuade');
    }
  });

  it('AC-2: restored but not come to the Cradle (waiting or rested) does not offer it either', () => {
    for (const fate of ['waiting', 'rested'])
      expect(
        cradle({ facts: { 'clatter.restored': true, 'clatter.fate': fate } }).ids(),
      ).not.toContain('persuade');
  });

  it('AC-2: restored and come to the Cradle offers it', () => {
    expect(
      cradle({ facts: { 'clatter.restored': true, 'clatter.fate': 'joined' } }).ids(),
    ).toContain('persuade');
  });
});

describe('the dreamer mark is read by Horn and Mirela', () => {
  it('AC-5: Horn says he trusts the marked player less, once, and then carries on', () => {
    const s = session({}, 'horn-warden', 'npc-horn');
    s.play();
    s.runtime.abort('left');
    s.host.setFact('dreamer.marked', true);
    expect(s.play()).toMatch(/hum under your words/);
    s.runtime.abort('left');
    expect(s.play()).not.toMatch(/hum under your words/);
  });

  it('AC-5: Horn does not mention it to a player who is not marked', () => {
    const s = session({}, 'horn-warden', 'npc-horn');
    s.play();
    s.runtime.abort('left');
    expect(s.play()).not.toMatch(/hum under your words/);
  });

  it('AC-5: Mirela knows a dreamer by the Nine Sleeps look and still serves them', () => {
    const s = session({ facts: { 'dreamer.marked': true } }, 'mirela-stacks', 'npc-mirela');
    expect(s.play()).toMatch(/Nine Sleeps leaves on a reader/);
    expect(s.ids()).toContain('ask-hours');
  });
});
