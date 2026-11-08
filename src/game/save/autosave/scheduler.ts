// The autosave scheduler (mw-e30.5): turns "a good moment to save happened" into at most one write
// into the autosave ring, at a moment that is actually safe. Systems request autosaves (area
// transition, checkpoint volume, quest state change, rest); the scheduler adds its own timed request
// after a stretch of playtime with no autosave. A request made while any safety veto objects
// (combat, alert, mid-air, dialogue — see SafetyVetoes) waits, and however many requests pile up
// meanwhile, exactly one autosave happens once it is safe. Requests closer together than a minimum
// gap are coalesced the same way, so a player hopping back and forth over an area border does not
// spam writes.
//
// All timing is in sim ticks of playtime (world.tick), never the wall clock: a paused game does not
// run the timer, and tests step ticks. The game loop calls `update(world)` between sim steps. A
// failed write is retried once at the next safe moment; a second failure gives up on that request
// and is reported as a non-blocking warning for the HUD. Listeners (the HUD indicator) hear every
// attempt through `subscribe`.

import type { World } from '@sim/index';
import {
  AUTOSAVE_SLOTS,
  type ReadySlotSummary,
  type SaveSlotInput,
  type SaveSlots,
  type SlotId,
  type ThumbnailOutcome,
} from '../slots/index';
import { pickAutosaveSlot } from './ring';
import { SafetyVetoes } from './vetoes';

/** What prompted an autosave. */
export type AutosaveTriggerKind = 'area-transition' | 'checkpoint' | 'quest' | 'rest' | 'timed';

/** An autosave request. */
export interface AutosaveTrigger {
  readonly kind: AutosaveTriggerKind;
  /** What fired it, for logs and the HUD: an area id, a checkpoint volume, a quest id. */
  readonly source?: string;
}

/** What an autosave records besides the world; the scheduler never labels autosaves. */
export type AutosaveInput = Omit<SaveSlotInput, 'label'>;

/** Default playtime between timed autosaves: five minutes. */
export const AUTOSAVE_INTERVAL_SECONDS = 300;

/** Default least playtime between two autosaves; closer requests wait for the gap. */
export const AUTOSAVE_MIN_GAP_SECONDS = 10;

/** What the scheduler needs from the game. */
export interface AutosaveSchedulerOptions {
  readonly slots: SaveSlots;
  /** Describes the save being made (character, class, area, thumbnail capture, preserved sections). */
  readonly describe: () => AutosaveInput;
  /** The veto registry; a fresh one when omitted (reachable as `scheduler.vetoes`). */
  readonly vetoes?: SafetyVetoes;
  /** Playtime without an autosave after which a timed one is due. Default five minutes. */
  readonly intervalSeconds?: number;
  /** Least playtime between two autosaves. Default ten seconds. */
  readonly minGapSeconds?: number;
}

/** What the HUD indicator hears. */
export type AutosaveEvent =
  /** A write into `slot` started; show the saving indicator. */
  | { readonly type: 'saving'; readonly trigger: AutosaveTrigger; readonly slot: SlotId }
  | {
      readonly type: 'saved';
      readonly trigger: AutosaveTrigger;
      readonly slot: SlotId;
      readonly summary: ReadySlotSummary;
      readonly thumbnail: ThumbnailOutcome;
    }
  /**
   * The autosave failed. With `retrying` it is tried once more at the next safe moment; without, it
   * was the second failure and the HUD shows a non-blocking warning. `slot` is null when the ring
   * itself could not be read.
   */
  | {
      readonly type: 'failed';
      readonly trigger: AutosaveTrigger;
      readonly slot: SlotId | null;
      readonly error: unknown;
      readonly retrying: boolean;
    };

/** Receives autosave events. */
export type AutosaveListener = (event: AutosaveEvent) => void;

function positive(name: string, value: number, allowZero: boolean): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return value;
}

/** Schedules autosaves into the autosave ring at safe moments. */
export class AutosaveScheduler {
  /** Systems register their "not safe now" checks here. */
  readonly vetoes: SafetyVetoes;
  private readonly intervalSeconds: number;
  private readonly minGapSeconds: number;
  private readonly listeners = new Set<AutosaveListener>();
  private pendingTrigger: AutosaveTrigger | null = null;
  /** A request that arrived while a write was in flight; it becomes pending afterwards. */
  private queued: AutosaveTrigger | null = null;
  private failures = 0;
  private inFlight = false;
  /** Tick the timed-autosave interval counts from; set on the first update. */
  private timerBase: number | undefined;
  /** Tick of the last finished autosave attempt, for the minimum gap. */
  private lastAttempt: number | undefined;

  /** @throws RangeError when an interval is not a positive (gap: non-negative) number. */
  constructor(private readonly options: AutosaveSchedulerOptions) {
    this.vetoes = options.vetoes ?? new SafetyVetoes();
    this.intervalSeconds = positive(
      'intervalSeconds',
      options.intervalSeconds ?? AUTOSAVE_INTERVAL_SECONDS,
      false,
    );
    this.minGapSeconds = positive(
      'minGapSeconds',
      options.minGapSeconds ?? AUTOSAVE_MIN_GAP_SECONDS,
      true,
    );
  }

  /** The request waiting for a safe moment, or null. */
  get pending(): AutosaveTrigger | null {
    return this.pendingTrigger;
  }

  /** True while an autosave is being written. */
  get saving(): boolean {
    return this.inFlight;
  }

  /**
   * Asks for an autosave at the next safe moment. Requests made while one is already waiting are
   * coalesced into it, so any number of them yields one autosave.
   */
  request(trigger: AutosaveTrigger): void {
    if (this.inFlight) this.queued ??= trigger;
    else this.pendingTrigger ??= trigger;
  }

  /** Subscribes to autosave events (the HUD indicator). Returns an unsubscribe function. */
  subscribe(listener: AutosaveListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Forgets waiting requests and restarts the timers from `world`'s tick. Call after loading a save
   * or starting a new game, so an autosave requested in the old session does not land in the new
   * one.
   */
  reset(world: World): void {
    this.pendingTrigger = null;
    this.queued = null;
    this.failures = 0;
    this.timerBase = world.tick;
    this.lastAttempt = undefined;
  }

  /**
   * Called by the game loop between sim steps. Starts the timed autosave when it is due and, when a
   * request is waiting, no veto objects and the minimum gap has passed, writes one autosave into the
   * ring. Storage and serialization failures do not reject; they are reported to listeners (which
   * must not throw themselves). Resolves to the attempt's final event,
   * or null when nothing was attempted (nothing due, unsafe, too soon, or a write already running).
   */
  async update(world: World): Promise<AutosaveEvent | null> {
    if (this.inFlight) return null;
    const tick = world.tick;
    const ticks = (seconds: number) => Math.round(seconds * world.clock.hz);
    // First update, or a world whose tick went backwards (an earlier save was loaded without a
    // reset): the timers count from here. timerBase is never before lastAttempt.
    if (this.timerBase === undefined || tick < this.timerBase) {
      this.timerBase = tick;
      this.lastAttempt = undefined;
    }
    if (tick - this.timerBase >= ticks(this.intervalSeconds)) {
      this.pendingTrigger ??= { kind: 'timed' };
    }
    const trigger = this.pendingTrigger;
    if (trigger === null) return null;
    const tooSoon =
      this.failures === 0 &&
      this.lastAttempt !== undefined &&
      tick - this.lastAttempt < ticks(this.minGapSeconds);
    if (tooSoon || !this.vetoes.isSafe()) return null;
    this.inFlight = true;
    try {
      return await this.attempt(world, trigger, tick);
    } finally {
      this.inFlight = false;
    }
  }

  private async attempt(
    world: World,
    trigger: AutosaveTrigger,
    tick: number,
  ): Promise<AutosaveEvent | null> {
    let slot: SlotId | null = null;
    try {
      // The world is saved now, at this tick boundary where the moment was judged safe: serializing
      // it (which also settles a carried object) after the ring read would happen whenever the
      // browser's storage answers, a different tick on every run (mw-e01.21).
      const pending = this.options.slots.capture(world, this.options.describe());
      slot = pickAutosaveSlot(await this.options.slots.list(AUTOSAVE_SLOTS));
      this.emit({ type: 'saving', trigger, slot });
      const saved = await pending.writeTo(slot);
      this.finish(tick);
      return this.emit({
        type: 'saved',
        trigger,
        slot,
        summary: saved.summary,
        thumbnail: saved.thumbnail,
      });
    } catch (error) {
      this.failures += 1;
      const retrying = this.failures < 2;
      if (retrying) this.queued = null;
      else this.finish(tick);
      return this.emit({ type: 'failed', trigger, slot, error, retrying });
    }
  }

  /** The request is done (saved, or failed twice): the timers restart and a queued one waits. */
  private finish(tick: number): void {
    this.pendingTrigger = this.queued;
    this.queued = null;
    this.failures = 0;
    this.timerBase = tick;
    this.lastAttempt = tick;
  }

  private emit(event: AutosaveEvent): AutosaveEvent {
    for (const listener of this.listeners) listener(event);
    return event;
  }
}
