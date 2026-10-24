import { describe, expect, it } from 'vitest';
import { BrainComponent, type Brain } from '../ai/components';
import { DamageApplied, type DamageResult } from '../combat/damage/events';
import { World } from '../core/world';
import type { EntityId } from '../core/component';
import { installGameClock } from '../gametime/clock';
import { DEFAULT_CLOCK_CONFIG } from '../gametime/config';
import {
  addCapabilities,
  CapabilityRegistry,
  hasCapability,
  capabilitySources,
} from '../progression/capabilities';
import { PlayerClassComponent } from '../progression/classes';
import { UnlockBook } from '../progression/unlocks';
import { TagsComponent, tagEntity } from '../signals/filter';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { knowsSpell, KnownSpellsComponent } from './components';
import { SpellLearned, SpellLearning, type SpellLearnedInfo } from './learning';
import {
  addStudent,
  installStudy,
  StudyEnded,
  StudyRules,
  StudyStarted,
  studyOf,
  type BookStudyDef,
  type StudyEndedInfo,
  type StudyRulesOptions,
} from './study';

const SORCERER_BOOK: BookStudyDef = {
  id: 'grimoire-of-bolts',
  spell: 'bolt',
  studyMinutes: 60,
  learners: ['sorcerer'],
};
const PRIMER: BookStudyDef = { id: 'primer', spell: 'spark', studyMinutes: 20, learners: 'any' };
const BOOKS = new Map([SORCERER_BOOK, PRIMER].map((book) => [book.id, book]));

/** One slice = 30 ticks = 5 game minutes. */
const SLICE_TICKS = 30;
/** Ticks that credit exactly `n` slices after a start (the first falls one tick later). */
const slices = (n: number): number => SLICE_TICKS * n + 1;

interface Rig {
  readonly world: World<never>;
  readonly rules: StudyRules;
  readonly player: EntityId;
  readonly learned: SpellLearnedInfo[];
  readonly ended: StudyEndedInfo[];
  readonly started: number[];
  readonly step: (ticks: number) => void;
  readonly gameMinutes: () => number;
}

function rig(
  options: Partial<StudyRulesOptions> & {
    readonly klass?: string | null;
    readonly clock?: boolean;
    readonly student?: boolean;
    readonly placed?: boolean;
    readonly brains?: boolean;
    readonly tags?: boolean;
  } = {},
): Rig {
  const world = new World<never>({ seed: 1 });
  const clock = options.clock === false ? undefined : installGameClock(world, DEFAULT_CLOCK_CONFIG);
  const learning = options.learning ?? new SpellLearning();
  const rules = new StudyRules({
    books: (id) => BOOKS.get(id),
    learning,
    ...(options.carries !== undefined && { carries: options.carries }),
    ...(options.config !== undefined && { config: options.config }),
  });
  installStudy(world, rules);
  world.register(PlayerClassComponent, PlacementComponent);
  if (options.tags !== false) world.register(TagsComponent);
  if (options.brains !== false) world.register(BrainComponent);
  const player = world.spawn();
  if (options.student !== false) addStudent(world, player);
  if (options.klass !== null) {
    world.add(player, PlayerClassComponent, { classId: options.klass ?? 'sorcerer' });
  }
  if (options.placed !== false) placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  const learned: SpellLearnedInfo[] = [];
  const ended: StudyEndedInfo[] = [];
  const started: number[] = [];
  world.events.on(SpellLearned, (e) => learned.push(e));
  world.events.on(StudyEnded, (e) => ended.push(e));
  world.events.on(StudyStarted, (e) => started.push(e.progress));
  world.step();
  const total = (): number => clock?.total() ?? 0;
  const origin = total();
  return {
    world,
    rules,
    player,
    learned,
    ended,
    started,
    step: (ticks) => {
      for (let i = 0; i < ticks; i++) world.step();
    },
    gameMinutes: () => total() - origin,
  };
}

/** A creature in `state` at `x`, metres from the reader. */
function creature(world: World<never>, state: string, x: number): EntityId {
  const id = world.spawn();
  world.add(id, BrainComponent, { state } as Brain);
  placeEntity(world, id, { x, y: 0, z: 0 }, 0.5);
  return id;
}

describe('setting up students', () => {
  it('registers what it needs in either order, and keeps spells a student already knows', () => {
    const world = new World<never>({ seed: 1 });
    expect(studyOf(world, 1)).toBeUndefined();
    world.register(KnownSpellsComponent);
    const actor = world.spawn();
    world.add(actor, KnownSpellsComponent, { spells: ['bolt'] });
    addStudent(world, actor);
    installStudy(world, new StudyRules({ books: () => undefined, learning: new SpellLearning() }));
    world.step();
    expect(studyOf(world, actor)).toEqual({ progress: {}, knownBooks: [], session: null });
    expect(knowsSpell(world, actor, 'bolt')).toBe(true);
  });
});

describe('studying a book (mw-e07.2)', () => {
  it('AC-1: 60 minutes of study teaches the spell and fires SpellLearned once', () => {
    const r = rig();
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({
      status: 'started',
      minutesLeft: 60,
    });
    r.step(slices(11));
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
    expect(r.rules.progressOf(r.world, r.player, SORCERER_BOOK.id)).toBeCloseTo(55 / 60);
    r.step(slices(1));
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(true);
    expect(r.gameMinutes()).toBeGreaterThanOrEqual(60);
    expect(r.learned).toEqual([
      {
        tick: expect.any(Number) as number,
        actor: r.player,
        spellId: 'bolt',
        source: SORCERER_BOOK.id,
      },
    ]);
    expect(r.ended).toMatchObject([{ outcome: 'learned', book: SORCERER_BOOK.id, progress: 1 }]);
    expect(r.rules.studying(r.world, r.player)).toBeUndefined();
    expect(r.rules.isKnownBook(r.world, r.player, SORCERER_BOOK.id)).toBe(true);
    expect(studyOf(r.world, r.player)?.progress).toEqual({});
    r.step(slices(3));
    expect(r.learned).toHaveLength(1); // nothing studies on
  });

  it('AC-1: study moves the game clock by exactly the book length', () => {
    const r = rig();
    r.rules.start(r.world, r.player, PRIMER.id);
    const before = r.gameMinutes();
    r.step(slices(4));
    // 20 minutes studied on top of the 600 ticks / 150 the running clock adds on its own.
    expect(r.gameMinutes() - before).toBe(20 + Math.floor(slices(4) / 150));
  });

  it('AC-2: a desk-tagged object within reach gives a 1.5x bonus: 40 minutes finish a 60-minute book', () => {
    const r = rig();
    const desk = r.world.spawn();
    placeEntity(r.world, desk, { x: 1, y: 0, z: 0 }, 0.5);
    tagEntity(r.world, desk, 'desk');
    r.world.step();
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({
      status: 'started',
      minutesLeft: 40,
    });
    r.step(slices(7));
    expect(r.rules.progressOf(r.world, r.player, SORCERER_BOOK.id)).toBeCloseTo(52.5 / 60);
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
    r.step(slices(1));
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(true);
    expect(r.ended[0]?.progress).toBe(1);
  });

  it('a desk out of reach, or a tagged thing that is not a desk, gives no bonus', () => {
    const r = rig();
    const far = r.world.spawn();
    placeEntity(r.world, far, { x: 9, y: 0, z: 0 }, 0.5);
    tagEntity(r.world, far, 'desk');
    const chair = r.world.spawn();
    placeEntity(r.world, chair, { x: 1, y: 0, z: 0 }, 0.5);
    tagEntity(r.world, chair, 'chair');
    r.world.step();
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({ minutesLeft: 60 });
  });

  it('the last slice only takes the minutes that finish the book', () => {
    const r = rig();
    const odd: BookStudyDef = { ...PRIMER, id: 'odd', spell: 'odd', studyMinutes: 12 };
    BOOKS.set('odd', odd);
    r.rules.start(r.world, r.player, 'odd');
    const t0 = r.gameMinutes();
    r.step(slices(3));
    expect(knowsSpell(r.world, r.player, 'odd')).toBe(true);
    expect(r.gameMinutes() - t0).toBe(12 + Math.floor(slices(3) / 150));
    BOOKS.delete('odd');
  });

  it('AC-3: an alerted enemy nearby interrupts at 30 minutes; progress is 50% and resuming needs 30 more', () => {
    const r = rig();
    r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    r.step(slices(6));
    expect(r.rules.progressOf(r.world, r.player, SORCERER_BOOK.id)).toBe(0.5);
    const enemy = creature(r.world, 'alerted', 12);
    r.step(1);
    expect(r.ended).toMatchObject([
      { outcome: 'interrupted', reason: 'threat', progress: 0.5, book: SORCERER_BOOK.id },
    ]);
    expect(r.rules.studying(r.world, r.player)).toBeUndefined();
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
    // Still unsafe while it stands there.
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({
      status: 'refused',
      reason: 'unsafe',
    });
    r.world.set(enemy, BrainComponent, { state: 'unaware' } as Brain);
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({
      status: 'started',
      minutesLeft: 30,
    });
    r.step(slices(5));
    expect(r.started).toEqual([0, 0.5]);
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
    r.step(slices(1));
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(true);
    expect(r.learned).toHaveLength(1);
  });

  it('a far-off or merely suspicious creature does not interrupt', () => {
    const r = rig();
    r.rules.start(r.world, r.player, PRIMER.id);
    creature(r.world, 'combat', 40);
    creature(r.world, 'suspicious', 3);
    r.step(slices(4));
    expect(knowsSpell(r.world, r.player, 'spark')).toBe(true);
  });

  it('a book that vanishes from content ends the session', () => {
    const r = rig();
    BOOKS.set('fleeting', { ...PRIMER, id: 'fleeting', spell: 'fleet' });
    r.rules.start(r.world, r.player, 'fleeting');
    BOOKS.delete('fleeting');
    r.step(2);
    expect(r.ended).toMatchObject([{ outcome: 'interrupted', reason: 'book-gone' }]);
  });

  it('walking away, being hurt, losing the book or cancelling ends the session and keeps progress', () => {
    const walk = rig();
    walk.rules.start(walk.world, walk.player, SORCERER_BOOK.id);
    walk.step(slices(2));
    placeEntity(walk.world, walk.player, { x: 0.5, y: 0, z: 0 }, 0.4);
    walk.step(slices(1)); // within tolerance: carries on
    expect(walk.rules.studying(walk.world, walk.player)).toBe(SORCERER_BOOK.id);
    placeEntity(walk.world, walk.player, { x: 3, y: 0, z: 0 }, 0.4);
    walk.step(1);
    expect(walk.ended).toMatchObject([{ outcome: 'interrupted', reason: 'moved' }]);
    expect(walk.rules.progressOf(walk.world, walk.player, SORCERER_BOOK.id)).toBeCloseTo(15 / 60);

    const hurt = rig();
    hurt.rules.start(hurt.world, hurt.player, SORCERER_BOOK.id);
    hurt.step(slices(1));
    hurt.world.events.emit(DamageApplied, { target: hurt.player } as DamageResult);
    hurt.step(1);
    expect(hurt.ended).toMatchObject([{ outcome: 'interrupted', reason: 'hurt' }]);
    hurt.world.events.emit(DamageApplied, { target: hurt.player } as DamageResult);
    hurt.world.events.emit(DamageApplied, { target: hurt.world.spawn() } as DamageResult);
    hurt.step(1);
    expect(hurt.ended).toHaveLength(1); // nothing to interrupt

    let carried = true;
    const lost = rig({ carries: () => carried });
    lost.rules.start(lost.world, lost.player, SORCERER_BOOK.id);
    lost.step(slices(1));
    carried = false;
    lost.step(1);
    expect(lost.ended).toMatchObject([{ outcome: 'interrupted', reason: 'book-gone' }]);

    const quit = rig();
    expect(quit.rules.cancel(quit.world, quit.player)).toBe(false);
    quit.rules.start(quit.world, quit.player, SORCERER_BOOK.id);
    quit.step(slices(2));
    expect(quit.rules.cancel(quit.world, quit.player)).toBe(true);
    quit.step(1);
    expect(quit.ended).toMatchObject([{ outcome: 'cancelled', progress: 10 / 60 }]);
    quit.step(slices(3));
    expect(quit.rules.progressOf(quit.world, quit.player, SORCERER_BOOK.id)).toBeCloseTo(10 / 60);
  });

  it('AC-4: studying a book whose spell is known learns nothing twice and flags the book', () => {
    const r = rig();
    r.world.set(r.player, KnownSpellsComponent, { spells: ['bolt'] });
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({ status: 'already-known' });
    r.step(1);
    expect(r.rules.isKnownBook(r.world, r.player, SORCERER_BOOK.id)).toBe(true);
    expect(r.learned).toEqual([]);
    expect(r.ended).toMatchObject([{ outcome: 'known', book: SORCERER_BOOK.id }]);
    expect(r.rules.studying(r.world, r.player)).toBeUndefined();
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({ status: 'already-known' });
    expect(studyOf(r.world, r.player)?.knownBooks).toEqual([SORCERER_BOOK.id]);
  });

  it('AC-4: several books of known spells are all flagged, in id order', () => {
    const r = rig();
    r.world.set(r.player, KnownSpellsComponent, { spells: ['bolt', 'spark'] });
    r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    r.rules.start(r.world, r.player, PRIMER.id);
    expect(studyOf(r.world, r.player)?.knownBooks).toEqual([SORCERER_BOOK.id, PRIMER.id]);
  });

  it('AC-4: a spell learned elsewhere mid-study finishes as known, with one SpellLearned', () => {
    const r = rig();
    r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    r.step(slices(3));
    new SpellLearning().learn(r.world, r.player, 'bolt', 'trainer:night-sorcerer');
    r.step(slices(9));
    expect(r.ended).toMatchObject([{ outcome: 'known' }]);
    expect(r.learned).toMatchObject([{ source: 'trainer:night-sorcerer' }]);
    expect(r.rules.isKnownBook(r.world, r.player, SORCERER_BOOK.id)).toBe(true);
  });

  it('AC-5: a knight cannot study a sorcerer-only book: rejected as "class", nothing changes', () => {
    const r = rig({ klass: 'knight' });
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toEqual({
      status: 'refused',
      reason: 'class',
    });
    expect(r.rules.studying(r.world, r.player)).toBeUndefined();
    expect(r.started).toEqual([]);
    r.step(slices(3));
    expect(r.gameMinutes()).toBeLessThan(5);
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
    // A reader with no class yet is no sorcerer either.
    const classless = rig({ klass: null });
    expect(
      classless.rules.start(classless.world, classless.player, SORCERER_BOOK.id),
    ).toMatchObject({
      reason: 'class',
    });
  });

  it('a simple book (learners: any) teaches a knight', () => {
    const r = rig({ klass: 'knight' });
    expect(r.rules.start(r.world, r.player, PRIMER.id)).toMatchObject({ status: 'started' });
    r.step(slices(4));
    expect(knowsSpell(r.world, r.player, 'spark')).toBe(true);
  });

  it('refuses a non-student, an unknown or uncarried book, and a second session', () => {
    const none = rig({ student: false });
    expect(none.rules.start(none.world, none.player, PRIMER.id)).toMatchObject({
      reason: 'not-a-student',
    });
    expect(none.rules.progressOf(none.world, none.player, PRIMER.id)).toBe(0);
    expect(none.rules.isKnownBook(none.world, none.player, PRIMER.id)).toBe(false);
    expect(none.rules.studying(none.world, none.player)).toBeUndefined();
    const r = rig({ carries: (_w, _a, id) => id !== 'primer' });
    expect(r.rules.start(r.world, r.player, 'nope')).toMatchObject({ reason: 'unknown-book' });
    expect(r.rules.progressOf(r.world, r.player, 'nope')).toBe(0);
    expect(r.rules.start(r.world, r.player, PRIMER.id)).toMatchObject({ reason: 'not-carried' });
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({ status: 'started' });
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({ reason: 'busy' });
    const noClock = rig({ clock: false });
    expect(noClock.rules.start(noClock.world, noClock.player, PRIMER.id)).toMatchObject({
      reason: 'no-clock',
    });
  });

  it('a session loaded into a world without a clock ends instead of crediting time', () => {
    const r = rig({ clock: false });
    r.world.set(r.player, studyComponent(), {
      progress: {},
      knownBooks: [],
      session: { book: PRIMER.id, nextSliceTick: 0 },
    });
    r.step(2);
    expect(r.ended).toMatchObject([{ outcome: 'interrupted', reason: 'no-clock' }]);
  });

  it('a world that tags nothing has no desks', () => {
    const r = rig({ tags: false });
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({ minutesLeft: 60 });
  });

  it('a world with no AI has no threats', () => {
    const r = rig({ brains: false });
    r.rules.start(r.world, r.player, PRIMER.id);
    r.step(slices(4));
    expect(knowsSpell(r.world, r.player, 'spark')).toBe(true);
  });

  it('a reader with no placement studies without threat, desk or movement checks', () => {
    const r = rig({ placed: false });
    creature(r.world, 'combat', 1);
    r.world.step();
    r.rules.start(r.world, r.player, PRIMER.id);
    r.step(slices(4));
    expect(knowsSpell(r.world, r.player, 'spark')).toBe(true);
  });

  it('keeps each book’s progress apart, in id order', () => {
    const r = rig();
    r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    r.step(slices(2));
    r.rules.cancel(r.world, r.player);
    r.rules.start(r.world, r.player, PRIMER.id);
    r.step(slices(1));
    r.rules.cancel(r.world, r.player);
    expect(Object.keys(studyOf(r.world, r.player)?.progress ?? {})).toEqual([
      SORCERER_BOOK.id,
      PRIMER.id,
    ]);
    expect(r.rules.progressOf(r.world, r.player, PRIMER.id)).toBeCloseTo(0.25);
  });

  it('refuses a book whose spell has unmet prerequisites, and ends cleanly if they break mid-study', () => {
    const registry = new CapabilityRegistry(['spell.bolt', 'spell.spark']);
    const unlocks = new UnlockBook(
      registry,
      [{ capability: 'spell.bolt', prerequisites: ['spell.spark'], channels: ['book'] }],
      [],
    );
    const r = rig({ learning: new SpellLearning({ capabilities: registry, unlocks }) });
    addCapabilities(r.world, r.player);
    r.world.step();
    const refused = r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    expect(refused).toMatchObject({
      status: 'refused',
      reason: 'prerequisite',
      refusals: [{ reason: 'missing-prerequisite', capability: 'spell.spark' }],
    });
    registry.grant(r.world, r.player, 'spell.spark', 'class');
    expect(r.rules.start(r.world, r.player, SORCERER_BOOK.id)).toMatchObject({ status: 'started' });
    r.step(slices(11));
    registry.revoke(r.world, r.player, 'spell.spark', 'class'); // the world changed under the reader
    r.step(slices(1));
    expect(r.ended).toMatchObject([{ outcome: 'interrupted', reason: 'prerequisite' }]);
    expect(knowsSpell(r.world, r.player, 'bolt')).toBe(false);
  });

  it('learning a book grants the spell capability with the learned source', () => {
    const registry = new CapabilityRegistry(['spell.bolt']);
    const r = rig({ learning: new SpellLearning({ capabilities: registry }) });
    addCapabilities(r.world, r.player);
    r.world.step();
    r.rules.start(r.world, r.player, SORCERER_BOOK.id);
    r.step(slices(12));
    expect(hasCapability(r.world, r.player, 'spell.bolt')).toBe(true);
    expect(capabilitySources(r.world, r.player, 'spell.bolt')).toEqual(['learned']);
  });

  it('rejects slice and bonus settings that are not whole numbers', () => {
    const make = (config: Partial<StudyRulesOptions['config'] & object>): StudyRules =>
      new StudyRules({ books: () => undefined, learning: new SpellLearning(), config });
    expect(() => make({ sliceMinutes: 0 })).toThrow(/sliceMinutes/);
    expect(() => make({ sliceMinutes: 2.5 })).toThrow(/sliceMinutes/);
    expect(() => make({ sliceTicks: 0 })).toThrow(/sliceTicks/);
    expect(() => make({ deskBonusMilli: 999 })).toThrow(/deskBonusMilli/);
    expect(() => make({ deskBonusMilli: 1500.5 })).toThrow(/deskBonusMilli/);
  });

  it('is deterministic: two identical runs end in the same state', () => {
    const run = (): unknown => {
      const r = rig();
      r.rules.start(r.world, r.player, SORCERER_BOOK.id);
      r.step(slices(6));
      creature(r.world, 'alerted', 5);
      r.step(10);
      return [studyOf(r.world, r.player), r.ended];
    };
    expect(run()).toEqual(run());
  });
});

import { StudyStateComponent } from './study';
const studyComponent = (): typeof StudyStateComponent => StudyStateComponent;
