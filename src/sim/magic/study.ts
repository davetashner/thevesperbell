// Studying a book (mw-e07.2): reading a spellbook through, a slice of in-game time at a time, until its
// spell is learned. This is the book channel of ADR-0004; teaching itself (known spells, the
// `spell.<id>` capability, `SpellLearned`) is `SpellLearning` (./learning.ts), which a trainer or a
// deed calls too, so nothing here is specific to books except time, progress and safety.
//
// How a session runs. `start` is the player's "Study" on a book they carry. From then on the `study`
// system, once per `sliceTicks` of sim time, jumps the game clock `sliceMinutes` forward (a time-lapse:
// a 60-minute book is a dozen half-second slices) and credits that time to the book. The sim keeps
// stepping between slices, so the world is live while the player reads: a creature that notices them
// can turn up, and the session ends the tick it does. A session ends when:
//
// - the book is fully studied (`learned`; or `known` when the spell was learned elsewhere meanwhile);
// - an enemy within `threatRangeM` is Alerted or fighting (`threat`), the reader is hurt (`hurt`),
//   walks off more than `moveToleranceM` (`moved`) or no longer carries the book (`book-gone`): the
//   session is `interrupted`, and the progress already earned stays;
// - `cancel` is called (`cancelled`).
//
// Progress is per book and kept in thousandths of a game minute ("effort"), so a bonus such as the
// desk's x1.5 stays exact integer arithmetic: every minute studied adds `bonusMilli`. Studying again
// resumes from it. Only whole slices are credited (an interrupt never loses or invents a slice).
//
// Bonuses: an entity tagged `desk` within `deskRangeM` of the reader multiplies study speed by
// `deskBonus`. A resting or seated bonus is left for when seats exist (mw-e27.13).
//
// Rejections, in order: `unknown-book`, `not-carried`, `busy` (a
// session is running), `class` (the book's `learners` exclude the reader's class; its lore stays
// readable, which is the reader's concern), then `already-known` (the book is flagged known, nothing is
// learned twice), `prerequisite` (the unlock book refused), `no-clock` and `unsafe` (a threat is
// already near). Comprehension (partial or unstable learning, mw-e07.3) is not here: `BookStudyDef`
// carries what it will need and `completeStudy` is the single place it will hook.

import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { DamageApplied } from '../combat/damage/events';
import { BrainComponent } from '../ai/components';
import { gameClockOf, type GameClock } from '../gametime/clock';
import { classOf } from '../progression/classes';
import type { LearnRefusal } from '../progression/unlocks';
import { TagsComponent } from '../signals/filter';
import type { Vec3 } from '../stimulus/shapes';
import { PlacementComponent } from '../stimulus/placement';
import { KnownSpellsComponent, knowsSpell } from './components';
import type { SpellLearning } from './learning';

/** What studying needs to know about a book (the game derives it from the book item and its spell). */
export interface BookStudyDef {
  /** The book item's id; also the `source` of `SpellLearned`. */
  readonly id: string;
  /** The spell it teaches. */
  readonly spell: string;
  /** Game minutes of study, with no bonus, to learn it (above 0). */
  readonly studyMinutes: number;
  /** Classes that may learn from it, or `any`. Others may read it but not learn. */
  readonly learners: readonly string[] | 'any';
}

/** Tunable study numbers (PLACEHOLDER until playtest). */
export interface StudyConfig {
  /** Game minutes credited per slice. */
  readonly sliceMinutes: number;
  /** Sim ticks between slices. */
  readonly sliceTicks: number;
  /** Study speed multiplier at a desk, in thousandths (1500 = x1.5). */
  readonly deskBonusMilli: number;
  /** The tag that makes an entity a desk. */
  readonly deskTag: string;
  /** Metres within which a desk counts. */
  readonly deskRangeM: number;
  /** Metres within which an alerted creature interrupts study. */
  readonly threatRangeM: number;
  /** Alert states that interrupt study. */
  readonly threatStates: readonly string[];
  /** Metres the reader may drift from where they sat down. */
  readonly moveToleranceM: number;
}

export const DEFAULT_STUDY_CONFIG: StudyConfig = Object.freeze({
  sliceMinutes: 5,
  sliceTicks: 30,
  deskBonusMilli: 1500,
  deskTag: 'desk',
  deskRangeM: 2.5,
  threatRangeM: 20,
  threatStates: Object.freeze(['alerted', 'combat']),
  moveToleranceM: 1,
});

/** One thousandth-minute per minute at no bonus: a book needs `studyMinutes * MILLI` effort. */
export const STUDY_MILLI = 1000;

/** A running study session. */
export interface StudySession {
  readonly book: string;
  /** Where the reader sat down; absent for a reader without a placement. */
  readonly origin?: { readonly x: number; readonly y: number; readonly z: number };
  /** The tick the next slice is credited. */
  readonly nextSliceTick: number;
}

/** A student's study ledger (`magic.study`; a snapshot and save key, never renamed). */
export interface StudyState {
  /** Effort so far per book id (thousandths of a minute), books in id order. */
  readonly progress: Readonly<Record<string, number>>;
  /** Books whose spell the reader already knows (flagged so the UI can say so), in id order. */
  readonly knownBooks: readonly string[];
  readonly session: StudySession | null;
}
export const StudyStateComponent = defineComponent<StudyState>('magic.study');

/** Why a session ended. */
export type StudyOutcome = 'learned' | 'known' | 'interrupted' | 'cancelled';

export interface StudyStartedInfo {
  readonly tick: number;
  readonly actor: EntityId;
  readonly book: string;
  /** Fraction already studied, 0 to 1 (above 0 when resuming). */
  readonly progress: number;
}
export const StudyStarted = defineEvent<StudyStartedInfo>('StudyStarted');

export interface StudyEndedInfo {
  readonly tick: number;
  readonly actor: EntityId;
  readonly book: string;
  readonly outcome: StudyOutcome;
  /** For `interrupted`: `threat`, `hurt`, `moved`, `book-gone`, `no-clock`, `prerequisite`. */
  readonly reason?: string;
  /** Fraction studied when it ended, 0 to 1. */
  readonly progress: number;
}
export const StudyEnded = defineEvent<StudyEndedInfo>('StudyEnded');

export type StudyRefusal =
  'unknown-book' | 'not-carried' | 'busy' | 'class' | 'prerequisite' | 'no-clock' | 'unsafe';

export type StartStudyResult =
  | { readonly status: 'started'; readonly minutesLeft: number }
  | { readonly status: 'already-known' }
  | {
      readonly status: 'refused';
      readonly reason: StudyRefusal;
      readonly refusals?: readonly LearnRefusal[];
    };

export interface StudyRulesOptions {
  /** The study data of a book item, or undefined for a book that teaches no spell. */
  readonly books: (id: string) => BookStudyDef | undefined;
  readonly learning: SpellLearning;
  /** Whether `actor` carries the book (the inventory's answer); omitted = always. */
  readonly carries?: (world: World<never>, actor: EntityId, bookId: string) => boolean;
  readonly config?: Partial<StudyConfig>;
}

const sortedRecord = (entries: Iterable<readonly [string, number]>): Record<string, number> =>
  Object.fromEntries([...entries].sort(([a], [b]) => Number(a > b) - Number(a < b)));
const sortedList = (items: Iterable<string>): string[] =>
  [...new Set(items)].sort((a, b) => Number(a > b) - Number(a < b));

/** Registers the study ledger and known spells (idempotent; `addStudent` and `installStudy` both call it). */
function registerStudy(world: World<never>): void {
  for (const type of [StudyStateComponent, KnownSpellsComponent]) {
    if (!world.isRegistered(type)) world.register(type);
  }
}

/** Gives `actor` a study ledger and known spells up front. Optional: the ledger is otherwise added on first study. */
export function addStudent(world: World<never>, actor: EntityId): void {
  registerStudy(world);
  world.add(actor, StudyStateComponent, { progress: {}, knownBooks: [], session: null });
  if (!world.has(actor, KnownSpellsComponent))
    world.add(actor, KnownSpellsComponent, { spells: [] });
}

const NO_STUDY: StudyState = Object.freeze({ progress: {}, knownBooks: [], session: null });

/** `actor`'s study ledger, or undefined for a non-student. */
export function studyOf(world: World<never>, actor: EntityId): StudyState | undefined {
  return world.isRegistered(StudyStateComponent)
    ? world.get(actor, StudyStateComponent)
    : undefined;
}

export class StudyRules {
  readonly config: StudyConfig;
  readonly #options: StudyRulesOptions;

  constructor(options: StudyRulesOptions) {
    this.#options = options;
    this.config = { ...DEFAULT_STUDY_CONFIG, ...options.config };
    const { sliceMinutes, sliceTicks, deskBonusMilli } = this.config;
    if (!Number.isSafeInteger(sliceMinutes) || sliceMinutes < 1) {
      throw new RangeError('sliceMinutes must be a whole number of minutes, at least 1');
    }
    if (!Number.isSafeInteger(sliceTicks) || sliceTicks < 1) {
      throw new RangeError('sliceTicks must be a whole number of ticks, at least 1');
    }
    if (!Number.isSafeInteger(deskBonusMilli) || deskBonusMilli < STUDY_MILLI) {
      throw new RangeError('deskBonusMilli must be a whole number, at least 1000 (x1)');
    }
  }

  /** Fraction of `book` studied by `actor`, 0 to 1 (1 once its spell is learned from it). */
  progressOf(world: World<never>, actor: EntityId, bookId: string): number {
    const state = studyOf(world, actor);
    const def = this.#options.books(bookId);
    if (state === undefined || def === undefined) return 0;
    return Math.min(1, (state.progress[bookId] ?? 0) / (def.studyMinutes * STUDY_MILLI));
  }

  /** Whether `actor` has studied the spell of `bookId` (flagged known). */
  isKnownBook(world: World<never>, actor: EntityId, bookId: string): boolean {
    return studyOf(world, actor)?.knownBooks.includes(bookId) ?? false;
  }

  /** The book `actor` is studying now, if any. */
  studying(world: World<never>, actor: EntityId): string | undefined {
    return studyOf(world, actor)?.session?.book;
  }

  /** Starts (or resumes) studying `bookId`. Refusals change nothing. */
  start(world: World<never>, actor: EntityId, bookId: string): StartStudyResult {
    const refuse = (
      reason: StudyRefusal,
      refusals?: readonly LearnRefusal[],
    ): StartStudyResult => ({
      status: 'refused',
      reason,
      ...(refusals !== undefined && { refusals }),
    });
    const state = studyOf(world, actor) ?? NO_STUDY;
    const def = this.#options.books(bookId);
    if (def === undefined) return refuse('unknown-book');
    if (this.#options.carries?.(world, actor, bookId) === false) return refuse('not-carried');
    if (state.session !== null) return refuse('busy');
    if (def.learners !== 'any') {
      const learnerClass = classOf(world, actor);
      if (learnerClass === undefined || !def.learners.includes(learnerClass)) {
        return refuse('class');
      }
    }
    if (knowsSpell(world, actor, def.spell)) {
      this.#flagKnown(world, actor, state, bookId);
      world.events.emit(StudyEnded, {
        tick: world.tick,
        actor,
        book: bookId,
        outcome: 'known',
        progress: 1,
      });
      return { status: 'already-known' };
    }
    const checked = this.#options.learning.check(world, actor, def.spell, `book:${bookId}`);
    if (checked.status === 'refused') return refuse('prerequisite', checked.refusals);
    if (gameClockOf(world) === undefined) return refuse('no-clock');
    if (this.#threatNear(world, actor)) return refuse('unsafe');
    const here = world.get(actor, PlacementComponent);
    this.#put(world, actor, {
      ...state,
      session: {
        book: bookId,
        ...(here !== undefined && { origin: { x: here.x, y: here.y, z: here.z } }),
        nextSliceTick: world.tick + this.config.sliceTicks,
      },
    });
    world.events.emit(StudyStarted, {
      tick: world.tick,
      actor,
      book: bookId,
      progress: this.progressOf(world, actor, bookId),
    });
    const left = def.studyMinutes * STUDY_MILLI - (state.progress[bookId] ?? 0);
    return {
      status: 'started',
      minutesLeft: Math.ceil(left / this.#bonusMilli(world, actor)),
    };
  }

  /** Stops `actor`'s session, keeping its progress. Returns whether one was running. */
  cancel(world: World<never>, actor: EntityId): boolean {
    return this.#interrupt(world, actor, 'cancelled');
  }

  /** `actor` took a hit: an open session ends (called by `installStudy` on damage). */
  hurt(world: World<never>, actor: EntityId): void {
    this.#interrupt(world, actor, 'interrupted', 'hurt');
  }

  /**
   * One tick of `actor`'s session: ends it when the reader is disturbed, otherwise credits a slice
   * once due. Called by the `study` system (`installStudy`).
   */
  tick(world: World<never>, actor: EntityId, state: StudyState, session: StudySession): void {
    const def = this.#options.books(session.book);
    if (def === undefined || this.#options.carries?.(world, actor, session.book) === false) {
      this.#interrupt(world, actor, 'interrupted', 'book-gone');
      return;
    }
    if (this.#threatNear(world, actor)) {
      this.#interrupt(world, actor, 'interrupted', 'threat');
      return;
    }
    if (this.#moved(world, actor, session)) {
      this.#interrupt(world, actor, 'interrupted', 'moved');
      return;
    }
    if (world.tick < session.nextSliceTick) return;
    const clock = gameClockOf(world);
    if (clock === undefined) {
      this.#interrupt(world, actor, 'interrupted', 'no-clock'); // a session loaded into a world without one
      return;
    }
    this.#credit(world, actor, state, session, def, clock);
  }

  #credit(
    world: World<never>,
    actor: EntityId,
    state: StudyState,
    session: StudySession,
    def: BookStudyDef,
    clock: GameClock,
  ): void {
    const bonus = this.#bonusMilli(world, actor);
    const needed = def.studyMinutes * STUDY_MILLI;
    const before = state.progress[def.id] ?? 0;
    // The last slice only takes the minutes that finish the book.
    const minutes = Math.min(this.config.sliceMinutes, Math.ceil((needed - before) / bonus));
    clock.advanceTime(minutes, 'study');
    const effort = before + minutes * bonus;
    if (effort >= needed) {
      this.#complete(world, actor, state, def);
      return;
    }
    world.set(actor, StudyStateComponent, {
      ...state,
      progress: sortedRecord([
        ...Object.entries(state.progress).filter(([k]) => k !== def.id),
        [def.id, effort],
      ]),
      session: { ...session, nextSliceTick: world.tick + this.config.sliceTicks },
    });
  }

  /** The one place a finished book becomes learned (mw-e07.3 hooks partial understanding here). */
  #complete(world: World<never>, actor: EntityId, state: StudyState, def: BookStudyDef): void {
    const learned = this.#options.learning.learn(world, actor, def.spell, def.id);
    const rest = Object.entries(state.progress).filter(([k]) => k !== def.id);
    if (learned.status === 'refused') {
      // Prerequisites cannot be lost mid-session, but a rule may change; keep the progress.
      this.#interrupt(world, actor, 'interrupted', 'prerequisite');
      return;
    }
    world.set(actor, StudyStateComponent, {
      progress: sortedRecord(rest),
      knownBooks: sortedList([...state.knownBooks, def.id]),
      session: null,
    });
    world.events.emit(StudyEnded, {
      tick: world.tick,
      actor,
      book: def.id,
      outcome: learned.status === 'learned' ? 'learned' : 'known',
      progress: 1,
    });
  }

  #interrupt(
    world: World<never>,
    actor: EntityId,
    outcome: 'interrupted' | 'cancelled',
    reason?: string,
  ): boolean {
    const state = studyOf(world, actor);
    const session = state?.session;
    if (state === undefined || session === null || session === undefined) return false;
    world.set(actor, StudyStateComponent, { ...state, session: null });
    world.events.emit(StudyEnded, {
      tick: world.tick,
      actor,
      book: session.book,
      outcome,
      ...(reason !== undefined && { reason }),
      progress: this.progressOf(world, actor, session.book),
    });
    return true;
  }

  #flagKnown(world: World<never>, actor: EntityId, state: StudyState, bookId: string): void {
    if (state.knownBooks.includes(bookId)) return;
    this.#put(world, actor, { ...state, knownBooks: sortedList([...state.knownBooks, bookId]) });
  }

  /**
   * Writes the ledger, adding it on first use. An actor that never studies carries no ledger, so
   * worlds that never open a book (and their state hashes) are unchanged. A first add is structural:
   * during a step it lands at the end of the tick.
   */
  #put(world: World<never>, actor: EntityId, state: StudyState): void {
    registerStudy(world);
    if (world.has(actor, StudyStateComponent)) world.set(actor, StudyStateComponent, state);
    else world.add(actor, StudyStateComponent, state);
  }

  /** Study speed in thousandths: x1 plus the desk bonus when sitting at one. */
  #bonusMilli(world: World<never>, actor: EntityId): number {
    const here = world.get(actor, PlacementComponent);
    if (here === undefined || !world.isRegistered(TagsComponent)) return STUDY_MILLI;
    const { deskTag, deskRangeM, deskBonusMilli } = this.config;
    const found = { desk: false };
    world.query(TagsComponent, PlacementComponent).forEach((_id, tags, at) => {
      if (tags.includes(deskTag) && within(here, at, deskRangeM)) found.desk = true;
    });
    return found.desk ? deskBonusMilli : STUDY_MILLI;
  }

  /** Whether a creature within range is in an alert state that makes reading unsafe. */
  #threatNear(world: World<never>, actor: EntityId): boolean {
    const here = world.get(actor, PlacementComponent);
    if (here === undefined || !world.isRegistered(BrainComponent)) return false;
    const { threatRangeM, threatStates } = this.config;
    const found = { threat: false };
    world.query(BrainComponent, PlacementComponent).forEach((id, brain, at) => {
      if (id !== actor && threatStates.includes(brain.state) && within(here, at, threatRangeM)) {
        found.threat = true;
      }
    });
    return found.threat;
  }

  #moved(world: World<never>, actor: EntityId, session: StudySession): boolean {
    const here = world.get(actor, PlacementComponent);
    return (
      here !== undefined &&
      session.origin !== undefined &&
      !within(here, session.origin, this.config.moveToleranceM)
    );
  }
}

/** Whether `a` and `b` are at most `metres` apart (squared, so no square root enters the sim). */
const within = (a: Vec3, b: Vec3, metres: number): boolean =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 <= metres * metres;

/**
 * Makes `world` run study sessions: adds the `study` system and ends the
 * reader's session when they are hurt. Once per world, at setup, outside a step. Returns the function
 * that uninstalls the damage listener.
 */
export function installStudy<TInput>(world: World<TInput>, rules: StudyRules): () => void {
  const sim: World<never> = world;
  // Nothing is registered here: a world that never studies keeps its components, and so its state
  // hash, exactly as they were. The ledger registers itself on first use (`#put`).
  world.addSystem({
    name: 'study',
    run: () => {
      if (!sim.isRegistered(StudyStateComponent)) return;
      const sessions: [EntityId, StudyState, StudySession][] = [];
      sim.query(StudyStateComponent).forEach((actor, state) => {
        if (state.session !== null) sessions.push([actor, state, state.session]);
      });
      for (const [actor, state, session] of sessions) rules.tick(sim, actor, state, session);
    },
  });
  return sim.events.on(DamageApplied, ({ target }) => {
    rules.hurt(sim, target);
  });
}
