// @vitest-environment happy-dom
// The class arrival and class beats in the game (mw-aw1y): the real narration content, the UI root and
// the glue. A class chosen at the front door opens the arrival pages and the first journal entry; a
// beat with a built trigger shows the class's text once.
import { loadGameContent } from '@content/index';
import { classBeat, type Narration } from '@content/types/narration';
import {
  addCapabilities,
  addInventory,
  CapabilityRegistry,
  InventoryRules,
  World,
} from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { installGameLogic, questsOf } from '../logic/install';
import {
  beatShownFact,
  CLASS_BEAT_SCREEN,
  ClassBeatController,
  OPENING_BEAT,
  startClassBeatUi,
  type ClassBeatReading,
} from './class-beats';

const content = loadGameContent();
const MAIN = 'quest-labyrinth-beneath-briar-glen';
const narrations = content.all('narration') as readonly Narration[];

beforeEach(() => {
  document.body.innerHTML = '';
});

function failSetup(): never {
  throw new Error('the game content has quests');
}

function setup(playerClass: string | null = 'archer', triggers = true) {
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
  if (playerClass !== null) world.facts.set('player.class', playerClass);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: ClassBeatReading[] = [];
  const beats = startClassBeatUi({
    ui,
    world,
    quests,
    content,
    triggers,
    publish: (_key, value) => published.push(JSON.parse(value) as ClassBeatReading),
  });
  const step = () => {
    world.step();
    quests.update();
    beats.afterStep();
  };
  return { world, quests, ui, beats, published, step };
}

const counter = () => find('[data-testid="epilogue-counter"]').textContent;
const bodyText = () => find('[data-testid="epilogue-body"]').textContent;
const pageTexts = (beat: string, playerClass: string) =>
  classBeat(narrations, beat, playerClass)?.pages.map((p) => p.text) ?? [];

describe('class arrival (mw-aw1y)', () => {
  it('AC-1: nothing opens at boot, and a boot into a class sets no fact but player.class', () => {
    const t = setup();
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)).toEqual({ open: false, beat: null, shown: [], ended: null });
    expect(t.world.facts.snapshot()).toEqual({ 'player.class': 'archer' });
  });

  it.each(['knight', 'archer', 'sorcerer', 'thief'])(
    "AC-1: %s's new game plays its own arrival pages, then the first journal entry last, pausing the sim",
    (playerClass) => {
      const t = setup(playerClass);
      t.beats.controller.startNewGame();
      t.step();
      const arrival = pageTexts('arrival', playerClass);
      const journal = pageTexts('first-journal', playerClass);
      expect(t.ui.top?.id).toBe(CLASS_BEAT_SCREEN);
      expect(t.ui.pausesSim).toBe(true);
      expect(t.published.at(-1)).toMatchObject({ open: true, beat: OPENING_BEAT });
      const total = arrival.length + journal.length;
      expect(counter()).toBe(`Page 1 of ${String(total)}`);
      const seen = [bodyText()];
      for (let i = 1; i < total; i += 1) {
        t.ui.intent('tabNext', 'keyboard');
        seen.push(bodyText());
      }
      expect(seen).toEqual(
        [...arrival, ...journal].map((text) => text.replace(/\s*\n\s*\n\s*/g, '')),
      );
      expect(find('[data-testid="epilogue-title"]').textContent).toBe('Journal: first entry');
      t.ui.intent('tabNext', 'keyboard');
      expect(t.ui.top).toBeUndefined();
      expect(t.published.at(-1)).toMatchObject({ open: false, ended: 'finished' });
    },
  );

  it('AC-1: the opening can be skipped, waits for another screen to close and plays only once', () => {
    const t = setup();
    t.beats.controller.startNewGame();
    const other = t.ui.push({
      id: 'other',
      label: 'Other',
      content: document.createElement('div'),
    });
    t.step();
    expect(t.ui.top?.id).toBe('other');
    other.close();
    t.step();
    expect(t.beats.controller.isOpen).toBe(true);
    t.ui.intent('back', 'keyboard');
    expect(t.published.at(-1)).toMatchObject({ open: false, ended: 'skipped' });
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)?.shown).toEqual([OPENING_BEAT]);
  });

  it('AC-1: a class with no text for a beat opens nothing and still ends cleanly', () => {
    const t = setup();
    const empty = new ClassBeatController({
      ui: t.ui,
      world: t.world,
      quests: t.quests,
      content: { all: () => [] },
    });
    empty.startNewGame();
    empty.afterStep();
    expect(empty.isOpen).toBe(false);
    expect(t.ui.top).toBeUndefined();
    empty.dispose();
  });
});

describe('class beats at existing triggers (mw-aw1y)', () => {
  it('AC-2: wendmouth.visited shows the class text once and sets its fact', () => {
    const t = setup('sorcerer');
    t.step();
    expect(t.ui.top).toBeUndefined();
    t.world.facts.set('wendmouth.visited', true);
    t.step();
    expect(t.ui.top?.id).toBe(CLASS_BEAT_SCREEN);
    expect(bodyText()).toBe(pageTexts('wendmouth', 'sorcerer')[0]);
    expect(find('[data-testid="epilogue-title"]').textContent).toBe('Wendmouth, your way');
    expect(t.world.facts.get(beatShownFact('wendmouth'))).toBe(true);
    t.beats.controller.close();
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)?.shown).toEqual(['wendmouth']);
  });

  it('AC-2: a debug scene boot (triggers off) shows no beat, though wendmouth.visited is set at once', () => {
    const t = setup('sorcerer', false);
    t.world.facts.set('wendmouth.visited', true);
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.world.facts.get(beatShownFact('wendmouth'))).toBe(false);
    t.beats.controller.startNewGame();
    t.step();
    expect(t.ui.top?.id).toBe(CLASS_BEAT_SCREEN);
  });

  it.each([
    ['knight', 'enter-by-supply-tunnel'],
    ['archer', 'enter-by-winch-cage'],
    ['sorcerer', 'enter-by-inner-bar'],
  ])("AC-2: %s's own way in (%s) shows its getting-in text once", (playerClass, objective) => {
    const t = setup(playerClass);
    t.world.facts.set('briar-glen.arrived', true);
    t.step();
    expect(t.ui.top).toBeUndefined();
    t.quests.completeObjective(MAIN, objective);
    t.step();
    expect(bodyText()).toBe(pageTexts('getting-in', playerClass)[0]);
    t.beats.controller.close();
    t.quests.completeObjective(MAIN, 'enter-by-weeping-adit');
    t.step();
    expect(t.ui.top).toBeUndefined();
    expect(t.world.facts.get(beatShownFact('getting-in'))).toBe(true);
  });

  it("AC-2: a class's other ways in do not show its text, and the thief's is the Vane House roof", () => {
    const knight = setup('knight');
    knight.world.facts.set('briar-glen.arrived', true);
    knight.step();
    knight.quests.completeObjective(MAIN, 'enter-by-winch-cage');
    knight.step();
    expect(knight.ui.top).toBeUndefined();
    const thief = setup('thief');
    thief.step();
    thief.world.facts.set('world.vane-house.roof-entered', true);
    thief.step();
    expect(bodyText()).toBe(pageTexts('getting-in', 'thief')[0]);
  });

  it('AC-2: with no class chosen, the way-in trigger never fires', () => {
    const t = setup(null);
    t.world.facts.set('briar-glen.arrived', true);
    t.step();
    t.quests.completeObjective(MAIN, 'enter-by-supply-tunnel');
    t.step();
    expect(t.ui.top).toBeUndefined();
  });
});
