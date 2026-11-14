// @vitest-environment happy-dom
// The journal (mw-e23.6, mw-1myt): the model built from the real quest runtime and content, quests
// under Active and Completed / Failed, the class's first entry in place of the arrival stage text,
// rumours from a source, and the controller that opens the window.
import { loadGameContent } from '@content/index';
import { classBeat, type Narration } from '@content/types/narration';
import type { QuestDef } from '@content/types/quest';
import {
  addCapabilities,
  addInventory,
  CapabilityRegistry,
  InventoryRules,
  World,
} from '@sim/index';
import { UiRoot, type JournalModel } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFactRegistry } from '../facts';
import { installGameLogic, questsOf } from '../logic/install';
import {
  buildJournal,
  classBeatShownFact,
  JOURNAL_STATUS,
  JournalController,
  journalSources,
  MAIN_QUEST,
  type JournalRumour,
  type JournalSources,
} from './journal';

const content = loadGameContent();
const narrations = content.all('narration') as readonly Narration[];

beforeEach(() => {
  document.body.innerHTML = '';
});

function failSetup(): never {
  throw new Error('the game content has quests');
}

function setup() {
  const world = new World<never>({ seed: 5 });
  installFactRegistry(world.facts, content, true);
  const player = world.spawn();
  addInventory(world, player, 0);
  addCapabilities(world, player);
  world.step();
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory: new InventoryRules(content.all('item')),
    capabilities: new CapabilityRegistry([]),
    quests: questsOf(content),
  });
  const quests = logic.quests ?? failSetup();
  const sources = (rumours?: JournalSources['rumours']): JournalSources =>
    journalSources(content, { quests, facts: world.facts, rumours });
  const arrive = (): void => {
    world.facts.set('player.class', 'archer');
    world.facts.set('briar-glen.arrived', true);
    world.step();
    quests.update();
  };
  return { world, quests, sources, arrive };
}

const RUMOUR: JournalRumour = {
  id: 'rumor-01-x',
  text: 'They say the abbot walks at night.',
  target: 'The abbey',
  status: 'lead',
  debunked: false,
};

describe('journal model', () => {
  it('AC-1: a started quest, a completed objective and a heard rumour show under Active and Rumours', () => {
    const t = setup();
    t.arrive();
    t.quests.completeObjective(MAIN_QUEST, 'reach-briar-glen');
    const model = buildJournal(t.sources({ entries: () => [RUMOUR] }));
    expect(model.active.map((e) => e.id)).toEqual([MAIN_QUEST]);
    const done = model.active[0]?.objectives?.filter((o) => o.done) ?? [];
    expect(done).toHaveLength(1);
    expect(done[0]?.text).toBe('Arrive in Briar Glen.');
    expect(model.rumours).toEqual([
      {
        id: RUMOUR.id,
        title: 'The abbey',
        status: JOURNAL_STATUS.lead,
        paragraphs: [RUMOUR.text],
      },
    ]);
    expect(model.done).toEqual([]);
  });

  it('AC-1: no quest is listed before it starts, and hidden or inactive objectives stay out', () => {
    const t = setup();
    const before = buildJournal(t.sources());
    expect(before.active).toEqual([]);
    expect(before.rumours).toEqual([]);
    t.arrive();
    const model = buildJournal(t.sources());
    const def = content.get('quest', MAIN_QUEST);
    const shown = model.active[0]?.objectives ?? [];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(def.objectives.length);
  });

  it('mw-1myt: the class first entry replaces the arrival stage text, then leads the later stage text', () => {
    const t = setup();
    t.world.facts.set('player.class', 'archer');
    t.quests.startQuest(MAIN_QUEST);
    const first = classBeat(narrations, 'first-journal', 'archer')?.pages.map((p) => p.text);
    expect(first?.length).toBeGreaterThan(0);
    const stages = content.get('quest', MAIN_QUEST).stages;
    const arrival = buildJournal(t.sources());
    expect(arrival.active[0]?.paragraphs).toEqual(first);
    expect(arrival.active[0]?.paragraphs).not.toContain(
      stages.find((s) => s.id === 'arrival')?.text,
    );
    t.quests.setStage(MAIN_QUEST, 'first-night');
    const later = buildJournal(t.sources());
    expect(later.active[0]?.paragraphs).toEqual([
      ...(first ?? []),
      stages.find((s) => s.id === 'first-night')?.text,
    ]);
    // The first entry stays under Notes.
    expect(later.notes.map((n) => n.id)).toEqual(['class-beat-first-journal']);
    expect(later.notes[0]?.paragraphs).toEqual(first);
  });

  it('mw-1myt: a new game with only player.class journals the first entry; no class means no note and the stage text', () => {
    const t = setup();
    t.world.facts.set('player.class', 'knight');
    expect(buildJournal(t.sources()).notes.map((n) => n.id)).toEqual(['class-beat-first-journal']);
    const bare = setup();
    bare.world.facts.set('briar-glen.arrived', true);
    bare.world.step();
    bare.quests.update();
    const model = buildJournal(bare.sources());
    expect(model.notes).toEqual([]);
    expect(model.active[0]?.paragraphs).toEqual([
      content.get('quest', MAIN_QUEST).stages.find((s) => s.id === bare.quests.stage(MAIN_QUEST))
        ?.text,
    ]);
  });

  it('mw-1myt: each class beat shown is journalled under Notes, in beat order', () => {
    const t = setup();
    t.world.facts.set('player.class', 'archer');
    for (const beat of ['night-one', 'arrival', 'horn']) {
      t.world.facts.declare(classBeatShownFact(beat), { type: 'bool', default: false });
    }
    t.world.facts.set(classBeatShownFact('night-one'), true);
    t.world.facts.set(classBeatShownFact('arrival'), true);
    const notes = buildJournal(t.sources()).notes;
    expect(notes.map((n) => n.id)).toEqual([
      'class-beat-arrival',
      'class-beat-first-journal',
      'class-beat-night-one',
    ]);
    expect(notes.every((n) => n.paragraphs.length > 0)).toBe(true);
  });

  it('a rumour is listed as a lead, looked into, or nothing in it', () => {
    const t = setup();
    const model = buildJournal(
      t.sources({
        entries: () => [
          RUMOUR,
          { ...RUMOUR, id: 'b', status: 'investigated' },
          { ...RUMOUR, id: 'c', debunked: true },
        ],
      }),
    );
    expect(model.rumours.map((r) => r.status)).toEqual([
      JOURNAL_STATUS.lead,
      JOURNAL_STATUS.investigated,
      JOURNAL_STATUS.debunked,
    ]);
  });
});

/** A two-quest fake: `lost` failed and continued into `found`, which is active; `won` resolved. */
function fakeSources(): JournalSources {
  const objective = (id: string, over: object = {}) => ({
    id,
    text: `Do ${id}.`,
    kind: 'event' as const,
    params: { event: id },
    optional: false,
    hidden: false,
    ...over,
  });
  const defs = [
    {
      id: 'lost',
      title: 'The Lost Thing',
      summary: 'Find it.',
      stages: [],
      objectives: [objective('a')],
      resolutions: [],
      failures: [{ id: 'gone', journal: 'It is gone for good.' }],
    },
    {
      id: 'found',
      title: 'The Found Thing',
      summary: 'Follow the trail instead.',
      stages: [{ id: 's1', text: 'The trail is warm.' }],
      objectives: [
        objective('b'),
        objective('c', { optional: true }),
        objective('d', { hidden: true }),
        objective('e'),
      ],
      resolutions: [],
      failures: [],
    },
    {
      id: 'won',
      title: 'The Won Thing',
      summary: 'Win it.',
      stages: [],
      objectives: [objective('f')],
      resolutions: [{ id: 'clean', journal: 'It went cleanly.' }],
      failures: [],
    },
    {
      id: 'odd',
      title: 'The Odd Thing',
      summary: 'No journal entry named.',
      stages: [],
      objectives: [],
      resolutions: [],
      failures: [],
    },
    {
      id: 'plain',
      title: 'The Plain Thing',
      summary: 'Just this.',
      stages: [],
      objectives: [],
      resolutions: [],
      failures: [],
    },
    { id: 'later', title: 'Later', summary: 'Not yet.', stages: [], objectives: [] },
  ] as unknown as QuestDef[];
  const state: Record<string, string> = {
    lost: 'failed',
    found: 'active',
    won: 'resolved',
    odd: 'resolved',
    plain: 'active',
    later: 'unstarted',
  };
  const objectives: Record<string, string> = {
    'lost/a': 'failed',
    'found/b': 'complete',
    'found/c': 'active',
    'found/d': 'active',
    'found/e': 'inactive',
    'won/f': 'complete',
  };
  const quests = {
    questState: (q: string) => state[q],
    objectiveState: (q: string, o: string) => objectives[`${q}/${o}`] ?? 'inactive',
    stage: (q: string) => (q === 'found' ? 's1' : undefined),
    resolution: (q: string) => (q === 'won' ? 'clean' : undefined),
    failure: (q: string) => (q === 'lost' ? 'gone' : undefined),
  } as unknown as JournalSources['quests'];
  return { quests, defs, facts: new World<never>({ seed: 1 }).facts, narrations: [] };
}

describe('journal model: quests that ended', () => {
  it('AC-2: a failed quest is under Completed / Failed with its failure entry, and its successor is under Active', () => {
    const model = buildJournal(fakeSources());
    expect(model.done[0]).toMatchObject({
      id: 'lost',
      status: JOURNAL_STATUS.failed,
      paragraphs: ['It is gone for good.'],
    });
    expect(model.active.map((e) => e.id)).toEqual(['found', 'plain']);
    expect(model.active[0]?.paragraphs).toEqual(['The trail is warm.']);
    expect(model.active[1]?.paragraphs).toEqual(['Just this.']);
  });

  it('AC-2: a resolved quest shows its resolution entry; one that names none falls back to its summary', () => {
    const model = buildJournal(fakeSources());
    expect(model.done.map((e) => [e.id, e.status, e.paragraphs])).toEqual([
      ['lost', JOURNAL_STATUS.failed, ['It is gone for good.']],
      ['won', JOURNAL_STATUS.resolved, ['It went cleanly.']],
      ['odd', JOURNAL_STATUS.resolved, ['No journal entry named.']],
    ]);
  });

  it('AC-1: objectives list as prose with checks; optional ones are marked and hidden ones wait', () => {
    const model = buildJournal(fakeSources());
    expect(model.active[0]?.objectives).toEqual([
      { text: 'Do b.', done: true, optional: false },
      { text: 'Do c.', done: false, optional: true },
    ]);
    // A failed quest keeps only what was done (nothing), not the objectives it never finished.
    expect(model.done[0]?.objectives).toEqual([]);
  });

  it('a failure the quest names no entry for falls back to the summary', () => {
    const sources = fakeSources();
    const quests = { ...sources.quests, failure: () => undefined } as JournalSources['quests'];
    expect(buildJournal({ ...sources, quests }).done[0]?.paragraphs).toEqual(['Find it.']);
  });
});

describe('journal notes without matching narration', () => {
  it('a class beat the narration does not have is skipped; one with no title is a plain note', () => {
    const t = setup();
    t.world.facts.set('player.class', 'archer');
    expect(buildJournal({ ...t.sources(), narrations: [] }).notes).toEqual([]);
    const untitled = {
      kind: 'class-beat',
      sequences: [{ id: 'first-journal', pages: [{ text: 'Plain.' }] }],
    } as unknown as Narration;
    expect(buildJournal({ ...t.sources(), narrations: [untitled] }).notes).toEqual([
      { id: 'class-beat-first-journal', title: 'A note', paragraphs: ['Plain.'] },
    ]);
  });
});

describe('journal controller', () => {
  function controller(canOpen = true) {
    const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    const published: string[] = [];
    const model: JournalModel = { active: [], done: [], rumours: [], notes: [] };
    const build = vi.fn(() => model);
    const c = new JournalController({
      ui,
      canOpen: () => canOpen,
      keys: () => ['KeyJ'],
      model: build,
      publish: (s) => published.push(s),
    });
    return { ui, c, published, build };
  }

  it('does not open by itself; open builds the model fresh and pauses the sim', () => {
    const { ui, c, published, build } = controller();
    expect(c.isOpen).toBe(false);
    expect(published).toEqual(['closed']);
    expect(build).not.toHaveBeenCalled();
    expect(c.open('rumours')).toBe(true);
    expect(ui.pausesSim).toBe(true);
    expect(published).toEqual(['closed', 'open']);
    expect(find('[role="tab"][aria-selected="true"]').textContent).toBe('Rumours');
    expect(c.open()).toBe(false);
    c.close();
    expect(c.isOpen).toBe(false);
    expect(published.at(-1)).toBe('closed');
    c.close();
    c.open();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('toggle opens, then closes while the journal is on top', () => {
    const { ui, c } = controller();
    c.toggle();
    expect(c.isOpen).toBe(true);
    c.toggle();
    expect(c.isOpen).toBe(false);
    expect(ui.top).toBeUndefined();
  });

  it('the journal key on the window closes it while open and ignores repeats and other keys', () => {
    const { ui, c } = controller();
    expect(c.keydown({ code: 'KeyJ', repeat: false })).toBe(false);
    expect(c.isOpen).toBe(false);
    c.open();
    expect(c.keydown({ code: 'KeyJ', repeat: true })).toBe(false);
    expect(c.keydown({ code: 'KeyX', repeat: false })).toBe(false);
    expect(c.isOpen).toBe(true);
    expect(c.keydown({ code: 'KeyJ', repeat: false })).toBe(true);
    expect(c.isOpen).toBe(false);
    expect(ui.top).toBeUndefined();
  });

  it('refuses while the game cannot open it, or another screen is open, unless opened over', () => {
    const blocked = controller(false);
    expect(blocked.c.open()).toBe(false);
    blocked.c.toggle();
    expect(blocked.c.isOpen).toBe(false);
    const { ui, c } = controller();
    const other = ui.push({ id: 'pause', label: 'Paused', content: document.createElement('div') });
    expect(c.open()).toBe(false);
    expect(c.open(undefined, true)).toBe(true);
    // Toggle while something is on top of the journal does not close it from underneath.
    ui.push({ id: 'over', label: 'Over', content: document.createElement('div') });
    c.toggle();
    expect(c.isOpen).toBe(true);
    other.close();
  });
});
