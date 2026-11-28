// @vitest-environment happy-dom
// Reading a book in the reader (mw-e07.9): the model a book item becomes, the Study button's state from
// the sim, and the controller that opens the reader from the pack and keeps it true.
import { loadItemFixtureContent } from '@content/test-fixtures';
import type { GameContent } from '@content/index';
import {
  addInventory,
  addStudent,
  BrainComponent,
  DEFAULT_CLOCK_CONFIG,
  installGameClock,
  installStudy,
  InventoryRules,
  inventoryOf,
  isInventoryActionCommand,
  PlacementComponent,
  placeEntity,
  PlayerClassComponent,
  SpellLearned,
  StudyEnded,
  StudyStarted,
  TagsComponent,
  tagEntity,
  World,
  type Brain,
  type EntityId,
  type InventoryActionCommand,
} from '@sim/index';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityRegistry, createUnlockBook } from '../capabilities';
import {
  BOOK_READER_REASONS,
  BookReaderController,
  bookModel,
  studyView,
  type BookReaderContent,
} from './book-reader';
import { STUDY_INTERRUPTIONS } from './inventory-screen';
import { createStudyRules, isOpenableBook, type BookItem } from './book-study';

const base = loadItemFixtureContent();
const primer = base.get('item', 'fixture-primer') as BookItem;

/** A book like the primer with its book block changed. */
const bookLike = (id: string, book: Partial<BookItem['book']>): BookItem => ({
  ...primer,
  id,
  book: { ...primer.book, ...book },
});

const TEXTS = [
  {
    id: 'book-test-ledger',
    pages: [{ text: 'Page one.' }, { text: 'Page two.' }, { text: 'Page three.' }],
  },
];

/** Content with story book texts, and the fixture spell optionally changed. */
function fakeContent(spell?: Record<string, unknown>): BookReaderContent {
  return {
    all: ((type: string) =>
      type === 'book' ? TEXTS : base.all(type as 'item')) as GameContent['all'],
    get: ((type: string, id: string) =>
      type === 'spell' && spell !== undefined
        ? { ...base.get('spell', id), ...spell }
        : base.get(type as 'item', id)) as GameContent['get'],
  };
}

describe('the model of a book (mw-e07.9)', () => {
  it('AC-1: pages come from the story book text, by page key', () => {
    const item = bookLike('book-test-ledger', {
      pages: [1, 2, 3].map((n) => ({ textKey: `book.book-test-ledger.page-${String(n)}` })),
      language: 'common',
      legality: 'licensed',
    });
    const model = bookModel(item, fakeContent(), undefined);
    expect(model.title).toBe('A Primer of Bolts');
    expect(model.author).toBe('Tamsin Reed');
    expect(model.pages).toEqual([
      { text: 'Page one.' },
      { text: 'Page two.' },
      { text: 'Page three.' },
    ]);
    expect(model).not.toHaveProperty('garbled');
    expect(model).not.toHaveProperty('warning');
    expect(model).not.toHaveProperty('study');
  });

  it("AC-2: a damaged book's missing pages are torn, and a page with no text yet reads illegible", () => {
    const item = bookLike('book-test-ledger', {
      pages: [
        { textKey: 'book.book-test-ledger.page-1' },
        { textKey: 'book.book-test-ledger.page-2' },
        { textKey: 'item.unwritten.text' },
      ],
      condition: { state: 'damaged', missingPages: [1] },
    });
    expect(bookModel(item, fakeContent(), undefined).pages).toEqual([
      { text: 'Page one.' },
      { missing: true },
      { text: '[illegible]' },
    ]);
  });

  it('garbles a language the reader cannot read, warns of a forbidden book and carries the study state', () => {
    const item = bookLike('book-test-ledger', { language: 'vesperine', legality: 'forbidden' });
    const model = bookModel(item, fakeContent(), { minutes: 30 });
    expect(model.garbled).toBe(true);
    expect(model.warning).toMatch(/^Forbidden\./);
    expect(model.study).toEqual({ minutes: 30 });
    expect(bookModel(item, fakeContent(), undefined, ['common', 'vesperine'])).not.toHaveProperty(
      'garbled',
    );
  });

  it('opens tomes and notes but not a scroll or a non-book', () => {
    expect(isOpenableBook(primer)).toBe(true);
    expect(isOpenableBook(bookLike('scroll', { kind: 'scroll' }))).toBe(false);
    expect(isOpenableBook(base.get('item', 'fixture-sword'))).toBe(false);
  });
});

interface Rig {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly ui: UiRoot;
  readonly queue: InventoryActionCommand[];
  readonly controller: BookReaderController;
  readonly changes: boolean[];
  readonly rules: ReturnType<typeof createStudyRules>;
  readonly instanceId: number;
  readonly step: () => void;
}

function rig(
  options: {
    klass?: string | null;
    matchMedia?: boolean;
    placed?: boolean;
    content?: BookReaderContent;
    give?: string;
  } = {},
): Rig {
  const registry = createCapabilityRegistry(base, true);
  const rules = createStudyRules(base, registry, createUnlockBook(base, registry));
  const world = new World<never>({ seed: 1 });
  installGameClock(world, DEFAULT_CLOCK_CONFIG);
  world.register(PlayerClassComponent, PlacementComponent, TagsComponent, BrainComponent);
  installStudy(world, rules);
  const player = world.spawn();
  addInventory(world, player);
  addStudent(world, player);
  if (options.klass !== null) {
    world.add(player, PlayerClassComponent, { classId: options.klass ?? 'sorcerer' });
  }
  if (options.placed !== false) placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  world.step();
  const added = new InventoryRules(base.all('item')).add(
    world,
    player,
    options.give ?? 'fixture-primer',
    1,
  );
  if (!added.ok) throw new Error(added.reason);
  world.step();
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const queue: InventoryActionCommand[] = [];
  const changes: boolean[] = [];
  const controller = new BookReaderController({
    ui,
    world,
    player,
    content: options.content ?? fakeContent(),
    study: rules,
    submit: (command) => queue.push(command),
    ...(options.matchMedia === true && { matchMedia: () => ({ matches: true }) }),
    onChange: (open) => changes.push(open),
  });
  const instanceId = inventoryOf(world, player)?.items[0]?.instanceId ?? -1;
  return {
    world,
    player,
    ui,
    queue,
    controller,
    changes,
    rules,
    instanceId,
    step: () => {
      world.step(queue.splice(0) as never[]);
      controller.afterStep();
    },
  };
}

const BRAIN = (state: string): Brain => ({ state }) as Brain;

function creature(world: World<never>, state: string, x: number): void {
  const id = world.spawn();
  world.add(id, BrainComponent, BRAIN(state));
  placeEntity(world, id, { x, y: 0, z: 0 }, 0.5);
}

describe('the Study button state from the sim (mw-e07.9)', () => {
  it("AC-3: the estimate is the sim's remaining minutes, the desk bonus and progress included", () => {
    const { world, player, rules } = rig();
    expect(studyView(world, player, primer, rules, fakeContent())).toEqual({ minutes: 30 });
    const desk = world.spawn();
    placeEntity(world, desk, { x: 1, y: 0, z: 0 }, 0.5);
    tagEntity(world, desk, 'desk');
    world.step();
    const far = world.spawn();
    placeEntity(world, far, { x: 50, y: 0, z: 0 }, 0.5);
    tagEntity(world, far, 'desk');
    world.step();
    const view = studyView(world, player, primer, rules, fakeContent());
    expect(view).toEqual({ minutes: 20 });
    // It is the figure `start` itself reports.
    const started = rules.start(world, player, primer.id);
    expect(started).toEqual({ status: 'started', minutesLeft: view?.minutes });
  });

  it('AC-3: progress already made shortens the estimate', () => {
    const { world, player, rules, step } = rig();
    rules.start(world, player, primer.id);
    for (let i = 0; i < 31; i++) step();
    rules.cancel(world, player);
    step();
    expect(studyView(world, player, primer, rules, fakeContent())).toEqual({ minutes: 25 });
  });

  it('AC-4: an Alerted or fighting creature close by blocks study; a calm or far one does not', () => {
    const { world, player, rules } = rig();
    creature(world, 'idle', 3);
    creature(world, 'alerted', 100);
    world.step();
    expect(studyView(world, player, primer, rules, fakeContent())).toEqual({ minutes: 30 });
    creature(world, 'combat', 5);
    world.step();
    expect(studyView(world, player, primer, rules, fakeContent())).toEqual({
      minutes: 30,
      blocked: BOOK_READER_REASONS.unsafe,
    });
  });

  it("blocks a book the reader's class cannot learn, and a second session", () => {
    const hard = rig({ klass: 'knight', content: fakeContent({ tier: 2 }) });
    expect(
      studyView(hard.world, hard.player, primer, hard.rules, fakeContent({ tier: 2 })),
    ).toEqual({
      minutes: 30,
      blocked: BOOK_READER_REASONS.class,
    });
    const easy = rig({ klass: 'knight' });
    expect(studyView(easy.world, easy.player, primer, easy.rules, fakeContent())).toEqual({
      minutes: 30,
    });
    easy.rules.start(easy.world, easy.player, primer.id);
    expect(studyView(easy.world, easy.player, primer, easy.rules, fakeContent())).toEqual({
      minutes: 30,
      blocked: BOOK_READER_REASONS.busy,
    });
  });

  it('blocks a reader with no class from a book only a class may learn', () => {
    const { world, player, rules } = rig({ klass: null });
    const content = fakeContent({ tier: 2 });
    expect(studyView(world, player, primer, rules, content)?.blocked).toBe(
      BOOK_READER_REASONS.class,
    );
  });

  it('says a book is already known once its spell is learned, and shows nothing for lore', () => {
    const { world, player, rules, step } = rig();
    rules.start(world, player, primer.id);
    for (let i = 0; i < 400; i++) step();
    const view = studyView(world, player, primer, rules, fakeContent());
    expect(view?.known).toBe(true);
    const lore = bookLike('lore', { teaches: { kind: 'lore' } });
    expect(studyView(world, player, lore, rules, fakeContent())).toBeUndefined();
  });

  it('works for a reader with no place in the world', () => {
    const { world, player, rules } = rig({ placed: false });
    expect(studyView(world, player, primer, rules, fakeContent())).toEqual({ minutes: 30 });
  });
});

describe('the book reader controller (mw-e07.9)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("AC-5: opens the pack's book, then closes with the keyboard", () => {
    const { controller, ui, changes, instanceId } = rig();
    expect(controller.isOpen).toBe(false);
    expect(controller.open(instanceId)).toBe(true);
    expect(controller.isOpen).toBe(true);
    expect(ui.top?.id).toBe('book-reader');
    expect(find('h1').textContent).toBe('A Primer of Bolts');
    expect(controller.open(instanceId)).toBe(false);
    ui.intent('back', 'keyboard');
    expect(controller.isOpen).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('hands the OS reduced-motion query to the reader when it has one', () => {
    const { controller, instanceId } = rig({ matchMedia: true });
    expect(controller.open(instanceId)).toBe(true);
  });

  it('refuses a stack that is not in the pack or is not a book', () => {
    const { controller } = rig();
    expect(controller.open(9999)).toBe(false);
    const sword = rig({ give: 'fixture-sword' });
    expect(sword.controller.open(sword.instanceId)).toBe(false);
  });

  it("AC-3: Study submits the pack's study command, and the status line follows the session", () => {
    const { controller, ui, queue, step, instanceId, player, world, rules } = rig();
    controller.open(instanceId);
    const studyButton = find('[data-action="study"]') as HTMLButtonElement;
    expect(studyButton.textContent).toBe('Study (30 min)');
    studyButton.click();
    expect(queue).toHaveLength(1);
    expect(isInventoryActionCommand(queue[0])).toBe(true);
    expect(queue[0]).toMatchObject({ actor: player, action: { op: 'study', instanceId } });
    // The pack's action system is not installed here, so play the command's effect by hand.
    queue.length = 0;
    rules.start(world, player, primer.id);
    step();
    const status = (): string => find('[data-testid="book-status"]').textContent;
    expect(status()).toMatch(/^You settle down to study/);
    expect(studyButton.disabled).toBe(true);
    expect(studyButton.title).toBe(BOOK_READER_REASONS.busy);
    // A creature turns up: the session ends and the reader says why.
    creature(world, 'combat', 4);
    step();
    step();
    expect(status()).toBe(STUDY_INTERRUPTIONS['threat']);
    expect(studyButton.title).toBe(BOOK_READER_REASONS.unsafe);
    expect(ui.top?.id).toBe('book-reader');
  });

  it('says it when the spell is learned, known already, or the session resumes; ignores others', () => {
    const { controller, world, player, instanceId, step } = rig();
    expect(() => {
      world.events.emit(StudyStarted, { tick: 0, actor: player, book: primer.id, progress: 0 });
    }).not.toThrow();
    controller.open(instanceId);
    const status = (): string => find('[data-testid="book-status"]').textContent;
    const emit = (actor: EntityId, book: string, progress = 0) => {
      world.events.emit(StudyStarted, { tick: 0, actor, book, progress });
      step();
    };
    emit(player, primer.id, 0.5);
    expect(status()).toMatch(/where you left off/);
    emit(player, 'another-book');
    emit(player + 99, primer.id);
    expect(status()).toMatch(/where you left off/);
    const ended = (outcome: 'known' | 'learned' | 'cancelled' | 'interrupted', reason?: string) => {
      world.events.emit(StudyEnded, {
        tick: 0,
        actor: player,
        book: primer.id,
        outcome,
        ...(reason !== undefined && { reason }),
        progress: 1,
      });
      step();
    };
    ended('learned');
    ended('cancelled');
    expect(status()).toMatch(/where you left off/);
    ended('known');
    expect(status()).toBe('You already know what this book teaches.');
    ended('interrupted');
    expect(status()).toBe('You stop studying.');
    ended('interrupted', 'no-such-reason');
    expect(status()).toBe('You stop studying.');
    world.events.emit(SpellLearned, { tick: 0, actor: player + 99, spellId: 'x', source: 'y' });
    step();
    expect(status()).toBe('You stop studying.');
    world.events.emit(SpellLearned, { tick: 0, actor: player, spellId: 'x', source: 'y' });
    step();
    expect(status()).toMatch(/^You have learned/);
  });

  it('afterStep changes nothing without a reader open or when the state is unchanged; dispose closes', () => {
    const { controller, ui, step, instanceId, changes } = rig();
    step();
    controller.open(instanceId);
    step();
    step();
    expect(find('[data-action="study"]').textContent).toBe('Study (30 min)');
    controller.dispose();
    expect(ui.top).toBeUndefined();
    expect(changes).toEqual([true, false]);
    controller.close();
  });
});
