// @vitest-environment happy-dom
// The journal's notices (mw-e23.6.1, mw-wbr7): the real quest runtime and the real rumour book drive
// the toast, the unread marks and the pinned tracker; the journal window shows the same unread state.
import { loadGameContent } from '@content/index';
import type { QuestDef } from '@content/types/quest';
import {
  addCapabilities,
  addInventory,
  CapabilityRegistry,
  InventoryRules,
  QuestFailed,
  QuestStarted,
  World,
} from '@sim/index';
import { JournalHud, UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { installGameLogic, questsOf } from '../logic/install';
import { logicEmitted } from '../logic/host';
import { RUMOUR_TOLD_EVENT, RumourBook, rumoursOf } from '../rumours/rumours';
import { buildJournal, JournalController, journalSources, MAIN_QUEST } from './journal';
import { JOURNAL_NOTICE_TEXT, JournalNotices } from './journal-notices';

const content = loadGameContent();
const defs = content.all('quest') as unknown as readonly QuestDef[];
const TITLE = content.get('quest', MAIN_QUEST).title;

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup(options: { readonly withRumours?: boolean } = {}) {
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
  const quests = logic.quests;
  if (quests === undefined) throw new Error('the game content has quests');
  const book =
    options.withRumours === true
      ? new RumourBook({
          world,
          rumours: rumoursOf(content),
          quests,
          player: () => player,
          onChange: () => {
            notices.syncRumours();
          },
        })
      : undefined;
  const hud = new JournalHud();
  document.body.append(hud.element);
  let now = 0;
  const model = () =>
    buildJournal(journalSources(content, { quests, facts: world.facts, rumours: book }));
  const notices = new JournalNotices({
    events: world.events,
    defs,
    model,
    hud,
    now: () => now,
    rumours: book,
  });
  const arrive = (): void => {
    world.facts.set('player.class', 'archer');
    world.facts.set('briar-glen.arrived', true);
    world.step();
    quests.update();
  };
  const told = (n: number): void => {
    world.events.emit(logicEmitted, { event: RUMOUR_TOLD_EVENT, data: { rumor: n, source: 'x' } });
    world.step();
  };
  return {
    world,
    quests,
    hud,
    notices,
    model,
    arrive,
    told,
    tick: (ms: number) => {
      now = ms;
      notices.afterStep();
    },
  };
}

const unread = () => find('[data-testid="journal-unread"]');
const tracker = () => find('[data-testid="quest-tracker"]');

describe('journal notices', () => {
  it('AC-3: a quest starting toasts for 3 s or more and marks Active unread until viewed', () => {
    const t = setup();
    expect(unread().hidden).toBe(true);
    t.arrive();
    expect(t.hud.toasts).toContain(`${JOURNAL_NOTICE_TEXT.added}: ${TITLE}`);
    expect(t.notices.unread().active).toEqual([MAIN_QUEST]);
    expect(unread().hidden).toBe(false);
    t.tick(2999);
    expect(t.hud.toasts.length).toBeGreaterThan(0);
    t.tick(10_000);
    expect(t.hud.toasts).toEqual([]);
    // Still unread after the toast went, until the tab is viewed.
    expect(unread().hidden).toBe(false);
    t.notices.viewed('active');
    expect(t.notices.unread()).toEqual({});
    expect(unread().hidden).toBe(true);
  });

  it('AC-3: a completed objective and a new stage are journal updates', () => {
    const t = setup();
    t.arrive();
    t.tick(10_000);
    t.quests.completeObjective(MAIN_QUEST, 'follow-tansy');
    t.world.step();
    expect(t.hud.toasts).toEqual([`${JOURNAL_NOTICE_TEXT.updated}: ${TITLE}`]);
    t.tick(20_000);
    t.quests.setStage(MAIN_QUEST, 'morning');
    t.world.step();
    expect(t.hud.toasts).toEqual([`${JOURNAL_NOTICE_TEXT.updated}: ${TITLE}`]);
  });

  it('AC-3: the journal window shows the unread tab and clears it once viewed', () => {
    const t = setup({ withRumours: true });
    const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    t.told(1);
    t.arrive();
    const journal = new JournalController({
      ui,
      canOpen: () => true,
      keys: () => ['KeyJ'],
      model: t.model,
      unread: () => t.notices.unread(),
      onViewed: (tab) => {
        t.notices.viewed(tab);
      },
    });
    journal.open('notes');
    const tab = (id: string) => find(`[role="tab"][data-tab="${id}"]`);
    expect(tab('active').dataset['unread']).toBe('true');
    expect(tab('rumours').dataset['unread']).toBe('true');
    tab('active').click();
    expect(t.notices.unread().active).toBeUndefined();
    expect(tab('rumours').dataset['unread']).toBe('true');
    journal.close();
    journal.open('rumours');
    expect(t.notices.unread()).toEqual({});
    expect(unread().hidden).toBe(true);
  });

  it('mw-wbr7: a heard rumour is listed in the journal Rumours tab, toasts and is unread', () => {
    const t = setup({ withRumours: true });
    expect(t.model().rumours).toEqual([]);
    t.told(1);
    const [entry] = t.model().rumours;
    expect(entry?.paragraphs[0]).toBeTruthy();
    expect(t.hud.toasts[0]).toBe(`${JOURNAL_NOTICE_TEXT.rumour}: ${entry?.title ?? ''}`);
    expect(t.notices.unread().rumours).toEqual([entry?.id]);
    // The same rumour told again is not news.
    t.told(1);
    expect(t.hud.toasts).toHaveLength(1);
    expect(t.model().rumours).toHaveLength(1);
  });

  it('mw-wbr7: rumours already heard when the notices start are not news', () => {
    const world = new World<never>({ seed: 5 });
    installFactRegistry(world.facts, content, true);
    const player = world.spawn();
    const book = new RumourBook({
      world,
      rumours: rumoursOf(content),
      quests: undefined,
      player: () => player,
    });
    const first = rumoursOf(content)[0];
    book.hear(first?.id ?? '');
    const hud = new JournalHud();
    const notices = new JournalNotices({
      events: world.events,
      defs,
      model: () => ({ active: [], done: [], rumours: [], notes: [] }),
      hud,
      now: () => 0,
      rumours: book,
    });
    notices.syncRumours();
    expect(hud.toasts).toEqual([]);
    expect(notices.unread()).toEqual({});
  });

  it('AC-5: the quest that moved is pinned to the tracker with its open objectives', () => {
    const t = setup();
    expect(tracker().hidden).toBe(true);
    t.arrive();
    expect(tracker().hidden).toBe(false);
    expect(tracker().querySelector('h2')?.textContent).toBe(TITLE);
    const open = tracker().querySelectorAll('li');
    expect(open.length).toBeGreaterThan(0);
    t.quests.completeObjective(MAIN_QUEST, 'reach-briar-glen');
    t.world.step();
    expect(tracker().textContent).not.toContain('Arrive in Briar Glen.');
  });

  it('AC-5: a finished quest leaves the tracker and moves to Completed / Failed unread', () => {
    const t = setup();
    t.arrive();
    t.quests.failQuest(MAIN_QUEST);
    t.world.step();
    t.tick(10_000);
    expect(t.notices.unread().active).toBeUndefined();
    expect(t.notices.unread().done).toEqual([MAIN_QUEST]);
    const stillActive = t.model().active;
    expect(tracker().hidden).toBe(stillActive.length === 0);
  });

  it('AC-5: a resolved quest is a notice too, and an unknown quest id falls back to the id', () => {
    const t = setup();
    t.arrive();
    t.quests.resolveQuest(MAIN_QUEST, undefined);
    t.world.step();
    expect(t.notices.unread().done).toEqual([MAIN_QUEST]);
    // A quest the content lacks still gets a notice, named by its id.
    t.world.events.emit(QuestStarted, { quest: 'ghost-quest' });
    t.world.step();
    expect(t.hud.toasts.at(-1)).toBe(`${JOURNAL_NOTICE_TEXT.added}: ghost-quest`);
  });

  it('AC-5: an entry with no objectives pins with an empty list; ending an unpinned quest keeps the pin', () => {
    const world = new World<never>({ seed: 1 });
    const hud = new JournalHud();
    document.body.append(hud.element);
    const notices = new JournalNotices({
      events: world.events,
      defs: [],
      model: () => ({
        active: [{ id: 'a', title: 'Alpha', paragraphs: [] }],
        done: [],
        rumours: [],
        notes: [],
      }),
      hud,
      now: () => 0,
    });
    notices.syncRumours();
    expect(tracker().querySelector('h2')?.textContent).toBe('Alpha');
    expect(tracker().querySelector('ul')).toBeNull();
    world.events.emit(QuestFailed, { quest: 'elsewhere', failure: undefined });
    world.step();
    expect(tracker().querySelector('h2')?.textContent).toBe('Alpha');
    expect(hud.toasts).toEqual([`${JOURNAL_NOTICE_TEXT.updated}: elsewhere`]);
  });

  it('dispose stops the notices', () => {
    const t = setup();
    t.notices.dispose();
    t.arrive();
    expect(t.hud.toasts).toEqual([]);
  });
});
