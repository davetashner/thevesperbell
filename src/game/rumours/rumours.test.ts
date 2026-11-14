// The rumour system (mw-e22.11): a real world with the game's content rumours and fact registry.
// Hearing records a fact, the target becomes a lead, a visit resolves it, false rumours debunk and
// Dot's follow-up is offered once.
import { loadGameContent } from '@content/index';
import {
  DialogueStarted,
  volumeEntered,
  World,
  type EntityId,
  type QuestRuntime,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { logicEmitted, rumorRevealed, type LogicEmitted } from '../logic/host';
import {
  RUMOUR_CORRECTED_EVENT,
  RUMOUR_DEBUNKED_EVENT,
  RUMOUR_RESOLVED_EVENT,
  RUMOUR_TOLD_EVENT,
  RumourBook,
  rumourFactKey,
  rumourReading,
  rumoursOf,
  startRumourUi,
  VISIT_TRIGGERS,
  type RumourReading,
} from './rumours';

const content = loadGameContent();
const rumours = rumoursOf(content);
const id = (n: string): string => {
  const found = rumours.find((r) => r.id.startsWith(`rumor-${n}-`));
  if (found === undefined) throw new Error(`no rumour ${n}`);
  return found.id;
};

function setup(quest: 'unstarted' | 'active' | 'none' = 'unstarted') {
  const world = new World<unknown>({ seed: 5 });
  const sim = world as unknown as World<never>;
  installFactRegistry(sim.facts, content, true);
  const player = world.spawn();
  const other = world.spawn();
  const state = { quest: quest === 'none' ? 'unstarted' : quest };
  const quests =
    quest === 'none' ? undefined : ({ questState: () => state.quest } as unknown as QuestRuntime);
  const changes: number[] = [];
  const book = new RumourBook({
    world: sim,
    rumours,
    quests,
    player: () => player,
    onChange: () => changes.push(1),
  });
  const emitted: LogicEmitted[] = [];
  sim.events.on(logicEmitted, (e) => emitted.push(e));
  const told = (n: number): void => {
    sim.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: n, source: 'x' } });
    world.step([]);
  };
  const enter = (node: string, entity: EntityId = player, graphId = 'g'): void => {
    sim.events.emit(volumeEntered, { graphId, node, entity } as never);
    world.step([]);
  };
  const talk = (npc: string): void => {
    sim.events.emit(DialogueStarted, { npc } as never);
    world.step([]);
  };
  const flag = (rumour: string, s: 'heard' | 'investigated' | 'debunked' | 'followed') =>
    sim.facts.get(rumourFactKey(rumour, s));
  return { world, sim, book, emitted, told, enter, talk, flag, state, changes, player, other };
}

describe('hearing a rumour', () => {
  it('AC-1: a new game holds no rumour facts and no entries', () => {
    const { sim, book } = setup();
    expect(book.entries()).toEqual([]);
    expect(book.leads()).toEqual([]);
    expect(sim.facts.entries('entity:rumours/')).toEqual([]);
  });

  it('AC-1: rumor.told records it as heard, once, and notifies the book listener', () => {
    const { book, told, flag, changes } = setup();
    told(1);
    told(1);
    expect(flag(id('01'), 'heard')).toBe(true);
    expect(book.entries().map((e) => e.id)).toEqual([id('01')]);
    expect(changes).toHaveLength(1);
  });

  it('AC-1: the revealRumor effect records it by id; unknown numbers and ids are ignored', () => {
    const { sim, book, told, world } = setup();
    sim.events.emit(rumorRevealed, { rumor: id('04') });
    sim.events.emit(rumorRevealed, { rumor: 'rumor-99-nothing' });
    world.step([]);
    told(99);
    expect(book.entries().map((e) => e.id)).toEqual([id('04')]);
    expect(book.hear('rumor-99-nothing')).toBe(false);
  });

  it('AC-2: the heard rumour is a lead pointing at its target', () => {
    const { book, told } = setup();
    told(6);
    told(11);
    expect(book.leads()).toEqual(['npc-vane', 'npc-clatter']);
    expect(book.entries()[0]).toMatchObject({
      id: id('06'),
      target: 'npc-vane',
      status: 'lead',
      truth: 'true',
      debunked: false,
      followUp: undefined,
    });
  });

  it('AC-2: heard rumours list in content order with no marker for unheard ones', () => {
    const { book, told } = setup();
    told(12);
    told(1);
    expect(book.entries().map((e) => e.id)).toEqual([id('01'), id('12')]);
  });
});

describe('visiting the target', () => {
  it('AC-3: entering the arrival volume investigates a heard rumour and fires rumor.resolved', () => {
    const { book, told, enter, flag, emitted } = setup();
    told(10);
    enter('the-fold');
    expect(flag(id('10'), 'investigated')).toBe(true);
    expect(book.leads()).toEqual([]);
    expect(emitted.filter((e) => e.event === RUMOUR_RESOLVED_EVENT)).toEqual([
      { event: RUMOUR_RESOLVED_EVENT, data: { rumor: id('10') } },
    ]);
    enter('the-fold');
    expect(emitted.filter((e) => e.event === RUMOUR_RESOLVED_EVENT)).toHaveLength(1);
  });

  it('AC-3: a volume matches by graph id too, and only for the player', () => {
    const { told, enter, flag, other } = setup();
    told(10);
    enter('the-fold', other);
    expect(flag(id('10'), 'investigated')).not.toBe(true);
    enter('somewhere', undefined, 'the-fold');
    expect(flag(id('10'), 'investigated')).toBe(true);
  });

  it('AC-3: an area of an unheard rumour records nothing', () => {
    const { sim, enter } = setup();
    enter('the-fold');
    expect(sim.facts.entries('entity:rumours/')).toEqual([]);
  });

  it('AC-3: speaking to the NPC investigates an NPC target', () => {
    const { told, talk, flag } = setup();
    told(6);
    talk('npc-dot');
    expect(flag(id('06'), 'investigated')).not.toBe(true);
    talk('npc-vane');
    expect(flag(id('06'), 'investigated')).toBe(true);
  });

  it('AC-3: starting the quest investigates a quest target, even if started before it was heard', () => {
    const { told, state, flag, book, world } = setup('unstarted');
    told(8);
    book.update();
    expect(flag(id('08'), 'investigated')).not.toBe(true);
    state.quest = 'active';
    world.step([]);
    book.update();
    expect(flag(id('08'), 'investigated')).toBe(true);
    const late = setup('active');
    late.told(8);
    expect(late.flag(id('08'), 'investigated')).toBe(true);
  });

  it('AC-3: with no quest runtime a quest target stays a lead', () => {
    const { told, book, flag } = setup('none');
    told(8);
    book.update();
    expect(flag(id('08'), 'investigated')).not.toBe(true);
    expect(book.leads()).toEqual(['quest-captains-boots']);
  });

  it('AC-3: a target with no trigger yet stays a lead', () => {
    const { told, book, enter } = setup();
    told(1);
    enter('briarwood');
    expect(book.leads()).toEqual(['place-briarwood']);
  });

  it('AC-3: every trigger names an area, an NPC or a quest that exists', () => {
    const quests = new Set(content.all('quest').map((q) => q.id));
    for (const triggers of Object.values(VISIT_TRIGGERS)) {
      for (const t of triggers) if ('quest' in t) expect(quests.has(t.quest)).toBe(true);
    }
    const targets = new Set(rumours.map((r) => r.target));
    const debunkPlaces = rumours.flatMap((r) =>
      (r.debunk ?? []).flatMap((d) => (d.via === 'dive' ? [d.place] : [])),
    );
    for (const key of Object.keys(VISIT_TRIGGERS)) {
      expect(targets.has(key) || debunkPlaces.includes(key)).toBe(true);
    }
  });
});

describe('debunking', () => {
  it('AC-4: seeing the place for yourself debunks a false rumour', () => {
    const { book, told, enter, flag, emitted } = setup();
    told(3);
    enter('mine-gate');
    expect(flag(id('03'), 'debunked')).toBe(true);
    expect(book.entries()[0]).toMatchObject({ debunked: true, truth: 'false' });
    expect(emitted.filter((e) => e.event === RUMOUR_DEBUNKED_EVENT)).toEqual([
      { event: RUMOUR_DEBUNKED_EVENT, data: { rumor: id('03') } },
    ]);
  });

  it('AC-4: asking the debunker debunks a heard false rumour, once', () => {
    const { sim, told, flag, emitted, world } = setup();
    sim.events.emit(logicEmitted, { event: RUMOUR_CORRECTED_EVENT, data: { rumor: 3 } });
    world.step([]);
    expect(flag(id('03'), 'debunked')).not.toBe(true);
    told(3);
    for (let i = 0; i < 2; i++) {
      sim.events.emit(logicEmitted, { event: RUMOUR_CORRECTED_EVENT, data: { rumor: 3 } });
      world.step([]);
    }
    expect(flag(id('03'), 'debunked')).toBe(true);
    expect(emitted.filter((e) => e.event === RUMOUR_DEBUNKED_EVENT)).toHaveLength(1);
  });

  it('AC-4: an unknown corrected number is ignored and a true rumour cannot be debunked', () => {
    const { sim, book, told, flag, world } = setup();
    told(1);
    sim.events.emit(logicEmitted, { event: RUMOUR_CORRECTED_EVENT, data: { rumor: 1 } });
    sim.events.emit(logicEmitted, { event: RUMOUR_CORRECTED_EVENT, data: { rumor: 77 } });
    world.step([]);
    expect(flag(id('01'), 'debunked')).not.toBe(true);
    expect(book.debunk('rumor-77-none')).toBe(false);
  });

  it('AC-4: a dive debunk place that is not a trigger leaves the rumour standing', () => {
    const { told, enter, flag } = setup();
    told(2);
    enter('mooring-watch');
    expect(flag(id('02'), 'debunked')).not.toBe(true);
  });

  it('AC-4: visiting a debunk place of an unheard false rumour does nothing', () => {
    const { enter, flag } = setup();
    enter('mine-gate');
    expect(flag(id('03'), 'debunked')).not.toBe(true);
  });
});

describe('follow-up lines', () => {
  it('AC-5: the follow-up is offered after a visit and goes once the dialogue sets followed', () => {
    const { book, told, enter, sim } = setup();
    told(10);
    expect(book.entries()[0]?.followUp).toBeUndefined();
    enter('the-fold');
    const line = rumours.find((r) => r.id === id('10'))?.followUp?.text;
    expect(book.entries()[0]?.followUp).toBe(line);
    sim.facts.set(rumourFactKey(id('10'), 'followed'), true);
    expect(book.entries()[0]?.followUp).toBeUndefined();
  });

  it('AC-5: a rumour with no follow-up line offers none after a visit', () => {
    const { told, enter, book } = setup();
    told(13);
    enter('bonded-warehouse');
    expect(book.entries()[0]).toMatchObject({ id: id('13'), status: 'investigated' });
    expect(book.entries()[0]?.followUp).toBeUndefined();
  });
});

describe('the rumour UI', () => {
  function start(publish = true) {
    const world = new World<unknown>({ seed: 8 });
    const sim = world as unknown as World<never>;
    installFactRegistry(sim.facts, content, true);
    const player = world.spawn();
    const readings: RumourReading[] = [];
    const ui = startRumourUi({
      world: sim,
      rumours,
      quests: undefined,
      player: () => player,
      ...(publish && { publish: (_k, v) => readings.push(JSON.parse(v) as RumourReading) }),
    });
    return { world, sim, ui, readings, player };
  }

  it('AC-2: publishes the empty readout at start and again whenever the book changes', () => {
    const { world, sim, readings, ui, player } = start();
    expect(readings).toEqual([{ heard: [], leads: [], investigated: [], debunked: [] }]);
    sim.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: 10 } });
    world.step([]);
    ui.afterStep();
    expect(readings.at(-1)).toEqual({
      heard: [id('10')],
      leads: ['place-fold'],
      investigated: [],
      debunked: [],
    });
    sim.events.emit(volumeEntered, { graphId: 'g', node: 'the-fold', entity: player } as never);
    world.step([]);
    expect(rumourReading(ui.book).investigated).toEqual([id('10')]);
    sim.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: 3 } });
    sim.events.emit(volumeEntered, { graphId: 'g', node: 'mine-gate', entity: player } as never);
    world.step([]);
    expect(readings.at(-1)?.debunked).toEqual([id('03')]);
  });

  it('AC-1: runs without a publish hook', () => {
    const { world, sim } = start(false);
    sim.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: 1 } });
    world.step([]);
    expect(sim.facts.get(rumourFactKey(id('01'), 'heard'))).toBe(true);
  });

  it('AC-1: disposing stops listening', () => {
    const { world, sim, ui } = start();
    ui.book.dispose();
    sim.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: 1 } });
    world.step([]);
    expect(ui.book.entries()).toEqual([]);
  });
});
