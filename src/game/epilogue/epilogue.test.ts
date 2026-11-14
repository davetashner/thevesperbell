// @vitest-environment happy-dom
// The epilogue slideshow in the game (mw-e39.40): the real content and quests, the UI root and the
// glue. The main quest resolving starts the epilogue quest; the slideshow plays its card and slides,
// completes their objectives, and sets epilogue.finished.
import { loadGameContent } from '@content/index';
import {
  addCapabilities,
  addInventory,
  CapabilityRegistry,
  InventoryRules,
  World,
} from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFactRegistry } from '../facts';
import { logicEmitted } from '../logic/host';
import { installGameLogic, questsOf } from '../logic/install';
import {
  ENDING_FACT,
  EPILOGUE_FINISHED_FACT,
  EPILOGUE_QUEST,
  EpilogueController,
  epilogueSlideEvent,
  startEpilogueUi,
  type EpilogueReading,
} from './epilogue';

const content = loadGameContent();
const MAIN = 'quest-labyrinth-beneath-briar-glen';

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
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: EpilogueReading[] = [];
  const epilogue = startEpilogueUi({
    ui,
    world,
    quests,
    content,
    publish: (_key, value) => published.push(JSON.parse(value) as EpilogueReading),
  });
  const step = () => {
    world.step();
    epilogue.afterStep();
  };
  /** Resolves the main quest as the Vespers rung with the goblins friendly and Tansy saved. */
  const resolveMain = () => {
    world.facts.set('player.class', 'archer');
    world.facts.set('briar-glen.arrived', true);
    world.step();
    quests.update();
    quests.completeObjective(MAIN, 'return-to-briar-glen');
    for (const [key, value] of Object.entries({
      'horn.fate': 'alive',
      'abbot.fate': 'at-rest',
      'vane.fate': 'confessed',
      'goblins.standing': 'friendly',
      'tansy.saved': true,
      'bell.rung': 'rung',
    })) {
      world.facts.set(key, value);
    }
    quests.resolveQuest(MAIN, 'vespers-rung');
    world.step();
    quests.update();
  };
  return { world, quests, ui, epilogue, published, step, resolveMain };
}

const title = () => find('[data-testid="epilogue-title"]').textContent;
const counter = () => find('[data-testid="epilogue-counter"]').textContent;
const press = (t: ReturnType<typeof setup>) => {
  t.ui.intent('tabNext', 'keyboard');
};

describe('epilogue slideshow glue (mw-e39.40)', () => {
  it('AC-1: nothing opens before the epilogue quest starts', () => {
    const t = setup();
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)).toEqual({ open: false, slide: null, preview: false, ended: null });
  });

  it('AC-1: the main quest resolving opens the slideshow on the ending card, then the slides in order', () => {
    const t = setup();
    t.resolveMain();
    expect(t.world.facts.get(ENDING_FACT)).toBe('vespers-rung');
    expect(t.quests.questState(EPILOGUE_QUEST)).toBe('active');
    const active = t.quests
      .activeObjectives()
      .filter((o) => o.quest === EPILOGUE_QUEST)
      .map((o) => o.objective.id);
    expect(active.length).toBeGreaterThanOrEqual(3);
    t.step();
    expect(t.epilogue.controller.isOpen).toBe(true);
    expect(t.ui.pausesSim).toBe(true);
    const total = active.length + 1;
    expect(counter()).toBe(`Slide 1 of ${String(total)}`);
    expect(title()).not.toBe('');
    expect(t.published.at(-1)).toMatchObject({ open: true, slide: 'ending-vespers-rung' });
    const seen: (string | null)[] = [];
    active.forEach(() => {
      press(t);
      seen.push(t.published.at(-1)?.slide ?? null);
    });
    expect(seen).toEqual(active);
  });

  it('AC-2: each slide shown completes its objective; the last advance sets epilogue.finished and resolves the quest', () => {
    const t = setup();
    t.resolveMain();
    t.step();
    const [first] = t.quests
      .activeObjectives()
      .filter((o) => o.quest === EPILOGUE_QUEST)
      .map((o) => o.objective.id);
    press(t);
    // The sim is paused while the slideshow is open: the event is delivered on the next step.
    t.world.step();
    expect(t.quests.objectiveState(EPILOGUE_QUEST, String(first))).toBe('complete');
    while (t.ui.top !== undefined) press(t);
    expect(t.world.facts.get(EPILOGUE_FINISHED_FACT)).toBe(true);
    expect(t.published.at(-1)).toMatchObject({ open: false, ended: 'finished' });
    t.world.step();
    t.quests.update();
    expect(t.quests.questState(EPILOGUE_QUEST)).toBe('resolved');
    t.step();
    expect(t.ui.top).toBeUndefined();
  });

  it('AC-3: skipping publishes the slides not yet shown, sets epilogue.finished and returns to free roam', () => {
    const t = setup();
    t.resolveMain();
    const ids = t.quests
      .activeObjectives()
      .filter((o) => o.quest === EPILOGUE_QUEST)
      .map((o) => o.objective.id);
    t.step();
    t.ui.intent('back', 'gamepad');
    expect(t.ui.top).toBeUndefined();
    expect(t.world.facts.get(EPILOGUE_FINISHED_FACT)).toBe(true);
    t.world.step();
    for (const id of ids) expect(t.quests.objectiveState(EPILOGUE_QUEST, id)).toBe('complete');
    expect(t.published.at(-1)).toMatchObject({ open: false, ended: 'skipped' });
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(epilogueSlideEvent(String(ids[0]))).toBe(`epilogue-slide-${String(ids[0])}`);
  });

  it('AC-4: a slideshow already finished does not play again while the quest is still active', () => {
    const t = setup();
    t.resolveMain();
    t.world.facts.set(EPILOGUE_FINISHED_FACT, true);
    t.epilogue.afterStep();
    expect(t.ui.top).toBeUndefined();
  });

  it('AC-4: it waits for any open screen, and a quest with no text finishes without opening', () => {
    const t = setup();
    t.resolveMain();
    const blocker = t.ui.push({
      id: 'other',
      label: 'Other',
      content: document.createElement('p'),
    });
    t.step();
    expect(t.epilogue.controller.isOpen).toBe(false);
    blocker.close();
    t.step();
    expect(t.epilogue.controller.isOpen).toBe(true);
    t.step();
    expect(t.epilogue.controller.isOpen).toBe(true);
    t.epilogue.controller.close();
    expect(t.epilogue.controller.isOpen).toBe(false);
    t.epilogue.controller.dispose();
  });

  it('AC-4: an unknown ending still plays the slides, and with no slides at all it finishes at once', () => {
    const t = setup();
    t.resolveMain();
    t.world.facts.set(ENDING_FACT, 'none');
    const ids = ['vr-bell-goblins', 'no-such-slide'];
    const stub = new EpilogueController({
      ui: t.ui,
      world: t.world,
      quests: {
        questState: () => 'active',
        activeObjectives: () =>
          ids.map((id) => ({ quest: EPILOGUE_QUEST, objective: { id } }) as never),
      },
      content,
    });
    t.world.facts.set(EPILOGUE_FINISHED_FACT, false);
    stub.afterStep();
    expect(counter()).toBe('Slide 1 of 1');
    expect(t.ui.top?.id).toBe('epilogue');
    stub.close();

    const empty = setup();
    empty.resolveMain();
    const none = new EpilogueController({
      ui: empty.ui,
      world: empty.world,
      quests: { questState: () => 'active', activeObjectives: () => [] },
      content: { all: () => [], get: content.get.bind(content) },
    });
    empty.world.facts.set(EPILOGUE_FINISHED_FACT, false);
    none.afterStep();
    expect(none.isOpen).toBe(false);
    expect(empty.world.facts.get(EPILOGUE_FINISHED_FACT)).toBe(true);
  });

  it('AC-5: a preview plays the card and every slide an ending can show, changing nothing', () => {
    const t = setup();
    const emitted = vi.fn();
    t.world.events.on(logicEmitted, emitted);
    expect(t.epilogue.controller.preview('hirelings-silence')).toBe(true);
    expect(t.published.at(-1)).toMatchObject({
      open: true,
      slide: 'ending-hirelings-silence',
      preview: true,
    });
    expect(t.epilogue.controller.preview('last-warden')).toBe(false);
    while (t.ui.top !== undefined) press(t);
    expect(t.world.facts.get(EPILOGUE_FINISHED_FACT)).toBe(false);
    expect(t.published.at(-1)).toMatchObject({ open: false, ended: null });
    expect(emitted).not.toHaveBeenCalled();
    t.ui.push({ id: 'other', label: 'Other', content: document.createElement('p') });
    expect(t.epilogue.controller.preview('long-vespers')).toBe(false);
  });

  it('AC-5: a preview of every ending has a card and at least three slides', () => {
    for (const ending of [
      'vespers-rung',
      'last-warden',
      'hirelings-silence',
      'long-vespers',
    ] as const) {
      const t = setup();
      expect(t.epilogue.controller.preview(ending)).toBe(true);
      const match = /of (\d+)$/.exec(counter());
      expect(Number(match?.[1]), ending).toBeGreaterThanOrEqual(4);
    }
  });

  it('AC-5: a queued preview waits for the open screen (the console) to close, then plays once', () => {
    const t = setup();
    const blocker = t.ui.push({
      id: 'console',
      label: 'Console',
      content: document.createElement('p'),
    });
    t.epilogue.controller.queuePreview('long-vespers');
    t.step();
    expect(t.epilogue.controller.isOpen).toBe(false);
    blocker.close();
    t.step();
    expect(t.published.at(-1)).toMatchObject({
      open: true,
      slide: 'ending-long-vespers',
      preview: true,
    });
    t.epilogue.controller.close();
    t.step();
    expect(t.ui.top).toBeUndefined();
  });

  it('startEpilogueUi works without a publisher', () => {
    const t = setup();
    const bare = startEpilogueUi({ ui: t.ui, world: t.world, quests: t.quests, content });
    bare.afterStep();
    expect(bare.controller.isOpen).toBe(false);
    expect(bare.controller.preview('vespers-rung')).toBe(true);
    bare.controller.dispose();
  });
});
